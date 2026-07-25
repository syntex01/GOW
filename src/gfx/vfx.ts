import Phaser from 'phaser'
import { save } from '../core/save'
import { rng } from '../core/rng'
import type Lighting from './lighting'

const MAX_DECALS = 90

/**
 * All the transient eye candy: impacts, explosions, muzzle flashes, blood,
 * ground decals, floating damage numbers, screen shake and hit-stop.
 */
export default class Vfx {
  private scene: Phaser.Scene
  private groundY: number

  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter
  private blood!: Phaser.GameObjects.Particles.ParticleEmitter
  private debris!: Phaser.GameObjects.Particles.ParticleEmitter
  private dustPuff!: Phaser.GameObjects.Particles.ParticleEmitter
  private energy!: Phaser.GameObjects.Particles.ParticleEmitter

  private decals: Phaser.GameObjects.Image[] = []
  private numberPool: Phaser.GameObjects.Text[] = []
  private hitStopUntil = 0

  /** Optional lighting rig; every effect below also emits light through it. */
  readonly lighting?: Lighting

  constructor(scene: Phaser.Scene, groundY: number, lighting?: Lighting) {
    this.scene = scene
    this.groundY = groundY
    this.lighting = lighting
    this.buildEmitters()
  }

  /** Convenience passthrough so callers do not need their own lighting ref. */
  light(x: number, y: number, radius: number, color: number, intensity = 1): void {
    this.lighting?.add(x, y, radius, color, intensity)
  }

  private get quality(): number {
    const q = save.settings.particleQuality
    return q === 'high' ? 1 : q === 'medium' ? 0.55 : 0.25
  }

  private buildEmitters(): void {
    this.sparks = this.scene.add
      .particles(0, 0, 'fx:spark', {
        lifespan: { min: 180, max: 420 },
        speed: { min: 90, max: 380 },
        scale: { start: 0.7, end: 0 },
        rotate: { min: -180, max: 180 },
        alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false
      })
      .setDepth(320)

    this.smoke = this.scene.add
      .particles(0, 0, 'fx:smoke', {
        lifespan: { min: 700, max: 1600 },
        speed: { min: 20, max: 110 },
        scale: { start: 0.28, end: 1.1 },
        alpha: { start: 0.5, end: 0 },
        rotate: { min: -60, max: 60 },
        emitting: false
      })
      .setDepth(300)

    this.blood = this.scene.add
      .particles(0, 0, 'fx:blood', {
        lifespan: { min: 320, max: 700 },
        speed: { min: 60, max: 260 },
        gravityY: 900,
        scale: { start: 0.85, end: 0.2 },
        alpha: { start: 0.95, end: 0.2 },
        emitting: false
      })
      .setDepth(310)

    this.debris = this.scene.add
      .particles(0, 0, 'fx:debris', {
        lifespan: { min: 500, max: 1200 },
        speed: { min: 90, max: 420 },
        gravityY: 1200,
        scale: { start: 0.9, end: 0.4 },
        rotate: { min: -400, max: 400 },
        alpha: { start: 1, end: 0.6 },
        emitting: false
      })
      .setDepth(312)

    this.dustPuff = this.scene.add
      .particles(0, 0, 'fx:soft', {
        lifespan: { min: 340, max: 720 },
        speed: { min: 10, max: 70 },
        scale: { start: 0.1, end: 0.34 },
        alpha: { start: 0.34, end: 0 },
        emitting: false
      })
      .setDepth(298)

    this.energy = this.scene.add
      .particles(0, 0, 'fx:soft', {
        lifespan: { min: 220, max: 560 },
        speed: { min: 40, max: 220 },
        scale: { start: 0.24, end: 0 },
        alpha: { start: 0.95, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false
      })
      .setDepth(322)
  }

  // ───────────────────────────── Effects ─────────────────────────────

  /** Weapon strike on a target: sparks plus, optionally, blood. */
  impact(x: number, y: number, color: number, power = 1, organic = true): void {
    const q = this.quality
    this.lighting?.flash(x, y, 40 * power, color, 0.35)
    this.sparks.setParticleTint(color)
    this.sparks.emitParticleAt(x, y, Math.max(1, Math.round(5 * power * q)))
    if (organic && save.settings.bloodEffects) {
      this.blood.setParticleTint(0x9c1c1c)
      this.blood.emitParticleAt(x, y, Math.max(1, Math.round(4 * power * q)))
    }
  }

  /** Sparks with no gore, for hitting armour, structures and machines. */
  ricochet(x: number, y: number, color = 0xffe08a, power = 1): void {
    this.lighting?.flash(x, y, 46 * power, color, 0.5)
    this.sparks.setParticleTint(color)
    this.sparks.emitParticleAt(x, y, Math.max(1, Math.round(7 * power * this.quality)))
  }

  explosion(x: number, y: number, radius: number, color = 0xffa640, big = false): void {
    const q = this.quality
    const scale = radius / 90
    this.lighting?.flash(x, y, radius * (big ? 3.4 : 2.6), color, big ? 1.5 : 1.1)

    const flash = this.scene.add
      .image(x, y, 'fx:flash')
      .setDepth(340)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(scale * 0.5)
    this.scene.tweens.add({
      targets: flash,
      scale: scale * 1.5,
      alpha: 0,
      duration: big ? 320 : 200,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy()
    })

    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(338)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(scale * 0.15)
      .setAlpha(0.85)
    this.scene.tweens.add({
      targets: ring,
      scaleX: scale * 1.25,
      scaleY: scale * 0.55,
      alpha: 0,
      duration: big ? 520 : 340,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    })

    this.smoke.setParticleTint(0x4a4a4a)
    this.smoke.emitParticleAt(x, y, Math.max(2, Math.round((big ? 18 : 10) * q)))
    this.sparks.setParticleTint(color)
    this.sparks.emitParticleAt(x, y, Math.max(2, Math.round((big ? 26 : 14) * q)))
    this.debris.setParticleTint(0x6b6355)
    this.debris.emitParticleAt(x, y, Math.max(1, Math.round((big ? 14 : 7) * q)))

    this.crater(x, Math.min(this.groundY, y + radius * 0.3), radius)
    this.shake(big ? 0.012 : 0.006, big ? 320 : 180)
  }

  muzzleFlash(x: number, y: number, angle: number, color: number, scale = 1): void {
    this.lighting?.flash(x, y, 110 * scale, color, 0.95)
    const flash = this.scene.add
      .image(x, y, 'fx:flash')
      .setDepth(330)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setRotation(angle)
      .setScale(scale * 0.34, scale * 0.2)
      .setAlpha(0.95)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: scale * 0.5,
      duration: 90,
      onComplete: () => flash.destroy()
    })
    if (this.quality > 0.5) {
      this.sparks.setParticleTint(color)
      this.sparks.emitParticleAt(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8, 2)
    }
  }

  /**
   * Ejected brass plus a puff of propellant smoke. Small, but it is the
   * difference between "a sprite fired" and "a gun went off".
   */
  gunSmoke(x: number, y: number, angle: number, dir: number): void {
    if (this.quality < 0.5) return
    this.smoke.setParticleTint(0xb8b0a0)
    this.smoke.emitParticleAt(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10, 1)
    this.debris.setParticleTint(0xd9c07a)
    this.debris.emitParticleAt(x - dir * 8, y - 2, 1)
  }

  energyBurst(x: number, y: number, color: number, power = 1): void {
    this.lighting?.flash(x, y, 90 * power, color, 0.8)
    this.energy.setParticleTint(color)
    this.energy.emitParticleAt(x, y, Math.max(2, Math.round(8 * power * this.quality)))
  }

  /** Kicked-up dirt when a unit takes a step or lands. */
  footDust(x: number, y: number): void {
    if (this.quality < 0.4) return
    this.dustPuff.setParticleTint(0xbfae8a)
    this.dustPuff.emitParticleAt(x, y, 1)
  }

  gore(x: number, y: number, power = 1): void {
    if (!save.settings.bloodEffects) {
      this.debris.setParticleTint(0x8a8378)
      this.debris.emitParticleAt(x, y, Math.round(5 * power * this.quality))
      return
    }
    this.blood.setParticleTint(0x8c1414)
    this.blood.emitParticleAt(x, y, Math.max(2, Math.round(12 * power * this.quality)))
    this.bloodPool(x, this.groundY - 2)
  }

  scrap(x: number, y: number, power = 1): void {
    this.debris.setParticleTint(0x8a929c)
    this.debris.emitParticleAt(x, y, Math.max(2, Math.round(10 * power * this.quality)))
    this.smoke.setParticleTint(0x3a3a3a)
    this.smoke.emitParticleAt(x, y, Math.max(1, Math.round(5 * power * this.quality)))
  }

  healPulse(x: number, y: number, radius: number, color = 0x9ff0c8): void {
    this.lighting?.flash(x, y, radius * 1.1, color, 0.55)
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(316)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(0.05)
      .setAlpha(0.65)
    this.scene.tweens.add({
      targets: ring,
      scaleX: radius / 54,
      scaleY: (radius / 54) * 0.4,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    })
    this.energy.setParticleTint(color)
    this.energy.emitParticleAt(x, y, Math.round(6 * this.quality))
  }

  // ───────────────────────────── Decals ─────────────────────────────

  private pushDecal(image: Phaser.GameObjects.Image): void {
    this.decals.push(image)
    while (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift()
      if (old) {
        this.scene.tweens.add({ targets: old, alpha: 0, duration: 400, onComplete: () => old.destroy() })
      }
    }
  }

  crater(x: number, y: number, radius: number): void {
    if (this.quality < 0.4) return
    const decal = this.scene.add
      .image(x, Math.min(y, this.groundY + 6), 'fx:soft')
      .setDepth(-880)
      .setTint(0x1a1409)
      .setAlpha(0.42)
      .setScale((radius / 64) * 1.6, (radius / 64) * 0.5)
    this.pushDecal(decal)
  }

  bloodPool(x: number, y: number): void {
    if (!save.settings.bloodEffects || this.quality < 0.4) return
    const decal = this.scene.add
      .image(x + rng.spread(8), y, 'fx:soft')
      .setDepth(-879)
      .setTint(0x6b0f0f)
      .setAlpha(0.5)
      .setScale(0.28 + rng.next() * 0.2, 0.09 + rng.next() * 0.05)
    this.pushDecal(decal)
  }

  // ─────────────────────────── Damage numbers ───────────────────────────

  damageNumber(x: number, y: number, amount: number, color: number, crit = false): void {
    if (!save.settings.showDamageNumbers || amount < 1) return
    const text =
      this.numberPool.pop() ??
      this.scene.add.text(0, 0, '', {
        fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#08111f',
        strokeThickness: 4
      })

    text
      .setText(crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`)
      .setPosition(x + rng.spread(10), y)
      .setOrigin(0.5)
      .setDepth(400)
      .setAlpha(1)
      .setScale(crit ? 1.45 : 1)
      .setColor(Phaser.Display.Color.IntegerToColor(color).rgba)
      .setActive(true)
      .setVisible(true)

    this.scene.tweens.add({
      targets: text,
      y: y - (crit ? 54 : 36),
      alpha: 0,
      scale: crit ? 1.0 : 0.8,
      duration: crit ? 900 : 700,
      ease: 'Quad.easeOut',
      onComplete: () => {
        text.setActive(false).setVisible(false)
        if (this.numberPool.length < 40) this.numberPool.push(text)
        else text.destroy()
      }
    })
  }

  floatingLabel(x: number, y: number, message: string, color: string): void {
    const text = this.scene.add
      .text(x, y, message, {
        fontFamily: '"Trebuchet MS", system-ui, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color,
        stroke: '#08111f',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(402)
    this.scene.tweens.add({
      targets: text,
      y: y - 46,
      alpha: 0,
      duration: 1100,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy()
    })
  }

  // ─────────────────────────── Camera feedback ───────────────────────────

  shake(intensity: number, duration: number): void {
    if (!save.settings.screenShake) return
    this.scene.cameras.main.shake(duration, intensity, true)
  }

  flash(color: number, duration = 140, alpha = 0.4): void {
    const c = Phaser.Display.Color.IntegerToColor(color)
    this.scene.cameras.main.flash(duration, c.red, c.green, c.blue, true, undefined, alpha)
  }

  /** Freezes the simulation for a beat so heavy hits land with weight. */
  hitStop(ms: number): void {
    this.hitStopUntil = Math.max(this.hitStopUntil, this.scene.time.now + ms)
  }

  isHitStopped(): boolean {
    return this.scene.time.now < this.hitStopUntil
  }

  destroy(): void {
    this.sparks.destroy()
    this.smoke.destroy()
    this.blood.destroy()
    this.debris.destroy()
    this.dustPuff.destroy()
    this.energy.destroy()
    this.decals.forEach(d => d.destroy())
    this.numberPool.forEach(t => t.destroy())
  }
}
