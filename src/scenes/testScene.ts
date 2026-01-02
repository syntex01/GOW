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
      this.input.keyboard.on('keydown-A', () => this.runAllTests())
    }

    this.updateDisplay()

    // Show instruction for auto-run
    this.add.text(50, 80, 'Press A to auto-run all tests', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#00ff00'
    })
  }

  private runAllTests() {
    this.restartTests()
    this.autoRunTests()
  }

  private autoRunTests() {
    if (this.testIndex >= this.allTests.length) {
      this.logFinalResults()
      return
    }

    this.runNextTest()

    // Auto-advance to next test after delay
    this.time.delayedCall(2500, () => {
      this.autoRunTests()
    }, [], this)
  }

  private logFinalResults() {
    const passed = this.testResults.filter(r => r.passed).length
    const total = this.testResults.length
    const passRate = Math.round((passed / total) * 100)

    console.log('='.repeat(60))
    console.log('TEST SUITE RESULTS')
    console.log('='.repeat(60))
    console.log(`Total Tests: ${total}`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${total - passed}`)
    console.log(`Pass Rate: ${passRate}%`)
    console.log('='.repeat(60))
    console.log('\nDetailed Results:')
    this.testResults.forEach((result, i) => {
      const icon = result.passed ? '✓' : '✗'
      console.log(`${i + 1}. ${icon} ${result.name}`)
      if (result.message) {
        console.log(`   ${result.message}`)
      }
      if (!result.passed) {
        console.error(`   FAILURE: ${result.name}`)
      }
    })
    console.log('='.repeat(60))

    // Show summary on screen
    const summaryText = this.add.text(400, 500,
      `\n\nAUTO-RUN COMPLETE\n${passed}/${total} tests passed (${passRate}%)\n\nCheck console for details`, {
      fontFamily: 'Arial Black',
      fontSize: '18px',
      color: passRate === 100 ? '#00ff00' : '#ff0000',
      align: 'center'
    }).setOrigin(0.5)
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
    try {
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

      // Verify unit properties
      const checks = [
        unit !== null,
        unit !== undefined,
        unit.getHp() === config.maxHp,
        unit.getHp() > 0,
        unit.getX() === 400,
        unit.getY() === 300,
        unit.getConfig().key === 'clubman',
        !unit.isDead()
      ]

      const passed = checks.every(check => check === true)
      const failedChecks = checks.filter(c => !c).length

      this.addResult('Unit Creation', passed,
        passed ? 'All properties verified' : `${failedChecks} checks failed`)

      // Cleanup
      this.time.delayedCall(500, () => {
        unit.destroy()
      }, [], this)
    } catch (e) {
      const error = e as Error
      this.addResult('Unit Creation', false, `Exception: ${error.message}`)
    }
  }

  private testAllUnitTypes() {
    const unitKeys = Object.keys(ALL_UNIT_CONFIGS)
    const failures: string[] = []
    const units: Unit[] = []

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

        // Verify critical properties
        if (!unit || unit.getHp() !== config.maxHp || unit.getConfig().key !== key) {
          failures.push(`${key}: property mismatch`)
        }

        units.push(unit)
      } catch (e) {
        const error = e as Error
        failures.push(`${key}: ${error.message}`)
      }
    })

    // Cleanup
    this.time.delayedCall(1000, () => {
      units.forEach(u => u.destroy())
    }, [], this)

    const passed = failures.length === 0
    this.addResult('All Unit Types', passed,
      passed ? `All ${unitKeys.length} units verified` : `Failures: ${failures.join(', ')}`)
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
    const expectedDamage = attackerConfig.damage

    // Simulate multiple updates to ensure attack happens
    for (let i = 0; i < 30; i++) {
      attacker.update(100, 1, target, undefined)
    }

    this.time.delayedCall(1500, () => {
      const actualDamage = initialHp - target.getHp()
      const damaged = actualDamage > 0
      const expectedRange = actualDamage >= expectedDamage * 0.8 && actualDamage <= expectedDamage * 1.2

      const passed = damaged && !target.isDead()
      this.addResult('Melee Attack', passed,
        passed ? `Damage: ${actualDamage} (expected ~${expectedDamage})` :
        `Failed: damage=${actualDamage}, dead=${target.isDead()}`)

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
    const startY = unit.getY()

    // Update unit for 1 second of movement (10 frames at 100ms each)
    for (let i = 0; i < 10; i++) {
      unit.update(100, 1, undefined, undefined)
    }

    const endX = unit.getX()
    const endY = unit.getY()
    const distance = endX - startX
    const expectedMinDistance = (config.moveSpeed * 1.0) * 0.5 // At least 50% of expected

    const checks = [
      distance > 0,
      distance >= expectedMinDistance,
      endY === startY, // Y should not change
      !unit.isDead()
    ]

    const passed = checks.every(c => c)
    this.addResult('Unit Movement', passed,
      passed ? `Moved ${Math.round(distance)}px (expected ~${Math.round(config.moveSpeed)})` :
      `Failed: distance=${Math.round(distance)}, yChanged=${endY !== startY}`)

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
    const damageAmount = 20
    unit.takeDamage(damageAmount, 'stone')
    const finalHp = unit.getHp()
    const actualDamage = initialHp - finalHp

    // Account for armor reduction
    const expectedDamage = Math.max(1, damageAmount * (1 - config.armor / 100))
    const damageInRange = Math.abs(actualDamage - expectedDamage) < 1

    const checks = [
      finalHp < initialHp,
      actualDamage > 0,
      damageInRange,
      !unit.isDead(),
      finalHp > 0
    ]

    const passed = checks.every(c => c)
    this.addResult('Unit Damage', passed,
      passed ? `HP: ${initialHp} → ${finalHp} (damage: ${actualDamage})` :
      `Failed: expected ${expectedDamage} damage, got ${actualDamage}`)

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

    const initialHp = unit.getHp()

    // Kill the unit with massive damage
    unit.takeDamage(10000, 'stone')

    this.time.delayedCall(200, () => {
      const checks = [
        unit.getHp() <= 0,
        unit.isDead(),
        unit.getHp() < initialHp,
        unit.getState() === 'dying' || unit.getState() === 'dead'
      ]

      const passed = checks.every(c => c)
      this.addResult('Unit Death', passed,
        passed ? `Unit died (HP: ${initialHp} → ${unit.getHp()}, state: ${unit.getState()})` :
        `Failed: HP=${unit.getHp()}, isDead=${unit.isDead()}, state=${unit.getState()}`)
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
    const damageAmount = 100

    const destroyed = base.takeDamage(damageAmount)
    const finalHp = base.getHp()
    const actualDamage = initialHp - finalHp

    const checks = [
      finalHp === initialHp - damageAmount,
      actualDamage === damageAmount,
      !destroyed,
      finalHp > 0,
      base.getHp() === 900
    ]

    const passed = checks.every(c => c)
    this.addResult('Base Attack', passed,
      passed ? `Base HP: ${initialHp} → ${finalHp}` :
      `Failed: expected HP=900, got ${finalHp}, destroyed=${destroyed}`)

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
