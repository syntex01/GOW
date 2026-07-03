import type { GameEngine } from '../engine/game';
import type { SceneController, PickResult } from '../render/SceneController';
import type { UnitInstance, Phase, Vec2, Weapon, PlayerId } from '../engine/types';
import {
  aliveModels,
  unitCentroid,
  inEngagementRange,
  unitGap,
  coverState,
  moveReachField,
  moveReachDistance,
  shootReachField,
  unitBlockers,
} from '../engine/geometry';
import { aiStep, aiReactToCharge, aiReactToShooting } from '../engine/ai';
import { CORE_STRATAGEMS } from '../engine/stratagems';
import { DiceTray } from './DiceTray';
import { Rng } from '../engine/dice';
import { setAssignment, fileToDataUrl, formatFromName, type ModelFormat } from '../render/ModelAssignments';
import { sound } from '../audio/SoundEngine';

/** Short confirmation haptic, guarded for devices/browsers without vibrate. */
function haptic(pattern: number | number[] = 12): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Inspect a unit's weapons and pick the best-matching shooting sound family by
 * name/keyword (gauss / plasma / bolt / heavy), defaulting to the bolter sound.
 */
function shootSoundFor(unit: UnitInstance): string {
  const ranged = unit.weapons.filter((w) => w.kind === 'ranged');
  const text = ranged.map((w) => w.name.toLowerCase()).join(' ');
  if (/gauss|tesla|flayer|disintegrat/.test(text)) return 'shoot_gauss';
  if (/plasma|melta|fusion/.test(text)) return 'shoot_plasma';
  // Heavy if any weapon carries the HEAVY keyword or a "heavy/lascannon" name.
  if (
    ranged.some((w) => w.keywords.some((k) => k.t === 'heavy')) ||
    /heavy|lascannon|autocannon|battle cannon|missile/.test(text)
  ) {
    return 'shoot_heavy';
  }
  if (/bolt|bolter/.test(text)) return 'shoot_bolter';
  return 'shoot_bolter';
}

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
  /** Set once the player is warned about ending a phase early; re-tap confirms. */
  private endPhaseConfirmed = false;
  /** True while the enemy turn is being animated — locks the player's input. */
  private aiThinking = false;
  private moveMode: MoveMode = 'normal';
  private targets: string[] = [];

  /** Which side, if any, is played by the heuristic AI. Default: player B. */
  private aiPlayer: PlayerId | null = 'B';

  /** When set, the next table click deep-strikes this reserve unit. */
  private deepStrikeUnitId: string | null = null;

  // --- online multiplayer (null localPlayer = local/hotseat/AI controls both) ---
  private localPlayer: PlayerId | null = null;
  private broadcaster: ((state: unknown) => void) | null = null;
  private applyingRemote = false;
  private hasReceivedRemote = false;

  // Stratagem shell state (presentation only).
  private stratagems: StratagemEntry[] = [];
  private onStratagem: ((id: string) => void) | null = null;

  // Which drawer is open (drives the mobile bottom-sheet behaviour).
  private openDrawer: Drawer = null;

  // Audio change-detection: last-seen objective control + total CP, so refresh()
  // can fire capture / command-point cues only when these actually change.
  private lastObjOwners: Record<string, string> = {};
  private lastTotalCp = -1;

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

  private dice: DiceTray;

  constructor(
    private scene: SceneController,
    private root: HTMLElement,
    private cb: HUDCallbacks,
  ) {
    this.build();
    this.dice = new DiceTray(this.root);
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
    this.el.unitpanel.className = 'unitpanel drawer drawer-right';
    this.el.logpanel.className = 'logpanel drawer drawer-left';
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

    // Delegated UI feedback: any button inside the HUD plays a click on press
    // and a soft tick on hover, without each call site wiring it up.
    hud.addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest('button');
      if (!btn || btn.disabled) return;
      sound.unlock();
      sound.playEvent(btn.classList.contains('strat') ? 'stratagem' : 'ui_click');
    });
    hud.addEventListener(
      'pointerover',
      (e) => {
        const t = e.target as HTMLElement | null;
        const btn = t?.closest('button');
        // Fire only when the pointer first enters the button (not its children).
        if (btn && !btn.disabled && !(e.relatedTarget && btn.contains(e.relatedTarget as Node))) {
          sound.playEvent('ui_hover');
        }
      },
      true,
    );
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
    // Show which friendly units can still act (green rings) as a phase overview,
    // but only when nothing is selected — once a unit is picked, its targets /
    // range take over the highlight so the board stays readable.
    this.scene.setReadyUnits(
      this.selectedId || !this.canLocalAct() ? [] : this.actionableUnits().map((u) => u.id),
    );
    this.updateSelectionRange();
    this.scene.sync(this.engine.state);
    this.detectStateSounds();
    this.checkVictory();
    // Online: push our authoritative state to the peer after any local change.
    // Host (A) may broadcast from the start; guest (B) only after it has first
    // received the host's state, so it never clobbers the initial sync.
    if (
      this.broadcaster &&
      !this.applyingRemote &&
      (this.localPlayer === 'A' || this.hasReceivedRemote)
    ) {
      this.broadcaster(this.engine.state);
    }
  }

  // -------------------------------------------------------------- online API
  /** Put the HUD into online mode: input is gated to `local`'s turns, and every
   *  local change is sent via `broadcast`. */
  setOnline(local: PlayerId, broadcast: (state: unknown) => void): void {
    this.localPlayer = local;
    this.broadcaster = broadcast;
    this.aiPlayer = null; // online play has no local AI
  }

  /** True when it is the local player's turn to act (online). */
  isLocalTurn(): boolean {
    return this.localPlayer !== null && !!this.engine && this.engine.active === this.localPlayer;
  }

  /** Force-broadcast the current authoritative state — used to answer a peer's
   *  sync request and as a periodic heartbeat so a dropped snapshot self-heals
   *  (so the opponent always sees the latest board / my every move). */
  pushState(): void {
    if (this.broadcaster && !this.applyingRemote && this.engine) {
      this.broadcaster(this.engine.state);
    }
  }

  /** Apply an authoritative GameState received from the peer. */
  applyRemoteState(state: unknown): void {
    const wasLocalTurn = this.isLocalTurn();
    this.applyingRemote = true;
    this.hasReceivedRemote = true;
    this.engine.state = state as GameEngine['state'];
    this.engine.rng = new Rng((state as { rngSeed: number }).rngSeed);
    this.deselect();
    this.deepStrikeUnitId = null;
    this.refresh();
    this.applyingRemote = false;
    // Announce the handoff so the player knows the board is theirs to act on.
    if (!wasLocalTurn && this.isLocalTurn()) {
      this.toast('Your turn!');
      haptic(24);
    }
  }

  /** True when the local player is allowed to act right now. */
  private canLocalAct(): boolean {
    return this.localPlayer === null || this.engine.active === this.localPlayer;
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
      const sec = p.secondaryVictoryPoints ?? 0;
      const secTag = sec > 0 ? ` <i class="sec" title="${sec}VP from secondary objectives">+${sec} sec</i>` : '';
      return `<div class="player-card p${pid.toLowerCase()} ${active ? 'active' : ''}">
        <div class="crest" aria-hidden="true"></div>
        <div class="pc-body">
          <div class="name">${p.name}</div>
          <div class="faction">${p.faction}</div>
          <div class="stats">
            <span class="stat-vp">VP <b>${p.victoryPoints}</b>${secTag}</span>
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
        this.button(label, `small ${this.moveMode === m ? 'selected' : ''}`, () => {
          this.moveMode = m;
          if (m === 'advance') {
            const r = this.engine.rollAdvance(sel);
            this.toast(`Advance +${r}"`);
            sound.playEvent('advance');
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
      this.button('Import Model ▾', 'small', () => this.openModelImport()),
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
    // A live "N can still act" tag the player can rely on across phases.
    const ready = (['movement', 'shooting', 'charge', 'fight'] as const).includes(phase as 'movement')
      ? (() => {
          const n = this.actionableUnits().length;
          return n > 0
            ? ` <span class="ready-tag">${n} can still ${this.phaseVerb()}</span>`
            : ` <span class="ready-tag done">all units done</span>`;
        })()
      : '';
    const tag = (s: string) => s + ready;
    switch (phase) {
      case 'command':
        return `Command phase — CP gained, battle-shock resolved. Review the log, then advance.`;
      case 'movement':
        if (this.deepStrikeUnitId) {
          const ds = this.engine.state.units[this.deepStrikeUnitId];
          return `Deep striking <b>${ds?.name}</b> — click a spot outside every red 9" ring.`;
        }
        return tag(
          sel
            ? `Moving <b>${sel.name}</b> (${this.moveMode}). Click a destination — ${this.engine
                .remainingMove(sel, this.moveMode)
                .toFixed(1)}" of movement left.`
            : `Movement phase — click one of <b>your</b> units to move it.`,
        );
      case 'shooting':
        return tag(
          sel
            ? this.targets.length
              ? `<b>${sel.name}</b> selected. Click a highlighted enemy unit to shoot.`
              : `<b>${sel.name}</b> has no target in range or line of sight. Pick another unit or advance.`
            : `Shooting phase — click one of <b>your</b> units that can shoot.`,
        );
      case 'charge':
        return tag(
          sel
            ? this.targets.length
              ? `<b>${sel.name}</b> selected. Click a highlighted enemy within 12" to charge.`
              : `<b>${sel.name}</b> has no enemy within 12". Pick another unit or advance.`
            : `Charge phase — click one of <b>your</b> units to declare a charge.`,
        );
      case 'fight':
        return tag(`Fight phase — click <b>your</b> engaged unit, then an adjacent enemy. Chargers fight first.`);
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
    if (this.aiThinking) return; // enemy turn in progress
    if (!this.canLocalAct()) {
      this.toast('Waiting for the other player…');
      return;
    }
    // Gentle reminder: leaving an action phase with units that could still act.
    // Non-blocking — the player stays in control, but isn't caught out.
    const leftover = this.actionableUnits().length;
    if (leftover > 0 && !this.endPhaseConfirmed) {
      this.endPhaseConfirmed = true;
      this.toast(`${leftover} unit${leftover > 1 ? 's' : ''} could still ${this.phaseVerb()} — tap again to end the phase`, true);
      sound.playEvent('error');
      return;
    }
    this.endPhaseConfirmed = false;
    // Auto-resolve fights left on the board when leaving the fight phase.
    if (this.engine.state.phase === 'fight') this.autoResolveFights(true);
    const prevActive = this.engine.active;
    this.engine.advancePhase();
    // Turn handoff plays a heavier cue than a plain phase change.
    if (this.engine.active !== prevActive) {
      sound.playEvent('turn_start');
      haptic(18);
    } else {
      sound.playEvent('phase_change');
    }
    this.deselect();
    this.deepStrikeUnitId = null;
    this.scene.clearOverlays();
    // If the turn just passed to the AI player, play it out VISIBLY (phase by
    // phase with pauses + refreshes) instead of teleporting to the end.
    if (this.aiPlayer && this.engine.active === this.aiPlayer && this.engine.winner() === undefined) {
      void this.runAiTurnAnimated(this.aiPlayer);
      return;
    }
    if (this.engine.state.phase === 'command') this.toast(`${this.engine.state.players[this.engine.active].name}'s turn`);
    this.refresh();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((res) => window.setTimeout(res, ms));
  }

  /**
   * Give the DEFENDING human a reaction window on the AI's turn, just before the
   * AI resolves its Shooting or Charge phase. Presents the human's affordable
   * reactive stratagems (each auto-targeting the sensible unit) plus Skip. The
   * returned promise settles once the human picks or skips, so the animated AI
   * turn pauses for the reaction rather than steamrolling it. Resolves instantly
   * when there is nothing to offer.
   */
  private offerHumanReaction(defender: PlayerId, phase: Phase): Promise<void> {
    // Only clearly-defensive, auto-targetable reactions belong in this window.
    const DEFENSE = new Set(['fire_overwatch', 'armour_of_contempt', 'go_to_ground', 'smokescreen']);
    const strats = this.engine.reactiveStratagemsFor(defender).filter((s) => DEFENSE.has(s.id));
    if (strats.length === 0) return Promise.resolve();

    // Auto-targets: the most-threatened friendly unit, and the best overwatch pair.
    const enemies = this.engine.unitsOf(defender === 'A' ? 'B' : 'A').filter((u) => this.engine.onBoard(u));
    const mine = this.engine.unitsOf(defender).filter((u) => this.engine.onBoard(u));
    let threatened: UnitInstance | undefined;
    let bestGap = Infinity;
    for (const u of mine)
      for (const en of enemies) {
        const g = unitGap(u, en);
        if (g < bestGap) { bestGap = g; threatened = u; }
      }
    let owShooter: UnitInstance | undefined;
    let owTarget: UnitInstance | undefined;
    let owBest = 0;
    for (const u of mine) {
      if (u.overwatchUsedRound === this.engine.state.round) continue;
      for (const en of enemies) {
        const n = this.engine.shootableWeapons(u, en).length;
        if (n > owBest) { owBest = n; owShooter = u; owTarget = en; }
      }
    }

    // Build one option per usable reaction (only if it has a valid target).
    type Opt = { id: string; label: string; ctx: { unitId?: string; targetUnitId?: string } };
    const opts: Opt[] = [];
    for (const s of strats) {
      if (s.id === 'fire_overwatch') {
        if (owShooter && owTarget && owBest > 0)
          opts.push({ id: s.id, label: `Fire Overwatch — ${owShooter.name} → ${owTarget.name}`, ctx: { unitId: owShooter.id, targetUnitId: owTarget.id } });
      } else if (s.id === 'go_to_ground') {
        if (threatened && threatened.keywords.includes('INFANTRY'))
          opts.push({ id: s.id, label: `Go to Ground — ${threatened.name}`, ctx: { unitId: threatened.id } });
      } else if (threatened) {
        const verb = s.id === 'smokescreen' ? 'Smokescreen' : 'Armour of Contempt';
        opts.push({ id: s.id, label: `${verb} — ${threatened.name}`, ctx: { unitId: threatened.id } });
      }
    }
    if (opts.length === 0) return Promise.resolve();

    const cp = this.engine.state.players[defender].commandPoints;
    return new Promise<void>((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop show';
      const rows = opts
        .map((o, i) => {
          const cost = CORE_STRATAGEMS.find((s) => s.id === o.id)?.cost ?? 1;
          return `<button class="btn small react" data-i="${i}" type="button">${o.label} <span style="opacity:.7">(${cost} CP)</span></button>`;
        })
        .join('');
      backdrop.innerHTML = `
        <div class="modal">
          <h3>Reaction — enemy ${phase} phase</h3>
          <p>The enemy is about to ${phase === 'charge' ? 'charge' : 'shoot'}. Spend a reactive Stratagem? You have <b>${cp} CP</b>.</p>
          <div class="react-list" style="display:flex;flex-direction:column;gap:6px;margin:8px 0;">${rows}</div>
          <div class="row"><button class="btn primary small" id="reactSkip" type="button">Skip reaction</button></div>
        </div>`;
      this.root.appendChild(backdrop);
      const done = () => { backdrop.remove(); resolve(); };
      backdrop.querySelectorAll<HTMLButtonElement>('.react').forEach((btn) => {
        btn.onclick = () => {
          const o = opts[Number(btn.dataset.i)];
          const res = this.engine.activateStratagem(o.id, o.ctx, defender);
          this.toast(res.message, !res.ok);
          if (res.ok) sound.playEvent('stratagem');
          this.refresh();
          done();
        };
      });
      (backdrop.querySelector('#reactSkip') as HTMLElement).onclick = done;
      backdrop.onclick = (e) => { if (e.target === backdrop) done(); };
    });
  }

  /** Show the enemy's turn unfolding phase by phase. */
  private async runAiTurnAnimated(ai: PlayerId): Promise<void> {
    this.aiThinking = true;
    this.refresh();
    let guard = 0;
    const human: PlayerId = ai === 'A' ? 'B' : 'A';
    while (this.aiPlayer && this.engine.active === ai && this.engine.winner() === undefined && guard < 60) {
      const phase = this.engine.state.phase;
      this.toast(`${this.engine.state.players[ai].name} — ${phase} phase`);
      // Reaction window: before the AI shoots or charges, let the human spend a
      // reactive Stratagem in defence. Pauses the animated turn until resolved.
      if (phase === 'shooting' || phase === 'charge') {
        await this.offerHumanReaction(human, phase);
      }
      const cont = aiStep(this.engine);
      this.refresh(); // reveal the moves / casualties from this phase
      // Linger longer on phases with visible consequences (shots, melee).
      await this.delay(phase === 'shooting' || phase === 'fight' ? 950 : 550);
      guard += 1;
      if (!cont) break;
    }
    this.aiThinking = false;
    if (this.engine.state.phase === 'command') {
      this.toast(`${this.engine.state.players[this.engine.active].name}'s turn`);
    }
    this.refresh();
  }

  /** Set which side the AI plays (null = hotseat/no AI). */
  setAi(player: PlayerId | null): void {
    this.aiPlayer = player;
  }

  /** Set the dice-animation speed multiplier (>1 faster). */
  setDiceSpeed(mult: number): void {
    this.dice.setSpeed(mult);
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
    if (this.aiThinking) return; // the enemy is taking its turn
    if (!this.canLocalAct()) return; // not our turn in online play
    this.endPhaseConfirmed = false; // any board action re-arms the end-phase guard
    const phase = this.engine.state.phase;
    if (phase === 'command' || phase === 'end') return;
    const unit = r.unitId ? this.engine.state.units[r.unitId] : undefined;

    if (phase === 'movement') {
      // Deep-strike placement takes priority when arming a reserve unit.
      if (this.deepStrikeUnitId) {
        const res = this.engine.deepStrikeArrive(this.deepStrikeUnitId, r.point);
        this.notify(res.message, !res.ok);
        if (res.ok) {
          sound.playEvent('deep_strike');
          haptic(18);
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
      if (unit && unit.ownerId === this.engine.active) {
        if (this.engine.canShoot(unit)) return this.selectForShooting(unit);
        // Tapped a friendly unit that can't shoot — say why instead of ignoring.
        const why = this.engine.shootBlockReason(unit);
        if (why) this.toast(why, true);
        return;
      }
      const sel = this.selected();
      if (sel && unit && unit.ownerId !== this.engine.active) {
        if (this.targets.includes(unit.id)) {
          void this.doShoot(sel, unit);
        } else {
          this.toast(`${sel.name} can't hit ${unit.name} — out of range or no line of sight`, true);
        }
        return;
      }
      return;
    }

    if (phase === 'charge') {
      if (unit && unit.ownerId === this.engine.active) {
        const why = this.engine.chargeBlockReason(unit);
        if (why) {
          this.toast(why, true);
          return;
        }
        return this.selectForCharge(unit);
      }
      const sel = this.selected();
      if (sel && unit && unit.ownerId !== this.engine.active) {
        if (this.targets.includes(unit.id)) {
          void this.doCharge(sel, unit);
          return;
        }
        this.toast(`${unit.name} is beyond 12" — out of charge range`, true);
        return;
      }
      return;
    }

    if (phase === 'fight') {
      if (unit && unit.ownerId === this.engine.active) return this.selectForFight(unit);
      const sel = this.selected();
      if (sel && unit && unit.ownerId !== this.engine.active) {
        void this.doFight(sel, unit);
        return;
      }
      return;
    }
  }

  private lastHoverMs = 0;
  private handleHover(r: PickResult): void {
    // Throttle to ~30 Hz — pointermove fires far faster and each hover rebuilds
    // the path/measurement overlays, which was churning the GC on PC.
    const now = performance.now();
    if (now - this.lastHoverMs < 32) return;
    this.lastHoverMs = now;
    const phase = this.engine.state.phase;
    const sel = this.selected();
    if (!sel) return;
    if (phase === 'movement' || phase === 'charge') {
      const from = unitCentroid(sel);
      const d = Math.hypot(r.point.x - from.x, r.point.y - from.y);
      this.scene.clearOverlays();
      if (phase === 'movement') {
        // Raycast the straight path to the cursor: green up to where the unit can
        // actually reach (limited by remaining move AND by walls / too-low
        // terrain), red beyond, with a marker at the stop point.
        const remaining = this.engine.remainingMove(sel, this.moveMode);
        const dir = d > 1e-6 ? { x: (r.point.x - from.x) / d, y: (r.point.y - from.y) / d } : { x: 1, y: 0 };
        const { terrain, board, units } = this.engine.state;
        const radius = Math.max(...sel.models.map((m) => m.baseRadius));
        const height = Math.max(...sel.models.map((m) => m.heightInches ?? 1.4));
        const clear = moveReachDistance(from, dir, remaining, radius, height, terrain, unitBlockers(units, sel.id), board);
        const reach = Math.min(d, clear);
        const reachPoint = { x: from.x + dir.x * reach, y: from.y + dir.y * reach };
        const blockedByWall = clear < Math.min(d, remaining) - 1e-3;
        this.scene.showPath(from, r.point, reachPoint, blockedByWall);
      } else {
        this.scene.showMeasurement(from, r.point, `${d.toFixed(1)}"`);
      }
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
    this.scene.setCoverIndicators({});
    this.scene.showReachField(null, []);
    this.scene.setHoverActive(false);
    this.scene.clearOverlays();
  }

  private doMove(u: UnitInstance, dest: Vec2): void {
    const from = unitCentroid(u);
    const reqDist = Math.hypot(dest.x - from.x, dest.y - from.y);
    if (reqDist < 1e-6) return;
    const dir = { x: (dest.x - from.x) / reqDist, y: (dest.y - from.y) / reqDist };
    // Raycast the straight path, capped at the REMAINING move budget (matching
    // the hover preview): the unit travels until a wall / too-low terrain / the
    // board edge or its budget runs out — clicking past range moves it to the
    // max reach rather than rejecting the whole move.
    const { terrain, board, units } = this.engine.state;
    const remaining = this.engine.remainingMove(u, this.moveMode);
    const radius = Math.max(...u.models.map((m) => m.baseRadius));
    const height = Math.max(...u.models.map((m) => m.heightInches ?? 1.4));
    // Same reach raycast that draws the ring (blocked by terrain AND other units).
    const clear = moveReachDistance(
      from,
      dir,
      Math.min(reqDist, remaining),
      radius,
      height,
      terrain,
      unitBlockers(units, u.id),
      board,
    );
    if (clear < 0.15) {
      this.toast(
        remaining < 0.15 ? `${u.name} has no movement left` : 'Blocked — a wall or obstacle is in the way',
        true,
      );
      sound.playEvent('error');
      return;
    }
    const dist = clear;
    const delta = { x: dir.x * dist, y: dir.y * dist };
    const ok = this.engine.moveUnit(u, this.moveMode, delta);
    if (!ok) {
      this.toast(this.engine.moveBlockReason(u, this.moveMode, delta) ?? 'Illegal move', true);
      sound.playEvent('error');
      return;
    }
    sound.playEvent('move');
    haptic();
    this.scene.clearOverlays();
    // Keep the unit selected while it still has movement left, so the player can
    // reposition in several steps and watch the remaining range shrink. Once the
    // budget is spent, deselect so the next unit is easy to pick.
    if (this.engine.remainingMove(u, this.moveMode) > 0.5) {
      this.toast(`${this.engine.remainingMove(u, this.moveMode).toFixed(1)}" of movement left`);
    } else {
      this.deselect();
    }
    this.refresh();
  }

  private selectForShooting(u: UnitInstance): void {
    this.selectedId = u.id;
    this.targets = this.engine
      .targetableEnemiesOf(this.engine.active) // excludes bodyguard-shielded leaders
      .filter((e) => this.engine.shootableWeapons(u, e).length > 0)
      .map((e) => e.id);
    this.scene.highlightUnit(u.id);
    this.scene.setTargets(this.targets);
    // Classify EVERY enemy's cover relative to this shooter and show a badge over
    // each: full (no line of sight — can't be hit), partial (visible but in
    // cover), or open. Lets the player read the firing solution at a glance.
    const cover: Record<string, 'none' | 'partial' | 'full'> = {};
    let inCover = 0;
    for (const e of this.engine.enemiesOf(this.engine.active)) {
      if (this.engine.isProtectedLeader(e)) continue;
      cover[e.id] = coverState(u, e, this.engine.state.terrain);
      if (cover[e.id] !== 'none') inCover += 1;
    }
    this.scene.setCoverIndicators(cover);
    this.refresh();
    if (this.targets.length === 0) this.toast('No targets in line of sight', true);
    else if (inCover > 0) this.toast(`${this.targets.length} target(s) · ${inCover} in cover`);
  }

  private async doShoot(attacker: UnitInstance, target: UnitInstance): Promise<void> {
    // Reactive defence before the shots land, so the opponent's turn has real
    // interaction: the AI auto-braces; a hotseat human gets a reaction window.
    if (this.aiPlayer && target.ownerId === this.aiPlayer) {
      const r = aiReactToShooting(this.engine, attacker, target);
      if (r.used) {
        this.toast(r.message ?? `${target.name} braces (Armour of Contempt)`, false);
        sound.playEvent('stratagem');
      }
    } else if (this.localPlayer === null && this.aiPlayer === null) {
      await this.offerHumanReaction(target.ownerId, 'shooting');
    }
    const before = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    const beforeModels = aliveModels(target).length;
    const results = this.engine.shoot(attacker, target);
    // Tracers fly while the dice tumble; impact + casualties reveal after. The
    // firing weapon's name/keywords pick the effect archetype (gauss beam,
    // plasma bolt, heavy shell, …) so each weapon reads distinctly.
    const rw = attacker.weapons.find((w) => w.kind === 'ranged') ?? attacker.weapons[0];
    this.scene.playShoot(attacker.id, target.id, {
      weapon: rw ? { name: rw.name, keywords: rw.keywords.map((k) => k.t) } : undefined,
    });
    sound.playEvent(shootSoundFor(attacker));
    haptic();
    await this.dice.rollResults(results, { title: `${attacker.name} shoots ${target.name}` });
    const after = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    if (before - after > 0) {
      this.scene.playImpact(target.id, Math.min(2, (before - after) / 3));
      this.scene.flashDamage(target.id, before - after);
      this.playDamageSounds(target, beforeModels, before - after);
    }
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

  private async doCharge(u: UnitInstance, target: UnitInstance): Promise<void> {
    // Reactive defence as the charge is declared: an AI defender may Fire
    // Overwatch automatically; a hotseat human gets a reaction window (Fire
    // Overwatch at the charger, etc.) before the charge move completes.
    if (this.aiPlayer && target.ownerId === this.aiPlayer) {
      const r = aiReactToCharge(this.engine, u);
      if (r.fired) {
        this.toast(r.message ?? `${target.name} fires Overwatch!`, false);
        sound.playEvent('stratagem');
        if (r.shooterId) this.scene.playShoot(r.shooterId, u.id, {});
        this.refresh();
      }
    } else if (this.localPlayer === null && this.aiPlayer === null) {
      await this.offerHumanReaction(target.ownerId, 'charge');
    }
    // If a reaction wiped the charging unit, there is nothing left to charge.
    if (!this.engine.isAlive(u)) {
      this.deselect();
      this.refresh();
      return;
    }
    const res = this.engine.charge(u, target);
    this.toast(`Charge roll: ${res.roll} — ${res.success ? 'success!' : 'failed'}`, !res.success);
    sound.playEvent(res.success ? 'charge' : 'ui_cancel');
    if (res.success) haptic([12, 20, 12]);
    this.deselect();
    this.refresh();
  }

  private selectForFight(u: UnitInstance): void {
    this.selectedId = u.id;
    this.targets = this.engine
      .targetableEnemiesOf(this.engine.active) // can't single out a shielded leader
      .filter((e) => inEngagementRange(u, e))
      .map((e) => e.id);
    this.scene.highlightUnit(u.id);
    this.scene.setTargets(this.targets);
    this.refresh();
    if (this.targets.length === 0) this.toast('Not in engagement range', true);
  }

  private async doFight(attacker: UnitInstance, target: UnitInstance): Promise<void> {
    if (!this.engine.canFight(attacker, target)) {
      this.toast('Cannot fight that unit', true);
      sound.playEvent('error');
      return;
    }
    const before = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    const beforeModels = aliveModels(target).length;
    const results = this.engine.fight(attacker, target);
    this.scene.playMelee(attacker.id, target.id);
    sound.playEvent('melee_swing');
    haptic([8, 16, 8]);
    await this.dice.rollResults(results, { title: `${attacker.name} fights ${target.name}` });
    const after = aliveModels(target).reduce((a, m) => a + m.wounds, 0);
    if (before - after > 0) {
      sound.playEvent('melee_hit');
      this.scene.playImpact(target.id, Math.min(2, (before - after) / 3));
      this.scene.flashDamage(target.id, before - after);
      this.playDamageSounds(target, beforeModels, before - after);
    } else {
      sound.playEvent('save_clang');
    }
    // Retaliation: the target strikes back if still able.
    if (this.engine.canFight(target, attacker)) {
      const tb = aliveModels(attacker).reduce((a, m) => a + m.wounds, 0);
      const tbModels = aliveModels(attacker).length;
      const retal = this.engine.fight(target, attacker);
      this.scene.playMelee(target.id, attacker.id);
      sound.playEvent('melee_swing');
      await this.dice.rollResults(retal, { title: `${target.name} strikes back` });
      const ta = aliveModels(attacker).reduce((a, m) => a + m.wounds, 0);
      if (tb - ta > 0) {
        sound.playEvent('melee_hit');
        this.scene.playImpact(attacker.id, Math.min(2, (tb - ta) / 3));
        this.scene.flashDamage(attacker.id, tb - ta);
        this.playDamageSounds(attacker, tbModels, tb - ta);
      }
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

  /**
   * Play impact/casualty audio: a wound thud, a death cry per model lost, and a
   * heavier knell if the whole unit was wiped out. `before` is the model count
   * prior to the attack; `woundsLost` the total wounds dealt.
   */
  private playDamageSounds(target: UnitInstance, beforeModels: number, woundsLost: number): void {
    if (woundsLost <= 0) return;
    const killed = beforeModels - aliveModels(target).length;
    if (!this.engine.isAlive(target)) {
      sound.playEvent('unit_destroyed');
    } else if (killed > 0) {
      sound.playEvent('model_death');
    } else {
      sound.playEvent('wound_thud');
    }
    haptic(killed > 0 ? [10, 30, 10] : 8);
  }

  // ---------------------------------------------------------------- misc
  private selected(): UnitInstance | undefined {
    return this.selectedId ? this.engine.state.units[this.selectedId] : undefined;
  }

  /**
   * Friendly units that can STILL take this phase's action — drives the "N can
   * still act" guidance and the end-phase reminder so the player never loses
   * track of their options or ends a phase by accident.
   */
  private actionableUnits(): UnitInstance[] {
    const me = this.engine.active;
    const mine = this.engine
      .unitsOf(me)
      .filter((u) => this.engine.isAlive(u) && !u.inReserves);
    switch (this.engine.state.phase) {
      case 'movement':
        return mine.filter(
          (u) => u.moveState !== 'remainedStationary' && this.engine.remainingMove(u, 'normal') > 0.5,
        );
      case 'shooting':
        return mine.filter((u) => this.engine.shootBlockReason(u) === null);
      case 'charge':
        return mine.filter((u) => this.engine.chargeBlockReason(u) === null);
      case 'fight':
        return mine.filter(
          (u) => !u.hasFought && this.engine.enemiesOf(me).some((e) => inEngagementRange(u, e)),
        );
      default:
        return [];
    }
  }

  /**
   * Draw the persistent radius around the selected unit: the walk range in
   * Movement (shrinks as it repositions), the max weapon range in Shooting, and
   * the 12" charge threat in Charge. Cleared when nothing is selected.
   */
  private updateSelectionRange(): void {
    const sel = this.selected();
    const phase = this.engine.state.phase;
    // Hover raycasting is only needed for the movement/charge path preview.
    this.scene.setHoverActive(
      !!sel && sel.ownerId === this.engine.active && (phase === 'movement' || phase === 'charge'),
    );
    if (!sel || sel.ownerId !== this.engine.active || !this.canLocalAct()) {
      this.scene.showReachField(null, []);
      return;
    }
    const c = unitCentroid(sel);
    const { terrain, board, units } = this.engine.state;
    const radius = Math.max(...sel.models.map((m) => m.baseRadius));
    const height = Math.max(...sel.models.map((m) => m.heightInches ?? 1.4));
    if (phase === 'movement' || phase === 'charge') {
      const max = phase === 'charge' ? 12 : this.engine.remainingMove(sel, this.moveMode);
      const rim = moveReachField(c, radius, height, max, terrain, unitBlockers(units, sel.id), board);
      this.scene.showReachField(c, rim, phase === 'charge' ? 0xff7a3c : 0x46ff8c);
    } else if (phase === 'shooting') {
      const ranges = sel.weapons.filter((w) => w.kind === 'ranged').map((w) => w.range);
      const max = ranges.length ? Math.max(...ranges) : 0;
      const rim = max > 0 ? shootReachField(c, max, terrain, board) : [];
      this.scene.showReachField(max > 0 ? c : null, rim, 0xffb038);
    } else {
      this.scene.showReachField(null, []);
    }
  }

  /** Verb describing the current phase's action, for guidance copy. */
  private phaseVerb(): string {
    return { movement: 'move', shooting: 'shoot', charge: 'charge', fight: 'fight' }[
      this.engine.state.phase as 'movement' | 'shooting' | 'charge' | 'fight'
    ] ?? 'act';
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

  /** Modal to import a publicly-available 3D model (URL or file) onto a unit. */
  private openModelImport(): void {
    const unit = this.selected() ?? this.engine.unitsOf(this.engine.active).find((u) => this.engine.isAlive(u));
    if (!unit) {
      this.toast('Select a unit to apply a model to', true);
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    backdrop.innerHTML = `
      <div class="modal">
        <h3>Import 3D model → ${unit.name}</h3>
        <p>Use models you have the rights to. Paste a public URL (glTF/GLB/OBJ/STL) or choose a file.</p>
        <input id="murl" type="text" placeholder="https://…/model.glb" style="width:100%;margin-bottom:8px;background:#0c1016;color:var(--ink);border:1px solid var(--edge);border-radius:8px;padding:9px;font-family:ui-monospace,monospace;font-size:12px;" />
        <input id="mfile" type="file" accept=".glb,.gltf,.obj,.stl" style="font-size:12px;margin-bottom:10px;" />
        <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);cursor:pointer;">
          <input id="mall" type="checkbox" checked /> Apply to all <b style="color:var(--ink);margin:0 3px;">${unit.name}</b> and remember it
        </label>
        <div class="warn" id="mwarn"></div>
        <div class="row">
          <button class="btn small" id="mCancel">Cancel</button>
          <button class="btn primary small" id="mGo">Apply</button>
        </div>
      </div>`;
    this.root.appendChild(backdrop);
    const url = backdrop.querySelector('#murl') as HTMLInputElement;
    const file = backdrop.querySelector('#mfile') as HTMLInputElement;
    const all = backdrop.querySelector('#mall') as HTMLInputElement;
    const warn = backdrop.querySelector('#mwarn') as HTMLElement;
    const close = () => backdrop.remove();
    (backdrop.querySelector('#mCancel') as HTMLElement).onclick = close;
    (backdrop.querySelector('#mGo') as HTMLElement).onclick = () => {
      const f = file.files?.[0];
      const raw = url.value.trim();
      const src: string | File | undefined = f ?? (raw || undefined);
      if (!src) {
        warn.textContent = 'Provide a URL or choose a file.';
        return;
      }
      const fmt: ModelFormat = formatFromName(f ? f.name : raw);
      const applyToAll = all.checked;
      warn.textContent = 'Loading…';
      // The set of units to update: just this one, or every unit of its type.
      const targets = applyToAll
        ? Object.values(this.engine.state.units).filter((u) => u.datasheetId === unit.datasheetId)
        : [unit];
      Promise.all(targets.map((u) => this.scene.importUnitModel(u.id, src, fmt)))
        .then(async () => {
          if (applyToAll) {
            // Persist so it auto-applies to this unit type in future battles.
            const persistSrc = f ? await fileToDataUrl(f).catch(() => '') : raw;
            const ok = persistSrc ? setAssignment(unit.datasheetId, { src: persistSrc, format: fmt }) : false;
            this.toast(
              ok
                ? `Saved for all ${unit.name}`
                : `Applied to all ${unit.name} (too large to remember between sessions)`,
            );
          } else {
            this.toast(`Model applied to ${unit.name}`);
          }
          close();
        })
        .catch((e: unknown) => {
          warn.textContent = `Failed to load model: ${e instanceof Error ? e.message : String(e)}`;
        });
    };
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };
  }

  /** Dev/demo hook: play a representative dice sequence through the real tray. */
  demoDice(): Promise<void> {
    return this.dice.roll(
      {
        hit: [5, 2, 6, 4, 1, 6, 3, 5, 2, 4],
        wound: [4, 6, 2, 5, 3, 1, 6],
        save: [2, 5, 1, 4, 6],
        damage: [1, 2, 1],
      },
      { hitTarget: 3, woundTarget: 4, saveTarget: 3, title: 'Bolt Rifle — 10 shots' },
    );
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

  /**
   * Compare objective control + total command points against the last refresh
   * and play the matching cue on change. Seeds silently on the first call.
   */
  private detectStateSounds(): void {
    const s = this.engine.state;
    const owners: Record<string, string> = {};
    let captured = false;
    for (const o of s.objectives) {
      const now = o.controlledBy ?? '';
      owners[o.id] = now;
      const prev = this.lastObjOwners[o.id];
      if (prev !== undefined && now && now !== prev) captured = true;
    }
    const seeded = this.lastTotalCp >= 0;
    const totalCp = s.players.A.commandPoints + s.players.B.commandPoints;
    if (seeded) {
      if (captured) sound.playEvent('objective_captured');
      if (totalCp > this.lastTotalCp) sound.playEvent('command_point');
    }
    this.lastObjOwners = owners;
    this.lastTotalCp = totalCp;
  }

  private victoryAnnounced = false;
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
    // Stinger once: defeat if the local player lost, otherwise the victory knell.
    if (!this.victoryAnnounced) {
      this.victoryAnnounced = true;
      const lost = this.localPlayer !== null && w !== 'draw' && w !== this.localPlayer;
      sound.playEvent(lost ? 'defeat' : 'victory');
      haptic(lost ? [40, 60, 40] : [20, 40, 20, 40, 20]);
    }
  }
}
