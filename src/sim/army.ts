import { abilityForAge } from '../data/abilities'
import { AGES, MAX_AGE, ageDef } from '../data/ages'
import type { UnitDef } from '../data/types'
import { UNITS_BY_ID, rosterForAge } from '../data/units'
import { FACTION_UNITS, factionRoster, type FactionId } from '../data/factions'
import { baseIdFor, morphedDef, morphedRoster } from '../data/morphs'
import { LANE_COUNT, type Faction, type ReserveMode } from './types'
import { powi } from './dmath'
import { BASE_RESEARCH_RATE, RESEARCH_PER_GOLD, RESEARCH_RING_STEP } from '../data/buildings'
import { TRACKS_BY_ID, trackCost, type FortressTrackId } from '../data/fortress'
import { OATHS, TECHS_BY_ID, UNLOCKABLE_UNIT_IDS, type DeedKey, type TechId } from '../data/tech'

/** How many cards the command bar can show. */
const MAX_ROSTER = 11

/** Base units and faction units together, since research can unlock either. */
const ALL_UNITS_BY_ID: Record<string, UnitDef> = {
  ...UNITS_BY_ID,
  ...Object.fromEntries(FACTION_UNITS.map(u => [u.id, u]))
}

/** Which research direction a path unit belongs to, read off its id prefix. */
const BRANCH_BY_PREFIX: Record<string, string> = {
  nk: 'carnage',
  ch: 'ordnance',
  cy: 'engineering',
  dc: 'occult',
  hb: 'blight'
}

function unitBranch(id: string): string | null {
  return BRANCH_BY_PREFIX[id.slice(0, 2)] ?? null
}

/** Units that stay behind their specific research node, lean or no lean. */
const NODE_GATED = new Set(UNLOCKABLE_UNIT_IDS)

export interface QueueEntry {
  def: UnitDef
  remainingMs: number
  totalMs: number
  /** The one placement decision: which lane this soldier will walk. */
  lane: number
}

export const QUEUE_LIMIT = 6

/** One line of the battle plan: keep this unit coming, into this file. */
export interface StandingOrder {
  id: string
  lane: number
}

/**
 * How many lines a battle plan may have.
 *
 * Eleven cards across five files is fifty-five possible orders, which is not a
 * plan, it is a spreadsheet. Ten is more than any real composition needs and
 * keeps the strip along the bottom readable at a glance.
 */
export const ORDER_LIMIT = 10

export interface ArmyModifiers {
  /** Multiplies passive gold income. */
  income: number
  /** Multiplies unit build speed. */
  buildSpeed: number
  /** Multiplies the health of units this army produces. */
  unitHp: number
  /** Multiplies the damage of units this army produces. */
  unitDamage: number
  /** Multiplies base max health. */
  baseHp: number
  /** Multiplies ability charge rate. */
  abilityRate: number
  /** Multiplies how fast units march. */
  unitSpeed: number
  /** Multiplies weapon reach. */
  unitRange: number
  /** Divides incoming damage — the generic "armour" line of research. */
  toughness: number
  /** Multiplies gold and experience earned from kills. */
  bounty: number
}

export function defaultModifiers(): ArmyModifiers {
  return { income: 1, buildSpeed: 1, unitHp: 1, unitDamage: 1, baseHp: 1, abilityRate: 1, unitSpeed: 1, unitRange: 1, toughness: 1, bounty: 1 }
}

/** Everything a side owns outside of the units already on the field. */
export default class Army {
  readonly faction: Faction
  gold: number
  xp = 0
  age = 0
  queue: QueueEntry[] = []
  abilityCharge = 0
  population = 0
  modifiers: ArmyModifiers

  /** Purchased in-match economy upgrades, each level adds income. */
  incomeLevel = 0

  /**
   * Levels owned in each fortress track. Unlike the outworks these cannot be
   * burned down, which is why they are held on the army rather than on a plot
   * — and why they are priced as if that mattered.
   */
  readonly tracks: Record<FortressTrackId, number> = { ramparts: 0, barbican: 0, cellars: 0 }
  /**
   * What this army has actually done this match. The nodes that decide what an
   * army becomes are gated on it, so the deep research is earned rather than
   * simply afforded. `baseHeld` is the lowest the fortress has ever been, as a
   * percentage, so a demand on it reads "never let it fall below".
   */
  readonly deeds: Record<DeedKey, number> = {
    kills: 0,
    losses: 0,
    goldEarned: 0,
    built: 0,
    peakArmy: 0,
    baseHeld: 100
  }

  /**
   * Researched behaviours. A Set rather than flags because the simulation asks
   * "can we do this?" in a dozen places and nowhere cares how many we own.
   */
  readonly techs = new Set<TechId>()

  private incomeCarry = 0

  constructor(faction: Faction, startingGold: number, modifiers: ArmyModifiers = defaultModifiers()) {
    this.faction = faction
    this.gold = startingGold
    this.modifiers = modifiers
  }

  get ageDefinition() {
    return ageDef(this.age)
  }

  get populationCap(): number {
    return this.ageDefinition.populationCap
  }

  /**
   * How much of the supply line is currently cut, 0–1.
   *
   * Recomputed every tick from the enemy standing in your yard, so ignoring a
   * lane is no longer free: soldiers who reach your wall and are left there
   * stop being a nuisance and start being an economic problem. Derived purely
   * from unit positions, which the state hash already covers, so it needs no
   * hashing of its own.
   */
  siege = 0

  /**
   * What the outworks are currently worth. Written by the battlefield every
   * tick rather than folded into `modifiers`, because these come from buildings
   * that can be burned down mid-match — a multiplier baked in at purchase time
   * would keep paying a commander whose granary is a crater.
   */
  yardIncome = 1
  yardBuildSpeed = 1
  researchDiscount = 1
  /** Units that may be under construction simultaneously. See `MUSTER_SLOTS`. */
  buildSlots = 1
  /** Milliseconds between free line soldiers, or 0 where nothing autospawns. */
  autoSpawnMs = 0
  /** Public so the state hash can see it — it is simulation state like any other. */
  autoSpawnTimer = 0

  /**
   * Research points, and the rate they arrive at.
   *
   * Research used to be bought with gold, which meant a commander who leaned
   * all the way into economy could simply buy the whole tree — the deepest
   * nodes in the game were a purchase decision rather than a commitment. Now
   * knowledge accrues on its own clock, at a rate only Reliquaries raise, and
   * gold cannot touch it. Pour everything into income and you end up RICH AND
   * PRIMITIVE, which is a position the game did not previously allow.
   *
   * The base rate is deliberately non-zero: a player who never builds a
   * Reliquary is slow, not frozen out.
   */
  research = 0
  researchRate = BASE_RESEARCH_RATE
  /** Total ever earned, so the UI can show progress rather than just a balance. */
  researchEarned = 0
  private researchCarry = 0

  /** Income before the siege takes its cut — what the yard *could* produce. */
  get grossIncomePerSecond(): number {
    return this.ageDefinition.income * this.modifiers.income * this.yardIncome * (1 + this.incomeLevel * 0.22)
  }

  get incomePerSecond(): number {
    return this.grossIncomePerSecond * (1 - this.siege)
  }

  get xpToAdvance(): number {
    return this.ageDefinition.xpToAdvance
  }

  get canEvolve(): boolean {
    return this.age < MAX_AGE && this.xp >= this.xpToAdvance && this.gold >= this.ageDefinition.evolveCost
  }

  get evolveCost(): number {
    return this.ageDefinition.evolveCost
  }

  /**
   * How many nodes of one direction this army owns. Two is a lean; the count
   * keeps growing as the commitment deepens.
   */
  branchDepth(branch: string): number {
    let n = 0
    for (const id of this.techs) {
      if (TECHS_BY_ID[id]?.branch === branch) n += 1
    }
    return n
  }

  /** The single direction this army has leant furthest, or null while even. */
  get dominantBranch(): string | null {
    let best: string | null = null
    let bestN = 1
    for (const branch of ['carnage', 'ordnance', 'engineering', 'occult', 'blight']) {
      const n = this.branchDepth(branch)
      if (n > bestN) {
        best = branch
        bestN = n
      }
    }
    return best
  }

  /**
   * What this army can build right now.
   *
   * The roster is the research made flesh, and it narrows as the war ages:
   *
   *  - Age 0 is the shared stone roster. Nobody has a creed yet.
   *  - Ages 1–2: the neutral roster of the age, plus the path units of EVERY
   *    direction this army holds at least two nodes in — spread your early
   *    research and you can field soldiers of two creeds side by side.
   *  - Age 3: the paths consolidate. Only the dominant direction's units
   *    still march with the neutral core.
   *  - Age 4: the roster is replaced outright by the dominant path's units,
   *    every age of them — the chaff of age 1 next to the engines of age 4.
   *    An army that never leant anywhere keeps the neutral future roster.
   *
   * Unit nodes (Rite of the Flenser, Drone Forge…) stay gates on their
   * specific units on top of all of this, and ascending still replaces
   * everything with the faction's own line.
   */
  get roster(): UnitDef[] {
    // Morphs run last, over whatever the roster turned out to be, so an
    // ascended faction's own units keep changing shape as you research past
    // the ascension rather than freezing the moment you took it.
    if (this.ascendedTo) return morphedRoster(factionRoster(this.ascendedTo), this.techs)

    const dominant = this.dominantBranch
    const pathDefs = (branch: string): UnitDef[] =>
      FACTION_UNITS.filter(
        u =>
          !u.hidden &&
          unitBranch(u.id) === branch &&
          u.age <= this.age &&
          (!NODE_GATED.has(u.id) || this.unlocked.has(u.id))
      ).sort((a, b) => a.age - b.age || a.cost - b.cost)

    let list: UnitDef[]
    if (this.age >= 4 && dominant) {
      list = pathDefs(dominant)
    } else {
      list = [...rosterForAge(this.age)]
      if (this.age >= 3) {
        // Consolidation makes room: the path's soldiers push the last of the
        // neutral core off the bar rather than being clipped by it.
        if (dominant) {
          const path = pathDefs(dominant)
          list = list.slice(0, Math.max(4, MAX_ROSTER - path.length))
          list.push(...path)
        }
      } else if (this.age >= 1) {
        // Doctrine soldiers DISPLACE the neutral core rather than piling on
        // after it — otherwise the final slice keeps the standard troops and
        // silently clips the very units the research just paid for.
        const path: UnitDef[] = []
        for (const branch of ['carnage', 'ordnance', 'engineering', 'occult', 'blight']) {
          if (this.branchDepth(branch) >= 2) path.push(...pathDefs(branch))
        }
        if (path.length > 0) {
          list = list.slice(0, Math.max(4, MAX_ROSTER - path.length))
          list.push(...path)
        }
      }
      // Non-path research unlocks still land at the end of the bar.
      for (const id of this.unlocked) {
        const def = ALL_UNITS_BY_ID[id]
        if (def && !list.includes(def) && (!unitBranch(id) || unitBranch(id) === dominant || this.age < 3)) {
          list.push(def)
        }
      }
    }
    return morphedRoster(list.slice(0, MAX_ROSTER), this.techs)
  }

  /**
   * The soldier a Muster Yard turns out on its own: the cheapest ground body
   * this army could otherwise buy.
   *
   * Deliberately the CHEAPEST rather than the best. A tier-3 Muster is meant to
   * keep a field populated between your real decisions, not to make them for
   * you — free elites would let a commander skip the composition game entirely,
   * which is the one part of this game that is supposed to be hard.
   */
  get lineUnit(): UnitDef | null {
    let best: UnitDef | null = null
    for (const def of this.roster) {
      if (def.layer !== 'ground') continue
      if (!best || def.cost < best.cost) best = def
    }
    return best
  }

  /** The apocalyptic faction this army ascended into, if it has. */
  ascendedTo: FactionId | null = null
  /** Units added to the roster by research. */
  readonly unlocked = new Set<string>()

  get ability() {
    return abilityForAge(this.age)
  }

  get abilityReady(): boolean {
    return this.abilityCharge >= 1
  }

  /** Cost of the next economy upgrade, or null once maxed. */
  hasTech(id: TechId): boolean {
    return this.techs.has(id)
  }

  /** The rival oath this army already swore, closing a node forever. */
  sworn(id: TechId): TechId | null {
    for (const rival of OATHS[id] ?? []) if (this.techs.has(rival)) return rival
    return null
  }

  /** Whether this army could research a node right now, and why not if not. */
  techAvailability(id: TechId): 'owned' | 'ready' | 'locked' | 'age' | 'research' | 'demand' | 'sworn' {
    const node = TECHS_BY_ID[id]
    if (!node) return 'locked'
    if (this.techs.has(id)) return 'owned'
    // You get one ascension. Committing to a faction closes the other four.
    if (node.kind === 'ascension' && this.ascendedTo) return 'locked'
    // An oath already sworn is not a thing you are short of — it is a door you
    // shut yourself, and it never reopens this match.
    if (this.sworn(id)) return 'sworn'
    if (!node.requires.every(r => this.techs.has(r))) return 'locked'
    if (node.requiresAny && !node.requiresAny.some(r => this.techs.has(r))) return 'locked'
    if (this.age < node.age) return 'age'
    if (node.demand && this.deeds[node.demand.metric] < node.demand.amount) return 'demand'
    if (this.research < this.researchCost(id)) return 'research'
    return 'ready'
  }

  /** Buys a node. Returns false if it was not available, changing nothing. */
  buyTech(id: TechId): boolean {
    if (this.techAvailability(id) !== 'ready') return false
    const node = TECHS_BY_ID[id]
    this.research -= this.researchCost(id)
    this.techs.add(id)
    // Stat research compounds into the army's modifiers. Units already on the
    // field keep the numbers they were built with — research equips the next
    // wave, it does not retrofit the one that is already dying.
    if (node.stat) {
      this.modifiers[node.stat.key] *= node.stat.mult
    }
    // Two of the core gates carry small effects of their own, so what the
    // node says on the tin is never a lie. (Powder Discipline's harder
    // blasts live in the battlefield's splash path.)
    if (id === 'field_stripping') this.modifiers.bounty *= 1.1
    if (id === 'old_rites') {
      this.modifiers.abilityRate *= 1.1
    }
    if (node.unlocks) this.unlocked.add(node.unlocks)
    if (node.becomes) {
      this.ascendedTo = node.becomes
      // Whatever was half-built belonged to the old army.
      this.queue.length = 0
    }
    return true
  }

  /** What the next level of a track costs, or null if it is finished. */
  trackCost(id: FortressTrackId): number | null {
    const track = TRACKS_BY_ID[id]
    const level = this.tracks[id]
    if (!track || level >= track.levels.length) return null
    return trackCost(track, level, this.age)
  }

  /** Buys the next level of a track. The battlefield applies what it means. */
  buyTrack(id: FortressTrackId): boolean {
    const cost = this.trackCost(id)
    if (cost === null || this.gold < cost) return false
    this.gold -= cost
    this.tracks[id] += 1
    return true
  }

  /**
   * Advances the research clock. Fractional points are carried rather than
   * rounded away, so a slow trickle still adds up to whole nodes and the rate
   * means exactly what it says.
   */
  tickResearch(dtMs: number): void {
    const gained = this.researchRate * (dtMs / 1000) + this.researchCarry
    const whole = Math.floor(gained)
    this.researchCarry = gained - whole
    if (whole > 0) {
      this.research += whole
      this.researchEarned += whole
    }
  }

  /** What a node costs in research points. See RESEARCH_PER_GOLD. */
  researchCost(id: TechId): number {
    const node = TECHS_BY_ID[id]
    if (!node) return 0
    const depth = powi(RESEARCH_RING_STEP, Math.max(0, node.ring))
    return Math.max(1, Math.round((node.cost / RESEARCH_PER_GOLD) * depth * this.researchDiscount))
  }

  incomeUpgradeCost(): number | null {
    if (this.incomeLevel >= 5) return null
    return Math.round(500 * powi(2.15, this.incomeLevel) * (1 + this.age * 0.75))
  }

  buyIncomeUpgrade(): boolean {
    const cost = this.incomeUpgradeCost()
    if (cost === null || this.gold < cost) return false
    this.gold -= cost
    this.incomeLevel += 1
    return true
  }

  canAfford(def: UnitDef): boolean {
    return this.gold >= def.cost
  }

  /**
   * Standing orders: keep this unit coming, into this file.
   *
   * The one placement decision this game asks of a commander is which file a
   * soldier walks down, and late game the economy pays for about two soldiers a
   * second — so making that decision by hand means two clicks a second for the
   * rest of the match, which is not a decision, it is a chore. An order is the
   * same decision made ONCE. The list is the battle plan: one line per
   * (unit, file), filled round-robin, so what you set up is what walks out.
   *
   * It never takes anything away from the player. Orders fill SPARE build
   * capacity only, they never push a hand-placed build down the queue, and
   * they never spend below the reserve.
   */
  orders: StandingOrder[] = []
  reserveMode: ReserveMode = 'none'
  /** Whose turn it is in the rotation. Simulation state — it goes in the hash. */
  orderCursor = 0

  /**
   * Adds or removes the order for this unit in this file.
   *
   * Toggling rather than a separate add and remove because the card in the bar
   * is the control: it is either standing an order in the file you have
   * selected or it is not, and clicking it again says so.
   */
  toggleOrder(unitId: string, lane: number): boolean {
    const file = Math.max(0, Math.min(LANE_COUNT - 1, Math.round(lane)))
    const id = baseIdFor(unitId)
    const at = this.orders.findIndex(o => o.id === id && o.lane === file)
    if (at >= 0) {
      this.orders.splice(at, 1)
      if (this.orderCursor > at) this.orderCursor -= 1
      if (this.orders.length > 0) this.orderCursor %= this.orders.length
      else this.orderCursor = 0
      return true
    }
    if (this.orders.length >= ORDER_LIMIT) return false
    this.orders.push({ id, lane: file })
    return true
  }

  hasOrder(unitId: string, lane: number): boolean {
    const id = baseIdFor(unitId)
    return this.orders.some(o => o.id === id && o.lane === lane)
  }

  /** Which files this unit is currently ordered into, ascending. */
  orderedLanes(unitId: string): number[] {
    const id = baseIdFor(unitId)
    return this.orders.filter(o => o.id === id).map(o => o.lane).sort((a, b) => a - b)
  }

  /** The gold figure the current reserve mode works out to right now. */
  get reserve(): number {
    if (this.reserveMode === 'age') return this.age >= MAX_AGE ? 0 : this.ageDefinition.evolveCost
    if (this.reserveMode === 'elite') {
      let best = 0
      for (const def of this.roster) if (def.cost > best) best = def.cost
      return best
    }
    return 0
  }

  /**
   * Tops the build slots up from the standing orders.
   *
   * Fills only as far as `buildSlots` rather than the whole queue: the point is
   * to keep the yard busy, not to bury a commander's own next click behind six
   * automatic ones. A slot that a hand-placed build is already using is a slot
   * an order does not touch.
   */
  private fillFromOrders(): void {
    const n = this.orders.length
    if (n === 0) return
    // Bounded twice over: the queue can only grow to `buildSlots`, and every
    // order gets at most one look per unit added.
    for (let tried = 0, cap = 0; tried < n && cap < n * QUEUE_LIMIT; tried += 1, cap += 1) {
      if (this.queue.length >= this.buildSlots) return
      const order = this.orders[this.orderCursor]
      this.orderCursor = (this.orderCursor + 1) % n
      const base = ALL_UNITS_BY_ID[baseIdFor(order.id)]
      if (!base) continue
      const def = morphedDef(base, this.techs)
      if (this.gold - def.cost < this.reserve) continue
      // An order that goes through resets the patience: the next sweep may
      // fill the slot after it in the same tick.
      if (this.enqueue(order.id, order.lane)) tried = -1
    }
  }

  queueFull(): boolean {
    return this.queue.length >= QUEUE_LIMIT
  }

  /** Reason a unit cannot be queued right now, or null if it can. */
  blockReason(def: UnitDef): string | null {
    if (def.age > this.age) return 'Not available in this age'
    if (this.queueFull()) return 'Build queue is full'
    if (this.population + this.queuedPopulation() + def.pop * (def.squad ?? 1) > this.populationCap) return 'Population cap reached'
    if (this.gold < def.cost) return 'Not enough gold'
    return null
  }

  queuedPopulation(): number {
    return this.queue.reduce((sum, entry) => sum + entry.def.pop * (entry.def.squad ?? 1), 0)
  }

  enqueue(unitId: string, lane = 2): boolean {
    // The command bar hands back whatever it is currently showing, which may be
    // a morph id. Strip it back to the authored unit and re-derive the morph
    // from this army's own techs: in a networked match the two peers hold the
    // same tech sets, so both arrive at the same def without either having to
    // have rendered the other's roster.
    const base = ALL_UNITS_BY_ID[baseIdFor(unitId)]
    if (!base) return false
    const def = morphedDef(base, this.techs)
    if (this.blockReason(def) !== null) return false
    this.gold -= def.cost
    this.queue.push({
      def,
      lane: Math.max(0, Math.min(4, Math.round(lane))),
      remainingMs: def.buildMs / (this.modifiers.buildSpeed * this.yardBuildSpeed),
      totalMs: def.buildMs / (this.modifiers.buildSpeed * this.yardBuildSpeed)
    })
    return true
  }

  /** Cancels the last queued unit and refunds its cost. */
  cancelLast(): number {
    const entry = this.queue.pop()
    if (!entry) return 0
    this.gold += entry.def.cost
    return entry.def.cost
  }

  /**
   * Advances timers. Returns the units that finished building this tick,
   * plus the gold earned from passive income.
   */
  /** Blood Pact pays a build's time out of the fortress instead of the clock. */
  get instantBuild(): boolean {
    return this.techs.has('blood_pact')
  }

  tick(dtMs: number): { ready: QueueEntry[]; income: number; autoSpawn: UnitDef | null } {
    const dt = dtMs / 1000
    const gained = this.incomePerSecond * dt + this.incomeCarry
    const whole = Math.floor(gained)
    this.incomeCarry = gained - whole
    this.gold += whole

    const chargeSeconds = this.ability.chargeSeconds / this.modifiers.abilityRate
    this.abilityCharge = Math.min(1, this.abilityCharge + dt / chargeSeconds)

    const ready: QueueEntry[] = []
    if (this.queue.length > 0) {
      // Blood Pact: the whole queue finishes at once. The cost is taken from
      // the fortress by the battlefield, which is the only thing that knows
      // about fortresses.
      const slots = this.instantBuild ? this.queue.length : Math.min(this.buildSlots, this.queue.length)
      for (let i = 0; i < slots; i += 1) {
        const entry = this.queue[i]
        entry.remainingMs -= this.instantBuild ? entry.remainingMs + 1 : dtMs
      }
      // Sweep back to front so splicing never skips a neighbour, then restore
      // queue order — two soldiers finishing on the same tick must still walk
      // out in the order they were bought, or a replay diverges from the match.
      for (let i = this.queue.length - 1; i >= 0; i -= 1) {
        if (this.queue[i].remainingMs > 0) continue
        ready.push(this.queue.splice(i, 1)[0])
      }
      ready.reverse()
    }

    // The tier-3 Muster Yard's own production. It runs on a wall clock rather
    // than off the queue, so it keeps working while the queue is empty, while
    // the queue is full, and while its owner is reading the tech tree.
    let autoSpawn: UnitDef | null = null
    if (this.autoSpawnMs > 0) {
      this.autoSpawnTimer += dtMs
      if (this.autoSpawnTimer >= this.autoSpawnMs) {
        this.autoSpawnTimer -= this.autoSpawnMs
        autoSpawn = this.lineUnit
      }
    } else {
      this.autoSpawnTimer = 0
    }

    // Standing orders top up AFTER the queue has been advanced and drained, so
    // a slot that came free this tick is refilled on this tick.
    this.fillFromOrders()

    return { ready, income: whole, autoSpawn }
  }

  /** Kills feed both the war chest and the tech tree. */
  rewardKill(bounty: number, xp: number): void {
    this.gold += bounty
    this.xp += xp
    this.abilityCharge = Math.min(1, this.abilityCharge + 0.022)
  }

  evolve(): boolean {
    if (!this.canEvolve) return false
    this.gold -= this.ageDefinition.evolveCost
    this.xp -= this.xpToAdvance
    this.age = Math.min(MAX_AGE, this.age + 1)
    // A fresh age arrives with its ability half-charged, which feels generous
    // at exactly the moment the player is most vulnerable.
    this.abilityCharge = Math.max(this.abilityCharge, 0.5)
    return true
  }

  consumeAbility(): boolean {
    if (!this.abilityReady) return false
    this.abilityCharge = 0
    return true
  }

  /** Snapshot for the HUD. */
  snapshot(baseHp: number, baseMaxHp: number) {
    return {
      gold: Math.floor(this.gold),
      xp: Math.floor(this.xp),
      xpToNext: this.age >= MAX_AGE ? 0 : this.xpToAdvance,
      age: this.age,
      baseHp: Math.round(baseHp),
      baseMaxHp: Math.round(baseMaxHp),
      population: this.population,
      populationCap: this.populationCap
    }
  }
}

export { AGES }
