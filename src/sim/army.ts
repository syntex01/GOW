import { abilityForAge } from '../data/abilities'
import { AGES, MAX_AGE, ageDef } from '../data/ages'
import type { UnitDef } from '../data/types'
import { UNITS_BY_ID, rosterForAge } from '../data/units'
import { FACTION_UNITS, factionRoster, type FactionId } from '../data/factions'
import { baseIdFor, morphedDef, morphedRoster } from '../data/morphs'
import type { Faction } from './types'
import { TECHS_BY_ID, type DeedKey, type TechId } from '../data/tech'

/** How many cards the command bar can show. */
const MAX_ROSTER = 9

/** Base units and faction units together, since research can unlock either. */
const ALL_UNITS_BY_ID: Record<string, UnitDef> = {
  ...UNITS_BY_ID,
  ...Object.fromEntries(FACTION_UNITS.map(u => [u.id, u]))
}

export interface QueueEntry {
  def: UnitDef
  remainingMs: number
  totalMs: number
  /** The one placement decision: which lane this soldier will walk. */
  lane: number
}

export const QUEUE_LIMIT = 6

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

  get incomePerSecond(): number {
    return this.ageDefinition.income * this.modifiers.income * (1 + this.incomeLevel * 0.22)
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
   * What this army can build right now.
   *
   * Research is meant to be *visible*, so a roster is not a fixed list per age:
   * unlock nodes add units to it as they are researched, and ascending replaces
   * it outright with the faction's own five. That is the moment the tree pays
   * off — the command bar you have been using all match becomes a different
   * army's command bar.
   */
  get roster(): UnitDef[] {
    // Morphs run last, over whatever the roster turned out to be, so an
    // ascended faction's own units keep changing shape as you research past
    // the ascension rather than freezing the moment you took it.
    if (this.ascendedTo) return morphedRoster(factionRoster(this.ascendedTo), this.techs)
    const base = rosterForAge(this.age)
    const extra: UnitDef[] = []
    for (const id of this.unlocked) {
      const def = ALL_UNITS_BY_ID[id]
      if (def) extra.push(def)
    }
    // Unlocks go on the end, so the keys a player already knows do not move
    // under their fingers mid-match.
    return morphedRoster([...base, ...extra].slice(0, MAX_ROSTER), this.techs)
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

  /** Whether this army could research a node right now, and why not if not. */
  techAvailability(id: TechId): 'owned' | 'ready' | 'locked' | 'age' | 'gold' | 'demand' {
    const node = TECHS_BY_ID[id]
    if (!node) return 'locked'
    if (this.techs.has(id)) return 'owned'
    // You get one ascension. Committing to a faction closes the other four.
    if (node.kind === 'ascension' && this.ascendedTo) return 'locked'
    if (!node.requires.every(r => this.techs.has(r))) return 'locked'
    if (this.age < node.age) return 'age'
    if (node.demand && this.deeds[node.demand.metric] < node.demand.amount) return 'demand'
    if (this.gold < node.cost) return 'gold'
    return 'ready'
  }

  /** Buys a node. Returns false if it was not available, changing nothing. */
  buyTech(id: TechId): boolean {
    if (this.techAvailability(id) !== 'ready') return false
    const node = TECHS_BY_ID[id]
    this.gold -= node.cost
    this.techs.add(id)
    // Stat research compounds into the army's modifiers. Units already on the
    // field keep the numbers they were built with — research equips the next
    // wave, it does not retrofit the one that is already dying.
    if (node.stat) {
      this.modifiers[node.stat.key] *= node.stat.mult
    }
    if (node.unlocks) this.unlocked.add(node.unlocks)
    if (node.becomes) {
      this.ascendedTo = node.becomes
      // Whatever was half-built belonged to the old army.
      this.queue.length = 0
    }
    return true
  }

  incomeUpgradeCost(): number | null {
    if (this.incomeLevel >= 5) return null
    return Math.round(500 * Math.pow(2.15, this.incomeLevel) * (1 + this.age * 0.75))
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

  queueFull(): boolean {
    return this.queue.length >= QUEUE_LIMIT
  }

  /** Reason a unit cannot be queued right now, or null if it can. */
  blockReason(def: UnitDef): string | null {
    if (def.age !== this.age) return 'Not available in this age'
    if (this.queueFull()) return 'Build queue is full'
    if (this.population + this.queuedPopulation() + def.pop > this.populationCap) return 'Population cap reached'
    if (this.gold < def.cost) return 'Not enough gold'
    return null
  }

  queuedPopulation(): number {
    return this.queue.reduce((sum, entry) => sum + entry.def.pop, 0)
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
      remainingMs: def.buildMs / this.modifiers.buildSpeed,
      totalMs: def.buildMs / this.modifiers.buildSpeed
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

  tick(dtMs: number): { ready: QueueEntry[]; income: number } {
    const dt = dtMs / 1000
    const gained = this.incomePerSecond * dt + this.incomeCarry
    const whole = Math.floor(gained)
    this.incomeCarry = gained - whole
    this.gold += whole

    const chargeSeconds = this.ability.chargeSeconds / this.modifiers.abilityRate
    this.abilityCharge = Math.min(1, this.abilityCharge + dt / chargeSeconds)

    const ready: QueueEntry[] = []
    if (this.queue.length > 0) {
      const head = this.queue[0]
      // Blood Pact: the whole queue finishes at once. The cost is taken from
      // the fortress by the battlefield, which is the only thing that knows
      // about fortresses.
      head.remainingMs -= this.instantBuild ? head.remainingMs + 1 : dtMs
      while (this.queue.length > 0 && this.queue[0].remainingMs <= 0) {
        const done = this.queue.shift()
        if (done) ready.push(done)
        if (this.queue.length > 0) {
          // Carry leftover time into the next build so the queue never stalls.
          this.queue[0].remainingMs += Math.min(0, done?.remainingMs ?? 0)
        }
      }
    }

    return { ready, income: whole }
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
