import { abilityForAge } from '../data/abilities'
import { AGES, MAX_AGE, ageDef } from '../data/ages'
import type { UnitDef } from '../data/types'
import { UNITS_BY_ID, rosterForAge } from '../data/units'
import type { Faction } from './types'

export interface QueueEntry {
  def: UnitDef
  remainingMs: number
  totalMs: number
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
}

export function defaultModifiers(): ArmyModifiers {
  return { income: 1, buildSpeed: 1, unitHp: 1, unitDamage: 1, baseHp: 1, abilityRate: 1 }
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

  get roster(): UnitDef[] {
    return rosterForAge(this.age)
  }

  get ability() {
    return abilityForAge(this.age)
  }

  get abilityReady(): boolean {
    return this.abilityCharge >= 1
  }

  /** Cost of the next economy upgrade, or null once maxed. */
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

  enqueue(unitId: string): boolean {
    const def = UNITS_BY_ID[unitId]
    if (!def) return false
    if (this.blockReason(def) !== null) return false
    this.gold -= def.cost
    this.queue.push({
      def,
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
  tick(dtMs: number): { ready: UnitDef[]; income: number } {
    const dt = dtMs / 1000
    const gained = this.incomePerSecond * dt + this.incomeCarry
    const whole = Math.floor(gained)
    this.incomeCarry = gained - whole
    this.gold += whole

    const chargeSeconds = this.ability.chargeSeconds / this.modifiers.abilityRate
    this.abilityCharge = Math.min(1, this.abilityCharge + dt / chargeSeconds)

    const ready: UnitDef[] = []
    if (this.queue.length > 0) {
      const head = this.queue[0]
      head.remainingMs -= dtMs
      while (this.queue.length > 0 && this.queue[0].remainingMs <= 0) {
        const done = this.queue.shift()
        if (done) ready.push(done.def)
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
