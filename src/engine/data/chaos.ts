import type { Datasheet } from '../types';

/**
 * Chaos Space Marines (Heretic Astartes) faction datasheets.
 *
 * Numeric profiles are the real Warhammer 40,000 10th-edition stats.
 * Stats follow the engine's "N+" convention; Weapon.ap is a non-negative
 * magnitude (AP -1 -> ap: 1).
 *
 * Faction rule "Dark Pacts": before shooting/fighting a unit may take a
 * Leadership test to grant its weapons [LETHAL HITS] or [SUSTAINED HITS 1]
 * (D3 mortal wounds on a failure). It is an opt-in, conditional roll with no
 * clean engine hook, so it is carried as descriptive ability text only — we
 * deliberately do NOT fake the mechanic. Where a weapon already has a printed
 * critical-hit ability it is modelled with the existing WeaponKeyword.
 */

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Legionaries (10th ed)
export const chaosLegionaries: Datasheet = {
  id: 'chaos_legionaries',
  name: 'Legionaries',
  faction: 'chaos',
  keywords: ['INFANTRY', 'BATTLELINE', 'CHAOS', 'GRENADES', 'LEGIONARIES', 'HERETIC ASTARTES'],
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
      id: 'csm_boltgun',
      name: 'Boltgun',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
    {
      id: 'csm_bolt_pistol',
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
      id: 'csm_chainsword',
      name: 'Astartes Chainsword',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 3, // WS 3+
      strength: 4,
      ap: 1, // AP -1
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
      // Opt-in conditional roll — no clean engine hook, carried as text only.
    },
    {
      name: 'Veterans of the Long War',
      text: 'This unit re-rolls Wound rolls of 1 in melee.',
      effect: { t: 'reroll', phase: 'wound', scope: 'ones' },
    },
  ],
  composition: [
    {
      modelName: 'Aspiring Champion',
      min: 1,
      max: 1,
      defaultWeaponIds: ['csm_boltgun', 'csm_bolt_pistol', 'csm_chainsword'],
    },
    {
      modelName: 'Legionary',
      min: 4,
      max: 9,
      defaultWeaponIds: ['csm_boltgun', 'csm_bolt_pistol', 'csm_chainsword'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 90, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#3a3338', // dark iron
    secondary: '#8a5a2a', // brass trim
    metalness: 0.7,
    glow: '#d61f1f', // warp-red glow
    heightInches: 1.5,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Chosen (10th ed)
// Default loadout: paired accursed weapons (Twin-linked) + boltgun.
export const chaosChosen: Datasheet = {
  id: 'chaos_chosen',
  name: 'Chosen',
  faction: 'chaos',
  keywords: ['INFANTRY', 'CHAOS', 'GRENADES', 'CHOSEN', 'HERETIC ASTARTES'],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    wounds: 2,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'chosen_boltgun',
      name: 'Boltgun',
      kind: 'ranged',
      range: 24,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
    {
      id: 'paired_accursed_weapons',
      name: 'Paired Accursed Weapons',
      kind: 'melee',
      range: 0,
      attacks: 5,
      skill: 3, // WS 3+
      strength: 5,
      ap: 2, // AP -2
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
    },
    {
      name: 'Chosen Marauders',
      text: 'This unit can shoot and declare a charge in a turn in which it Advanced or Fell Back.',
      // Eligibility relaxation not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Chosen Champion',
      min: 1,
      max: 1,
      defaultWeaponIds: ['chosen_boltgun', 'paired_accursed_weapons'],
    },
    {
      modelName: 'Chosen',
      min: 4,
      max: 9,
      defaultWeaponIds: ['chosen_boltgun', 'paired_accursed_weapons'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 125, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#3a3338',
    secondary: '#8a5a2a',
    metalness: 0.7,
    glow: '#d61f1f',
    heightInches: 1.6,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Chaos-Lord (10th ed)
// Default loadout: Plasma Pistol (supercharge) + Daemon Hammer.
export const chaosLord: Datasheet = {
  id: 'chaos_lord',
  name: 'Chaos Lord',
  faction: 'chaos',
  keywords: ['INFANTRY', 'CHARACTER', 'GRENADES', 'CHAOS', 'CHAOS LORD', 'HERETIC ASTARTES'],
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
      id: 'lord_plasma_pistol',
      name: 'Plasma Pistol (Supercharge)',
      kind: 'ranged',
      range: 12,
      attacks: 1,
      skill: 2, // BS 2+
      strength: 8,
      ap: 3, // AP -3
      damage: 2,
      keywords: [{ t: 'pistol' }, { t: 'hazardous' }],
    },
    {
      id: 'lord_daemon_hammer',
      name: 'Daemon Hammer',
      kind: 'melee',
      range: 0,
      attacks: 5,
      skill: 3, // WS 3+
      strength: 8,
      ap: 2, // AP -2
      damage: 2,
      keywords: [{ t: 'devastatingWounds' }],
    },
  ],
  abilities: [
    {
      name: 'Leader',
      text: 'Can attach to a Legionaries or Chosen unit to lead it.',
      effect: { t: 'leader', canLeadDatasheetIds: ['chaos_legionaries', 'chaos_chosen'] },
    },
    {
      name: 'Invulnerable Save',
      text: 'This model has a 4+ invulnerable save.',
      effect: { t: 'invuln', value: 4 },
    },
    {
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
    },
    {
      name: 'Lord of Chaos',
      text: 'Once per battle round, reduce the CP cost of a Stratagem used on this unit by 1.',
      // Stratagem/CP effect -> no engine hook.
    },
  ],
  composition: [
    {
      modelName: 'Chaos Lord',
      min: 1,
      max: 1,
      defaultWeaponIds: ['lord_plasma_pistol', 'lord_daemon_hammer'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: true,
  points: 90,
  proxy: {
    silhouette: 'character',
    primary: '#3a3338',
    secondary: '#8a5a2a',
    metalness: 0.7,
    glow: '#d61f1f',
    heightInches: 1.9,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Accursed-Cultists (10th ed)
// The engine fields one uniform profile per unit, so we model the bulk Mutant
// profile (with the Torment's higher wound pool folded into the squad as a unit
// of melee-only cultists).
export const chaosCultists: Datasheet = {
  id: 'chaos_cultists',
  name: 'Accursed Cultists',
  faction: 'chaos',
  keywords: ['INFANTRY', 'CHAOS', 'DAMNED', 'ACCURSED CULTISTS', 'HERETIC ASTARTES'],
  statline: {
    move: 6,
    toughness: 3,
    save: 6, // 6+
    feelNoPain: 6, // 6+++
    wounds: 1,
    leadership: 7, // 7+
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'blasphemous_appendages',
      name: 'Blasphemous Appendages',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 4, // WS 4+
      strength: 4,
      ap: 1,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Feel No Pain 6+',
      text: 'This unit has a 6+ Feel No Pain.',
      effect: { t: 'feelNoPain', value: 6 },
    },
    {
      name: 'Scouts 6"',
      text: 'This unit may make a 6" Scout move before the first turn.',
      effect: { t: 'scouts', inches: 6 },
    },
    {
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
    },
  ],
  composition: [
    {
      modelName: 'Mutant',
      min: 8,
      max: 16,
      defaultWeaponIds: ['blasphemous_appendages'],
    },
  ],
  baseSizeMm: 25,
  isCharacter: false,
  points: 90, // 8 models
  proxy: {
    silhouette: 'infantry',
    primary: '#5a4a3a', // grubby flesh/rags
    secondary: '#8a5a2a',
    metalness: 0.1,
    glow: '#d61f1f',
    heightInches: 1.3,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Raptors (10th ed)
export const chaosRaptors: Datasheet = {
  id: 'chaos_raptors',
  name: 'Raptors',
  faction: 'chaos',
  keywords: ['INFANTRY', 'JUMP PACK', 'FLY', 'CHAOS', 'GRENADES', 'RAPTORS', 'HERETIC ASTARTES'],
  statline: {
    move: 12,
    toughness: 4,
    save: 3, // 3+
    wounds: 2,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'raptor_bolt_pistol',
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
      id: 'raptor_chainsword',
      name: 'Astartes Chainsword',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 3, // WS 3+
      strength: 4,
      ap: 1, // AP -1
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    {
      name: 'Deep Strike',
      text: 'This unit can be set up in Reserves and arrive by Deep Strike.',
      effect: { t: 'deepStrike' },
    },
    {
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
    },
    {
      name: 'Fearsome',
      text: 'Enemy units within 6" subtract 1 from Battle-shock and Leadership tests.',
      // Aura on enemy Leadership not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Raptor Champion',
      min: 1,
      max: 1,
      defaultWeaponIds: ['raptor_bolt_pistol', 'raptor_chainsword'],
    },
    {
      modelName: 'Raptor',
      min: 4,
      max: 9,
      defaultWeaponIds: ['raptor_bolt_pistol', 'raptor_chainsword'],
    },
  ],
  baseSizeMm: 32,
  isCharacter: false,
  points: 110, // 5 models
  proxy: {
    silhouette: 'infantry',
    primary: '#3a3338',
    secondary: '#8a5a2a',
    metalness: 0.7,
    glow: '#d61f1f',
    heightInches: 1.8, // jump-pack profile
  },
};

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Helbrute (10th ed)
// Default loadout: Multi-melta + Helbrute Fist.
export const chaosHelbrute: Datasheet = {
  id: 'chaos_helbrute',
  name: 'Helbrute',
  faction: 'chaos',
  keywords: ['VEHICLE', 'WALKER', 'CHAOS', 'HELBRUTE', 'HERETIC ASTARTES'],
  statline: {
    move: 8,
    toughness: 9,
    save: 2, // 2+
    wounds: 8,
    leadership: 6, // 6+
    objectiveControl: 3,
  },
  weapons: [
    {
      id: 'helbrute_multimelta',
      name: 'Multi-melta',
      kind: 'ranged',
      range: 18,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 9,
      ap: 4, // AP -4
      damage: 'D6',
      keywords: [{ t: 'melta', x: 2 }],
    },
    {
      id: 'helbrute_fist',
      name: 'Helbrute Fist',
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
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
    },
    {
      name: 'Deadly Demise 1',
      text: 'When destroyed, on a 6 each unit within 6" suffers 1 mortal wound.',
      // Destruction-trigger not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Helbrute',
      min: 1,
      max: 1,
      defaultWeaponIds: ['helbrute_multimelta', 'helbrute_fist'],
    },
  ],
  baseSizeMm: 60,
  isCharacter: false,
  points: 130,
  proxy: {
    silhouette: 'monster',
    primary: '#3a3338',
    secondary: '#8a5a2a',
    metalness: 0.8,
    glow: '#d61f1f',
    heightInches: 3.2,
  },
};

// source: wahapedia.ru/wh40k10ed/factions/chaos-space-marines/Master-of-Possession (10th ed)
// Default loadout: Rite of Possession (witchfire) + Staff of Possession.
export const chaosMasterOfPossession: Datasheet = {
  id: 'chaos_master_of_possession',
  name: 'Master of Possession',
  faction: 'chaos',
  keywords: ['INFANTRY', 'CHARACTER', 'PSYKER', 'CHAOS', 'MASTER OF POSSESSION', 'HERETIC ASTARTES'],
  statline: {
    move: 6,
    toughness: 4,
    save: 3, // 3+
    invuln: 4, // 5+
    wounds: 4,
    leadership: 6, // 6+
    objectiveControl: 1,
  },
  weapons: [
    {
      id: 'rite_of_possession',
      name: 'Rite of Possession',
      kind: 'ranged',
      range: 18,
      attacks: 2,
      skill: 3, // BS 3+
      strength: 4,
      ap: 1, // AP -3
      damage: 2,
      keywords: [{ t: 'anti', keyword: 'PSYKER', x: 2 }, { t: 'pistol' }, { t: 'precision' }],
    },
    {
      id: 'staff_of_possession',
      name: 'Staff of Possession',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 3, // WS 3+
      strength: 6,
      ap: 1, // AP -1
      damage: 'D3',
      keywords: [{ t: 'anti', keyword: 'PSYKER', x: 2 }],
    },
  ],
  abilities: [
    {
      name: 'Leader',
      text: 'Can attach to a Legionaries or Chosen unit to lead it.',
      effect: { t: 'leader', canLeadDatasheetIds: ['chaos_legionaries', 'chaos_chosen'] },
    },
    {
      name: 'Invulnerable Save',
      text: 'This model has a 5+ invulnerable save.',
      effect: { t: 'invuln', value: 5 },
    },
    {
      name: 'Dark Pacts',
      text: 'Before shooting/fighting, take a Leadership test to grant this unit [LETHAL HITS] or [SUSTAINED HITS 1]; on a failure it suffers D3 mortal wounds.',
    },
    {
      name: 'Daemonkin',
      text: 'While leading a unit, add 1 to that unit’s Advance and Charge rolls.',
      // Movement-roll aura not modelled by the engine; descriptive only.
    },
  ],
  composition: [
    {
      modelName: 'Master of Possession',
      min: 1,
      max: 1,
      defaultWeaponIds: ['rite_of_possession', 'staff_of_possession'],
    },
  ],
  baseSizeMm: 40,
  isCharacter: true,
  points: 60,
  proxy: {
    silhouette: 'character',
    primary: '#3a3338',
    secondary: '#8a5a2a',
    metalness: 0.6,
    glow: '#d61f1f',
    heightInches: 1.9,
  },
};
