import { gameEvents, GameEvents } from '../state/events'
import { gameState, MatchSnapshot } from '../state/gameState'

interface LaneMarker {
  rect: Phaser.GameObjects.Rectangle
  index: number
}

export default class BattleScene extends Phaser.Scene {
  private laneMarkers: LaneMarker[] = []
  private resourceTimer?: Phaser.Time.TimerEvent
  private snapshot: MatchSnapshot = gameState.getMatchSnapshot()

  constructor() {
    super({
      key: 'BattleScene'
    })
  }

  create() {
    this.cameras.main.setBackgroundColor('#071522')

    this.drawBattlefield()
    this.scene.launch('HUDScene', { parentScene: this.scene.key })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)
    this.setupInput()

    this.resourceTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: this.simulateResourceTick,
      callbackScope: this
    })

    this.emitHudUpdate()
  }

  private setupInput() {
    this.input.keyboard.on('keydown-ESC', () => this.returnToMenu())
    this.input.keyboard.on('keydown-Q', () => this.applyDamageToEnemyBase(5))
    this.input.keyboard.on('keydown-W', () => this.applyDamageToPlayerBase(5))
  }

  private drawBattlefield() {
    const { width, height } = this.cameras.main
    const laneHeight = height / 4

    for (let i = 0; i < 3; i += 1) {
      const laneY = laneHeight * (i + 1)
      const rect = this.add.rectangle(width / 2, laneY, width - 100, laneHeight - 30, 0x12304b, 0.35)
      rect.setStrokeStyle(2, 0x2a6f97, 0.8)
      this.laneMarkers.push({ rect, index: i })
    }

    const leftBase = this.add.rectangle(80, height / 2, 120, 240, 0x2c8d4c)
    const rightBase = this.add.rectangle(width - 80, height / 2, 120, 240, 0x8d2c2c)
    leftBase.setStrokeStyle(4, 0x56da7c)
    rightBase.setStrokeStyle(4, 0xf87171)

    const leftLabel = this.add.text(leftBase.x, leftBase.y, 'PLAYER
BASE', {
      fontFamily: 'Arial Black',
      fontSize: '20px',
      color: '#ffffff',
      align: 'center'
    })
    leftLabel.setOrigin(0.5)

    const rightLabel = this.add.text(rightBase.x, rightBase.y, 'ENEMY
BASE', {
      fontFamily: 'Arial Black',
      fontSize: '20px',
      color: '#ffffff',
      align: 'center'
    })
    rightLabel.setOrigin(0.5)
  }

  private simulateResourceTick() {
    const income = this.calculateIncome()
    this.snapshot.playerResources += income.player
    this.snapshot.enemyResources += income.enemy

    this.emitHudUpdate()
  }

  private calculateIncome() {
    const settings = gameState.getSettings()
    const baseIncome = 8
    const difficultyModifier = settings.difficulty === 'easy' ? 0.8 : settings.difficulty === 'hard' ? 1.2 : 1
    return {
      player: Math.round(baseIncome * (settings.fastForward ? 1.5 : 1)),
      enemy: Math.round(baseIncome * difficultyModifier)
    }
  }

  private applyDamageToEnemyBase(amount: number) {
    this.snapshot.enemyBaseHp = Math.max(this.snapshot.enemyBaseHp - amount, 0)
    if (this.snapshot.enemyBaseHp === 0) {
      this.concludeMatch('Victory!')
    }
    this.emitHudUpdate()
  }

  private applyDamageToPlayerBase(amount: number) {
    this.snapshot.playerBaseHp = Math.max(this.snapshot.playerBaseHp - amount, 0)
    if (this.snapshot.playerBaseHp === 0) {
      this.concludeMatch('Defeat…')
    }
    this.emitHudUpdate()
  }

  private emitHudUpdate() {
    gameState.setMatchSnapshot(this.snapshot)
    gameEvents.emit(GameEvents.HUD_UPDATE, {
      snapshot: { ...this.snapshot },
      settings: gameState.getSettings()
    })
  }

  private concludeMatch(result: string) {
    if (this.resourceTimer) {
      this.resourceTimer.destroy()
      this.resourceTimer = undefined
    }

    gameEvents.emit(GameEvents.MATCH_ENDED, { result, snapshot: { ...this.snapshot } })
    this.time.delayedCall(1800, () => this.returnToMenu())
  }

  private returnToMenu() {
    this.scene.stop('HUDScene')
    this.scene.start('MenuScene')
  }

  private cleanup() {
    this.input.keyboard.removeListener('keydown-ESC')
    this.input.keyboard.removeListener('keydown-Q')
    this.input.keyboard.removeListener('keydown-W')
    if (this.resourceTimer) {
      this.resourceTimer.destroy()
      this.resourceTimer = undefined
    }
  }
}
