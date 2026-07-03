import type { Datasheet } from '../types';

/**
 * Necrons faction datasheets.
 *
 * Numeric profiles are the real Warhammer 40,000 10th-edition stats.
 * Stats follow the engine's "N+" convention: a save/skill/leadership of N
 * means N+, and Weapon.ap is stored as a non-negative magnitude.
 */

// source: wahapedia.ru/wh40k10ed/factions/necrons/Necron-Warriors (10th ed)
export const necronWarriors: Datasheet = {
  id: 'necron_warriors',
  name: 'Necron Warriors',
  faction: 'necrons',
  keywords: ['INFANTRY', 'BATTLELINE', 'NECRON WARRIORS', 'NECRONS'],
  statline: {
    move: 5,
    toughness: 4,
    save: 4, // 4+
    wounds: 1,
    leadership: 7, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'gauss_flayer',
      name: 'Gauss Flayer',
      kind: 'ranged',
      range: 24,
      attacks: 1,
      skill: 4, // BS 4+
      strength: 4,
      ap: 1,
      damage: 1,
      keywords: [{ t: 'rapidFire', x: 1 }],
    },
    {
      id: 'gauss_reaper',
      name: 'Gauss Reaper',
      kind: 'ranged',
      range: 12,
      attacks: 2,
      skill: 4, // BS 4+
      strength: 4,
      ap: 2, // AP -2
      damage: 1,
      keywords: [],
    },
    {
      id: 'necron_ccw',
      name: 'Close Combat Weapon',
      kind: 'melee',
      range: 0,
      attacks: 1,
      skill: 4, // WS 4+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this unit reanimates D3 wounds, restoring slain models.',
      effect: { t: 'reanimation', wounds: 3 }, // D3 cap; engine rolls the die
    },
    {
      name: 'Their Number is Legion',
      text: "Re-roll the dice when this unit's Reanimation Protocols activate.",
      // No engine hook; reroll is handled inside the reanimation step.
    },
  ],
  composition: [
    {
      modelName: 'Necron Warrior',
      min: 10,
      max: 20,
      defaultWeaponIds: ['gauss_flayer', 'necron_ccw'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 90, // 10 models
  proxy: {
    silhouette: 'infantry',
    primary: '#b8c0c8', // metallic silver
    secondary: '#39ff7a', // green glow accents
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 1.4,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Overlord (10th ed)
// Default loadout: Staff of Light (ranged + melee profiles) and the one-shot Tachyon Arrow.
export const necronOverlord: Datasheet = {
  id: 'necron_overlord',
  name: 'Necron Overlord',
  faction: 'necrons',
  keywords: ['INFANTRY', 'CHARACTER', 'NOBLE', 'OVERLORD', 'NECRONS'],
  statline: {
    move: 5,
    toughness: 5,
    save: 3, // 3+
    invuln: 4, // 4+
    wounds: 5,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'staff_of_light_ranged',
      name: 'Staff of Light',
      kind: 'ranged',
      range: 18,
      attacks: 3,
      skill: 2, // BS 2+
      strength: 5,
      ap: 2, // AP -2
      damage: 1,
      keywords: [],
    },
    {
      id: 'tachyon_arrow',
      name: 'Tachyon Arrow',
      kind: 'ranged',
      range: 72,
      attacks: 1,
      skill: 2, // BS 2+
      strength: 16,
      ap: 5, // AP -5
      damage: 'D6+2',
      keywords: [{ t: 'oneShot' }],
    },
    {
      id: 'staff_of_light_melee',
      name: 'Staff of Light',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 2, // WS 2+
      strength: 5,
      ap: 2, // AP -2
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Leader',
      text: 'Can attach to a Necron Warriors unit to lead it.',
      effect: { t: 'leader', canLeadDatasheetIds: ['necron_warriors'] },
    },
    {
      name: 'Invulnerable Save',
      text: 'This model has a 4+ invulnerable save.',
      effect: { t: 'invuln', value: 4 },
    },
    {
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this model reanimates D3 lost wounds.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'My Will Be Done',
      text: 'Once per battle round one of your units can be targeted by a Stratagem at reduced CP cost.',
      // 10th-ed rule is a Stratagem/CP effect (not a hit re-roll aura) -> no engine hook.
    },
    {
      name: 'Implacable Resilience',
      text: 'Subtract 1 from the Damage of each attack allocated to this model.',
      // Damage-reduction not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Necron Overlord',
      min: 1,
      max: 1,
      defaultWeaponIds: ['staff_of_light_ranged', 'staff_of_light_melee', 'tachyon_arrow'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: true,
  points: 85,
  proxy: {
    silhouette: 'character',
    primary: '#b8c0c8', // metallic silver
    secondary: '#39ff7a', // green glow accents
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 2.0, // a bit taller than rank-and-file Warriors
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Immortals (10th ed)
// Default loadout: Gauss Blasters.
export const necronImmortals: Datasheet = {
  id: 'necron_immortals',
  name: 'Immortals',
  faction: 'necrons',
  keywords: ['INFANTRY', 'IMMORTALS', 'NECRONS'],
  statline: {
    move: 5,
    toughness: 5,
    save: 3, // 3+
    wounds: 1,
    leadership: 7, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'gauss_blaster',
      name: 'Gauss Blaster',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 5,
      ap: 2, // AP -2
      damage: 1,
      keywords: [{ t: 'lethalHits' }],
    },
    {
      id: 'immortal_ccw',
      name: 'Close Combat Weapon',
      kind: 'melee',
      range: 0,
      attacks: 2,
      skill: 3, // WS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this unit reanimates D3 wounds, restoring slain models.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'Implacable Eradication',
      text: 'This unit re-rolls Wound rolls of 1 with its ranged weapons.',
      effect: { t: 'reroll', phase: 'wound', scope: 'ones' },
    },
  ],
  composition: [
    {
      modelName: 'Immortal',
      min: 5,
      max: 10,
      defaultWeaponIds: ['gauss_blaster', 'immortal_ccw'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 70, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#b8c0c8',
    secondary: '#39ff7a',
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 1.5,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Lychguard (10th ed)
// Default loadout: Warscythes (no shield -> no extra invuln).
export const necronLychguard: Datasheet = {
  id: 'necron_lychguard',
  name: 'Lychguard',
  faction: 'necrons',
  keywords: ['INFANTRY', 'LYCHGUARD', 'NECRONS'],
  statline: {
    move: 5,
    toughness: 5,
    save: 3, // 3+
    wounds: 2,
    leadership: 7, // 7+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'warscythe',
      name: 'Warscythe',
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
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this unit reanimates D3 wounds, restoring slain models.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'Guardian Protocols',
      text: 'A bodyguard escort for Necron Nobles, soaking hits meant for the warlord.',
      // Damage-redirection not modelled; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Lychguard',
      min: 5,
      max: 10,
      defaultWeaponIds: ['warscythe'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 85, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#b8c0c8',
    secondary: '#39ff7a',
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 1.7,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Canoptek-Scarab-Swarms (10th ed)
export const necronScarabs: Datasheet = {
  id: 'necron_scarabs',
  name: 'Canoptek Scarab Swarms',
  faction: 'necrons',
  keywords: ['SWARM', 'FLY', 'CANOPTEK', 'SCARAB SWARMS', 'NECRONS'],
  statline: {
    move: 10,
    toughness: 3,
    save: 6, // 6+
    wounds: 3,
    leadership: 8, // 8+
    objectiveControl: 0,
  },
  weapons: [
    {
      id: 'feeder_mandibles',
      name: 'Feeder Mandibles',
      kind: 'melee',
      range: 0,
      attacks: 6,
      skill: 4, // WS 4+
      strength: 2,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'lethalHits' }],
    },
  ],
  abilities: [
    {
      name: 'Swarm',
      text: 'Fast, expendable Canoptek constructs that screen and tie up the enemy.',
    },
  ],
  composition: [
    {
      modelName: 'Canoptek Scarab Swarm',
      min: 3,
      max: 6,
      defaultWeaponIds: ['feeder_mandibles'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: false,
  points: 40, // 3 models
  proxy: {
    silhouette: 'monster',
    primary: '#7a8088',
    secondary: '#39ff7a',
    metalness: 0.8,
    glow: '#39ff7a',
    heightInches: 0.8,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Skorpekh-Destroyers (10th ed)
export const necronSkorpekhDestroyers: Datasheet = {
  id: 'necron_skorpekh_destroyers',
  name: 'Skorpekh Destroyers',
  faction: 'necrons',
  keywords: ['INFANTRY', 'DESTROYER CULT', 'SKORPEKH DESTROYERS', 'NECRONS'],
  statline: {
    move: 8,
    toughness: 6,
    save: 3, // 3+
    wounds: 3,
    leadership: 7, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'skorpekh_hyperphase',
      name: 'Skorpekh Hyperphase Weapons',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 3, // WS 3+
      strength: 7,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this unit reanimates D3 wounds, restoring slain models.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'Whirling Onslaught',
      text: 'This unit re-rolls melee Hit rolls of 1 (all Hit rolls if it charged this turn).',
      effect: { t: 'reroll', phase: 'hit', scope: 'ones' },
    },
  ],
  composition: [
    {
      modelName: 'Skorpekh Destroyer',
      min: 3,
      max: 6,
      defaultWeaponIds: ['skorpekh_hyperphase'],
    },
  ],
  baseSizeMm: 50,
  isCharacter: false,
  points: 90, // 3 models
  proxy: {
    silhouette: 'monster',
    primary: '#b8c0c8',
    secondary: '#39ff7a',
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 2.2,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Canoptek-Wraiths (10th ed)
// Default loadout: Vicious Claws.
export const necronWraiths: Datasheet = {
  id: 'necron_wraiths',
  name: 'Canoptek Wraiths',
  faction: 'necrons',
  keywords: ['BEASTS', 'FLY', 'CANOPTEK', 'WRAITHS', 'NECRONS'],
  statline: {
    move: 10,
    toughness: 6,
    save: 4, // 4+
    invuln: 4, // 4+
    wounds: 4,
    leadership: 8, // 8+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'particle_caster',
      name: 'Particle Caster',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 4, // BS 4+
      strength: 6,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'pistol' }],
    },
    {
      id: 'vicious_claws',
      name: 'Vicious Claws',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 3, // WS 3+
      strength: 6,
      ap: 2, // AP -2
      damage: 2,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this unit reanimates D3 wounds, restoring slain models.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'Invulnerable Save',
      text: 'This model has a 4+ invulnerable save.',
      effect: { t: 'invuln', value: 4 },
    },
  ],
  composition: [
    {
      modelName: 'Canoptek Wraith',
      min: 3,
      max: 6,
      defaultWeaponIds: ['particle_caster', 'vicious_claws'],
    },
  ],
  baseSizeMm: 50,
  isCharacter: false,
  points: 110, // 3 models
  proxy: {
    silhouette: 'monster',
    primary: '#b8c0c8',
    secondary: '#39ff7a',
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 1.8,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Doomsday-Ark (10th ed)
export const necronDoomsdayArk: Datasheet = {
  id: 'necron_doomsday_ark',
  name: 'Doomsday Ark',
  faction: 'necrons',
  keywords: ['VEHICLE', 'FLY', 'DOOMSDAY ARK', 'NECRONS'],
  statline: {
    move: 10,
    toughness: 9,
    save: 3, // 3+
    wounds: 14,
    leadership: 7, // 7+
    objectiveControl: 5,
  },
  weapons: [
    {
      id: 'doomsday_cannon',
      name: 'Doomsday Cannon (Blast)',
      kind: 'ranged',
      range: 72,
      attacks: 'D6+1',
      skill: 3, // BS 3+
      strength: 16,
      ap: 4, // AP -4
      damage: 'D6+1',
      keywords: [{ t: 'heavy' }, { t: 'blast' }],
    },
    {
      id: 'gauss_flayer_array',
      name: 'Gauss Flayer Array',
      kind: 'ranged',
      range: 24,
      attacks: 5,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'rapidFire', x: 5 }],
    },
    {
      id: 'doomsday_armoured_bulk',
      name: 'Armoured Bulk',
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
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this model reanimates D3 lost wounds.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'Deadly Demise D3',
      text: 'When destroyed, on a 6 each unit within 6" suffers D3 mortal wounds.',
      // Destruction-trigger not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Doomsday Ark',
      min: 1,
      max: 1,
      defaultWeaponIds: ['doomsday_cannon', 'gauss_flayer_array', 'doomsday_armoured_bulk'],
    },
  ],
  baseSizeMm: 60,
  isCharacter: false,
  points: 200,
  proxy: {
    silhouette: 'vehicle',
    primary: '#b8c0c8',
    secondary: '#39ff7a',
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 3.0,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/necrons/Royal-Warden (10th ed)
export const necronRoyalWarden: Datasheet = {
  id: 'necron_royal_warden',
  name: 'Royal Warden',
  faction: 'necrons',
  keywords: ['INFANTRY', 'CHARACTER', 'NOBLE', 'ROYAL WARDEN', 'NECRONS'],
  statline: {
    move: 5,
    toughness: 4,
    save: 3, // 3+
    wounds: 4,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'relic_gauss_blaster',
      name: 'Relic Gauss Blaster',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 5,
      ap: 1, // AP -1
      damage: 1,
      keywords: [{ t: 'lethalHits' }],
    },
    {
      id: 'warden_ccw',
      name: 'Close Combat Weapon',
      kind: 'melee',
      range: 0,
      attacks: 3,
      skill: 3, // WS 3+
      strength: 5,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Leader',
      text: 'Can attach to a Necron Warriors or Immortals unit to lead it.',
      effect: { t: 'leader', canLeadDatasheetIds: ['necron_warriors', 'necron_immortals'] },
    },
    {
      name: 'Reanimation Protocols',
      text: 'At the end of your Command phase this model reanimates D3 lost wounds.',
      effect: { t: 'reanimation', wounds: 3 },
    },
    {
      name: 'Adaptive Strategy',
      text: 'The unit it leads is eligible to shoot and charge in a turn in which it Fell Back.',
      // Eligibility relaxation not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Royal Warden',
      min: 1,
      max: 1,
      defaultWeaponIds: ['relic_gauss_blaster', 'warden_ccw'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: true,
  points: 50,
  proxy: {
    silhouette: 'character',
    primary: '#b8c0c8',
    secondary: '#39ff7a',
    metalness: 0.9,
    glow: '#39ff7a',
    heightInches: 1.7,
  },
};
