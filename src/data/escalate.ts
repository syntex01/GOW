import type { UnitDef } from './types'

/**
 * UNITS THAT GROW WITH THE WAR.
 *
 * Most soldiers are replaced when the age turns over: the Man-at-Arms stops
 * being fielded and the Musketeer takes his place. A few are the SAME soldier
 * all the way through, and those need to get visibly and mechanically heavier
 * instead of quietly becoming irrelevant.
 *
 * The Husk is the case this exists for. It is not a stone-age body that gets
 * outclassed — it is what the creed is *made of*, so a fifth-age Husk has to be
 * a fifth-age problem. It escalates the only way a thing with no weapon and no
 * plan can: it gets much harder to put down, and there are more of it. Twice as
 * many at the second age, and it keeps widening from there.
 *
 * Nothing here is a damage buff. A Husk that hit hard would be a soldier; a
 * Husk that will not fall over and arrives in fours is a tide.
 */

/** Which growth table a def follows, if any. */
export type EscalationId = 'husk'

/**
 * The tiers, indexed by `age - firstAge`.
 *
 * Health, squad size and price move together, because `cost` prices the WHOLE
 * squad — doubling the bodies without doubling the price would make the second
 * age a strictly better deal than the first for the same card, which is not an
 * escalation, it is a discount.
 */
interface Tier {
  /** Shown on the card, so the bar says which one you are buying. */
  name: string
  hp: number
  squad: number
  cost: number
  /** Silhouette growth, and the kit that arrives with it. */
  bulk: number
  torso: 'bare' | 'fur' | 'plate'
  helmet: 'none' | 'horns' | 'great'
}

const HUSK_TIERS: readonly Tier[] = [
  // Age 1 — what it has always been. Two of them, and neither is a threat.
  { name: 'Husk', hp: 1, squad: 2, cost: 1, bulk: 1, torso: 'bare', helmet: 'none' },
  // Age 2 — DOUBLE THE HUSKS, and each one takes nearly twice the killing.
  { name: 'Swollen Husk', hp: 1.85, squad: 4, cost: 2.1, bulk: 1.14, torso: 'fur', helmet: 'none' },
  // Age 3 — six, and thick enough that clearing a file is a decision.
  { name: 'Bloated Husk', hp: 3.2, squad: 6, cost: 3.4, bulk: 1.3, torso: 'fur', helmet: 'horns' },
  // Age 4 — eight, and the reason a Carnage half of the board is unwalkable.
  { name: 'Charnel Husk', hp: 5.4, squad: 8, cost: 4.9, bulk: 1.48, torso: 'plate', helmet: 'great' }
]

const TABLES: Record<EscalationId, readonly Tier[]> = { husk: HUSK_TIERS }

/**
 * Derived defs are cached so a roster rebuilt every frame does not allocate a
 * new object — and, more importantly, so the id of a given tier is stable.
 * Anything downstream that compares defs by identity or by id (the command bar,
 * the queue, the morph cache) has to see the same object for the same tier.
 */
const cache = new Map<string, UnitDef>()

/**
 * The age-appropriate version of a soldier that grows.
 *
 * Returns the def unchanged when it does not escalate, or when the army has not
 * reached the next tier — so this is safe to run over a whole roster.
 *
 * Applied AFTER drills and morphs, so a Charnel Husk under the Charnel morph is
 * both: the tier multiplies whatever the doctrine already made of it.
 */
export function escalated(def: UnitDef, age: number): UnitDef {
  const table = def.escalates ? TABLES[def.escalates] : undefined
  if (!table) return def
  const tier = Math.max(0, Math.min(table.length - 1, age - def.age))
  if (tier === 0) return def
  const t = table[tier]
  const key = `${def.id}~${tier}`
  const hit = cache.get(key)
  if (hit) return hit
  const grown: UnitDef = {
    ...def,
    // The tier rides in the id the same way a morph does, so `baseIdFor` strips
    // it back to the authored unit and the queue can still find what it bought.
    id: `${def.id}@t${tier}`,
    name: t.name,
    hp: Math.round(def.hp * t.hp),
    squad: t.squad,
    cost: Math.round((def.cost * t.cost) / 10) * 10,
    bounty: Math.round(def.bounty * t.cost),
    xp: Math.round(def.xp * t.cost),
    buildMs: Math.round(def.buildMs * (1 + (t.cost - 1) * 0.35)),
    visual: { ...def.visual, bulk: (def.visual.bulk ?? 1) * t.bulk, torso: t.torso, helmet: t.helmet }
  }
  cache.set(key, grown)
  return grown
}

/** Every tier a growing unit can reach, for the codex and the art pipeline. */
export function escalationTiers(def: UnitDef): UnitDef[] {
  const table = def.escalates ? TABLES[def.escalates] : undefined
  if (!table) return [def]
  return table.map((_, i) => escalated(def, def.age + i))
}
