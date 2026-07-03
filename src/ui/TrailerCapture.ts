import type { GameEngine } from '../engine/game';
import type { SceneController } from '../render/SceneController';
import type { UnitInstance, Vec2 } from '../engine/types';
import { aliveModels, unitCentroid, unitGap, inEngagementRange, unitGapToPoint } from '../engine/geometry';

/**
 * Deterministic, frame-stepped cinematic director for OFFLINE trailer capture.
 *
 * The live `Cinematic` plays in real time (setTimeout / rAF). On a software
 * renderer that only manages a few FPS, a real-time screen recording captures
 * almost no motion. This version instead expresses the whole trailer as a
 * timeline of timed "beats" produced by a generator, and is advanced by an
 * external loop one FIXED virtual timestep at a time via `step(dt)`. The loop
 * screenshots after each step and assembles the frames at a fixed FPS, so the
 * output is perfectly smooth regardless of how slow each render actually is.
 *
 * All animation is driven by the virtual clock: camera (via scene.tick(dt)),
 * combat FX, unit tweens, and overlay opacity (set directly, NOT via CSS
 * transitions — the `.cap` class disables those so screenshots are exact).
 */

/** A timeline unit: an instant action, or a timed hold with a progress hook. */
type Beat = { do: () => void } | { hold: number; on?: (p: number) => void };

export class TrailerCapture {
  private overlay!: HTMLElement;
  private hud: HTMLElement | null;
  private cardEl!: HTMLElement;
  private lowerEl!: HTMLElement;
  private fadeEl!: HTMLElement;

  private gen: Generator<Beat>;
  private current: { hold: number; on?: (p: number) => void } | null = null;
  private held = 0;
  private finished = false;

  constructor(
    private engine: GameEngine,
    private scene: SceneController,
    private root: HTMLElement,
  ) {
    this.hud = root.querySelector('.hud');
    if (this.hud) this.hud.style.display = 'none';
    this.buildOverlay();
    this.gen = this.script();
  }

  get done(): boolean {
    return this.finished;
  }

  /** Tear down the overlay and restore the HUD. */
  cleanup(): void {
    this.scene.setAutoOrbit(0);
    if (this.hud) this.hud.style.display = '';
    this.overlay.remove();
  }

  /**
   * Advance the timeline by `dtSeconds` of virtual time, then render exactly one
   * frame. Processes as many beats as fit in the budget (so short beats don't
   * each cost a frame). Call repeatedly until `done`, screenshotting between calls.
   */
  step(dtSeconds: number): void {
    let dtMs = dtSeconds * 1000;
    let guard = 0;
    while (dtMs > 0 && !this.finished && guard++ < 10000) {
      if (!this.current) {
        const n = this.gen.next();
        if (n.done) {
          this.finished = true;
          break;
        }
        const beat = n.value;
        if ('do' in beat) {
          beat.do();
          continue;
        }
        this.current = beat;
        this.held = 0;
      }
      const hold = this.current;
      const remaining = hold.hold - this.held;
      const consume = Math.min(remaining, dtMs);
      this.held += consume;
      dtMs -= consume;
      hold.on?.(hold.hold > 0 ? Math.min(1, this.held / hold.hold) : 1);
      if (this.held >= hold.hold) this.current = null;
    }
    this.scene.tick(dtSeconds);
  }

  // ---------------------------------------------------------------- overlay
  private buildOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cine cap'; // `cap` disables CSS transitions
    this.overlay.innerHTML = `
      <div class="cine-vignette"></div>
      <div class="cine-bars"><span></span><span></span></div>
      <div class="cine-card" id="capCard" style="opacity:0"></div>
      <div class="cine-lower" id="capLower" style="opacity:0"></div>
      <div class="cine-fade show" id="capFade" style="opacity:1"></div>`;
    this.root.appendChild(this.overlay);
    this.cardEl = this.overlay.querySelector('#capCard') as HTMLElement;
    this.lowerEl = this.overlay.querySelector('#capLower') as HTMLElement;
    this.fadeEl = this.overlay.querySelector('#capFade') as HTMLElement;
  }

  // ------------------------------------------------------------- beat helpers
  private *fade(toOpacity: number, ms: number): Generator<Beat> {
    const from = parseFloat(this.fadeEl.style.opacity || '0');
    yield { hold: ms, on: (p) => (this.fadeEl.style.opacity = String(from + (toOpacity - from) * p)) };
  }

  private *card(title: string, sub: string, holdMs = 2200, fadeMs = 650): Generator<Beat> {
    yield {
      do: () => {
        this.cardEl.innerHTML =
          `<div class="cine-title">${title}</div>` + (sub ? `<div class="cine-sub">${sub}</div>` : '');
      },
    };
    yield { hold: fadeMs, on: (p) => (this.cardEl.style.opacity = String(p)) };
    yield { hold: holdMs };
    yield { hold: fadeMs, on: (p) => (this.cardEl.style.opacity = String(1 - p)) };
  }

  private *showLower(text: string, fadeMs = 400): Generator<Beat> {
    yield { do: () => (this.lowerEl.innerHTML = text) };
    yield { hold: fadeMs, on: (p) => (this.lowerEl.style.opacity = String(p)) };
  }
  private *hideLower(fadeMs = 350): Generator<Beat> {
    const from = parseFloat(this.lowerEl.style.opacity || '1');
    yield { hold: fadeMs, on: (p) => (this.lowerEl.style.opacity = String(from * (1 - p))) };
  }
  private *wait(ms: number): Generator<Beat> {
    yield { hold: ms };
  }
  private *act(fn: () => void): Generator<Beat> {
    yield { do: fn };
  }

  // ------------------------------------------------------------------ script
  private *script(): Generator<Beat> {
    const s = this.engine.state;
    const aName = s.players.A.name;
    const bName = s.players.B.name;

    // Opening: hold on black, start a slow orbit, fade in, title card.
    yield* this.act(() => {
      this.scene.setAutoOrbit(0.16);
      this.scene.frameBoard();
    });
    yield* this.fade(0, 900);
    yield* this.card('GRIMDARK TABLETOP', 'In the grim dark future, there is only war', 2400);
    yield* this.showLower(`${aName} &nbsp;⚔&nbsp; ${bName}`);
    yield* this.wait(1800);
    yield* this.hideLower();

    // Battle.
    yield* this.battle();

    // Finale.
    yield* this.act(() => {
      this.scene.setAutoOrbit(0.1);
      this.scene.frameBoard();
    });
    const w = this.engine.winner();
    const victor = w === 'A' ? aName : w === 'B' ? bName : null;
    yield* this.card(victor ? victor : 'NO MERCY', victor ? 'stands victorious' : 'the field is a graveyard', 2400);
    yield* this.card('GRIMDARK TABLETOP', 'A tabletop-faithful wargame simulator', 2200);
    yield* this.fade(1, 900);
  }

  private *battle(): Generator<Beat> {
    let guard = 0;
    while (this.engine.winner() === undefined && this.engine.state.round <= 4 && guard < 48) {
      yield* this.phase();
      this.engine.advancePhase();
      guard++;
    }
  }

  private own(): UnitInstance[] {
    return this.engine.unitsOf(this.engine.active).filter((u) => this.engine.isAlive(u) && !u.inReserves);
  }

  private *phase(): Generator<Beat> {
    const phase = this.engine.state.phase;
    const me = this.engine.active;
    this.scene.setAutoOrbit(0.04);

    if (phase === 'command') {
      yield* this.showLower(`${this.engine.state.players[me].name} — Battle Round ${this.engine.state.round}`);
      yield* this.act(() => this.scene.focusOn(this.boardCenter(), { radius: 46, polar: 0.85 }));
      yield* this.wait(1200);
      yield* this.hideLower();
      return;
    }

    if (phase === 'movement') {
      for (const u of this.own()) {
        if (this.engine.enemiesOf(me).some((e) => inEngagementRange(u, e))) continue;
        const goal = this.moveGoal(u);
        if (!goal) continue;
        const from = unitCentroid(u);
        const d = Math.hypot(goal.x - from.x, goal.y - from.y) || 1;
        const stepLen = Math.min(u.statline.move, Math.max(0, d - 2));
        if (stepLen < 0.3) continue;
        const delta = { x: ((goal.x - from.x) / d) * stepLen, y: ((goal.y - from.y) / d) * stepLen };
        yield* this.tween(u, delta, 560);
        u.moveState = 'normal';
      }
      return;
    }

    if (phase === 'shooting') {
      for (const u of this.own()) {
        if (!this.engine.canShoot(u)) continue;
        const target = this.bestShootTarget(u);
        if (!target) continue;
        yield* this.focusPair(u, target, 0.62);
        yield* this.act(() => this.scene.playShoot(u.id, target.id, { volleys: 4 }));
        yield* this.wait(440);
        let lost = 0;
        yield* this.act(() => {
          const before = this.wounds(target);
          this.engine.shoot(u, target);
          lost = before - this.wounds(target);
          if (lost > 0) {
            this.scene.playImpact(target.id, Math.min(2, lost / 3));
            this.scene.flashDamage(target.id, lost);
          }
          this.scene.sync(this.engine.state);
        });
        yield* this.wait(560);
      }
      return;
    }

    if (phase === 'charge') {
      for (const u of this.own()) {
        const tgts = this.engine.chargeTargets(u);
        if (!tgts.length) continue;
        yield* this.focusPair(u, tgts[0], 0.7);
        yield* this.act(() => {
          const res = this.engine.charge(u, tgts[0]);
          if (res.success) this.lowerEl.innerHTML = 'CHARGE!';
          this.lowerEl.style.opacity = '1';
          this.scene.sync(this.engine.state);
        });
        yield* this.wait(520);
        yield* this.hideLower();
      }
      return;
    }

    if (phase === 'fight') {
      for (const u of this.engine.fightOrder()) {
        if (u.hasFought || !this.engine.isAlive(u)) continue;
        const enemy = this.engine
          .enemiesOf(u.ownerId)
          .find((e) => inEngagementRange(u, e) && this.engine.isAlive(e));
        if (!enemy) continue;
        yield* this.focusPair(u, enemy, 0.8);
        yield* this.act(() => this.scene.playMelee(u.id, enemy.id));
        let lost = 0;
        yield* this.act(() => {
          const before = this.wounds(enemy);
          this.engine.fight(u, enemy);
          lost = before - this.wounds(enemy);
          if (lost > 0) {
            this.scene.playImpact(enemy.id, Math.min(2, lost / 3));
            this.scene.flashDamage(enemy.id, lost);
          }
          this.scene.sync(this.engine.state);
        });
        yield* this.wait(620);
      }
      return;
    }
  }

  // --------------------------------------------------------------- helpers
  private boardCenter(): Vec2 {
    return { x: this.engine.state.board.width / 2, y: this.engine.state.board.height / 2 };
  }

  private wounds(u: UnitInstance): number {
    return aliveModels(u).reduce((a, m) => a + m.wounds, 0);
  }

  private *focusPair(a: UnitInstance, b: UnitInstance, polar: number): Generator<Beat> {
    yield* this.act(() => {
      const ca = unitCentroid(a);
      const cb = unitCentroid(b);
      const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
      const spread = Math.hypot(ca.x - cb.x, ca.y - cb.y);
      this.scene.setAutoOrbit(0);
      this.scene.focusOn(mid, { radius: Math.max(16, spread * 0.9 + 12), polar });
    });
    yield* this.wait(380);
  }

  private moveGoal(u: UnitInstance): Vec2 | undefined {
    let best: Vec2 | undefined;
    let bd = Infinity;
    for (const obj of this.engine.state.objectives) {
      if (obj.controlledBy === u.ownerId) continue;
      const d = unitGapToPoint(u, obj.position);
      if (d < bd) {
        bd = d;
        best = obj.position;
      }
    }
    if (best) return best;
    let en: UnitInstance | undefined;
    let ed = Infinity;
    for (const e of this.engine.enemiesOf(u.ownerId)) {
      const d = unitGap(u, e);
      if (d < ed) {
        ed = d;
        en = e;
      }
    }
    return en ? unitCentroid(en) : undefined;
  }

  private bestShootTarget(u: UnitInstance): UnitInstance | undefined {
    let best: UnitInstance | undefined;
    let bn = 0;
    for (const e of this.engine.enemiesOf(this.engine.active)) {
      const n = this.engine.shootableWeapons(u, e).length;
      if (n > bn) {
        bn = n;
        best = e;
      }
    }
    return best;
  }

  /** Glide a unit's living models by `delta` over `ms`, syncing each frame. */
  private *tween(u: UnitInstance, delta: Vec2, ms: number): Generator<Beat> {
    const models = aliveModels(u);
    const starts = models.map((m) => ({ x: m.position.x, y: m.position.y }));
    const from = unitCentroid(u);
    this.scene.focusOn({ x: from.x + delta.x / 2, y: from.y + delta.y / 2 }, { radius: 30, polar: 0.8 });
    yield {
      hold: ms,
      on: (p) => {
        const e = p * p * (3 - 2 * p); // smoothstep
        models.forEach((m, i) => {
          m.position = { x: starts[i].x + delta.x * e, y: starts[i].y + delta.y * e };
        });
        this.scene.sync(this.engine.state);
      },
    };
  }
}
