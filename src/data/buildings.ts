import type { TechId } from './tech'

/**
 * The outworks.
 *
 * A fortress used to be the only thing on a commander's half worth attacking,
 * and everything else they owned was two numbers — an income level and three
 * turret slots. That made the economy something you out-produced rather than
 * something you *fought over*, and it left both halves of the board looking
 * identical whatever creed was being played.
 *
 * Buildings stand on the flanks, in the two lanes that cannot reach a fortress
 * at all. That is the whole design in one sentence: **push the gate to win the
 * game, or push the flanks to starve it.** A soldier sent to burn a granary is
 * a soldier not pushing the gate, and the two are in different lanes, so the
 * choice is visible on the board rather than hidden in a build order.
 */

/**
 * Which side of a seat a plot stands on.
 *
 * Only defences may stand in FRONT of a fortress — you do not put the granary
 * between yourself and the enemy. The working buildings go on the FLANKS, where
 * they can be reached but only by a soldier who has given up on the gate, and
 * in the REAR, which is the last thing an attacker gets to and therefore the
 * safest place to spend gold.
 */
export type PlotFace = 'front' | 'flank' | 'rear'

export interface PlotSpec {
  /** Offset from the seat, positive toward the enemy. */
  dx: number
  lane: number
  face: PlotFace
}

/**
 * A seat's plots, by generation.
 *
 * Every age-up founds a new seat further back, and each generation is a bigger
 * establishment than the last: more ground, more plots, and — the price of all
 * that ground — a wider front that can be attacked. Depth is not free.
 */
export const SEAT_PLOTS: PlotSpec[][] = [
  // Gen 0 — a camp. Two plots, both tucked behind.
  [
    { dx: -70, lane: 1, face: 'rear' },
    { dx: -70, lane: 3, face: 'rear' }
  ],
  // Gen 1 — a holding. The flanks open up.
  [
    { dx: -78, lane: 1, face: 'rear' },
    { dx: -78, lane: 3, face: 'rear' },
    { dx: 20, lane: 0, face: 'flank' }
  ],
  // Gen 2 — a town. Both flanks, and the first forward emplacement.
  [
    { dx: -86, lane: 1, face: 'rear' },
    { dx: -86, lane: 3, face: 'rear' },
    { dx: 24, lane: 0, face: 'flank' },
    { dx: 24, lane: 4, face: 'flank' }
  ],
  // Gen 3 — a city. A defence goes out in front of the gate.
  [
    { dx: -94, lane: 1, face: 'rear' },
    { dx: -94, lane: 3, face: 'rear' },
    { dx: 26, lane: 0, face: 'flank' },
    { dx: 26, lane: 4, face: 'flank' },
    { dx: 118, lane: 2, face: 'front' }
  ],
  // Gen 4 — the last seat. Everything, and a front line of its own.
  [
    { dx: -104, lane: 1, face: 'rear' },
    { dx: -104, lane: 3, face: 'rear' },
    { dx: -104, lane: 2, face: 'rear' },
    { dx: 28, lane: 0, face: 'flank' },
    { dx: 28, lane: 4, face: 'flank' },
    { dx: 124, lane: 2, face: 'front' }
  ]
]

/**
 * Which files may attack a seat of each generation.
 *
 * This is the counterweight to receding. A camp is a narrow strongpoint that
 * has to be dug out of one file; the capital you retire into at the last age is
 * a broad target every file can reach. Going deeper buys you layers and costs
 * you exposure at the one place that actually loses the game.
 */
export const SEAT_GATE_LANES: ReadonlySet<number>[] = [
  new Set([2]),
  new Set([1, 2, 3]),
  new Set([1, 2, 3]),
  new Set([0, 1, 2, 3]),
  new Set([0, 1, 2, 3, 4])
]

/**
 * How far back each new seat is founded, and therefore how much the playfield
 * grows every time somebody ages up.
 *
 * This is the mechanism, not a decoration. A step has to clear the WHOLE of the
 * old establishment and then leave open ground behind it — the derelict town,
 * its plots, and a stretch of nothing — or the two seats simply overlap into
 * one sprawl and the war never gets any longer.
 *
 * A late seat measures about 284px from its rearmost plot (dx −104, half a
 * 56px cell) to its forward one (dx +124, likewise). A step of 280 therefore
 * put the establishments literally shoulder to shoulder: photographed at the
 * last age they read as one continuous row of fortresses, which is the exact
 * opposite of what a step is for. 460 clears the footprint and leaves ~176px
 * of open ground between one capital and the next — enough that each reads as
 * its own place, with a march between them.
 */
export const SEAT_STEP = 460

/**
 * How much of the ground you have receded your soldiers make up again before
 * they start walking, as a fraction of it.
 *
 * Without this, receding is a straight movement tax: age up and every soldier
 * you buy for the rest of the match spawns 460px further from the fight, while
 * an opponent who stayed put pays nothing. Ageing already costs you a stranded
 * town; it should not also quietly cost you tempo on every single unit.
 *
 * At 0.5 the muster line advances half as fast as the capital retreats, so the
 * CONTESTED field still grows every age — which is the whole point — while the
 * other half of the new ground becomes what depth is supposed to be: layers
 * behind your line, holding your derelict towns and their free garrisons, that
 * an attacker has to chew through after breaking you rather than before.
 */
export const MUSTER_ADVANCE = 0.5

/**
 * How often a superseded seat sends out a soldier, and how many of its own may
 * be alive at once. Slow, capped, and — because it can only ever make what it
 * knew how to make — quietly obsolete by the time there are four of them.
 */
export const DERELICT_SPAWN_MS = 13000
export const DERELICT_MAX_ALIVE = 3

export type BuildingKind = 'economy' | 'production' | 'research' | 'military' | 'defence' | 'doctrine'

export interface BuildingTier {
  cost: number
  hp: number
  /** What this tier does, in numbers, for the panel. */
  effect: string
}

export interface BuildingDef {
  id: string
  name: string
  kind: BuildingKind
  /** Three tiers for the core four; doctrine buildings have one. */
  tiers: BuildingTier[]
  /** Doctrine buildings only: the node that must be owned to raise it. */
  requires?: TechId
  /** Which creed's colours to draw it in, and whose panel section it sits in. */
  branch?: string
  /** One line of who they are. */
  blurb: string
  /** Silhouette hint for the art pipeline. */
  shape:
    | 'silo' | 'yard' | 'spire' | 'forge' | 'kiln' | 'vat'
    | 'magazine' | 'mast' | 'pit' | 'bed' | 'root' | 'redoubt' | 'palisade'
    | 'line' | 'chapel' | 'thrall'
  color: number
  /** Which faces this may be raised on. Defences only, out in front. */
  faces: PlotFace[]
}

/**
 * The four every commander can raise. None of them is a flat percentage for its
 * own sake — each hooks something the simulation already does, so that owning
 * one changes how a match is played rather than how fast a bar fills.
 */
export const CORE_BUILDINGS: BuildingDef[] = [
  {
    id: 'granary',
    name: 'Granary',
    kind: 'economy',
    faces: ['flank', 'rear'],
    blurb: 'Everything the war eats, stacked where the war can reach it.',
    shape: 'silo',
    color: 0xd8b45a,
    tiers: [
      { cost: 700, hp: 1400, effect: '+18% income' },
      { cost: 1600, hp: 2600, effect: '+38% income' },
      { cost: 3200, hp: 4200, effect: '+60% income, and the first 20% of any siege is absorbed' }
    ]
  },
  {
    id: 'muster',
    name: 'Muster Yard',
    kind: 'production',
    faces: ['flank', 'rear'],
    blurb: 'Somewhere to stand while somebody decides what you are for.',
    shape: 'yard',
    color: 0xa8703c,
    tiers: [
      { cost: 700, hp: 1300, effect: '−12% build time' },
      { cost: 1600, hp: 2400, effect: '−22% build time, and soldiers march out 120px advanced' },
      { cost: 3200, hp: 3900, effect: '−30% build time, and the first of each pair arrives with +15% health' }
    ]
  },
  {
    id: 'reliquary',
    name: 'Reliquary',
    kind: 'research',
    faces: ['flank', 'rear'],
    blurb: 'What was written down, and the people who still read it.',
    shape: 'spire',
    color: 0x9a7bd4,
    tiers: [
      { cost: 700, hp: 1100, effect: 'research costs −8%' },
      { cost: 1600, hp: 2100, effect: 'research −15%, ability charges 12% faster' },
      { cost: 3200, hp: 3400, effect: 'research −22%, and you can read the enemy commander’s creed' }
    ]
  },
  {
    id: 'forge',
    name: 'Forge',
    kind: 'military',
    faces: ['flank', 'rear'],
    blurb: 'The fortress repairs itself here, between the parts where it does not.',
    shape: 'forge',
    color: 0xc06a3a,
    tiers: [
      { cost: 700, hp: 1500, effect: 'the fortress mends 0.4%/s while nothing is hitting it' },
      { cost: 1600, hp: 2800, effect: '+ turret range +12%' },
      { cost: 3200, hp: 4400, effect: '+ a fourth turret slot on the wall' }
    ]
  }
]

/**
 * Two per creed, each behind a node that creed already wants.
 *
 * These are the reason to scout. Every one of them makes an existing creed rule
 * MORE so rather than adding a new subsystem — which means an opponent who has
 * read your research knows precisely which plot to burn.
 */
export const DOCTRINE_BUILDINGS: BuildingDef[] = [
  // ── carnage ──
  {
    id: 'bone_kiln',
    name: 'Bone Kiln',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'carnage',
    requires: 'bone_harvest',
    blurb: 'The harvest, rendered down properly instead of left where it fell.',
    shape: 'kiln',
    color: 0x8fd6a4,
    tiers: [{ cost: 1800, hp: 2600, effect: 'Remains on your half pay 0.9 gold/s each instead of 0.45. Razed: they pay nothing at all for 30s.' }]
  },
  {
    id: 'resurrection_vat',
    name: 'Resurrection Vat',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'carnage',
    requires: 'necropolis',
    blurb: 'It is quicker if you keep the pieces warm.',
    shape: 'vat',
    color: 0x7fd6a0,
    tiers: [{ cost: 2600, hp: 3000, effect: 'The dead rise every 2.4s instead of 4s, and stand at 65% health instead of 50%.' }]
  },
  // ── ordnance ──
  {
    id: 'powder_magazine',
    name: 'Powder Magazine',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'ordnance',
    requires: 'shrapnel',
    blurb: 'Everything you will ever fire, in one building, on your own ground.',
    shape: 'magazine',
    color: 0xff8a3a,
    tiers: [{ cost: 2000, hp: 1900, effect: '+18% splash radius on everything you fire. DETONATES when destroyed, cratering your own flank.' }]
  },
  {
    id: 'signal_tower',
    name: 'Signal Tower',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'ordnance',
    requires: 'plunging_volleys',
    blurb: 'Someone up there can see the whole field and is shouting corrections.',
    shape: 'mast',
    color: 0xffa04a,
    tiers: [{ cost: 2200, hp: 2200, effect: 'Plunging fire reaches ANY lane instead of two over.' }]
  },
  // ── engineering ──
  {
    id: 'scrap_quarry',
    name: 'Scrap Quarry',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'engineering',
    requires: 'salvage',
    blurb: 'Crews who do not care whose half the wreckage landed on.',
    shape: 'pit',
    color: 0x5ce1ff,
    tiers: [{ cost: 2000, hp: 2800, effect: 'Wreckage pays you wherever it lands, not only on your own half.' }]
  },
  {
    id: 'assembly_line',
    name: 'Assembly Line',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'engineering',
    requires: 'autoforge',
    blurb: 'The turret was being rebuilt before it finished falling over.',
    shape: 'line',
    color: 0x7fe8ff,
    tiers: [{ cost: 2600, hp: 3200, effect: 'Destroyed turrets rebuild INSTANTLY, and come back one age higher where a better model exists.' }]
  },
  // ── occult ──
  {
    id: 'black_chapel',
    name: 'Black Chapel',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'occult',
    requires: 'soul_tithe',
    blurb: 'Nine seats, eight of them occupied, and a very good view of the field.',
    shape: 'chapel',
    color: 0xb46bff,
    tiers: [{ cost: 2000, hp: 2000, effect: 'Every enemy death anywhere feeds your ability +8% instead of +5%.' }]
  },
  {
    id: 'thrall_pit',
    name: 'Thrall Pit',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'occult',
    requires: 'mind_thrall',
    blurb: 'Somewhere to keep them until they stop arguing.',
    shape: 'thrall',
    color: 0xc98bff,
    tiers: [{ cost: 2400, hp: 2600, effect: 'Raised thralls cost no population at all.' }]
  },
  // ── blight ──
  {
    id: 'spore_bed',
    name: 'Spore Bed',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'blight',
    requires: 'mycelium',
    blurb: 'It does not need anything to die first. It would simply prefer it.',
    shape: 'bed',
    color: 0xd98ec4,
    tiers: [{ cost: 2000, hp: 2400, effect: 'Blight grows outward from the bed on its own — your half turns hostile without a single kill to seed it.' }]
  },
  {
    id: 'heart_root',
    name: 'Heart Root',
    kind: 'doctrine',
    faces: ['flank', 'rear'],
    branch: 'blight',
    requires: 'deep_roots',
    blurb: 'The part of it that is thinking.',
    shape: 'root',
    color: 0xe8a4d4,
    tiers: [{ cost: 2600, hp: 3400, effect: 'Your soldiers dig in twice as fast, and your blight mends your own buildings.' }]
  }
]

/**
 * What may stand in front of a fortress.
 *
 * A forward plot is the first thing an attacker reaches, so nothing that earns
 * gold is allowed there — only things whose whole job is to be in the way. The
 * Redoubt shoots; the Palisade does not, and is the cheaper answer when what
 * you need is simply for the enemy to be somewhere else for eleven seconds.
 */
export const DEFENCE_BUILDINGS: BuildingDef[] = [
  {
    id: 'redoubt',
    name: 'Redoubt',
    kind: 'defence',
    faces: ['front', 'flank'],
    blurb: 'A gun, a roof over it, and somebody who has not slept.',
    shape: 'redoubt',
    color: 0x9aa6b8,
    tiers: [
      { cost: 800, hp: 2000, effect: 'Fires on anything in its file within 300px for 60 damage a shot.' },
      { cost: 1700, hp: 3400, effect: '95 damage, and it reaches the file either side of its own.' },
      { cost: 3300, hp: 5200, effect: '150 damage, splash, and it shoots at aircraft.' }
    ]
  },
  {
    id: 'palisade',
    name: 'Palisade',
    kind: 'defence',
    faces: ['front'],
    blurb: 'It does nothing. It does nothing for a very long time.',
    shape: 'palisade',
    color: 0x7c6a52,
    tiers: [
      { cost: 500, hp: 4200, effect: 'Blocks its file. Nothing advances past it until it is down.' },
      { cost: 1100, hp: 7600, effect: 'Blocks its file, and the file either side of it.' },
      { cost: 2200, hp: 12000, effect: 'Blocks three files, and mends 0.5%/s between assaults.' }
    ]
  }
]

export const ALL_BUILDINGS: BuildingDef[] = [...CORE_BUILDINGS, ...DEFENCE_BUILDINGS, ...DOCTRINE_BUILDINGS]

export const BUILDINGS_BY_ID: Record<string, BuildingDef> = Object.fromEntries(
  ALL_BUILDINGS.map(b => [b.id, b])
)

/** Stable order, so a building set can be packed into the state hash. */
export const BUILDING_ORDER: string[] = ALL_BUILDINGS.map(b => b.id)

/**
 * What a plot costs to raise or to lift a tier, scaled by age the way the
 * economy upgrade is (`Army.incomeUpgradeCost`). Later ages are richer, so a
 * flat price would make the outworks free by the Modern age.
 */
export function buildingCost(def: BuildingDef, tier: number, age: number): number {
  const step = def.tiers[Math.max(0, Math.min(def.tiers.length - 1, tier))]
  return Math.round(step.cost * (1 + age * 0.28))
}

/** Rebuilding is cheaper than raising, but it is never free. */
export const REBUILD_FRACTION = 0.6

/** How long a razed plot takes to come back, before the age scaling. */
export const REBUILD_MS = 14000
