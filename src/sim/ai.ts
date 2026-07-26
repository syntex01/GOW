import { Rng } from '../core/rng'
import type { Difficulty } from '../core/save'
import { MAX_AGE } from '../data/ages'
import type { UnitDef } from '../data/types'
import { turretsForAge } from '../data/turrets'
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
    const goal = ascensionFor(this.branch)
    this.path = goal ? lineageFor(goal.id) : []
  }

  update(dtMs: number): void {
    if (this.bf.finished) return
    this.timer -= dtMs
    this.turretCooldown -= dtMs
    if (this.timer > 0) return
    this.timer = this.profile.reactionMs

    const army = this.bf.enemy
    const base = this.bf.enemyBase
    this.pressure = 1 - base.hp / base.maxHp

    // One strategic decision per reaction window — but the queue is never left
    // idle for it. Returning after the first thing it did meant a commander who
    // spent a moment on research also stopped building, and an opponent could
    // out-produce it simply by never pausing. Measured against a plain
    // reference build order, it lost every game at every setting.
    this.considerAbility()
    if (!this.considerTech() && !this.considerEvolve() && !this.considerEconomy()) this.considerTurret()
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

  private considerEconomy(): boolean {
    const army = this.bf.enemy
    const cost = army.incomeUpgradeCost()
    if (cost === null) return false
    // Never invest while there is nothing on the field to hold the line —
    // greed with an empty lane loses the game outright.
    const ownUnits = this.bf.units.filter(u => u.alive && u.faction === 'enemy').length
    if (ownUnits < 3) return false
    const wantsEconomy = army.gold > cost * 1.9 && this.pressure < 0.4 && army.incomeLevel < 3
    if (!wantsEconomy) return false
    return army.buyIncomeUpgrade()
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
    for (const u of this.bf.units) {
      if (!u.alive || u.layer === 'air') continue
      any = true
      pressure[u.lane] += (u.faction === 'player' ? 1 : -1) * u.def.cost
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
