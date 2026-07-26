import type { UnitVisual } from '../../data/types'
import { footmanArchetype } from './footman'
import type { Archetype, ArchetypeBuild } from './types'

export type { Archetype, ArchetypeBuild, ClipName, PartArt } from './types'

/**
 * The body plans, most specific first.
 *
 * A unit is matched to the first archetype that claims it. Anything unclaimed
 * falls back to the original part builder, so the roster keeps working while
 * body plans are converted one at a time rather than in a single flip that
 * would have to be right about fifty-seven units at once.
 */
export const ARCHETYPES: Archetype[] = [footmanArchetype]

export function archetypeFor(v: UnitVisual): Archetype | null {
  for (const a of ARCHETYPES) if (a.claims(v)) return a
  return null
}

export function buildArchetype(v: UnitVisual, height: number): ArchetypeBuild | null {
  const archetype = archetypeFor(v)
  return archetype ? archetype.build(v, height) : null
}
