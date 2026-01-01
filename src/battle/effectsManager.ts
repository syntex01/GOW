import Phaser from 'phaser'

export class EffectsManager {
  private scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  bloodSplatter(x: number, y: number, amount: number = 15) {
    // Simple blood effect with graphics
    for (let i = 0; i < amount; i++) {
      const angle = Phaser.Math.Between(0, 360)
      const speed = Phaser.Math.Between(50, 150)
      const particle = this.scene.add.graphics()
      particle.fillStyle(0x8b0000, 1)
      particle.fillCircle(0, 0, Phaser.Math.Between(2, 4))
      particle.x = x
      particle.y = y

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle * Math.PI / 180) * speed,
        y: y + Math.sin(angle * Math.PI / 180) * speed + 50,
        alpha: 0,
        duration: 500,
        onComplete: () => particle.destroy()
      })
    }
  }

  explosion(x: number, y: number, radius: number = 1, intensity: number = 30) {
    // Explosion effect with circles
    for (let i = 0; i < intensity; i++) {
      const angle = Phaser.Math.Between(0, 360)
      const speed = Phaser.Math.Between(100, 300) * radius
      const particle = this.scene.add.graphics()

      const colors = [0xff4500, 0xff8c00, 0xffd700, 0xff0000]
      particle.fillStyle(Phaser.Utils.Array.GetRandom(colors), 1)
      particle.fillCircle(0, 0, Phaser.Math.Between(3, 8) * radius)
      particle.x = x
      particle.y = y

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle * Math.PI / 180) * speed,
        y: y + Math.sin(angle * Math.PI / 180) * speed,
        alpha: 0,
        scale: 0,
        duration: 800,
        onComplete: () => particle.destroy()
      })
    }

    // Screen shake
    this.scene.cameras.main.shake(200 * radius, 0.005 * radius)
  }

  muzzleFlash(x: number, y: number, direction: number) {
    const flash = this.scene.add.graphics()
    flash.fillStyle(0xffff00, 0.8)
    flash.fillCircle(0, 0, 8)
    flash.x = x
    flash.y = y

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2,
      duration: 150,
      onComplete: () => flash.destroy()
    })
  }

  impact(x: number, y: number, isEnergy: boolean = false) {
    const colors = isEnergy ? [0x00ffff, 0x0080ff] : [0xffffff, 0xffff00]

    for (let i = 0; i < 12; i++) {
      const angle = Phaser.Math.Between(0, 360)
      const speed = Phaser.Math.Between(50, 150)
      const particle = this.scene.add.graphics()
      particle.fillStyle(Phaser.Utils.Array.GetRandom(colors), 1)
      particle.fillCircle(0, 0, 3)
      particle.x = x
      particle.y = y

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle * Math.PI / 180) * speed,
        y: y + Math.sin(angle * Math.PI / 180) * speed,
        alpha: 0,
        duration: 300,
        onComplete: () => particle.destroy()
      })
    }
  }

  dustCloud(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const particle = this.scene.add.graphics()
      particle.fillStyle(0x8b7355, 0.6)
      particle.fillCircle(0, 0, Phaser.Math.Between(5, 10))
      particle.x = x + Phaser.Math.Between(-10, 10)
      particle.y = y

      this.scene.tweens.add({
        targets: particle,
        y: y - Phaser.Math.Between(20, 60),
        alpha: 0,
        scale: 1.5,
        duration: 800,
        onComplete: () => particle.destroy()
      })
    }
  }

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

  unitDeath(x: number, y: number, isHeavy: boolean = false, age: string = 'stone') {
    if (age !== 'future') {
      this.bloodSplatter(x, y, isHeavy ? 25 : 15)
    } else {
      // Energy dissipation for future units
      for (let i = 0; i < 20; i++) {
        const angle = Phaser.Math.Between(0, 360)
        const speed = Phaser.Math.Between(80, 180)
        const particle = this.scene.add.graphics()
        particle.fillStyle(Phaser.Utils.Array.GetRandom([0x00ffff, 0x0080ff, 0x8000ff]), 1)
        particle.fillCircle(0, 0, 5)
        particle.x = x
        particle.y = y

        this.scene.tweens.add({
          targets: particle,
          x: x + Math.cos(angle * Math.PI / 180) * speed,
          y: y + Math.sin(angle * Math.PI / 180) * speed,
          alpha: 0,
          duration: 600,
          onComplete: () => particle.destroy()
        })
      }
    }

    this.dustCloud(x, y)

    if (isHeavy) {
      this.screenShake(150, 0.008)
    }
  }

  hitFeedback(x: number, y: number, isRanged: boolean, age: string = 'stone') {
    if (age === 'future') {
      this.impact(x, y, true)
    } else if (isRanged && age === 'modern') {
      this.impact(x, y, false)
    } else {
      this.bloodSplatter(x, y, 5)
    }
  }

  createProjectileTrail(projectile: Phaser.GameObjects.GameObject, age: string = 'stone') {
    // Simplified trail - return null for now
    return null
  }

  destroy() {
    // Nothing to destroy in simplified version
  }
}
