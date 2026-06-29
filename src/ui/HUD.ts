import type { GameEngine } from '../engine/game';
import type { SceneController, PickResult } from '../render/SceneController';
import type { UnitInstance, Phase, Vec2, Weapon, PlayerId } from '../engine/types';
import { aliveModels, unitCentroid, inEngagementRange } from '../engine/geometry';

const PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight', 'end'];
const PHASE_LABEL: Record<Phase, string> = {
  command: 'Command',
  movement: 'Movement',
  shooting: 'Shooting',
  charge: 'Charge',
  fight: 'Fight',
  end: 'End Turn',
};

type MoveMode = 'normal' | 'advance' | 'fallBack';

export interface HUDCallbacks {
  /** Open the import flow; HUD provides the text, app rebuilds the battle. */
  onImportArmy: (player: PlayerId) => void;
  onNewBattle: () => void;
}

/**
 * The interactive controller. Owns the DOM overlay and translates player input
 * (clicks on the 3D scene + HUD buttons) into engine actions, then re-syncs the
 * renderer. Designed for hotseat play: one human drives the active player.
 */
export class GameUI {
  private engine!: GameEngine;
  private selectedId: string | null = null;
  private moveMode: MoveMode = 'normal';
  private targets: string[] = [];

  // DOM refs
  private el = {
    topbar: document.createElement('div'),
    phaserail: document.createElement('div'),
    actionbar: document.createElement('div'),
    unitpanel: document.createElement('div'),
    logpanel: document.createElement('div'),
    banner: document.createElement('div'),
  };

  constructor(
    private scene: SceneController,
    private root: HTMLElement,
    private cb: HUDCallbacks,
  ) {
    this.build();
    this.scene.onPick((r) => this.handlePick(r));
    this.scene.onHover((r) => this.handleHover(r));
  }

  bind(engine: GameEngine): void {
    this.engine = engine;
    this.selectedId = null;
    this.targets = [];
    this.refresh();
  }

  // ---------------------------------------------------------------- DOM build
  private build(): void {
    const hud = document.createElement('div');
    hud.className = 'hud';
    this.el.topbar.className = 'topbar';
    this.el.phaserail.className = 'phaserail';
    this.el.actionbar.className = 'actionbar';
    this.el.unitpanel.className = 'unitpanel';
    this.el.logpanel.className = 'logpanel';
    this.el.banner.className = 'banner';
    hud.append(
      this.el.topbar,
      this.el.phaserail,
      this.el.unitpanel,
      this.el.logpanel,
      this.el.actionbar,
      this.el.banner,
    );
    this.root.appendChild(hud);
  }

  private button(label: string, cls = '', on?: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.disabled = disabled;
    if (on) b.onclick = on;
    return b;
  }

  // ---------------------------------------------------------------- refresh
  refresh(): void {
    this.renderTopbar();
    this.renderPhaseRail();
    this.renderActionBar();
    this.renderUnitPanel();
    this.renderLog();
    this.scene.sync(this.engine.state);
    this.checkVictory();
  }

  private renderTopbar(): void {
    const s = this.engine.state;
    const card = (pid: PlayerId): string => {
      const p = s.players[pid];
      const active = s.activePlayer === pid;
      return `<div class="player-card p${pid.toLowerCase()} ${active ? 'active' : ''}">
        <div class="name">${p.name}</div>
        <div class="faction">${p.faction}</div>
        <div class="stats"><span>VP <b>${p.victoryPoints}</b></span><span>CP <b>${p.commandPoints}</b></span>
        <span>Units <b>${this.engine.unitsOf(pid).filter((u) => this.engine.isAlive(u)).length}</b></span></div>
      </div>`;
    };
    this.el.topbar.innerHTML =
      card('A') +
      `<div class="turn-center"><div class="round">Battle Round ${s.round} / 5</div>
        <div class="phase">${s.players[s.activePlayer].name}'s <span class="pname">${PHASE_LABEL[s.phase]}</span></div></div>` +
      card('B');
  }

  private renderPhaseRail(): void {
    const cur = this.engine.state.phase;
    const idx = PHASES.indexOf(cur);
    this.el.phaserail.innerHTML = PHASES.map((p, i) => {
      const cls = i === idx ? 'on' : i < idx ? 'done' : '';
      return `<div class="step ${cls}">${PHASE_LABEL[p]}</div>`;
    }).join('');
  }

  private renderActionBar(): void {
    const bar = this.el.actionbar;
    bar.innerHTML = '';
    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    prompt.innerHTML = this.promptText();
    bar.appendChild(prompt);

    const phase = this.engine.state.phase;
    const sel = this.selected();

    if (phase === 'movement' && sel && sel.ownerId === this.engine.active) {
      const mk = (m: MoveMode, label: string) =>
        this.button(label, `small ${this.moveMode === m ? 'primary' : ''}`, () => {
          this.moveMode = m;
          if (m === 'advance') {
            const r = this.engine.rollAdvance(sel);
            this.toast(`Advance +${r}"`);
          }
          this.refresh();
        });
      bar.append(mk('normal', 'Move'), mk('advance', 'Advance'), mk('fallBack', 'Fall Back'));
      bar.append(
        this.button('Remain', 'small', () => {
          this.engine.remainStationary(sel);
          this.deselect();
          this.refresh();
        }),
      );
    }

    if (phase === 'fight') {
      bar.append(
        this.button('Resolve all melees', 'small', () => this.autoResolveFights(), false),
      );
    }

    // Universal controls
    bar.append(
      this.button('Import Army ▾', 'small', () => this.cb.onImportArmy(this.engine.active)),
      this.button('New Battle', 'small', () => this.cb.onNewBattle()),
    );
    const next = this.button(phase === 'end' ? 'End Turn ▸' : 'Next Phase ▸', 'primary', () =>
      this.nextPhase(),
    );
    bar.appendChild(next);
  }

  private promptText(): string {
    const phase = this.engine.state.phase;
    const sel = this.selected();
    switch (phase) {
      case 'command':
        return `Command phase — CP gained, battle-shock resolved. Review the log, then advance.`;
      case 'movement':
        return sel
          ? `Moving <b>${sel.name}</b> (${this.moveMode}). Click a destination on the table. Max ${this.engine
              .moveAllowance(sel, this.moveMode)
              .toFixed(0)}".`
          : `Movement phase — click one of <b>your</b> units to move it.`;
      case 'shooting':
        return sel
          ? `<b>${sel.name}</b> selected. Click a highlighted enemy unit to shoot.`
          : `Shooting phase — click one of <b>your</b> units that can shoot.`;
      case 'charge':
        return sel
          ? `<b>${sel.name}</b> selected. Click a highlighted enemy within 12" to charge.`
          : `Charge phase — click one of <b>your</b> units to declare a charge.`;
      case 'fight':
        return `Fight phase — click <b>your</b> engaged unit, then an adjacent enemy. Chargers fight first.`;
      case 'end':
        return `End of turn — objectives scored on advancing. Pass to the opponent.`;
    }
  }

  // ---------------------------------------------------------------- unit panel
  private renderUnitPanel(): void {
    const u = this.selected();
    const panel = this.el.unitpanel;
    if (!u) {
      panel.classList.remove('show');
      return;
    }
    panel.classList.add('show');
    const s = u.statline;
    const stat = (k: string, v: string | number) =>
      `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const alive = aliveModels(u).length;
    const woundsNow = aliveModels(u).reduce((a, m) => a + m.wounds, 0);
    const woundsMax = u.startingModelCount * s.wounds;
    const pct = Math.max(0, Math.round((woundsNow / woundsMax) * 100));

    const wpn = (w: Weapon) => {
      const ap = w.ap ? `-${w.ap}` : '0';
      const kws = w.keywords
        .map((k) => (k.t === 'anti' ? `anti-${k.keyword} ${k.x}+` : 'x' in k ? `${k.t} ${k.x}` : k.t))
        .join(', ');
      const stats =
        w.kind === 'ranged'
          ? `<span>R ${w.range}"</span><span>A ${w.attacks}</span><span>BS ${w.skill}+</span><span>S ${w.strength}</span><span>AP ${ap}</span><span>D ${w.damage}</span>`
          : `<span>Melee</span><span>A ${w.attacks}</span><span>WS ${w.skill}+</span><span>S ${w.strength}</span><span>AP ${ap}</span><span>D ${w.damage}</span>`;
      return `<div class="weapon"><div class="wn">${w.name}</div><div class="wstats">${stats}${
        kws ? `<span class="kw">[${kws}]</span>` : ''
      }</div></div>`;
    };

    const badges: string[] = [];
    if (u.moveState !== 'none') badges.push(`<span class="badge">${u.moveState}</span>`);
    if (u.hasShot) badges.push(`<span class="badge">shot</span>`);
    if (u.hasChargedThisTurn) badges.push(`<span class="badge">charged</span>`);
    if (u.hasFought) badges.push(`<span class="badge">fought</span>`);
    if (u.isBattleShocked) badges.push(`<span class="badge warn">battle-shocked</span>`);

    panel.innerHTML = `
      <div class="uname">${u.name}</div>
      <div class="ukw">${u.keywords.slice(0, 6).join(' · ')}</div>
      <div class="statline">
        ${stat('M', `${s.move}"`)}${stat('T', s.toughness)}${stat('Sv', `${s.save}+`)}
        ${stat('W', s.wounds)}${stat('Ld', `${s.leadership}+`)}${stat('OC', s.objectiveControl)}
      </div>
      ${s.invuln ? `<div class="ukw">Invulnerable save ${s.invuln}+ ${s.feelNoPain ? `· Feel No Pain ${s.feelNoPain}+` : ''}</div>` : s.feelNoPain ? `<div class="ukw">Feel No Pain ${s.feelNoPain}+</div>` : ''}
      <div class="wlabel"><span>Models ${alive}/${u.startingModelCount}</span><span>${woundsNow}/${woundsMax} W</span></div>
      <div class="wbar"><span style="width:${pct}%"></span></div>
      ${u.weapons.map(wpn).join('')}
      <div class="status">${badges.join('') || '<span class="badge">ready</span>'}</div>`;
  }

  private renderLog(): void {
    const entries = this.engine.state.log.slice(-40).reverse();
    this.el.logpanel.innerHTML =
      `<h4>Battle Log</h4>` +
      entries
        .map(
          (e) =>
            `<div class="entry p${e.player.toLowerCase()}"><span class="ph">R${e.round} ${e.phase}</span><br>${e.message}</div>`,
        )
        .join('');
  }

  // ---------------------------------------------------------------- flow
  nextPhase(): void {
    // Auto-resolve fights left on the board when leaving the fight phase.
    if (this.engine.state.phase === 'fight') this.autoResolveFights(true);
    this.engine.advancePhase();
    this.deselect();
    this.scene.clearOverlays();
    if (this.engine.state.phase === 'command') this.toast(`${this.engine.state.players[this.engine.active].name}'s turn`);
    this.refresh();
  }

  // ---------------------------------------------------------------- picking
  private handlePick(r: PickResult): void {
    const phase = this.engine.state.phase;
    if (phase === 'command' || phase === 'end') return;
    const unit = r.unitId ? this.engine.state.units[r.unitId] : undefined;

    if (phase === 'movement') {
      if (unit && unit.ownerId === this.engine.active) return this.selectUnit(unit.id);
      const sel = this.selected();
      if (sel) this.doMove(sel, r.point);
      return;
    }

    if (phase === 'shooting') {
      if (unit && unit.ownerId === this.engine.active && this.engine.canShoot(unit))
        return this.selectForShooting(unit);
      const sel = this.selected();
      if (sel && unit && unit.ownerId !== this.engine.active && this.targets.includes(unit.id))
        return this.doShoot(sel, unit);
      return;
    }

    if (phase === 'charge') {
      if (unit && unit.ownerId === this.engine.active) return this.selectForCharge(unit);
      const sel = this.selected();
      if (sel && unit && unit.ownerId !== this.engine.active && this.targets.includes(unit.id))
        return this.doCharge(sel, unit);
      return;
    }

    if (phase === 'fight') {
      if (unit && unit.ownerId === this.engine.active) return this.selectForFight(unit);
      const sel = this.selected();
      if (sel && unit && unit.ownerId !== this.engine.active) return this.doFight(sel, unit);
      return;
    }
  }

  private handleHover(r: PickResult): void {
    const phase = this.engine.state.phase;
    const sel = this.selected();
    if (!sel) return;
    if (phase === 'movement' || phase === 'charge') {
      const from = unitCentroid(sel);
      const d = Math.hypot(r.point.x - from.x, r.point.y - from.y);
      this.scene.clearOverlays();
      if (phase === 'movement') {
        const allow = this.engine.moveAllowance(sel, this.moveMode);
        this.scene.showRange(from, allow, d <= allow ? 0x39ff7a : 0xd6483b);
      }
      this.scene.showMeasurement(from, r.point, `${d.toFixed(1)}"`);
    }
  }

  // ---------------------------------------------------------------- actions
  private selectUnit(id: string): void {
    this.selectedId = id;
    this.targets = [];
    this.scene.setTargets([]);
    this.scene.highlightUnit(id);
    this.refresh();
  }

  private deselect(): void {
    this.selectedId = null;
    this.targets = [];
    this.scene.highlightUnit(null);
    this.scene.setTargets([]);
    this.scene.clearOverlays();
  }

  private doMove(u: UnitInstance, dest: Vec2): void {
    const from = unitCentroid(u);
    const delta = { x: dest.x - from.x, y: dest.y - from.y };
    const ok = this.engine.moveUnit(u, this.moveMode, delta);
    if (!ok) {
      this.toast('Illegal move', true);
      return;
    }
    this.scene.clearOverlays();
    this.deselect();
    this.refresh();
  }

  private selectForShooting(u: UnitInstance): void {
    this.selectedId = u.id;
    this.targets = this.engine
      .enemiesOf(this.engine.active)
      .filter((e) => this.engine.shootableWeapons(u, e).length > 0)
      .map((e) => e.id);
    this.scene.highlightUnit(u.id);
    this.scene.setTargets(this.targets);
    this.refresh();
    if (this.targets.length === 0) this.toast('No targets in range', true);
  }

  private doShoot(attacker: UnitInstance, target: UnitInstance): void {
    const before = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    const results = this.engine.shoot(attacker, target);
    const dmg = results.reduce((a, r) => a + r.damageInflicted, 0);
    const after = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    if (dmg > 0) this.scene.flashDamage(target.id, before - after || dmg);
    this.deselect();
    this.refresh();
  }

  private selectForCharge(u: UnitInstance): void {
    const tgts = this.engine.chargeTargets(u);
    this.selectedId = u.id;
    this.targets = tgts.map((t) => t.id);
    this.scene.highlightUnit(u.id);
    this.scene.setTargets(this.targets);
    this.refresh();
    if (tgts.length === 0) this.toast('No charge targets within 12"', true);
  }

  private doCharge(u: UnitInstance, target: UnitInstance): void {
    const res = this.engine.charge(u, target);
    this.toast(`Charge roll: ${res.roll} — ${res.success ? 'success!' : 'failed'}`, !res.success);
    this.deselect();
    this.refresh();
  }

  private selectForFight(u: UnitInstance): void {
    this.selectedId = u.id;
    this.targets = this.engine
      .enemiesOf(this.engine.active)
      .filter((e) => inEngagementRange(u, e))
      .map((e) => e.id);
    this.scene.highlightUnit(u.id);
    this.scene.setTargets(this.targets);
    this.refresh();
    if (this.targets.length === 0) this.toast('Not in engagement range', true);
  }

  private doFight(attacker: UnitInstance, target: UnitInstance): void {
    if (!this.engine.canFight(attacker, target)) {
      this.toast('Cannot fight that unit', true);
      return;
    }
    const before = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    this.engine.fight(attacker, target);
    const after = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    if (before - after > 0) this.scene.flashDamage(target.id, before - after);
    // Retaliation: the target strikes back if still able.
    if (this.engine.canFight(target, attacker)) {
      const tb = aliveModels(attacker).reduce((a, m) => a + m.wounds, 0);
      this.engine.fight(target, attacker);
      const ta = aliveModels(attacker).reduce((a, m) => a + m.wounds, 0);
      if (tb - ta > 0) this.scene.flashDamage(attacker.id, tb - ta);
    }
    this.deselect();
    this.refresh();
  }

  /** Resolve any remaining melees automatically (chargers first). */
  private autoResolveFights(silent = false): void {
    const order = this.engine.fightOrder();
    for (const u of order) {
      if (!this.engine.isAlive(u) || u.hasFought) continue;
      const enemy = this.engine
        .enemiesOf(u.ownerId)
        .find((e) => inEngagementRange(u, e) && this.engine.isAlive(e));
      if (enemy) this.engine.fight(u, enemy);
    }
    if (!silent) this.toast('Melees resolved');
    this.deselect();
    this.refresh();
  }

  // ---------------------------------------------------------------- misc
  private selected(): UnitInstance | undefined {
    return this.selectedId ? this.engine.state.units[this.selectedId] : undefined;
  }

  private toast(msg: string, _warn = false): void {
    const b = this.el.banner;
    b.textContent = msg;
    b.classList.add('show');
    window.clearTimeout((b as any)._t);
    (b as any)._t = window.setTimeout(() => b.classList.remove('show'), 1100);
  }

  private checkVictory(): void {
    const w = this.engine.winner();
    if (!w) return;
    const b = this.el.banner;
    const text =
      w === 'draw'
        ? 'Battle ends in a DRAW'
        : `${this.engine.state.players[w].name} is VICTORIOUS`;
    b.textContent = text;
    b.classList.add('show');
  }
}
