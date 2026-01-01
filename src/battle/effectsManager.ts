import Phaser from 'phaser'

export class EffectsManager {
  private scene: Phaser.Scene
  private particleEmitters: Map<string, Phaser.GameObjects.Particles.ParticleEmitter>

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.particleEmitters = new Map()
    this.createParticles()
  }

  private createParticles() {
    // Blood splatter particles
    const bloodParticles = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 50, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      gravityY: 300,
      tint: [0x8b0000, 0xff0000, 0xdc143c],
      blendMode: 'NORMAL',
      emitting: false
    })
    this.particleEmitters.set('blood', bloodParticles.createEmitter({}))

    // Explosion particles
    const explosionParticles = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 100, max: 400 },
      angle: { min: 0, max: 360 },
      scale: { start: 2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 800,
      tint: [0xff4500, 0xff8c00, 0xffd700, 0xff0000],
      blendMode: 'ADD',
      emitting: false
    })
    this.particleEmitters.set('explosion', explosionParticles.createEmitter({}))

    // Muzzle flash particles
    const muzzleFlashParticles = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 100, max: 200 },
      angle: { min: -20, max: 20 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 150,
      tint: [0xffff00, 0xffa500],
      blendMode: 'ADD',
      emitting: false
    })
    this.particleEmitters.set('muzzle', muzzleFlashParticles.createEmitter({}))

    // Impact sparks
    const sparkParticles = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 50, max: 150 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 300,
      gravityY: 200,
      tint: [0xffffff, 0xffff00, 0xffa500],
      blendMode: 'ADD',
      emitting: false
    })
    this.particleEmitters.set('spark', sparkParticles.createEmitter({}))

    // Dust particles
    const dustParticles = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 20, max: 60 },
      angle: { min: -120, max: -60 },
      scale: { start: 1.5, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 800,
      tint: [0x8b7355, 0xa0826d, 0x6b5d4f],
      blendMode: 'NORMAL',
      emitting: false
    })
    this.particleEmitters.set('dust', dustParticles.createEmitter({}))

    // Energy particles (for future units)
    const energyParticles = this.scene.add.particles(0, 0, 'particle', {
      speed: { min: 80, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 600,
      tint: [0x00ffff, 0x0080ff, 0x8000ff],
      blendMode: 'ADD',
      emitting: false
    })
    this.particleEmitters.set('energy', energyParticles.createEmitter({}))
  }

  bloodSplatter(x: number, y: number, amount: number = 15) {
    const emitter = this.particleEmitters.get('blood')
    if (emitter) {
      emitter.explode(amount, x, y)
    }
  }

  explosion(x: number, y: number, radius: number = 1, intensity: number = 30) {
    const emitter = this.particleEmitters.get('explosion')
    if (emitter) {
      emitter.setConfig({
        speed: { min: 100 * radius, max: 300 * radius },
        scale: { start: 1.5 * radius, end: 0 }
      })
      emitter.explode(intensity, x, y)
    }

    // Screen shake
    this.scene.cameras.main.shake(200 * radius, 0.005 * radius)
  }

  muzzleFlash(x: number, y: number, direction: number) {
    const emitter = this.particleEmitters.get('muzzle')
    if (emitter) {
      const angle = direction > 0 ? 0 : 180
      emitter.setConfig({
        angle: { min: angle - 20, max: angle + 20 }
      })
      emitter.explode(8, x, y)
    }
  }

  impact(x: number, y: number, isEnergy: boolean = false) {
    const emitterKey = isEnergy ? 'energy' : 'spark'
    const emitter = this.particleEmitters.get(emitterKey)
    if (emitter) {
      emitter.explode(12, x, y)
    }
  }

  dustCloud(x: number, y: number) {
    const emitter = this.particleEmitters.get('dust')
    if (emitter) {
      emitter.explode(10, x, y)
    }
  }

  // Screen effects
  screenShake(duration: number = 100, intensity: number = 0.005) {
    this.scene.cameras.main.shake(duration, intensity)
  }

  flash(color: number = 0xffffff, duration: number = 100) {
    this.scene.cameras.main.flash(duration,
      (color >> 16) & 0xff,
      (color >> 8) & 0xff,
      color & 0xff
    )
  }

  // Death effect
  unitDeath(x: number, y: number, isHeavy: boolean = false, age: string = 'stone') {
    // Blood splatter for organic units
    if (age !== 'future') {
      this.bloodSplatter(x, y, isHeavy ? 25 : 15)
    } else {
      // Energy dissipation for future units
      const emitter = this.particleEmitters.get('energy')
      if (emitter) {
        emitter.explode(20, x, y)
      }
    }

    // Impact dust
    this.dustCloud(x, y)

    // Screen shake for heavy units
    if (isHeavy) {
      this.screenShake(150, 0.008)
    }
  }

  // Hit feedback
  hitFeedback(x: number, y: number, isRanged: boolean, age: string = 'stone') {
    if (age === 'future') {
      this.impact(x, y, true) // Energy impact
    } else if (isRanged && age === 'modern') {
      this.impact(x, y, false) // Bullet spark
    } else {
      // Melee hit - small blood
      this.bloodSplatter(x, y, 5)
    }
  }

  // Projectile trail
  createProjectileTrail(projectile: Phaser.GameObjects.GameObject, age: string = 'stone') {
    if (age === 'modern') {
      // Smoke trail for bullets/shells
      const trail = this.scene.add.particles(0, 0, 'particle', {
        follow: projectile,
        speed: 0,
        scale: { start: 0.3, end: 0 },
        alpha: { start: 0.5, end: 0 },
        lifespan: 200,
        tint: 0x888888,
        blendMode: 'NORMAL',
        frequency: 20
      })
      return trail
    } else if (age === 'future') {
      // Energy trail
      const trail = this.scene.add.particles(0, 0, 'particle', {
        follow: projectile,
        speed: 20,
        scale: { start: 0.6, end: 0 },
        alpha: { start: 0.8, end: 0 },
        lifespan: 300,
        tint: [0x00ffff, 0x0080ff],
        blendMode: 'ADD',
        frequency: 15
      })
      return trail
    }
    return null
  }

  destroy() {
    this.particleEmitters.forEach(emitter => {
      if (emitter.manager) {
        emitter.manager.destroy()
      }
    })
    this.particleEmitters.clear()
  }
}
