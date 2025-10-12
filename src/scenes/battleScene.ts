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

    this.buildBattlefield()
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

    this.enemySpawnTimer = this.time.addEvent({
      delay: 2200,
      loop: true,
      callback: this.spawnEnemyWave,
      callbackScope: this
    })

    this.emitHudUpdate()
  }

  update(_: number, delta: number) {
    this.laneManager?.update(delta)
  }

  private setupInput() {
    this.input.keyboard.on('keydown-ESC', () => this.returnToMenu())
    this.input.keyboard.on('keydown-ONE', () => this.handlePlayerSpawn(0))
    this.input.keyboard.on('keydown-TWO', () => this.handlePlayerSpawn(1))
    this.input.keyboard.on('keydown-THREE', () => this.handlePlayerSpawn(2))

    this.pointerHandler = pointer => {
      if (!this.laneManager) {
        return
      }
      const safeZoneBottom = this.cameras.main.height - 120
      if (pointer.y > safeZoneBottom) {
        return
      }
      const laneIndex = this.laneManager.getLaneIndexAt(pointer.y)
      if (laneIndex >= 0) {
        this.handlePlayerSpawn(laneIndex)
      }
    }

    this.input.on(Phaser.Input.Events.POINTER_UP, this.pointerHandler)
  }

  private buildBattlefield() {
    const { width, height, centerX } = this.cameras.main

    this.unitButtons = []

    this.playerBase = new Base({
      scene: this,
      side: 'player',
      x: 90,
      y: height / 2,
      width: 120,
      height: 240,
      maxHp: this.snapshot.playerBaseHp,
      label: 'PLAYER\nBASE',
      fillColor: 0x2563eb,
      strokeColor: 0x60a5fa
    })

    this.enemyBase = new Base({
      scene: this,
      side: 'enemy',
      x: width - 90,
      y: height / 2,
      width: 120,
      height: 240,
      maxHp: this.snapshot.enemyBaseHp,
      label: 'ENEMY\nBASE',
      fillColor: 0xb91c1c,
      strokeColor: 0xf87171
    })

    const battlefield = new Phaser.Geom.Rectangle(0, 0, width, height)

    this.laneManager = new LaneManager({
      scene: this,
      battlefieldBounds: battlefield,
      laneCount: this.laneCount,
      playerBase: this.playerBase,
      enemyBase: this.enemyBase,
      callbacks: {
        onUnitKilled: this.handleUnitKilled,
        onBaseDamaged: this.handleBaseDamaged
      }
    })

    this.tapHint = this.add
      .text(centerX, 32, HINT_MESSAGE, {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#e2e8f0'
      })
      .setOrigin(0.5, 0)

    this.createUnitButtons()
  }

  private createUnitButtons() {
    const keys: BlueprintKey[] = ['infantry', 'tank', 'scout']
    const baseY = this.cameras.main.height - 80
    const spacing = 200
    const startX = this.cameras.main.centerX - spacing

    keys.forEach((key, index) => {
      const blueprint = UNIT_BLUEPRINTS[key]
      const button = this.add
        .text(startX + spacing * index, baseY, `${blueprint.label}\n${blueprint.cost} energy`, {
          fontFamily: 'Arial Black',
          fontSize: '20px',
          color: '#f8fafc',
          align: 'center',
          backgroundColor: 'rgba(30, 41, 59, 0.85)',
          padding: { x: 18, y: 14 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })

      button.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, pointer => {
        pointer.event?.stopPropagation?.()
        this.selectBlueprint(key)
      })

      this.unitButtons.push(button)
    })

    this.selectBlueprint(this.selectedBlueprint)
  }

  private selectBlueprint(key: BlueprintKey) {
    this.selectedBlueprint = key
    this.unitButtons.forEach(button => {
      const isSelected = button.text.startsWith(UNIT_BLUEPRINTS[key].label)
      button.setStyle({
        backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.85)' : 'rgba(30, 41, 59, 0.85)',
        color: isSelected ? '#0f172a' : '#f8fafc'
      })
      button.setAlpha(isSelected ? 1 : 0.85)
    })
  }

  private handlePlayerSpawn(laneIndex: number) {
    this.trySpawnUnit('player', laneIndex, this.selectedBlueprint)
  }

  private spawnEnemyWave() {
    const laneIndex = Phaser.Math.Between(0, this.laneCount - 1)
    const choices: BlueprintKey[] = ['infantry', 'scout']
    const blueprint = Phaser.Utils.Array.GetRandom(choices)
    this.trySpawnUnit('enemy', laneIndex, blueprint)
  }

  private trySpawnUnit(faction: UnitFaction, laneIndex: number, key: BlueprintKey) {
    const blueprint = UNIT_BLUEPRINTS[key]
    const cost = blueprint.cost

    if (faction === 'player') {
      if (this.snapshot.playerResources < cost) {
        this.flashInsufficientResources()
        return
      }
      this.snapshot.playerResources -= cost
    } else {
      if (this.snapshot.enemyResources < cost) {
        return
      }
      this.snapshot.enemyResources -= cost
    }

    this.laneManager?.spawnUnit(faction, laneIndex, blueprint)
    this.emitHudUpdate()
  }

  private flashInsufficientResources() {
    if (!this.tapHint) {
      return
    }
    this.tapHint.setText('Not enough energy! Wait for income or try a cheaper unit.')
    this.time.delayedCall(1100, () => {
      if (this.tapHint) {
        this.tapHint.setText(HINT_MESSAGE)
      }
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

  private handleUnitKilled = (faction: UnitFaction) => {
    const bounty = 8
    if (faction === 'enemy') {
      this.snapshot.playerResources += bounty
    } else {
      this.snapshot.enemyResources += bounty
  private applyDamageToEnemyBase(amount: number) {
    this.snapshot.enemyBaseHp = Math.max(this.snapshot.enemyBaseHp - amount, 0)
    if (this.snapshot.enemyBaseHp === 0) {
      this.concludeMatch('Victory!')
    }
    this.emitHudUpdate()
  }

  private handleBaseDamaged = (
    target: UnitFaction,
    _amount: number,
    remainingHp: number,
    destroyed: boolean
  ) => {
    if (target === 'enemy') {
      this.snapshot.enemyBaseHp = Math.max(Math.round(remainingHp), 0)
      if (destroyed) {
        this.concludeMatch('Victory!')
      }
    } else {
      this.snapshot.playerBaseHp = Math.max(Math.round(remainingHp), 0)
      if (destroyed) {
        this.concludeMatch('Defeat…')
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

    if (this.enemySpawnTimer) {
      this.enemySpawnTimer.destroy()
      this.enemySpawnTimer = undefined
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
    this.input.keyboard.removeListener('keydown-ONE')
    this.input.keyboard.removeListener('keydown-TWO')
    this.input.keyboard.removeListener('keydown-THREE')
    if (this.pointerHandler) {
      this.input.off(Phaser.Input.Events.POINTER_UP, this.pointerHandler)
      this.pointerHandler = undefined
    }

    this.input.keyboard.removeListener('keydown-Q')
    this.input.keyboard.removeListener('keydown-W')
    if (this.resourceTimer) {
      this.resourceTimer.destroy()
      this.resourceTimer = undefined
    }
    if (this.enemySpawnTimer) {
      this.enemySpawnTimer.destroy()
      this.enemySpawnTimer = undefined
    }

    this.playerBase?.destroy()
    this.enemyBase?.destroy()
  }
}
