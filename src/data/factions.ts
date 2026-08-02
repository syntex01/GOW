import { creedColours } from './creedPalette'
import { relayCurves } from './curves'
import { AGE_POWER_SCALE } from './units'
import type { UnitDef, UnitVisual } from './types'

/**
 * The five things an army can become.
 *
 * Ascension is the end of the research tree and the point of it. Everything
 * before it bends your army in a direction; this is where the army stops being
 * a collection of soldiers with upgrades and becomes something else, with its
 * own roster, its own silhouette and its own way of winning.
 *
 * A faction is not a stat package. Each one takes the behaviours its creed was
 * teaching and makes them the *default* — the Nekrotics do not research
 * raising the dead, they simply do it; the Cyborgs do not research self-repair,
 * they are made of it.
 */

export type FactionId = 'nekrotics' | 'cyborgs' | 'dark_circle' | 'cinder_host' | 'hollow_bloom'

export interface ApocalypticFaction {
  id: FactionId
  name: string
  /** One line of who they are. */
  tagline: string
  /** What ascending actually does to your army, mechanically. */
  doctrine: string
  accent: number
  /** Which research creed leads here. */
  creed: string
}

export const FACTIONS: ApocalypticFaction[] = [
  {
    id: 'nekrotics',
    name: 'THE NEKROTICS',
    tagline: 'They stopped burying their dead and started conscripting them.',
    doctrine: 'Your fallen rise on their own. Every soldier you lose comes back once.',
    accent: 0x7fd6a0,
    creed: 'carnage'
  },
  {
    id: 'cyborgs',
    name: 'THE CYBORGS',
    tagline: 'Flesh was a rough draft. They have been editing for a century.',
    doctrine: 'Your whole army repairs itself continuously and cannot be shut down by EMP.',
    accent: 0x5ce1ff,
    creed: 'engineering'
  },
  {
    id: 'dark_circle',
    name: 'THE DARK CIRCLE',
    tagline: 'Nine of them decided what the world would end as. It is ending that way.',
    doctrine: 'Every enemy that dies charges your ability. The sky darkens and their aim goes with it.',
    accent: 0xb46bff,
    creed: 'occult'
  },
  {
    id: 'cinder_host',
    name: 'THE CINDER HOST',
    tagline: 'They burned the world to keep warm and never stopped feeling cold.',
    doctrine: 'Everything you kill burns where it falls, and the fire spreads on its own.',
    accent: 0xff7a2a,
    creed: 'ordnance'
  },
  {
    id: 'hollow_bloom',
    name: 'THE HOLLOW BLOOM',
    tagline: 'Something grew through the ruins. It is wearing the survivors.',
    doctrine: 'Your soldiers root where they stand and heal from the ground they have blighted.',
    accent: 0xd98ec4,
    creed: 'blight'
  }
]

export const FACTIONS_BY_ID: Record<FactionId, ApocalypticFaction> = Object.fromEntries(
  FACTIONS.map(f => [f.id, f])
) as Record<FactionId, ApocalypticFaction>

// ─────────────────────────── Faction palettes ───────────────────────────

/** Shared look per faction, so a roster reads as one army at a glance. */
const PALETTE: Record<FactionId, Pick<UnitVisual, 'skin' | 'cloth' | 'cloth2' | 'metal' | 'accent'>> = {
  nekrotics: { skin: 0xa9b3a0, cloth: 0x3a2f3d, cloth2: 0x27202a, metal: 0x8e9384, accent: 0x7fd6a0 },
  cyborgs: { skin: 0x93a0b0, cloth: 0x2b3444, cloth2: 0x1b222d, metal: 0xc9d6ff, accent: 0x5ce1ff },
  dark_circle: { skin: 0xb09a8c, cloth: 0x1b1426, cloth2: 0x120d1a, metal: 0x6b5f86, accent: 0xb46bff },
  cinder_host: { skin: 0x6a4f42, cloth: 0x2a201c, cloth2: 0x1a1310, metal: 0x8a7266, accent: 0xff7a2a },
  hollow_bloom: { skin: 0xb8a87c, cloth: 0x4c5c33, cloth2: 0x333f22, metal: 0x8f8a63, accent: 0xd98ec4 }
}

function look(faction: FactionId, extra: Partial<UnitVisual>): UnitVisual {
  return {
    kind: 'humanoid',
    helmet: 'none',
    torso: 'bare',
    weapon: 'fist',
    ...PALETTE[faction],
    ...extra
  } as UnitVisual
}

/**
 * Faction rosters. Five units each, and each roster is built to play
 * differently rather than to re-skin the same five roles: the Nekrotics field
 * cheap bodies that keep coming, the Cyborgs field few and expensive ones that
 * do not die, the Bloom fields things that would rather stand still.
 */
export const FACTION_UNITS: UnitDef[] = [
  // ───────────────────────────── Nekrotics ─────────────────────────────
  {
    id: 'nk_husk',
    name: 'Husk',
    age: 1,
    role: 'melee',
    layer: 'ground',
    cost: 150,
    buildMs: 1700,
    hp: 410,
    armor: 'unarmored',
    damage: 58,
    damageType: 'slash',
    attackMs: 850,
    range: 38,
    speed: 54,
    mass: 1.6,
    bounty: 28,
    xp: 24,
    pop: 1,
    squad: 2,
    conduct: 'swarm',
    height: 66,
    // The Husk is never replaced. It is what the creed is MADE of, so it gets
    // heavier and more numerous every age instead of being outclassed — twice as
    // many at the second age, and widening from there. See `data/escalate.ts`.
    escalates: 'husk',
    special: 'gravebound',
    attack: { kind: 'melee', knockback: 50 },
    description: 'It was someone. A quarter of them refuse to stay down the first time.',
    visual: look('nekrotics', { torso: 'bare', weapon: 'axe', helmet: 'none' , plan: 'husk'})
  },
  {
    id: 'nk_flenser',
    line: 'carnage_render',
    name: 'Flenser',
    age: 2,
    role: 'melee',
    layer: 'ground',
    cost: 560,
    buildMs: 3400,
    hp: 1250,
    armor: 'light',
    damage: 150,
    damageType: 'slash',
    attackMs: 1000,
    range: 52,
    speed: 44,
    mass: 2.2,
    bounty: 243,
    xp: 211,
    pop: 2,
    height: 84,
    special: 'frenzy',
    attack: { kind: 'melee', knockback: 190, splash: 60 },
    // The other half of the age-two pair: a wide cleave that exists to erase
    // massed light infantry and render it down where it stands.
    bonusVs: { unarmored: 1.85, light: 1.5 },
    harvest: { meat: 3 },
    description: 'Kills in a wide arc, and every kill quickens the next swing. Feed it and regret it. What it leaves is barely a body.',
    visual: look('nekrotics', { torso: 'fur', weapon: 'axe', helmet: 'horns', bulk: 1.25 , plan: 'flenser'})
  },
  {
    id: 'nk_carrion',
    line: 'carnage_raise',
    name: 'Carrion Choir',
    age: 3,
    role: 'support',
    layer: 'ground',
    cost: 780,
    buildMs: 3300,
    hp: 1600,
    armor: 'light',
    damage: 0,
    damageType: 'blunt',
    attackMs: 2600,
    range: 190,
    speed: 40,
    mass: 4,
    bounty: 296,
    xp: 258,
    pop: 2,
    height: 78,
    // THE FLESH WAGON. Carnage's answer to the medic, and it is not a medic.
    //
    // It mends the line like any healer, but its real job is the second one:
    // it stops over the spoils lying on your own ground, renders them down, and
    // puts a body back in the file. That is the creed's healer — not somebody
    // who keeps a soldier alive, somebody who replaces him out of the last one.
    special: 'flesh_wagon',
    attack: { kind: 'heal', amount: 150, radius: 190 },
    description: 'A rendering cart with a choir riding on it. It mends what it can and rebuilds what it cannot, out of whatever is lying about.',
    visual: look('nekrotics', {
      kind: 'vehicle',
      chassis: 'wheels',
      machine: 'catapult',
      torso: 'coat',
      weapon: 'none',
      helmet: 'hood',
      bulk: 1.3
    , plan: 'wagon'})
  },
  // ───────────────────────────── Cyborgs ─────────────────────────────
  {
    id: 'cy_gnat',
    name: 'Gnat Drone',
    age: 3,
    role: 'ranged',
    layer: 'air',
    cost: 0,
    buildMs: 1,
    hp: 300,
    armor: 'air',
    damage: 60,
    damageType: 'energy',
    attackMs: 1100,
    range: 260,
    speed: 110,
    mass: 0.5,
    bounty: 20,
    xp: 10,
    pop: 0,
    height: 30,
    hidden: true,
    hitsAir: true,
    attack: { kind: 'projectile', projectile: 'laserbolt', speed: 1300, gravity: 0, spread: 0.05, knockback: 20 },
    description: 'Printed mid-battle by a Drone Host. Not built to last; built to be replaced.',
    visual: look('cyborgs', { kind: 'aircraft', chassis: 'hover', torso: 'exo' })
  },
  {
    id: 'cy_revenant',
    name: 'Revenant',
    age: 1,
    role: 'melee',
    layer: 'ground',
    cost: 440,
    buildMs: 4200,
    hp: 1080,
    armor: 'heavy',
    damage: 130,
    damageType: 'energy',
    attackMs: 950,
    range: 44,
    speed: 62,
    mass: 2,
    bounty: 198,
    xp: 172,
    pop: 2,
    height: 72,
    regen: 34,
    special: 'plating',
    attack: { kind: 'melee', knockback: 120 },
    description: 'A soldier finished in metal. Small arms glance off; it repairs as it fights.',
    visual: look('cyborgs', { helmet: 'combat', torso: 'vest', weapon: 'sword', shield: 'kite', bulk: 1.1 })
  },
  {
    id: 'cy_lancer',
    name: 'Rail Lancer',
    age: 2,
    role: 'ranged',
    layer: 'ground',
    cost: 700,
    buildMs: 4200,
    hp: 800,
    armor: 'light',
    damage: 260,
    damageType: 'pierce',
    attackMs: 2400,
    range: 300,
    speed: 32,
    mass: 1.6,
    bounty: 266,
    xp: 231,
    pop: 2,
    height: 76,
    hitsAir: true,
    crit: 0.2,
    special: 'penetrator_shot',
    attack: {
      kind: 'projectile',
      projectile: 'railslug',
      speed: 2600,
      gravity: 0,
      spread: 0.008,
      knockback: 130
    },
    bonusVs: { heavy: 1.5, structure: 1.3 },
    description: 'A rail rifle on legs. The slug does not stop at the first body.',
    visual: look('cyborgs', { torso: 'exo', weapon: 'railgun', helmet: 'visor' })
  },
  {
    id: 'cy_bulwark',
    name: 'Bulwark Frame',
    age: 4,
    role: 'tank',
    layer: 'ground',
    cost: 2800,
    buildMs: 6200,
    hp: 8200,
    armor: 'heavy',
    damage: 380,
    damageType: 'energy',
    attackMs: 1500,
    range: 190,
    speed: 24,
    mass: 8,
    bounty: 1064,
    xp: 926,
    pop: 3,
    conduct: 'screen',
    height: 128,
    regen: 90,
    hitsAir: true,
    special: 'barrier',
    attack: {
      kind: 'projectile',
      projectile: 'laserbolt',
      speed: 1500,
      gravity: 0,
      spread: 0.03,
      knockback: 90,
      splash: 50
    },
    description: 'A walking wall that projects one: everything near it takes less.',
    visual: look('cyborgs', { kind: 'mech', helmet: 'halo', torso: 'exo', weapon: 'lmg', shield: 'tower', chassis: 'tracks', bulk: 1.6 })
  },
  {
    id: 'cy_swarmhost',
    name: 'Drone Host',
    age: 3,
    role: 'support',
    layer: 'ground',
    cost: 1100,
    buildMs: 4400,
    hp: 1100,
    armor: 'light',
    damage: 0,
    damageType: 'energy',
    attackMs: 1300,
    range: 190,
    speed: 40,
    mass: 1.4,
    bounty: 418,
    xp: 364,
    pop: 2,
    height: 70,
    special: 'fabricate',
    attack: { kind: 'heal', amount: 260, radius: 180 },
    description: 'Walks behind the line printing gnat drones, and mends whatever stands near.',
    visual: look('cyborgs', { torso: 'exo', weapon: 'laser', helmet: 'halo' })
  },
  {
    id: 'cy_seraph',
    name: 'Seraph',
    age: 4,
    role: 'air',
    layer: 'air',
    cost: 2400,
    buildMs: 5200,
    hp: 1800,
    armor: 'light',
    damage: 300,
    damageType: 'energy',
    attackMs: 1300,
    range: 300,
    speed: 84,
    mass: 2,
    bounty: 912,
    xp: 793,
    pop: 3,
    conduct: 'hunt',
    height: 82,
    hitsAir: true,
    regen: 40,
    special: 'emp_shot',
    attack: {
      kind: 'projectile',
      projectile: 'laserbolt',
      speed: 1400,
      gravity: 0,
      spread: 0.04,
      knockback: 60
    },
    description: 'A hunting frame whose light switches machines off where they stand.',
    visual: look('cyborgs', { kind: 'aircraft', chassis: 'hover', torso: 'exo', weapon: 'laser' })
  },

  // ─────────────────────────── Dark Circle ───────────────────────────
  {
    id: 'dc_shade',
    name: 'Bound Shade',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 0,
    buildMs: 1,
    hp: 520,
    armor: 'unarmored',
    damage: 150,
    damageType: 'energy',
    attackMs: 900,
    range: 42,
    speed: 100,
    mass: 0.8,
    bounty: 25,
    xp: 12,
    pop: 0,
    height: 60,
    hidden: true,
    attack: { kind: 'melee', knockback: 40 },
    description: 'Not summoned so much as owed. It fights until the debt is called elsewhere.',
    visual: look('dark_circle', { torso: 'robe', weapon: 'none', helmet: 'hood', cape: true })
  },
  {
    id: 'dc_archmage',
    name: 'Archmage of the Circle',
    age: 4,
    role: 'support',
    layer: 'ground',
    cost: 2800,
    buildMs: 6000,
    hp: 2600,
    armor: 'unarmored',
    damage: 300,
    damageType: 'energy',
    attackMs: 2400,
    range: 380,
    speed: 36,
    mass: 3,
    bounty: 1064,
    xp: 926,
    pop: 4,
    height: 78,
    special: 'summoner',
    attack: { kind: 'projectile', projectile: 'plasmaball', speed: 700, gravity: 0, spread: 0.02, knockback: 120, splash: 90 },
    description: 'Does not field an army. Owes one, and keeps calling the debt: shades, bound in fours.',
    visual: look('dark_circle', { torso: 'robe', weapon: 'staff', helmet: 'halo', cape: true, bulk: 1.2 })
  },
  {
    id: 'dc_acolyte',
    name: 'Acolyte',
    age: 1,
    role: 'melee',
    layer: 'ground',
    cost: 150,
    buildMs: 1700,
    hp: 500,
    armor: 'unarmored',
    damage: 66,
    damageType: 'slash',
    attackMs: 880,
    range: 40,
    speed: 58,
    mass: 1.6,
    bounty: 28,
    xp: 24,
    pop: 1,
    squad: 2,
    conduct: 'swarm',
    height: 68,
    special: 'death_curse',
    attack: { kind: 'melee', knockback: 60 },
    description: 'Cheap, willing, and vindictive: whatever cuts one down swings softer after.',
    visual: look('dark_circle', { torso: 'robe', weapon: 'sword', helmet: 'hood' })
  },
  {
    id: 'dc_hexer',
    name: 'Hexer',
    age: 3,
    role: 'ranged',
    layer: 'ground',
    cost: 950,
    buildMs: 3800,
    hp: 900,
    armor: 'unarmored',
    damage: 170,
    damageType: 'energy',
    attackMs: 1900,
    range: 340,
    speed: 34,
    mass: 1.1,
    bounty: 361,
    xp: 314,
    pop: 2,
    height: 74,
    hitsAir: true,
    special: 'hex_shot',
    attack: {
      kind: 'projectile',
      projectile: 'plasmaball',
      speed: 560,
      gravity: 0,
      spread: 0.04,
      knockback: 110,
      splash: 58
    },
    description: 'Points at something and it stops being structurally certain: everything hits it harder.',
    visual: look('dark_circle', { torso: 'robe', weapon: 'staff', helmet: 'hood', cape: true })
  },
  {
    id: 'dc_inquisitor',
    name: 'Iron Inquisitor',
    age: 4,
    role: 'tank',
    layer: 'ground',
    cost: 2300,
    buildMs: 5600,
    hp: 7400,
    armor: 'heavy',
    damage: 380,
    damageType: 'blunt',
    attackMs: 1450,
    range: 70,
    speed: 28,
    mass: 6,
    bounty: 874,
    xp: 760,
    pop: 3,
    conduct: 'screen',
    height: 112,
    special: 'reflect',
    attack: { kind: 'melee', knockback: 340, splash: 100 },
    bonusVs: { heavy: 1.4 },
    description: 'A tower of judged iron. A fifth of every blow against it is returned in kind.',
    visual: look('dark_circle', { torso: 'plate', weapon: 'club', helmet: 'great', shield: 'tower', bulk: 1.4 })
  },
  {
    id: 'dc_thrallmaster',
    name: 'Thrallmaster',
    age: 2,
    role: 'support',
    layer: 'ground',
    cost: 480,
    buildMs: 3400,
    hp: 520,
    armor: 'light',
    damage: 0,
    damageType: 'energy',
    attackMs: 1600,
    range: 200,
    speed: 36,
    mass: 1.4,
    bounty: 182,
    xp: 158,
    pop: 1,
    height: 78,
    special: 'enthrall',
    attack: { kind: 'melee', knockback: 160, splash: 88 },
    aura: { damageReduction: 0.3, radius: 210 },
    description: 'Chants on a slow clock. When the verse lands, everything nearby forgets how to walk.',
    visual: look('dark_circle', { helmet: 'horns', torso: 'robe', weapon: 'lance', cape: true })
  },
  {
    id: 'dc_ninthsign',
    name: 'The Ninth Sign',
    age: 4,
    role: 'siege',
    layer: 'ground',
    cost: 3400,
    buildMs: 6600,
    hp: 2400,
    armor: 'light',
    damage: 800,
    damageType: 'energy',
    attackMs: 4600,
    range: 560,
    speed: 20,
    mass: 6,
    bounty: 1292,
    xp: 1124,
    pop: 4,
    height: 225,
    // The top of the elite curve is a minute of income and is meant to read
    // as a different KIND of object, not a bigger soldier. Three files wide,
    // and tall enough that the men beside it come up to its knee.
    laneSpan: 3,
    hitsAir: true,
    special: 'dread_wave',
    attack: {
      kind: 'projectile',
      projectile: 'plasmaball',
      speed: 520,
      gravity: 140,
      spread: 0.02,
      knockback: 420,
      splash: 200
    },
    description: 'Its shellfall carries dread — everything caught in the blast wades as if drowning.',
    visual: look('dark_circle', { helmet: 'great', torso: 'plate', weapon: 'none', cape: true, bulk: 1.55 })
  },

  // ─────────────────────────── Cinder Host ───────────────────────────
  {
    id: 'ch_emberling',
    name: 'Emberling',
    age: 1,
    role: 'melee',
    layer: 'ground',
    cost: 160,
    buildMs: 1800,
    hp: 440,
    armor: 'light',
    damage: 62,
    damageType: 'explosive',
    attackMs: 900,
    range: 38,
    speed: 66,
    mass: 1.6,
    bounty: 30,
    xp: 26,
    pop: 1,
    squad: 2,
    conduct: 'swarm',
    height: 62,
    special: 'death_burst',
    attack: { kind: 'melee', knockback: 70, splash: 40 },
    description: 'A charge with legs. Killing one up close is a mistake you make exactly once.',
    visual: look('cinder_host', { helmet: 'none', torso: 'fur', weapon: 'club' })
  },
  {
    id: 'ch_torchbearer',
    name: 'Torchbearer',
    age: 3,
    role: 'ranged',
    layer: 'ground',
    cost: 900,
    buildMs: 3400,
    hp: 800,
    armor: 'light',
    damage: 240,
    damageType: 'explosive',
    attackMs: 2200,
    range: 240,
    speed: 40,
    mass: 1.6,
    bounty: 342,
    xp: 298,
    pop: 2,
    height: 76,
    special: 'incendiary_shot',
    attack: {
      kind: 'projectile',
      projectile: 'rocket',
      speed: 700,
      gravity: 60,
      spread: 0.11,
      knockback: 120,
      splash: 78,
      count: 2
    },
    description: 'Twin launchers, and everything they touch keeps burning after.',
    visual: look('cinder_host', { torso: 'plate', weapon: 'rpg', helmet: 'great' })
  },
  {
    id: 'ch_pyreknight',
    name: 'Pyre Knight',
    age: 2,
    role: 'tank',
    layer: 'ground',
    cost: 660,
    buildMs: 4000,
    hp: 1300,
    armor: 'heavy',
    damage: 150,
    damageType: 'explosive',
    attackMs: 950,
    range: 66,
    speed: 30,
    mass: 7,
    bounty: 251,
    xp: 218,
    pop: 2,
    conduct: 'screen',
    height: 120,
    special: 'scorch_touch',
    attack: { kind: 'melee', knockback: 380, splash: 130 },
    description: 'Every blow of the great axe leaves the ground itself on fire.',
    visual: look('cinder_host', { kind: 'mech', torso: 'plate', weapon: 'axe', helmet: 'great', chassis: 'legs', bulk: 1.5 })
  },
  {
    id: 'ch_conflagrator',
    name: 'Conflagrator',
    age: 4,
    role: 'siege',
    layer: 'ground',
    cost: 2300,
    buildMs: 5600,
    hp: 1600,
    armor: 'light',
    damage: 600,
    damageType: 'explosive',
    attackMs: 4300,
    range: 520,
    speed: 22,
    mass: 6,
    bounty: 874,
    xp: 760,
    pop: 3,
    height: 104,
    special: 'cluster_shot',
    attack: {
      kind: 'projectile',
      projectile: 'shell',
      speed: 560,
      gravity: 420,
      spread: 0.03,
      knockback: 340,
      splash: 190
    },
    bonusVs: { structure: 1.5 },
    description: 'Its shells come apart at the top of the arc. One gun, three impacts.',
    visual: look('cinder_host', { kind: 'vehicle', chassis: 'tracks', bulk: 1.5 })
  },
  {
    id: 'ch_ashwing',
    name: 'Ashwing',
    age: 4,
    role: 'air',
    layer: 'air',
    cost: 1900,
    buildMs: 4800,
    hp: 1500,
    armor: 'light',
    damage: 300,
    damageType: 'explosive',
    attackMs: 1500,
    range: 260,
    speed: 78,
    mass: 2,
    bounty: 722,
    xp: 628,
    pop: 3,
    conduct: 'hunt',
    height: 80,
    special: 'incendiary_shot',
    attack: {
      kind: 'projectile',
      projectile: 'bomb',
      speed: 480,
      gravity: 700,
      spread: 0.07,
      knockback: 220,
      splash: 170
    },
    description: 'A firebomber on the hunt: its bombs leave the lane alight beneath it.',
    visual: look('cinder_host', { kind: 'aircraft', chassis: 'rotor', torso: 'plate' })
  },

  // ─────────────────────────── Hollow Bloom ───────────────────────────
  {
    id: 'hb_sporeling',
    name: 'Sporeling',
    age: 2,
    role: 'melee',
    layer: 'ground',
    cost: 330,
    buildMs: 2400,
    hp: 380,
    armor: 'unarmored',
    damage: 60,
    damageType: 'pierce',
    attackMs: 800,
    range: 36,
    speed: 60,
    mass: 1.6,
    bounty: 42,
    xp: 37,
    pop: 1,
    squad: 3,
    conduct: 'swarm',
    height: 58,
    regen: 18,
    special: 'spore_burst',
    attack: { kind: 'melee', knockback: 40 },
    description: 'There is always another. Each one bursts into spore ground when it dies.',
    visual: look('hollow_bloom', { torso: 'fur', weapon: 'spear', helmet: 'none' })
  },
  {
    id: 'hb_seeder',
    name: 'Seeder',
    age: 1,
    role: 'ranged',
    layer: 'ground',
    cost: 210,
    buildMs: 2100,
    hp: 330,
    armor: 'unarmored',
    damage: 62,
    damageType: 'pierce',
    attackMs: 1600,
    range: 250,
    speed: 32,
    mass: 1.3,
    bounty: 80,
    xp: 70,
    pop: 1,
    height: 78,
    hitsAir: true,
    special: 'spore_shot',
    attack: {
      kind: 'projectile',
      projectile: 'bolt',
      speed: 760,
      gravity: 120,
      spread: 0.06,
      knockback: 60,
      splash: 60,
      count: 2
    },
    description: 'Flings seed-darts that sprout hostile ground wherever they strike.',
    visual: look('hollow_bloom', { torso: 'robe', weapon: 'bow', helmet: 'band' })
  },
  {
    id: 'hb_bastion',
    name: 'Standing Bastion',
    age: 4,
    role: 'tank',
    layer: 'ground',
    cost: 2400,
    buildMs: 5800,
    hp: 7800,
    armor: 'heavy',
    damage: 340,
    damageType: 'blunt',
    attackMs: 1500,
    range: 74,
    speed: 18,
    mass: 9,
    bounty: 912,
    xp: 793,
    pop: 3,
    conduct: 'screen',
    height: 126,
    regen: 70,
    special: 'evergreen',
    attack: { kind: 'melee', knockback: 320, splash: 110 },
    description: 'It stands, and standing is the weapon: the longer it holds, the harder it is to hurt.',
    visual: look('hollow_bloom', { kind: 'mech', torso: 'fur', weapon: 'club', helmet: 'none', chassis: 'legs', bulk: 1.7 })
  },
  {
    id: 'hb_mycelic',
    name: 'Mycelic Choir',
    age: 3,
    role: 'support',
    layer: 'ground',
    cost: 850,
    buildMs: 3800,
    hp: 900,
    armor: 'light',
    damage: 0,
    damageType: 'energy',
    attackMs: 1500,
    range: 200,
    speed: 34,
    mass: 1.4,
    bounty: 323,
    xp: 281,
    pop: 2,
    height: 74,
    special: 'entangle',
    attack: { kind: 'heal', amount: 300, radius: 200 },
    description: 'Tends the line, and on a slow pulse the roots take everyone else by the ankles.',
    visual: look('hollow_bloom', { helmet: 'horns', torso: 'robe', weapon: 'staff', cape: true, bulk: 1.15 })
  },
  {
    id: 'hb_titanbloom',
    name: 'Titan Bloom',
    age: 4,
    role: 'siege',
    layer: 'ground',
    cost: 3200,
    buildMs: 6400,
    hp: 2600,
    armor: 'light',
    damage: 640,
    damageType: 'explosive',
    attackMs: 4700,
    range: 500,
    speed: 18,
    mass: 7,
    bounty: 1216,
    xp: 1058,
    pop: 4,
    height: 240,
    // The top of the elite curve is a minute of income and is meant to read
    // as a different KIND of object, not a bigger soldier. Three files wide,
    // and tall enough that the men beside it come up to its knee.
    laneSpan: 3,
    regen: 60,
    special: 'seed_shot',
    attack: {
      kind: 'projectile',
      projectile: 'boulder',
      speed: 590,
      gravity: 520,
      spread: 0.04,
      knockback: 380,
      splash: 180
    },
    description: 'Throws its own fruiting bodies. Some of them take root and get up.',
    visual: look('hollow_bloom', { kind: 'mech', torso: 'fur', weapon: 'none', helmet: 'none', chassis: 'legs', bulk: 1.9 })
  },
  {
    id: 'nk_ripjaw',
    line: 'carnage_flank',
    name: 'Ripjaw',
    age: 2,
    role: 'melee',
    layer: 'ground',
    cost: 470,
    buildMs: 3400,
    hp: 1000,
    armor: 'light',
    damage: 115,
    damageType: 'slash',
    attackMs: 620,
    range: 44,
    speed: 92,
    mass: 2.4,
    bounty: 213,
    xp: 185,
    pop: 2,
    height: 70,
    conduct: 'hunt',
    flanker: true,
    // THE LEAP. It does not walk into a fight and stand in it — it crouches,
    // throws itself over the front rank, opens something up, and is gone before
    // the rank has turned round. See `Battlefield.updateLeapers`.
    special: 'leap',
    attack: { kind: 'melee', knockback: 120 },
    // ANTI-CHAFF, and a flesh producer. The age-two pair are the creed's answer
    // to a screen of cheap bodies and its main source of income at the same
    // time: they are built to open unarmoured things up, and what they open up
    // is what the Bonewrights carry home.
    bonusVs: { unarmored: 1.75, light: 1.45 },
    harvest: { meat: 2 },
    description: 'A rider on something that was also someone. It goes through chaff like a comb, and leaves the field wet.',
    visual: look('nekrotics', { kind: 'rider', torso: 'fur', weapon: 'axe', helmet: 'horns' , plan: 'ripjaw'})
  },
  {
    id: 'nk_butcher',
    line: 'carnage_render',
    name: 'Butcher',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 950,
    buildMs: 3600,
    hp: 2100,
    armor: 'light',
    damage: 230,
    damageType: 'slash',
    attackMs: 900,
    range: 50,
    speed: 50,
    mass: 3,
    bounty: 361,
    xp: 314,
    pop: 2,
    height: 72,
    special: 'lifesteal',
    attack: { kind: 'melee', knockback: 200 },
    description: 'Drinks two fifths of every wound it opens. Starving it is the only argument it hears.',
    visual: look('nekrotics', { helmet: 'kettle', torso: 'coat', weapon: 'axe', bulk: 1.4 , plan: 'butcher'})
  },
  {
    id: 'nk_shrike',
    line: 'carnage_execute',
    name: 'Shrike',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 820,
    buildMs: 3300,
    hp: 780,
    armor: 'unarmored',
    damage: 190,
    damageType: 'pierce',
    attackMs: 1050,
    // TWO BODIES OF REACH, AND NOT A SHOOTER.
    //
    // Carnage is not supposed to have a gun line. The Shrike used to be a
    // javelin at three hundred pixels, which made the creed's answer to a
    // backline "stand at the back and out-range it" — the opposite of everything
    // else about it. It is a melee weapon now, with a haft made of muscle: it
    // reaches over the man in front and stabs, and if it wants something further
    // away than that it has to walk.
    range: 150,
    speed: 48,
    mass: 1.6,
    bounty: 312,
    xp: 271,
    pop: 2,
    height: 66,
    conduct: 'hunt',
    special: 'headtaker',
    attack: { kind: 'melee', knockback: 70 },
    description: 'Tentacles with beaks on the end. It picks whoever is closest to finished and takes the head off them.',
    visual: look('nekrotics', { torso: 'coat', weapon: 'tentacle', helmet: 'hood', bulk: 1.05 , plan: 'shrike'})
  },
  {
    // ══════════════════════ AGE FOUR — THE RENDERING ══════════════════════
    //
    // The last age of Carnage is not four bigger soldiers. It is four different
    // relationships with the meat on the ground: one that hides behind it, one
    // that eats it, one that manufactures it, and one that is not a body at all.

    // THE FLESH WALL. Architecture, grown rather than built.
    //
    // Three files wide, nearly immobile, and it does not really fight — it
    // stands in front of what does. Its whole trick is that it repairs itself
    // out of whatever is lying around it, so a carnage commander who has been
    // fighting on their own ground has a wall that will not stop mending, and
    // one who has pushed out into a clean field has a slab of meat with a
    // timer on it.
    id: 'nk_fleshwall',
    name: 'Flesh Wall',
    age: 4,
    role: 'tank',
    layer: 'ground',
    cost: 2300,
    buildMs: 6000,
    hp: 9600,
    armor: 'heavy',
    damage: 180,
    damageType: 'blunt',
    attackMs: 2000,
    range: 58,
    speed: 12,
    mass: 12,
    bounty: 874,
    xp: 760,
    pop: 3,
    height: 190,
    laneSpan: 3,
    conduct: 'screen',
    special: 'flesh_wall',
    attack: { kind: 'melee', knockback: 220 },
    description: 'It was grown, not raised. Three files of it, and it knits itself back together out of whatever is lying nearby.',
    visual: look('nekrotics', { kind: 'mech', chassis: 'legs', torso: 'bare', weapon: 'none', helmet: 'none', bulk: 2.1 , plan: 'fleshwall'})
  },
  {
    // THE MONSTRUM. It eats the field and it does not stop growing.
    //
    // Deliberately underwhelming on the card: a Monstrum bought into a clean
    // field is a bad elite. Walk it across a slaughter and every piece it
    // swallows is PERMANENT — damage, health and silhouette all climb, with no
    // ceiling, and the growth is visible from across the board. It is the
    // creed's whole thesis made into one object: the dead are a resource, and
    // this is what happens when something eats enough of them.
    id: 'nk_monstrum',
    line: 'carnage_tank',
    name: 'Monstrum',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 2100,
    buildMs: 5600,
    hp: 3400,
    armor: 'light',
    damage: 300,
    damageType: 'slash',
    attackMs: 1100,
    range: 62,
    speed: 46,
    mass: 7,
    bounty: 798,
    xp: 694,
    pop: 3,
    height: 120,
    special: 'monstrum',
    attack: { kind: 'melee', knockback: 300, splash: 90 },
    bonusVs: { unarmored: 1.3, light: 1.2 },
    harvest: { meat: 1 },
    description: 'Feed it. That is the entire instruction. Everything it swallows it keeps, and you can watch it keep it.',
    visual: look('nekrotics', { kind: 'mech', chassis: 'beast', torso: 'fur', weapon: 'axe', helmet: 'horns', bulk: 1.5 , plan: 'monstrum'})
  },
  {
    // THE GREAT MAW. A factory for the harvest, pointed the wrong way.
    //
    // It does not push and it barely moves. It DRAGS — everything in reach is
    // pulled toward it instead of being knocked away — and whatever dies in its
    // mouth is rendered onto YOUR half of the field no matter where on the
    // board it was standing. Every other unit in the game turns your gold into
    // damage. This one turns their army into your economy.
    id: 'nk_maw',
    line: 'carnage_tank',
    name: 'The Great Maw',
    age: 4,
    role: 'siege',
    layer: 'ground',
    cost: 2900,
    buildMs: 6400,
    hp: 4200,
    armor: 'heavy',
    damage: 520,
    damageType: 'slash',
    attackMs: 1800,
    range: 250,
    speed: 30,
    mass: 11,
    bounty: 1102,
    xp: 958,
    pop: 4,
    height: 200,
    laneSpan: 3,
    special: 'devour',
    attack: { kind: 'melee', knockback: 400, splash: 150 },
    harvest: { meat: 2, bone: 1 },
    description: 'A mouth on legs, and a very long tongue. What goes in comes out on your side of the field.',
    visual: look('nekrotics', { kind: 'mech', chassis: 'legs', torso: 'bare', weapon: 'none', helmet: 'horns', bulk: 1.9 , plan: 'maw'})
  },
  {
    // THE INCARNATION OF SLAUGHTER. A payment, not a soldier.
    //
    // Buying this card puts nothing on the field. It pays into the offer, and
    // the SIGIL over your fortress grows by one mark — that is the whole tell,
    // and it is what the earlier invisible version of this card was missing.
    // The board changes when you pay, just not where a soldier would stand.
    //
    // Then, every thirty seconds, the Incarnation takes somebody: the best
    // melee body on the board, either side, consumed where it stands so the
    // demon-lord can rise in its place. One at a time, always — see
    // `Battlefield.updateIncarnation`.
    id: 'nk_incarnation',
    line: 'carnage_capstone',
    name: 'Incarnation of Slaughter',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 1200,
    buildMs: 4000,
    hp: 1,
    armor: 'unarmored',
    damage: 0,
    damageType: 'slash',
    attackMs: 1000,
    range: 0,
    speed: 0,
    mass: 1,
    bounty: 0,
    xp: 0,
    pop: 0,
    height: 60,
    invest: 'incarnation',
    attack: { kind: 'melee', knockback: 0 },
    description: 'Nothing arrives. The sigil over your fortress grows another mark, and every half minute something on the field stops being whose it was.',
    visual: look('nekrotics', { torso: 'robe', weapon: 'none', helmet: 'horns', cape: true, bulk: 1.1 })
  },
  {
    // WHAT RISES WHERE THE HOST STOOD.
    //
    // Never bought and never on a bar: `Battlefield.possess` consumes the
    // chosen soldier and spawns this in its place, under the investor's flag.
    //
    // It is a REPLACEMENT rather than a buff on the host because unit art is
    // bound in the `Unit` constructor from `def.id` — there is no way to re-skin
    // a standing soldier — and a possession the player cannot see is the exact
    // failure that got this whole mechanic pulled once already.
    //
    // Medium. Not a Titan: it is a duellist that arrives where it likes, kills
    // one clump, and is gone inside half a minute. The threat is the placement,
    // not the tonnage — a swing this slow is dodgeable by anything that keeps
    // moving, and it cannot hold ground because it will not live long enough.
    id: 'nk_incarnation_lord',
    name: 'Incarnation of Slaughter',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 0,
    buildMs: 0,
    hp: 4200,
    armor: 'heavy',
    // One swing, one clump. Enormous damage on an enormous cooldown: it should
    // read as an execution, not a damage-per-second contribution.
    damage: 1500,
    damageType: 'slash',
    attackMs: 3200,
    range: 84,
    speed: 34,
    mass: 10,
    bounty: 900,
    xp: 700,
    pop: 0,
    // TALL AND THIN. An age-4 footman is ~70 and the Titan it replaces is 250:
    // this sits deliberately between them, head and shoulders over the line it
    // walks through without ever being the biggest thing on the field. The
    // `incarnation` plan carries the slenderness — bulk stays low so nothing
    // widens it back out.
    height: 185,
    crit: 0.25,
    hidden: true,
    special: 'incarnate_lord',
    attack: { kind: 'melee', knockback: 460, splash: 210 },
    bonusVs: { heavy: 1.2, structure: 1.15 },
    description: 'It steps out of the air with a sword already swinging, and whatever was standing there is not any more.',
    visual: look('nekrotics', {
      torso: 'bare',
      weapon: 'none',
      helmet: 'horns',
      bulk: 0.92,
      plan: 'incarnation',
      accent: 0xff2d20
    })
  },
  {
    id: 'nk_widow',
    line: 'carnage_air',
    name: 'Carrion Widow',
    age: 3,
    role: 'air',
    layer: 'air',
    cost: 2000,
    buildMs: 5000,
    hp: 1700,
    armor: 'air',
    damage: 260,
    damageType: 'slash',
    attackMs: 1300,
    range: 280,
    speed: 86,
    mass: 2,
    bounty: 760,
    xp: 661,
    pop: 3,
    height: 52,
    conduct: 'hunt',
    special: 'lifesteal',
    hitsAir: true,
    attack: { kind: 'projectile', projectile: 'bolt', speed: 900, gravity: 0, spread: 0.05, knockback: 60 },
    description: 'The carnage answer to the sky: it feeds on what it strikes, and it strikes the weakest first.',
    visual: look('nekrotics', { kind: 'aircraft', chassis: 'rotor', torso: 'bare', weapon: 'saber', bulk: 1.05 , plan: 'widow'})
  },

  // ══════════════════════ THE CARNAGE LINES, CLIMBED ══════════════════════
  //
  // Every slot on the Carnage bar is a LINE with one rung per age, and a rung
  // arrives one of two ways. A TIER BUMP is the same body with more of it: it
  // costs no research, because ageing up is what paid for it. A MUTATION is a
  // different body doing a different thing, and it always sits behind a node.
  //
  //   flank    Ripjaw a2 → Ripjaw Alpha a3 (bump) → Skinrider a4 (node)
  //   render   Flenser a2 → Butcher of the Yard a3 (node) → Flensing Host a4
  //   mind     Brain Stealer a2 (node) → Brood Nurse a3 (bump) → Mind Flayer a4
  //   execute  Shrike a3 → The Headsman a4 (node)
  //   raise    Carrion Choir a3 → Charnel Engine a4 (node)
  //   tank     Monstrum a3 (node) → The Great Maw a4 (node)
  //   air      Carrion Widow a3 → Widow Queen a4 (node)
  //
  // Only ever one rung of a line is on the bar, so the bar reads 1 → 4 → 8 → 10
  // and ageing up feels like the army growing rather than the menu growing.
  {
    // THE MIND LINE. The creed's research economy, standing on the field.
    //
    // Skulls pay for research, and this is the body built to collect them. It
    // does not fight: it lobs a live thing at somebody two files away, and the
    // thing climbs. Crabs do almost nothing on their own — a few points a
    // second each — but every one riding a soldier raises the height at which
    // that soldier can simply be finished, and a soldier who dies with crabs on
    // him has one of them walk his brain home. See `Battlefield.updateCrabs`.
    id: 'nk_brainstealer',
    line: 'carnage_mind',
    name: 'Brain Stealer',
    age: 2,
    role: 'support',
    layer: 'ground',
    cost: 540,
    buildMs: 3300,
    hp: 900,
    armor: 'unarmored',
    damage: 18,
    damageType: 'pierce',
    attackMs: 1900,
    range: 330,
    speed: 26,
    mass: 3.2,
    bounty: 232,
    xp: 202,
    pop: 2,
    height: 62,
    special: 'crab_spit',
    attack: {
      kind: 'projectile',
      projectile: 'crab',
      speed: 540,
      gravity: 480,
      spread: 0.06,
      knockback: 0,
      muzzle: [10, -22]
    },
    harvest: { skull: 2 },
    description: 'A mound that waddles, and spits something that lands on its feet. What it takes is not the body.',
    visual: look('nekrotics', { kind: 'mech', torso: 'bare', weapon: 'none', helmet: 'none', bulk: 1.35, plan: 'brainstealer', accent: 0x4ba7ff })
  },
  {
    // A TIER BUMP, and the model for what one is: the same animal, more of it.
    // It arrives with the third age and costs no research. More crabs per throw,
    // a longer throw, and a bigger sac to keep them in.
    id: 'nk_broodnurse',
    line: 'carnage_mind',
    name: 'Brood Nurse',
    age: 3,
    role: 'support',
    layer: 'ground',
    cost: 900,
    buildMs: 3800,
    hp: 1500,
    armor: 'unarmored',
    damage: 24,
    damageType: 'pierce',
    attackMs: 1700,
    range: 350,
    speed: 24,
    mass: 4,
    bounty: 342,
    xp: 298,
    pop: 2,
    height: 72,
    special: 'crab_spit',
    attack: {
      kind: 'projectile',
      projectile: 'crab',
      speed: 560,
      gravity: 460,
      spread: 0.09,
      count: 2,
      knockback: 0,
      muzzle: [12, -26]
    },
    harvest: { skull: 3 },
    description: 'It stopped spitting them one at a time. The sac on its back is where they wait.',
    visual: look('nekrotics', { kind: 'mech', torso: 'bare', weapon: 'none', helmet: 'none', bulk: 1.55, plan: 'brainstealer', accent: 0x4ba7ff })
  },
  {
    // A MUTATION, and the reason the line is worth climbing: it stops throwing.
    // Everything hostile inside its reach is seeded continuously, so the crabs
    // stop being a thing you aim and become weather. It is very slow, it dies to
    // anything that reaches it, and it is why an army wants a screen.
    id: 'nk_mindflayer',
    line: 'carnage_mind',
    name: 'Mind Flayer',
    age: 4,
    role: 'support',
    layer: 'ground',
    cost: 1650,
    buildMs: 5200,
    hp: 2000,
    armor: 'light',
    damage: 0,
    damageType: 'pierce',
    attackMs: 1600,
    range: 320,
    speed: 22,
    mass: 5,
    bounty: 627,
    xp: 545,
    pop: 3,
    height: 84,
    special: 'mind_flayer',
    attack: { kind: 'melee', knockback: 0 },
    harvest: { skull: 4 },
    description: 'It no longer throws them. It simply stands there, and they are already on you.',
    visual: look('nekrotics', { kind: 'mech', torso: 'robe', weapon: 'tentacle', helmet: 'hood', bulk: 1.5, plan: 'mindflayer', accent: 0x6ec8ff })
  },
  {
    // THE FLANK LINE, bumped. The Ripjaw that has been eating.
    id: 'nk_ripjaw_alpha',
    line: 'carnage_flank',
    name: 'Ripjaw Alpha',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 780,
    buildMs: 3600,
    hp: 1700,
    armor: 'light',
    damage: 175,
    damageType: 'slash',
    attackMs: 600,
    range: 48,
    speed: 96,
    mass: 3,
    bounty: 297,
    xp: 258,
    pop: 2,
    height: 82,
    conduct: 'hunt',
    flanker: true,
    special: 'leap',
    attack: { kind: 'melee', knockback: 150 },
    bonusVs: { unarmored: 1.75, light: 1.45 },
    harvest: { meat: 3 },
    description: 'The one that kept the pack. Same bound, longer, and it lands on something that matters.',
    visual: look('nekrotics', { kind: 'rider', torso: 'fur', weapon: 'axe', helmet: 'horns', bulk: 1.3, plan: 'ripjaw' })
  },
  {
    // A MUTATION off the flank line: it stops trying to kill things and starts
    // riding them. The leap ends with it ON the target, which cannot swing while
    // it is being worn, and it steps off onto the next one when the first drops.
    // Heaviest against the things a flanker normally cannot touch.
    id: 'nk_skinrider',
    line: 'carnage_flank',
    name: 'Skinrider',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 1500,
    buildMs: 4400,
    hp: 1400,
    armor: 'light',
    damage: 120,
    damageType: 'slash',
    attackMs: 700,
    range: 46,
    speed: 104,
    mass: 2.2,
    bounty: 570,
    xp: 495,
    pop: 2,
    height: 74,
    conduct: 'hunt',
    flanker: true,
    special: 'skinride',
    attack: { kind: 'melee', knockback: 40 },
    bonusVs: { light: 1.4, heavy: 1.7 },
    harvest: { meat: 2 },
    description: 'It lands on the back of the biggest thing in the file and stays there. The thing stops being a threat some time before it stops being alive.',
    visual: look('nekrotics', { kind: 'rider', torso: 'bare', weapon: 'tentacle', helmet: 'none', bulk: 1.05, plan: 'skinrider', accent: 0xe85a47 })
  },
  {
    // THE RENDER LINE's last rung, and a mutation in the truest sense: it is not
    // one butcher, it is three lesser ones that share a nervous system. Any kill
    // by any of them quickens all three, so the card accelerates as a unit and
    // erases a screen faster than one large body ever could.
    id: 'nk_flensing_host',
    line: 'carnage_render',
    name: 'Flensing Host',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 1900,
    buildMs: 5000,
    hp: 1100,
    armor: 'light',
    damage: 130,
    damageType: 'slash',
    attackMs: 900,
    range: 50,
    speed: 46,
    mass: 2,
    bounty: 241,
    xp: 210,
    pop: 3,
    squad: 3,
    height: 78,
    special: 'host_frenzy',
    attack: { kind: 'melee', knockback: 150, splash: 60 },
    bonusVs: { unarmored: 1.85, light: 1.5 },
    harvest: { meat: 3 },
    description: 'Three of them, cut from the same body and still sharing it. What one of them kills, all three of them feel.',
    visual: look('nekrotics', { torso: 'fur', weapon: 'axe', helmet: 'horns', bulk: 1.1, plan: 'flensinghost', accent: 0xf05a48 })
  },
  {
    // THE EXECUTE LINE's last rung. The Shrike picks off whoever is nearly done;
    // this finishes them outright below a threshold, and the finishing is
    // CONTAGIOUS — everything in the file flinches when a head comes off, which
    // is how one body breaks a rank rather than shortening it.
    id: 'nk_headsman',
    line: 'carnage_execute',
    name: 'The Headsman',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 1700,
    buildMs: 4600,
    hp: 1600,
    armor: 'light',
    damage: 300,
    damageType: 'pierce',
    attackMs: 1200,
    range: 160,
    speed: 46,
    mass: 2.4,
    bounty: 646,
    xp: 562,
    pop: 3,
    height: 88,
    conduct: 'hunt',
    special: 'headsman',
    attack: { kind: 'melee', knockback: 90 },
    harvest: { skull: 3 },
    description: 'It does not fight a rank. It walks down one, and the rank watches.',
    visual: look('nekrotics', { torso: 'coat', weapon: 'axe', helmet: 'hood', bulk: 1.2, plan: 'headsman', accent: 0xf3e7cf })
  },
  {
    // THE RAISE LINE's last rung. The Choir mends a file and rebuilds a body out
    // of what is lying nearby; the Engine does not wait to be asked. It stands
    // over your half of the field and mills whatever is on it, continuously, and
    // what comes out the back is chaff walking forward.
    id: 'nk_charnel_engine',
    line: 'carnage_raise',
    name: 'Charnel Engine',
    age: 4,
    role: 'support',
    layer: 'ground',
    cost: 2200,
    buildMs: 5800,
    hp: 3000,
    armor: 'heavy',
    damage: 0,
    damageType: 'blunt',
    attackMs: 2400,
    range: 220,
    speed: 30,
    mass: 7,
    bounty: 836,
    xp: 727,
    pop: 3,
    height: 98,
    special: 'charnel_engine',
    attack: { kind: 'heal', amount: 220, radius: 220 },
    description: 'A mill with a crew that has stopped complaining. It goes through the field faster than the field can rot.',
    visual: look('nekrotics', {
      kind: 'vehicle',
      chassis: 'tracks',
      torso: 'coat',
      weapon: 'none',
      helmet: 'hood',
      bulk: 1.6,
      plan: 'charnelengine', accent: 0xf0dfbf
    })
  },
  {
    // THE AIR LINE's last rung. The Widow feeds on what it strikes; the Queen
    // lays in it. Every kill leaves an egg on the ground where the body fell,
    // and what climbs out of the egg walks forward — the creed's thesis said in
    // the one place the creed normally cannot reach.
    id: 'nk_widow_queen',
    line: 'carnage_air',
    name: 'Widow Queen',
    age: 4,
    role: 'air',
    layer: 'air',
    cost: 2800,
    buildMs: 6200,
    hp: 2600,
    armor: 'air',
    damage: 330,
    damageType: 'slash',
    attackMs: 1200,
    range: 300,
    speed: 82,
    mass: 2.6,
    bounty: 1064,
    xp: 925,
    pop: 4,
    height: 64,
    conduct: 'hunt',
    special: 'widow_brood',
    hitsAir: true,
    attack: { kind: 'projectile', projectile: 'bolt', speed: 920, gravity: 0, spread: 0.04, knockback: 70 },
    description: 'It does not feed on what it kills. It leaves something in it, and the something gets up.',
    visual: look('nekrotics', { kind: 'aircraft', chassis: 'rotor', torso: 'robe', weapon: 'tentacle', bulk: 1.35, plan: 'widowqueen', accent: 0xeedcb8 })
  },
  {
    id: 'ch_petardier',
    name: 'Petardier',
    age: 2,
    role: 'ranged',
    layer: 'ground',
    cost: 520,
    buildMs: 3000,
    hp: 560,
    armor: 'light',
    damage: 150,
    damageType: 'explosive',
    attackMs: 2100,
    range: 240,
    minRange: 90,
    speed: 46,
    mass: 1.8,
    bounty: 198,
    xp: 172,
    pop: 1,
    height: 66,
    special: 'suppress',
    attack: { kind: 'projectile', projectile: 'grenade', speed: 480, gravity: 520, spread: 0.06, knockback: 140, splash: 80 },
    description: 'Its petards concuss: whatever survives the blast answers half a beat late, every time.',
    visual: look('cinder_host', { torso: 'vest', weapon: 'grenade', helmet: 'combat' })
  },
  {
    id: 'ch_skyburst',
    name: 'Skyburst Crew',
    age: 3,
    role: 'ranged',
    layer: 'ground',
    cost: 760,
    buildMs: 3200,
    hp: 900,
    armor: 'light',
    damage: 120,
    damageType: 'pierce',
    attackMs: 820,
    range: 340,
    speed: 40,
    mass: 2.4,
    bounty: 289,
    xp: 251,
    pop: 2,
    height: 68,
    hitsAir: true,
    bonusVs: { air: 2.2 },
    attack: { kind: 'projectile', projectile: 'bullet', speed: 1500, gravity: 0, spread: 0.05, knockback: 30 },
    description: 'A dedicated flak battery. The sky belongs to whoever brought one.',
    visual: look('cinder_host', { torso: 'plate', weapon: 'rpg', helmet: 'combat' })
  },
  {
    id: 'ch_breacher',
    name: 'Breacher',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 880,
    buildMs: 3400,
    hp: 1600,
    armor: 'heavy',
    damage: 240,
    damageType: 'explosive',
    attackMs: 1300,
    range: 70,
    speed: 44,
    mass: 4,
    bounty: 334,
    xp: 291,
    pop: 2,
    height: 70,
    conduct: 'phalanx',
    attack: { kind: 'melee', knockback: 240, splash: 70 },
    description: 'A set pike whose head is a shaped charge. Reads a charge coming and detonates it early.',
    visual: look('cinder_host', { torso: 'plate', weapon: 'spear', helmet: 'great' })
  },
  {
    id: 'ch_barrage_walker',
    name: 'Barrage Walker',
    age: 4,
    role: 'siege',
    layer: 'ground',
    cost: 2700,
    buildMs: 6000,
    hp: 2600,
    armor: 'heavy',
    damage: 240,
    damageType: 'explosive',
    attackMs: 3400,
    range: 470,
    minRange: 140,
    speed: 24,
    mass: 8,
    bounty: 1026,
    xp: 893,
    pop: 3,
    height: 215,
    // The top of the elite curve is a minute of income and is meant to read
    // as a different KIND of object, not a bigger soldier. Three files wide,
    // and tall enough that the men beside it come up to its knee.
    laneSpan: 3,
    special: 'suppress',
    attack: { kind: 'projectile', projectile: 'rocket', speed: 640, gravity: 240, spread: 0.09, knockback: 160, splash: 90, count: 4 },
    description: 'Four tubes on legs. The barrage is not meant to kill a line so much as stop it answering.',
    visual: look('cinder_host', { kind: 'mech', torso: 'plate', weapon: 'rpg', helmet: 'great', chassis: 'legs', bulk: 1.6 })
  },
  {
    id: 'ch_detonant',
    name: 'Detonant',
    age: 4,
    role: 'melee',
    layer: 'ground',
    cost: 1050,
    buildMs: 2600,
    hp: 1100,
    armor: 'light',
    damage: 100,
    damageType: 'explosive',
    attackMs: 1500,
    range: 40,
    speed: 72,
    mass: 2,
    bounty: 399,
    xp: 347,
    pop: 2,
    height: 64,
    special: 'kamikaze',
    attack: { kind: 'melee', knockback: 60 },
    description: 'It does not fight. It arrives, once, and the arriving is the weapon.',
    visual: look('cinder_host', { torso: 'vest', weapon: 'none', helmet: 'combat' })
  },
  {
    id: 'cy_arc_welder',
    name: 'Arc Welder',
    age: 2,
    role: 'melee',
    layer: 'ground',
    cost: 680,
    buildMs: 4200,
    hp: 1100,
    armor: 'heavy',
    damage: 210,
    damageType: 'energy',
    attackMs: 1500,
    range: 130,
    speed: 44,
    mass: 3,
    bounty: 258,
    xp: 224,
    pop: 2,
    height: 68,
    bonusVs: { heavy: 1.6 },
    attack: { kind: 'projectile', projectile: 'laserbolt', speed: 1200, gravity: 0, spread: 0.01, knockback: 40 },
    description: 'An industrial cutter pointed at the war. Armour is a material it was built to work.',
    visual: look('cyborgs', { helmet: 'kettle', torso: 'plate', weapon: 'lance', shield: 'energy', bulk: 1.2 })
  },
  {
    id: 'cy_aegis_node',
    name: 'Aegis Node',
    age: 3,
    role: 'support',
    layer: 'ground',
    cost: 900,
    buildMs: 4200,
    hp: 1300,
    armor: 'heavy',
    damage: 0,
    damageType: 'energy',
    attackMs: 1000,
    range: 140,
    speed: 36,
    mass: 4,
    bounty: 342,
    xp: 298,
    pop: 2,
    height: 66,
    attack: { kind: 'aura', damageReduction: 0.22, radius: 140 },
    description: 'A walking dome projector. Everything under its umbrella takes a fifth less.',
    visual: look('cyborgs', { torso: 'exo', weapon: 'none', helmet: 'halo' })
  },
  {
    id: 'cy_hornet',
    name: 'Hornet Frame',
    age: 3,
    role: 'air',
    layer: 'air',
    cost: 1150,
    buildMs: 4400,
    hp: 950,
    armor: 'air',
    damage: 160,
    damageType: 'pierce',
    attackMs: 1600,
    range: 330,
    speed: 105,
    mass: 1.5,
    bounty: 437,
    xp: 380,
    pop: 2,
    height: 40,
    hitsAir: true,
    bonusVs: { air: 1.5 },
    attack: { kind: 'projectile', projectile: 'rocket', speed: 800, gravity: 0, spread: 0.02, knockback: 60, homing: 1.8 },
    description: 'An interceptor whose missiles do not miss. Built to clear the sky, adequate at everything else.',
    visual: look('cyborgs', { kind: 'aircraft', chassis: 'hover', torso: 'exo' })
  },
  {
    id: 'cy_railborne',
    name: 'Railborne',
    age: 4,
    role: 'siege',
    layer: 'ground',
    cost: 3000,
    buildMs: 6400,
    hp: 2000,
    armor: 'heavy',
    damage: 760,
    damageType: 'pierce',
    attackMs: 5200,
    range: 560,
    minRange: 220,
    speed: 18,
    mass: 10,
    bounty: 1140,
    xp: 992,
    pop: 4,
    height: 80,
    special: 'penetrator_shot',
    bonusVs: { heavy: 1.7, structure: 1.5 },
    attack: { kind: 'projectile', projectile: 'railslug', speed: 2800, gravity: 0, spread: 0.004, knockback: 300 },
    description: 'Artillery that fires a line, not a point: the slug goes through the first thing and the next.',
    visual: look('cyborgs', { kind: 'vehicle', chassis: 'tracks', machine: 'catapult', bulk: 1.5 })
  },
  {
    id: 'cy_colossus',
    name: 'Colossus Frame',
    age: 4,
    role: 'tank',
    layer: 'ground',
    cost: 4400,
    buildMs: 7600,
    hp: 7800,
    armor: 'heavy',
    damage: 680,
    damageType: 'energy',
    attackMs: 2300,
    range: 420,
    speed: 22,
    mass: 12,
    bounty: 1672,
    xp: 1455,
    pop: 5,
    height: 235,
    // The top of the elite curve is a minute of income and is meant to read
    // as a different KIND of object, not a bigger soldier. Three files wide,
    // and tall enough that the men beside it come up to its knee.
    laneSpan: 3,
    special: 'siege_mode',
    attack: { kind: 'projectile', projectile: 'plasmaball', speed: 900, gravity: 0, spread: 0.02, knockback: 180, splash: 70 },
    description: 'The quality argument, concluded. The longer it plants, the further its light reaches.',
    visual: look('cyborgs', { kind: 'mech', torso: 'exo', weapon: 'plasma', helmet: 'halo', chassis: 'legs', bulk: 1.9 })
  },
  {
    id: 'dc_flagellant',
    name: 'Flagellant',
    age: 2,
    role: 'melee',
    layer: 'ground',
    cost: 460,
    buildMs: 2800,
    hp: 820,
    armor: 'unarmored',
    damage: 125,
    damageType: 'slash',
    attackMs: 800,
    range: 42,
    speed: 62,
    mass: 1.8,
    bounty: 175,
    xp: 152,
    pop: 1,
    height: 68,
    special: 'soul_siphon',
    attack: { kind: 'melee', knockback: 70 },
    description: 'Every wound it deals feeds it, and tithes the dark ability a little closer to ready.',
    visual: look('dark_circle', { torso: 'bare', weapon: 'sword', helmet: 'hood' })
  },
  {
    id: 'dc_seer',
    name: 'Seer of the Ninth',
    age: 3,
    role: 'support',
    layer: 'ground',
    cost: 880,
    buildMs: 3800,
    hp: 850,
    armor: 'unarmored',
    damage: 0,
    damageType: 'energy',
    attackMs: 1600,
    range: 190,
    speed: 42,
    mass: 1.8,
    bounty: 334,
    xp: 291,
    pop: 2,
    height: 68,
    special: 'terror',
    attack: { kind: 'heal', amount: 220, radius: 190 },
    description: 'Mends its own and unmans the enemy: everything near it swings a beat slower than it meant to.',
    visual: look('dark_circle', { helmet: 'none', torso: 'robe', weapon: 'none', cape: true })
  },
  {
    id: 'dc_reaper',
    name: 'Reaper of the Circle',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 1000,
    buildMs: 3600,
    hp: 1300,
    armor: 'light',
    damage: 280,
    damageType: 'slash',
    attackMs: 1100,
    range: 48,
    speed: 88,
    mass: 2.2,
    bounty: 380,
    xp: 331,
    pop: 2,
    height: 72,
    conduct: 'hunt',
    flanker: true,
    special: 'soul_harvest',
    attack: { kind: 'melee', knockback: 130 },
    description: 'Each kill refreshes the scythe and closes its wounds. It only slows down when you stop dying.',
    visual: look('dark_circle', { torso: 'robe', weapon: 'saber', helmet: 'hood', cape: true })
  },
  {
    id: 'dc_voidmaw',
    name: 'Voidmaw',
    age: 4,
    role: 'ranged',
    layer: 'ground',
    cost: 2500,
    buildMs: 5600,
    hp: 2200,
    armor: 'unarmored',
    damage: 360,
    damageType: 'energy',
    attackMs: 2600,
    range: 400,
    speed: 34,
    mass: 4,
    bounty: 950,
    xp: 826,
    pop: 3,
    height: 76,
    special: 'gravity_well',
    attack: { kind: 'projectile', projectile: 'plasmaball', speed: 620, gravity: 0, spread: 0.02, knockback: 0, splash: 130 },
    description: 'Its blasts do not throw the enemy away. They gather them in, for the next one.',
    visual: look('dark_circle', { helmet: 'hood', torso: 'coat', weapon: 'none', cape: true, bulk: 1.4 })
  },
  {
    id: 'dc_pale_king',
    name: 'The Pale King',
    age: 4,
    role: 'tank',
    layer: 'ground',
    cost: 3000,
    buildMs: 6200,
    hp: 5600,
    armor: 'heavy',
    damage: 430,
    damageType: 'slash',
    attackMs: 1200,
    range: 56,
    speed: 44,
    mass: 6,
    bounty: 1140,
    xp: 992,
    pop: 4,
    height: 84,
    special: 'stagger_ward',
    attack: { kind: 'melee', knockback: 280, splash: 90 },
    description: 'Where he stands, the line does not flinch — no stagger, no shove, no argument.',
    visual: look('dark_circle', { torso: 'plate', weapon: 'sword', helmet: 'great', cape: true, bulk: 1.3 })
  },
  {
    id: 'hb_thornback',
    name: 'Thornback',
    age: 2,
    role: 'melee',
    layer: 'ground',
    cost: 560,
    buildMs: 3200,
    hp: 1150,
    armor: 'heavy',
    damage: 130,
    damageType: 'pierce',
    attackMs: 1250,
    range: 72,
    speed: 42,
    mass: 4,
    bounty: 213,
    xp: 185,
    pop: 2,
    height: 70,
    regen: 14,
    conduct: 'phalanx',
    attack: { kind: 'melee', knockback: 150 },
    description: 'A hedge with opinions: a set of living pikes that regrows between charges.',
    visual: look('hollow_bloom', { torso: 'fur', weapon: 'spear', helmet: 'horns', bulk: 1.2 })
  },
  {
    id: 'hb_galltosser',
    name: 'Gall Tosser',
    age: 3,
    role: 'ranged',
    layer: 'ground',
    cost: 800,
    buildMs: 3400,
    hp: 900,
    armor: 'unarmored',
    damage: 170,
    damageType: 'pierce',
    attackMs: 1250,
    range: 300,
    speed: 46,
    mass: 1.8,
    bounty: 304,
    xp: 264,
    pop: 2,
    height: 68,
    special: 'toxin',
    attack: { kind: 'projectile', projectile: 'bolt', speed: 700, gravity: 120, spread: 0.05, knockback: 40 },
    description: 'Its darts are the least of it. What the darts carry keeps working long after they land.',
    visual: look('hollow_bloom', { helmet: 'hood', torso: 'fur', weapon: 'sling', bulk: 1.1 })
  },
  {
    id: 'hb_creeper',
    name: 'Creeper',
    age: 3,
    role: 'melee',
    layer: 'ground',
    cost: 900,
    buildMs: 3400,
    hp: 1200,
    armor: 'light',
    damage: 200,
    damageType: 'slash',
    attackMs: 800,
    range: 44,
    speed: 94,
    mass: 2.2,
    bounty: 342,
    xp: 298,
    pop: 2,
    height: 66,
    conduct: 'hunt',
    flanker: true,
    special: 'spore_trail',
    attack: { kind: 'melee', knockback: 90 },
    description: 'A flanker that colonises: everywhere it runs, the ground it crossed is no longer yours.',
    visual: look('hollow_bloom', { torso: 'fur', weapon: 'sword', helmet: 'horns' })
  },
  {
    id: 'hb_grovekeeper',
    name: 'Grovekeeper',
    age: 4,
    role: 'support',
    layer: 'ground',
    cost: 1600,
    buildMs: 4800,
    hp: 2000,
    armor: 'light',
    damage: 0,
    damageType: 'energy',
    attackMs: 1500,
    range: 220,
    speed: 40,
    mass: 4,
    bounty: 608,
    xp: 529,
    pop: 3,
    height: 78,
    special: 'bog_pulse',
    attack: { kind: 'heal', amount: 380, radius: 220 },
    description: 'Every mending pulse feeds its own and takes the enemy by the ankles in the same breath.',
    visual: look('hollow_bloom', { helmet: 'great', torso: 'fur', weapon: 'staff', bulk: 1.35 })
  },
  {
    id: 'hb_rotwhale',
    name: 'Rotwhale',
    age: 4,
    role: 'air',
    layer: 'air',
    cost: 2600,
    buildMs: 6000,
    hp: 3200,
    armor: 'air',
    damage: 300,
    damageType: 'explosive',
    attackMs: 2800,
    range: 300,
    speed: 56,
    mass: 6,
    bounty: 988,
    xp: 860,
    pop: 4,
    height: 74,
    special: 'spore_trail',
    attack: { kind: 'projectile', projectile: 'bomb', speed: 420, gravity: 700, spread: 0.08, knockback: 200, splash: 140 },
    description: 'A drifting gasbag that bombs the line and seeds the lane beneath itself as it goes.',
    visual: look('hollow_bloom', { kind: 'aircraft', chassis: 'hover', torso: 'fur', bulk: 1.6 })
  },
]

/** Which path a unit belongs to, read off the id it was authored with. */
const FACTION_BY_PREFIX: Record<string, FactionId> = {
  nk_: 'nekrotics',
  cy_: 'cyborgs',
  dc_: 'dark_circle',
  ch_: 'cinder_host',
  hb_: 'hollow_bloom'
}

/**
 * Place every soldier inside its creed's colour territory.
 *
 * `look()` above gives each unit its creed's palette *centre* — which, on its
 * own, made ten Nekrotics ten copies of one colour scheme. This runs once over
 * the finished roster and moves each unit to its own point in the family,
 * derived from its rank, its role and its own name. The creed still owns the
 * hue; the soldier owns everything else.
 *
 * It runs here rather than inside `look()` because the placement needs the
 * unit's age, role and cost, and those are authored below the visual — a unit
 * cannot describe its own rank before it has one.
 */
for (const unit of FACTION_UNITS) {
  const faction = FACTION_BY_PREFIX[unit.id.slice(0, 3)]
  if (!faction) continue
  Object.assign(unit.visual, creedColours(faction, unit))
}

/**
 * The faction rosters ride the same per-age power curve as the core one. See
 * AGE_POWER_SCALE in data/units.ts — without this the creed units keep the old
 * crater at age four and a creed army gets measurably worse than a vanilla one
 * at exactly the point a player commits to it.
 */
for (const unit of FACTION_UNITS) {
  const k = AGE_POWER_SCALE[Math.max(0, Math.min(AGE_POWER_SCALE.length - 1, unit.age))]
  if (k === 1) continue
  unit.hp = Math.round(unit.hp * k)
  unit.damage = Math.round(unit.damage * k)
}

// The creed rosters ride the same three curves as the neutral one. `relayCurves`
// works off constants alone, so running it here and in units.ts gives every unit
// the same answer regardless of which module a caller loaded first.
relayCurves(FACTION_UNITS)

/** The five units an ascended army fields. */
export function factionRoster(id: FactionId): UnitDef[] {
  const prefix: Record<FactionId, string> = {
    nekrotics: 'nk_',
    cyborgs: 'cy_',
    dark_circle: 'dc_',
    cinder_host: 'ch_',
    hollow_bloom: 'hb_'
  }
  return FACTION_UNITS.filter(u => u.id.startsWith(prefix[id]) && !u.hidden)
}
