export type UnitRole = 'melee' | 'ranged' | 'siege' | 'flying' | 'hero'
export type AgeType = 'stone' | 'medieval' | 'modern' | 'future'

export interface UnitConfig {
  key: string
  name: string
  age: AgeType
  role: UnitRole
  cost: number
  maxHp: number
  damage: number
  attackSpeed: number  // attacks per second
  moveSpeed: number    // pixels per second
  range: number        // pixels
  attackInterval: number // milliseconds
  armor: number        // damage reduction percentage
  width: number
  height: number
  color: number        // primary color
  accentColor: number  // secondary color for details
  description: string
  buildTime: number    // milliseconds
  isRanged: boolean
  projectileSpeed?: number  // pixels per second (for ranged units)
  splashRadius?: number     // splash damage radius
  special?: string     // special ability description
}

// Stone Age Units
export const STONE_AGE_UNITS: Record<string, UnitConfig> = {
  clubman: {
    key: 'clubman',
    name: 'Clubman',
    age: 'stone',
    role: 'melee',
    cost: 50,
    maxHp: 80,
    damage: 15,
    attackSpeed: 0.8,
    moveSpeed: 60,
    range: 40,
    attackInterval: 1250,
    armor: 0,
    width: 28,
    height: 40,
    color: 0x8b4513,
    accentColor: 0x654321,
    description: 'Basic melee fighter with a wooden club',
    buildTime: 3000,
    isRanged: false
  },
  slinger: {
    key: 'slinger',
    name: 'Slinger',
    age: 'stone',
    role: 'ranged',
    cost: 75,
    maxHp: 50,
    damage: 12,
    attackSpeed: 1.2,
    moveSpeed: 50,
    range: 200,
    attackInterval: 833,
    armor: 0,
    width: 24,
    height: 36,
    color: 0xa0522d,
    accentColor: 0x8b4513,
    description: 'Ranged unit that throws stones',
    buildTime: 4000,
    isRanged: true,
    projectileSpeed: 300
  },
  spearman: {
    key: 'spearman',
    name: 'Spearman',
    age: 'stone',
    role: 'melee',
    cost: 100,
    maxHp: 120,
    damage: 25,
    attackSpeed: 0.7,
    moveSpeed: 55,
    range: 60,
    attackInterval: 1428,
    armor: 10,
    width: 30,
    height: 42,
    color: 0x6b4423,
    accentColor: 0x8b7355,
    description: 'Strong melee unit with long reach',
    buildTime: 5000,
    isRanged: false
  },
  mammoth: {
    key: 'mammoth',
    name: 'War Mammoth',
    age: 'stone',
    role: 'siege',
    cost: 200,
    maxHp: 300,
    damage: 50,
    attackSpeed: 0.4,
    moveSpeed: 35,
    range: 50,
    attackInterval: 2500,
    armor: 20,
    width: 60,
    height: 70,
    color: 0x5d4e37,
    accentColor: 0xfff8dc,
    description: 'Massive beast that crushes enemies',
    buildTime: 15000,
    isRanged: false,
    splashRadius: 80
  }
}

// Medieval Age Units
export const MEDIEVAL_AGE_UNITS: Record<string, UnitConfig> = {
  swordsman: {
    key: 'swordsman',
    name: 'Swordsman',
    age: 'medieval',
    role: 'melee',
    cost: 120,
    maxHp: 150,
    damage: 30,
    attackSpeed: 1.0,
    moveSpeed: 65,
    range: 45,
    attackInterval: 1000,
    armor: 15,
    width: 32,
    height: 46,
    color: 0x4a5568,
    accentColor: 0xc0c0c0,
    description: 'Armored warrior with steel sword',
    buildTime: 4000,
    isRanged: false
  },
  archer: {
    key: 'archer',
    name: 'Longbow Archer',
    age: 'medieval',
    role: 'ranged',
    cost: 150,
    maxHp: 80,
    damage: 20,
    attackSpeed: 1.5,
    moveSpeed: 55,
    range: 280,
    attackInterval: 666,
    armor: 5,
    width: 28,
    height: 44,
    color: 0x2d5016,
    accentColor: 0x8b4513,
    description: 'Deadly accurate long-range archer',
    buildTime: 5000,
    isRanged: true,
    projectileSpeed: 400
  },
  knight: {
    key: 'knight',
    name: 'Knight',
    age: 'medieval',
    role: 'melee',
    cost: 250,
    maxHp: 280,
    damage: 45,
    attackSpeed: 0.9,
    moveSpeed: 75,
    range: 50,
    attackInterval: 1111,
    armor: 30,
    width: 40,
    height: 50,
    color: 0x1e3a8a,
    accentColor: 0xffd700,
    description: 'Heavily armored cavalry knight',
    buildTime: 8000,
    isRanged: false
  },
  catapult: {
    key: 'catapult',
    name: 'Catapult',
    age: 'medieval',
    role: 'siege',
    cost: 350,
    maxHp: 200,
    damage: 80,
    attackSpeed: 0.3,
    moveSpeed: 25,
    range: 320,
    attackInterval: 3333,
    armor: 10,
    width: 55,
    height: 60,
    color: 0x3e2723,
    accentColor: 0x795548,
    description: 'Siege weapon with devastating splash damage',
    buildTime: 20000,
    isRanged: true,
    projectileSpeed: 250,
    splashRadius: 100
  }
}

// Modern Age Units
export const MODERN_AGE_UNITS: Record<string, UnitConfig> = {
  rifleman: {
    key: 'rifleman',
    name: 'Rifleman',
    age: 'modern',
    role: 'ranged',
    cost: 180,
    maxHp: 120,
    damage: 35,
    attackSpeed: 2.0,
    moveSpeed: 70,
    range: 300,
    attackInterval: 500,
    armor: 10,
    width: 30,
    height: 48,
    color: 0x1a472a,
    accentColor: 0x4a5568,
    description: 'Infantry with rapid-fire rifle',
    buildTime: 5000,
    isRanged: true,
    projectileSpeed: 600
  },
  machinegunner: {
    key: 'machinegunner',
    name: 'Machine Gunner',
    age: 'modern',
    role: 'ranged',
    cost: 280,
    maxHp: 150,
    damage: 25,
    attackSpeed: 4.0,
    moveSpeed: 60,
    range: 320,
    attackInterval: 250,
    armor: 15,
    width: 34,
    height: 50,
    color: 0x0f3d0f,
    accentColor: 0x78716c,
    description: 'Suppressive fire specialist',
    buildTime: 7000,
    isRanged: true,
    projectileSpeed: 700
  },
  tank: {
    key: 'tank',
    name: 'Tank',
    age: 'modern',
    role: 'siege',
    cost: 450,
    maxHp: 400,
    damage: 90,
    attackSpeed: 0.6,
    moveSpeed: 40,
    range: 280,
    attackInterval: 1666,
    armor: 50,
    width: 65,
    height: 55,
    color: 0x1c4532,
    accentColor: 0x4b5563,
    description: 'Armored vehicle with explosive shells',
    buildTime: 18000,
    isRanged: true,
    projectileSpeed: 400,
    splashRadius: 90
  },
  sniper: {
    key: 'sniper',
    name: 'Sniper',
    age: 'modern',
    role: 'ranged',
    cost: 320,
    maxHp: 90,
    damage: 120,
    attackSpeed: 0.5,
    moveSpeed: 55,
    range: 450,
    attackInterval: 2000,
    armor: 5,
    width: 28,
    height: 46,
    color: 0x1e3a1e,
    accentColor: 0x78350f,
    description: 'One-shot, one-kill precision unit',
    buildTime: 10000,
    isRanged: true,
    projectileSpeed: 1000
  }
}

// Future Age Units
export const FUTURE_AGE_UNITS: Record<string, UnitConfig> = {
  laser_trooper: {
    key: 'laser_trooper',
    name: 'Laser Trooper',
    age: 'future',
    role: 'ranged',
    cost: 280,
    maxHp: 180,
    damage: 50,
    attackSpeed: 3.0,
    moveSpeed: 85,
    range: 340,
    attackInterval: 333,
    armor: 20,
    width: 32,
    height: 52,
    color: 0x1e40af,
    accentColor: 0x60a5fa,
    description: 'Energy weapon infantry',
    buildTime: 6000,
    isRanged: true,
    projectileSpeed: 800
  },
  plasma_artillery: {
    key: 'plasma_artillery',
    name: 'Plasma Artillery',
    age: 'future',
    role: 'siege',
    cost: 600,
    maxHp: 280,
    damage: 150,
    attackSpeed: 0.4,
    moveSpeed: 35,
    range: 400,
    attackInterval: 2500,
    armor: 30,
    width: 70,
    height: 60,
    color: 0x7c3aed,
    accentColor: 0xa78bfa,
    description: 'Devastating plasma bombardment',
    buildTime: 22000,
    isRanged: true,
    projectileSpeed: 500,
    splashRadius: 120
  },
  mech: {
    key: 'mech',
    name: 'Combat Mech',
    age: 'future',
    role: 'melee',
    cost: 500,
    maxHp: 500,
    damage: 80,
    attackSpeed: 1.2,
    moveSpeed: 70,
    range: 55,
    attackInterval: 833,
    armor: 45,
    width: 60,
    height: 80,
    color: 0x1e293b,
    accentColor: 0x0ea5e9,
    description: 'Heavily armored walking war machine',
    buildTime: 20000,
    isRanged: false
  },
  drone: {
    key: 'drone',
    name: 'Attack Drone',
    age: 'future',
    role: 'flying',
    cost: 380,
    maxHp: 140,
    damage: 60,
    attackSpeed: 2.5,
    moveSpeed: 120,
    range: 280,
    attackInterval: 400,
    armor: 15,
    width: 45,
    height: 35,
    color: 0x0f172a,
    accentColor: 0xef4444,
    description: 'Fast aerial assault unit',
    buildTime: 12000,
    isRanged: true,
    projectileSpeed: 700
  },
  superweapon: {
    key: 'superweapon',
    name: 'Titan Destroyer',
    age: 'future',
    role: 'hero',
    cost: 1200,
    maxHp: 800,
    damage: 200,
    attackSpeed: 0.8,
    moveSpeed: 45,
    range: 350,
    attackInterval: 1250,
    armor: 60,
    width: 90,
    height: 100,
    color: 0x7c2d12,
    accentColor: 0xfbbf24,
    description: 'Ultimate weapon of destruction',
    buildTime: 40000,
    isRanged: true,
    projectileSpeed: 600,
    splashRadius: 150,
    special: 'Orbital Strike: Devastating area damage'
  }
}

// Combine all units
export const ALL_UNIT_CONFIGS: Record<string, UnitConfig> = {
  ...STONE_AGE_UNITS,
  ...MEDIEVAL_AGE_UNITS,
  ...MODERN_AGE_UNITS,
  ...FUTURE_AGE_UNITS
}

// Age progression configuration
export interface AgeConfig {
  key: AgeType
  name: string
  cost: number
  baseHp: number
  incomeBonus: number
  units: string[]  // keys of unlocked units
  description: string
}

export const AGE_CONFIGS: Record<AgeType, AgeConfig> = {
  stone: {
    key: 'stone',
    name: 'Stone Age',
    cost: 0,
    baseHp: 1000,
    incomeBonus: 0,
    units: ['clubman', 'slinger', 'spearman', 'mammoth'],
    description: 'The dawn of civilization'
  },
  medieval: {
    key: 'medieval',
    name: 'Medieval Age',
    cost: 500,
    baseHp: 1500,
    incomeBonus: 3,
    units: ['swordsman', 'archer', 'knight', 'catapult'],
    description: 'Era of knights and castles'
  },
  modern: {
    key: 'modern',
    name: 'Modern Age',
    cost: 1200,
    baseHp: 2200,
    incomeBonus: 7,
    units: ['rifleman', 'machinegunner', 'tank', 'sniper'],
    description: 'Industrial warfare'
  },
  future: {
    key: 'future',
    name: 'Future Age',
    cost: 2500,
    baseHp: 3500,
    incomeBonus: 12,
    units: ['laser_trooper', 'plasma_artillery', 'mech', 'drone', 'superweapon'],
    description: 'Advanced technology dominates'
  }
}

// Helper to get units by age
export function getUnitsForAge(age: AgeType): UnitConfig[] {
  const ageConfig = AGE_CONFIGS[age]
  return ageConfig.units.map(key => ALL_UNIT_CONFIGS[key])
}

// Get next age
export function getNextAge(currentAge: AgeType): AgeType | null {
  const ages: AgeType[] = ['stone', 'medieval', 'modern', 'future']
  const currentIndex = ages.indexOf(currentAge)
  return currentIndex < ages.length - 1 ? ages[currentIndex + 1] : null
}
