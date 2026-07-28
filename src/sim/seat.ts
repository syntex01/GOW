import {
  DERELICT_MAX_ALIVE,
  DERELICT_SPAWN_MS,
  SEAT_GATE_LANES,
  SEAT_PLOTS,
  type BuildingDef
} from '../data/buildings'
import type Building from './building'
import type Base from './base'
import type { Faction } from './types'

/**
 * A seat of power, and the ground it sits on.
 *
 * Ageing up used to cost gold and experience and nothing else — it was pure
 * progress, with no moment of weakness and no decision in it. Now every age-up
 * founds a NEW seat further back and supersedes the one you were using, which
 * means three things at once:
 *
 *  YOUR INVESTMENT IS STRANDED. The plots you developed stay standing and keep
 *  paying, but you can no longer build on them, raise their tiers or repair
 *  them. Everything you spent on the old seat is now something you defend
 *  rather than something you own. Ageing is a decision, not a reward.
 *
 *  THE OLD SEAT KEEPS FIGHTING, BADLY. A superseded seat sends out a free
 *  soldier every thirteen seconds — of the age it was founded in, forever. A
 *  Stone Age camp is still turning out clubmen during a laser war. That is a
 *  screen, a corpse supply and a nuisance, and it never needs a nerf because
 *  it obsoletes itself.
 *
 *  DEPTH COSTS EXPOSURE. Each generation is a bigger establishment: more plots,
 *  more ground — and a wider front. A camp is dug out of one file; the capital
 *  you retire into at the last age can be attacked from all five. Receding buys
 *  you layers and makes the thing that actually loses the game easier to reach.
 */
export default class Seat {
  readonly faction: Faction
  /** Which age founded it. Also its size, its plots and its free soldiers. */
  readonly generation: number
  readonly base: Base
  readonly plots: Building[] = []

  /** True once a newer seat has been founded behind this one. */
  derelict = false

  /**
   * What this seat turns out for free once superseded. Chosen by the commander
   * from the roster of the age that founded it — the one remaining decision a
   * derelict seat offers.
   */
  garrisonUnitId: string | null = null
  private spawnTimer = DERELICT_SPAWN_MS
  /** How many of this seat's own free soldiers are on the field. */
  aliveFromHere = 0

  constructor(faction: Faction, generation: number, base: Base) {
    this.faction = faction
    this.generation = Math.max(0, Math.min(SEAT_PLOTS.length - 1, generation))
    this.base = base
  }

  get x(): number {
    return this.base.x
  }

  get alive(): boolean {
    return this.base.alive && this.base.hp > 0
  }

  /** Which files may attack this seat's fortress. */
  get gateLanes(): ReadonlySet<number> {
    return SEAT_GATE_LANES[this.generation]
  }

  /** A commander may only build on the seat they currently occupy. */
  get controllable(): boolean {
    return !this.derelict
  }

  /** Whether a plot will accept this building at all. */
  accepts(plot: number, def: BuildingDef): boolean {
    const spec = SEAT_PLOTS[this.generation][plot]
    if (!spec) return false
    return def.faces.includes(spec.face)
  }

  /**
   * Advances the free trickle. Returns the unit id to send out this tick, or
   * null. Capped so a long game does not silt up with four seats' worth of
   * obsolete infantry standing in a queue.
   */
  tickGarrison(dtMs: number): string | null {
    if (!this.derelict || !this.alive || !this.garrisonUnitId) return null
    if (this.aliveFromHere >= DERELICT_MAX_ALIVE) {
      // Held at the cap rather than banked, so clearing the screen does not
      // release a stockpiled wave all at once.
      this.spawnTimer = Math.min(this.spawnTimer, DERELICT_SPAWN_MS)
      return null
    }
    this.spawnTimer -= dtMs
    if (this.spawnTimer > 0) return null
    this.spawnTimer = DERELICT_SPAWN_MS
    return this.garrisonUnitId
  }

  /** Compact state for the fingerprint. */
  hashParts(): number[] {
    return [
      this.generation,
      this.derelict ? 1 : 0,
      Math.round(this.base.hp),
      Math.round(this.spawnTimer),
      this.aliveFromHere
    ]
  }
}
