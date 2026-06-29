import type { Datasheet } from '../types';
import type { ArmyList } from '../factory';
import { necronWarriors, necronOverlord } from './necrons';
import { intercessorSquad, ultramarinesCaptain } from './ultramarines';

/** Every authored datasheet, keyed by its stable id. */
export const DATASHEETS: Record<string, Datasheet> = {
  [necronWarriors.id]: necronWarriors,
  [necronOverlord.id]: necronOverlord,
  [intercessorSquad.id]: intercessorSquad,
  [ultramarinesCaptain.id]: ultramarinesCaptain,
};

/** Faction groupings, listing the datasheet ids available to each. */
export const FACTIONS: Record<string, { name: string; datasheetIds: string[] }> = {
  necrons: {
    name: 'Necrons',
    datasheetIds: [necronWarriors.id, necronOverlord.id],
  },
  ultramarines: {
    name: 'Ultramarines',
    datasheetIds: [intercessorSquad.id, ultramarinesCaptain.id],
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
  // Intercessor Squad
  'intercessor squad': intercessorSquad.id,
  intercessors: intercessorSquad.id,
  intercessor: intercessorSquad.id,
  // Captain
  captain: ultramarinesCaptain.id,
  'space marine captain': ultramarinesCaptain.id,
  'ultramarines captain': ultramarinesCaptain.id,
};

/** Small, legal sample lists (~2 units each) using the datasheets above. */
export const SAMPLE_ARMIES: { necrons: ArmyList; ultramarines: ArmyList } = {
  necrons: {
    name: 'Necron Patrol',
    faction: 'necrons',
    entries: [
      { datasheetId: necronWarriors.id, modelCount: 10, instanceId: 'nec_warriors_1' },
      // Overlord attaches to the Warriors unit as their Leader.
      { datasheetId: necronOverlord.id, attachTo: 'nec_warriors_1' },
    ],
  },
  ultramarines: {
    name: 'Ultramarines Strike Force',
    faction: 'ultramarines',
    entries: [
      { datasheetId: intercessorSquad.id, modelCount: 5, instanceId: 'um_intercessors_1' },
      // Captain attaches to the Intercessors as their Leader.
      { datasheetId: ultramarinesCaptain.id, attachTo: 'um_intercessors_1' },
    ],
  },
};
