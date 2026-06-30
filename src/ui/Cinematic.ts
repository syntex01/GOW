import type { GameEngine } from '../engine/game';
import type { SceneController } from '../render/SceneController';
import type { UnitInstance, Vec2 } from '../engine/types';
import { aliveModels, unitCentroid, unitGap, inEngagementRange, unitGapToPoint } from '../engine/geometry';

/**
 * Cinematic AI-vs-AI director: plays a full battle with both sides controlled by
 * a simple heuristic, framing the action with the camera, firing the combat FX,
 * and overlaying grimdark title cards + captions. Designed to be screen-recorded
 * into a trailer — the recorded page IS the finished film (no post-processing).
 */

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class Cinematic {
  private stopped = false;
  private overlay!: HTMLElement;
  private hud: HTMLElement | null;

  constructor(
    private engine: GameEngine,
    private scene: SceneController,
    private root: HTMLElement,
  ) {
    this.hud = root.querySelector('.hud');
    this.buildOverlay();
  }

  stop(): void {
    this.stopped = true;
  }

  // ------------------------------------------------------------------ overlay
  private buildOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cine';
    this.overlay.innerHTML = `
      <div class="cine-vignette"></div>
      <div class="cine-bars"><span></span><span></span></div>
      <div class="cine-card" id="cineCard"></div>
      <div class="cine-lower" id="cineLower"></div>
      <div class="cine-fade" id="cineFade"></div>`;
    this.root.appendChild(this.overlay);
  }

  private async card(title: string, sub = '', ms = 2600): Promise<void> {
    const el = this.overlay.querySelector('#cineCard') as HTMLElement;
    el.innerHTML = `<div class="cine-title">${title}</div>${sub ? `<div class="cine-sub">${sub}</div>` : ''}`;
    el.classList.add('show');
    await wait(ms);
    el.classList.remove('show');
    await wait(700);
  }

  private lower(text: string): void {
    const el = this.overlay.querySelector('#cineLower') as HTMLElement;
    el.innerHTML = text;
    el.classList.add('show');
  }
  private hideLower(): void {
    (this.overlay.querySelector('#cineLower') as HTMLElement).classList.remove('show');
  }
  private async fadeBlack(on: boolean, ms = 600): Promise<void> {
    const el = this.overlay.querySelector('#cineFade') as HTMLElement;
    el.classList.toggle('show', on);
    await wait(ms);
  }

  // --------------------------------------------------------------------- run
  async run(): Promise<void> {
    if (this.hud) this.hud.style.display = 'none';
    const s = this.engine.state;
    const aName = s.players.A.name;
    const bName = s.players.B.name;

    // Opening
    await this.fadeBlack(true, 10);
    this.scene.setAutoOrbit(0.18);
    this.scene.frameBoard();
    await this.fadeBlack(false, 900);
    await this.card('GRIMDARK TABLETOP', 'In the grim dark future, there is only war', 2800);
    this.lower(`${aName} &nbsp;⚔&nbsp; ${bName}`);
    await wait(2200);
    this.hideLower();

    // Battle
    await this.playBattle(70_000);

    // Finale
    this.scene.setAutoOrbit(0.12);
    this.scene.frameBoard();
    const w = this.engine.winner();
    const victor = w === 'A' ? aName : w === 'B' ? bName : null;
    await this.card(victor ? `${victor}` : 'NO MERCY', victor ? 'stands victorious' : 'the field is a graveyard', 2800);
    await this.card('GRIMDARK TABLETOP', 'A tabletop-faithful wargame simulator', 2600);
    await this.fadeBlack(true, 900);

    this.cleanup();
  }

  private cleanup(): void {
    this.scene.setAutoOrbit(0);
    if (this.hud) this.hud.style.display = '';
    this.overlay.remove();
  }

  // ----------------------------------------------------------------- battle
  private boardCenter(): Vec2 {
    return { x: this.engine.state.board.width / 2, y: this.engine.state.board.height / 2 };
  }

  private async playBattle(budgetMs: number): Promise<void> {
    const start = Date.now();
    let guard = 0;
    while (!this.stopped && this.engine.winner() === undefined && this.engine.state.round <= 5 && guard < 60) {
      if (Date.now() - start > budgetMs) break;
      await this.playPhaseVisually();
      this.engine.advancePhase();
      guard++;
    }
  }

  private own(): UnitInstance[] {
    return this.engine
      .unitsOf(this.engine.active)
      .filter((u) => this.engine.isAlive(u) && !u.inReserves);
  }

  private async playPhaseVisually(): Promise<void> {
    const phase = this.engine.state.phase;
    const me = this.engine.active;
    this.scene.setAutoOrbit(0.05);

    if (phase === 'command') {
      this.lower(`${this.engine.state.players[me].name} — Battle Round ${this.engine.state.round}`);
      this.scene.focusOn(this.boardCenter(), { radius: 46, polar: 0.85 });
      await wait(1300);
      this.hideLower();
      return;
    }

    if (phase === 'movement') {
      for (const u of this.own()) {
        if (this.stopped) return;
        if (this.engine.enemiesOf(me).some((e) => inEngagementRange(u, e))) continue;
        const goal = this.moveGoal(u);
        if (!goal) continue;
        const from = unitCentroid(u);
        const d = Math.hypot(goal.x - from.x, goal.y - from.y) || 1;
        const step = Math.min(u.statline.move, Math.max(0, d - 2));
        if (step < 0.3) continue;
        const delta = { x: ((goal.x - from.x) / d) * step, y: ((goal.y - from.y) / d) * step };
        await this.tweenMove(u, delta, 520);
        u.moveState = 'normal';
      }
      return;
    }

    if (phase === 'shooting') {
      for (const u of this.own()) {
        if (this.stopped) return;
        if (!this.engine.canShoot(u)) continue;
        const target = this.bestShootTarget(u);
        if (!target) continue;
        await this.focusPair(u, target, 0.62);
        this.scene.playShoot(u.id, target.id, { volleys: 4 });
        await wait(420);
        const before = this.wounds(target);
        this.engine.shoot(u, target);
        const lost = before - this.wounds(target);
        if (lost > 0) {
          this.scene.playImpact(target.id, Math.min(2, lost / 3));
          this.scene.flashDamage(target.id, lost);
        }
        this.scene.sync(this.engine.state);
        await wait(560);
      }
      return;
    }

    if (phase === 'charge') {
      for (const u of this.own()) {
        if (this.stopped) return;
        const tgts = this.engine.chargeTargets(u);
        if (!tgts.length) continue;
        await this.focusPair(u, tgts[0], 0.7);
        const res = this.engine.charge(u, tgts[0]);
        if (res.success) this.lower('CHARGE!');
        this.scene.sync(this.engine.state);
        await wait(520);
        this.hideLower();
      }
      return;
    }

    if (phase === 'fight') {
      for (const u of this.engine.fightOrder()) {
        if (this.stopped) return;
        if (u.hasFought || !this.engine.isAlive(u)) continue;
        const enemy = this.engine.enemiesOf(u.ownerId).find((e) => inEngagementRange(u, e) && this.engine.isAlive(e));
        if (!enemy) continue;
        await this.focusPair(u, enemy, 0.8);
        this.scene.playMelee(u.id, enemy.id);
        const before = this.wounds(enemy);
        this.engine.fight(u, enemy);
        const lost = before - this.wounds(enemy);
        if (lost > 0) {
          this.scene.playImpact(enemy.id, Math.min(2, lost / 3));
          this.scene.flashDamage(enemy.id, lost);
        }
        this.scene.sync(this.engine.state);
        await wait(620);
      }
      return;
    }
  }

  // --------------------------------------------------------------- helpers
  private wounds(u: UnitInstance): number {
    return aliveModels(u).reduce((a, m) => a + m.wounds, 0);
  }

  private async focusPair(a: UnitInstance, b: UnitInstance, polar: number): Promise<void> {
    const ca = unitCentroid(a);
    const cb = unitCentroid(b);
    const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
    const spread = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    this.scene.setAutoOrbit(0);
    this.scene.focusOn(mid, { radius: Math.max(16, spread * 0.9 + 12), polar });
    await wait(360);
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
  private tweenMove(u: UnitInstance, delta: Vec2, ms: number): Promise<void> {
    const models = aliveModels(u);
    const starts = models.map((m) => ({ x: m.position.x, y: m.position.y }));
    const from = unitCentroid(u);
    this.scene.focusOn({ x: from.x + delta.x / 2, y: from.y + delta.y / 2 }, { radius: 30, polar: 0.8 });
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (this.stopped) return resolve();
        const t = Math.min(1, (performance.now() - t0) / ms);
        const e = t * t * (3 - 2 * t); // smoothstep
        models.forEach((m, i) => {
          m.position = { x: starts[i].x + delta.x * e, y: starts[i].y + delta.y * e };
        });
        this.scene.sync(this.engine.state);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
}
