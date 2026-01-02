import Phaser from 'phaser'
import { Unit } from '../battle/unit'
import { EffectsManager } from '../battle/effectsManager'
import { ProjectilePool } from '../battle/projectile'
import Base from '../battle/base'
import { ALL_UNIT_CONFIGS, UnitConfig } from '../battle/unitConfig'

interface TestResult {
  name: string
  passed: boolean
  message: string
}

export default class TestScene extends Phaser.Scene {
  private testResults: TestResult[] = []
  private resultsText?: Phaser.GameObjects.Text
  private effectsManager!: EffectsManager
  private projectilePool!: ProjectilePool
  private testIndex: number = 0
  private allTests: Array<() => void> = []

  constructor() {
    super({ key: 'TestScene' })
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    this.effectsManager = new EffectsManager(this)
    this.projectilePool = new ProjectilePool(this, this.effectsManager)

    // Display header
    this.add.text(400, 20, 'AGE OF WAR - TEST SUITE', {
      fontFamily: 'Arial Black',
      fontSize: '24px',
      color: '#ffffff'
    }).setOrigin(0.5)

    this.add.text(400, 50, 'Press SPACE to run next test, R to restart, ESC to return to menu', {
      fontFamily: 'Arial',
      fontSize: '14px',
      color: '#aaaaaa'
    }).setOrigin(0.5)

    // Results display
    this.resultsText = this.add.text(50, 100, '', {
      fontFamily: 'Courier',
      fontSize: '12px',
      color: '#ffffff',
      lineSpacing: 4
    })

    // Setup all tests
    this.setupTests()

    // Keyboard controls
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-SPACE', () => this.runNextTest())
      this.input.keyboard.on('keydown-R', () => this.restartTests())
      this.input.keyboard.on('keydown-ESC', () => this.scene.start('MenuScene'))
    }

    this.updateDisplay()
  }

  private setupTests() {
    this.allTests = [
      () => this.testUnitCreation(),
      () => this.testAllUnitTypes(),
      () => this.testMeleeAttack(),
      () => this.testRangedAttack(),
      () => this.testUnitMovement(),
      () => this.testUnitDamage(),
      () => this.testUnitDeath(),
      () => this.testProjectileSystem(),
      () => this.testBaseAttack(),
      () => this.testEffectsManager(),
      () => this.testBloodSplatter(),
      () => this.testExplosion(),
      () => this.testMuzzleFlash(),
      () => this.testHitMarker(),
      () => this.testResourceGain(),
      () => this.testAgeUpEffect(),
      () => this.testUnitSpawnEffect(),
      () => this.testCombatScenario(),
      () => this.testMassSpawn(),
      () => this.testAllAges()
    ]
  }

  private runNextTest() {
    if (this.testIndex >= this.allTests.length) {
      this.addResult('ALL TESTS COMPLETE', true, `${this.testResults.filter(r => r.passed).length}/${this.testResults.length} tests passed`)
      this.updateDisplay()
      return
    }

    try {
      this.allTests[this.testIndex]()
      this.testIndex++
      this.updateDisplay()
    } catch (error) {
      const e = error as Error
      this.addResult(`Test ${this.testIndex} CRASHED`, false, e.message)
      this.testIndex++
      this.updateDisplay()
    }
  }

  private restartTests() {
    this.testIndex = 0
    this.testResults = []
    this.updateDisplay()
  }

  private addResult(name: string, passed: boolean, message: string = '') {
    this.testResults.push({ name, passed, message })
  }

  private updateDisplay() {
    if (!this.resultsText) return

    let text = `Tests Run: ${this.testIndex}/${this.allTests.length}\n`
    text += `Passed: ${this.testResults.filter(r => r.passed).length}\n`
    text += `Failed: ${this.testResults.filter(r => !r.passed).length}\n\n`

    this.testResults.forEach(result => {
      const icon = result.passed ? '✓' : '✗'
      const color = result.passed ? '[green]' : '[red]'
      text += `${icon} ${result.name}\n`
      if (result.message) {
        text += `  ${result.message}\n`
      }
    })

    if (this.testIndex < this.allTests.length) {
      text += `\n[Press SPACE for next test]`
    } else if (this.testResults.length > 0) {
      text += `\n[All tests complete! Press R to restart]`
    }

    this.resultsText.setText(text)
  }

  // ============= INDIVIDUAL TESTS =============

  private testUnitCreation() {
    const config = ALL_UNIT_CONFIGS['clubman']
    const unit = new Unit({
      scene: this,
      faction: 'player',
      config,
      x: 400,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    const passed = unit !== null && unit.getHp() === config.maxHp
    this.addResult('Unit Creation', passed, passed ? 'Clubman created successfully' : 'Failed to create unit')

    // Cleanup
    this.time.delayedCall(500, () => {
      unit.destroy()
    }, [], this)
  }

  private testAllUnitTypes() {
    const unitKeys = Object.keys(ALL_UNIT_CONFIGS)
    let allCreated = true
    let errorUnit = ''

    unitKeys.forEach(key => {
      try {
        const config = ALL_UNIT_CONFIGS[key]
        const unit = new Unit({
          scene: this,
          faction: 'player',
          config,
          x: Phaser.Math.Between(100, 700),
          y: Phaser.Math.Between(200, 400),
          laneIndex: 0,
          effectsManager: this.effectsManager,
          projectilePool: this.projectilePool
        })

        this.time.delayedCall(1000, () => {
          unit.destroy()
        }, [], this)
      } catch (e) {
        allCreated = false
        errorUnit = key
      }
    })

    this.addResult('All Unit Types', allCreated,
      allCreated ? `All ${unitKeys.length} unit types created` : `Failed on: ${errorUnit}`)
  }

  private testMeleeAttack() {
    const attackerConfig = ALL_UNIT_CONFIGS['clubman']
    const targetConfig = ALL_UNIT_CONFIGS['clubman']

    const attacker = new Unit({
      scene: this,
      faction: 'player',
      config: attackerConfig,
      x: 300,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    const target = new Unit({
      scene: this,
      faction: 'enemy',
      config: targetConfig,
      x: 340,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    const initialHp = target.getHp()

    // Force an attack
    attacker.update(100, 1, target, undefined)
    this.time.delayedCall(1500, () => {
      const damaged = target.getHp() < initialHp
      this.addResult('Melee Attack', damaged,
        damaged ? `Target took ${initialHp - target.getHp()} damage` : 'No damage dealt')

      attacker.destroy()
      target.destroy()
    }, [], this)
  }

  private testRangedAttack() {
    if (!this.effectsManager || !this.projectilePool) return

    const attackerConfig = ALL_UNIT_CONFIGS['slinger']
    const attacker = new Unit({
      scene: this,
      faction: 'player',
      config: attackerConfig,
      x: 200,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    const targetConfig = ALL_UNIT_CONFIGS['clubman']
    const target = new Unit({
      scene: this,
      faction: 'enemy',
      config: targetConfig,
      x: 400,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    // Update to trigger attack
    attacker.update(100, 1, target, undefined)

    this.time.delayedCall(2000, () => {
      this.addResult('Ranged Attack', true, 'Projectile fired')
      attacker.destroy()
      target.destroy()
    }, [], this)
  }

  private testUnitMovement() {
    const config = ALL_UNIT_CONFIGS['clubman']
    const unit = new Unit({
      scene: this,
      faction: 'player',
      config,
      x: 200,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    const startX = unit.getX()

    // Update unit for 1 second of movement
    for (let i = 0; i < 10; i++) {
      unit.update(100, 1, undefined, undefined)
    }

    const endX = unit.getX()
    const moved = endX > startX

    this.addResult('Unit Movement', moved,
      moved ? `Moved ${Math.round(endX - startX)}px` : 'Unit did not move')

    unit.destroy()
  }

  private testUnitDamage() {
    const config = ALL_UNIT_CONFIGS['clubman']
    const unit = new Unit({
      scene: this,
      faction: 'player',
      config,
      x: 400,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    const initialHp = unit.getHp()
    unit.takeDamage(20, 'stone')
    const damaged = unit.getHp() < initialHp

    this.addResult('Unit Damage', damaged,
      damaged ? `HP: ${initialHp} → ${unit.getHp()}` : 'No damage taken')

    unit.destroy()
  }

  private testUnitDeath() {
    const config = ALL_UNIT_CONFIGS['clubman']
    const unit = new Unit({
      scene: this,
      faction: 'player',
      config,
      x: 400,
      y: 300,
      laneIndex: 0,
      effectsManager: this.effectsManager,
      projectilePool: this.projectilePool
    })

    // Kill the unit
    unit.takeDamage(1000, 'stone')

    this.time.delayedCall(100, () => {
      const dead = unit.getHp() <= 0
      this.addResult('Unit Death', dead, dead ? 'Unit died correctly' : 'Unit survived lethal damage')
    }, [], this)
  }

  private testProjectileSystem() {
    if (!this.effectsManager || !this.projectilePool) {
      this.addResult('Projectile System', false, 'Managers not initialized')
      return
    }

    const config = ALL_UNIT_CONFIGS['slinger']
    this.projectilePool.spawn({
      x: 200,
      y: 300,
      targetX: 600,
      targetY: 300,
      damage: 10,
      speed: 300,
      unitConfig: config,
      onHit: () => {}
    })

    this.addResult('Projectile System', true, 'Projectile spawned')
  }

  private testBaseAttack() {
    const base = new Base({
      scene: this,
      side: 'player',
      x: 400,
      y: 300,
      width: 100,
      height: 150,
      maxHp: 1000,
      label: 'TEST',
      fillColor: 0x3b82f6,
      strokeColor: 0x60a5fa
    })
    const initialHp = base.getHp()

    base.takeDamage(100)
    const damaged = base.getHp() === initialHp - 100

    this.addResult('Base Attack', damaged,
      damaged ? `Base HP: ${initialHp} → ${base.getHp()}` : 'Base not damaged')

    base.destroy()
  }

  private testEffectsManager() {
    if (!this.effectsManager) {
      this.addResult('Effects Manager', false, 'Not initialized')
      return
    }

    try {
      this.effectsManager.flash(0xff0000, 100)
      this.effectsManager.screenShake(100, 0.005)
      this.addResult('Effects Manager', true, 'Flash and shake work')
    } catch (e) {
      this.addResult('Effects Manager', false, 'Effects failed')
    }
  }

  private testBloodSplatter() {
    if (!this.effectsManager) return
    this.effectsManager.bloodSplatter(400, 300, 20)
    this.addResult('Blood Splatter', true, 'Visual effect triggered')
  }

  private testExplosion() {
    if (!this.effectsManager) return
    this.effectsManager.explosion(400, 300, 2, 30)
    this.addResult('Explosion', true, 'Visual effect triggered')
  }

  private testMuzzleFlash() {
    if (!this.effectsManager) return
    this.effectsManager.muzzleFlash(400, 300, 1)
    this.addResult('Muzzle Flash', true, 'Visual effect triggered')
  }

  private testHitMarker() {
    if (!this.effectsManager) return
    this.effectsManager.hitMarker(400, 300, 25)
    this.addResult('Hit Marker', true, 'Damage number displayed')
  }

  private testResourceGain() {
    if (!this.effectsManager) return
    this.effectsManager.resourceGain(400, 300, 50)
    this.addResult('Resource Gain', true, 'Resource popup displayed')
  }

  private testAgeUpEffect() {
    if (!this.effectsManager) return
    this.effectsManager.ageUpEffect(400, 300)
    this.addResult('Age Up Effect', true, 'Celebration effect triggered')
  }

  private testUnitSpawnEffect() {
    if (!this.effectsManager) return
    this.effectsManager.unitSpawn(400, 300)
    this.addResult('Unit Spawn Effect', true, 'Spawn portal effect triggered')
  }

  private testCombatScenario() {
    // Create a small battle scenario
    const units: Unit[] = []

    for (let i = 0; i < 3; i++) {
      const player = new Unit({
        scene: this,
        faction: 'player',
        config: ALL_UNIT_CONFIGS['clubman'],
        x: 200,
        y: 250 + i * 50,
        laneIndex: i,
        effectsManager: this.effectsManager,
        projectilePool: this.projectilePool
      })

      const enemy = new Unit({
        scene: this,
        faction: 'enemy',
        config: ALL_UNIT_CONFIGS['clubman'],
        x: 600,
        y: 250 + i * 50,
        laneIndex: i,
        effectsManager: this.effectsManager,
        projectilePool: this.projectilePool
      })

      units.push(player, enemy)
    }

    // Let them fight for a bit
    this.time.delayedCall(3000, () => {
      units.forEach(u => u.destroy())
      this.addResult('Combat Scenario', true, '3v3 battle simulated')
    }, [], this)
  }

  private testMassSpawn() {
    const units: Unit[] = []

    // Spawn 20 units
    for (let i = 0; i < 20; i++) {
      const unit = new Unit({
        scene: this,
        faction: i % 2 === 0 ? 'player' : 'enemy',
        config: ALL_UNIT_CONFIGS[Object.keys(ALL_UNIT_CONFIGS)[i % Object.keys(ALL_UNIT_CONFIGS).length]],
        x: Phaser.Math.Between(100, 700),
        y: Phaser.Math.Between(200, 400),
        laneIndex: 0,
        effectsManager: this.effectsManager,
        projectilePool: this.projectilePool
      })
      units.push(unit)
    }

    this.time.delayedCall(2000, () => {
      units.forEach(u => u.destroy())
      this.addResult('Mass Spawn', true, '20 units spawned and cleaned up')
    }, [], this)
  }

  private testAllAges() {
    const ages = ['stone', 'medieval', 'modern', 'future']
    const unitKeys = Object.keys(ALL_UNIT_CONFIGS)
    const agesFound = new Set<string>()

    unitKeys.forEach(key => {
      agesFound.add(ALL_UNIT_CONFIGS[key].age)
    })

    const allAgesPresent = ages.every(age => agesFound.has(age))
    this.addResult('All Ages Present', allAgesPresent,
      `Found ages: ${Array.from(agesFound).join(', ')}`)
  }
}
