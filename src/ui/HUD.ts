import type { GameEngine } from '../engine/game';
import type { SceneController, PickResult } from '../render/SceneController';
import type { UnitInstance, Phase, Vec2, Weapon, PlayerId } from '../engine/types';
import { aliveModels, unitCentroid, inEngagementRange } from '../engine/geometry';
import { runAiTurn } from '../engine/ai';

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

/** A presentation-only stratagem entry. Rules are wired by the host later. */
export interface StratagemEntry {
  id: string;
  name: string;
  cost: number;
  phase: string;
  detail: string;
}

export interface HUDCallbacks {
  /** Open the import flow; HUD provides the text, app rebuilds the battle. */
  onImportArmy: (player: PlayerId) => void;
  onNewBattle: () => void;
}

/** Which mobile drawer (if any) is currently open. Only one at a time on phones. */
type Drawer = 'unit' | 'log' | 'stratagems' | null;

/**
 * The interactive controller. Owns the DOM overlay and translates player input
 * (clicks on the 3D scene + HUD buttons) into engine actions, then re-syncs the
 * renderer. Designed for hotseat play: one human drives the active player.
 *
 * Presentation is a dark gothic ("grimdark") theme that scales from a 1600px
 * desktop layout down to ~390px phones, where the side panels collapse into
 * toggleable bottom-sheet drawers reachable by thumb.
 */
export class GameUI {
  private engine!: GameEngine;
  private selectedId: string | null = null;
  private moveMode: MoveMode = 'normal';
  private targets: string[] = [];

  /** Which side, if any, is played by the heuristic AI. Default: player B. */
  private aiPlayer: PlayerId | null = 'B';

  /** When set, the next table click deep-strikes this reserve unit. */
  private deepStrikeUnitId: string | null = null;

  // Stratagem shell state (presentation only).
  private stratagems: StratagemEntry[] = [];
  private onStratagem: ((id: string) => void) | null = null;

  // Which drawer is open (drives the mobile bottom-sheet behaviour).
  private openDrawer: Drawer = null;

  // DOM refs
  private el = {
    topbar: document.createElement('div'),
    phaserail: document.createElement('div'),
    actionbar: document.createElement('div'),
    unitpanel: document.createElement('div'),
    logpanel: document.createElement('div'),
    stratpanel: document.createElement('div'),
    banner: document.createElement('div'),
    cluster: document.createElement('div'),
    backdrop: document.createElement('div'),
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

  // -------------------------------------------------------------- public API
  /**
   * Populate the (otherwise empty) Stratagems drawer. Presentation shell only:
   * entries are grouped by phase, show their CP cost, and are disabled when
   * their phase isn't the current one or the active player can't afford them.
   * Tapping an enabled entry invokes `onActivate(id)`.
   */
  setStratagems(list: StratagemEntry[], onActivate: (id: string) => void): void {
    this.stratagems = list.slice();
    this.onStratagem = onActivate;
    if (this.engine) this.renderStratagems();
  }

  /** Toggle the tactical battle-log drawer (mobile) / focus (desktop). */
  toggleLog(): void {
    this.toggleDrawer('log');
  }

  /** Toggle the unit datacard drawer. */
  toggleDatacard(): void {
    this.toggleDrawer('unit');
  }

  /** Toggle the stratagems drawer. */
  toggleStratagems(): void {
    this.toggleDrawer('stratagems');
  }

  // ---------------------------------------------------------------- DOM build
  private build(): void {
    const hud = document.createElement('div');
    hud.className = 'hud';
    this.el.topbar.className = 'topbar';
    this.el.phaserail.className = 'phaserail';
    this.el.actionbar.className = 'actionbar';
    this.el.unitpanel.className = 'unitpanel drawer drawer-left';
    this.el.logpanel.className = 'logpanel drawer drawer-right';
    this.el.stratpanel.className = 'stratpanel drawer drawer-right';
    this.el.banner.className = 'banner';
    this.el.cluster.className = 'cluster';
    this.el.backdrop.className = 'drawer-backdrop';
    this.el.backdrop.onclick = () => this.closeDrawer();

    this.buildCluster();

    hud.append(
      this.el.backdrop,
      this.el.topbar,
      this.el.phaserail,
      this.el.unitpanel,
      this.el.logpanel,
      this.el.stratpanel,
      this.el.cluster,
      this.el.actionbar,
      this.el.banner,
    );
    this.root.appendChild(hud);
  }

  /** Floating control cluster (recenter, datacard, log, stratagems). */
  private buildCluster(): void {
    const mk = (label: string, title: string, on: () => void) => {
      const b = document.createElement('button');
      b.className = 'cbtn';
      b.type = 'button';
      b.setAttribute('aria-label', title);
      b.title = title;
      b.innerHTML = label;
      b.onclick = on;
      return b;
    };
    this.el.cluster.append(
      mk('◎', 'Recenter camera', () => this.scene.frameBoard()),
      mk('▤', 'Toggle datacard', () => this.toggleDatacard()),
      mk('⚔', 'Toggle stratagems', () => this.toggleStratagems()),
      mk('☰', 'Toggle battle log', () => this.toggleLog()),
    );
  }

  private button(label: string, cls = '', on?: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.type = 'button';
    b.textContent = label;
    b.disabled = disabled;
    if (on) b.onclick = on;
    return b;
  }

  // ------------------------------------------------------------- drawer logic
  private toggleDrawer(which: Exclude<Drawer, null>): void {
    this.openDrawer = this.openDrawer === which ? null : which;
    this.syncDrawers();
  }

  private closeDrawer(): void {
    this.openDrawer = null;
    this.syncDrawers();
  }

  /** Apply the open/closed classes. On desktop the panels are always visible
   *  via CSS; the `open` class only matters at mobile breakpoints. */
  private syncDrawers(): void {
    const map: Array<[Exclude<Drawer, null>, HTMLElement]> = [
      ['unit', this.el.unitpanel],
      ['log', this.el.logpanel],
      ['stratagems', this.el.stratpanel],
    ];
    let any = false;
    for (const [name, node] of map) {
      const on = this.openDrawer === name;
      node.classList.toggle('open', on);
      if (on) any = true;
    }
    this.el.backdrop.classList.toggle('show', any);
    for (const b of Array.from(this.el.cluster.children)) {
      b.classList.remove('active');
    }
    if (this.openDrawer) {
      const order: Record<Exclude<Drawer, null>, number> = { unit: 1, stratagems: 2, log: 3 };
      const idx = order[this.openDrawer];
      const btn = this.el.cluster.children[idx];
      if (btn) btn.classList.add('active');
    }
  }

  // ---------------------------------------------------------------- refresh
  refresh(): void {
    this.applyTheme();
    this.renderTopbar();
    this.renderPhaseRail();
    this.renderActionBar();
    this.renderUnitPanel();
    this.renderLog();
    this.renderStratagems();
    this.scene.sync(this.engine.state);
    this.checkVictory();
  }

  /** Derive an accent theme from the active player's faction. */
  private applyTheme(): void {
    const faction = (this.engine.state.players[this.engine.state.activePlayer].faction || '').toLowerCase();
    let accent = 'imperial';
    if (faction.includes('necron')) accent = 'necron';
    else if (faction.includes('ultramarine') || faction.includes('marine') || faction.includes('imperial'))
      accent = 'imperial';
    else if (faction.includes('ork')) accent = 'ork';
    else if (faction.includes('tyranid')) accent = 'tyranid';
    (this.root.closest('.hud') ?? this.root).setAttribute('data-accent', accent);
    const hud = this.root.querySelector('.hud');
    if (hud) hud.setAttribute('data-accent', accent);
  }

  private renderTopbar(): void {
    const s = this.engine.state;
    const card = (pid: PlayerId): string => {
      const p = s.players[pid];
      const active = s.activePlayer === pid;
      const units = this.engine.unitsOf(pid).filter((u) => this.engine.isAlive(u)).length;
      return `<div class="player-card p${pid.toLowerCase()} ${active ? 'active' : ''}">
        <div class="crest" aria-hidden="true"></div>
        <div class="pc-body">
          <div class="name">${p.name}</div>
          <div class="faction">${p.faction}</div>
          <div class="stats">
            <span class="stat-vp">VP <b>${p.victoryPoints}</b></span>
            <span class="stat-cp">CP <b>${p.commandPoints}</b></span>
            <span class="stat-un">Units <b>${units}</b></span>
          </div>
        </div>
      </div>`;
    };
    this.el.topbar.innerHTML =
      card('A') +
      `<div class="turn-center">
        <div class="round">Battle Round ${s.round} / 5</div>
        <div class="phase">${s.players[s.activePlayer].name}'s <span class="pname">${PHASE_LABEL[s.phase]}</span></div>
      </div>` +
      card('B');
  }

  private renderPhaseRail(): void {
    const cur = this.engine.state.phase;
    const idx = PHASES.indexOf(cur);
    this.el.phaserail.innerHTML = PHASES.map((p, i) => {
      const cls = i === idx ? 'on' : i < idx ? 'done' : '';
      return `<div class="step ${cls}"><span class="dot" aria-hidden="true"></span><span class="lbl">${PHASE_LABEL[p]}</span></div>`;
    }).join('');
  }

  private renderActionBar(): void {
    const bar = this.el.actionbar;
    bar.innerHTML = '';
    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    prompt.innerHTML = this.promptText();
    bar.appendChild(prompt);

    const actions = document.createElement('div');
    actions.className = 'actions';
    bar.appendChild(actions);

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
      actions.append(mk('normal', 'Move'), mk('advance', 'Advance'), mk('fallBack', 'Fall Back'));
      actions.append(
        this.button('Remain', 'small', () => {
          this.engine.remainStationary(sel);
          this.deselect();
          this.refresh();
        }),
      );
    }

    if (phase === 'fight') {
      actions.append(
        this.button('Resolve all melees', 'small', () => this.autoResolveFights(), false),
      );
    }

    // Strategic Reserves: declare in round 1 command, arrive from round 2 movement.
    if (
      phase === 'command' &&
      this.engine.state.round === 1 &&
      sel &&
      sel.ownerId === this.engine.active &&
      !sel.inReserves &&
      !sel.leadingUnitId
    ) {
      actions.append(
        this.button('→ Reserves', 'small', () => {
          const res = this.engine.sendToReserves(sel.id);
          this.notify(res.message, !res.ok);
          this.deselect();
          this.refresh();
        }),
      );
    }
    if (phase === 'movement' && this.engine.state.round >= 2) {
      for (const r of this.engine.reservesOf(this.engine.active)) {
        const active = this.deepStrikeUnitId === r.id;
        actions.append(
          this.button(
            `${active ? 'Placing ▸ ' : '⤓ Deep Strike: '}${r.name}`,
            `small ${active ? 'primary' : ''}`,
            () => {
              this.deepStrikeUnitId = active ? null : r.id;
              this.scene.clearOverlays();
              if (this.deepStrikeUnitId) this.showDeepStrikeExclusion();
              this.refresh();
            },
          ),
        );
      }
    }

    // Universal controls
    actions.append(
      this.button(`AI: ${this.aiPlayer ? 'On' : 'Off'}`, 'small', () => this.toggleAi()),
      this.button('Import Army ▾', 'small', () => this.cb.onImportArmy(this.engine.active)),
      this.button('New Battle', 'small', () => this.cb.onNewBattle()),
    );
    const next = this.button(phase === 'end' ? 'End Turn ▸' : 'Next Phase ▸', 'primary', () =>
      this.nextPhase(),
    );
    actions.appendChild(next);
  }

  private promptText(): string {
    const phase = this.engine.state.phase;
    const sel = this.selected();
    switch (phase) {
      case 'command':
        return `Command phase — CP gained, battle-shock resolved. Review the log, then advance.`;
      case 'movement':
        if (this.deepStrikeUnitId) {
          const ds = this.engine.state.units[this.deepStrikeUnitId];
          return `Deep striking <b>${ds?.name}</b> — click a spot outside every red 9" ring.`;
        }
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
      panel.innerHTML = '';
      // If the unit drawer was open with nothing selected, close it on mobile.
      if (this.openDrawer === 'unit') this.closeDrawer();
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
    const woundCls = pct <= 25 ? 'crit' : pct <= 55 ? 'hurt' : '';

    const wpn = (w: Weapon) => {
      const ap = w.ap ? `-${w.ap}` : '0';
      const kws = w.keywords
        .map((k) => (k.t === 'anti' ? `anti-${k.keyword} ${k.x}+` : 'x' in k ? `${k.t} ${k.x}` : k.t))
        .join(', ');
      const cells =
        w.kind === 'ranged'
          ? [`${w.range}"`, `${w.attacks}`, `${w.skill}+`, `${w.strength}`, ap, `${w.damage}`]
          : ['Melee', `${w.attacks}`, `${w.skill}+`, `${w.strength}`, ap, `${w.damage}`];
      return `<tr class="weapon ${w.kind}">
        <td class="wn">${w.name}${kws ? `<span class="kw">${kws}</span>` : ''}</td>
        ${cells.map((c) => `<td>${c}</td>`).join('')}
      </tr>`;
    };

    const badges: string[] = [];
    if (u.moveState !== 'none') badges.push(`<span class="badge">${u.moveState}</span>`);
    if (u.hasShot) badges.push(`<span class="badge">shot</span>`);
    if (u.hasChargedThisTurn) badges.push(`<span class="badge">charged</span>`);
    if (u.hasFought) badges.push(`<span class="badge">fought</span>`);
    if (u.isBattleShocked) badges.push(`<span class="badge warn">battle-shocked</span>`);

    panel.innerHTML = `
      <div class="datacard-head">
        <div class="dc-titles">
          <div class="uname">${u.name}</div>
          <div class="ukw">${u.keywords.slice(0, 6).join(' · ')}</div>
        </div>
        <button class="drawer-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="statline">
        ${stat('M', `${s.move}"`)}${stat('T', s.toughness)}${stat('Sv', `${s.save}+`)}
        ${stat('W', s.wounds)}${stat('Ld', `${s.leadership}+`)}${stat('OC', s.objectiveControl)}
      </div>
      ${
        s.invuln
          ? `<div class="ability">Invulnerable save ${s.invuln}+ ${s.feelNoPain ? `· Feel No Pain ${s.feelNoPain}+` : ''}</div>`
          : s.feelNoPain
          ? `<div class="ability">Feel No Pain ${s.feelNoPain}+</div>`
          : ''
      }
      <div class="wlabel"><span>Models ${alive}/${u.startingModelCount}</span><span>${woundsNow}/${woundsMax} W</span></div>
      <div class="wbar ${woundCls}"><span style="width:${pct}%"></span></div>
      <table class="weapons">
        <thead><tr><th>Weapon</th><th>R</th><th>A</th><th>Sk</th><th>S</th><th>AP</th><th>D</th></tr></thead>
        <tbody>${u.weapons.map(wpn).join('')}</tbody>
      </table>
      <div class="status">${badges.join('') || '<span class="badge ready">ready</span>'}</div>`;
    const close = panel.querySelector('.drawer-close') as HTMLButtonElement | null;
    if (close) close.onclick = () => this.closeDrawer();
  }

  private renderLog(): void {
    const entries = this.engine.state.log.slice(-40).reverse();
    this.el.logpanel.innerHTML =
      `<div class="panel-head"><h4>Tactical Readout</h4><button class="drawer-close" type="button" aria-label="Close">✕</button></div>` +
      `<div class="log-body">` +
      entries
        .map(
          (e) =>
            `<div class="entry p${e.player.toLowerCase()}"><span class="ph">R${e.round} · ${e.phase}</span><div class="msg">${e.message}</div></div>`,
        )
        .join('') +
      `</div>`;
    const close = this.el.logpanel.querySelector('.drawer-close') as HTMLButtonElement | null;
    if (close) close.onclick = () => this.closeDrawer();
  }

  // ------------------------------------------------------------- stratagems
  private renderStratagems(): void {
    if (!this.engine) return;
    const panel = this.el.stratpanel;
    const curPhase = this.engine.state.phase;
    const cp = this.engine.state.players[this.engine.state.activePlayer].commandPoints;

    const head = `<div class="panel-head"><h4>Stratagems</h4><span class="cp-pool">${cp} CP</span><button class="drawer-close" type="button" aria-label="Close">✕</button></div>`;

    if (this.stratagems.length === 0) {
      panel.innerHTML = head + `<div class="strat-empty">No stratagems available</div>`;
      const c = panel.querySelector('.drawer-close') as HTMLButtonElement | null;
      if (c) c.onclick = () => this.closeDrawer();
      return;
    }

    // Group by phase, preserving first-seen order.
    const groups: Record<string, StratagemEntry[]> = {};
    const order: string[] = [];
    for (const st of this.stratagems) {
      if (!groups[st.phase]) {
        groups[st.phase] = [];
        order.push(st.phase);
      }
      groups[st.phase].push(st);
    }

    const body = order
      .map((ph) => {
        const items = groups[ph]
          .map((st) => {
            const wrongPhase = ph.toLowerCase() !== String(curPhase).toLowerCase();
            const tooPoor = st.cost > cp;
            const disabled = wrongPhase || tooPoor;
            const reason = wrongPhase ? 'wrong phase' : tooPoor ? 'not enough CP' : '';
            return `<button class="strat ${disabled ? 'disabled' : ''}" type="button" data-id="${st.id}" ${
              disabled ? 'disabled' : ''
            }>
              <div class="strat-top"><span class="sn">${st.name}</span><span class="sc">${st.cost} CP</span></div>
              <div class="sd">${st.detail}</div>
              ${reason ? `<div class="sr">${reason}</div>` : ''}
            </button>`;
          })
          .join('');
        const active = ph.toLowerCase() === String(curPhase).toLowerCase();
        return `<div class="strat-group ${active ? 'active' : ''}"><div class="strat-gh">${ph}</div>${items}</div>`;
      })
      .join('');

    panel.innerHTML = head + `<div class="strat-body">${body}</div>`;
    const c = panel.querySelector('.drawer-close') as HTMLButtonElement | null;
    if (c) c.onclick = () => this.closeDrawer();
    panel.querySelectorAll<HTMLButtonElement>('.strat:not(.disabled)').forEach((b) => {
      b.onclick = () => {
        const id = b.getAttribute('data-id');
        if (id && this.onStratagem) this.onStratagem(id);
      };
    });
  }

  // ---------------------------------------------------------------- flow
  nextPhase(): void {
    // Auto-resolve fights left on the board when leaving the fight phase.
    if (this.engine.state.phase === 'fight') this.autoResolveFights(true);
    this.engine.advancePhase();
    this.deselect();
    this.deepStrikeUnitId = null;
    this.scene.clearOverlays();
    // If the turn just passed to the AI player, let it play its whole turn.
    if (this.aiPlayer && this.engine.active === this.aiPlayer && this.engine.winner() === undefined) {
      this.toast(`${this.engine.state.players[this.aiPlayer].name} is taking their turn…`);
      runAiTurn(this.engine);
    }
    if (this.engine.state.phase === 'command') this.toast(`${this.engine.state.players[this.engine.active].name}'s turn`);
    this.refresh();
  }

  /** Toggle the AI opponent on player B (off = hotseat). */
  toggleAi(): void {
    this.aiPlayer = this.aiPlayer ? null : 'B';
    this.toast(this.aiPlayer ? 'AI opponent ON (plays the red army)' : 'AI off — hotseat');
    this.refresh();
  }

  /** Whether the AI currently controls a side (for HUD labelling). */
  aiEnabled(): boolean {
    return this.aiPlayer !== null;
  }

  // ---------------------------------------------------------------- picking
  private handlePick(r: PickResult): void {
    const phase = this.engine.state.phase;
    if (phase === 'command' || phase === 'end') return;
    const unit = r.unitId ? this.engine.state.units[r.unitId] : undefined;

    if (phase === 'movement') {
      // Deep-strike placement takes priority when arming a reserve unit.
      if (this.deepStrikeUnitId) {
        const res = this.engine.deepStrikeArrive(this.deepStrikeUnitId, r.point);
        this.notify(res.message, !res.ok);
        if (res.ok) {
          this.deepStrikeUnitId = null;
          this.scene.clearOverlays();
          this.refresh();
        }
        return;
      }
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

  /** The current friendly selection + first highlighted enemy, for stratagems. */
  currentSelection(): { unitId?: string; targetUnitId?: string } {
    const out: { unitId?: string; targetUnitId?: string } = {};
    if (this.selectedId) out.unitId = this.selectedId;
    const enemyTarget = this.targets.find(
      (id) => this.engine.state.units[id]?.ownerId !== this.engine.active,
    );
    if (enemyTarget) out.targetUnitId = enemyTarget;
    return out;
  }

  /** Public toast for host-driven messages (e.g. stratagem results). */
  notify(message: string, warn = false): void {
    this.toast(message, warn);
  }

  /** Draw 9" no-deploy rings around every enemy unit (deep-strike guidance). */
  private showDeepStrikeExclusion(): void {
    for (const e of this.engine.enemiesOf(this.engine.active)) {
      this.scene.showRange(unitCentroid(e), 9, 0xd6483b);
    }
  }

  private toast(msg: string, warn = false): void {
    const b = this.el.banner;
    b.textContent = msg;
    b.classList.toggle('warn', warn);
    b.classList.add('show', 'toast');
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
    b.classList.remove('toast', 'warn');
    b.classList.add('show', 'victory');
  }
}
