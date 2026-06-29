/**
 * Example roster strings used to demo the importer in the UI.
 *
 * The unit names here map (via NAME_TO_DATASHEET_ID in the data module) to the
 * datasheet ids the data agent uses:
 *   necron_warriors, necron_overlord, ultramarines_intercessors, ultramarines_captain
 */

/** Necrons, GW-app style export. */
export const SAMPLE_NECRONS = `+++ Awakened Host (1000 Points) +++
Faction: Necrons
Detachment: Awakened Dynasty

CHARACTERS
Overlord (85 Points)
  • Tachyon Arrow
  • Overlord's Blade

BATTLELINE
Necron Warriors (200 Points)
  • 20x Necron Warrior
  • 20x Gauss Flayer
`;

/** Ultramarines, BattleScribe style export. */
export const SAMPLE_ULTRAMARINES = `++ Strike Force (2000 Points) ++
Faction: Ultramarines

+ Configuration +

+ HQ +
Captain [80 pts]: Master-crafted bolt rifle

+ Troops +
Intercessor Squad [100 pts]
. 4x Intercessor: Bolt rifle, Bolt pistol
. Intercessor Sergeant: Bolt rifle
`;

export const SAMPLE_ROSTERS = {
  necrons: SAMPLE_NECRONS,
  ultramarines: SAMPLE_ULTRAMARINES,
};
