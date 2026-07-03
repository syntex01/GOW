import './ui/styles.css';
import { ThreeScene } from './render/ThreeScene';
import { GameEngine } from './engine/game';
import { GameUI } from './ui/HUD';
import { Menu, showLoading, hideLoading, type StartConfig } from './ui/Menu';
import { createGame, type ArmyList, type GameConfig } from './engine/factory';
import { DATASHEETS, FACTIONS, SAMPLE_ARMIES } from './engine/data/index';
import { importRosterText } from './import/rosterImport';
import { validateArmy, POINTS_LIMITS } from './engine/armyValidation';
import { SAMPLE_ROSTERS } from './import/sampleRosters';
import { CORE_STRATAGEMS } from './engine/stratagems';
import { NetController } from './net/NetController';
import { PeerTransport } from './net/PeerTransport';
import { loadAssignments } from './render/ModelAssignments';
import { Cinematic } from './ui/Cinematic';
import { TrailerCapture } from './ui/TrailerCapture';
import { sound } from './audio/SoundEngine';
import type { PlayerId } from './engine/types';

/**
 * App shell: owns the menu and, per battle, a fresh renderer + engine + UI.
 * The menu drives everything (faction select, mode, settings, online). Each
 * battle is torn down before the next so nothing leaks between games.
 */
class App {
  private container = document.getElementById('app') as HTMLElement;
  private gameRoot = document.createElement('div');
  private menu!: Menu;
  private scene: ThreeScene | null = null;
  private engine!: GameEngine;
  private ui!: GameUI;
  private net: NetController | null = null;
  private netHeartbeat: number | null = null;
  /** The mode of the current battle, so custom models can be kept LOCAL-only. */
  private currentMode: StartConfig['mode'] = 'hotseat';
  private lists: Record<PlayerId, ArmyList> = {
    A: SAMPLE_ARMIES.necrons,
    B: SAMPLE_ARMIES.ultramarines,
  };

  start(): void {
    this.gameRoot.style.cssText = 'position:absolute;inset:0;';
    this.container.appendChild(this.gameRoot);
    this.menu = new Menu(this.container);
    this.menu.onStart((cfg) => this.beginBattle(cfg));
    window.addEventListener('resize', () => this.scene?.resize());

    // Unlock the audio context on the first user gesture (browsers require it).
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private armyFor(faction: string): ArmyList {
    return (SAMPLE_ARMIES as Record<string, ArmyList>)[faction] ?? SAMPLE_ARMIES.necrons;
  }

  // ---------------------------------------------------------------- battle lifecycle
  private async beginBattle(cfg: StartConfig): Promise<void> {
    showLoading('Deploying forces…');
    this.teardown();
    this.currentMode = cfg.mode;
    // Prefer the army forged in the menu builder; fall back to the faction sample.
    this.lists = {
      A: cfg.aArmy && cfg.aArmy.entries.length ? cfg.aArmy : this.armyFor(cfg.aFaction),
      B: cfg.bArmy && cfg.bArmy.entries.length ? cfg.bArmy : this.armyFor(cfg.bFaction),
    };
    this.buildBattle();
    this.ui.setDiceSpeed(cfg.settings.diceSpeed);
    this.ui.setAi(cfg.mode === 'ai' ? cfg.settings.aiPlayer ?? 'B' : null);

    if (cfg.mode === 'online' && cfg.online) {
      this.setupOnline(cfg);
    } else {
      this.menu.hide();
      hideLoading();
      sound.startMusic();
    }
  }

  private teardown(): void {
    if (this.netHeartbeat !== null) {
      clearInterval(this.netHeartbeat);
      this.netHeartbeat = null;
    }
    this.net?.close();
    this.net = null;
    this.scene?.dispose();
    this.scene = null;
    this.gameRoot.innerHTML = '';
  }

  private buildBattle(): void {
    const config: GameConfig = {
      seed: (Date.now() & 0xffffff) || 12345,
      players: {
        A: { name: this.lists.A.name, faction: this.lists.A.faction },
        B: { name: this.lists.B.name, faction: this.lists.B.faction },
      },
    };
    const state = createGame(config, DATASHEETS, this.lists.A, this.lists.B);
    this.scene = new ThreeScene();
    this.engine = new GameEngine(state);
    this.scene.init(this.gameRoot, state);
    this.engine.startGame();
    this.ui = new GameUI(this.scene, this.gameRoot, {
      onImportArmy: (p) => this.openImport(p),
      onNewBattle: () => this.menu.show(),
    });
    this.ui.bind(this.engine);
    this.wireStratagems();
    this.applyModelAssignments();
    this.scene.frameBoard();
    if (import.meta.env.DEV) {
      const w = window as Window & { __demoDice?: () => void; __frameBiggest?: () => void; __demoDeaths?: () => void };
      w.__demoDice = () => void this.ui.demoDice();
      // Kill one model in every on-board unit to preview the death animations.
      (w as unknown as { __demoDeaths?: () => void }).__demoDeaths = () => {
        for (const u of Object.values(this.engine.state.units)) {
          const alive = u.models.filter((m) => m.alive);
          if (alive.length > 1) { alive[0].alive = false; alive[0].wounds = 0; }
        }
        this.ui.refresh();
      };
      // Frame the squad with the most models (for showing off the figures).
      w.__frameBiggest = () => {
        const units = Object.values(this.engine.state.units).filter((u) =>
          u.models.some((m) => m.alive) && !u.inReserves,
        );
        let best = units[0];
        for (const u of units) {
          if (u.models.filter((m) => m.alive).length > best.models.filter((m) => m.alive).length) best = u;
        }
        if (!best) return;
        const alive = best.models.filter((m) => m.alive);
        const cx = alive.reduce((a, m) => a + m.position.x, 0) / alive.length;
        const cy = alive.reduce((a, m) => a + m.position.y, 0) / alive.length;
        this.scene!.frameUnit({ x: cx, y: cy }, 9);
      };
      // Import 10 DIFFERENT real models onto 10 units, lined up for a showcase.
      (w as unknown as { __showcaseRow?: () => void }).__showcaseRow = () => {
        const urls = [
          'models/marine.glb', 'models/necron.glb',
          'models/showcase/riggedfigure.glb', 'models/showcase/cesiumman.glb',
          'models/showcase/brainstem.glb', 'models/showcase/fox.glb',
          'models/showcase/horse.glb', 'models/showcase/stork.glb',
          'models/showcase/parrot.glb', 'models/showcase/flamingo.glb',
        ];
        const units = Object.values(this.engine.state.units)
          .filter((u) => u.models.some((m) => m.alive))
          .slice(0, urls.length);
        const b = this.engine.state.board;
        const y = b.height / 2;
        units.forEach((u, i) => {
          const x = b.width / 2 + (i - (units.length - 1) / 2) * 5;
          for (const m of u.models) { m.alive = true; m.position = { x, y }; }
          u.inReserves = false;
          void this.scene!.importUnitModel(u.id, urls[i], 'glb', 3.6);
        });
        this.scene!.frameUnit({ x: b.width / 2, y }, 28);
        const resync = () => this.ui.refresh();
        resync();
        for (const t of [800, 1800, 3000, 4500]) window.setTimeout(resync, t);
      };
      // Play the AI-vs-AI cinematic trailer (used by the recording script).
      (w as unknown as { __trailer?: () => Promise<void> }).__trailer = () =>
        new Cinematic(this.engine, this.scene!, this.gameRoot).run();
      // Deterministic frame-stepped capture (smooth video on any GPU). The
      // recorder calls __capInit() once, then __capStep(dtMs) per output frame,
      // screenshotting between calls; __capStep returns true when finished.
      let cap: TrailerCapture | null = null;
      (w as unknown as { __capInit?: () => void }).__capInit = () => {
        cap = new TrailerCapture(this.engine, this.scene!, this.gameRoot);
      };
      (w as unknown as { __capStep?: (dtMs: number) => boolean }).__capStep = (dtMs: number) => {
        if (!cap) return true;
        cap.step(dtMs / 1000);
        if (cap.done) {
          cap.cleanup();
          cap = null;
          return true;
        }
        return false;
      };
    }
  }

  /**
   * Apply persisted per-datasheet model assignments to the deployed units —
   * but ONLY in LOCAL play (hotseat / vs-AI). In online play we deliberately
   * keep everyone on the shipped, licence-clean models: your own imported models
   * are never transmitted, never shown to a peer, and never baked into a shared
   * session. This keeps custom (possibly grey-area) models to your own machine.
   */
  private applyModelAssignments(): void {
    if (this.currentMode === 'online') return; // custom models are local-only
    const assignments = loadAssignments();
    if (Object.keys(assignments).length === 0) return;
    for (const u of Object.values(this.engine.state.units)) {
      const a = assignments[u.datasheetId];
      if (a) void this.scene!.importUnitModel(u.id, a.src, a.format, a.heightInches ?? 3.6);
    }
  }

  // ---------------------------------------------------------------- online
  private setupOnline(cfg: StartConfig): void {
    const action = cfg.online!.action;
    const transport = new PeerTransport(action === 'host' ? 'host' : 'guest', cfg.online!.code);
    const net = new NetController(transport);
    this.net = net;
    this.ui.setOnline(net.localPlayer, (s) => net.broadcastState(s));
    net.onRemoteState((s) => this.ui.applyRemoteState(s));
    // When the peer asks for a snapshot (on join, or to recover a dropped one),
    // answer with our current authoritative state.
    net.onSyncRequest(() => this.ui.pushState());
    net.onStatus((st) => {
      this.menu.setOnlineStatus(
        st === 'connected'
          ? 'Connected — battle on!'
          : st === 'connecting'
            ? 'Connecting…'
            : st === 'error'
              ? 'Connection failed. Check the code and try again.'
              : 'Disconnected.',
      );
      // On failure/disconnect, drop the loading overlay so the player isn't stuck
      // on "Deploying forces…" — the menu stays up with the error so they can retry.
      if (st === 'error' || st === 'disconnected') hideLoading();
      if (st === 'connected') {
        this.menu.hide();
        hideLoading();
        sound.startMusic();
        // Host is authoritative: push the opening state to the guest. The guest
        // also explicitly asks for it, so the initial sync can't be lost to a
        // handshake race (host's first push arriving before the guest is ready).
        if (net.localPlayer === 'A') this.ui.pushState();
        else net.requestSync();
      }
    });
    // Heartbeat: whoever's turn it is re-broadcasts state every ~1.5s. This
    // self-heals any dropped snapshot, so the opponent always converges on the
    // latest board and reliably sees every move / the turn passing to them.
    this.netHeartbeat = window.setInterval(() => {
      if (net.status === 'connected' && this.ui.isLocalTurn()) this.ui.pushState();
    }, 1500);
    if (action === 'host') this.menu.setRoomCode(transport.roomCode);
    this.menu.setOnlineStatus('Connecting…');
    void net.connect();
  }

  // ---------------------------------------------------------------- stratagems
  private wireStratagems(): void {
    const entries = CORE_STRATAGEMS.map((s) => ({
      id: s.id,
      name: s.name,
      cost: s.cost,
      phase: s.phase,
      when: s.when,
      detail: s.detail,
    }));
    this.ui.setStratagems(entries, (id) => {
      const res = this.engine.activateStratagem(id, this.ui.currentSelection());
      this.ui.notify(res.message, !res.ok);
      this.ui.refresh();
    });
  }

  // ---------------------------------------------------------------- import UI
  private openImport(player: PlayerId): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    const sample = this.lists[player].faction.toLowerCase().includes('necron')
      ? SAMPLE_ROSTERS.necrons
      : SAMPLE_ROSTERS.ultramarines;
    backdrop.innerHTML = `
      <div class="modal">
        <h3>Import army for Player ${player}</h3>
        <p>Paste an army-list text export (Warhammer app, New Recruit, or BattleScribe). Unmatched units are skipped.</p>
        <textarea id="rosterText" placeholder="+++ My Army (1000 Points) +++&#10;Faction: Necrons&#10;...">${sample}</textarea>
        <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);margin:6px 0;">
          Points limit
          <select id="ptsLimit" style="background:#0c1016;color:var(--ink);border:1px solid var(--edge);border-radius:6px;padding:4px 6px;font-size:12px;">
            ${POINTS_LIMITS.map((p) => `<option value="${p}"${p === 1000 ? ' selected' : ''}>${p}</option>`).join('')}
          </select>
        </label>
        <div class="legality" id="legality" style="font-size:12px;margin:4px 0;"></div>
        <div class="warn" id="importWarn"></div>
        <div class="row">
          <button class="btn small" id="impCancel">Cancel</button>
          <button class="btn small" id="impFill">Load sample</button>
          <button class="btn primary small" id="impGo">Import &amp; deploy</button>
        </div>
      </div>`;
    this.container.appendChild(backdrop);

    const ta = backdrop.querySelector('#rosterText') as HTMLTextAreaElement;
    const warn = backdrop.querySelector('#importWarn') as HTMLElement;
    const legality = backdrop.querySelector('#legality') as HTMLElement;
    const limitSel = backdrop.querySelector('#ptsLimit') as HTMLSelectElement;
    const close = () => backdrop.remove();

    // Live legality check: parse the pasted list and validate points + structure.
    const recheck = (): void => {
      const parsed = importRosterText(ta.value, { nameToId: undefined });
      if (parsed.army.entries.length === 0) {
        legality.innerHTML = '';
        return;
      }
      const v = validateArmy(parsed.army, DATASHEETS, { pointsLimit: Number(limitSel.value) });
      const badge = v.legal
        ? `<b style="color:#5fd38a">✓ Legal</b>`
        : `<b style="color:#ff7a7a">✗ Illegal</b>`;
      const lines = [
        `${badge} — <b>${v.points}</b> / ${v.limit} pts`,
        ...v.issues.map((i) => `<span style="color:#ff9a9a">• ${i}</span>`),
        ...v.warnings.map((w) => `<span style="color:#e8c05a">• ${w}</span>`),
      ];
      legality.innerHTML = lines.join('<br>');
    };
    ta.oninput = recheck;
    limitSel.onchange = recheck;
    recheck();

    (backdrop.querySelector('#impCancel') as HTMLElement).onclick = close;
    (backdrop.querySelector('#impFill') as HTMLElement).onclick = () => {
      ta.value = sample;
      recheck();
    };
    (backdrop.querySelector('#impGo') as HTMLElement).onclick = () => {
      const res = importRosterText(ta.value, { nameToId: undefined });
      if (res.army.entries.length === 0) {
        warn.textContent =
          'No units matched. Supported units: ' +
          Object.values(FACTIONS)
            .flatMap((f) => f.datasheetIds)
            .map((id) => DATASHEETS[id]?.name)
            .filter(Boolean)
            .join(', ');
        return;
      }
      this.lists[player] = {
        name: res.army.name || `Player ${player}`,
        faction: res.army.faction || this.lists[player].faction,
        entries: res.army.entries,
      };
      close();
      this.buildBattle();
      if (res.unmatched.length) console.warn('Unmatched roster units (skipped):', res.unmatched);
    };
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };
  }
}

new App().start();

// Offline support / instant repeat loads — production only, so dev & tests are
// never served stale assets. Safe to fail silently.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
