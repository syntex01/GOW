import type { Datasheet } from '../types';
import type { ArmyList } from '../factory';
import {
  necronWarriors,
  necronOverlord,
  necronImmortals,
  necronLychguard,
  necronScarabs,
} from './necrons';
import {
  intercessorSquad,
  ultramarinesCaptain,
  assaultIntercessors,
  terminatorSquad,
  hellblasterSquad,
} from './ultramarines';
import { orkBoyz, orkNobz, orkWarboss, orkTrukk } from './orks';

/** Every authored datasheet, keyed by its stable id. */
export const DATASHEETS: Record<string, Datasheet> = {
  [necronWarriors.id]: necronWarriors,
  [necronOverlord.id]: necronOverlord,
  [necronImmortals.id]: necronImmortals,
  [necronLychguard.id]: necronLychguard,
  [necronScarabs.id]: necronScarabs,
  [intercessorSquad.id]: intercessorSquad,
  [ultramarinesCaptain.id]: ultramarinesCaptain,
  [assaultIntercessors.id]: assaultIntercessors,
  [terminatorSquad.id]: terminatorSquad,
  [hellblasterSquad.id]: hellblasterSquad,
  [orkBoyz.id]: orkBoyz,
  [orkNobz.id]: orkNobz,
  [orkWarboss.id]: orkWarboss,
  [orkTrukk.id]: orkTrukk,
};

/** Faction groupings, listing the datasheet ids available to each. */
export const FACTIONS: Record<string, { name: string; datasheetIds: string[] }> = {
  necrons: {
    name: 'Necrons',
    datasheetIds: [
      necronWarriors.id,
      necronOverlord.id,
      necronImmortals.id,
      necronLychguard.id,
      necronScarabs.id,
    ],
  },
  ultramarines: {
    name: 'Ultramarines',
    datasheetIds: [
      intercessorSquad.id,
      ultramarinesCaptain.id,
      assaultIntercessors.id,
      terminatorSquad.id,
      hellblasterSquad.id,
    ],
  },
  orks: {
    name: 'Orks',
    datasheetIds: [orkBoyz.id, orkNobz.id, orkWarboss.id, orkTrukk.id],
  },
};

/**
 * Lowercased display names plus common aliases -> datasheet id.
 * Generous on purpose so a roster importer can match list entries loosely.
 */
export const NAME_TO_DATASHEET_ID: Record<string, string> = {
  // Necron Warriors
  'necron warriors': necronWarriors.id,
  'necron warrior': necronWarriors.id,
  warriors: necronWarriors.id,
  // Necron Overlord
  'necron overlord': necronOverlord.id,
  overlord: necronOverlord.id,
  'overlord with staff of light': necronOverlord.id,
  'overlord with tachyon arrow': necronOverlord.id,
  // Immortals
  immortals: necronImmortals.id,
  immortal: necronImmortals.id,
  'necron immortals': necronImmortals.id,
  // Lychguard
  lychguard: necronLychguard.id,
  'necron lychguard': necronLychguard.id,
  // Scarabs
  scarabs: necronScarabs.id,
  'canoptek scarabs': necronScarabs.id,
  'canoptek scarab swarms': necronScarabs.id,
  'scarab swarms': necronScarabs.id,
  // Intercessor Squad
  'intercessor squad': intercessorSquad.id,
  intercessors: intercessorSquad.id,
  intercessor: intercessorSquad.id,
  // Captain
  captain: ultramarinesCaptain.id,
  'space marine captain': ultramarinesCaptain.id,
  'ultramarines captain': ultramarinesCaptain.id,
  // Assault Intercessors
  'assault intercessors': assaultIntercessors.id,
  'assault intercessor squad': assaultIntercessors.id,
  'assault intercessor': assaultIntercessors.id,
  // Terminators
  terminators: terminatorSquad.id,
  terminator: terminatorSquad.id,
  'terminator squad': terminatorSquad.id,
  'tactical terminators': terminatorSquad.id,
  // Hellblasters
  hellblasters: hellblasterSquad.id,
  hellblaster: hellblasterSquad.id,
  'hellblaster squad': hellblasterSquad.id,
  // Ork Boyz
  boyz: orkBoyz.id,
  boy: orkBoyz.id,
  'ork boyz': orkBoyz.id,
  'ork boy': orkBoyz.id,
  // Nobz
  nobz: orkNobz.id,
  nob: orkNobz.id,
  'ork nobz': orkNobz.id,
  // Warboss
  warboss: orkWarboss.id,
  'ork warboss': orkWarboss.id,
  // Trukk
  trukk: orkTrukk.id,
  'ork trukk': orkTrukk.id,
  truck: orkTrukk.id,
};

/** Small, legal sample lists (~4 units each) using the datasheets above. */
export const SAMPLE_ARMIES: { necrons: ArmyList; ultramarines: ArmyList; orks: ArmyList } = {
  necrons: {
    name: 'Necron Patrol',
    faction: 'necrons',
    entries: [
      { datasheetId: necronWarriors.id, modelCount: 10, instanceId: 'nec_warriors_1' },
      // Overlord attaches to the Warriors unit as their Leader.
      { datasheetId: necronOverlord.id, attachTo: 'nec_warriors_1' },
      { datasheetId: necronImmortals.id, modelCount: 5 },
      { datasheetId: necronLychguard.id, modelCount: 5 },
      { datasheetId: necronScarabs.id, modelCount: 3 },
    ],
  },
  ultramarines: {
    name: 'Ultramarines Strike Force',
    faction: 'ultramarines',
    entries: [
      { datasheetId: intercessorSquad.id, modelCount: 5, instanceId: 'um_intercessors_1' },
      // Captain attaches to the Intercessors as their Leader.
      { datasheetId: ultramarinesCaptain.id, attachTo: 'um_intercessors_1' },
      { datasheetId: assaultIntercessors.id, modelCount: 5 },
      { datasheetId: hellblasterSquad.id, modelCount: 5 },
      // Terminators arrive by Deep Strike.
      { datasheetId: terminatorSquad.id, modelCount: 5, inReserves: true },
    ],
  },
  orks: {
    name: 'Ork Warband',
    faction: 'orks',
    entries: [
      { datasheetId: orkBoyz.id, modelCount: 10, instanceId: 'ork_boyz_1' },
      // Warboss leads the Boyz mob.
      { datasheetId: orkWarboss.id, attachTo: 'ork_boyz_1' },
      { datasheetId: orkNobz.id, modelCount: 5 },
      { datasheetId: orkTrukk.id, modelCount: 1 },
    ],
  },
};
