import type { Datasheet } from '../types';

/**
 * Orks faction datasheets.
 *
 * Numeric profiles are the real Warhammer 40,000 10th-edition stats.
 * Stats follow the engine's "N+" convention; Weapon.ap is a non-negative
 * magnitude (AP -1 -> ap: 1). The engine fields a single uniform profile per
 * unit, so where a datasheet has a distinct Boss model we field the rank-and-
 * file profile and give the unit the squad's standard weapons.
 */

// source: wahapedia.ru/wh40k10ed/factions/orks/Boyz (10th ed)
export const orkBoyz: Datasheet = {
  id: 'ork_boyz',
  name: 'Boyz',
  faction: 'orks',
  keywords: ['INFANTRY', 'BATTLELINE', 'MOB', 'GRENADES', 'BOYZ', 'ORKS'],
  statline: {
    move: 6,
    toughness: 5,
    save: 6, // 5+
    wounds: 1,
    leadership: 6, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'slugga',
      name: 'Slugga',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 5, // BS 5+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'choppa',
      name: 'Choppa',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 4,
      ap: 0, // AP -1
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Waaagh!',
      text: 'Aggressive green-tide infantry that hit hard in melee in numbers.',
    },
  ],
  composition: [
    {
      modelName: 'Boy',
      min: 10,
      max: 20,
      defaultWeaponIds: ['slugga', 'choppa'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 80, // 10 models
  proxy: {
    silhouette: 'infantry',
    primary: '#3a7d28', // ork green
    secondary: '#7a4a1e', // brown/leather
    metalness: 0.2,
    heightInches: 1.5,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/orks/Nobz (10th ed)
// Default loadout: Big Choppas.
export const orkNobz: Datasheet = {
  id: 'ork_nobz',
  name: 'Nobz',
  faction: 'orks',
  keywords: ['INFANTRY', 'GRENADES', 'NOBZ', 'ORKS'],
  statline: {
    move: 6,
    toughness: 5,
    save: 4, // 4+
    wounds: 2,
    leadership: 6, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'nob_slugga',
      name: 'Slugga',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 5, // BS 5+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'big_choppa',
      name: 'Big Choppa',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 7,
      ap: 1, // AP -1
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: "Da Boss' Ladz",
      text: 'A hard-hitting bodyguard mob; tougher and more elite than the Boyz.',
    },
  ],
  composition: [
    {
      modelName: 'Nob',
      min: 5,
      max: 10,
      defaultWeaponIds: ['nob_slugga', 'big_choppa'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 105, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#3a7d28',
    secondary: '#9a9aa0', // metal armour plates
    metalness: 0.5,
    heightInches: 1.7,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/orks/Warboss (10th ed)
// Default loadout: Power Klaw + Twin slugga pistol.
export const orkWarboss: Datasheet = {
  id: 'ork_warboss',
  name: 'Warboss',
  faction: 'orks',
  keywords: ['INFANTRY', 'CHARACTER', 'GRENADES', 'WARBOSS', 'ORKS'],
  statline: {
    move: 6,
    toughness: 5,
    save: 4, // 4+
    invuln: 5, // 5+
    wounds: 6,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'twin_slugga',
      name: 'Twin Slugga',
      kind: 'ranged',
      range: 12,
      attacks: 2,
      skill: 5, // BS 5+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }, { t: 'twinLinked' }],
    },
    {
      id: 'warboss_power_klaw',
      name: 'Power Klaw',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 3, // WS 3+
      strength: 10,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Leader',
      text: 'Can attach to a Boyz or Nobz unit to lead it.',
      effect: { t: 'leader', canLeadDatasheetIds: ['ork_boyz', 'ork_nobz'] },
    },
    {
      name: 'Invulnerable Save',
      text: 'This model has a 5+ invulnerable save.',
      effect: { t: 'invuln', value: 5 },
    },
    {
      name: 'Might is Right',
      text: 'Add 1 to this unit’s melee hit rolls.',
      // Aura is modelled approximately as a melee hit re-roll of 1s on its unit.
      effect: { t: 'reroll', phase: 'hit', scope: 'ones' },
    },
  ],
  composition: [
    {
      modelName: 'Warboss',
      min: 1,
      max: 1,
      defaultWeaponIds: ['twin_slugga', 'warboss_power_klaw'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: true,
  points: 75,
  proxy: {
    silhouette: 'character',
    primary: '#3a7d28',
    secondary: '#b03020', // red war-paint
    metalness: 0.5,
    heightInches: 2.1,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/orks/Trukk (10th ed)
// Default loadout: Big Shoota.
export const orkTrukk: Datasheet = {
  id: 'ork_trukk',
  name: 'Trukk',
  faction: 'orks',
  keywords: ['VEHICLE', 'TRANSPORT', 'DEDICATED TRANSPORT', 'TRUKK', 'ORKS'],
  statline: {
    move: 12,
    toughness: 8,
    save: 4, // 4+
    wounds: 10,
    leadership: 7, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'big_shoota',
      name: 'Big Shoota',
      kind: 'ranged',
      range: 36,
      attacks: 3,
      skill: 5, // BS 5+
      strength: 5,
      ap: 0,
      damage: 1,
      keywords: [],
    },
    {
      id: 'spiked_wheels',
      name: 'Spiked Wheels',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 4, // WS 4+
      strength: 6,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Grot Riggers',
      text: 'At the start of your Command phase this model regains 1 lost wound.',
      effect: { t: 'reanimation', wounds: 1 }, // engine restores up to 1W per turn
    },
  ],
  composition: [
    {
      modelName: 'Trukk',
      min: 1,
      max: 1,
      defaultWeaponIds: ['big_shoota', 'spiked_wheels'],
    },
  ],
  baseSizeMm: 120, // hull footprint approximated as a large round base
  isCharacter: false,
  points: 70,
  proxy: {
    silhouette: 'vehicle',
    primary: '#7a4a1e', // rusty scrap
    secondary: '#3a7d28',
    metalness: 0.6,
    heightInches: 3.0,
  },
};
