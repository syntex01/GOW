import './ui/styles.css';
import { ThreeScene } from './render/ThreeScene';
import { GameEngine } from './engine/game';
import { GameUI } from './ui/HUD';
import { Menu, showLoading, hideLoading, type StartConfig } from './ui/Menu';
import { createGame, type ArmyList, type GameConfig } from './engine/factory';
import { DATASHEETS, FACTIONS, SAMPLE_ARMIES } from './engine/data/index';
import { importRosterText } from './import/rosterImport';
import { SAMPLE_ROSTERS } from './import/sampleRosters';
import { CORE_STRATAGEMS } from './engine/stratagems';
import { NetController } from './net/NetController';
import { PeerTransport } from './net/PeerTransport';
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
  }

  private armyFor(faction: string): ArmyList {
    return (SAMPLE_ARMIES as Record<string, ArmyList>)[faction] ?? SAMPLE_ARMIES.necrons;
  }

  // ---------------------------------------------------------------- battle lifecycle
  private async beginBattle(cfg: StartConfig): Promise<void> {
    showLoading('Deploying forces…');
    this.teardown();
    this.lists = { A: this.armyFor(cfg.aFaction), B: this.armyFor(cfg.bFaction) };
    this.buildBattle();
    this.ui.setDiceSpeed(cfg.settings.diceSpeed);
    this.ui.setAi(cfg.mode === 'ai' ? cfg.settings.aiPlayer ?? 'B' : null);

    if (cfg.mode === 'online' && cfg.online) {
      this.setupOnline(cfg);
    } else {
      this.menu.hide();
      hideLoading();
    }
  }

  private teardown(): void {
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
    this.scene.frameBoard();
    if (import.meta.env.DEV) {
      const w = window as Window & { __demoDice?: () => void; __frameBiggest?: () => void };
      w.__demoDice = () => void this.ui.demoDice();
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
      if (st === 'connected') {
        this.menu.hide();
        hideLoading();
        // Host is authoritative: push the opening state to the guest.
        if (net.localPlayer === 'A') this.ui.refresh();
      }
    });
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
    const close = () => backdrop.remove();
    (backdrop.querySelector('#impCancel') as HTMLElement).onclick = close;
    (backdrop.querySelector('#impFill') as HTMLElement).onclick = () => (ta.value = sample);
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
