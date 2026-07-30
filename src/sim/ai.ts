import { Rng } from '../core/rng'
import type { Difficulty } from '../core/save'
import { MAX_AGE } from '../data/ages'
import type { UnitDef } from '../data/types'
import { turretsForAge } from '../data/turrets'
import { BUILDINGS_BY_ID, DOCTRINE_BUILDINGS, buildingCost, maxTierFor } from '../data/buildings'
import type Battlefield from './battlefield'
import type { ArmorType } from './types'
import { TECHS, TECHS_BY_ID, TECH_BRANCHES, ascensionFor, lineageFor, type TechBranch, type TechNode } from '../data/tech'
import { lineTechsIn } from '../data/lines'
import { UNITS } from '../data/units'
import { FACTION_UNITS } from '../data/factions'

/**
 * The doctrines that open a machine slot, cheapest first.
 *
 * These are the only nodes in the network that no ascension road passes
 * through: a Titan belongs to nobody's creed, which is exactly why it has to be
 * bought rather than handed out with the age. An AI following only its lineage
 * therefore reached the last age with every machine slot on its bar still
 * empty. It considers these alongside the next step of its road.
 */
const MACHINE_DOCTRINES: readonly TechNode[] = [...lineTechsIn([...UNITS, ...FACTION_UNITS]).keys()]
  .map(id => TECHS_BY_ID[id])
  .filter((n): n is TechNode => Boolean(n))
  .sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1))

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
    // THE ROAD, plus the machine slots that road passes near.
    //
    // A machine doctrine is on nobody's lineage, and it sits behind core nodes a
    // given creed's road may never touch — so an AI that only followed its
    // ascension could not buy one even when it had the research banked, and
    // reached the last age with every machine slot on its bar empty. It splices
    // in the doctrines it can reach in a step or two and leaves the ones that
    // would mean a detour through somebody else's creed: in practice every
    // commander raises a siege train, and only an engineer builds a Titan.
    const road = goal ? lineageFor(goal.id, oath) : []
    const onRoad = new Set(road.map(n => n.id))
    for (const doctrine of MACHINE_DOCTRINES) {
      const detour = lineageFor(doctrine.id, oath).filter(n => !onRoad.has(n.id))
      if (detour.length > 2) continue
      for (const n of detour) {
        onRoad.add(n.id)
        road.push(n)
      }
    }
    // By ring, so the spliced nodes interleave with the road instead of waiting
    // behind all of it. Ties keep insertion order, which keeps peers in step.
    this.path = road.sort((a, b) => a.ring - b.ring)
  }

  update(dtMs: number): void {
    if (this.bf.finished) return
    this.timer -= dtMs
    this.turretCooldown -= dtMs
    // Savings accrue on the sim's clock, not on the reaction clock — a sharper
    // commander thinks more often, it does not earn more often.
    this.updateSavings(dtMs)
    if (this.timer > 0) return
    this.timer = this.profile.reactionMs

    const army = this.bf.enemy
    const base = this.bf.enemyBase
    // A cut supply line is as urgent as a cracked wall: both mean the game is
    // being lost somewhere the commander is not looking.
    this.pressure = Math.max(1 - base.hp / base.maxHp, army.siege)
    // Recomputed once a reaction window rather than every tick: the savings
    // rule reads it, and a second of lag on "am I being swamped" is cheaper
    // than counting the whole field fifty times a second.
    let own = 0
    let foes = 0
    for (const u of this.bf.units) {
      if (!u.alive) continue
      if (u.faction === 'enemy') own += 1
      else foes += 1
    }
    this.swamped = own * 2 < foes

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
    // Research is no longer bought with gold, so there is nothing to hold back
    // for the army: a node it can afford is a node it should take. What used to
    // be a spending decision is now purely a question of what is unlocked.
    let pick: TechNode | null = null
    for (const node of this.path) {
      if (army.techAvailability(node.id) !== 'ready') continue
      pick = node
      break
    }
    // A machine slot is the one purchase that puts a whole LINE on the bar —
    // one node, and the siege slot refills itself every age from catapult to
    // railgun walker. It is also off every creed's road, so it competes with
    // the next step of that road on price rather than waiting behind all of it.
    for (const node of MACHINE_DOCTRINES) {
      if (army.techs.has(node.id)) continue
      if (pick && node.cost >= pick.cost) continue
      if (army.techAvailability(node.id) !== 'ready') continue
      pick = node
    }
    if (pick) {
      this.bf.buyTech('enemy', pick.id)
      return true
    }

    // Nothing on the critical path is open yet. Banked research goes into
    // whatever plain upgrade is cheapest rather than sitting idle — the same
    // way a human tops up while waiting for an age.
    let best: TechNode | null = null
    for (const node of TECHS) {
      if (node.kind !== 'stat') continue
      if (army.techAvailability(node.id) !== 'ready') continue
      if (!best || node.cost < best.cost) best = node
    }
    if (!best) return false
    this.bf.buyTech('enemy', best.id)
    return true
  }

  /**
   * Gold set aside for the next age. A savings account, not a spending rule.
   *
   * Without one the AI sat in a poverty trap. Every path that spends — units,
   * turrets, buildings — took whatever was in the treasury the moment it
   * arrived, so the balance never rose above a couple of hundred gold. It could
   * therefore never afford an age-up, never afford the Granary that would have
   * fixed the income that would have paid for one, and never afford a turret.
   * Measured over eight minutes at Veteran it finished the match still in age
   * one holding 3,723 experience against a requirement of 700 — never once
   * short of the RIGHT to advance, and short of the fee on every single second
   * of the match. A budgeting failure wearing an ageing failure's clothes.
   *
   * The obvious fix — hold back the whole fee until you can pay it — is worse,
   * and measurably so: at age one the fee is 1,800 against 16 gold a second, so
   * a commander banking it outright fields nothing for two minutes and is dead
   * inside three. Tried, measured, discarded.
   *
   * What a person actually does is save a SHARE OF INCOME. A fixed slice of
   * every coin goes to the future and the rest keeps the line fed, so the army
   * never goes to zero and the fund still fills — faster once a Granary is up,
   * which is the connection that makes economy worth building in the first
   * place. The account drains back into the war the moment the fortress comes
   * under real pressure, because nobody saves while losing the field.
   */
  private saved = 0

  /**
   * Whether the player has so many more bodies on the field that development
   * is no longer a plan.
   *
   * Deliberately not "any deficit". Tried as `own < foes` and measured: against
   * a reference rush the AI is behind on the count from the thirtieth second
   * onward and never catches up, so the fund never started once and the match
   * played out exactly as it had before any of this — never leaving age one.
   * Being a soldier or two down is an ordinary skirmish. Being swamped is the
   * emergency, and only that empties the account.
   */
  private swamped = false

  private updateSavings(dtMs: number): void {
    const army = this.bf.enemy
    if (army.age >= MAX_AGE) {
      this.saved = 0
      return
    }
    const calm = Math.max(0, Math.min(1, (0.7 - this.pressure) / 0.45))
    // Being swamped is a reason to stop saving before the wall is even touched.
    if (calm <= 0 || this.swamped) {
      this.saved = 0
      return
    }
    const share = 0.28 + this.profile.evolveEagerness * 0.34
    this.saved += army.incomePerSecond * (dtMs / 1000) * share * calm
    // Never hoard past what it is saving for, never claim money that is not
    // there, and give back whatever the pressure of the moment says it cannot
    // afford to keep.
    //
    // Deliberately NOT also floored at the price of one soldier. That was tried
    // — "the fund may never take the coin that would have been the next body" —
    // and it is self-defeating: the army spends the treasury back down below a
    // soldier's price every single window, so `gold - lineCost` is almost always
    // negative and the account can never open. Measured, the AI won its matches
    // outright, thirteen bodies to one, and still finished in age one holding
    // 12,635 experience against a requirement of 700. Rate-limiting the fund to
    // a share of income is what leaves room for the line; a floor just closes
    // the account.
    this.saved = Math.min(this.saved, this.developmentGoal() * calm, army.gold)
  }

  /**
   * The one thing the fund is currently for.
   *
   * The first Granary comes before the first age. Saving for an age on a bare
   * yard is saving at the wrong rate: the building costs a fraction of the fee,
   * pays for itself in about two minutes, and makes every coin banked after it
   * worth more. Measured unopposed with the order reversed, the AI reached age
   * two four minutes in still earning its opening 16 gold a second, having
   * never once been able to afford the thing that would have raised it.
   */
  private developmentGoal(): number {
    const army = this.bf.enemy
    if (!this.bf.hasBuilding('enemy', 'granary')) {
      const def = BUILDINGS_BY_ID.granary
      if (def) return buildingCost(def, 0, army.age)
    }
    return army.age >= MAX_AGE ? 0 : army.evolveCost
  }

  /** Whether the fund is still saving for its first Granary rather than an age. */
  private get savingForYard(): boolean {
    return !this.bf.hasBuilding('enemy', 'granary')
  }

  /** What it may spend on soldiers and stone — everything but the current goal. */
  private get spendable(): number {
    return Math.max(0, this.bf.enemy.gold - this.saved)
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
    if (!this.bf.evolve('enemy')) return false
    this.saved = 0
    return true
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
    // Being outnumbered is not yet "pressure" — the wall is still untouched and
    // the supply line still open — but it is the last moment at which spending
    // on economy is a plan rather than a concession. Against a rush the AI was
    // laying a Granary at forty seconds, arriving at the fight a soldier down,
    // and never getting the tempo back: the siege rule then cut the very income
    // it had just bought. Develop from a position, not into one.
    const foes = this.bf.units.filter(u => u.alive && u.faction === 'player').length
    if (ownUnits < foes) return false
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
    // Reliquary second, not last. Research accrues at a rate only this
    // building sets, so an AI that leaves it to the end spends the whole match
    // primitive no matter how rich it gets.
    const wishlist = ['granary', 'reliquary', 'muster', 'forge']
    for (const id of wishlist) {
      const def = BUILDINGS_BY_ID[id]
      if (!def) continue
      const ceiling = maxTierFor(seat.generation)
      // A standing building it can still lift, or failing that a fresh plot.
      // The fallback matters now that a seat caps how tall anything on it may
      // stand: at a camp the granary tops out at tier one, and the only way to
      // keep investing in income is a SECOND granary. Without this the AI would
      // hit the ceiling once and never spend on economy again.
      const standing = seat.plots.findIndex(p => p.alive && p.def?.id === id && p.tier + 1 <= ceiling)
      const empty = seat.plots.findIndex(p => p.empty && seat.accepts(p.plot, def))
      const target = standing >= 0 ? standing : empty
      if (target < 0) continue
      const plot = seat.plots[target]
      const tier = plot.alive && plot.def ? plot.tier + 1 : 0
      if (tier >= def.tiers.length || tier > ceiling) continue
      // The building the fund is FOR draws on the whole treasury; everything
      // after it queues behind the next age like any other purchase.
      const purse = this.savingForYard && id === 'granary' ? army.gold : this.spendable
      if (purse < buildingCost(def, tier, army.age) * margin) continue
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

    const affordable = turretsForAge(army.age).filter(t => t.cost <= this.spendable * this.profile.turretBias * 3)
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

    // Soldiers come out of what is left after the war chest — except when the
    // lane is empty, which is an emergency no amount of saving survives.
    const budget = own === 0 ? army.gold : this.spendable
    const within = roster.filter(def => def.cost <= budget)
    if (within.length === 0) return

    const pick =
      this.rng.next() < this.profile.counterPlay ? this.pickCounter(within) : this.pickAffordableBest(within)
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
