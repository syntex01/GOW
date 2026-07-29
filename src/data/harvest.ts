import type { ArmorType, DamageType } from '../sim/types'
import type { UnitDef } from './types'

/**
 * THE THREE SPOILS.
 *
 * A body is not one resource. It is meat, it is a skull, and it is a frame,
 * and Carnage learns to take them one at a time — meat in the second age,
 * skulls in the third, bone in the fourth. Each one answers a different
 * bottleneck, so the creed's economy stops being "more gold" and becomes a
 * question about which bottleneck you are currently losing to.
 *
 *   MEAT  → gold      (Bone Harvest)
 *   SKULL → research  (The Skull Tithe)
 *   BONE  → soldiers  (The Bone Levy)
 *
 * And crucially, WHAT a body leaves is decided by HOW IT DIED. See `spoilsOf`.
 */
export type Spoil = 'meat' | 'skull' | 'bone'

export const SPOILS: readonly Spoil[] = ['meat', 'skull', 'bone']

/** Which node opens each spoil, in the order a carnage commander takes them. */
export const SPOIL_TECH: Record<Spoil, string> = {
  meat: 'bone_harvest',
  skull: 'skull_tithe',
  bone: 'bone_levy'
}

/** The particle mask each one is drawn with, and the tint it wears. */
export const SPOIL_TEXTURE: Record<Spoil, string> = {
  meat: 'fx:meat',
  skull: 'fx:skull',
  bone: 'fx:bone'
}

export const SPOIL_COLOR: Record<Spoil, number> = {
  // Lighter and pinker than blood (0x8e1418) and than the stains it lies on,
  // or a cut of meat is just another splash on a field covered in them.
  meat: 0xc4544a,
  skull: 0xe6dfc4,
  bone: 0xd8cfae
}

/**
 * How long a spoil off a CHEAP body keeps, before anything is done about it.
 *
 * The load-bearing number of the whole system: existing is not the same as
 * harvested. Deliberately short in the early game — a stone-age field goes
 * cold in about a quarter of a minute, so the opening is a scramble and the
 * answer to it is to fight close to your own wall rather than to out-produce
 * anybody. Preservation research is what turns the late game into a bank.
 *
 * Meat goes off fastest: it is the most plentiful and the least worth chasing
 * across the field. Bone keeps longest, which is why the Ossuary is a bank and
 * the Bone Levy is a slow, patient thing.
 */
export const SPOIL_TTL: Record<Spoil, number> = {
  meat: 12_000,
  skull: 18_000,
  bone: 26_000
}

/**
 * The price a spoil's worth is measured against: one age-one line soldier,
 * which after the curve re-lay is around 250 gold. A body at this price yields
 * spoils worth exactly one unit each, so the cheapest chaff comes in a little
 * under one and everything above it scales from there.
 */
export const SPOIL_REFERENCE_COST = 250

/**
 * WHAT A BODY IS WORTH, by what it cost to field.
 *
 * A Gravetide is not the same harvest as a clubman and the system should not
 * pretend otherwise — but nor is it ten times the harvest, which is what a
 * straight ratio would say. The square root keeps a swarm's many cheap deaths
 * the creed's bread and butter while making a dead elite genuinely worth
 * walking out for: measured against the 250g anchor, a 200g Clubman is 0.89,
 * a 600g Raptor Rider is 1.55 and a 2400g Gravetide is 3.10.
 *
 * The same number drives DECAY, so an expensive carcass is both worth more and
 * lies around longer — you get time to go and collect the thing that is worth
 * collecting, and none at all for the chaff out in the middle.
 */
export function spoilWorth(cost: number): number {
  const raw = Math.sqrt(Math.max(1, cost) / SPOIL_REFERENCE_COST)
  return Math.max(0.5, Math.min(5, Math.round(raw * 100) / 100))
}

/** How long one spoil off this body keeps, with preservation folded in. */
export function spoilLife(kind: Spoil, cost: number, keep = 1): number {
  return Math.round(SPOIL_TTL[kind] * (0.6 + 0.8 * spoilWorth(cost)) * keep)
}

/**
 * Preservation research. Nothing here changes what a body leaves — only how
 * long you have to go and get it, which is the one lever that turns a frantic
 * early harvest into a late-game larder.
 */
export const PRESERVE_TECHS: readonly { tech: string; keep: number; name: string }[] = [
  { tech: 'salting', keep: 1.7, name: 'Salting' },
  { tech: 'deep_cold', keep: 1.6, name: 'The Deep Cold' }
]

export function preservation(techs: ReadonlySet<string> | undefined): number {
  if (!techs) return 1
  let keep = 1
  for (const p of PRESERVE_TECHS) if (techs.has(p.tech)) keep *= p.keep
  return keep
}

/** A sack of each, ready to be paid out. */
export type Sack = Record<Spoil, number>

export const emptySack = (): Sack => ({ meat: 0, skull: 0, bone: 0 })

/**
 * WHAT A DEATH LEAVES BEHIND.
 *
 * The point of the whole system: a carnage commander chooses their income by
 * choosing their weapons, and the choice is one they were already making for
 * other reasons, so it pulls against the counter web instead of sitting beside
 * it.
 *
 *   PIERCE     a clean kill. The body is intact: a skull and a frame, and
 *              almost nothing wet. Spears and bolts research.
 *   SLASH      opens it up. All meat, and the head usually comes with it.
 *              Axes and blades pay.
 *   BLUNT      caves the skull in and shatters the frame. Meat, some bone
 *              worth having, and no skull at all. Clubs pay, and only pay.
 *   EXPLOSIVE  destroys most of what it kills and throws the rest. Least of
 *              everything, and never a skull.
 *   ENERGY     cooks the meat off the frame. Bone and a clean skull.
 *
 * The victim's armour speaks too: a heavy is mostly frame, an unarmoured body
 * is mostly meat. What the body COST does not appear here at all — price sets
 * the worth of each piece, never how many there are.
 */
const BY_DAMAGE: Record<DamageType, Sack> = {
  pierce: { meat: 1, skull: 1, bone: 2 },
  slash: { meat: 3, skull: 1, bone: 0 },
  blunt: { meat: 2, skull: 0, bone: 1 },
  explosive: { meat: 1, skull: 0, bone: 1 },
  energy: { meat: 0, skull: 1, bone: 2 }
}

const BY_ARMOR: Record<ArmorType, Partial<Sack>> = {
  unarmored: { meat: 1 },
  light: {},
  heavy: { bone: 1 },
  structure: {},
  air: {}
}

/**
 * The spoils one body leaves, before the ground gets any of it.
 *
 * HOW MANY PIECES is a question about the weapon and the armour, and nothing
 * else — so the drop table is short, flat and learnable by watching. HOW MUCH
 * EACH PIECE IS WORTH is a separate question, answered by `spoilWorth` off the
 * body's price. Keeping the two apart is the whole readability fix: a dead
 * Gravetide leaves the same five or six objects a dead clubman does, so the
 * field never turns into confetti, and each of those objects is simply worth
 * five times more.
 *
 * `overkillFrac` is how far past dead the killing blow carried it, in the
 * body's own max health. Past two whole bars there is not enough left of it to
 * pick up, whatever it was killed with — the same gate Death Throes uses, and
 * for the same reason: some blows do not leave a body.
 */
export function spoilsOf(
  damage: DamageType,
  armor: ArmorType,
  overkillFrac: number,
  mechanical: boolean
): Sack {
  if (mechanical) return emptySack()
  const base = BY_DAMAGE[damage]
  const extra = BY_ARMOR[armor]
  // Obliteration wastes it. Half at a bar of overkill, nothing past two.
  const spoilt = overkillFrac >= 2 ? 0 : Math.max(0, 1 - overkillFrac * 0.5)
  const take = (kind: Spoil): number => Math.round((base[kind] + (extra[kind] ?? 0)) * spoilt)
  return { meat: take('meat'), skull: take('skull'), bone: take('bone') }
}

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

/**
 * THE BONE LEVY'S CHAFF.
 *
 * Assembled in the yard out of delivered frames, at no cost and on nobody's
 * queue. A Boneling is worse than anything you could buy — it is slow, it hits
 * softly, and a stiff breeze kills it — but it is free, it is a body in a file,
 * and a swarm creed's whole argument is bodies in files.
 *
 * Its stats ride the same per-age power curve every other soldier rides, so a
 * levy raised in the last age is chaff for that age rather than a stone-age
 * relic wandering into a laser battery.
 */
export const BONELING_DEF: UnitDef = {
  id: 'nk_boneling',
  name: 'Boneling',
  age: 0,
  role: 'melee',
  layer: 'ground',
  cost: 0,
  buildMs: 0,
  hp: 150,
  armor: 'unarmored',
  damage: 26,
  damageType: 'slash',
  attackMs: 950,
  range: 36,
  speed: 58,
  mass: 0.9,
  // Free to raise and worth almost nothing to kill: a Boneling must never be
  // a way of feeding the enemy's economy, in either direction.
  bounty: 6,
  xp: 4,
  pop: 0,
  height: 56,
  hidden: true,
  conduct: 'swarm',
  attack: { kind: 'melee', knockback: 40 },
  description: 'Somebody else, re-issued. It does not know whose side it was on.',
  visual: {
    kind: 'humanoid',
    skin: 0xd8cfae,
    cloth: 0x4a4438,
    cloth2: 0x2e2a22,
    metal: 0x8a8472,
    accent: 0x7fd6a0,
    helmet: 'none',
    torso: 'bare',
    weapon: 'axe',
    bulk: 0.86
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

/** Gold per lump of meat delivered, before the Bone Kiln and the age scale. */
export const GATHERER_PER_PIECE = 12

/**
 * Research points per skull carried home, before the age scale.
 *
 * Priced against the Reliquary: the best one standing makes 12 a second, and
 * five gatherers on a good field bring back somewhere near a skull a second
 * between them. So a full tithe on a busy front is worth roughly a mid
 * Reliquary — real, and not a replacement for building one.
 */
export const SKULL_RESEARCH = 9

/**
 * Frames per skeleton. Four femurs and a commander's indifference.
 *
 * Deliberately steep. The Levy is meant to be a slow drip that turns a long
 * grinding front into free bodies, not a second production line.
 */
export const BONE_PER_SKELETON = 4

/** How far out from its own wall a gatherer will go. Past this it turns back. */
export const GATHERER_RANGE = 1400

/** Hit once and it drops nothing, turns round and runs for this long. */
export const GATHERER_FLEE_MS = 3800

/** A dead gatherer is replaced this long afterwards, and not sooner. */
export const GATHERER_RESPAWN_MS = 22_000

/** Close enough to the wall to count as home and hand the sack over. */
export const GATHERER_HOME_PAD = 46
