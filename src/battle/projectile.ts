import Phaser from 'phaser'
import { UnitConfig } from './unitConfig'
import { EffectsManager } from './effectsManager'

export interface ProjectileConfig {
  scene: Phaser.Scene
  x: number
  y: number
  targetX: number
  targetY: number
  damage: number
  speed: number
  unitConfig: UnitConfig
  onHit: (projectile: Projectile) => void
  effectsManager: EffectsManager
}

export class Projectile {
  private scene: Phaser.Scene
  private sprite: Phaser.GameObjects.Graphics
  private targetX: number
  private targetY: number
  private speed: number
  public damage: number
  public unitConfig: UnitConfig
  private onHit: (projectile: Projectile) => void
  private active: boolean = true
  private trail: Phaser.GameObjects.Particles.ParticleEmitter | null = null
  private effectsManager: EffectsManager

  constructor(config: ProjectileConfig) {
    this.scene = config.scene
    this.targetX = config.targetX
    this.targetY = config.targetY
    this.damage = config.damage
    this.speed = config.speed
    this.unitConfig = config.unitConfig
    this.onHit = config.onHit
    this.effectsManager = config.effectsManager

    // Create projectile visual based on age/type
    this.sprite = this.scene.add.graphics()
    this.sprite.x = config.x
    this.sprite.y = config.y

    this.drawProjectile()

    // Create trail effect
    if (this.effectsManager) {
      this.trail = this.effectsManager.createProjectileTrail(this.sprite, this.unitConfig.age)
    }

    // Calculate trajectory
    const angle = Phaser.Math.Angle.Between(config.x, config.y, this.targetX, this.targetY)
    this.scene.physics.add.existing(this.sprite)
    const body = this.sprite.body as Phaser.Physics.Arcade.Body
    body.setVelocity(
      Math.cos(angle) * this.speed,
      Math.sin(angle) * this.speed
    )
  }

  private drawProjectile() {
    const age = this.unitConfig.age
    this.sprite.clear()

    if (age === 'stone') {
      // Stone/rock
      this.sprite.fillStyle(0x8b7355, 1)
      this.sprite.fillCircle(0, 0, 4)
      this.sprite.lineStyle(1, 0x654321, 0.8)
      this.sprite.strokeCircle(0, 0, 4)
    } else if (age === 'medieval') {
      // Arrow or boulder
      if (this.unitConfig.role === 'siege') {
        // Boulder
        this.sprite.fillStyle(0x5d5d5d, 1)
        this.sprite.fillCircle(0, 0, 8)
        this.sprite.fillStyle(0x000000, 0.3)
        this.sprite.fillCircle(2, 2, 3)
      } else {
        // Arrow
        this.sprite.fillStyle(0x8b4513, 1)
        this.sprite.fillRect(-8, -1, 14, 2)
        this.sprite.fillStyle(0xc0c0c0, 1)
        this.sprite.fillTriangle(6, 0, 10, -3, 10, 3)
      }
    } else if (age === 'modern') {
      // Bullet or shell
      if (this.unitConfig.role === 'siege') {
        // Tank shell
        this.sprite.fillStyle(0x4a5568, 1)
        this.sprite.fillEllipse(0, 0, 10, 6)
        this.sprite.fillStyle(0xfbbf24, 0.8)
        this.sprite.fillCircle(-4, 0, 3)
      } else {
        // Bullet
        this.sprite.fillStyle(0xffd700, 1)
        this.sprite.fillCircle(0, 0, 3)
        this.sprite.lineStyle(2, 0xffa500, 0.8)
        this.sprite.strokeCircle(0, 0, 2)
      }
    } else if (age === 'future') {
      // Energy projectile
      this.sprite.fillStyle(this.unitConfig.accentColor, 1)
      this.sprite.fillCircle(0, 0, 6)
      this.sprite.fillStyle(0xffffff, 0.6)
      this.sprite.fillCircle(0, 0, 4)

      // Glow effect
      this.sprite.lineStyle(3, this.unitConfig.accentColor, 0.3)
      this.sprite.strokeCircle(0, 0, 8)
    }
  }

  update(): boolean {
    if (!this.active) {
      return false
    }

    // Check if reached target or went too far
    const distance = Phaser.Math.Distance.Between(
      this.sprite.x,
      this.sprite.y,
      this.targetX,
      this.targetY
    )

    // Rotate projectile to face movement direction (except for circular projectiles)
    if (this.unitConfig.age === 'medieval' && this.unitConfig.role !== 'siege') {
      const body = this.sprite.body as Phaser.Physics.Arcade.Body
      const angle = Math.atan2(body.velocity.y, body.velocity.x)
      this.sprite.rotation = angle
    }

    if (distance < this.speed / 60 || this.sprite.x < -100 || this.sprite.x > this.scene.cameras.main.width + 100) {
      this.hit()
      return false
    }

    return true
  }

  private hit() {
    this.active = false

    // Impact effect
    if (this.effectsManager) {
      if (this.unitConfig.splashRadius) {
        // Explosion for siege weapons
        this.effectsManager.explosion(
          this.sprite.x,
          this.sprite.y,
          this.unitConfig.splashRadius / 100,
          40
        )
      } else {
        // Regular impact
        this.effectsManager.impact(this.sprite.x, this.sprite.y, this.unitConfig.age === 'future')
      }
    }

    this.onHit(this)
  }

  getPosition() {
    return { x: this.sprite.x, y: this.sprite.y }
  }

  getSplashRadius(): number {
    return this.unitConfig.splashRadius || 0
  }

  destroy() {
    this.active = false
    if (this.trail) {
      this.trail.stop()
      this.scene.time.delayedCall(500, () => {
        if (this.trail && this.trail.manager) {
          this.trail.manager.destroy()
        }
      })
    }
    this.sprite.destroy()
  }

  isActive(): boolean {
    return this.active
  }
}

// Projectile pool for performance
export class ProjectilePool {
  private projectiles: Projectile[] = []
  private scene: Phaser.Scene
  private effectsManager: EffectsManager

  constructor(scene: Phaser.Scene, effectsManager: EffectsManager) {
    this.scene = scene
    this.effectsManager = effectsManager
  }

  spawn(config: Omit<ProjectileConfig, 'scene' | 'effectsManager'>): Projectile {
    const projectile = new Projectile({
      ...config,
      scene: this.scene,
      effectsManager: this.effectsManager
    })
    this.projectiles.push(projectile)
    return projectile
  }

  update() {
    this.projectiles = this.projectiles.filter(p => {
      const active = p.update()
      if (!active) {
        p.destroy()
      }
      return active
    })
  }

  destroy() {
    this.projectiles.forEach(p => p.destroy())
    this.projectiles = []
  }

  getProjectiles(): Projectile[] {
    return this.projectiles
  }
}
