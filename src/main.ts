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
import { COMMUNITY_MODEL_BY_DATASHEET } from './render/CommunityModelPack';
import { encodeTtsModel } from './render/TtsImport';
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
  /** True once a battle's renderer + engine + UI are built and wired. Online
   *  handlers guard on this because the HOST defers building the shared game
   *  until the guest hands over its army. */
  private uiReady = false;
  // Reconnect state (auto-recover a transient online drop without a new room).
  private onlineCfg: StartConfig | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  /** Set while WE deliberately tear the connection down (new battle / re-dial),
   *  so the resulting 'disconnected' status does not schedule a reconnect. */
  private endingOnline = false;
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
    // Prefer the army forged in the menu builder; fall back to the faction sample.
    this.lists = {
      A: cfg.aArmy && cfg.aArmy.entries.length ? cfg.aArmy : this.armyFor(cfg.aFaction),
      B: cfg.bArmy && cfg.bArmy.entries.length ? cfg.bArmy : this.armyFor(cfg.bFaction),
    };
    const online = cfg.mode === 'online' && cfg.online ? cfg.online : null;

    // Online HOST: defer building the shared game until the guest hands over its
    // army (so the guest fields the army it configured, not a host default). The
    // host waits on the room-code screen (no board yet), so drop the spinner.
    if (online?.action === 'host') {
      this.setupOnline(cfg);
      hideLoading();
      return;
    }

    this.buildBattle();
    this.ui.setDiceSpeed(cfg.settings.diceSpeed);
    this.ui.setAi(cfg.mode === 'ai' ? cfg.settings.aiPlayer ?? 'B' : null);

    if (online) {
      this.setupOnline(cfg); // guest — game already built provisionally
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
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Abandon any online session: this close is intentional, not a drop.
    this.endingOnline = true;
    this.onlineCfg = null;
    this.reconnectAttempts = 0;
    this.net?.close();
    this.net = null;
    this.uiReady = false;
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
    this.uiReady = true;
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

  /** Apply player overrides, otherwise the private community TTS model pack. */
  private applyModelAssignments(): void {
    const assignments = loadAssignments();
    for (const u of Object.values(this.engine.state.units)) {
      const a = assignments[u.datasheetId];
      const height = u.proxy?.heightInches ?? 3;
      if (a) {
        void this.scene!.importUnitModel(u.id, a.src, a.format, a.heightInches ?? height);
        continue;
      }
      const community = COMMUNITY_MODEL_BY_DATASHEET.get(u.datasheetId);
      if (!community) continue;
      void this.scene!
        .importUnitModel(u.id, encodeTtsModel(community.asset), 'tts', height)
        .catch((error: unknown) => {
          // A stale community CDN link should leave the bundled fallback alive,
          // never prevent a battle from starting.
          console.warn(`Community model failed: ${community.datasheetName}`, error);
        });
    }
  }

  // ---------------------------------------------------------------- online
  private setupOnline(cfg: StartConfig): void {
    const action = cfg.online!.action;
    // Re-entry (a reconnect attempt): tear down the previous heartbeat/net first
    // WITHOUT letting that intentional close schedule another reconnect.
    if (this.netHeartbeat !== null) {
      clearInterval(this.netHeartbeat);
      this.netHeartbeat = null;
    }
    if (this.net) {
      this.endingOnline = true;
      this.net.close();
      this.net = null;
    }
    this.onlineCfg = cfg;
    this.endingOnline = false;

    const transport = new PeerTransport(action === 'host' ? 'host' : 'guest', cfg.online!.code);
    const net = new NetController(transport);
    this.net = net;

    const reactionHooks = {
      sendWindow: (kind: 'shooting' | 'charge', a: string, t: string) => net.sendReactionWindow(kind, a, t),
      sendReaction: (stratId: string, u?: string, tu?: string) => net.sendReaction(stratId, u, tu),
    };

    // The guest's provisional game already exists (built in beginBattle); wire it
    // to the net now. The host has NO game yet — it is built once the guest's
    // army arrives (onJoin), and only then is its UI wired to the net.
    if (this.uiReady) this.ui.setOnline(net.localPlayer, (s) => net.broadcastState(s), reactionHooks);

    net.onRemoteState((s) => { if (this.uiReady) this.ui.applyRemoteState(s); });
    net.onReactionWindow((m) => { if (this.uiReady) this.ui.onRemoteReactionWindow(m); });
    net.onReaction((m) => { if (this.uiReady) this.ui.onRemoteReaction(m); });
    // Answer a peer's resync UNCONDITIONALLY (whoever is asked holds the latest
    // committed state); this is what heals a lost turn-handoff snapshot.
    net.onSyncRequest(() => { if (this.uiReady) this.ui.answerSync(); });

    // Host only: the guest hands over its army; NOW we can build the shared game
    // with the army the guest actually configured, then push the opening state.
    net.onJoin((join) => {
      if (action !== 'host') return;
      const guestArmy = join.army as ArmyList | undefined;
      if (guestArmy && guestArmy.entries.length) this.lists.B = guestArmy;
      if (!this.uiReady) {
        this.buildBattle();
        this.ui.setDiceSpeed(cfg.settings.diceSpeed);
        this.ui.setAi(null);
        this.ui.setOnline(net.localPlayer, (s) => net.broadcastState(s), reactionHooks);
        this.menu.hide();
        hideLoading();
        sound.startMusic();
      }
      // Opening snapshot now carries the guest's real army as player B.
      this.ui.pushState();
    });

    net.onStatus((st) => {
      this.menu.setOnlineStatus(
        st === 'connected'
          ? action === 'host'
            ? 'Opponent connected — awaiting their army…'
            : 'Connected — battle on!'
          : st === 'connecting'
            ? 'Connecting…'
            : st === 'error'
              ? 'Connection failed. Check the code and try again.'
              : 'Disconnected.',
      );
      if (st === 'error' || st === 'disconnected') hideLoading();
      if (st === 'connected') {
        // Recovered (or first connect): clear any reconnect state/notice.
        this.reconnectAttempts = 0;
        if (this.uiReady) this.ui.setNetNotice(null);
        if (action === 'join') {
          // Guest: hand our chosen army to the host, then wait for the opening
          // snapshot it builds. (requestSync also recovers a host already in-game
          // after we reconnect — it re-answers with the current state.)
          this.menu.hide();
          hideLoading();
          sound.startMusic();
          const mine = cfg.bArmy && cfg.bArmy.entries.length ? cfg.bArmy : this.lists.B;
          net.sendJoin(mine, mine.faction, mine.name);
          net.requestSync();
        }
      }
      // An UNINTENDED drop mid-game: try to recover the same session (the full
      // snapshot resync on reconnect restores state with no divergence).
      if ((st === 'disconnected' || st === 'error') && this.uiReady && !this.endingOnline) {
        this.scheduleReconnect();
      }
    });

    // Heartbeat: the active player re-broadcasts state every ~1.5s (self-heals a
    // dropped in-turn snapshot). The waiting player can't be healed this way for
    // a lost turn-HANDOFF (neither side would then be broadcasting), so it also
    // periodically asks the peer to resync — which the peer answers
    // unconditionally, delivering the handoff it missed.
    let hbTick = 0;
    this.netHeartbeat = window.setInterval(() => {
      if (!this.uiReady || net.status !== 'connected') return;
      if (this.ui.isLocalTurn()) {
        hbTick = 0;
        this.ui.pushState();
      } else if ((hbTick = (hbTick + 1) % 3) === 0) {
        net.requestSync();
      }
    }, 1500);
    if (action === 'host') this.menu.setRoomCode(transport.roomCode);
    this.menu.setOnlineStatus('Connecting…');
    void net.connect();
  }

  /**
   * Recover a dropped online session by re-opening the transport with backoff
   * (2s, 4s, 8s, … capped) — up to a few attempts — reusing the same room. The
   * game/engine/UI stay intact; on reconnection a full-snapshot resync restores
   * state with no divergence. Cancelled by teardown (starting a new battle).
   */
  private scheduleReconnect(): void {
    if (!this.onlineCfg || this.endingOnline || this.reconnectTimer !== null) return;
    const MAX_ATTEMPTS = 6;
    if (this.reconnectAttempts >= MAX_ATTEMPTS) {
      if (this.uiReady) this.ui.setNetNotice('Connection lost — could not reconnect. Start a new battle.');
      return;
    }
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(16000, 1000 * 2 ** attempt);
    if (this.uiReady) this.ui.setNetNotice(`Connection lost — reconnecting (attempt ${attempt})…`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.endingOnline || !this.onlineCfg) return;
      this.setupOnline(this.onlineCfg); // fresh transport; game + UI stay intact
    }, delay);
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
