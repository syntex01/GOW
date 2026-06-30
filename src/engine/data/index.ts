import type { Datasheet } from '../types';
import type { ArmyList } from '../factory';
import {
  necronWarriors,
  necronOverlord,
  necronImmortals,
  necronLychguard,
  necronScarabs,
  necronSkorpekhDestroyers,
  necronWraiths,
  necronDoomsdayArk,
  necronRoyalWarden,
} from './necrons';
import {
  intercessorSquad,
  ultramarinesCaptain,
  assaultIntercessors,
  terminatorSquad,
  hellblasterSquad,
  redemptorDreadnought,
  bladeguardVeterans,
  ultramarinesLieutenant,
  eradicatorSquad,
} from './ultramarines';
import { orkBoyz, orkNobz, orkWarboss, orkTrukk } from './orks';
import {
  chaosLegionaries,
  chaosChosen,
  chaosLord,
  chaosCultists,
  chaosRaptors,
  chaosHelbrute,
  chaosMasterOfPossession,
} from './chaos';

/** Every authored datasheet, keyed by its stable id. */
export const DATASHEETS: Record<string, Datasheet> = {
  [necronWarriors.id]: necronWarriors,
  [necronOverlord.id]: necronOverlord,
  [necronImmortals.id]: necronImmortals,
  [necronLychguard.id]: necronLychguard,
  [necronScarabs.id]: necronScarabs,
  [necronSkorpekhDestroyers.id]: necronSkorpekhDestroyers,
  [necronWraiths.id]: necronWraiths,
  [necronDoomsdayArk.id]: necronDoomsdayArk,
  [necronRoyalWarden.id]: necronRoyalWarden,
  [intercessorSquad.id]: intercessorSquad,
  [ultramarinesCaptain.id]: ultramarinesCaptain,
  [assaultIntercessors.id]: assaultIntercessors,
  [terminatorSquad.id]: terminatorSquad,
  [hellblasterSquad.id]: hellblasterSquad,
  [redemptorDreadnought.id]: redemptorDreadnought,
  [bladeguardVeterans.id]: bladeguardVeterans,
  [ultramarinesLieutenant.id]: ultramarinesLieutenant,
  [eradicatorSquad.id]: eradicatorSquad,
  [orkBoyz.id]: orkBoyz,
  [orkNobz.id]: orkNobz,
  [orkWarboss.id]: orkWarboss,
  [orkTrukk.id]: orkTrukk,
  [chaosLegionaries.id]: chaosLegionaries,
  [chaosChosen.id]: chaosChosen,
  [chaosLord.id]: chaosLord,
  [chaosCultists.id]: chaosCultists,
  [chaosRaptors.id]: chaosRaptors,
  [chaosHelbrute.id]: chaosHelbrute,
  [chaosMasterOfPossession.id]: chaosMasterOfPossession,
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
      necronSkorpekhDestroyers.id,
      necronWraiths.id,
      necronDoomsdayArk.id,
      necronRoyalWarden.id,
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
      redemptorDreadnought.id,
      bladeguardVeterans.id,
      ultramarinesLieutenant.id,
      eradicatorSquad.id,
    ],
  },
  orks: {
    name: 'Orks',
    datasheetIds: [orkBoyz.id, orkNobz.id, orkWarboss.id, orkTrukk.id],
  },
  chaos: {
    name: 'Chaos Space Marines',
    datasheetIds: [
      chaosLegionaries.id,
      chaosChosen.id,
      chaosLord.id,
      chaosCultists.id,
      chaosRaptors.id,
      chaosHelbrute.id,
      chaosMasterOfPossession.id,
    ],
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
  // Skorpekh Destroyers
  'skorpekh destroyers': necronSkorpekhDestroyers.id,
  'skorpekh destroyer': necronSkorpekhDestroyers.id,
  skorpekh: necronSkorpekhDestroyers.id,
  destroyers: necronSkorpekhDestroyers.id,
  // Canoptek Wraiths
  'canoptek wraiths': necronWraiths.id,
  'canoptek wraith': necronWraiths.id,
  wraiths: necronWraiths.id,
  wraith: necronWraiths.id,
  // Doomsday Ark
  'doomsday ark': necronDoomsdayArk.id,
  doomsday: necronDoomsdayArk.id,
  // Royal Warden
  'royal warden': necronRoyalWarden.id,
  warden: necronRoyalWarden.id,
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
  // Redemptor Dreadnought
  'redemptor dreadnought': redemptorDreadnought.id,
  redemptor: redemptorDreadnought.id,
  dreadnought: redemptorDreadnought.id,
  // Bladeguard Veterans
  'bladeguard veterans': bladeguardVeterans.id,
  'bladeguard veteran squad': bladeguardVeterans.id,
  bladeguard: bladeguardVeterans.id,
  // Lieutenant
  lieutenant: ultramarinesLieutenant.id,
  'space marine lieutenant': ultramarinesLieutenant.id,
  'ultramarines lieutenant': ultramarinesLieutenant.id,
  // Eradicators
  eradicators: eradicatorSquad.id,
  eradicator: eradicatorSquad.id,
  'eradicator squad': eradicatorSquad.id,
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
  // Legionaries (Chaos Space Marines)
  legionaries: chaosLegionaries.id,
  legionary: chaosLegionaries.id,
  csm: chaosLegionaries.id,
  'chaos space marines': chaosLegionaries.id,
  'chaos space marine squad': chaosLegionaries.id,
  // Chosen
  chosen: chaosChosen.id,
  'chaos chosen': chaosChosen.id,
  // Chaos Lord
  'chaos lord': chaosLord.id,
  lord: chaosLord.id,
  // Accursed Cultists
  cultists: chaosCultists.id,
  cultist: chaosCultists.id,
  'accursed cultists': chaosCultists.id,
  'cultist mob': chaosCultists.id,
  // Raptors
  raptors: chaosRaptors.id,
  raptor: chaosRaptors.id,
  'chaos raptors': chaosRaptors.id,
  // Helbrute
  helbrute: chaosHelbrute.id,
  hellbrute: chaosHelbrute.id,
  // Master of Possession
  'master of possession': chaosMasterOfPossession.id,
  possession: chaosMasterOfPossession.id,
  warpsmith: chaosMasterOfPossession.id,
};

/** Small, legal sample lists using the datasheets above. */
export const SAMPLE_ARMIES: {
  necrons: ArmyList;
  ultramarines: ArmyList;
  orks: ArmyList;
  chaos: ArmyList;
} = {
  necrons: {
    name: 'Necron Patrol',
    faction: 'necrons',
    entries: [
      { datasheetId: necronWarriors.id, modelCount: 10, instanceId: 'nec_warriors_1' },
      // Overlord attaches to the Warriors unit as their Leader.
      { datasheetId: necronOverlord.id, attachTo: 'nec_warriors_1' },
      { datasheetId: necronImmortals.id, modelCount: 5, instanceId: 'nec_immortals_1' },
      // Royal Warden leads the Immortals.
      { datasheetId: necronRoyalWarden.id, attachTo: 'nec_immortals_1' },
      { datasheetId: necronLychguard.id, modelCount: 5 },
      { datasheetId: necronScarabs.id, modelCount: 3 },
      { datasheetId: necronSkorpekhDestroyers.id, modelCount: 3 },
      { datasheetId: necronWraiths.id, modelCount: 3 },
      { datasheetId: necronDoomsdayArk.id, modelCount: 1 },
    ],
  },
  ultramarines: {
    name: 'Ultramarines Strike Force',
    faction: 'ultramarines',
    entries: [
      { datasheetId: intercessorSquad.id, modelCount: 5, instanceId: 'um_intercessors_1' },
      // Captain attaches to the Intercessors as their Leader.
      { datasheetId: ultramarinesCaptain.id, attachTo: 'um_intercessors_1' },
      { datasheetId: bladeguardVeterans.id, modelCount: 3, instanceId: 'um_bladeguard_1' },
      // Lieutenant leads the Bladeguard Veterans.
      { datasheetId: ultramarinesLieutenant.id, attachTo: 'um_bladeguard_1' },
      { datasheetId: assaultIntercessors.id, modelCount: 5 },
      { datasheetId: hellblasterSquad.id, modelCount: 5 },
      { datasheetId: eradicatorSquad.id, modelCount: 3 },
      { datasheetId: redemptorDreadnought.id, modelCount: 1 },
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
  chaos: {
    name: 'Chaos Warband',
    faction: 'chaos',
    entries: [
      { datasheetId: chaosLegionaries.id, modelCount: 5, instanceId: 'chaos_legionaries_1' },
      // Chaos Lord leads the Legionaries.
      { datasheetId: chaosLord.id, attachTo: 'chaos_legionaries_1' },
      { datasheetId: chaosChosen.id, modelCount: 5, instanceId: 'chaos_chosen_1' },
      // Master of Possession leads the Chosen.
      { datasheetId: chaosMasterOfPossession.id, attachTo: 'chaos_chosen_1' },
      { datasheetId: chaosCultists.id, modelCount: 8 },
      { datasheetId: chaosHelbrute.id, modelCount: 1 },
      // Raptors arrive by Deep Strike.
      { datasheetId: chaosRaptors.id, modelCount: 5, inReserves: true },
    ],
  },
};
