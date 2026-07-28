import { rng } from '../core/rng'
import { BUILDINGS_BY_ID, REBUILD_MS, buildingHp, type BuildingDef } from '../data/buildings'
import type Vfx from '../gfx/vfx'
import type { ArmorType, Damageable, DamageType, Faction, Layer } from './types'

/**
 * One plot in a commander's yard.
 *
 * A building is a `Damageable` in exactly the way the fortress is, which is the
 * whole reason it is a class rather than a record: implementing that interface
 * means it drops into unit targeting, splash, projectile collision and the
 * turret's target list without a single special case anywhere else.
 *
 * It carries `structure` armour, so the anti-structure specialists — the
 * railgun walkers that measured −0.9 in the field and +1.0 against a wall —
 * finally have something to shoot at that is not the last thirty seconds of a
 * match.
 */
export default class Building implements Damageable {
  readonly faction: Faction
  readonly armor: ArmorType = 'structure'
  readonly layer: Layer = 'ground'
  /** Which of the four plots this is. Identity for commands and the hash. */
  readonly plot: number
  readonly lane: number

  x: number
  y: number
  hp = 0
  maxHp = 0
  /** The age this structure was raised in — what its health is measured against. */
  builtInAge = 0
  alive = false
  radius = 34
  centerOffsetY = -34

  /** What stands here, or null for bare ground. */
  def: BuildingDef | null = null
  /** 0-based: tier 0 is the first level built. */
  tier = 0

  /**
   * Counts down while a razed plot is being cleared and rebuilt. A plot under
   * construction is visible, harmless and cannot be attacked — burning the same
   * ground twice before the crew has finished is not a strategy, it is a tax.
   */
  rebuildMs = 0
  /** What is being rebuilt, so the crew knows what to put back. */
  private rebuilding: { def: BuildingDef; tier: number; age: number } | null = null

  /** Set the frame it dies, so the scene can play the collapse once. */
  justRazed = false

  /**
   * Fired the moment it comes down, from wherever it came down.
   *
   * A building can be razed by a shell, by splash, or by its owner clearing the
   * plot, and the economy has to stop paying at that instant rather than at the
   * start of the next tick. Leaving that to a per-tick sweep meant a granary
   * that had already collapsed was still feeding its commander.
   */
  onRazed?: (building: Building) => void

  private vfx: Vfx

  constructor(faction: Faction, plot: number, x: number, y: number, lane: number, vfx: Vfx) {
    this.faction = faction
    this.plot = plot
    this.x = x
    this.y = y
    this.lane = lane
    this.vfx = vfx
  }

  get empty(): boolean {
    return this.def === null && this.rebuildMs <= 0
  }

  get underConstruction(): boolean {
    return this.rebuildMs > 0
  }

  /** Raises something on bare ground, or lifts what is here by one tier. */
  raise(def: BuildingDef, tier: number, age = 0): void {
    this.def = def
    this.tier = Math.max(0, Math.min(def.tiers.length - 1, tier))
    // The age a thing was RAISED in is what it is made of. A granary put up in
    // the stone age does not get sturdier because its owner later learned to
    // smelt — it gets replaced.
    this.builtInAge = age
    this.maxHp = buildingHp(def, this.tier, age)
    // Lifting a tier repairs as it reinforces, but does not fully heal — a
    // building shelled to a sliver cannot be made whole by paying for a roof.
    this.hp = this.hp > 0 ? Math.min(this.maxHp, this.hp + this.maxHp * 0.5) : this.maxHp
    this.alive = true
    this.rebuildMs = 0
    this.rebuilding = null
  }

  /** Starts the crew. The plot stands empty until the timer runs out. */
  beginRebuild(def: BuildingDef, tier: number, speed = 1, age = 0): void {
    this.rebuilding = { def, tier, age }
    this.rebuildMs = REBUILD_MS / Math.max(0.2, speed)
    this.def = null
    this.alive = false
    this.hp = 0
  }

  update(dtMs: number): void {
    this.justRazed = false
    if (this.rebuildMs > 0) {
      this.rebuildMs -= dtMs
      if (this.rebuildMs <= 0 && this.rebuilding) {
        const { def, tier, age } = this.rebuilding
        this.hp = 0
        this.raise(def, tier, age)
      }
    }
  }

  /** Mends by a flat amount, clamped. Used by the Forge and by Heart Root. */
  mend(amount: number): void {
    if (!this.alive || amount <= 0) return
    this.hp = Math.min(this.maxHp, this.hp + amount)
  }

  takeDamage(amount: number, type: DamageType, source?: Damageable, knockback = 0): void {
    void source
    void knockback
    if (!this.alive || amount <= 0) return
    // The same material response as a fortress wall: shells work, bullets do
    // not. This is what makes "bring the right thing" a real instruction rather
    // than advice — a mob of infantry cannot burn a granary in any useful time.
    const mult =
      type === 'explosive' ? 1.7 : type === 'pierce' ? 0.55 : type === 'blunt' ? 0.8 : type === 'slash' ? 0.45 : 1
    const applied = amount * mult
    this.hp = Math.max(0, this.hp - applied)
    this.vfx.damageNumber(this.x + rng.spread(20), this.y - 44, applied, 0xffd166)
    if (this.hp <= 0) this.raze()
  }

  /** Brings it down. The plot is left as rubble for somebody to clear. */
  raze(): void {
    if (!this.alive) return
    this.alive = false
    this.justRazed = true
    this.hp = 0
    this.vfx.explosion(this.x, this.y - 30, 96, this.def?.color ?? 0xffa640, false)
    this.onRazed?.(this)
  }

  /** What it would cost to put this plot back as it was. */
  get lost(): { def: BuildingDef; tier: number } | null {
    if (this.alive || this.rebuildMs > 0) return null
    return this.def ? { def: this.def, tier: this.tier } : null
  }

  /** Compact state for the fingerprint: what, how far up, and how hurt. */
  hashParts(): number[] {
    const kind = this.def ? BUILDINGS_BY_ID[this.def.id] : null
    const index = kind ? Object.keys(BUILDINGS_BY_ID).indexOf(kind.id) : -1
    return [index, this.tier, this.alive ? Math.round(this.hp) : -1, Math.round(this.rebuildMs)]
  }
}
