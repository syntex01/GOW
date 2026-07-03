import type { DiceRolls, AttackResult } from '../engine/combat';
import { sound } from '../audio/SoundEngine';

/**
 * DiceTray — an animated, 3D-looking dice-rolling overlay.
 *
 * Pure DOM + CSS (CSS 3D transforms). No external dependencies. Each d6 is a
 * cube of six pip-faces that tumbles (rotateX/rotateY) and settles onto the
 * rolled face. Dice stagger in, are colored by outcome, and a running tally is
 * shown per step (HITS / WOUNDS / SAVES / DAMAGE).
 *
 * The overlay container itself is `pointer-events: none` so it never blocks the
 * HUD; only the explicit Skip control (and the tray surface, which becomes
 * tappable while a roll is in flight) accept input — tapping fast-forwards the
 * sequence to completion immediately.
 *
 * All timers are tracked and cleared on skip/dispose, and every public promise
 * is guaranteed to resolve exactly once.
 */

/** Per-step phase config. */
interface StepDef {
  key: keyof DiceRolls;
  label: string;
  /** Roll target (N+) for success colouring; undefined => neutral colouring. */
  target?: number;
  /** Damage steps total their pips rather than colouring success/fail. */
  isDamage?: boolean;
}

export interface RollOpts {
  hitTarget?: number;
  woundTarget?: number;
  saveTarget?: number;
  title?: string;
}

/** Cap of dice physically rendered per step; overflow shown as "+N". */
const MAX_DICE = 24;

/**
 * The settled cube orientation (deg) that brings face value N to the front.
 * Face layout (see CSS): 1=front, 6=back, 2=right, 5=left, 3=top, 4=bottom.
 */
const FACE_ROT: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: 0, y: -90 },
  3: { x: -90, y: 0 },
  4: { x: 90, y: 0 },
  5: { x: 0, y: 90 },
  6: { x: 0, y: 180 },
};

export class DiceTray {
  private overlay: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private trayEl: HTMLDivElement;
  private skipBtn: HTMLButtonElement;

  /** Active timeout handles, cleared on skip/dispose. */
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** When set, the in-flight roll has been asked to fast-forward. */
  private skipping = false;
  /** Resolve hook for the currently-running roll (so skip can finish it). */
  private finish: (() => void) | null = null;
  private disposed = false;

  /** Speed multiplier (>1 faster). reduced-motion forces near-instant. */
  private speed = 1;
  private reducedMotion = false;

  constructor(root: HTMLElement) {
    this.reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const overlay = document.createElement('div');
    overlay.className = 'dicetray';
    overlay.setAttribute('aria-hidden', 'true');

    const title = document.createElement('div');
    title.className = 'dt-title';

    const tray = document.createElement('div');
    tray.className = 'dt-tray';

    const skip = document.createElement('button');
    skip.className = 'dt-skip';
    skip.type = 'button';
    skip.textContent = 'Skip ▸▸';
    skip.addEventListener('click', this.onSkip);

    // Tapping anywhere on the tray surface also fast-forwards.
    tray.addEventListener('click', this.onSkip);

    overlay.appendChild(title);
    overlay.appendChild(tray);
    overlay.appendChild(skip);

    this.overlay = overlay;
    this.titleEl = title;
    this.trayEl = tray;
    this.skipBtn = skip;

    root.appendChild(overlay);
  }

  /** Set animation speed multiplier (clamped). >1 is faster. */
  setSpeed(mult: number): void {
    if (!Number.isFinite(mult) || mult <= 0) return;
    this.speed = Math.max(0.25, Math.min(8, mult));
  }

  /** Animate a single pool of DiceRolls. Always resolves. */
  async roll(rolls: DiceRolls, opts: RollOpts = {}): Promise<void> {
    return this.run([{ rolls, opts }]);
  }

  /**
   * Convenience: sequence multiple weapons' AttackResults into one run, each as
   * a mini-round titled with its weapon name. Always resolves.
   */
  async rollResults(results: AttackResult[], opts: RollOpts = {}): Promise<void> {
    const rounds = (results ?? [])
      .filter((r) => r && r.rolls)
      .map((r) => ({
        rolls: r.rolls,
        opts: { ...opts, title: opts.title ?? r.weaponName },
      }));
    return this.run(rounds);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    // Resolve any in-flight roll so callers awaiting it don't hang forever.
    if (this.finish) {
      const f = this.finish;
      this.finish = null;
      f();
    }
    this.skipBtn.removeEventListener('click', this.onSkip);
    this.trayEl.removeEventListener('click', this.onSkip);
    if (this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
  }

  // ---- internals ---------------------------------------------------------

  private onSkip = (): void => {
    if (!this.finish) return;
    this.skipping = true;
    this.clearTimers();
    const f = this.finish;
    this.finish = null;
    f();
  };

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** setTimeout wrapper that respects skip/dispose and tracks the handle. */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.skipping || this.disposed || ms <= 0) {
        resolve();
        return;
      }
      const handle = setTimeout(() => {
        this.timers.delete(handle);
        resolve();
      }, ms);
      this.timers.add(handle);
    });
  }

  /** Scaled duration honouring speed + reduced motion. */
  private dur(ms: number): number {
    if (this.reducedMotion) return Math.min(ms, 16);
    return ms / this.speed;
  }

  private show(): void {
    this.overlay.classList.add('show');
    this.overlay.setAttribute('aria-hidden', 'false');
  }

  private hide(): void {
    this.overlay.classList.remove('show');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.trayEl.replaceChildren();
    this.titleEl.replaceChildren();
  }

  /**
   * Drive a list of rounds sequentially. Guarantees the returned promise
   * resolves exactly once (on natural completion, skip, or dispose).
   */
  private run(rounds: { rolls: DiceRolls; opts: RollOpts }[]): Promise<void> {
    // Make a fresh roll cancel/finish any previous in-flight one cleanly.
    if (this.finish) this.onSkip();

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        this.finish = null;
        this.skipping = false;
        this.hide();
        resolve();
      };

      if (this.disposed || rounds.length === 0) {
        done();
        return;
      }

      this.skipping = false;
      this.finish = done;
      this.show();

      // Run the async sequence; on completion call done(). If skip/dispose
      // already resolved via this.finish, done() is a no-op (settled guard).
      void this.sequence(rounds).then(done, done);
    });
  }

  private async sequence(rounds: { rolls: DiceRolls; opts: RollOpts }[]): Promise<void> {
    for (let r = 0; r < rounds.length; r++) {
      if (this.skipping || this.disposed) return;
      await this.playRound(rounds[r], rounds.length > 1 ? r + 1 : 0, rounds.length);
    }
    // Brief hold on the final tally so the result is readable.
    await this.wait(this.dur(700));
  }

  private async playRound(
    round: { rolls: DiceRolls; opts: RollOpts },
    index: number,
    total: number,
  ): Promise<void> {
    const { rolls, opts } = round;
    const titleText = opts.title ?? 'COMBAT';
    this.titleEl.textContent = index > 0 ? `${titleText}  (${index}/${total})` : titleText;

    const steps: StepDef[] = [
      { key: 'hit', label: 'HITS', target: opts.hitTarget },
      { key: 'wound', label: 'WOUNDS', target: opts.woundTarget },
      { key: 'save', label: 'SAVES', target: opts.saveTarget },
      { key: 'damage', label: 'DAMAGE', isDamage: true },
    ];

    for (const step of steps) {
      if (this.skipping || this.disposed) return;
      const values = rolls[step.key] ?? [];
      if (values.length === 0) continue;
      await this.playStep(step, values);
    }
  }

  private async playStep(step: StepDef, values: number[]): Promise<void> {
    // Fresh group container per step.
    const group = document.createElement('div');
    group.className = 'dt-group';

    const head = document.createElement('div');
    head.className = 'dt-grouphead';
    const lbl = document.createElement('span');
    lbl.className = 'dt-label';
    lbl.textContent = step.label;
    const tally = document.createElement('span');
    tally.className = 'dt-tally';
    head.appendChild(lbl);
    head.appendChild(tally);

    const dice = document.createElement('div');
    dice.className = 'dt-dice';

    group.appendChild(head);
    group.appendChild(dice);
    this.trayEl.replaceChildren(group);

    const total = values.length;
    const shown = Math.min(total, MAX_DICE);

    // Build the dice we will physically render.
    const cubes: HTMLDivElement[] = [];
    for (let i = 0; i < shown; i++) {
      const cube = this.makeDie(values[i]);
      dice.appendChild(cube);
      cubes.push(cube);
    }
    if (total > shown) {
      const more = document.createElement('div');
      more.className = 'dt-more';
      more.textContent = `+${total - shown}`;
      dice.appendChild(more);
    }

    // Compute the running tally + classification over the TRUE totals.
    const summary = this.summarise(step, values);
    tally.textContent = summary.text;

    // Stagger the dice tumbling in, then settle each onto its face.
    const stagger = this.dur(this.reducedMotion ? 0 : 55);
    const tumble = this.dur(620);

    // Rattle of the dice as they tumble in.
    sound.playEvent('dice_roll');

    for (let i = 0; i < cubes.length; i++) {
      if (this.skipping || this.disposed) break;
      this.launchDie(cubes[i], values[i], step, tumble);
      if (stagger > 0) await this.wait(stagger);
    }

    // If we skipped mid-stagger, hard-settle every remaining die instantly.
    if (this.skipping || this.disposed) {
      for (let i = 0; i < cubes.length; i++) this.settleInstant(cubes[i], values[i], step);
      sound.playEvent('dice_settle');
      return;
    }

    // Wait for the last die to finish tumbling, plus a short read pause.
    await this.wait(tumble + this.dur(260));
    // Dice land.
    sound.playEvent('dice_settle');
  }

  /** Build a 6-faced cube DOM with pip layouts. */
  private makeDie(value: number): HTMLDivElement {
    const cube = document.createElement('div');
    cube.className = 'dt-die';
    cube.setAttribute('data-value', String(value));

    // Faces: front=1 back=6 right=2 left=5 top=3 bottom=4
    const faceVals: Array<[string, number]> = [
      ['front', 1],
      ['back', 6],
      ['right', 2],
      ['left', 5],
      ['top', 3],
      ['bottom', 4],
    ];
    for (const [pos, v] of faceVals) {
      const face = document.createElement('div');
      face.className = `dt-face dt-${pos}`;
      for (let p = 0; p < v; p++) {
        const pip = document.createElement('span');
        pip.className = 'dt-pip';
        face.appendChild(pip);
      }
      // pip count drives the CSS grid layout via data attribute
      face.setAttribute('data-pips', String(v));
      cube.appendChild(face);
    }
    return cube;
  }

  /** Apply success/fail/crit outcome class for colour glow. */
  private classify(cube: HTMLDivElement, value: number, step: StepDef): void {
    cube.classList.remove('dt-ok', 'dt-bad', 'dt-crit');
    if (step.isDamage) {
      cube.classList.add('dt-dmg');
      return;
    }
    if (value === 6) {
      cube.classList.add('dt-crit'); // gold
      return;
    }
    if (step.target === undefined) return; // neutral
    // A roll of 1 always fails; otherwise meet the N+ target.
    const success = value !== 1 && value >= step.target;
    cube.classList.add(success ? 'dt-ok' : 'dt-bad');
  }

  /** Kick a die into its tumble animation, settling on its face. */
  private launchDie(cube: HTMLDivElement, value: number, step: StepDef, tumble: number): void {
    const rot = FACE_ROT[value] ?? FACE_ROT[1];
    // Extra full spins for the tumble, removed once settled.
    const spinX = rot.x + 360 * (2 + (value % 2));
    const spinY = rot.y + 360 * (2 + ((value + 1) % 2));

    cube.style.setProperty('--dt-rx', `${rot.x}deg`);
    cube.style.setProperty('--dt-ry', `${rot.y}deg`);
    cube.style.setProperty('--dt-spinx', `${spinX}deg`);
    cube.style.setProperty('--dt-spiny', `${spinY}deg`);
    cube.style.setProperty('--dt-tumble', `${tumble}ms`);

    // Force reflow-free animation via class toggle.
    cube.classList.add('dt-rolling');
    this.classify(cube, value, step);

    // Once tumble completes, mark settled so it rests on its face.
    if (tumble <= 16) {
      cube.classList.remove('dt-rolling');
      cube.classList.add('dt-settled');
      return;
    }
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      cube.classList.remove('dt-rolling');
      cube.classList.add('dt-settled');
    }, tumble);
    this.timers.add(handle);
  }

  /** Snap a die directly to its settled face (used on skip). */
  private settleInstant(cube: HTMLDivElement, value: number, step: StepDef): void {
    const rot = FACE_ROT[value] ?? FACE_ROT[1];
    cube.style.setProperty('--dt-rx', `${rot.x}deg`);
    cube.style.setProperty('--dt-ry', `${rot.y}deg`);
    cube.classList.remove('dt-rolling');
    cube.classList.add('dt-settled');
    this.classify(cube, value, step);
  }

  /** Compute the human-readable running tally for a step over true totals. */
  private summarise(step: StepDef, values: number[]): { text: string } {
    const n = values.length;
    if (step.isDamage) {
      const sum = values.reduce((a, b) => a + b, 0);
      return { text: `${sum} dmg  (${n} ${n === 1 ? 'roll' : 'rolls'})` };
    }
    const crits = values.filter((v) => v === 6).length;
    if (step.target === undefined) {
      return { text: `${n}  •  ${crits} crit` };
    }
    let success = 0;
    for (const v of values) if (v !== 1 && v >= step.target) success++;
    const verb = step.label.toLowerCase();
    const critPart = crits > 0 ? `  •  ${crits} crit` : '';
    return { text: `${success}/${n} ${verb}${critPart}` };
  }
}
