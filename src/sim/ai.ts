import { Rng } from '../core/rng'
import type { Difficulty } from '../core/save'
import { MAX_AGE } from '../data/ages'
import type { UnitDef } from '../data/types'
import { turretsForAge } from '../data/turrets'
import { BUILDINGS_BY_ID, DOCTRINE_BUILDINGS, buildingCost } from '../data/buildings'
import type Battlefield from './battlefield'
import type { ArmorType } from './types'
import { TECHS, TECH_BRANCHES, ascensionFor, lineageFor, type TechBranch, type TechNode } from '../data/tech'

export interface AiProfile {
  name: string
  /** Milliseconds between decisions. Lower = sharper play. */
  reactionMs: number
  /** 0 = hoards gold, 1 = spends the instant it can. */
  aggression: number
  /** How much of its bankroll it will sink into defences. */
  turretBias: number
  /** How eagerly it rushes the next age instead of pressing an advantage. */
  evolveEagerness: number
  /** Extra gold per second, as a multiplier on the age's base income. */
  incomeMultiplier: number
  unitHpMultiplier: number
  unitDamageMultiplier: number
  /** Minimum number of enemy units on the field before it fires its ability. */
  abilityTrigger: number
  /** Chance per decision to pick the counter-unit rather than the cheap one. */
  counterPlay: number
}

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  recruit: {
    name: 'Recruit',
    reactionMs: 1500,
    aggression: 0.45,
    turretBias: 0.1,
    evolveEagerness: 0.4,
    incomeMultiplier: 0.72,
    unitHpMultiplier: 0.85,
    unitDamageMultiplier: 0.85,
    abilityTrigger: 8,
    counterPlay: 0.2
  },
  veteran: {
    name: 'Veteran',
    reactionMs: 1000,
    aggression: 0.7,
    turretBias: 0.28,
    evolveEagerness: 0.65,
    incomeMultiplier: 1.0,
    unitHpMultiplier: 1.0,
    unitDamageMultiplier: 1.0,
    abilityTrigger: 6,
    counterPlay: 0.55
  },
  warlord: {
    name: 'Warlord',
    reactionMs: 680,
    aggression: 0.85,
    turretBias: 0.42,
    evolveEagerness: 0.8,
    incomeMultiplier: 1.32,
    unitHpMultiplier: 1.12,
    unitDamageMultiplier: 1.12,
    abilityTrigger: 4,
    counterPlay: 0.8
  },
  nightmare: {
    name: 'Nightmare',
    reactionMs: 460,
    aggression: 0.95,
    turretBias: 0.5,
    evolveEagerness: 0.92,
    incomeMultiplier: 1.75,
    unitHpMultiplier: 1.3,
    unitDamageMultiplier: 1.28,
    abilityTrigger: 3,
    counterPlay: 0.95
  }
}

/**
 * Opponent brain. It reads the field, picks a counter composition, manages its
 * economy and defences, and saves its ability for the moment it hurts most.
 */
export default class AiController {
  private bf: Battlefield
  private profile: AiProfile
  private timer = 0
  private turretCooldown = 4000
  /** The branch this opponent has committed to for the match. */
  private readonly branch: TechBranch
  /** Every node on the road to that branch's ascension, in buy order. */
  private readonly path: TechNode[]
  /** Rises when the AI is losing, making it play more desperately. */
  private pressure = 0
  /**
   * Seeded so an AI match replays identically from the same seed. Kept
   * separate from the battlefield's stream so AI decisions cannot shift the
   * combat rolls, which keeps the two independently reproducible.
   */
  private rng: Rng

  constructor(bf: Battlefield, profile: AiProfile, seed = 0x5eed) {
    this.bf = bf
    this.profile = profile
    this.rng = new Rng(seed)
    this.branch = this.rng.pick(TECH_BRANCHES).id
    // Which arm of each oath this commander swears is drawn from the same
    // seed as everything else, so two matches against the same difficulty are
    // not the same opponent — and so the AI actually *makes* the choice the
    // oath demands rather than stalling at a fork it cannot buy both sides of.
    const oath = [...new Set(TECHS.flatMap(t => t.requiresAny ?? []))].filter(() => this.rng.next() < 0.5)
    const goal = ascensionFor(this.branch)
    this.path = goal ? lineageFor(goal.id, oath) : []
  }

  update(dtMs: number): void {
    if (this.bf.finished) return
    this.timer -= dtMs
    this.turretCooldown -= dtMs
    if (this.timer > 0) return
    this.timer = this.profile.reactionMs

    const army = this.bf.enemy
    const base = this.bf.enemyBase
    // A cut supply line is as urgent as a cracked wall: both mean the game is
    // being lost somewhere the commander is not looking.
    this.pressure = Math.max(1 - base.hp / base.maxHp, army.siege)

    // One strategic decision per reaction window — but the queue is never left
    // idle for it. Returning after the first thing it did meant a commander who
    // spent a moment on research also stopped building, and an opponent could
    // out-produce it simply by never pausing. Measured against a plain
    // reference build order, it lost every game at every setting.
    this.considerAbility()
    // Developing the yard is spending SURPLUS, not taking a turn, so it does
    // not queue behind the strategic decision. Behind it, the AI never built
    // anything at all: research and ageing consumed nearly every reaction
    // window, and since the Granary replaced the flat income upgrade that
    // meant an AI commander was permanently poorer than any player who
    // bothered to raise one. It is gated on a comfortable surplus instead, so
    // it can never build itself out of an army it needed this second.
    this.considerEconomy()
    if (!this.considerTech() && !this.considerEvolve()) this.considerTurret()
    this.considerUnit()

    void army
  }

  private considerAbility(): boolean {
    const army = this.bf.enemy
    if (!army.abilityReady) return false
    const enemiesOnField = this.bf.units.filter(u => u.alive && u.faction === 'player')
    const threatValue = enemiesOnField.reduce((sum, u) => sum + u.def.cost, 0)
    const desperate = this.pressure > 0.55
    if (enemiesOnField.length >= this.profile.abilityTrigger || threatValue > 2200 || desperate) {
      this.bf.useAbility('enemy')
      return true
    }
    return false
  }

  /**
   * Research. The AI commits to one branch for the whole match, picked from
   * its seed, and works down it — which is how a human plays a tree, and means
   * facing the same difficulty twice does not feel like facing the same
   * opponent. It only spends on research once it has troops on the field, so
   * it never techs itself out of an army.
   */
  private considerTech(): boolean {
    const army = this.bf.enemy
    const fielded = this.bf.units.filter(u => u.alive && u.faction === 'enemy').length
    if (fielded < 3) return false

    // The road to an ascension runs through shared `core` nodes that belong to
    // no creed, so the AI follows the requirement graph rather than a branch
    // filter — otherwise it stalls at the root and never researches anything.
    for (const node of this.path) {
      if (army.techAvailability(node.id) !== 'ready') continue
      // Leave enough behind to keep building; a teched-up army of nobody loses.
      if (army.gold - node.cost < 400) return false
      this.bf.buyTech('enemy', node.id)
      return true
    }

    // Nothing on the critical path is affordable or unlocked yet. Surplus gold
    // goes into whatever plain upgrade is cheapest, the same way a human tops
    // up while waiting for an age.
    if (army.gold < 2500) return false
    let best: TechNode | null = null
    for (const node of TECHS) {
      if (node.kind !== 'stat') continue
      if (army.techAvailability(node.id) !== 'ready') continue
      if (!best || node.cost < best.cost) best = node
    }
    if (!best || army.gold - best.cost < 800) return false
    this.bf.buyTech('enemy', best.id)
    return true
  }

  private considerEvolve(): boolean {
    const army = this.bf.enemy
    if (army.age >= MAX_AGE) return false
    if (!army.canEvolve) return false
    // Hold off when under immediate pressure unless it is very eager.
    const enemiesClose = this.bf.units.filter(
      u => u.alive && u.faction === 'player' && Math.abs(u.x - this.bf.enemyBase.x) < 520
    ).length
    if (enemiesClose > 4 && this.rng.next() > this.profile.evolveEagerness) return false
    if (this.rng.next() > this.profile.evolveEagerness) return false
    return this.bf.evolve('enemy')
  }

  /**
   * Develops the yard.
   *
   * This used to buy a flat income upgrade, which no longer exists — the
   * Granary is the economy now, and an AI that could not build one would have
   * left the whole outworks system as something only the player interacts
   * with. It builds the way a person does: economy first, then whatever its
   * creed has opened, and it repairs what has been burned before it expands.
   */
  private considerEconomy(): boolean {
    const army = this.bf.enemy
    // Never invest while there is nothing on the field to hold the line —
    // greed with an empty lane loses the game outright.
    const ownUnits = this.bf.units.filter(u => u.alive && u.faction === 'enemy').length
    if (ownUnits < 3) return false
    if (this.pressure >= 0.4) return false
    const seat = this.bf.activeSeat('enemy')

    // Rubble first. A razed granary is a hole in the income that costs less to
    // fill than a new plot does to open.
    for (let i = 0; i < seat.plots.length; i += 1) {
      const plot = seat.plots[i]
      if (plot.alive || plot.underConstruction || !plot.def) continue
      if (this.bf.buildOnPlot('enemy', i, plot.def.id)) return true
    }

    // How much room it wants over the price, by how developed it already is.
    // A commander under constant pressure never banks a surplus, so waiting for
    // one meant the AI finished whole matches without raising a single
    // building — the outworks were a player-only system in practice. The FIRST
    // granary is treated the way a player treats it: something you buy as soon
    // as you can afford it, because it pays for itself in about two minutes.
    // Each one after that has to wait for more room.
    const developed = seat.plots.filter(p => p.alive).length
    const margin = developed === 0 ? 1.0 : developed === 1 ? 1.25 : 1.7

    // Then the ladder: raise what is missing, lift what is low. The order is
    // the order a commander cares about them in.
    const wishlist = ['granary', 'muster', 'forge', 'reliquary']
    for (const id of wishlist) {
      const def = BUILDINGS_BY_ID[id]
      if (!def) continue
      const standing = seat.plots.findIndex(p => p.alive && p.def?.id === id)
      const empty = seat.plots.findIndex(p => p.empty && seat.accepts(p.plot, def))
      const target = standing >= 0 ? standing : empty
      if (target < 0) continue
      const plot = seat.plots[target]
      const tier = plot.alive && plot.def ? plot.tier + 1 : 0
      if (tier >= def.tiers.length) continue
      if (army.gold < buildingCost(def, tier, army.age) * margin) continue
      if (this.bf.buildOnPlot('enemy', target, id)) return true
    }

    // Doctrine buildings once the node is owned — these are the pieces that
    // make an AI of one creed play differently from an AI of another.
    for (const def of DOCTRINE_BUILDINGS) {
      if (!def.requires || !army.techs.has(def.requires)) continue
      if (this.bf.hasBuilding('enemy', def.id)) continue
      const empty = seat.plots.findIndex(p => p.empty && seat.accepts(p.plot, def))
      if (empty < 0) continue
      // Doctrine buildings are a bigger commitment and there is only ever one
      // of each, so they wait for a little more room than the core four.
      if (army.gold < buildingCost(def, 0, army.age) * 1.4) continue
      if (this.bf.buildOnPlot('enemy', empty, def.id)) return true
    }

    // And stone, once it is actually being leaned on. The threshold is low
    // deliberately: by the time a fortress is at 60% the game is usually
    // decided, and a commander who only starts building walls then has left it
    // far too late to matter.
    if (this.pressure > 0.12) {
      for (const track of ['ramparts', 'cellars', 'barbican'] as const) {
        const cost = army.trackCost(track)
        if (cost === null || army.gold < cost * 1.15) continue
        if (this.bf.buyTrack('enemy', track)) return true
      }
    }
    return false
  }

  private considerTurret(): boolean {
    if (this.turretCooldown > 0) return false
    const army = this.bf.enemy
    const base = this.bf.enemyBase
    const freeSlot = base.slots.findIndex(s => !s.def)
    if (freeSlot < 0) return false

    const affordable = turretsForAge(army.age).filter(t => t.cost <= army.gold * this.profile.turretBias * 3)
    if (affordable.length === 0) return false

    // Anti-air becomes mandatory the moment the player flies something.
    const playerAir = this.bf.units.some(u => u.alive && u.faction === 'player' && u.layer === 'air')
    const hasAntiAir = base.slots.some(s => s.def?.hitsAir)
    let pick = affordable[affordable.length - 1]
    if (playerAir && !hasAntiAir) {
      const aa = affordable.filter(t => t.hitsAir)
      if (aa.length > 0) pick = aa[aa.length - 1]
    }

    if (this.bf.buildTurret('enemy', freeSlot, pick.id)) {
      this.turretCooldown = 9000
      return true
    }
    return false
  }

  private considerUnit(): void {
    const army = this.bf.enemy
    if (army.queueFull()) return

    const roster = army.roster.filter(def => army.blockReason(def) === null)
    if (roster.length === 0) return

    // Hold a reserve only while the lane is already held. Being outnumbered
    // is an emergency: commit everything.
    const own = this.bf.units.filter(u => u.alive && u.faction === 'enemy').length
    const foes = this.bf.units.filter(u => u.alive && u.faction === 'player').length
    const outnumbered = own < foes
    const reserve = outnumbered ? 0 : (1 - this.profile.aggression) * 320 * (1 + army.age)
    if (army.gold < reserve && this.pressure < 0.5) return

    const pick =
      this.rng.next() < this.profile.counterPlay ? this.pickCounter(roster) : this.pickAffordableBest(roster)
    if (pick) this.bf.queueUnit('enemy', pick.id, this.pickLane())
  }

  /**
   * Which lane to feed. Answer the biggest threat differential: the lane
   * where the player outweighs us most gets the reinforcement, and with
   * nothing on the board the lanes are rotated so the opening is spread.
   */
  private pickLane(): number {
    const pressure = [0, 0, 0, 0, 0]
    let any = false
    const home = this.bf.enemyBase.x
    for (const u of this.bf.units) {
      if (!u.alive || u.layer === 'air') continue
      any = true
      // Weighted by how deep it has come. A soldier in the yard is cutting the
      // supply line and is worth answering before one still crossing the field.
      const depth = 1 + 2 * Math.max(0, 1 - Math.abs(u.x - home) / 900)
      pressure[u.lane] += (u.faction === 'player' ? depth : -depth) * u.def.cost
    }
    if (!any) return this.laneRotation++ % 5
    let best = 0
    for (let lane = 1; lane < pressure.length; lane += 1) {
      if (pressure[lane] > pressure[best]) best = lane
    }
    return best
  }

  private laneRotation = 0

  /** Chooses the unit whose damage type best answers what the player fields. */
  private pickCounter(roster: UnitDef[]): UnitDef | null {
    const playerUnits = this.bf.units.filter(u => u.alive && u.faction === 'player')
    if (playerUnits.length === 0) return this.pickAffordableBest(roster)

    const armorCount: Record<ArmorType, number> = {
      unarmored: 0,
      light: 0,
      heavy: 0,
      structure: 0,
      air: 0
    }
    for (const u of playerUnits) armorCount[u.armor] += u.def.pop

    const needsAntiAir = armorCount.air > 0
    let best: UnitDef | null = null
    let bestScore = -Infinity

    for (const def of roster) {
      if (needsAntiAir && !def.hitsAir && def.role !== 'support') continue
      let score = 0
      for (const [armor, count] of Object.entries(armorCount) as [ArmorType, number][]) {
        if (count === 0) continue
        const bonus = def.bonusVs?.[armor] ?? 1
        const matrixBonus = MATCHUP[def.damageType]?.[armor] ?? 1
        score += count * bonus * matrixBonus
      }
      // Value per gold, so it does not always reach for the most expensive toy.
      score = (score * (def.damage / Math.max(1, def.attackMs / 1000)) * def.hp) / (def.cost * def.cost)
      score *= 1e6
      if (def.role === 'support' && playerUnits.length > 5) score *= 0.6
      if (score > bestScore) {
        bestScore = score
        best = def
      }
    }
    return best ?? this.pickAffordableBest(roster)
  }

  /** Falls back to the strongest thing it can currently pay for. */
  private pickAffordableBest(roster: UnitDef[]): UnitDef | null {
    const sorted = [...roster].sort((a, b) => b.cost - a.cost)
    // Weight toward the top of the list but keep some variety in the army.
    const cutoff = Math.max(1, Math.ceil(sorted.length * (0.3 + this.profile.aggression * 0.5)))
    const pool = sorted.slice(0, cutoff)
    return pool[this.rng.int(0, pool.length - 1)] ?? null
  }

  /** Endless mode ramps the profile between waves. */
  escalate(wave: number): void {
    this.profile = {
      ...this.profile,
      reactionMs: Math.max(260, this.profile.reactionMs * 0.965),
      aggression: Math.min(1, this.profile.aggression + 0.012),
      counterPlay: Math.min(1, this.profile.counterPlay + 0.02),
      turretBias: Math.min(0.7, this.profile.turretBias + 0.008)
    }
    void wave
  }
}

/** Compact view of the damage matrix for scoring counter picks. */
const MATCHUP: Record<string, Partial<Record<ArmorType, number>>> = {
  blunt: { heavy: 1.35, unarmored: 1.0 },
  pierce: { unarmored: 1.35, light: 1.15, air: 1.2 },
  slash: { unarmored: 1.25, light: 1.0 },
  explosive: { structure: 1.6, heavy: 1.15 },
  energy: { air: 1.25, heavy: 1.1, light: 1.1 }
}
