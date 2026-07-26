import type { UnitVisual } from '../../data/types'
import type { Canvas2D } from '../painter'
import type { Clip, Skeleton } from '../rig'

/**
 * The archetype contract.
 *
 * An archetype is a *body plan*: a skeleton, the parts that hang on it, and
 * the clips that move it. Units are not archetypes — a unit is an archetype
 * plus equipment plus a palette. There are fifty-seven units in the game and
 * there should never be fifty-seven body plans; there should be a handful,
 * each drawn extremely well, and everything else expressed as what a body is
 * wearing and carrying.
 *
 * That split is what keeps the roster coherent. A Bone Spearman and a Nekrotic
 * Flenser are the same footman skeleton with different kit, so they move like
 * members of the same army even though nothing about their silhouettes matches.
 */

/**
 * The animation states a body plan must be able to hold.
 *
 * Deliberately few. Death is not here because deaths are physics — the body
 * comes apart into its own parts and is thrown by the impulse that killed it,
 * which is far better than any authored death clip and already works.
 */
export type ClipName = 'idle' | 'walk' | 'attack'

/** A drawn part and the point the rig rotates it about, in 0..1 texture space. */
export interface PartArt {
  canvas: Canvas2D
  origin: [number, number]
}

export interface ArchetypeBuild {
  skeleton: Skeleton
  /** Keyed by the `part` names the skeleton refers to. */
  parts: Record<string, PartArt>
  clips: Record<ClipName, Clip>
  /**
   * Nominal world-space height, so the runtime can turn the rig's
   * height-fraction coordinates into pixels.
   */
  height: number
  /**
   * Where the weapon muzzle sits when the rig is at rest, as a height
   * fraction. Projectiles and muzzle flashes start here.
   */
  muzzle: [number, number]
}

export interface Archetype {
  id: string
  /**
   * Whether this body plan draws the given visual. The first archetype to
   * claim a visual wins, so the registry is ordered most specific first.
   */
  claims(v: UnitVisual): boolean
  build(v: UnitVisual, height: number): ArchetypeBuild
}
