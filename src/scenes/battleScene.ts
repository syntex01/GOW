import Phaser from 'phaser'
import Base from '../battle/base'
import { Unit, UnitFaction } from '../battle/unit'
import { EffectsManager } from '../battle/effectsManager'
import { ProjectilePool, Projectile } from '../battle/projectile'
import {
  ALL_UNIT_CONFIGS,
  UnitConfig,
  AgeType,
  AGE_CONFIGS,
  getUnitsForAge,
  getNextAge
} from '../battle/unitConfig'
import { gameEvents, GameEvents } from '../state/events'
import { gameState } from '../state/gameState'

export default class BattleScene extends Phaser.Scene {
  private playerBase!: Base
  private enemyBase!: Base
  private effectsManager!: EffectsManager
  private projectilePool!: ProjectilePool

  // Units
  private lanes: Map<number, { player: Unit[], enemy: Unit[] }> = new Map()
  private laneCount: number = 3

  // Game state
  private playerAge: AgeType = 'stone'
  private enemyAge: AgeType = 'stone'
  private playerResources: number = 200
  private enemyResources: number = 200
  private playerBaseHp: number = 1000
  private enemyBaseHp: number = 1000

  // Income
  private incomeTimer?: Phaser.Time.TimerEvent
  private enemySpawnTimer?: Phaser.Time.TimerEvent

  // UI
  private selectedUnitKey?: string
  private unitButtons: Phaser.GameObjects.Text[] = []
  private ageButton?: Phaser.GameObjects.Container
  private hintText?: Phaser.GameObjects.Text
  private laneVisuals: Phaser.GameObjects.Rectangle[] = []

  constructor() {
    super({ key: 'BattleScene' })
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a1628')

    // Initialize systems
    this.effectsManager = new EffectsManager(this)
    this.projectilePool = new ProjectilePool(this, this.effectsManager)

    // Initialize lanes
    for (let i = 0; i < this.laneCount; i++) {
      this.lanes.set(i, { player: [], enemy: [] })
    }

    // Build battlefield
    this.createBattlefield()
    this.createBases()
    this.createUI()

    // Setup input
    this.setupInput()

    // Start game systems
    this.startIncome()
    this.startEnemyAI()

    // Launch HUD
    this.scene.launch('HUDScene')
    this.updateHUD()

    // Cleanup on shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this)

    // Initial hint
    this.showHint('Select a unit and click a lane to spawn!')
  }

  private createBattlefield() {
    const { width, height } = this.cameras.main

    // Draw lanes
    const laneHeight = height / (this.laneCount + 1)
    for (let i = 0; i < this.laneCount; i++) {
      const y = laneHeight * (i + 1)
      const rect = this.add.rectangle(
        width / 2,
        y,
        width - 200,
        laneHeight - 40,
        0x1e3a5f,
        0.3
      )
      rect.setStrokeStyle(2, 0x3b82f6, 0.6)
      this.laneVisuals.push(rect)
    }

    // Ground line
    this.add.line(0, 0, 100, height - 120, width - 100, height - 120, 0x334155, 0.8).setOrigin(0)
  }

  private createBases() {
    const { width, height } = this.cameras.main

    this.playerBaseHp = AGE_CONFIGS[this.playerAge].baseHp
    this.enemyBaseHp = AGE_CONFIGS[this.enemyAge].baseHp

    this.playerBase = new Base({
      scene: this,
      side: 'player',
      x: 100,
      y: height / 2,
      width: 100,
      height: height - 240,
      maxHp: this.playerBaseHp,
      label: 'YOUR\nBASE',
      fillColor: 0x1e40af,
      strokeColor: 0x3b82f6
    })

    this.enemyBase = new Base({
      scene: this,
      side: 'enemy',
      x: width - 100,
      y: height / 2,
      width: 100,
      height: height - 240,
      maxHp: this.enemyBaseHp,
      label: 'ENEMY\nBASE',
      fillColor: 0x991b1b,
      strokeColor: 0xef4444
    })

    // Set initial HP
    this.playerBase.setHp(this.playerBaseHp)
    this.enemyBase.setHp(this.enemyBaseHp)
  }

  private createUI() {
    const { width, height, centerX } = this.cameras.main

    // Available units for current age
    const availableUnits = getUnitsForAge(this.playerAge)
    const buttonSpacing = 140
    const startX = centerX - (availableUnits.length * buttonSpacing) / 2 + buttonSpacing / 2

    availableUnits.forEach((unitConfig, index) => {
      const button = this.add
        .text(
          startX + buttonSpacing * index,
          height - 70,
          `${unitConfig.name}\n${unitConfig.cost}⚡`,
          {
            fontFamily: 'Arial Black',
            fontSize: '16px',
            color: '#f1f5f9',
            align: 'center',
            backgroundColor: '#1e293b',
            padding: { x: 12, y: 10 }
          }
        )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on(Phaser.Input.Events.POINTER_OVER, () => {
          button.setScale(1.05)
          this.showHint(unitConfig.description)
        })
        .on(Phaser.Input.Events.POINTER_OUT, () => {
          button.setScale(1)
        })
        .on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
          if (pointer.event) { pointer.event.stopPropagation() }
          this.selectUnit(unitConfig.key)
        })

      this.unitButtons.push(button)
    })

    // Age upgrade button
    this.createAgeButton()

    // Select first unit by default
    if (availableUnits.length > 0) {
      this.selectUnit(availableUnits[0].key)
    }

    // Hint text
    this.hintText = this.add
      .text(centerX, 30, '', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#cbd5e1',
        align: 'center'
      })
      .setOrigin(0.5)
  }

  private createAgeButton() {
    const { width } = this.cameras.main
    const nextAge = getNextAge(this.playerAge)

    if (!nextAge) return

    const ageConfig = AGE_CONFIGS[nextAge]
    const container = this.add.container(width - 150, 50)

    const bg = this.add.rectangle(0, 0, 130, 60, 0x7c3aed, 1)
    bg.setStrokeStyle(3, 0xa78bfa)

    const text = this.add
      .text(0, -10, `⬆ ${ageConfig.name}`, {
        fontFamily: 'Arial Black',
        fontSize: '14px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5)

    const cost = this.add
      .text(0, 12, `${ageConfig.cost}⚡`, {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: '#fbbf24',
        align: 'center'
      })
      .setOrigin(0.5)

    container.add([bg, text, cost])
    container.setSize(130, 60)
    container.setInteractive({ useHandCursor: true })

    container.on(Phaser.Input.Events.POINTER_OVER, () => {
      container.setScale(1.05)
      this.showHint(ageConfig.description)
    })

    container.on(Phaser.Input.Events.POINTER_OUT, () => {
      container.setScale(1)
    })

    container.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (pointer.event) { pointer.event.stopPropagation() }
      this.upgradeAge()
    })

    this.ageButton = container
  }

  private selectUnit(key: string) {
    this.selectedUnitKey = key
    const config = ALL_UNIT_CONFIGS[key]

    // Update button styles
    this.unitButtons.forEach(button => {
      const isSelected = button.text.startsWith(config.name)
      button.setStyle({
        backgroundColor: isSelected ? '#3b82f6' : '#1e293b',
        color: isSelected ? '#0f172a' : '#f1f5f9'
      })
    })

    this.showHint(`Selected: ${config.name} - ${config.description}`)
  }

  private setupInput() {
    // Click on lane to spawn unit
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (pointer.y < this.cameras.main.height - 120) {
        const laneIndex = this.getLaneAtY(pointer.y)
        if (laneIndex !== -1) {
          this.spawnPlayerUnit(laneIndex)
        }
      }
    })

    // Keyboard shortcuts
    this.input.keyboard?.on('keydown-ONE', () => this.spawnPlayerUnit(0))
    this.input.keyboard?.on('keydown-TWO', () => this.spawnPlayerUnit(1))
    this.input.keyboard?.on('keydown-THREE', () => this.spawnPlayerUnit(2))
    this.input.keyboard?.on('keydown-SPACE', () => this.upgradeAge())
    this.input.keyboard?.on('keydown-ESC', () => this.returnToMenu())
  }

  private getLaneAtY(y: number): number {
    for (let i = 0; i < this.laneVisuals.length; i++) {
      const bounds = this.laneVisuals[i].getBounds()
      if (y >= bounds.top && y <= bounds.bottom) {
        return i
      }
    }
    return -1
  }

  private spawnPlayerUnit(laneIndex: number) {
    if (!this.selectedUnitKey) return

    const config = ALL_UNIT_CONFIGS[this.selectedUnitKey]

    if (this.playerResources < config.cost) {
      this.showHint('Not enough resources!')
      this.effectsManager.flash(0xff0000, 100)
      return
    }

    this.playerResources -= config.cost
    this.spawnUnit('player', laneIndex, config)
    this.updateHUD()
  }

  private spawnUnit(faction: UnitFaction, laneIndex: number, config: UnitConfig) {
    const lane = this.lanes.get(laneIndex)
    if (!lane) return

    const laneY = this.laneVisuals[laneIndex].y
    const spawnX = faction === 'player' ? this.playerBase.getImpactX() + 40 : this.enemyBase.getImpactX() - 40

    const unit = new Unit({
      scene: this,
      faction,
      config,
      x: spawnX,
      y: laneY,
      laneIndex,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    if (faction === 'player') {
      lane.player.push(unit)
    } else {
      lane.enemy.push(unit)
    }

    // Spawn effect
    this.effectsManager.dustCloud(spawnX, laneY)
  }

  private upgradeAge() {
    const nextAge = getNextAge(this.playerAge)
    if (!nextAge) {
      this.showHint('Already at maximum age!')
      return
    }

    const ageConfig = AGE_CONFIGS[nextAge]

    if (this.playerResources < ageConfig.cost) {
      this.showHint('Not enough resources to upgrade age!')
      this.effectsManager.flash(0xff0000, 100)
      return
    }

    this.playerResources -= ageConfig.cost
    this.playerAge = nextAge

    // Upgrade base
    const newMaxHp = ageConfig.baseHp
    const hpIncrease = newMaxHp - this.playerBase.getHp()
    this.playerBaseHp = newMaxHp
    this.playerBase.setHp(this.playerBase.getHp() + hpIncrease)

    // Visual feedback
    this.effectsManager.explosion(this.playerBase.getBounds().centerX, this.playerBase.getBounds().centerY, 2, 50)
    this.effectsManager.flash(0xffd700, 200)

    // Recreate UI
    this.unitButtons.forEach(b => b.destroy())
    this.unitButtons = []
    this.ageButton?.destroy()
    this.createUI()

    this.showHint(`Advanced to ${ageConfig.name}! New units unlocked!`)
    this.updateHUD()
  }

  private startIncome() {
    this.incomeTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        const settings = gameState.getSettings()
        const baseIncome = 10

        const playerIncomeBonus = AGE_CONFIGS[this.playerAge].incomeBonus
        const enemyIncomeBonus = AGE_CONFIGS[this.enemyAge].incomeBonus

        this.playerResources += baseIncome + playerIncomeBonus
        this.enemyResources += baseIncome + enemyIncomeBonus

        this.updateHUD()
      }
    })
  }

  private startEnemyAI() {
    this.enemySpawnTimer = this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => {
        this.enemyAITick()
      }
    })
  }

  private enemyAITick() {
    const settings = gameState.getSettings()
    const difficulty = settings.difficulty || 'normal'

    // Upgrade age when affordable
    const nextAge = getNextAge(this.enemyAge)
    if (nextAge) {
      const ageConfig = AGE_CONFIGS[nextAge]
      const ageCost = ageConfig.cost
      const shouldUpgrade = this.enemyResources > ageCost * 1.5

      if (shouldUpgrade) {
        this.enemyResources -= ageCost
        this.enemyAge = nextAge

        const newMaxHp = ageConfig.baseHp
        const hpIncrease = newMaxHp - this.enemyBase.getHp()
        this.enemyBaseHp = newMaxHp
        this.enemyBase.setHp(this.enemyBase.getHp() + hpIncrease)

        this.effectsManager.explosion(this.enemyBase.getBounds().centerX, this.enemyBase.getBounds().centerY, 2, 50)
        this.showHint('Enemy has advanced to the next age!')
      }
    }

    // Spawn units
    const availableUnits = getUnitsForAge(this.enemyAge)
    const affordableUnits = availableUnits.filter(u => u.cost <= this.enemyResources)

    if (affordableUnits.length > 0) {
      // Choose based on difficulty
      let chosenUnit: UnitConfig

      if (difficulty === 'easy') {
        // Spawn cheaper units
        chosenUnit = affordableUnits.sort((a, b) => a.cost - b.cost)[0]
      } else if (difficulty === 'hard') {
        // Spawn more expensive units
        chosenUnit = affordableUnits.sort((a, b) => b.cost - a.cost)[0]
      } else {
        // Random
        chosenUnit = Phaser.Utils.Array.GetRandom(affordableUnits)
      }

      const lane = Phaser.Math.Between(0, this.laneCount - 1)
      this.enemyResources -= chosenUnit.cost
      this.spawnUnit('enemy', lane, chosenUnit)
    }

    this.updateHUD()
  }

  update(time: number, delta: number) {
    // Update all units
    this.lanes.forEach((lane, laneIndex) => {
      // Update player units
      lane.player.forEach(unit => {
        const direction = 1
        const enemyUnits = lane.enemy.filter(u => !u.isDead())
        const target = this.findClosestTarget(unit, enemyUnits)

        unit.update(delta, direction, target, target ? undefined : this.enemyBase)
      })

      // Update enemy units
      lane.enemy.forEach(unit => {
        const direction = -1
        const playerUnits = lane.player.filter(u => !u.isDead())
        const target = this.findClosestTarget(unit, playerUnits)

        unit.update(delta, direction, target, target ? undefined : this.playerBase)
      })

      // Remove dead units
      lane.player = lane.player.filter(u => {
        if (u.isDead()) {
          this.onUnitKilled('player')
          return false
        }
        return true
      })

      lane.enemy = lane.enemy.filter(u => {
        if (u.isDead()) {
          this.onUnitKilled('enemy')
          return false
        }
        return true
      })
    })

    // Update projectiles and handle hits
    this.projectilePool.update()
    this.handleProjectileCollisions()
  }

  private findClosestTarget(unit: Unit, enemies: Unit[]): Unit | undefined {
    if (enemies.length === 0) return undefined

    const unitX = unit.getX()
    const direction = unit.faction === 'player' ? 1 : -1

    const validTargets = enemies.filter(e => {
      const diff = e.getX() - unitX
      return diff * direction > 0
    })

    if (validTargets.length === 0) return undefined

    return validTargets.reduce((closest, current) => {
      const closestDist = Math.abs(closest.getX() - unitX)
      const currentDist = Math.abs(current.getX() - unitX)
      return currentDist < closestDist ? current : closest
    })
  }

  private handleProjectileCollisions() {
    const projectiles = this.projectilePool.getProjectiles()

    projectiles.forEach(projectile => {
      if (!projectile.isActive()) return

      const pos = projectile.getPosition()
      const splashRadius = projectile.getSplashRadius()

      // Find units at this position
      this.lanes.forEach(lane => {
        const allUnits = [...lane.player, ...lane.enemy]

        allUnits.forEach(unit => {
          if (unit.isDead()) return

          const distance = Phaser.Math.Distance.Between(pos.x, pos.y, unit.getX(), unit.getY())

          if (splashRadius > 0) {
            // Splash damage
            if (distance < splashRadius) {
              unit.takeDamage(projectile.damage, projectile.unitConfig.age)
              projectile.destroy()
            }
          } else {
            // Direct hit
            if (distance < 30) {
              unit.takeDamage(projectile.damage, projectile.unitConfig.age)
              projectile.destroy()
            }
          }
        })
      })

      // Check base hits
      if (!projectile.isActive()) return

      const playerBaseBounds = this.playerBase.getBounds()
      const enemyBaseBounds = this.enemyBase.getBounds()

      if (Phaser.Geom.Rectangle.Contains(playerBaseBounds, pos.x, pos.y)) {
        const destroyed = this.playerBase.takeDamage(projectile.damage)
        this.effectsManager.impact(pos.x, pos.y, projectile.unitConfig.age === 'future')
        projectile.destroy()

        if (destroyed) {
          this.endGame(false)
        } else {
          this.updateHUD()
        }
      } else if (Phaser.Geom.Rectangle.Contains(enemyBaseBounds, pos.x, pos.y)) {
        const destroyed = this.enemyBase.takeDamage(projectile.damage)
        this.effectsManager.impact(pos.x, pos.y, projectile.unitConfig.age === 'future')
        projectile.destroy()

        if (destroyed) {
          this.endGame(true)
        } else {
          this.updateHUD()
        }
      }
    })
  }

  private onUnitKilled(faction: UnitFaction) {
    const bounty = 10
    if (faction === 'enemy') {
      this.playerResources += bounty
    } else {
      this.enemyResources += bounty
    }
    this.updateHUD()
  }

  private endGame(victory: boolean) {
    // Stop timers
    this.incomeTimer?.destroy()
    this.enemySpawnTimer?.destroy()

    // Massive explosion
    const base = victory ? this.enemyBase : this.playerBase
    this.effectsManager.explosion(base.getBounds().centerX, base.getBounds().centerY, 3, 80)

    const message = victory ? '🎉 VICTORY! 🎉' : '☠️ DEFEAT ☠️'
    this.showHint(message)

    // Flash and shake
    this.effectsManager.screenShake(500, 0.015)
    this.effectsManager.flash(victory ? 0xffd700 : 0xff0000, 500)

    // Return to menu
    this.time.delayedCall(3000, () => {
      this.returnToMenu()
    })
  }

  private showHint(text: string) {
    if (this.hintText) {
      this.hintText.setText(text)
    }
  }

  private updateHUD() {
    gameEvents.emit(GameEvents.HUD_UPDATE, {
      playerResources: this.playerResources,
      enemyResources: this.enemyResources,
      playerBaseHp: this.playerBase.getHp(),
      enemyBaseHp: this.enemyBase.getHp(),
      playerMaxHp: this.playerBaseHp,
      enemyMaxHp: this.enemyBaseHp,
      playerAge: this.playerAge,
      enemyAge: this.enemyAge
    })
  }

  private returnToMenu() {
    this.scene.stop('HUDScene')
    this.scene.start('MenuScene')
  }

  private cleanup() {
    this.incomeTimer?.destroy()
    this.enemySpawnTimer?.destroy()
    this.projectilePool.destroy()
    this.effectsManager.destroy()

    this.lanes.forEach(lane => {
      lane.player.forEach(u => u.destroy())
      lane.enemy.forEach(u => u.destroy())
    })
    this.lanes.clear()
  }
}
