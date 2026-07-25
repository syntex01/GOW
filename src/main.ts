import Phaser from 'phaser'
import type { Difficulty } from './core/save'
import { session } from './core/session'
import { LEVELS_BY_ID, type GameMode } from './data/levels'
import BattleScene from './scenes/battleScene'
import BootScene from './scenes/bootScene'
import HUDScene from './scenes/hudScene'
import MenuScene from './scenes/menuScene'
import PreloadScene from './scenes/preloadScene'
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
    render: {
      antialias: true,
      roundPixels: false,
      powerPreference: 'high-performance'
    },
    // The battle simulation is hand-rolled, so no physics engine is needed.
    scene: [BootScene, PreloadScene, MenuScene, BattleScene, HUDScene, ResultScene],
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
  }
  debug.__gowGame = game
  debug.__gowStart = (mode, difficulty, levelId) => {
    const level = levelId ? LEVELS_BY_ID[levelId] : undefined
    session.start(level ? { mode, difficulty, level } : { mode, difficulty })
    game.scene.stop('HUDScene')
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
