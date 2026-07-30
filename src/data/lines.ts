import type { UnitDef } from './types'

/**
 * LINES: one slot on the command bar, changing hands as the war ages.
 *
 * A line is a named slot that several units take turns occupying. Only ever ONE
 * rung of a line is on the bar — the highest whose age the commander has reached
 * — so an upgrade *replaces* what came before instead of lengthening the list.
 * That is what makes ageing up feel like the army growing rather than the menu
 * growing.
 *
 * This replaces the only displacement rule the roster had: a blind
 * `list.slice(0, MAX_ROSTER - path.length)` that trimmed from the END of the core
 * list, so which unit got pushed off the bar was an accident of sort order. With
 * lines, the design says which unit takes which slot and the code obeys.
 *
 * Two kinds of rung, and the difference decides whether research is owed:
 *
 *  - A **tier bump** is the same body, more of it. It arrives on age-up and costs
 *    nothing, because ageing up is what paid for it.
 *  - A **mutation** is a different body doing a different thing. It carries a
 *    `lineTech`, and until that node is finished the rung does not exist.
 *
 * `lineTech` also carries the rule that machines are earned. Nobody starts an age
 * already owning a tank, a rocket launcher or a helicopter: those rungs all sit
 * behind a doctrine, so the slot is simply EMPTY until somebody pays for it — and
 * an empty slot is what gives each creed room to put its own answer there.
 */

/** A line's rungs, and how far the commander has climbed it. */
export interface LineRung {
  line: string
  def: UnitDef
  /** Rungs of the same line that are locked behind research the army lacks. */
  blockedBy?: string
}

/**
 * Collapse every line in `list` down to its single live rung.
 *
 * Units with no `line` pass through untouched, in their original order, so this
 * is safe to run over any roster. A line contributes at most one unit: the
 * highest-age rung that the army has both AGED into and UNLOCKED.
 *
 * Order is preserved by position of first appearance, so the bar does not
 * reshuffle itself when a rung is swapped for the one above it.
 */
export function resolveLines(list: readonly UnitDef[], age: number, techs: ReadonlySet<string>): UnitDef[] {
  // Nothing to do for a roster with no lines in it — the common case for the
  // neutral core before anybody researches anything.
  let sawLine = false
  for (const d of list) {
    if (d.line) {
      sawLine = true
      break
    }
  }
  if (!sawLine) return [...list]

  /** Best rung per line, plus where in the output that line first appeared. */
  const best = new Map<string, { def: UnitDef; at: number }>()
  const out: (UnitDef | null)[] = []

  for (const def of list) {
    if (!def.line) {
      out.push(def)
      continue
    }
    // A rung the commander cannot have: too new, or behind a node not finished.
    if (def.age > age) continue
    if (def.lineTech && !techs.has(def.lineTech)) continue

    const held = best.get(def.line)
    if (held === undefined) {
      best.set(def.line, { def, at: out.length })
      // Placeholder: the line owns this position and the winner is written in
      // afterwards, so climbing a line never moves its card on the bar.
      out.push(null)
      continue
    }
    // Higher age wins; on a tie the costlier rung is the later authored one.
    if (def.age > held.def.age || (def.age === held.def.age && def.cost > held.def.cost)) {
      best.set(def.line, { def, at: held.at })
    }
  }

  for (const { def, at } of best.values()) out[at] = def
  return out.filter((d): d is UnitDef => d !== null)
}

/**
 * The doctrines that open a line at all, mapped to the line each one opens.
 *
 * Insertion-ordered, so anything iterating this is deterministic across peers.
 * Used by the tech screen to say what a doctrine actually buys, and by the AI,
 * which otherwise never touched one: no ascension road runs through a machine,
 * so a commander following only its creed fielded no siege engine for the whole
 * match — the slot was empty and it had no reason to notice.
 */
export function lineTechsIn(list: readonly UnitDef[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const def of list) {
    if (def.lineTech && def.line && !out.has(def.lineTech)) out.set(def.lineTech, def.line)
  }
  return out
}

/**
 * The rungs a single doctrine opens, oldest first — the ladder it buys.
 *
 * A machine doctrine is not one unit: `siege_train` is a catapult now and a
 * railgun walker three ages later. The tech screen has to be able to say that,
 * or the node reads as overpriced for what it hands you today.
 */
export function rungsForTech(list: readonly UnitDef[], tech: string): UnitDef[] {
  const out = list.filter(d => d.lineTech === tech)
  out.sort((a, b) => a.age - b.age || a.cost - b.cost)
  return out
}

/**
 * Every rung of every line, for a roster screen or a test — including the ones
 * the commander has not reached or unlocked, so a card can say what it becomes.
 */
export function lineRungs(list: readonly UnitDef[]): Map<string, UnitDef[]> {
  const byLine = new Map<string, UnitDef[]>()
  for (const def of list) {
    if (!def.line) continue
    const rungs = byLine.get(def.line)
    if (rungs) rungs.push(def)
    else byLine.set(def.line, [def])
  }
  for (const rungs of byLine.values()) rungs.sort((a, b) => a.age - b.age || a.cost - b.cost)
  return byLine
}
