import type { Datasheet } from '../types';

/**
 * Ultramarines (Adeptus Astartes / Space Marines) faction datasheets.
 *
 * Numeric profiles are the real Warhammer 40,000 10th-edition stats.
 * Stats follow the engine's "N+" convention; Weapon.ap is a non-negative
 * magnitude (AP -1 -> ap: 1).
 */

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Intercessor-Squad (10th ed)
export const intercessorSquad: Datasheet = {
  id: 'ultramarines_intercessors',
  name: 'Intercessor Squad',
  faction: 'ultramarines',
  keywords: [
    'INFANTRY',
    'BATTLELINE',
    'IMPERIUM',
    'TACTICUS',
    'INTERCESSOR SQUAD',
    'ADEPTUS ASTARTES',
  ],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    wounds: 2,
    leadership: 6, // 6+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'bolt_rifle',
      name: 'Bolt Rifle',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 4,
      ap: 1, // AP -1
      damage: 1,
      keywords: [{ t: 'assault' }, { t: 'heavy' }],
    },
    {
      id: 'bolt_pistol',
      name: 'Bolt Pistol',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'intercessor_ccw',
      name: 'Close Combat Weapon',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; this unit re-rolls hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
  ],
  composition: [
    {
      modelName: 'Intercessor Sergeant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['bolt_rifle', 'bolt_pistol', 'intercessor_ccw'],
    },
    {
      modelName: 'Intercessor',
      min: 4,
      max: 9,
      defaultWeaponIds: ['bolt_rifle', 'bolt_pistol', 'intercessor_ccw'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 80, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#2f5cc4', // Ultramarine blue
    secondary: '#e8c46a', // gold trim
    metalness: 0.4,
    heightInches: 1.5,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Captain (10th ed)
// Default loadout: master-crafted power weapon + plasma pistol (standard profile).
export const ultramarinesCaptain: Datasheet = {
  id: 'ultramarines_captain',
  name: 'Captain',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'CHARACTER', 'GRENADES', 'IMPERIUM', 'TACTICUS', 'CAPTAIN', 'ADEPTUS ASTARTES'],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    invuln: 4, // 4+
    wounds: 5,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'captain_plasma_pistol',
      name: 'Plasma Pistol',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 2, // BS 2+
      strength: 7,
      ap: 2, // AP -2
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'captain_power_weapon',
      name: 'Master-crafted Power Weapon',
      kind: 'melee',
      range: 0,
      attacks: 6,
      skill: 2, // WS 2+
      strength: 5,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Leader',
      text: 'Can attach to an Intercessor Squad to lead it.',
      effect: { t: 'leader', canLeadDatasheetIds: ['ultramarines_intercessors'] },
    },
    {
      name: 'Invulnerable Save',
      text: 'This model has a 4+ invulnerable save.',
      effect: { t: 'invuln', value: 4 },
    },
    {
      name: 'Rites of Battle',
      text: 'Once per battle round, reduce the CP cost of a Stratagem used on one of your units by 1.',
      // Stratagem/CP effect -> no engine hook.
    },
  ],
  composition: [
    {
      modelName: 'Captain',
      min: 1,
      max: 1,
      defaultWeaponIds: ['captain_plasma_pistol', 'captain_power_weapon'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: true,
  points: 80,
  proxy: {
    silhouette: 'character',
    primary: '#2f5cc4', // Ultramarine blue
    secondary: '#e8c46a', // gold trim
    metalness: 0.4,
    heightInches: 1.8, // slightly taller than rank-and-file Intercessors
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Assault-Intercessor-Squad (10th ed)
export const assaultIntercessors: Datasheet = {
  id: 'ultramarines_assault_intercessors',
  name: 'Assault Intercessor Squad',
  faction: 'ultramarines',
  keywords: [
    'INFANTRY',
    'BATTLELINE',
    'GRENADES',
    'IMPERIUM',
    'TACTICUS',
    'ASSAULT INTERCESSOR SQUAD',
    'ADEPTUS ASTARTES',
  ],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    wounds: 2,
    leadership: 6, // 6+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'heavy_bolt_pistol',
      name: 'Heavy Bolt Pistol',
      kind: 'ranged',
      range: 18,
      attacks: 1,
      skill: 3, // BS 3+
      strength: 4,
      ap: 1, // AP -1
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'astartes_chainsword',
      name: 'Astartes Chainsword',
      kind: 'melee',
      range: 0,
      attacks: 5,
      skill: 3, // WS 3+
      strength: 4,
      ap: 1, // AP -1
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; this unit re-rolls hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Shock Assault',
      text: 'This unit re-rolls Wound rolls of 1 in melee.',
      effect: { t: 'reroll', phase: 'wound', scope: 'ones' },
    },
  ],
  composition: [
    {
      modelName: 'Assault Intercessor Sergeant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['heavy_bolt_pistol', 'astartes_chainsword'],
    },
    {
      modelName: 'Assault Intercessor',
      min: 4,
      max: 9,
      defaultWeaponIds: ['heavy_bolt_pistol', 'astartes_chainsword'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 75, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#2f5cc4',
    secondary: '#c0392b', // red accents
    metalness: 0.4,
    heightInches: 1.5,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Terminator-Squad (10th ed)
// Default loadout: Storm Bolter + Power Fist (Sergeant carries a Power Fist too).
export const terminatorSquad: Datasheet = {
  id: 'ultramarines_terminators',
  name: 'Terminator Squad',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'TERMINATOR', 'IMPERIUM', 'TERMINATOR SQUAD', 'ADEPTUS ASTARTES'],
  statline: {
    move: 5,
    toughness: 5,
    save: 2, // 2+
    invuln: 4, // 4+
    wounds: 3,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'storm_bolter',
      name: 'Storm Bolter',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'rapidFire', x: 2 }],
    },
    {
      id: 'terminator_power_fist',
      name: 'Power Fist',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 8,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Deep Strike',
      text: 'This unit can be set up in Reserves and arrive by Deep Strike.',
      effect: { t: 'deepStrike' },
    },
  ],
  composition: [
    {
      modelName: 'Terminator Sergeant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['storm_bolter', 'terminator_power_fist'],
    },
    {
      modelName: 'Terminator',
      min: 4,
      max: 9,
      defaultWeaponIds: ['storm_bolter', 'terminator_power_fist'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: false,
  points: 170, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#2f5cc4',
    secondary: '#e8c46a',
    metalness: 0.6,
    heightInches: 1.9,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Hellblaster-Squad (10th ed)
// Default loadout: supercharged Plasma Incinerators (Hazardous).
export const hellblasterSquad: Datasheet = {
  id: 'ultramarines_hellblasters',
  name: 'Hellblaster Squad',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'IMPERIUM', 'TACTICUS', 'HELLBLASTER SQUAD', 'ADEPTUS ASTARTES'],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    wounds: 3,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'plasma_incinerator_super',
      name: 'Plasma Incinerator (Supercharge)',
      kind: 'ranged',
      range: 30,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 8,
      ap: 3, // AP -3
      damage: 2,
      keywords: [{ t: 'assault' }, { t: 'heavy' }, { t: 'hazardous' }],
    },
    {
      id: 'hellblaster_bolt_pistol',
      name: 'Bolt Pistol',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'hellblaster_ccw',
      name: 'Close Combat Weapon',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
  ],
  composition: [
    {
      modelName: 'Hellblaster Sergeant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['plasma_incinerator_super', 'hellblaster_bolt_pistol', 'hellblaster_ccw'],
    },
    {
      modelName: 'Hellblaster',
      min: 4,
      max: 9,
      defaultWeaponIds: ['plasma_incinerator_super', 'hellblaster_bolt_pistol', 'hellblaster_ccw'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 110, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#2f5cc4',
    secondary: '#3fe0d0', // plasma glow
    metalness: 0.4,
    glow: '#3fe0d0',
    heightInches: 1.5,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Redemptor-Dreadnought (10th ed)
// Default loadout: Macro Plasma Incinerator (standard) + Heavy Onslaught Gatling
// Cannon + Twin Fragstorm Grenade Launcher + Icarus Rocket Pod + Redemptor Fist.
export const redemptorDreadnought: Datasheet = {
  id: 'ultramarines_redemptor',
  name: 'Redemptor Dreadnought',
  faction: 'ultramarines',
  keywords: ['VEHICLE', 'WALKER', 'IMPERIUM', 'REDEMPTOR DREADNOUGHT', 'ADEPTUS ASTARTES'],
  statline: {
    move: 8,
    toughness: 10,
    save: 2, // 2+
    wounds: 12,
    leadership: 6, // 6+
    objectiveControl: 4,
  },
  weapons: [
    {
      id: 'macro_plasma_incinerator',
      name: 'Macro Plasma Incinerator',
      kind: 'ranged',
      range: 36,
      attacks: 'D6+1',
      skill: 3, // BS 3+
      strength: 8,
      ap: 3, // AP -3
      damage: 2,
      keywords: [{ t: 'blast' }],
    },
    {
      id: 'heavy_onslaught_gatling',
      name: 'Heavy Onslaught Gatling Cannon',
      kind: 'ranged',
      range: 24,
      attacks: 12,
      skill: 3, // BS 3+
      strength: 6,
      ap: 1, // AP -1
      damage: 1,
      keywords: [{ t: 'devastatingWounds' }],
    },
    {
      id: 'icarus_rocket_pod',
      name: 'Icarus Rocket Pod',
      kind: 'ranged',
      range: 24,
      attacks: 'D3',
      skill: 3, // BS 3+
      strength: 8,
      ap: 1, // AP -1
      damage: 2,
      keywords: [{ t: 'anti', keyword: 'FLY', x: 2 }],
    },
    {
      id: 'redemptor_fist',
      name: 'Redemptor Fist',
      kind: 'melee',
      range: 0,
      attacks: 5,
      skill: 3, // WS 3+
      strength: 12,
      ap: 2, // AP -2
      damage: 3,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Duty Eternal',
      text: 'Subtract 1 from the Damage of each attack allocated to this model.',
      // Damage-reduction not modelled by the engine; descriptive only.
    },
    {
      name: 'Deadly Demise D3',
      text: 'When destroyed, on a 6 each unit within 6" suffers D3 mortal wounds.',
      // Destruction-trigger not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Redemptor Dreadnought',
      min: 1,
      max: 1,
      defaultWeaponIds: [
        'macro_plasma_incinerator',
        'heavy_onslaught_gatling',
        'icarus_rocket_pod',
        'redemptor_fist',
      ],
    },
  ],
  baseSizeMm: 90,
  isCharacter: false,
  points: 205,
  proxy: {
    silhouette: 'monster',
    primary: '#2f5cc4',
    secondary: '#e8c46a',
    metalness: 0.6,
    heightInches: 3.4,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Bladeguard-Veteran-Squad (10th ed)
// Default loadout: Master-crafted Power Weapon + Heavy Bolt Pistol.
export const bladeguardVeterans: Datasheet = {
  id: 'ultramarines_bladeguard',
  name: 'Bladeguard Veteran Squad',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'IMPERIUM', 'TACTICUS', 'BLADEGUARD VETERAN SQUAD', 'ADEPTUS ASTARTES'],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    invuln: 4, // 4+
    wounds: 3,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'bladeguard_heavy_bolt_pistol',
      name: 'Heavy Bolt Pistol',
      kind: 'ranged',
      range: 18,
      attacks: 1,
      skill: 3, // BS 3+
      strength: 4,
      ap: 1, // AP -1
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'bladeguard_power_weapon',
      name: 'Master-crafted Power Weapon',
      kind: 'melee',
      range: 0,
      attacks: 5,
      skill: 3, // WS 3+
      strength: 5,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Swords of the Chapter',
      text: 'This unit re-rolls melee Hit rolls of 1.',
      effect: { t: 'reroll', phase: 'hit', scope: 'ones' },
    },
  ],
  composition: [
    {
      modelName: 'Bladeguard Veteran Sergeant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['bladeguard_heavy_bolt_pistol', 'bladeguard_power_weapon'],
    },
    {
      modelName: 'Bladeguard Veteran',
      min: 2,
      max: 5,
      defaultWeaponIds: ['bladeguard_heavy_bolt_pistol', 'bladeguard_power_weapon'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: false,
  points: 80, // 3 models
  proxy: {
    silhouette: 'infantry',
    primary: '#2f5cc4',
    secondary: '#e8c46a',
    metalness: 0.5,
    heightInches: 1.6,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Lieutenant (10th ed)
// Default loadout: Master-crafted Bolter + Master-crafted Power Weapon.
export const ultramarinesLieutenant: Datasheet = {
  id: 'ultramarines_lieutenant',
  name: 'Lieutenant',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'CHARACTER', 'GRENADES', 'IMPERIUM', 'TACTICUS', 'LIEUTENANT', 'ADEPTUS ASTARTES'],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    wounds: 4,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'lieutenant_mc_bolter',
      name: 'Master-crafted Bolter',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 2, // BS 2+
      strength: 4,
      ap: 1, // AP -1
      damage: 2,
      keywords: [],
    },
    {
      id: 'lieutenant_power_weapon',
      name: 'Master-crafted Power Weapon',
      kind: 'melee',
      range: 0,
      attacks: 5,
      skill: 2, // WS 2+
      strength: 5,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Leader',
      text: 'Can attach to an Intercessor, Assault Intercessor or Bladeguard Veteran unit to lead it.',
      effect: {
        t: 'leader',
        canLeadDatasheetIds: [
          'ultramarines_intercessors',
          'ultramarines_assault_intercessors',
          'ultramarines_bladeguard',
        ],
      },
    },
    {
      name: 'Tactical Precision',
      text: 'While leading a unit, that unit’s weapons gain [LETHAL HITS].',
      // Per-attack keyword injection not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Lieutenant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['lieutenant_mc_bolter', 'lieutenant_power_weapon'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: true,
  points: 55,
  proxy: {
    silhouette: 'character',
    primary: '#2f5cc4',
    secondary: '#e8c46a',
    metalness: 0.4,
    heightInches: 1.8,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/space-marines/Eradicator-Squad (10th ed)
// Default loadout: Melta Rifles (Heavy, Melta 2).
export const eradicatorSquad: Datasheet = {
  id: 'ultramarines_eradicators',
  name: 'Eradicator Squad',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'GRAVIS', 'IMPERIUM', 'ERADICATOR SQUAD', 'ADEPTUS ASTARTES'],
  statline: {
    move: 5,
    toughness: 6,
    save: 3, // 3+
    wounds: 3,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'melta_rifle',
      name: 'Melta Rifle',
      kind: 'ranged',
      range: 18,
      attacks: 1,
      skill: 3, // BS 3+
      strength: 9,
      ap: 4, // AP -4
      damage: 'D6',
      keywords: [{ t: 'heavy' }, { t: 'melta', x: 2 }],
    },
    {
      id: 'eradicator_bolt_pistol',
      name: 'Bolt Pistol',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'eradicator_ccw',
      name: 'Close Combat Weapon',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Oath of Moment',
      text: 'Each turn pick one enemy unit; re-roll hits and wounds against it.',
      effect: { t: 'oathOfMoment' },
    },
    {
      name: 'Total Obliteration',
      text: 'Re-roll Hit, Wound and Damage rolls for ranged attacks targeting a Monster or Vehicle.',
      // Conditional, target-dependent re-roll not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Eradicator Sergeant',
      min: 1,
      max: 1,
      defaultWeaponIds: ['melta_rifle', 'eradicator_bolt_pistol', 'eradicator_ccw'],
    },
    {
      modelName: 'Eradicator',
      min: 2,
      max: 5,
      defaultWeaponIds: ['melta_rifle', 'eradicator_bolt_pistol', 'eradicator_ccw'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: false,
  points: 90, // 3 models
  proxy: {
    silhouette: 'infantry',
    primary: '#2f5cc4',
    secondary: '#c0392b', // melta heat-glow accents
    metalness: 0.5,
    glow: '#c0392b',
    heightInches: 1.7,
  },
};
