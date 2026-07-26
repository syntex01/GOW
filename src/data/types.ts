import type { ArmorType, DamageType, Layer, UnitRole } from '../sim/types'

export type WeaponVisual =
  | 'fist'
  | 'club'
  | 'spear'
  | 'sling'
  | 'bow'
  | 'sword'
  | 'axe'
  | 'lance'
  | 'staff'
  | 'musket'
  | 'saber'
  | 'grenade'
  | 'rifle'
  | 'lmg'
  | 'rpg'
  | 'laser'
  | 'railgun'
  | 'plasma'
  | 'none'

export type HelmetVisual =
  | 'none'
  | 'band'
  | 'horns'
  | 'hood'
  | 'kettle'
  | 'great'
  | 'tricorn'
  | 'kepi'
  | 'combat'
  | 'visor'
  | 'halo'

export type TorsoVisual = 'bare' | 'fur' | 'robe' | 'mail' | 'plate' | 'coat' | 'vest' | 'exo'

export type ChassisVisual = 'wheels' | 'tracks' | 'legs' | 'rotor' | 'hover' | 'quad' | 'beast'

export interface UnitVisual {
  kind: 'humanoid' | 'vehicle' | 'mech' | 'aircraft' | 'rider'
  skin: number
  cloth: number
  cloth2: number
  metal: number
  accent: number
  helmet: HelmetVisual
  torso: TorsoVisual
  weapon: WeaponVisual
  shield?: 'none' | 'wood' | 'kite' | 'tower' | 'energy'
  cape?: boolean
  chassis?: ChassisVisual
  /** Which machine to draw on a wheeled carriage. */
  machine?: 'catapult' | 'cannon' | 'mortar'
  /** Extra silhouette width multiplier — bulky units read better when wider. */
  bulk?: number
}

export type ProjectileId =
  | 'stone'
  | 'arrow'
  | 'bolt'
  | 'boulder'
  | 'musketball'
  | 'grenade'
  | 'cannonball'
  | 'bullet'
  | 'rocket'
  | 'shell'
  | 'mortar'
  | 'laserbolt'
  | 'plasmaball'
  | 'railslug'
  | 'bomb'

export type AttackSpec =
  | { kind: 'melee'; knockback: number; splash?: number }
  | {
      kind: 'projectile'
      projectile: ProjectileId
      speed: number
      /** Gravity applied to the projectile in px/s². 0 = flat trajectory. */
      gravity: number
      /** Angular spread in radians applied per shot. */
      spread: number
      count?: number
      knockback: number
      splash?: number
      /** Fired as a burst of N rounds spaced this many ms apart. */
      burst?: { rounds: number; gapMs: number }
      /** Radians/s of course correction toward the target. */
      homing?: number
      /** Muzzle offset from the unit's centre, in unit-local pixels. */
      muzzle?: [number, number]
    }
  | { kind: 'beam'; width: number; knockback: number; pierce: boolean; durationMs: number }
  | { kind: 'heal'; amount: number; radius: number }
  | { kind: 'aura'; damageReduction: number; radius: number }

export interface UnitDef {
  id: string
  name: string
  age: number
  role: UnitRole
  layer: Layer
  cost: number
  buildMs: number
  hp: number
  armor: ArmorType
  damage: number
  damageType: DamageType
  attackMs: number
  range: number
  speed: number
  mass: number
  bounty: number
  xp: number
  pop: number
  height: number
  attack: AttackSpec
  /**
   * Closest a target may stand before this weapon cannot be brought to bear.
   * A crew that has let something inside its minimum range stops shooting and
   * gives ground, which is what makes a siege engine worth charging.
   */
  minRange?: number
  /**
   * A protective field this unit projects over nearby allies. It is a property
   * rather than an attack: a bodyguard that cannot swing at anything is a trap,
   * and the roster had two of them.
   */
  aura?: { damageReduction: number; radius: number }
  /** Multiplier applied when this unit attacks the listed armour classes. */
  bonusVs?: Partial<Record<ArmorType, number>>
  /**
   * A flanker blocked behind its own line will move itself to a clear
   * adjacent lane rather than wait. Fixed rule, no input — the knight's move.
   */
  flanker?: boolean
  /**
   * How this piece conducts itself in its file. The conducts are the pieces
   * of the positional game, and each one is strong into another and weak to a
   * third — the counter web is documented where the battlefield enforces it.
   *
   *  - `swarm`   packs its file twice as tight and presses two ranks deeper;
   *  - `phalanx` intercepts chargers: heavy bonus damage against flankers;
   *  - `screen`  taunts — enemies in its file must cut it down first;
   *  - `hunt`    ignores the nearest man and kills the weakest in reach.
   *
   * Line (default), spill (ranged), bombard (siege) and flight (air) complete
   * the vocabulary; those follow from role rather than a flag.
   */
  conduct?: 'swarm' | 'phalanx' | 'screen' | 'hunt'
  /**
   * One purchase fields this many copies. The quantity paths' chaff comes in
   * squads — `cost`, `pop` and `buildMs` price the whole squad, while hp,
   * damage and bounty are per soldier.
   */
  squad?: number
  /**
   * The unit's signature rule — the mechanic that makes it *this* soldier and
   * not a palette swap. Implemented case by case in the simulation:
   * gravebound, frenzy, plague_shot, bone_rampart, raise_tide, death_burst,
   * scorch_touch, incendiary_shot, cluster_shot, plating, penetrator_shot,
   * fabricate, barrier, emp_shot, death_curse, enthrall, hex_shot, reflect,
   * dread_wave, spore_shot, spore_burst, entangle, evergreen, seed_shot.
   */
  special?: string
  /** Never shown on a command bar — summoned by another unit's special. */
  hidden?: boolean
  /** Can this unit shoot air targets? Ground melee cannot. */
  hitsAir?: boolean
  /** Chance of a 2x hit. */
  crit?: number
  /** Self-regeneration per second. */
  regen?: number
  description: string
  visual: UnitVisual
}

export interface TurretDef {
  id: string
  name: string
  age: number
  cost: number
  hp: number
  damage: number
  damageType: DamageType
  attackMs: number
  range: number
  hitsAir: boolean
  attack: AttackSpec
  description: string
  color: number
  barrel: 'short' | 'long' | 'twin' | 'coil' | 'dish' | 'sling'
}

export interface AbilityDef {
  id: string
  name: string
  /** Compact label for the command bar, where space is tight. */
  short: string
  age: number
  /** Seconds of charge time from empty. */
  chargeSeconds: number
  description: string
  color: number
}

export interface AgeDef {
  index: number
  name: string
  /** XP needed to advance from this age to the next. */
  xpToAdvance: number
  /** Gold cost of the evolution itself. */
  evolveCost: number
  baseHp: number
  /** Gold per second passive income. */
  income: number
  populationCap: number
  abilityId: string
  description: string
}
