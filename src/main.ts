import './ui/styles.css';
import { ThreeScene } from './render/ThreeScene';
import { GameEngine } from './engine/game';
import { GameUI } from './ui/HUD';
import { createGame, type ArmyList, type GameConfig } from './engine/factory';
import { DATASHEETS, FACTIONS, SAMPLE_ARMIES } from './engine/data/index';
import { importRosterText } from './import/rosterImport';
import { SAMPLE_ROSTERS } from './import/sampleRosters';
import { CORE_STRATAGEMS } from './engine/stratagems';
import type { PlayerId } from './engine/types';

/**
 * App shell: owns the renderer, the engine and the UI, and knows how to start a
 * fresh battle from two army lists (including ones imported from army-builder
 * text exports). Everything below the engine is faithful to the tabletop; this
 * layer is just orchestration.
 */
class App {
  private container = document.getElementById('app') as HTMLElement;
  private scene = new ThreeScene();
  private engine!: GameEngine;
  private ui!: GameUI;

  // Current army lists; either side can be swapped via import.
  private lists: Record<PlayerId, ArmyList> = {
    A: SAMPLE_ARMIES.necrons,
    B: SAMPLE_ARMIES.ultramarines,
  };

  start(): void {
    this.ui = new GameUI(this.scene, this.container, {
      onImportArmy: (p) => this.openImport(p),
      onNewBattle: () => this.newBattle(),
    });
    this.buildBattle();
    window.addEventListener('resize', () => this.scene.resize());
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
    this.engine = new GameEngine(state);
    this.scene.init(this.container, state);
    this.engine.startGame();
    this.ui.bind(this.engine);
    this.wireStratagems();
    this.scene.frameBoard();
  }

  private newBattle(): void {
    this.lists = { A: SAMPLE_ARMIES.necrons, B: SAMPLE_ARMIES.ultramarines };
    this.buildBattle();
  }

  /**
   * Feed the full core-stratagem list to the HUD panel. The HUD gates each entry
   * by the current phase and the active player's CP; activation spends CP and
   * applies the effect via the engine, using the player's current selection as
   * context (the chosen friendly unit, and a highlighted enemy as the target).
   */
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
    const sample =
      this.lists[player].faction.toLowerCase().includes('necron')
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
          'No units matched. Supported units right now: ' +
          Object.values(FACTIONS)
            .flatMap((f) => f.datasheetIds)
            .map((id) => DATASHEETS[id]?.name)
            .filter(Boolean)
            .join(', ');
        return;
      }
      // Keep the imported faction's name; fall back to a sensible default.
      this.lists[player] = {
        name: res.army.name || `Player ${player}`,
        faction: res.army.faction || this.lists[player].faction,
        entries: res.army.entries,
      };
      close();
      this.buildBattle();
      if (res.unmatched.length)
        console.warn('Unmatched roster units (skipped):', res.unmatched);
    };
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };
  }
}

new App().start();
