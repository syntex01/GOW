import type { TurretDef } from './types'

/**
 * Base-mounted defences. Each base has three slots; a slot holds one turret
 * which can be sold or replaced with a higher-age model at any time.
 */
export const TURRETS: TurretDef[] = [
  {
    id: 'sling_post',
    name: 'Sling Post',
    age: 0,
    cost: 260,
    hp: 400,
    damage: 48,
    damageType: 'blunt',
    attackMs: 1300,
    range: 330,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'stone',
      speed: 460,
      gravity: 380,
      spread: 0.04,
      knockback: 40
    },
    description: 'A raised platform and a lot of river rock.',
    color: 0x8a6b3f,
    barrel: 'sling'
  },
  {
    id: 'boulder_drop',
    name: 'Boulder Drop',
    age: 0,
    cost: 420,
    hp: 520,
    damage: 134,
    damageType: 'blunt',
    attackMs: 2900,
    range: 260,
    hitsAir: false,
    attack: {
      kind: 'projectile',
      projectile: 'boulder',
      speed: 300,
      gravity: 700,
      spread: 0.02,
      knockback: 220,
      splash: 80
    },
    description: 'Crushes whatever gets close. Cannot track fast movers.',
    color: 0x7a6a52,
    barrel: 'short'
  },
  {
    id: 'archer_tower',
    name: 'Archer Tower',
    age: 1,
    cost: 700,
    hp: 900,
    damage: 73,
    damageType: 'pierce',
    attackMs: 850,
    range: 430,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'arrow',
      speed: 700,
      gravity: 260,
      spread: 0.03,
      knockback: 22
    },
    description: 'Steady, accurate arrow fire across the whole approach.',
    color: 0x9aa3b5,
    barrel: 'long'
  },
  {
    id: 'ballista',
    name: 'Ballista',
    age: 1,
    cost: 950,
    hp: 1000,
    damage: 231,
    damageType: 'pierce',
    attackMs: 2500,
    range: 520,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'bolt',
      speed: 1150,
      gravity: 90,
      spread: 0.012,
      knockback: 210
    },
    description: 'A single heavy bolt that skewers armoured targets.',
    color: 0x8a7448,
    barrel: 'long'
  },
  {
    id: 'swivel_gun',
    name: 'Swivel Gun',
    age: 2,
    cost: 1450,
    hp: 1500,
    damage: 165,
    damageType: 'pierce',
    attackMs: 1150,
    range: 500,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'musketball',
      speed: 1250,
      gravity: 80,
      spread: 0.035,
      knockback: 60
    },
    description: 'Rapid grapeshot that shreds infantry pushes.',
    color: 0x8f8474,
    barrel: 'twin'
  },
  {
    id: 'mortar_pit',
    name: 'Mortar Pit',
    age: 2,
    cost: 1750,
    hp: 1400,
    damage: 329,
    damageType: 'explosive',
    attackMs: 3200,
    range: 620,
    hitsAir: false,
    attack: {
      kind: 'projectile',
      projectile: 'mortar',
      speed: 500,
      gravity: 620,
      spread: 0.03,
      knockback: 250,
      splash: 130
    },
    description: 'Lobs shells over your own line into massed enemies.',
    color: 0x6b6355,
    barrel: 'short'
  },
  {
    id: 'autocannon',
    name: 'Autocannon',
    age: 3,
    cost: 2600,
    hp: 2600,
    damage: 64,
    damageType: 'pierce',
    attackMs: 1400,
    range: 520,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'bullet',
      speed: 1600,
      gravity: 30,
      spread: 0.045,
      knockback: 18,
      burst: { rounds: 7, gapMs: 80 }
    },
    description: 'Sustained automatic fire. The all-rounder of the Modern Age.',
    color: 0x5c634e,
    barrel: 'twin'
  },
  {
    id: 'sam_battery',
    name: 'SAM Battery',
    age: 3,
    cost: 2300,
    hp: 2000,
    damage: 476,
    damageType: 'explosive',
    attackMs: 2200,
    range: 620,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'rocket',
      speed: 640,
      gravity: 0,
      spread: 0.01,
      knockback: 180,
      splash: 70,
      homing: 3.4
    },
    description: 'Dedicated anti-air. Deletes gunships and drone swarms.',
    color: 0x4d5540,
    barrel: 'coil'
  },
  {
    id: 'howitzer',
    name: 'Howitzer',
    age: 3,
    cost: 3200,
    hp: 2400,
    damage: 602,
    damageType: 'explosive',
    attackMs: 3800,
    range: 680,
    hitsAir: false,
    attack: {
      kind: 'projectile',
      projectile: 'shell',
      speed: 900,
      gravity: 400,
      spread: 0.02,
      knockback: 380,
      splash: 150
    },
    description: 'Long-range bombardment that reaches the enemy staging area.',
    color: 0x4a5340,
    barrel: 'long'
  },
  {
    id: 'laser_battery',
    name: 'Laser Battery',
    age: 4,
    cost: 4200,
    hp: 3600,
    damage: 179,
    damageType: 'energy',
    attackMs: 520,
    range: 580,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'laserbolt',
      speed: 2200,
      gravity: 0,
      spread: 0.012,
      knockback: 22
    },
    description: 'Continuous energy fire with no travel time to speak of.',
    color: 0x4f6fbd,
    barrel: 'coil'
  },
  {
    id: 'tesla_coil',
    name: 'Tesla Coil',
    age: 4,
    cost: 4800,
    hp: 3200,
    damage: 420,
    damageType: 'energy',
    attackMs: 1500,
    range: 380,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'plasmaball',
      speed: 1400,
      gravity: 0,
      spread: 0.02,
      knockback: 260,
      splash: 120
    },
    description: 'Arcs a chain of plasma into anything that gets close.',
    color: 0x6a4fbd,
    barrel: 'dish'
  },
  {
    id: 'rail_turret',
    name: 'Rail Turret',
    age: 4,
    cost: 6000,
    hp: 4000,
    damage: 1232,
    damageType: 'pierce',
    attackMs: 3600,
    range: 760,
    hitsAir: true,
    attack: {
      kind: 'projectile',
      projectile: 'railslug',
      speed: 2800,
      gravity: 0,
      spread: 0.004,
      knockback: 460
    },
    description: 'Reaches across the entire battlefield and hits like a meteor.',
    color: 0x8090c8,
    barrel: 'long'
  }
]

export const TURRETS_BY_ID: Record<string, TurretDef> = Object.fromEntries(TURRETS.map(t => [t.id, t]))

/** Turrets buildable at or below the given age. */
export function turretsForAge(age: number): TurretDef[] {
  return TURRETS.filter(t => t.age <= age)
}

export const TURRET_SLOTS = 3
