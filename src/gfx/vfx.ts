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

  /**
   * A PER-FRAME BUDGET FOR THE PER-HIT EFFECTS.
   *
   * The Carnage signatures below hang off individual blows, and Carnage fields
   * eight Husks in a squad that all swing on the same beat. Eight mauls is
   * forty-eight tweened sprites out of one frame, and the twentieth of those is
   * drawn underneath the other nineteen where nobody will ever see it. So the
   * first few each frame are drawn in full and the rest are dropped: the read is
   * identical and the cost is bounded.
   *
   * Only the high-frequency effects spend from this. The rare ones — a
   * possession, a rendering, a Maw's bite — are always drawn, because those are
   * the moments the effect exists to announce.
   */
  private budgetFrame = -1
  private budgetLeft = 0

  private afford(cost = 1): boolean {
    const frame = this.scene.game.loop.frame
    if (frame !== this.budgetFrame) {
      this.budgetFrame = frame
      this.budgetLeft = Math.max(2, Math.round(6 * this.quality))
    }
    if (this.budgetLeft < cost) return false
    this.budgetLeft -= cost
    return true
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

  // ────────────────────── The creeds' own signatures ──────────────────────
  //
  // Each of these belongs to exactly one mechanism in the doctrine web, and
  // each is built to be told apart at a glance in a crowded fight: the motion
  // carries the meaning. Things being TAKEN collapse inward; things being
  // DESTROYED throw outward; things GROWING rise and spread.

  /** THE BANISHMENT — the soul is tithed: a wisp torn loose and snuffed. */
  /**
   * A PRESSURE WAVE. One ring, flattened to the battle's perspective, thrown
   * outward fast and gone in a third of a second — the air itself being
   * shoved. The heavy hitters stack one of these under their impacts so the
   * blow reads in the ground, not just in the body it lands on.
   */
  shockwave(x: number, y: number, scale: number, color = 0xff2d20): void {
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(322)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(0.12, 0.045)
      .setAlpha(0.95)
    this.scene.tweens.add({
      targets: ring,
      scaleX: scale,
      scaleY: scale * 0.38,
      alpha: 0,
      duration: 330,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    })
  }

  banish(x: number, y: number): void {
    this.lighting?.flash(x, y, 96, 0xb46bff, 0.9)
    // A hole in the light where the soul was, so the violet reads even
    // against a red gore burst at the same spot.
    const hole = this.scene.add
      .image(x, y, 'fx:soft')
      .setDepth(317)
      .setTint(0x1a0d2a)
      .setScale(0.8, 1.0)
      .setAlpha(0.75)
    this.scene.tweens.add({
      targets: hole,
      scaleX: 0.05,
      scaleY: 0.1,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeIn',
      onComplete: () => hole.destroy()
    })
    // The one ring in the game that closes instead of opening. Something was
    // taken from here.
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(318)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xb46bff)
      .setScale(2.3, 0.9)
      .setAlpha(0.95)
    this.scene.tweens.add({
      targets: ring,
      scaleX: 0.02,
      scaleY: 0.02,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeIn',
      onComplete: () => ring.destroy()
    })
    // The wisp: up, thinning, gone.
    const wisp = this.scene.add
      .image(x, y - 6, 'fx:soft')
      .setDepth(319)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xf0e2ff)
      .setScale(0.85, 1.5)
      .setAlpha(1)
    this.scene.tweens.add({
      targets: wisp,
      y: y - 74,
      scaleX: 0.06,
      scaleY: 0.3,
      alpha: 0,
      duration: 620,
      ease: 'Sine.easeIn',
      onComplete: () => wisp.destroy()
    })
    this.energy.setParticleTint(0x9a5ce0)
    this.energy.emitParticleAt(x, y - 4, Math.round(7 * this.quality))
  }

  /** THE DEAD BURY THE LINE — clods heap against a soldier that will not move. */
  buried(x: number, y: number): void {
    const q = this.quality
    // Debris thrown INWARD: the pile is closing around the boots.
    for (let i = 0; i < Math.round(6 * q); i += 1) {
      const side = i % 2 === 0 ? -1 : 1
      const from = x + side * (26 + rng.range(0, 16))
      const clod = this.scene.add
        .image(from, y - 20 - rng.range(0, 14), 'fx:debris')
        .setDepth(311)
        .setTint(i % 3 === 0 ? 0x6e241e : 0x4a3524)
        .setScale(rng.range(0.5, 0.95))
        .setAngle(rng.range(-180, 180))
      this.scene.tweens.add({
        targets: clod,
        x: x + rng.spread(10),
        y: y - 2,
        angle: clod.angle + rng.spread(220),
        alpha: 0.2,
        duration: 300 + rng.range(0, 160),
        ease: 'Quad.easeIn',
        onComplete: () => clod.destroy()
      })
    }
    this.dustPuff.setParticleTint(0x584434)
    this.dustPuff.emitParticleAt(x, y - 4, Math.round(5 * q))
    // The mound-line that has closed over the ankles.
    const heap = this.scene.add
      .image(x, y, 'fx:soft')
      .setDepth(309)
      .setTint(0x3b2a1e)
      .setAlpha(0)
      .setScale(0.7, 0.16)
    this.scene.tweens.add({
      targets: heap,
      alpha: 0.55,
      scaleX: 1.1,
      duration: 260,
      yoyo: true,
      hold: 500,
      onComplete: () => heap.destroy()
    })
  }

  /** FIRE SCOURS THE HAUNT — violet ash catches and burns away. */
  scour(x: number, y: number): void {
    this.lighting?.flash(x, y, 60, 0xff9a40, 0.6)
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(317)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xb46bff)
      .setScale(0.5, 0.2)
      .setAlpha(0.9)
    // Violet → ember orange as it goes: the haunt is being cremated.
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 460,
      onUpdate: tw => {
        const t = tw.getValue() ?? 0
        const r = Math.round(0xb4 + (0xff - 0xb4) * t)
        const g = Math.round(0x6b + (0x9a - 0x6b) * t)
        const bch = Math.round(0xff + (0x30 - 0xff) * t)
        ring.setTint((r << 16) | (g << 8) | bch)
      }
    })
    this.scene.tweens.add({
      targets: ring,
      scaleX: 1.5,
      scaleY: 0.5,
      alpha: 0,
      duration: 460,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy()
    })
    this.smoke.setParticleTint(0x6a4a70)
    this.smoke.emitParticleAt(x, y - 6, Math.round(3 * this.quality))
    this.sparks.setParticleTint(0xffb050)
    this.sparks.emitParticleAt(x, y - 4, Math.round(5 * this.quality))
  }

  /** THE GARDEN EATS — remains drawn into the rot, and something sprouts. */
  digest(x: number, y: number): void {
    const q = this.quality
    for (let i = 0; i < Math.round(5 * q); i += 1) {
      const mote = this.scene.add
        .image(x + rng.spread(30), y - rng.range(4, 22), 'fx:soft')
        .setDepth(313)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xbdf7a0)
        .setScale(0.22)
        .setAlpha(0.95)
      this.scene.tweens.add({
        targets: mote,
        x,
        y: y + 2,
        scale: 0.03,
        alpha: 0,
        duration: 380 + rng.range(0, 200),
        ease: 'Sine.easeIn',
        onComplete: () => mote.destroy()
      })
    }
    // The cap that pushes up where the body was.
    const cap = this.scene.add
      .image(x, y, 'fx:soft')
      .setDepth(314)
      .setTint(0xeaffd8)
      .setScale(0.02, 0.02)
      .setAlpha(0.95)
    this.scene.tweens.add({
      targets: cap,
      scaleX: 0.36,
      scaleY: 0.46,
      y: y - 9,
      alpha: 0,
      duration: 700,
      ease: 'Back.easeOut',
      onComplete: () => cap.destroy()
    })
  }

  /** A GROWN GARDEN SMOTHERS EMBERS — wet rot rolls over the flame. */
  smother(x: number, y: number): void {
    const q = this.quality
    this.smoke.setParticleTint(0xc8e8c0)
    this.smoke.emitParticleAt(x, y - 8, Math.round(4 * q))
    // Steam: the fire is being drowned, not blown out.
    for (let i = 0; i < Math.round(4 * q); i += 1) {
      const steam = this.scene.add
        .image(x + rng.spread(26), y - 4, 'fx:soft')
        .setDepth(315)
        .setTint(0xeaf6e6)
        .setScale(0.1)
        .setAlpha(0.6)
      this.scene.tweens.add({
        targets: steam,
        y: y - 40 - rng.range(0, 22),
        scale: 0.42,
        alpha: 0,
        duration: 620 + rng.range(0, 240),
        ease: 'Sine.easeOut',
        onComplete: () => steam.destroy()
      })
    }
    // Embers guttering downward instead of flying.
    this.sparks.setParticleTint(0xff7a30)
    this.sparks.emitParticleAt(x, y - 2, Math.round(3 * q))
  }

  /** THE FLESH WALL — a shot slams into the piled dead and stops. */
  wallBlock(x: number, y: number): void {
    const q = this.quality
    this.lighting?.flash(x, y, 34, 0xa03830, 0.3)
    this.dustPuff.setParticleTint(0x4a2018)
    this.dustPuff.emitParticleAt(x, y, Math.round(5 * q))
    // Bone chips: pale, angular, thrown back the way the shot came.
    for (let i = 0; i < Math.round(4 * q); i += 1) {
      const chip = this.scene.add
        .image(x, y - rng.range(0, 10), 'fx:debris')
        .setDepth(313)
        .setTint(0xe8dcc4)
        .setScale(rng.range(0.3, 0.6))
      this.scene.tweens.add({
        targets: chip,
        x: x + rng.spread(58),
        y: y - rng.range(10, 40),
        angle: rng.spread(300),
        alpha: 0,
        duration: 420 + rng.range(0, 200),
        ease: 'Quad.easeOut',
        onComplete: () => chip.destroy()
      })
    }
    if (save.settings.bloodEffects) {
      this.blood.setParticleTint(0x7a1410)
      this.blood.emitParticleAt(x, y, Math.round(3 * q))
    }
  }

  /** THE HEX UNMAKES THE WARD — the shield does not break, it stops being. */
  wardBreak(x: number, y: number): void {
    this.lighting?.flash(x, y, 56, 0x8a4fd0, 0.55)
    // Plate-shards of the ward itself, flying apart and fading violet.
    for (let i = 0; i < Math.round(7 * this.quality); i += 1) {
      const a = (i / 7) * Math.PI * 2
      const shard = this.scene.add
        .image(x, y, 'fx:spark')
        .setDepth(321)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0x9fd4ff)
        .setScale(0.7, 0.25)
        .setAngle((a * 180) / Math.PI)
        .setAlpha(0.95)
      this.scene.tweens.add({
        targets: shard,
        x: x + Math.cos(a) * 44,
        y: y + Math.sin(a) * 30,
        scaleX: 0.1,
        alpha: 0,
        duration: 340,
        ease: 'Quad.easeOut',
        onComplete: () => shard.destroy()
      })
    }
    const stain = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(320)
      .setTint(0x8a4fd0)
      .setScale(0.15)
      .setAlpha(0.8)
    this.scene.tweens.add({
      targets: stain,
      scale: 0.9,
      alpha: 0,
      duration: 420,
      onComplete: () => stain.destroy()
    })
  }

  /** THE GARDEN CLEANSES — hostile control burned off by the rot underfoot. */
  cleanse(x: number, y: number): void {
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(316)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0x8fd694)
      .setScale(0.1, 0.05)
      .setAlpha(0.7)
    this.scene.tweens.add({
      targets: ring,
      scaleX: 0.8,
      scaleY: 0.26,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    })
    // Motes lifting OFF the soldier: the mark leaving, not arriving.
    for (let i = 0; i < Math.round(4 * this.quality); i += 1) {
      const m = this.scene.add
        .image(x + rng.spread(18), y - 4, 'fx:soft')
        .setDepth(317)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xd8f0c0)
        .setScale(0.12)
        .setAlpha(0.8)
      this.scene.tweens.add({
        targets: m,
        y: y - 40 - rng.range(0, 16),
        alpha: 0,
        scale: 0.02,
        duration: 460 + rng.range(0, 160),
        onComplete: () => m.destroy()
      })
    }
  }

  /** THE CIRCLE TITHES THE GROWTH — green rises, turns violet, is drunk. */
  tithe(x: number, y: number): void {
    for (let i = 0; i < Math.round(4 * this.quality); i += 1) {
      const m = this.scene.add
        .image(x + rng.spread(40), y, 'fx:soft')
        .setDepth(318)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0x8fd694)
        .setScale(0.15)
        .setAlpha(0.85)
      this.scene.tweens.add({
        targets: m,
        y: y - 54 - rng.range(0, 20),
        x: m.x + rng.spread(14),
        alpha: 0,
        scale: 0.04,
        duration: 620 + rng.range(0, 200),
        ease: 'Sine.easeIn',
        onComplete: () => m.destroy()
      })
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 620,
        onUpdate: tw => {
          const t = tw.getValue() ?? 0
          const r = Math.round(0x8f + (0xb4 - 0x8f) * t)
          const g = Math.round(0xd6 + (0x6b - 0xd6) * t)
          const bch = Math.round(0x94 + (0xff - 0x94) * t)
          m.setTint((r << 16) | (g << 8) | bch)
        }
      })
    }
  }

  /** A HELD BANNER'S RALLY — the garrison takes heart, in its creed's colour. */
  rally(x: number, y: number, color: number): void {
    this.lighting?.flash(x, y - 30, 90, color, 0.5)
    const pulse = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(315)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(0.1, 0.05)
      .setAlpha(0.75)
    this.scene.tweens.add({
      targets: pulse,
      scaleX: 2.2,
      scaleY: 0.7,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => pulse.destroy()
    })
    this.energy.setParticleTint(color)
    this.energy.emitParticleAt(x, y - 20, Math.round(5 * this.quality))
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

  // ───────────────────────── The Carnage signatures ─────────────────────────
  //
  // One effect per body, each tied to the thing that body actually does, and
  // each built out of a different motion so they never blur together on a busy
  // field: an arc, a lash, an inward suck, a shockwave, a knit, a thread.
  //
  // All of them are cosmetic and driven from the simulation's own events, so
  // nothing here can move the fingerprint.

  /**
   * THE CROSS-CLEAVE. Two crescents through the same point from opposite sides,
   * a tenth of a second apart — the Flenser's whole read, drawn rather than
   * implied. The stagger lives here rather than at the call site because the
   * simulation lands one damage event per swing and should not have to know that
   * the animation has two contacts in it.
   */
  cleaveArc(x: number, y: number, dir: number): void {
    if (!this.afford(2)) return
    for (let i = 0; i < 2; i += 1) {
      const back = i === 1
      const arc = this.scene.add
        .image(x + dir * 14, y, 'fx:ring')
        .setDepth(320)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(back ? 0xff8a72 : 0xc0392b)
        .setScale(0.1, 0.02)
        .setRotation((back ? -0.7 : 0.7) * dir)
        .setAlpha(0)
      this.scene.tweens.add({
        targets: arc,
        scaleX: 0.5,
        scaleY: 0.26,
        rotation: arc.rotation + (back ? 1.5 : -1.5) * dir,
        alpha: { from: 0.9, to: 0 },
        duration: 210,
        delay: i * 100,
        ease: 'Quad.easeOut',
        onComplete: () => arc.destroy()
      })
    }
    this.blood.emitParticleAt(x + dir * 20, y, Math.round(5 * this.quality))
  }

  /**
   * A TENTACLE LASH. A thin fast line out and back — nothing else on the field
   * moves in a straight line this quickly, which is what makes the Shrike's
   * four stabs legible as four separate events.
   */
  lash(x: number, y: number, tx: number, ty: number): void {
    if (!this.afford(1)) return
    const len = Math.hypot(tx - x, ty - y)
    const bar = this.scene.add
      .image(x, y, 'fx:soft')
      .setDepth(322)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xd9736a)
      .setOrigin(0, 0.5)
      .setRotation(Math.atan2(ty - y, tx - x))
      .setDisplaySize(4, 3)
      .setAlpha(0.95)
    this.scene.tweens.add({
      targets: bar,
      displayWidth: len,
      duration: 70,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: bar,
          displayWidth: 4,
          alpha: 0,
          duration: 110,
          ease: 'Quad.easeIn',
          onComplete: () => bar.destroy()
        })
      }
    })
    this.impact(tx, ty, 0xe6dfc4, 0.7, true)
  }

  /**
   * GORGING. Everything nearby is dragged INWARD and swallowed — the only
   * effect in the game whose particles converge instead of spreading, which is
   * exactly why the Monstrum reads as eating rather than exploding.
   */
  gorge(x: number, y: number, power = 1): void {
    if (!this.afford(2)) return
    for (let i = 0; i < Math.round(7 * power * this.quality); i += 1) {
      const a = rng.range(0, Math.PI * 2)
      const d = 30 + rng.range(0, 40) * power
      const m = this.scene.add
        .image(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 'fx:meat')
        .setDepth(319)
        .setTint(0xc4544a)
        .setScale(0.7)
        .setAlpha(0.9)
      this.scene.tweens.add({
        targets: m,
        x,
        y,
        scale: 0.2,
        alpha: 0,
        duration: 300 + rng.range(0, 160),
        ease: 'Quad.easeIn',
        onComplete: () => m.destroy()
      })
    }
    // And it swells. A short outward pulse on the body itself, so the eye is
    // told the mass took the meat in rather than merely deleting it.
    const swell = this.scene.add
      .image(x, y, 'fx:soft')
      .setDepth(316)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0x8a2a24)
      .setScale(0.2)
      .setAlpha(0.4)
    this.scene.tweens.add({
      targets: swell,
      scale: 0.55 * power,
      alpha: 0,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => swell.destroy()
    })
  }

  /**
   * THE BITE. A ring shockwave with a hard crunch of debris, and the screen
   * takes a small hit — the Great Maw is the only body that gets to shake the
   * camera on a normal attack.
   */
  bite(x: number, y: number, power = 1): void {
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(321)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffd9b4)
      .setScale(0.06)
      .setAlpha(0.85)
    this.scene.tweens.add({
      targets: ring,
      scale: 0.44 * power,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy()
    })
    this.debris.emitParticleAt(x, y, Math.round(8 * power * this.quality))
    this.blood.emitParticleAt(x, y, Math.round(10 * power * this.quality))
    this.shake(1.6 * power, 90)
    this.hitStop(28)
  }

  /**
   * KNITTING. The Flesh Wall closing itself back up: short bone-coloured
   * stitches appearing across the wound and fading, rather than a heal glow.
   */
  knit(x: number, y: number, height: number): void {
    for (let i = 0; i < Math.round(5 * this.quality); i += 1) {
      const sx = x + rng.spread(height * 0.3)
      const sy = y - rng.range(0, height * 0.7)
      const st = this.scene.add
        .image(sx, sy, 'fx:bone')
        .setDepth(320)
        .setTint(0xe6dfc4)
        .setRotation(rng.spread(1.2))
        .setScale(0.5)
        .setAlpha(0)
      this.scene.tweens.add({
        targets: st,
        alpha: 0.9,
        duration: 120,
        delay: i * 45,
        yoyo: true,
        hold: 90,
        onComplete: () => st.destroy()
      })
    }
  }

  /**
   * A FEEDING THREAD. Drawn from the victim to whatever is drinking — the Widow
   * and the Butcher. A line that shortens toward the drinker says "this is
   * going THERE", which a heal number on its own never does.
   */
  siphon(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.afford(1)) return
    const thread = this.scene.add
      .image(fromX, fromY, 'fx:soft')
      .setDepth(321)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xb8302c)
      .setOrigin(0, 0.5)
      .setRotation(Math.atan2(toY - fromY, toX - fromX))
      .setDisplaySize(Math.hypot(toX - fromX, toY - fromY), 2)
      .setAlpha(0.8)
    this.scene.tweens.add({
      targets: thread,
      displayWidth: 2,
      alpha: 0,
      duration: 240,
      ease: 'Quad.easeIn',
      onComplete: () => thread.destroy()
    })
  }

  /**
   * THE LEAP. A ring of kicked dust at take-off and a heavier one on landing,
   * so a Ripjaw's raid reads as two distinct impacts rather than a slide.
   */
  leapDust(x: number, y: number, power = 1): void {
    this.dustPuff.emitParticleAt(x, y, Math.round(9 * power * this.quality))
    const ring = this.scene.add
      .image(x, y, 'fx:ring')
      .setDepth(300)
      .setTint(0xbfae8a)
      .setScale(0.05, 0.02)
      .setAlpha(0.6)
    this.scene.tweens.add({
      targets: ring,
      scaleX: 0.4 * power,
      scaleY: 0.1 * power,
      alpha: 0,
      duration: 320,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy()
    })
  }

  /**
   * THE MAUL. A Husk does not swing a weapon — it throws its whole weight
   * forward, jaw first. So the effect is a low forward CONE hugging the ground
   * rather than a burst at the point of contact: the only Carnage effect with a
   * direction and no centre.
   */
  maul(x: number, y: number, dir: number): void {
    if (!this.afford(1)) return
    for (let i = 0; i < Math.round(6 * this.quality); i += 1) {
      const reach = 6 + i * 5
      const g = this.scene.add
        .image(x + dir * reach, y + rng.spread(4), 'fx:blood')
        .setDepth(318)
        .setTint(0x8f2420)
        .setScale(0.75 - i * 0.06)
        .setAlpha(0.85)
      this.scene.tweens.add({
        targets: g,
        x: g.x + dir * (18 + i * 6),
        y: g.y + 8 + i * 2,
        scale: 0.1,
        alpha: 0,
        duration: 200 + i * 24,
        ease: 'Quad.easeOut',
        onComplete: () => g.destroy()
      })
    }
    this.blood.emitParticleAt(x + dir * 16, y, Math.round(4 * this.quality))
  }

  /**
   * RENDERING. The Carrion Choir does not heal a soldier, it builds one. A
   * bone-white column climbs out of the ground and resolves — the only effect
   * here that travels UPWARD, which is what separates a raising from a heal.
   */
  render(x: number, y: number, height: number): void {
    const column = this.scene.add
      .image(x, y, 'fx:soft')
      .setDepth(317)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xd8cfae)
      .setOrigin(0.5, 1)
      .setDisplaySize(height * 0.5, 4)
      .setAlpha(0.75)
    this.scene.tweens.add({
      targets: column,
      displayHeight: height * 1.05,
      alpha: 0,
      duration: 460,
      ease: 'Cubic.easeOut',
      onComplete: () => column.destroy()
    })
    for (let i = 0; i < Math.round(5 * this.quality); i += 1) {
      const sh = this.scene.add
        .image(x + rng.spread(height * 0.3), y, 'fx:bone')
        .setDepth(319)
        .setTint(0xe6dfc4)
        .setScale(0.45)
        .setAlpha(0.9)
      this.scene.tweens.add({
        targets: sh,
        y: y - height * (0.5 + rng.range(0, 0.5)),
        rotation: rng.spread(2.4),
        alpha: 0,
        duration: 420 + rng.range(0, 180),
        ease: 'Quad.easeOut',
        onComplete: () => sh.destroy()
      })
    }
    this.lighting?.flash(x, y - height * 0.4, 90, 0xd8cfae, 0.6)
  }

  /**
   * THE POSSESSION. Three rings falling INWARD and DOWN onto the host from
   * above — nothing else in the game contracts from off-screen onto a single
   * body, and the Incarnation arriving should never be mistaken for a buff.
   */
  possession(x: number, y: number, height: number): void {
    for (let i = 0; i < 3; i += 1) {
      const ring = this.scene.add
        .image(x, y - height * (1.6 + i * 0.5), 'fx:ring')
        .setDepth(323)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xff3a2c)
        .setScale(0.9, 0.34)
        .setAlpha(0)
      this.scene.tweens.add({
        targets: ring,
        y,
        scaleX: 0.14,
        scaleY: 0.05,
        alpha: 0.95,
        duration: 300,
        delay: i * 70,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          this.scene.tweens.add({
            targets: ring,
            scaleX: 0.7,
            alpha: 0,
            duration: 140,
            onComplete: () => ring.destroy()
          })
        }
      })
    }
    this.lighting?.flash(x, y - height * 0.5, 170, 0xff3a2c, 1.3)
  }

  /**
   * A FEEDING TETHER. The Widow's version of the Butcher's thread, and it must
   * not read as the same thing: the line HOLDS and a bead of blood crawls up it,
   * so the drinking is visibly slow and visibly coming from above.
   */
  tether(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.afford(1)) return
    const line = this.scene.add
      .image(fromX, fromY, 'fx:soft')
      .setDepth(320)
      .setTint(0x6e1418)
      .setOrigin(0, 0.5)
      .setRotation(Math.atan2(toY - fromY, toX - fromX))
      .setDisplaySize(Math.hypot(toX - fromX, toY - fromY), 2)
      .setAlpha(0.7)
    const bead = this.scene.add
      .image(fromX, fromY, 'fx:blood')
      .setDepth(321)
      .setTint(0xd0342c)
      .setScale(0.8)
      .setAlpha(1)
    this.scene.tweens.add({
      targets: bead,
      x: toX,
      y: toY,
      scale: 0.3,
      duration: 300,
      ease: 'Sine.easeIn',
      onComplete: () => bead.destroy()
    })
    this.scene.tweens.add({
      targets: line,
      alpha: 0,
      duration: 340,
      onComplete: () => line.destroy()
    })
  }

  /**
   * RUMMAGING. A Bonewright working a corpse over: short low flicks of dirt and
   * gore thrown BACKWARD between its legs, like a dog digging. Small, repeated,
   * and deliberately unimpressive — it is a labourer, not a soldier.
   */
  rummage(x: number, y: number, dir: number): void {
    if (!this.afford(1)) return
    for (let i = 0; i < Math.round(4 * this.quality); i += 1) {
      const d = this.scene.add
        .image(x, y - 2, i % 2 === 0 ? 'fx:debris' : 'fx:blood')
        .setDepth(316)
        .setTint(i % 2 === 0 ? 0x7a6a52 : 0x8f2420)
        .setScale(0.5)
        .setAlpha(0.9)
      this.scene.tweens.add({
        targets: d,
        x: x - dir * (10 + rng.range(0, 18)),
        y: y - rng.range(6, 16),
        alpha: 0,
        scale: 0.15,
        duration: 260 + rng.range(0, 120),
        ease: 'Quad.easeOut',
        onComplete: () => d.destroy()
      })
    }
  }

  /**
   * THE RANK FLINCHES. The Headsman's effect, and the only one that travels
   * SIDEWAYS along the file rather than radiating from a point.
   *
   * A head comes off and the men either side of it feel it. Two thin dark bands
   * run out along the ground away from the body, low and fast, and fade at the
   * edge of what the flinch reached — so the effect draws the actual radius of
   * the rule rather than decorating the kill. Nothing else in the vocabulary
   * moves like this, which is the point: a busy lane still reads.
   */
  flinch(x: number, y: number, reach: number): void {
    if (!this.afford(1)) return
    for (const dir of [-1, 1]) {
      const band = this.scene.add
        .image(x, y - 4, 'fx:flash')
        .setDepth(314)
        .setTint(0x2a1d22)
        .setAlpha(0.55)
        .setScale(0.12, 0.06)
      this.scene.tweens.add({
        targets: band,
        x: x + dir * reach * 0.6,
        scaleX: reach / 260,
        scaleY: 0.02,
        alpha: 0,
        duration: 300,
        ease: 'Quad.easeOut',
        onComplete: () => band.destroy()
      })
    }
    this.lighting?.flash(x, y - 10, 90, 0x6b3b46, 0.5)
  }

  /**
   * OSSIFYING. A Boneling assembling itself: shards arrive on ARCS from all
   * round and snap together, then one hard white frame. Converging like the
   * Monstrum's gorge, but bone rather than meat, and it ends in a snap instead
   * of a swallow — the difference between being eaten and being built.
   */
  ossify(x: number, y: number, height: number): void {
    if (!this.afford(2)) return
    for (let i = 0; i < Math.round(9 * this.quality); i += 1) {
      const a = rng.range(0, Math.PI * 2)
      const d = 40 + rng.range(0, 50)
      const sh = this.scene.add
        .image(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 'fx:bone')
        .setDepth(320)
        .setTint(0xe6dfc4)
        .setRotation(a)
        .setScale(0.55)
        .setAlpha(0.9)
      this.scene.tweens.add({
        targets: sh,
        x: x + rng.spread(height * 0.14),
        y: y - height * 0.35 + rng.spread(height * 0.2),
        rotation: a + rng.spread(3),
        scale: 0.3,
        alpha: 0,
        duration: 260 + rng.range(0, 120),
        ease: 'Back.easeIn',
        onComplete: () => sh.destroy()
      })
    }
    const snap = this.scene.add
      .image(x, y - height * 0.4, 'fx:flash')
      .setDepth(322)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff4d8)
      .setScale(0.1)
      .setAlpha(0)
    this.scene.tweens.add({
      targets: snap,
      scale: 0.5,
      alpha: 0.8,
      duration: 90,
      delay: 300,
      yoyo: true,
      onComplete: () => snap.destroy()
    })
    this.lighting?.flash(x, y - height * 0.4, 100, 0xe6dfc4, 0.8)
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
