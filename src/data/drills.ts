import type { UnitDef, UnitDrill } from './types'
import type { TechId } from './tech'

/**
 * Drills — research that changes ONE soldier rather than the whole army.
 *
 * The morph lines already reshape the roster by doctrine lean, and the stat
 * nodes already push every unit's numbers at once. Neither of those can say
 * "the spearman, specifically, learns to fight from the second rank". That is
 * what this table is for, and it is the layer the first age's counter web is
 * built on.
 *
 * Each drill is a cheap ring-1 node, available from the opening minute, and
 * each one sits at the head of one creed's road — so the first real decision
 * of a match is which of your six soldiers you want to be good at, and that
 * decision is also the first step toward what your army eventually becomes.
 * They are not exclusive with each other or with anything else: taking Mob Rule
 * does not close Ordnance, it only means you walked in through Carnage's door.
 *
 * They are written onto the DEF rather than checked against the army's tech set
 * wherever they are used. That way a Clubman four doctrines into Ordnance, a
 * veteran promoted mid-match and the card on the bottom bar are all looking at
 * the same drilled soldier, with no third place to keep in sync.
 */

/** One node's worth of drilling: which unit it changes, and into what. */
interface Drill {
  tech: TechId
  unit: string
  /** Plain multipliers, applied before the flags. */
  mult?: Partial<Record<'cost' | 'buildMs' | 'range' | 'damage' | 'hp' | 'bounty' | 'xp', number>>
  set?: UnitDrill
  /** Shown on the roster card so the change is legible without the tree open. */
  note: string
}

export const DRILLS: Drill[] = [
  {
    // ── ORDNANCE ──────────────────────────────────────────────────────────
    // A slinger starts out throwing at whatever is in front of him and nothing
    // else — he is authored `noSpill`. This lifts it: with his own file clear,
    // he looses into the one next door at the usual cross-file price.
    //
    // Written as an unlock rather than a widening on purpose. Letting him pick
    // a mark in the next file WHILE his own was occupied was tried, and it is
    // the wrong shape: it hands a gun line the ability to concentrate on one
    // file from three, and the age-one Slinger is already the unit that beats
    // everything. Helping the neighbour once your own front is clear is help;
    // choosing your target from three files is dominance.
    tech: 'loose_stones',
    unit: 'slinger',
    set: { wideShot: true },
    note: 'With his own file clear, he looses into the one next door.'
  },
  {
    // ── CARNAGE ───────────────────────────────────────────────────────────
    // The swarm's whole argument is bodies per coin. Twelve clubmen to a
    // budget become sixteen, which is the one counter the age-one gun line
    // actually has, sharpened.
    tech: 'mob_rule',
    unit: 'clubman',
    // The discount is small and the tempo is where it is actually paid, and
    // that is not timidity — it is a measured cliff.
    //
    // A swarm hits a third harder against anything costing three times its own
    // price per body. A Clubman at 200 against a 560g Bonecrusher is at 2.8x,
    // just under. Take a quarter off and he is at 3.29x, just over, and the
    // mob bonus switches on: measured, Clubman over Bonecrusher went +0.15 ->
    // +0.65 on nothing but a price tag. Twenty gold either side of 187 is the
    // difference between a counter and a rout.
    //
    // So the price stays on the safe side of it and the drill pays out in
    // BUILD TIME instead, which is what a swarm actually wants anyway: bodies
    // sooner rather than a rounding error per body.
    mult: { cost: 0.95, buildMs: 0.78, bounty: 0.95, xp: 0.95 },
    note: 'A little cheaper and much quicker off the pad. Bring more of them.'
  },
  {
    // ── ENGINEERING ───────────────────────────────────────────────────────
    // Reach is the spear's entire idea. Only the front rank of a file can bring
    // a weapon to bear — that is what `press` already assumes — so a spearman
    // behind anyone was a man holding a stick. This is the exception: one man
    // in front, and he fights over him. Two is a crowd.
    tech: 'long_hafts',
    unit: 'spearman',
    mult: { range: 1.84 },
    set: { overhead: true },
    note: 'Fights from the second rank, over the one man standing in front of him.'
  },
  {
    // ── THE OCCULT ────────────────────────────────────────────────────────
    // The Bonecrusher is a screen: its job is to be hit. It was losing to
    // everything because being hit was all it did. A flat absorb is the right
    // shape for a taunt — it blunts the first big blow rather than shaving
    // every small one — and refusing knockback stops a gun line walking it
    // backwards for the whole engagement.
    tech: 'ward_of_bone',
    unit: 'bonecrusher',
    // 400 made the screen beat cavalry +0.56 outright, which overshot: the
    // Bonecrusher needed to stop losing to everything, not to start winning
    // the matchup its own armour class already favours.
    set: { ward: 340 },
    note: 'A bound ward drinks the first 340 of any blow and will not be shoved. It reknits on a kill.'
  },
  {
    // ── CORE ──────────────────────────────────────────────────────────────
    // The knight's move, aimed. A raider already leaves the queue when it is
    // blocked; this teaches it what it is looking for — a shooter with nobody
    // standing over it, one file away, level with its own shoulder.
    tech: 'beast_sense',
    unit: 'raptor_rider',
    set: { pounce: true },
    note: 'Reads an unguarded gun line one file over and takes it.'
  },
  {
    // ── BLIGHT ────────────────────────────────────────────────────────────
    // A heal is a lump sum, which means a Shaman is worth nothing until
    // somebody is already nearly dead. Something small that keeps working
    // changes what he is for: not an undo button, a reason the line does not
    // wear down in the first place.
    tech: 'spore_touch',
    unit: 'shaman',
    set: { mend: { perSecond: 7, ms: 9000 } },
    note: 'What he mends keeps mending: a slow knit that lasts nine seconds.'
  }
]

/** Every drill this set of techs has earned, by the unit it changes. */
const byUnit = new Map<string, Drill[]>()
for (const d of DRILLS) {
  const list = byUnit.get(d.unit) ?? []
  list.push(d)
  byUnit.set(d.unit, list)
}

/** The drill nodes, so callers can ask whether a node is one without importing the table. */
export const DRILL_TECHS: ReadonlySet<TechId> = new Set(DRILLS.map(d => d.tech))

/** What a drill node changes, for the tech tree's AFFECTS line. */
export const DRILL_BY_TECH: ReadonlyMap<TechId, Drill> = new Map(DRILLS.map(d => [d.tech, d]))

const cache = new Map<string, UnitDef>()

/**
 * Applies every earned drill to a unit.
 *
 * Keyed on the BASE id, so it survives the doctrine morphs — a morphed def
 * carries an id like `clubman@carnage2`, and a commander who paid for Mob Rule
 * should not lose it the moment their army leans somewhere.
 */
export function drilledDef(base: UnitDef, techs: ReadonlySet<string>, baseId = base.id): UnitDef {
  const drills = byUnit.get(baseId)
  if (!drills) return base
  const earned = drills.filter(d => techs.has(d.tech))
  if (earned.length === 0) return base

  const key = `${base.id}#${earned.map(d => d.tech).join('+')}`
  const hit = cache.get(key)
  if (hit) return hit

  let def: UnitDef = { ...base }
  let drill: UnitDrill = { ...(base.drill ?? {}) }
  const notes: string[] = []
  for (const d of earned) {
    if (d.mult) {
      for (const [stat, mult] of Object.entries(d.mult) as [keyof NonNullable<Drill['mult']>, number][]) {
        const before = def[stat] as number
        // Cost stays on a round number — a bar full of 150s reads, a bar full
        // of 147s does not.
        const after = stat === 'cost' ? Math.max(10, Math.round((before * mult) / 10) * 10) : Math.max(1, Math.round(before * mult))
        def = { ...def, [stat]: after }
      }
    }
    if (d.set) drill = { ...drill, ...d.set }
    notes.push(d.note)
  }
  def.drill = drill
  def.description = `${base.description} ${notes.join(' ')}`
  cache.set(key, def)
  return def
}
