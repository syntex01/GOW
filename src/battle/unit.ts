import Phaser from 'phaser'
import { UnitConfig, AgeType } from './unitConfig'
import { EffectsManager } from './effectsManager'
import { ProjectilePool } from './projectile'

export type UnitFaction = 'player' | 'enemy'
export type UnitState = 'idle' | 'moving' | 'attacking' | 'dying' | 'dead'

export interface UnitOptions {
  scene: Phaser.Scene
  faction: UnitFaction
  config: UnitConfig
  x: number
  y: number
  laneIndex: number
  effectsManager: EffectsManager
  projectilePool: ProjectilePool
}

export class Unit {
  private scene: Phaser.Scene
  public faction: UnitFaction
  public config: UnitConfig
  private container: Phaser.GameObjects.Container
  private bodySprite: Phaser.GameObjects.Graphics
  private hpBar: Phaser.GameObjects.Graphics
  private weaponSprite?: Phaser.GameObjects.Graphics
  private hp: number
  private state: UnitState = 'idle'
  private attackCooldown: number = 0
  public laneIndex: number
  private effectsManager: EffectsManager
  private projectilePool: ProjectilePool
  private animationTimer: number = 0
  private bobOffset: number = 0
  private isDestroyed: boolean = false
  private flashTween?: Phaser.Tweens.Tween

  constructor(options: UnitOptions) {
    this.scene = options.scene
    this.faction = options.faction
    this.config = options.config
    this.hp = options.config.maxHp
    this.laneIndex = options.laneIndex
    this.effectsManager = options.effectsManager
    this.projectilePool = options.projectilePool

    // Create container for the unit
    this.container = this.scene.add.container(options.x, options.y)

    // Create visual representation
    this.bodySprite = this.scene.add.graphics()
    this.drawUnit()

    // Create HP bar
    this.hpBar = this.scene.add.graphics()
    this.updateHpBar()

    // Add to container
    this.container.add([this.bodySprite, this.hpBar])

    // Random attack cooldown start to prevent synchronized attacks
    this.attackCooldown = Phaser.Math.Between(0, this.config.attackInterval)
  }

  private drawUnit() {
    this.bodySprite.clear()

    const w = this.config.width
    const h = this.config.height
    const color = this.config.color
    const accent = this.config.accentColor
    const age = this.config.age
    const role = this.config.role

    // Different visual styles based on age and role
    if (age === 'stone') {
      this.drawStoneAgeUnit(w, h, color, accent, role)
    } else if (age === 'medieval') {
      this.drawMedievalUnit(w, h, color, accent, role)
    } else if (age === 'modern') {
      this.drawModernUnit(w, h, color, accent, role)
    } else if (age === 'future') {
      this.drawFutureUnit(w, h, color, accent, role)
    }

    // Faction indicator (outline color)
    const outlineColor = this.faction === 'player' ? 0x22c55e : 0xef4444
    this.bodySprite.lineStyle(2, outlineColor, 1)
    this.bodySprite.strokeRect(-w / 2, -h / 2, w, h)
  }

  private drawStoneAgeUnit(w: number, h: number, color: number, accent: number, role: string) {
    // Body (primitive look)
    this.bodySprite.fillStyle(color, 1)
    this.bodySprite.fillRect(-w / 2, -h / 2, w, h * 0.6) // Torso

    // Head
    this.bodySprite.fillStyle(accent, 1)
    this.bodySprite.fillCircle(0, -h / 2 + 5, w * 0.3)

    // Legs
    this.bodySprite.fillStyle(color, 1)
    this.bodySprite.fillRect(-w * 0.3, h * 0.1, w * 0.25, h * 0.4)
    this.bodySprite.fillRect(w * 0.05, h * 0.1, w * 0.25, h * 0.4)

    // Weapon/detail
    if (role === 'siege') {
      // Mammoth tusks
      this.bodySprite.fillStyle(0xfff8dc, 1)
      this.bodySprite.fillTriangle(-w * 0.5, 0, -w * 0.7, h * 0.3, -w * 0.4, h * 0.2)
      this.bodySprite.fillTriangle(w * 0.5, 0, w * 0.7, h * 0.3, w * 0.4, h * 0.2)
    } else if (role === 'ranged') {
      // Sling
      this.bodySprite.lineStyle(2, accent, 1)
      this.bodySprite.strokeCircle(w * 0.4, 0, 4)
    } else {
      // Club
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillRect(w * 0.3, -h * 0.2, w * 0.15, h * 0.5)
    }
  }

  private drawMedievalUnit(w: number, h: number, color: number, accent: number, role: string) {
    // Armored body
    this.bodySprite.fillStyle(color, 1)
    this.bodySprite.fillRoundedRect(-w / 2, -h / 2, w, h * 0.7, 3)

    // Helmet
    this.bodySprite.fillStyle(accent, 1)
    this.bodySprite.fillRoundedRect(-w * 0.35, -h / 2 - 5, w * 0.7, h * 0.25, 2)

    // Visor slit
    this.bodySprite.fillStyle(0x000000, 1)
    this.bodySprite.fillRect(-w * 0.2, -h / 2, w * 0.4, 2)

    // Legs
    this.bodySprite.fillStyle(color, 0.8)
    this.bodySprite.fillRect(-w * 0.3, h * 0.2, w * 0.25, h * 0.3)
    this.bodySprite.fillRect(w * 0.05, h * 0.2, w * 0.25, h * 0.3)

    // Weapon/equipment
    if (role === 'siege') {
      // Catapult arm
      this.bodySprite.fillStyle(0x3e2723, 1)
      this.bodySprite.fillRect(-w * 0.4, -h * 0.4, w * 0.8, h * 0.2)
      this.bodySprite.fillCircle(0, -h * 0.4, 6)
    } else if (role === 'ranged') {
      // Bow
      this.bodySprite.lineStyle(3, accent, 1)
      this.bodySprite.beginPath()
      this.bodySprite.arc(w * 0.5, 0, h * 0.3, -Math.PI / 2, Math.PI / 2)
      this.bodySprite.strokePath()
    } else {
      // Sword
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillRect(w * 0.35, -h * 0.3, w * 0.1, h * 0.6)
      this.bodySprite.fillRect(w * 0.25, -h * 0.35, w * 0.3, w * 0.15)
    }
  }

  private drawModernUnit(w: number, h: number, color: number, accent: number, role: string) {
    if (role === 'siege') {
      // Tank
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRoundedRect(-w / 2, -h / 2, w, h * 0.5, 4) // Hull

      // Turret
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillRoundedRect(-w * 0.3, -h * 0.5, w * 0.6, h * 0.4, 3)

      // Barrel
      this.bodySprite.fillStyle(0x4a5568, 1)
      this.bodySprite.fillRect(w * 0.3, -h * 0.35, w * 0.4, h * 0.15)

      // Treads
      this.bodySprite.fillStyle(0x1f2937, 1)
      this.bodySprite.fillRect(-w / 2, h * 0.1, w, h * 0.2)
    } else {
      // Infantry
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRoundedRect(-w / 2, -h / 2, w, h * 0.65, 2) // Uniform

      // Helmet
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillEllipse(0, -h / 2 - 3, w * 0.6, h * 0.22)

      // Legs
      this.bodySprite.fillStyle(color, 0.9)
      this.bodySprite.fillRect(-w * 0.3, h * 0.15, w * 0.25, h * 0.35)
      this.bodySprite.fillRect(w * 0.05, h * 0.15, w * 0.25, h * 0.35)

      // Rifle
      this.bodySprite.fillStyle(0x1f2937, 1)
      this.bodySprite.fillRect(w * 0.25, -h * 0.15, w * 0.5, h * 0.08)
      this.bodySprite.fillStyle(accent, 0.6)
      this.bodySprite.fillRect(w * 0.7, -h * 0.12, w * 0.1, h * 0.02)
    }
  }

  private drawFutureUnit(w: number, h: number, color: number, accent: number, role: string) {
    if (role === 'siege') {
      // Plasma Artillery - angular, advanced design
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRect(-w / 2, -h / 2, w, h * 0.5)

      // Energy core
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillCircle(0, -h * 0.25, w * 0.3)
      this.bodySprite.fillStyle(0xffffff, 0.6)
      this.bodySprite.fillCircle(0, -h * 0.25, w * 0.15)

      // Cannon
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRect(w * 0.3, -h * 0.3, w * 0.5, h * 0.2)

      // Glow effect
      this.bodySprite.lineStyle(2, accent, 0.5)
      this.bodySprite.strokeRect(-w / 2, -h / 2, w, h * 0.5)
    } else if (role === 'flying') {
      // Drone - sleek flying design
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillEllipse(0, 0, w, h * 0.6)

      // Rotors/wings
      this.bodySprite.fillStyle(accent, 0.7)
      this.bodySprite.fillEllipse(-w * 0.6, 0, w * 0.4, h * 0.3)
      this.bodySprite.fillEllipse(w * 0.6, 0, w * 0.4, h * 0.3)

      // Core
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillCircle(0, 0, w * 0.2)
    } else if (role === 'melee') {
      // Mech - large robotic unit
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRoundedRect(-w / 2, -h / 2, w, h * 0.6, 4)

      // Cockpit
      this.bodySprite.fillStyle(accent, 0.8)
      this.bodySprite.fillCircle(0, -h * 0.3, w * 0.25)

      // Arms
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRect(-w * 0.6, -h * 0.2, w * 0.2, h * 0.4)
      this.bodySprite.fillRect(w * 0.4, -h * 0.2, w * 0.2, h * 0.4)

      // Legs
      this.bodySprite.fillStyle(color, 0.9)
      this.bodySprite.fillRect(-w * 0.35, h * 0.1, w * 0.3, h * 0.4)
      this.bodySprite.fillRect(w * 0.05, h * 0.1, w * 0.3, h * 0.4)

      // Glow accents
      this.bodySprite.lineStyle(3, accent, 0.6)
      this.bodySprite.strokeRoundedRect(-w / 2, -h / 2, w, h * 0.6, 4)
    } else if (role === 'hero') {
      // Titan Destroyer - massive intimidating unit
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRoundedRect(-w / 2, -h / 2, w, h, 6)

      // Energy cores
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillCircle(-w * 0.25, -h * 0.25, w * 0.15)
      this.bodySprite.fillCircle(w * 0.25, -h * 0.25, w * 0.15)

      // Weapon systems
      this.bodySprite.fillStyle(0x1f2937, 1)
      this.bodySprite.fillRect(-w * 0.6, -h * 0.1, w * 0.25, h * 0.3)
      this.bodySprite.fillRect(w * 0.35, -h * 0.1, w * 0.25, h * 0.3)

      // Glowing outline
      this.bodySprite.lineStyle(4, accent, 0.8)
      this.bodySprite.strokeRoundedRect(-w / 2, -h / 2, w, h, 6)
    } else {
      // Laser Trooper
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillRoundedRect(-w / 2, -h / 2, w, h * 0.7, 3)

      // Helmet with visor
      this.bodySprite.fillStyle(color, 1)
      this.bodySprite.fillEllipse(0, -h / 2 - 2, w * 0.7, h * 0.25)
      this.bodySprite.fillStyle(accent, 0.8)
      this.bodySprite.fillRect(-w * 0.25, -h / 2 - 2, w * 0.5, h * 0.08)

      // Energy rifle
      this.bodySprite.fillStyle(accent, 1)
      this.bodySprite.fillRect(w * 0.2, -h * 0.1, w * 0.6, h * 0.12)
      this.bodySprite.fillStyle(0x00ffff, 0.8)
      this.bodySprite.fillCircle(w * 0.8, -h * 0.04, 4)

      // Legs
      this.bodySprite.fillStyle(color, 0.9)
      this.bodySprite.fillRect(-w * 0.3, h * 0.2, w * 0.25, h * 0.3)
      this.bodySprite.fillRect(w * 0.05, h * 0.2, w * 0.25, h * 0.3)
    }
  }

  private updateHpBar() {
    this.hpBar.clear()

    const barWidth = this.config.width * 0.8
    const barHeight = 4
    const percentage = this.hp / this.config.maxHp

    // Background
    this.hpBar.fillStyle(0x000000, 0.6)
    this.hpBar.fillRect(-barWidth / 2, -this.config.height / 2 - 10, barWidth, barHeight)

    // HP bar
    let color = 0x22c55e // Green
    if (percentage < 0.3) {
      color = 0xef4444 // Red
    } else if (percentage < 0.6) {
      color = 0xfbbf24 // Yellow
    }

    this.hpBar.fillStyle(color, 1)
    this.hpBar.fillRect(-barWidth / 2, -this.config.height / 2 - 10, barWidth * percentage, barHeight)
  }

  update(delta: number, direction: number, target?: Unit, enemyBase?: any): boolean {
    if (this.state === 'dead' || this.isDestroyed) {
      return false
    }

    // Update animation
    this.animationTimer += delta
    this.bobOffset = Math.sin(this.animationTimer / 200) * 2

    if (this.state === 'dying') {
      // Continue death animation
      return false
    }

    // Update attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= delta
    }

    // State machine
    if (target) {
      const distance = Math.abs(target.getX() - this.container.x)

      if (distance <= this.config.range) {
        this.setState('attacking')
        if (this.attackCooldown <= 0) {
          this.attack(target)
          this.attackCooldown = this.config.attackInterval
        }
      } else {
        this.setState('moving')
        this.move(delta, direction, target.getX() - direction * (this.config.range * 0.7))
      }
    } else if (enemyBase) {
      // Move towards and attack base
      const baseX = enemyBase.getImpactX()
      const distance = Math.abs(baseX - this.container.x)

      if (distance <= this.config.range) {
        this.setState('attacking')
        if (this.attackCooldown <= 0) {
          this.attackBase(enemyBase)
          this.attackCooldown = this.config.attackInterval
        }
      } else {
        this.setState('moving')
        const targetX = direction === 1 ? baseX - this.config.range : baseX + this.config.range
        this.move(delta, direction, targetX)
      }
    } else {
      this.setState('idle')
    }

    // Apply bob effect
    if (this.config.role === 'flying') {
      this.bodySprite.y = this.bobOffset * 2
    } else if (this.state === 'moving') {
      this.bodySprite.y = this.bobOffset
    } else {
      this.bodySprite.y = 0
    }

    return true
  }

  private setState(newState: UnitState) {
    if (this.state !== newState) {
      this.state = newState
    }
  }

  private move(delta: number, direction: number, stopX: number) {
    const moveDistance = (this.config.moveSpeed / 1000) * delta * direction
    const nextX = this.container.x + moveDistance

    if ((direction === 1 && nextX >= stopX) || (direction === -1 && nextX <= stopX)) {
      this.container.x = stopX
    } else {
      this.container.x = nextX
    }

    // Occasional dust clouds when moving
    if (this.animationTimer % 300 < delta && this.config.role !== 'flying') {
      this.effectsManager.dustCloud(this.container.x, this.container.y + this.config.height / 2)
    }
  }

  private attack(target: Unit) {
    if (this.config.isRanged) {
      // Fire projectile
      this.fireProjectile(target.getX(), target.getY())
    } else {
      // Melee attack
      this.meleeAttack(target)
    }
  }

  private attackBase(base: any) {
    if (this.config.isRanged) {
      const impactX = base.getImpactX()
      const baseY = base.getBounds().centerY
      this.fireProjectile(impactX, baseY)
    } else {
      // Melee attack on base
      const destroyed = base.takeDamage(this.config.damage)
      this.playAttackAnimation()

      if (!destroyed && this.effectsManager) {
        this.effectsManager.impact(base.getImpactX(), base.getBounds().centerY, this.config.age === 'future')
        this.effectsManager.screenShake(80, 0.003)
      }
    }
  }

  private fireProjectile(targetX: number, targetY: number) {
    const muzzleX = this.container.x + (this.faction === 'player' ? this.config.width / 2 : -this.config.width / 2)
    const muzzleY = this.container.y - this.config.height / 4

    this.projectilePool.spawn({
      x: muzzleX,
      y: muzzleY,
      targetX,
      targetY,
      damage: this.config.damage,
      speed: this.config.projectileSpeed || 300,
      unitConfig: this.config,
      onHit: (projectile: any) => {
        // Handled by projectile pool
      }
    })

    // Muzzle flash
    if (this.effectsManager) {
      this.effectsManager.muzzleFlash(muzzleX, muzzleY, this.faction === 'player' ? 1 : -1)
    }

    this.playAttackAnimation()
  }

  private meleeAttack(target: Unit) {
    target.takeDamage(this.config.damage, this.config.age)
    this.playAttackAnimation()
  }

  private playAttackAnimation() {
    // Quick jab animation
    const direction = this.faction === 'player' ? 1 : -1
    this.scene.tweens.add({
      targets: this.bodySprite,
      x: direction * 5,
      duration: 100,
      yoyo: true,
      ease: 'Power2'
    })
  }

  takeDamage(amount: number, attackerAge: string = 'stone') {
    const actualDamage = Math.max(1, amount * (1 - this.config.armor / 100))
    this.hp -= actualDamage

    // Hit feedback
    if (this.effectsManager) {
      this.effectsManager.hitFeedback(this.container.x, this.container.y, true, attackerAge)
    }

    // Flash white on hit
    if (this.flashTween) {
      this.flashTween.stop()
    }
    this.bodySprite.alpha = 0.5
    this.flashTween = this.scene.tweens.add({
      targets: this.bodySprite,
      alpha: 1,
      duration: 100,
      ease: 'Power2'
    })

    this.updateHpBar()

    if (this.hp <= 0) {
      this.die()
    }
  }

  private die() {
    this.setState('dying')
    this.isDestroyed = true

    // Death effects
    if (this.effectsManager) {
      const isHeavy = this.config.role === 'siege' || this.config.role === 'hero'
      this.effectsManager.unitDeath(this.container.x, this.container.y, isHeavy, this.config.age)
    }

    // Death animation
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      y: this.container.y + 20,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        this.destroy()
      }
    })
  }

  destroy() {
    this.isDestroyed = true
    this.state = 'dead'
    if (this.flashTween) {
      this.flashTween.stop()
    }
    this.container.destroy()
  }

  getX(): number {
    return this.container.x
  }

  getY(): number {
    return this.container.y
  }

  getState(): UnitState {
    return this.state
  }

  isDead(): boolean {
    return this.isDestroyed || this.state === 'dead'
  }

  getConfig(): UnitConfig {
    return this.config
  }
}
