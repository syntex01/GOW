/** Shared vocabulary for the battle simulation. Kept dependency-free on purpose. */

export type Faction = 'player' | 'enemy'

export const OPPOSITE: Record<Faction, Faction> = { player: 'enemy', enemy: 'player' }

/** Which direction a faction advances along the X axis. */
export const ADVANCE_DIR: Record<Faction, 1 | -1> = { player: 1, enemy: -1 }

export type DamageType = 'blunt' | 'pierce' | 'slash' | 'explosive' | 'energy'

export type ArmorType = 'unarmored' | 'light' | 'heavy' | 'structure' | 'air'

export type UnitRole = 'melee' | 'ranged' | 'siege' | 'air' | 'support' | 'tank'

/** Where a unit lives vertically — ground units cannot hit air unless flagged. */
export type Layer = 'ground' | 'air'

/**
 * Damage multiplier matrix. Rows are damage types, columns armor types.
 * The intent: pierce shreds unarmored, blunt beats heavy, explosive levels
 * structures but is poor against nimble light units, energy ignores armor.
 */
export const DAMAGE_MATRIX: Record<DamageType, Record<ArmorType, number>> = {
  blunt: { unarmored: 1.0, light: 0.9, heavy: 1.35, structure: 0.75, air: 0.6 },
  pierce: { unarmored: 1.35, light: 1.15, heavy: 0.7, structure: 0.5, air: 1.2 },
  slash: { unarmored: 1.25, light: 1.0, heavy: 0.8, structure: 0.6, air: 0.8 },
  explosive: { unarmored: 1.1, light: 0.8, heavy: 1.15, structure: 1.6, air: 0.9 },
  energy: { unarmored: 1.0, light: 1.1, heavy: 1.1, structure: 1.0, air: 1.25 }
}

export function damageMultiplier(damage: DamageType, armor: ArmorType): number {
  return DAMAGE_MATRIX[damage][armor]
}

/** A minimal 2D vector used throughout the simulation. */
export interface Vec2 {
  x: number
  y: number
}

/** Anything that can be shot at. */
export interface Damageable {
  readonly faction: Faction
  readonly armor: ArmorType
  readonly layer: Layer
  x: number
  y: number
  hp: number
  maxHp: number
  alive: boolean
  /** Half-width of the hit box, used for range and collision tests. */
  radius: number
  /** Vertical offset of the centre of mass from the object's anchor. */
  centerOffsetY: number
  takeDamage(amount: number, type: DamageType, source?: Damageable, knockback?: number): void
}
