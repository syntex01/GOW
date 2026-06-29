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
