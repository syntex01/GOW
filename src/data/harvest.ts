import type { UnitDef } from './types'

/**
 * THE BONEWRIGHTS — Bone Harvest, made into a thing you can watch and a thing
 * you can stop.
 *
 * The harvest used to be a number. Every settled piece of a body lying on your
 * half added a fraction of a gold per second to a running total, forever, with
 * nothing on the board to look at and nothing an opponent could do about it
 * short of razing the Bone Kiln.
 *
 * Now it is five small crooked things, one per file, that walk out of your
 * yard, crouch over what is lying there, stuff it in a sack and carry it home.
 * The gold arrives when the sack does. That single change turns the creed's
 * economy into geography:
 *
 *  - remains close to your own wall pay QUICKLY, remains out in the middle pay
 *    slowly, and remains you never reach do not pay at all;
 *  - a gatherer is flesh on the board, so a raider that pushes into your half
 *    can cut your income down instead of merely standing in it;
 *  - and because they flee rather than fight, killing them is a decision about
 *    tempo — you have to go and do it, and the trip costs you the same push
 *    you would otherwise be making at the gate.
 *
 * They are deliberately pathetic. Two swings of a clubman or two stones from a
 * sling and one is a stain, and the next one is twenty-odd seconds away.
 */
export const GATHERER_DEF: UnitDef = {
  id: 'nk_bonewright',
  name: 'Bonewright',
  age: 0,
  role: 'melee',
  layer: 'ground',
  // Never bought, never queued, never on a bar. The harvest raises them.
  cost: 0,
  buildMs: 0,
  // Two hits from the weakest thing in the game. A clubman swings for 36 and a
  // slinger's stone lands for 56 — both take two, neither takes one.
  hp: 70,
  armor: 'unarmored',
  damage: 0,
  damageType: 'blunt',
  attackMs: 1000,
  range: 0,
  // Quick on its feet, because the whole mechanic is a round trip and a slow
  // one would make the harvest worse than the flat trickle it replaced.
  speed: 104,
  mass: 0.5,
  // Worth killing for the denial, not for the purse.
  bounty: 8,
  xp: 6,
  pop: 0,
  height: 38,
  hidden: true,
  noncombat: true,
  attack: { kind: 'melee', knockback: 0 },
  description: 'A small crooked thing with a sack. It does not fight; it collects.',
  visual: {
    kind: 'humanoid',
    skin: 0x8fa286,
    cloth: 0x39312a,
    cloth2: 0x231d18,
    metal: 0x6f6a5c,
    accent: 0x7fd6a0,
    helmet: 'none',
    torso: 'bare',
    weapon: 'none',
    bulk: 0.78
  }
}

/** How close a gatherer must be to a piece before it can crouch over it. */
export const GATHERER_REACH = 30

/** How long it spends bent over one piece before the sack takes it. */
export const GATHERER_SEARCH_MS = 1200

/** Pieces one sack holds. Full sack, or nothing else nearby, and it goes home. */
export const GATHERER_BAG = 3

/**
 * How far it will wander from the piece it just took to look for the next one.
 * Short: a gatherer fills its sack from ONE heap and then leaves, so a body
 * lying alone out in the middle is a whole trip for a third of a sack.
 */
export const GATHERER_SWEEP = 220

/** Gold per piece delivered, before the Bone Kiln and before the age scale. */
export const GATHERER_PER_PIECE = 12

/** How far out from its own wall a gatherer will go. Past this it turns back. */
export const GATHERER_RANGE = 1400

/** Hit once and it drops nothing, turns round and runs for this long. */
export const GATHERER_FLEE_MS = 3800

/** A dead gatherer is replaced this long afterwards, and not sooner. */
export const GATHERER_RESPAWN_MS = 22_000

/** Close enough to the wall to count as home and hand the sack over. */
export const GATHERER_HOME_PAD = 46
