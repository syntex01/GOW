import Phaser from 'phaser'
import { gameLog } from './core/log'
import type { Difficulty } from './core/save'
import { session } from './core/session'
import { LEVELS_BY_ID, type GameMode } from './data/levels'
import { morphedDef } from './data/morphs'
import type { UnitDef } from './data/types'
import { UNITS_BY_ID } from './data/units'
import { FACTION_UNITS } from './data/factions'
import BattleScene from './scenes/battleScene'
import BootScene from './scenes/bootScene'
import HUDScene from './scenes/hudScene'
import MenuScene from './scenes/menuScene'
import PreloadScene from './scenes/preloadScene'
import MultiplayerScene from './scenes/multiplayerScene'
import ResultScene from './scenes/resultScene'

const DESIGN_WIDTH = 1280
const DESIGN_HEIGHT = 720

function start(): void {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'phaser-game',
    backgroundColor: '#05070d',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT
    },
    // Real DOM elements are layered over the canvas so the multiplayer lobby
    // can offer genuine copy/paste text fields for connection codes.
    dom: { createContainer: true },
    // The world is authored as pixel art at half scale and shown at double, so
    // every texture must be sampled nearest-neighbour. `antialias: false` is
    // what keeps an upscaled sprite crisp instead of smeared; `pixelArt` sets
    // the same for every texture the game creates afterwards.
    pixelArt: true,
    render: {
      antialias: false,
      antialiasGL: false,
      roundPixels: true,
      powerPreference: 'high-performance'
    },
    // The battle simulation is hand-rolled, so no physics engine is needed.
    scene: [BootScene, PreloadScene, MenuScene, MultiplayerScene, BattleScene, HUDScene, ResultScene],
    input: {
      activePointers: 3
    },
    disableContextMenu: true
  }

  const game = new Phaser.Game(config)

  // Debug handle so the game can be inspected and driven from the console
  // or an automated smoke test.
  const debug = window as unknown as {
    __gowGame: Phaser.Game
    __gowStart: (mode: GameMode, difficulty: Difficulty, levelId?: string) => void
    __gowStartSeeded: (mode: GameMode, difficulty: Difficulty, seed: number) => void
    __gowUnits: typeof UNITS_BY_ID
    __gowFactionUnits: Record<string, UnitDef>
    __gowMorph: (unitId: string, techs: string[]) => UnitDef | null
    __gowLog: typeof gameLog
  }
  debug.__gowLog = gameLog
  debug.__gowGame = game
  // Exposed so a smoke test can put a unit on the field without waiting out a
  // build queue in real time.
  debug.__gowUnits = UNITS_BY_ID
  // The five paths' own soldiers, for tests that field them directly.
  debug.__gowFactionUnits = Object.fromEntries(FACTION_UNITS.map(u => [u.id, u]))
  // Lets a test ask "what does this unit become under these doctrines?" without
  // having to reach an age whose roster happens to contain it.
  debug.__gowMorph = (unitId, techs) => {
    const base = UNITS_BY_ID[unitId]
    return base ? morphedDef(base, new Set(techs)) : null
  }
  debug.__gowStartSeeded = (mode, difficulty, seed) => {
    session.start({ mode, difficulty, seed })
    for (const scene of game.scene.scenes) {
      if (scene.scene.isActive() && scene.scene.key !== 'BattleScene') scene.scene.stop()
    }
    game.scene.stop('BattleScene')
    game.scene.start('BattleScene')
  }
  debug.__gowStart = (mode, difficulty, levelId) => {
    const level = levelId ? LEVELS_BY_ID[levelId] : undefined
    session.start(level ? { mode, difficulty, level } : { mode, difficulty })
    for (const scene of game.scene.scenes) {
      if (scene.scene.isActive() && scene.scene.key !== 'BattleScene') scene.scene.stop()
    }
    game.scene.stop('BattleScene')
    game.scene.start('BattleScene')
  }

  // Hide the static HTML loading splash as soon as Phaser is live.
  const splash = document.getElementById('loading-screen')
  if (splash) {
    splash.classList.add('transparent')
    window.setTimeout(() => splash.remove(), 1000)
  }

  window.addEventListener('contextmenu', event => event.preventDefault())

  // Pause the simulation when the tab is hidden so returning is not a massacre.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.loop.sleep()
    else game.loop.wake()
  })
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
