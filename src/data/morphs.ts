import type { ArmorType, UnitRole } from '../sim/types'
import type { AttackSpec, UnitDef, UnitVisual } from './types'
import type { TechBranch, TechId } from './tech'
import { drilledDef } from './drills'

/**
 * Unit morphs.
 *
 * The research network is not supposed to sit in a menu. Every doctrine you
 * take reaches back into the roster and *changes the units you already build* —
 * their numbers, their silhouette, and in several cases the way they fight at
 * all. A Clubman four doctrines into Ordnance is not a Clubman with a bigger
 * number; he has stopped walking up to people and started throwing charges at
 * them from a hundred and fifty pixels away.
 *
 * Three morph gates per doctrine, spread across the rings, so the army visibly
 * changes three times on the way to its ascension instead of once at the end.
 * Morphs stack: taking stage two applies stage one and stage two in order.
 *
 * Which doctrine claims a unit is decided by *lean*: whichever line the army
 * owns the most gates in wins, ties broken by a fixed order. So a split
 * researcher gets the shallow morph of their strongest line, and a committed
 * one gets the deep one. Nothing here is random and nothing reads the clock,
 * so two peers in lockstep derive identical rosters.
 */

/** Stats a morph is allowed to scale. Everything else is structural. */
type MorphStat =
  | 'hp'
  | 'damage'
  | 'attackMs'
  | 'range'
  | 'speed'
  | 'cost'
  | 'buildMs'
  | 'mass'
  | 'bounty'
  | 'xp'

interface MorphStage {
  /** The research node that triggers it. */
  tech: TechId
  /** Word placed in front of the unit's name. */
  epithet: string
  /** What changed, in the language of the doctrine. */
  blurb: string
  /** Restrict to certain roles; omitted means every unit in the roster. */
  roles?: UnitRole[]
  mult?: Partial<Record<MorphStat, number>>
  crit?: number
  regen?: number
  hitsAir?: boolean
  armor?: ArmorType
  bonusVs?: Partial<Record<ArmorType, number>>
  visual?: Partial<UnitVisual>
  /** Rewrites the attack. This is where a morph changes how a unit plays. */
  attack?: (attack: AttackSpec, def: UnitDef) => AttackSpec
}

interface MorphLine {
  branch: TechBranch
  /** Shown on the roster card when a unit is carrying this line. */
  title: string
  stages: MorphStage[]
}

/**
 * Melee is the interesting case for a doctrine rewrite: a unit that has to
 * walk into contact is a completely different piece to one that does not.
 */
function isMelee(attack: AttackSpec): attack is Extract<AttackSpec, { kind: 'melee' }> {
  return attack.kind === 'melee'
}

function isShot(attack: AttackSpec): attack is Extract<AttackSpec, { kind: 'projectile' }> {
  return attack.kind === 'projectile'
}

export const MORPH_LINES: MorphLine[] = [
  // ───────────────────────────── CARNAGE ─────────────────────────────
  {
    branch: 'carnage',
    title: 'Carnage',
    stages: [
      {
        tech: 'butchery',
        epithet: 'Corrupted',
        blurb: 'Hits harder and moves quicker, and does not much care what it takes back.',
        mult: { damage: 1.14, speed: 1.08, hp: 0.94 },
        crit: 0.1,
        visual: { accent: 0xa8231f, cloth2: 0x4a1512 },
        attack: a => (isMelee(a) ? { ...a, knockback: a.knockback * 1.35 } : a)
      },
      {
        tech: 'plague_wind',
        epithet: 'Corrupted',
        blurb: 'Melee strikes now cleave through everything standing close. Ranged fire comes in ragged pairs.',
        mult: { damage: 1.12, hp: 1.06 },
        crit: 0.18,
        regen: 1.5,
        visual: { helmet: 'horns', torso: 'fur', skin: 0xb07257, accent: 0xd93b2b },
        attack: (a, def) => {
          if (isMelee(a)) return { ...a, splash: Math.max(a.splash ?? 0, 26 + def.height * 0.15) }
          if (isShot(a)) return { ...a, count: (a.count ?? 1) + 1, spread: a.spread + 0.06 }
          return a
        }
      },
      {
        tech: 'necropolis',
        epithet: 'Corrupted',
        blurb: 'A walking abattoir. Wide cleaves, savage against anything unarmoured, and hard to put down.',
        mult: { damage: 1.22, hp: 1.18, bounty: 1.2 },
        crit: 0.24,
        regen: 3,
        bonusVs: { unarmored: 1.45, light: 1.2 },
        visual: { cloth: 0x5c1a17, metal: 0x8a4a3c, accent: 0xff5a3c, bulk: 1.12 },
        attack: (a, def) => {
          if (isMelee(a)) return { ...a, splash: Math.max(a.splash ?? 0, 44 + def.height * 0.2), knockback: a.knockback * 1.2 }
          if (isShot(a)) return { ...a, splash: Math.max(a.splash ?? 0, 30), knockback: a.knockback * 1.3 }
          return a
        }
      }
    ]
  },

  // ───────────────────────────── ORDNANCE ────────────────────────────
  {
    branch: 'ordnance',
    title: 'Ordnance',
    stages: [
      {
        tech: 'ricochet',
        epithet: 'Primed',
        blurb: 'Flatter, faster, better aimed. Everything it throws arrives sooner and where it was pointed.',
        mult: { range: 1.1, damage: 1.06 },
        visual: { accent: 0xe08a2e, cloth2: 0x4a3a1c },
        attack: a => (isShot(a) ? { ...a, speed: a.speed * 1.25, spread: a.spread * 0.55 } : a)
      },
      {
        tech: 'overpressure',
        epithet: 'Shelled',
        blurb: 'Shot lands with a blast radius — and the ones who used to close to arm’s length now throw charges instead.',
        mult: { damage: 1.1, cost: 1.08 },
        visual: { helmet: 'kettle', torso: 'coat', metal: 0x9a7440, accent: 0xffb040 },
        attack: (a, def) => {
          if (isShot(a)) return { ...a, splash: Math.max(a.splash ?? 0, 34), knockback: a.knockback * 1.4 }
          if (isMelee(a)) {
            // The doctrine's signature: a melee unit stops being a melee unit.
            return {
              kind: 'projectile',
              projectile: 'grenade',
              speed: 300,
              gravity: 520,
              spread: 0.05,
              knockback: Math.max(80, a.knockback),
              splash: 46,
              muzzle: [10, -def.height * 0.42]
            }
          }
          return a
        }
      },
      {
        tech: 'ashfall',
        epithet: 'Ashen',
        blurb: 'Fires in pairs and buries the ground in fire. Nothing it shoots at gets a second position.',
        mult: { damage: 1.16, range: 1.08, attackMs: 1.12 },
        visual: { cloth: 0x3a2a18, metal: 0xc07a2c, accent: 0xff7a1c, bulk: 1.06 },
        attack: a =>
          isShot(a)
            ? { ...a, burst: a.burst ?? { rounds: 2, gapMs: 130 }, splash: Math.max(a.splash ?? 0, 50) }
            : a
      }
    ]
  },

  // ──────────────────────────── ENGINEERING ──────────────────────────
  {
    branch: 'engineering',
    title: 'Engineering',
    stages: [
      {
        tech: 'salvage',
        epithet: 'Braced',
        blurb: 'Plated out of whatever was lying on the field. Slower, and much harder to move.',
        mult: { hp: 1.22, speed: 0.92, mass: 1.2 },
        armor: 'light',
        visual: { metal: 0x7f8ea6, accent: 0x3d8bff, shield: 'wood' }
      },
      {
        tech: 'demolition',
        epithet: 'Riveted',
        blurb: 'Repairs itself between engagements, and its shots correct in flight.',
        mult: { hp: 1.2, mass: 1.25, buildMs: 0.92 },
        regen: 3,
        armor: 'heavy',
        bonusVs: { heavy: 1.3, structure: 1.25 },
        visual: { torso: 'plate', helmet: 'visor', shield: 'tower', metal: 0x93a4bd },
        attack: a => (isShot(a) ? { ...a, homing: Math.max(a.homing ?? 0, 1.6) } : a)
      },
      {
        tech: 'aegis',
        epithet: 'Automated',
        blurb: 'A shoulder mount does half the shooting, including at anything overhead.',
        mult: { attackMs: 0.8, hp: 1.12 },
        regen: 5,
        hitsAir: true,
        visual: { torso: 'exo', helmet: 'visor', accent: 0x8fd0ff, bulk: 1.14 },
        attack: a => (isShot(a) ? { ...a, count: (a.count ?? 1) + 1, spread: a.spread + 0.02 } : a)
      }
    ]
  },

  // ────────────────────────────── OCCULT ─────────────────────────────
  {
    branch: 'occult',
    title: 'The Occult',
    stages: [
      {
        tech: 'blood_pact',
        epithet: 'Marked',
        blurb: 'Cheaper, quicker, and noticeably less attached to its own survival.',
        mult: { speed: 1.16, cost: 0.9, hp: 0.92, buildMs: 0.88 },
        visual: { cloth: 0x3a2456, cloth2: 0x241338, accent: 0xb46bff }
      },
      {
        tech: 'sacrament',
        epithet: 'Hexed',
        blurb: 'Its shots follow people. Its blades take something back with every hit — and it can reach the air.',
        mult: { damage: 1.12 },
        crit: 0.2,
        regen: 4,
        hitsAir: true,
        visual: { helmet: 'hood', torso: 'robe', cape: true, accent: 0xd6a6ff },
        attack: a => (isShot(a) ? { ...a, homing: Math.max(a.homing ?? 0, 2.4) } : a)
      },
      {
        tech: 'black_sun',
        epithet: 'Eclipsed',
        blurb: 'Something else is doing the fighting now. Faster, meaner, and worth more when it finally falls.',
        mult: { damage: 1.28, attackMs: 0.85, bounty: 1.4, xp: 1.3 },
        crit: 0.28,
        bonusVs: { heavy: 1.3, air: 1.25 },
        visual: { skin: 0x8f7fae, helmet: 'halo', metal: 0x6b4a9c, accent: 0xf0d0ff },
        attack: a => (isMelee(a) ? { ...a, splash: Math.max(a.splash ?? 0, 24) } : a)
      }
    ]
  },

  // ────────────────────────────── BLIGHT ─────────────────────────────
  {
    branch: 'blight',
    title: 'Blight',
    stages: [
      {
        tech: 'spore_cloud',
        epithet: 'Tainted',
        blurb: 'Cheap, slow, and it closes its own wounds while it walks.',
        mult: { hp: 1.26, speed: 0.88, cost: 0.9 },
        regen: 2,
        visual: { skin: 0x8fa06a, cloth: 0x3f4d33, accent: 0x8fd694 }
      },
      {
        tech: 'rooted',
        epithet: 'Rotting',
        blurb: 'Every hit bursts a spore sac. Individually weaker, collectively impossible to clear.',
        mult: { hp: 1.18, damage: 0.94, buildMs: 0.85, cost: 0.94 },
        regen: 5,
        visual: { torso: 'robe', helmet: 'none', cloth2: 0x2b3a24, accent: 0xb8e08a },
        attack: (a, def) => {
          if (isMelee(a)) return { ...a, splash: Math.max(a.splash ?? 0, 28 + def.height * 0.1) }
          if (isShot(a)) return { ...a, splash: Math.max(a.splash ?? 0, 30) }
          return a
        }
      },
      {
        tech: 'deep_roots',
        epithet: 'Overgrown',
        blurb: 'Barely a soldier any more. It arrives, it takes root, and removing it costs more than it did.',
        mult: { hp: 1.4, speed: 0.85, mass: 1.5, damage: 1.08 },
        regen: 9,
        armor: 'heavy',
        visual: { skin: 0x6f8a56, metal: 0x5c7042, accent: 0xd8f0a0, bulk: 1.2 },
        attack: a => {
          if (isMelee(a)) return { ...a, splash: Math.max(a.splash ?? 0, 44), knockback: a.knockback * 1.25 }
          if (isShot(a)) return { ...a, splash: Math.max(a.splash ?? 0, 44), gravity: a.gravity * 1.1 }
          return a
        }
      }
    ]
  }
]

/** Every tech id that morphs something, for the research screen's copy. */
export const MORPH_TECHS: Set<TechId> = new Set(
  MORPH_LINES.flatMap(line => line.stages.map(s => s.tech))
)

/** Where a morph came from, so the UI can explain a card that changed shape. */
export interface MorphInfo {
  branch: TechBranch
  title: string
  stage: number
  epithet: string
  blurb: string
  baseId: string
  baseName: string
}

const morphInfo = new Map<string, MorphInfo>()
const morphCache = new Map<string, UnitDef>()

/** The derived def for a morph id, if that id has already been derived here. */
export function morphDefById(id: string): UnitDef | undefined {
  return morphCache.get(id)
}

/**
 * The authored unit behind an id, morphed or not.
 *
 * Morph ids are `base@creedN`, and the important property is that this needs no
 * cache: a peer receiving a build order for a unit it has never derived — the
 * *enemy* army's units, which nothing on that machine ever renders a card for —
 * must still be able to find the base and re-derive the morph from the techs it
 * already agrees on. Anything that resolved through a lazily-populated map here
 * would desync the moment a networked opponent researched a morph gate.
 */
export function baseIdFor(id: string): string {
  const at = id.indexOf('@')
  return at < 0 ? id : id.slice(0, at)
}

/** What the doctrine did to this unit, if it is a morph. */
export function morphInfoFor(id: string): MorphInfo | undefined {
  return morphInfo.get(id)
}

function applyStage(def: UnitDef, stage: MorphStage): UnitDef {
  const m = stage.mult ?? {}
  const scale = (value: number, key: MorphStat): number => {
    const factor = m[key]
    return factor === undefined ? value : value * factor
  }

  const next: UnitDef = {
    ...def,
    hp: Math.round(scale(def.hp, 'hp')),
    damage: Math.round(scale(def.damage, 'damage')),
    attackMs: Math.round(scale(def.attackMs, 'attackMs')),
    range: Math.round(scale(def.range, 'range')),
    speed: Math.round(scale(def.speed, 'speed')),
    cost: Math.max(10, Math.round(scale(def.cost, 'cost') / 5) * 5),
    buildMs: Math.round(scale(def.buildMs, 'buildMs')),
    mass: Math.round(scale(def.mass, 'mass') * 100) / 100,
    bounty: Math.round(scale(def.bounty, 'bounty')),
    xp: Math.round(scale(def.xp, 'xp')),
    visual: { ...def.visual, ...(stage.visual ?? {}) }
  }

  if (stage.crit !== undefined) next.crit = Math.max(def.crit ?? 0, stage.crit)
  if (stage.regen !== undefined) next.regen = (def.regen ?? 0) + stage.regen
  if (stage.hitsAir) next.hitsAir = true
  // Never downgrade armour: a doctrine that plates a unit should not un-plate
  // a knight who was already in plate.
  if (stage.armor) {
    const rank: ArmorType[] = ['unarmored', 'light', 'heavy', 'structure', 'air']
    if (def.armor !== 'air' && def.armor !== 'structure') {
      next.armor = rank.indexOf(stage.armor) > rank.indexOf(def.armor) ? stage.armor : def.armor
    }
  }
  if (stage.bonusVs) {
    const merged: Partial<Record<ArmorType, number>> = { ...(def.bonusVs ?? {}) }
    for (const [armor, mult] of Object.entries(stage.bonusVs) as [ArmorType, number][]) {
      merged[armor] = Math.max(merged[armor] ?? 1, mult)
    }
    next.bonusVs = merged
  }
  if (stage.attack) next.attack = stage.attack(def.attack, def)

  // A doctrine that hands a melee soldier something to throw has to hand him
  // the range to throw it, or he still walks into contact first and the whole
  // rewrite is invisible.
  if (def.attack.kind === 'melee' && next.attack.kind === 'projectile') {
    next.range = Math.max(next.range, 190)
    next.damageType = 'explosive'
  }

  return next
}

/**
 * Which line this army leans into, counted in owned morph gates. Ties fall to
 * the order the lines are declared in, which keeps two peers in agreement.
 */
function leadingLine(techs: ReadonlySet<string>): { line: MorphLine; stages: MorphStage[] } | null {
  let best: { line: MorphLine; stages: MorphStage[] } | null = null
  for (const line of MORPH_LINES) {
    const stages = line.stages.filter(s => techs.has(s.tech))
    if (stages.length === 0) continue
    if (!best || stages.length > best.stages.length) best = { line, stages }
  }
  return best
}

/**
 * The unit this army actually builds when it asks for `base`.
 *
 * Pure and cached: the same base and the same owned gates always produce the
 * same derived def, by identity, so sprite keys and lockstep hashes are stable.
 */
export function morphedDef(base: UnitDef, techs: ReadonlySet<string>): UnitDef {
  const lead = leadingLine(techs)
  // Drills are applied whether or not the army leans anywhere, and they are
  // applied LAST so that a doctrine multiplier lands on the drilled numbers
  // rather than the other way round — the reading everyone expects is "a
  // quarter off the clubman", not "a quarter off what the clubman used to be".
  if (!lead) return drilledDef(base, techs)
  // Keyed on WHICH stages are owned, not merely how many.
  //
  // A count is only sufficient if stage k always hard-requires stage k-1, and
  // Ordnance breaks that: `ashfall` hangs off `torchbearer_doctrine` and never
  // requires `overpressure`, so {ricochet, overpressure} and {ricochet,
  // ashfall} are both legal, both length 2, and both used to collide on
  // `clubman@ordnance2`. They are not close — one turns melee into thrown
  // charges at range 190, the other stays melee at 43 and changes the unit's
  // collision radius. The cache is module-level and outlives a match, so the
  // loser was whichever def happened to be derived first, in either peer's
  // page, in any earlier game.
  const key = `${base.id}@${lead.line.branch}:${lead.stages.map(s => s.tech).join('+')}`
  const cached = morphCache.get(key)
  if (cached) return drilledDef(cached, techs, base.id)

  let def: UnitDef = base
  for (const stage of lead.stages) {
    if (stage.roles && !stage.roles.includes(base.role)) continue
    def = applyStage(def, stage)
  }
  if (def === base) return drilledDef(base, techs)

  const top = lead.stages[lead.stages.length - 1]
  def = {
    ...def,
    id: key,
    name: base.id.startsWith('nk_') ? base.name : `${top.epithet} ${base.name}`,
    description: top.blurb
  }
  morphCache.set(key, def)
  morphInfo.set(key, {
    branch: lead.line.branch,
    title: lead.line.title,
    stage: lead.stages.length,
    epithet: top.epithet,
    blurb: top.blurb,
    baseId: base.id,
    baseName: base.name
  })
  return drilledDef(def, techs, base.id)
}

/** Applies morphs across a whole roster in place of the base defs. */
export function morphedRoster(roster: UnitDef[], techs: ReadonlySet<string>): UnitDef[] {
  if (techs.size === 0) return roster
  return roster.map(def => morphedDef(def, techs))
}
