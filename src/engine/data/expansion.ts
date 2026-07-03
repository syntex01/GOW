import type { Datasheet } from '../types';

/**
 * Roster expansion — additional datasheets to broaden each faction (Orks were
 * especially thin). Profiles follow 10th-edition conventions and the engine's
 * "N+" + non-negative-AP rules; each fields a single uniform profile. New units
 * reuse their faction's figure/vehicle/walker model and get a fitting death FX
 * via the silhouette/faction fallbacks, so no extra art wiring is needed.
 */

/* --------------------------------- Orks --------------------------------- */

export const orkGretchin: Datasheet = {
  id: 'ork_gretchin',
  name: 'Gretchin',
  faction: 'orks',
  keywords: ['INFANTRY', 'BATTLELINE', 'GRETCHIN', 'ORKS'],
  statline: { move: 5, toughness: 2, save: 7, wounds: 1, leadership: 7, objectiveControl: 1 },
  weapons: [
    { id: 'grot_blasta', name: 'Grot Blasta', kind: 'ranged', range: 12, attacks: 1, skill: 5, strength: 3, ap: 0, damage: 1, keywords: [] },
    { id: 'grot_ccw', name: 'Close Combat Weapon', kind: 'melee', range: 0, attacks: 1, skill: 5, strength: 2, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [{ name: 'Grots', text: 'A cheap, expendable screen of scurrying gits.' }],
  composition: [{ modelName: 'Grot', min: 10, max: 20, defaultWeaponIds: ['grot_blasta', 'grot_ccw'] }],
  baseSizeMm: 25,
  isCharacter: false,
  points: 40,
  proxy: { silhouette: 'infantry', primary: '#4a7d38', secondary: '#7a4a1e', metalness: 0.15, heightInches: 1.1 },
};

export const orkMeganobz: Datasheet = {
  id: 'ork_meganobz',
  name: 'Meganobz',
  faction: 'orks',
  keywords: ['INFANTRY', 'MEGANOBZ', 'ORKS'],
  statline: { move: 5, toughness: 5, save: 2, wounds: 3, leadership: 6, objectiveControl: 1 },
  weapons: [
    { id: 'kombi_weapon', name: 'Kombi-weapon', kind: 'ranged', range: 24, attacks: 1, skill: 5, strength: 5, ap: 1, damage: 1, keywords: [{ t: 'rapidFire', x: 1 }, { t: 'anti', keyword: 'INFANTRY', x: 4 }, { t: 'devastatingWounds' }] },
    { id: 'mega_klaw', name: 'Power Klaw', kind: 'melee', range: 0, attacks: 3, skill: 3, strength: 9, ap: 2, damage: 2, keywords: [] },
  ],
  abilities: [{ name: "'Ard as Nails", text: 'Walking tanks in mega-armour that hit like a Dreadnought.' }],
  composition: [{ modelName: 'Meganob', min: 3, max: 6, defaultWeaponIds: ['kombi_weapon', 'mega_klaw'] }],
  baseSizeMm: 40,
  isCharacter: false,
  points: 140,
  proxy: { silhouette: 'infantry', primary: '#3a7d28', secondary: '#8a8a90', metalness: 0.7, heightInches: 1.9 },
};

export const orkKillaKans: Datasheet = {
  id: 'ork_killakans',
  name: 'Killa Kans',
  faction: 'orks',
  keywords: ['VEHICLE', 'WALKER', 'KILLA KANS', 'ORKS'],
  statline: { move: 6, toughness: 8, save: 4, wounds: 8, leadership: 7, objectiveControl: 2 },
  weapons: [
    { id: 'kk_big_shoota', name: 'Big Shoota', kind: 'ranged', range: 36, attacks: 3, skill: 5, strength: 5, ap: 0, damage: 1, keywords: [] },
    { id: 'kan_klaw', name: 'Kan Klaw', kind: 'melee', range: 0, attacks: 3, skill: 4, strength: 8, ap: 2, damage: 2, keywords: [] },
  ],
  abilities: [{ name: 'Deadly Demise 1', text: 'When destroyed, on a 6 it explodes for 1 mortal wound nearby.' }],
  composition: [{ modelName: 'Killa Kan', min: 1, max: 3, defaultWeaponIds: ['kk_big_shoota', 'kan_klaw'] }],
  baseSizeMm: 60,
  isCharacter: false,
  points: 85,
  proxy: { silhouette: 'monster', primary: '#5a6d28', secondary: '#7a4a1e', metalness: 0.6, heightInches: 3.0 },
};

export const orkDeffkoptas: Datasheet = {
  id: 'ork_deffkoptas',
  name: 'Deffkoptas',
  faction: 'orks',
  keywords: ['VEHICLE', 'FLY', 'DEFFKOPTAS', 'ORKS'],
  statline: { move: 12, toughness: 5, save: 4, wounds: 4, leadership: 7, objectiveControl: 1 },
  weapons: [
    { id: 'twin_big_shoota', name: 'Twin Big Shoota', kind: 'ranged', range: 36, attacks: 6, skill: 5, strength: 5, ap: 0, damage: 1, keywords: [{ t: 'twinLinked' }] },
    { id: 'spinnin_blades', name: "Spinnin' Blades", kind: 'melee', range: 0, attacks: 3, skill: 4, strength: 5, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [{ name: 'Scouts 9"', text: 'Fast outriders that begin the game with a pre-battle move.', effect: { t: 'scouts', inches: 9 } }],
  composition: [{ modelName: 'Deffkopta', min: 1, max: 3, defaultWeaponIds: ['twin_big_shoota', 'spinnin_blades'] }],
  baseSizeMm: 60,
  isCharacter: false,
  points: 110,
  proxy: { silhouette: 'monster', primary: '#6a4a1e', secondary: '#3a7d28', metalness: 0.6, heightInches: 2.4 },
};

/* ------------------------------- Necrons -------------------------------- */

export const necronDeathmarks: Datasheet = {
  id: 'necron_deathmarks',
  name: 'Deathmarks',
  faction: 'necrons',
  keywords: ['INFANTRY', 'DEEP STRIKE', 'DEATHMARKS', 'NECRONS'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 8, objectiveControl: 1 },
  weapons: [
    { id: 'synaptic_disintegrator', name: 'Synaptic Disintegrator', kind: 'ranged', range: 36, attacks: 1, skill: 3, strength: 5, ap: 1, damage: 2, keywords: [{ t: 'precision' }, { t: 'heavy' }] },
    { id: 'deathmark_ccw', name: 'Close Combat Weapon', kind: 'melee', range: 0, attacks: 1, skill: 4, strength: 4, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [
    { name: 'Deep Strike', text: 'Sets up in reserve and teleports in more than 9" from the enemy.', effect: { t: 'deepStrike' } },
    { name: 'Reanimation Protocols', text: 'Restores D3 wounds each Command phase, raising slain models.', effect: { t: 'reanimation', wounds: 3 } },
  ],
  composition: [{ modelName: 'Deathmark', min: 5, max: 10, defaultWeaponIds: ['synaptic_disintegrator', 'deathmark_ccw'] }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 90,
  proxy: { silhouette: 'infantry', primary: '#b8c0c8', secondary: '#39a0ff', metalness: 0.9, glow: '#39a0ff', heightInches: 1.6 },
};

export const necronFlayedOnes: Datasheet = {
  id: 'necron_flayedones',
  name: 'Flayed Ones',
  faction: 'necrons',
  keywords: ['INFANTRY', 'DEEP STRIKE', 'FLAYED ONES', 'NECRONS'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 8, objectiveControl: 1 },
  weapons: [
    { id: 'flayer_claws', name: 'Flayer Claws', kind: 'melee', range: 0, attacks: 4, skill: 3, strength: 4, ap: 1, damage: 1, keywords: [] },
  ],
  abilities: [
    { name: 'Deep Strike', text: 'Lurks in reserve and claws its way in more than 9" from the enemy.', effect: { t: 'deepStrike' } },
    { name: 'Reanimation Protocols', text: 'Restores D3 wounds each Command phase.', effect: { t: 'reanimation', wounds: 3 } },
  ],
  composition: [{ modelName: 'Flayed One', min: 5, max: 20, defaultWeaponIds: ['flayer_claws'] }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 65,
  proxy: { silhouette: 'infantry', primary: '#b8c0c8', secondary: '#8a1a12', metalness: 0.85, heightInches: 1.5 },
};

/* ----------------------------- Ultramarines ----------------------------- */

export const ultramarinesAggressors: Datasheet = {
  id: 'ultra_aggressors',
  name: 'Aggressor Squad',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'AGGRESSOR SQUAD', 'ADEPTUS ASTARTES', 'IMPERIUM', 'ULTRAMARINES'],
  statline: { move: 5, toughness: 6, save: 3, wounds: 3, leadership: 6, objectiveControl: 1 },
  weapons: [
    { id: 'boltstorm_gauntlets', name: 'Boltstorm Gauntlets', kind: 'ranged', range: 18, attacks: 6, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [{ t: 'rapidFire', x: 3 }] },
    { id: 'power_fists_agg', name: 'Power Fists', kind: 'melee', range: 0, attacks: 3, skill: 3, strength: 8, ap: 2, damage: 2, keywords: [] },
  ],
  abilities: [{ name: 'Fire Storm', text: 'Bulky Gravis brutes that lay down a withering hail of bolts.' }],
  composition: [{ modelName: 'Aggressor', min: 3, max: 6, defaultWeaponIds: ['boltstorm_gauntlets', 'power_fists_agg'] }],
  baseSizeMm: 40,
  isCharacter: false,
  points: 120,
  proxy: { silhouette: 'infantry', primary: '#2a4a8a', secondary: '#c8a24a', metalness: 0.5, heightInches: 1.9 },
};

export const ultramarinesInceptors: Datasheet = {
  id: 'ultra_inceptors',
  name: 'Inceptor Squad',
  faction: 'ultramarines',
  keywords: ['INFANTRY', 'FLY', 'DEEP STRIKE', 'INCEPTOR SQUAD', 'ADEPTUS ASTARTES', 'IMPERIUM', 'ULTRAMARINES'],
  statline: { move: 10, toughness: 6, save: 3, wounds: 3, leadership: 6, objectiveControl: 1 },
  weapons: [
    { id: 'assault_bolters', name: 'Assault Bolters', kind: 'ranged', range: 18, attacks: 3, skill: 3, strength: 5, ap: 1, damage: 1, keywords: [] },
    { id: 'inceptor_ccw', name: 'Close Combat Weapon', kind: 'melee', range: 0, attacks: 3, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [{ name: 'Meteoric Descent', text: 'Deep-strikes from the sky, guns blazing.', effect: { t: 'deepStrike' } }],
  composition: [{ modelName: 'Inceptor', min: 3, max: 6, defaultWeaponIds: ['assault_bolters', 'inceptor_ccw'] }],
  baseSizeMm: 40,
  isCharacter: false,
  points: 115,
  proxy: { silhouette: 'infantry', primary: '#2a4a8a', secondary: '#9aa0a8', metalness: 0.5, heightInches: 2.0 },
};

/* -------------------------------- Chaos --------------------------------- */

export const chaosPossessed: Datasheet = {
  id: 'chaos_possessed',
  name: 'Possessed',
  faction: 'chaos',
  keywords: ['INFANTRY', 'DAEMON', 'POSSESSED', 'CHAOS', 'HERETIC ASTARTES'],
  statline: { move: 6, toughness: 5, save: 3, wounds: 2, leadership: 6, objectiveControl: 1 },
  weapons: [
    { id: 'hideous_mutations', name: 'Hideous Mutations', kind: 'melee', range: 0, attacks: 4, skill: 3, strength: 6, ap: 2, damage: 2, keywords: [] },
  ],
  abilities: [
    { name: 'Writhing Horrors', text: 'Warp-swollen killers that tear through armour in melee.' },
    { name: 'Dark Pacts', text: 'May swear a pact for Lethal Hits at the risk of mortal wounds.' },
  ],
  composition: [{ modelName: 'Possessed', min: 5, max: 10, defaultWeaponIds: ['hideous_mutations'] }],
  baseSizeMm: 40,
  isCharacter: false,
  points: 110,
  proxy: { silhouette: 'infantry', primary: '#5a2a6a', secondary: '#8a1a12', metalness: 0.3, glow: '#9a3cff', heightInches: 1.8 },
};

export const chaosSpawn: Datasheet = {
  id: 'chaos_spawn',
  name: 'Chaos Spawn',
  faction: 'chaos',
  keywords: ['BEASTS', 'DAEMON', 'CHAOS SPAWN', 'CHAOS', 'HERETIC ASTARTES'],
  statline: { move: 8, toughness: 5, save: 4, wounds: 4, leadership: 8, objectiveControl: 1 },
  weapons: [
    { id: 'mutated_appendages', name: 'Mutated Appendages', kind: 'melee', range: 0, attacks: 4, skill: 4, strength: 5, ap: 1, damage: 1, keywords: [] },
  ],
  abilities: [{ name: 'Fearsome', text: 'A shambling mass of mutated flesh and lashing limbs.' }],
  composition: [{ modelName: 'Chaos Spawn', min: 2, max: 4, defaultWeaponIds: ['mutated_appendages'] }],
  baseSizeMm: 50,
  isCharacter: false,
  points: 65,
  proxy: { silhouette: 'monster', primary: '#6a2a5a', secondary: '#8a5a3a', metalness: 0.2, heightInches: 2.2 },
};
