import Phaser from 'phaser'
import { ballisticReach } from './projectile'
import { turretBarrelPivot } from '../gfx/textureFactory'
import { audio } from '../core/audio'
import { rng } from '../core/rng'
import { datan2, dcos, dsin } from './dmath'
import type { TurretDef } from '../data/types'
import { TURRETS_BY_ID, TURRET_SLOTS } from '../data/turrets'
import { FACTION_COLOR, UI } from '../gfx/palette'
import { RES } from '../gfx/pixel'
import { BASE_H, BASE_W, TURRET_SLOT_OFFSETS } from '../gfx/propArt'
import type Vfx from '../gfx/vfx'
import type { ArmorType, Damageable, DamageType, Faction, Layer } from './types'
import { ADVANCE_DIR } from './types'

export interface TurretSlot {
  def: TurretDef | null
  /** What was mounted here when it was destroyed, for autoforge rebuilds. */
  wreck?: { def: TurretDef; sinceMs: number }
  hp: number
  cooldown: number
  burstLeft: number
  burstTimer: number
  angle: number
  baseSprite?: Phaser.GameObjects.Image
  barrelSprite?: Phaser.GameObjects.Image
  recoil: number
}

/** A faction's fortress: the thing you must destroy to win. */
export default class Base implements Damageable {
  readonly faction: Faction
  readonly armor: ArmorType = 'structure'
  readonly layer: Layer = 'ground'
  readonly dir: 1 | -1

  x: number
  y: number
  hp: number
  maxHp: number
  alive = true
  radius: number
  centerOffsetY: number

  slots: TurretSlot[] = []

  private scene: Phaser.Scene
  private vfx: Vfx
  private sprite: Phaser.GameObjects.Image
  private smoke?: Phaser.GameObjects.Particles.ParticleEmitter
  private brazier?: Phaser.GameObjects.Particles.ParticleEmitter
  private age = -1
  /**
   * Which generation of seat this is, and therefore how big it is drawn.
   *
   * A commander's first seat is a hut on a bank; the one they retire into at
   * the last age is a citadel that fills the screen. The art was always five
   * distinct buildings — stockade, keep, bastion, bunker, citadel — but every
   * one of them was drawn at the same 200×250, so the progression read as a
   * change of style rather than a change of scale. Now it is both.
   */
  private generation = 0
  private flashTimer = 0
  private shakeOffset = 0

  onTurretFire?: (base: Base, slot: TurretSlot, target: Damageable) => void
  onDestroyed?: (base: Base) => void

  constructor(scene: Phaser.Scene, faction: Faction, x: number, groundY: number, maxHp: number, vfx: Vfx) {
    this.scene = scene
    this.faction = faction
    this.dir = ADVANCE_DIR[faction]
    this.x = x
    this.y = groundY
    this.hp = maxHp
    this.maxHp = maxHp
    this.vfx = vfx
    // The hittable footprint is narrower than the art so units stop at the wall.
    this.radius = BASE_W * 0.34
    this.centerOffsetY = -BASE_H * 0.4

    this.sprite = scene.add
      .image(x, groundY + 6, 'base:0:player')
      .setOrigin(0.5, 1)
      .setDepth(40)
      .setDisplaySize(BASE_W, BASE_H)
    // Not flipped. The fortress is drawn per faction, so mirroring it only
    // moves the key light to the upper left and puts that one building out of
    // step with everything else on screen.

    for (let i = 0; i < TURRET_SLOTS; i += 1) {
      this.slots.push({ def: null, hp: 0, cooldown: 0, burstLeft: 0, burstTimer: 0, angle: 0, recoil: 0 })
    }
  }

  /** How much bigger each generation of seat stands than the first. */
  static readonly SEAT_SCALE = [0.52, 0.68, 0.82, 0.95, 1.12]

  get seatScale(): number {
    return Base.SEAT_SCALE[Math.max(0, Math.min(Base.SEAT_SCALE.length - 1, this.generation))]
  }

  /**
   * Sets which generation this seat is, and re-sizes everything that depends on
   * it: the sprite, the hitbox radius, and how high its centre of mass sits.
   */
  setGeneration(generation: number): void {
    this.generation = generation
    const s = this.seatScale
    this.sprite.setDisplaySize(BASE_W * s, BASE_H * s)
    this.radius = BASE_W * 0.34 * s
    this.centerOffsetY = -BASE_H * 0.4 * s
  }

  /**
   * A superseded seat is visibly out of the war.
   *
   * It keeps its shape — the ruin is the point, and it is still standing in
   * the road — but loses its colour and its light, so a glance across the
   * board tells you which fortress still ends the game and which one is merely
   * in the way.
   */
  setDerelictLook(derelict: boolean): void {
    this.derelict = derelict
    this.sprite.setTint(derelict ? 0x7a8090 : 0xffffff)
    this.sprite.setAlpha(derelict ? 0.92 : 1)
  }

  /** Read by `emitLight`: a dead seat does not keep its braziers burning. */
  private derelict = false

  setAge(age: number, maxHp: number): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1
    this.maxHp = maxHp
    this.hp = Math.min(maxHp, maxHp * ratio + maxHp * 0.25)
    if (age === this.age) return
    this.age = age
    this.sprite.setTexture(`base:${age}:${this.faction}`)
    this.sprite.setDisplaySize(BASE_W, BASE_H)
    this.buildBrazier(age)
    // Rebuild turret visuals so they sit correctly on the new silhouette.
    this.slots.forEach((slot, i) => {
      if (slot.def) this.placeTurretSprites(i, slot.def)
    })
  }

  /**
   * Fire at the gate: an open brazier through the Renaissance, a glowing
   * exhaust vent once the fortress is industrial.
   */
  private buildBrazier(age: number): void {
    this.brazier?.destroy()
    const industrial = age >= 3
    const tint = industrial ? [0x8fd6ff, 0xc8f0ff] : [0xff8a2a, 0xffd07a]
    this.brazier = this.scene.add
      .particles(this.x + this.dir * BASE_W * 0.34, this.y - BASE_H * 0.12, 'fx:soft', {
        lifespan: { min: 520, max: 1000 },
        speedY: { min: -70, max: -26 },
        speedX: { min: -12, max: 12 },
        scale: { start: industrial ? 0.14 : 0.2, end: 0 },
        alpha: { start: 0.75, end: 0 },
        tint,
        frequency: industrial ? 90 : 55,
        quantity: 1,
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(46)
  }

  /** Where attackers stop and start hitting the wall. */
  getImpactX(): number {
    return this.x - this.dir * this.radius
  }

  buildTurret(slotIndex: number, turretId: string): boolean {
    const slot = this.slots[slotIndex]
    const def = TURRETS_BY_ID[turretId]
    if (!slot || !def) return false
    this.clearTurretSprites(slot)
    slot.wreck = undefined
    slot.def = def
    slot.hp = def.hp
    slot.cooldown = 0
    slot.burstLeft = 0
    slot.angle = 0
    this.placeTurretSprites(slotIndex, def)
    return true
  }

  sellTurret(slotIndex: number): number {
    const slot = this.slots[slotIndex]
    if (!slot?.def) return 0
    const refund = Math.round(slot.def.cost * 0.6 * (slot.hp / slot.def.hp))
    this.clearTurretSprites(slot)
    slot.wreck = undefined
    slot.def = null
    slot.hp = 0
    return refund
  }

  private clearTurretSprites(slot: TurretSlot): void {
    slot.baseSprite?.destroy()
    slot.barrelSprite?.destroy()
    slot.baseSprite = undefined
    slot.barrelSprite = undefined
  }

  private placeTurretSprites(slotIndex: number, def: TurretDef): void {
    const slot = this.slots[slotIndex]
    this.clearTurretSprites(slot)
    const [ox, oy] = TURRET_SLOT_OFFSETS[slotIndex]
    const wx = this.x + ox * this.dir
    const wy = this.y + oy

    slot.barrelSprite = this.scene.add
      .image(wx, wy - 8, `turret:${def.id}:barrel`)
      .setOrigin(...turretBarrelPivot(def.id))
      .setDepth(44)
      .setScale(1 / RES)
    slot.baseSprite = this.scene.add
      .image(wx, wy, `turret:${def.id}:base`)
      .setOrigin(0.5, 0.7)
      .setDepth(45)
      .setScale(1 / RES)
    slot.baseSprite.setFlipX(this.faction === 'enemy')
  }

  turretMuzzle(slotIndex: number): { x: number; y: number } {
    const [ox, oy] = TURRET_SLOT_OFFSETS[slotIndex]
    const slot = this.slots[slotIndex]
    const barrelLen = 46
    const wx = this.x + ox * this.dir
    const wy = this.y + oy - 8
    return {
      x: wx + dcos(slot.angle) * barrelLen * this.dir,
      y: wy + dsin(slot.angle) * barrelLen
    }
  }

  update(dtMs: number, candidates: Damageable[]): void {
    this.emitLight()
    if (this.flashTimer > 0) {
      this.flashTimer -= dtMs
      if (this.flashTimer <= 0) this.sprite.clearTint()
    }
    if (this.shakeOffset !== 0) {
      this.shakeOffset *= 0.86
      if (Math.abs(this.shakeOffset) < 0.3) this.shakeOffset = 0
      this.sprite.setX(this.x + this.shakeOffset)
    }

    this.slots.forEach((slot, index) => {
      if (!slot.def || slot.hp <= 0) return
      if (slot.recoil > 0) slot.recoil = Math.max(0, slot.recoil - dtMs / 90)
      slot.cooldown -= dtMs

      const target = this.pickTurretTarget(slot.def, candidates)
      if (!target) {
        // Idle scan.
        slot.angle = Phaser.Math.Linear(slot.angle, -0.12, 0.02)
        this.applyTurretTransform(index, slot)
        return
      }

      const muzzleBase = this.turretMuzzle(index)
      const dx = (target.x - muzzleBase.x) * this.dir
      const dy = target.y + target.centerOffsetY - muzzleBase.y
      let desired = datan2(dy, Math.max(24, dx))
      const attack = slot.def.attack
      if (attack.kind === 'projectile' && attack.gravity > 0) {
        const range = Math.max(60, Math.abs(dx))
        desired -= Math.min(0.85, ((attack.gravity * range) / (2 * attack.speed * attack.speed)) * 3)
      }
      slot.angle = Phaser.Math.Linear(slot.angle, Phaser.Math.Clamp(desired, -1.3, 0.9), 0.16)
      this.applyTurretTransform(index, slot)

      if (slot.burstLeft > 0) {
        slot.burstTimer -= dtMs
        if (slot.burstTimer <= 0) {
          this.onTurretFire?.(this, slot, target)
          slot.recoil = 1
          slot.burstLeft -= 1
          slot.burstTimer = attack.kind === 'projectile' && attack.burst ? attack.burst.gapMs : 90
        }
        return
      }

      if (slot.cooldown <= 0) {
        slot.cooldown = slot.def.attackMs
        if (attack.kind === 'projectile' && attack.burst) {
          slot.burstLeft = attack.burst.rounds
          slot.burstTimer = 0
        } else {
          this.onTurretFire?.(this, slot, target)
          slot.recoil = 1
        }
      }
    })
  }

  /**
   * Every fortress is a light source: braziers and windows early on, a
   * shielded reactor core in the Future Age.
   */
  private emitLight(): void {
    const lighting = this.vfx.lighting
    // Nobody is left to keep the fires in. A superseded seat goes dark, which
    // is most of what makes it read as abandoned at a glance.
    if (!lighting || this.derelict) return
    const glowColor = this.age >= 4 ? FACTION_COLOR[this.faction] : this.age >= 3 ? 0xffb347 : 0xff9a4a
    const radius = this.age >= 4 ? BASE_H * 1.5 : BASE_H * 1.15
    // These two lights overlap, and the lighting pass compounds them: each one
    // erases the ambient gloom by its own intensity, so a pair at 0.95 and 0.8
    // left 98% of the shadow gone AND stacked both additive glows on top. The
    // fortress blew out to white and took the ground in front of it with it.
    // A fortress is braziers and windows, not a floodlight — so the main lamp
    // lifts the gloom and the gate merely warms it.
    const intensity = this.age >= 4 ? 0.74 : 0.6
    const phase = this.faction === 'player' ? 0 : 2.1
    lighting.addFlickering(this.x, this.y - BASE_H * (this.age >= 4 ? 0.62 : 0.34), radius, glowColor, intensity, phase)
    // A warm pool at the gate so units silhouette against it as they march out.
    // Kept well below the main lamp: its job is to shape the doorway, and two
    // lights of equal strength in one place is just one brighter light.
    lighting.addFlickering(this.x + this.dir * BASE_W * 0.34, this.y - 22, BASE_W * 0.66, glowColor, 0.34, phase + 1)
  }

  private applyTurretTransform(index: number, slot: TurretSlot): void {
    if (!slot.barrelSprite) return
    const [ox, oy] = TURRET_SLOT_OFFSETS[index]
    const wx = this.x + ox * this.dir + this.shakeOffset
    const wy = this.y + oy - 8
    const recoilPush = slot.recoil * 7
    slot.barrelSprite
      .setPosition(wx - dcos(slot.angle) * recoilPush * this.dir, wy - dsin(slot.angle) * recoilPush)
      .setRotation(slot.angle * this.dir)
      .setFlipX(this.faction === 'enemy')
    slot.baseSprite?.setPosition(wx, this.y + oy)
  }

  private pickTurretTarget(def: TurretDef, candidates: Damageable[]): Damageable | null {
    let best: Damageable | null = null
    let bestDist = Infinity
    for (const c of candidates) {
      if (!c.alive || c.faction === this.faction) continue
      if (c.layer === 'air' && !def.hitsAir) continue
      const dist = Math.abs(c.x - this.x)
      // Same clamp as the units: a turret must not open up on something its
      // ammunition cannot physically reach, or every shell lands short.
      const attack = def.attack
      const throwable =
        attack.kind === 'projectile' && attack.gravity > 0
          ? Math.min(def.range, ballisticReach(attack.speed, attack.gravity))
          : def.range
      if (dist > throwable) continue
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
    return best
  }

  /** Raised when the wall takes a hit, so the battlefield can shed rubble. */
  onWallHit?: (x: number, y: number, amount: number) => void

  takeDamage(amount: number, type: DamageType, source?: Damageable, knockback = 0): void {
    void source
    void knockback
    if (!this.alive) return
    const mult = type === 'explosive' ? 1.6 : type === 'pierce' ? 0.5 : type === 'blunt' ? 0.75 : type === 'slash' ? 0.6 : 1
    const applied = amount * mult
    this.hp = Math.max(0, this.hp - applied)

    this.flashTimer = 120
    this.sprite.setTint(0xff9a9a)
    this.shakeOffset = Math.min(9, applied / 40) * (rng.chance(0.5) ? 1 : -1)
    this.vfx.damageNumber(this.x + rng.spread(50), this.y - BASE_H * 0.55, applied, 0xffd166)
    this.vfx.ricochet(this.getImpactX(), this.y - BASE_H * (0.2 + rng.next() * 0.4), 0xffca7a, 1.2)

    // A hit knocks masonry out of the wall. The rubble is real, it piles at
    // the foot of the fortress, and a wall that has been shelled for a minute
    // looks it.
    this.onWallHit?.(this.getImpactX(), this.y - BASE_H * (0.15 + rng.next() * 0.5), applied)
    audio.play('base_hit', Math.min(1, 0.3 + applied / 400))

    // Splash damage bleeds into the turrets mounted on the wall.
    const bleed = applied * 0.22
    this.slots.forEach(slot => {
      if (!slot.def || slot.hp <= 0) return
      slot.hp -= bleed
      if (slot.hp <= 0) {
        this.vfx.explosion(slot.baseSprite?.x ?? this.x, slot.baseSprite?.y ?? this.y, 80, 0xffa640)
        this.clearTurretSprites(slot)
        slot.wreck = { def: slot.def, sinceMs: 0 }
        slot.def = null
        slot.hp = 0
      }
    })

    this.updateDamageState()

    if (this.hp <= 0) {
      this.alive = false
      this.onDestroyed?.(this)
    }
  }

  /** Fires and smoke build up as the fortress is worn down. */
  private updateDamageState(): void {
    const ratio = this.hp / this.maxHp
    if (ratio < 0.55 && !this.smoke) {
      this.smoke = this.scene.add
        .particles(this.x, this.y - BASE_H * 0.6, 'fx:smoke', {
          lifespan: { min: 1400, max: 2600 },
          speed: { min: 12, max: 46 },
          speedY: { min: -70, max: -26 },
          scale: { start: 0.24, end: 0.9 },
          alpha: { start: 0.45, end: 0 },
          tint: 0x2f2f2f,
          frequency: 220,
          quantity: 1
        })
        .setDepth(46)
    }
    if (this.smoke) {
      this.smoke.frequency = ratio < 0.25 ? 70 : ratio < 0.4 ? 130 : 220
      this.smoke.setParticleTint(ratio < 0.3 ? 0x1c1c1c : 0x3a3a3a)
    }
  }

  /** Full-screen collapse sequence when this base falls. */
  playDestruction(): void {
    const cam = this.scene.cameras.main
    void cam
    for (let i = 0; i < 14; i += 1) {
      this.scene.time.delayedCall(i * 110, () => {
        this.vfx.explosion(
          this.x + rng.spread(BASE_W * 0.5),
          this.y - rng.range(10, BASE_H * 0.9),
          70 + rng.next() * 90,
          0xffa640,
          i % 3 === 0
        )
        audio.play(i % 3 === 0 ? 'explosion_big' : 'explosion', 0.8)
      })
    }
    this.scene.tweens.add({
      targets: this.sprite,
      y: this.sprite.y + BASE_H * 0.5,
      alpha: 0.15,
      scaleY: this.sprite.scaleY * 0.55,
      duration: 1700,
      ease: 'Quad.easeIn'
    })
    this.slots.forEach(slot => this.clearTurretSprites(slot))
    this.brazier?.destroy()
    this.brazier = undefined
  }

  drawHealthBar(graphics: Phaser.GameObjects.Graphics): void {
    const w = BASE_W * 0.86
    const h = 12
    const x = this.x - w / 2
    const y = this.y - BASE_H - 26
    graphics.fillStyle(UI.ink, 0.85)
    graphics.fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 5)
    graphics.fillStyle(0x223047, 1)
    graphics.fillRoundedRect(x, y, w, h, 4)
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1)
    const color = ratio > 0.5 ? FACTION_COLOR[this.faction] : ratio > 0.22 ? UI.warn : UI.bad
    graphics.fillStyle(color, 1)
    graphics.fillRoundedRect(x, y, Math.max(4, w * ratio), h, 4)
  }

  destroy(): void {
    this.brazier?.destroy()
    this.smoke?.destroy()
    this.slots.forEach(slot => this.clearTurretSprites(slot))
    this.sprite.destroy()
  }
}
