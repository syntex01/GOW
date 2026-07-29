import type { FactionId } from './factions'

/**
 * The research network.
 *
 * Not five parallel ladders — a web. It starts at a single node and fans
 * outward, and the further out you go the fewer ways there are to keep going.
 * Near the root the nodes are broad and shared: two different creeds both want
 * you to strip the field, both want tighter powder. Several early nodes have
 * more than one parent, so the early game is genuinely mixable. By the outer
 * rings each node has exactly one lineage behind it, and the five ascensions
 * at the rim each demand most of a direction.
 *
 * That shape is the design. Early research is cheap and non-committal; late
 * research forces you to give something up, and the last node you buy decides
 * what your army *is*.
 *
 * Nodes come in four kinds. Behaviour nodes change what the game *does* and
 * carry the identity of a direction. Stat nodes are the connective tissue —
 * cheap, always useful, and the thing you take while you are still deciding.
 * Unit nodes put something new in your hand. Ascensions are the rim.
 *
 * The mix matters: a web of only behaviour nodes is a set of five decisions
 * wearing a costume, and a web of only stat nodes is a shopping list. The stat
 * nodes are what make the early game feel like a network rather than a menu,
 * and what make committing to a direction late feel like giving something up.
 */

export type TechBranch = 'core' | 'carnage' | 'ordnance' | 'engineering' | 'occult' | 'blight'

export type TechKind =
  /** Changes how the simulation behaves. */
  | 'behaviour'
  /**
   * A plain multiplier on one of the army's modifiers. These exist to give the
   * network body: they are the cheap, safe, always-useful nodes you take while
   * deciding which direction you actually want, and the connective tissue that
   * makes the web dense rather than five bare lines.
   */
  | 'stat'
  /** Puts a new unit into your roster, permanently. */
  | 'unit'
  /** The rim of the network: become a faction. */
  | 'ascension'

/** Node identifiers are plain strings — the network is data, and it grows. */
export type TechId = string

/** What a demand counts. All of them only ever go one way. */
export type DeedKey = 'kills' | 'losses' | 'goldEarned' | 'built' | 'peakArmy' | 'baseHeld'

/**
 * A deed that has to be done before a node will open, on top of its parents
 * and its price. The nodes that decide what an army *is* are earned in the
 * field: you cannot simply save up for your own identity, and a commander who
 * wants a particular ascension has to play toward it from the first minute.
 */
export interface TechDemand {
  metric: DeedKey
  amount: number
  /** Shown on the locked node, phrased as the deed. */
  label: string
}

export interface TechNode {
  id: TechId
  name: string
  /** Which direction this node leans. `core` nodes belong to everyone. */
  branch: TechBranch
  kind: TechKind
  /** Distance from the root. Drives layout and, loosely, cost. */
  ring: number
  /** Vertical slot within the ring, in creed order. Layout only. */
  row: number
  /** Earliest age this can be researched. */
  age: number
  cost: number
  /** Every parent must be owned. Early nodes deliberately have several. */
  requires: TechId[]
  /**
   * At least ONE of these must be owned, on top of `requires`. Used where a
   * road forks and either arm gets you to the rim: the ascensions sit behind
   * an oath, and an oath is a choice, so demanding both arms would make the
   * choice fictional.
   */
  requiresAny?: TechId[]
  /**
   * Nodes this one closes off forever. Two nodes that exclude each other are
   * an *oath*: one creed, two irreconcilable readings of it, and you take one.
   * This is what stops the network being a schedule you eventually finish.
   */
  excludes?: TechId[]
  /** What it does, stated as a behaviour. */
  effect: string
  /** For `unit` nodes: which unit joins the roster. */
  unlocks?: string
  /** For `ascension` nodes: what the army becomes. */
  becomes?: FactionId
  /** For `stat` nodes: which army modifier it multiplies, and by how much. */
  stat?: { key: StatKey; mult: number }
  /** A deed that must be done first. Reserved for the nodes that define a creed. */
  demand?: TechDemand
}

/** The army modifiers stat research can move. */
export type StatKey =
  | 'income'
  | 'buildSpeed'
  | 'unitHp'
  | 'unitDamage'
  | 'baseHp'
  | 'abilityRate'
  | 'unitSpeed'
  | 'unitRange'
  | 'toughness'
  | 'bounty'

export interface CreedDef {
  id: TechBranch
  name: string
  blurb: string
  faction: FactionId | null
  accent: number
}

export const CREEDS: CreedDef[] = [
  {
    id: 'carnage',
    name: 'CARNAGE',
    blurb: 'The dead are a resource. The ground they fell on is terrain.',
    faction: 'nekrotics',
    accent: 0xc0392b
  },
  {
    id: 'ordnance',
    name: 'ORDNANCE',
    blurb: 'Every shot is an object with somewhere else to be afterwards.',
    faction: 'cinder_host',
    accent: 0xe08a2e
  },
  {
    id: 'engineering',
    name: 'ENGINEERING',
    blurb: 'Refuse the shape of the lane. Go under it, salvage it, rebuild it.',
    faction: 'cyborgs',
    accent: 0x3d8bff
  },
  {
    id: 'occult',
    name: 'THE OCCULT',
    blurb: 'Pay in something other than gold and the price stops mattering.',
    faction: 'dark_circle',
    accent: 0xb46bff
  },
  {
    id: 'blight',
    name: 'BLIGHT',
    blurb: 'Do not take the ground. Make the ground yours and wait.',
    faction: 'hollow_bloom',
    accent: 0x8fd694
  }
]

export const CREEDS_BY_ID: Record<string, CreedDef> = Object.fromEntries(CREEDS.map(c => [c.id, c]))

/** Colour for a node's own leaning; core nodes are neutral. */
export const BRANCH_ACCENT: Record<TechBranch, number> = {
  core: 0xa8b4cc,
  carnage: 0xc0392b,
  ordnance: 0xe08a2e,
  engineering: 0x3d8bff,
  occult: 0xb46bff,
  blight: 0x8fd694
}

/** Kept as an alias so older call sites reading branches still compile. */
export const TECH_BRANCHES = CREEDS

export const TECHS: TechNode[] = [
  // ─────────────────────────── Ring 0 — the root ───────────────────────────
  {
    id: 'collapse',
    name: 'The Collapse',
    branch: 'core',
    kind: 'behaviour',
    ring: 0,
    row: 4,
    age: 0,
    cost: 200,
    requires: [],
    effect: 'Admit what has happened. Everything downstream of this is a way of surviving it.'
  },

  // ─────────────────── Ring 1 — broad, shared, non-committal ───────────────
  {
    id: 'field_stripping',
    name: 'Field Stripping',
    branch: 'core',
    kind: 'behaviour',
    ring: 1,
    row: 1,
    age: 0,
    cost: 400,
    requires: ['collapse'],
    effect: 'Your soldiers go through what they kill. Bodies and wreckage are worth something now.'
  },
  {
    id: 'powder_discipline',
    name: 'Powder Discipline',
    branch: 'core',
    kind: 'behaviour',
    ring: 1,
    row: 4,
    age: 0,
    cost: 400,
    requires: ['collapse'],
    effect: 'Charges packed tighter and seated properly. Your blasts throw everything loose much harder.'
  },
  {
    id: 'old_rites',
    name: 'Old Rites',
    branch: 'core',
    kind: 'behaviour',
    ring: 1,
    row: 7,
    age: 0,
    cost: 400,
    requires: ['collapse'],
    effect: 'Somebody remembered the words. Something on the other end is listening for them.'
  },

  // ── Ring 1 — the drills: one soldier each, one creed's door each ──
  //
  // Cheap, available from the opening minute, and each one is the first step
  // on a creed's road as well as a real change to a unit you already own. They
  // are not exclusive with anything: taking one only means you walked in
  // through that creed's door, not that you closed the others.
  //
  // The first age's counter web is built on these six. Every one of them
  // sharpens an edge that already existed rather than adding a new one —
  // see docs/BUILDINGS_AND_TECH.md.
  {
    id: 'loose_stones',
    name: 'Loose Stones',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 1,
    row: 3,
    age: 0,
    cost: 340,
    requires: ['powder_discipline'],
    effect:
      'Slingers pick their mark one file to either side instead of only helping out when their own is empty. The cross-file price still stands.'
  },
  {
    id: 'mob_rule',
    name: 'Mob Rule',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 1,
    row: 0,
    age: 0,
    cost: 320,
    requires: ['field_stripping'],
    effect: 'Nobody counts the clubmen. They cost a quarter less and come off the pad quicker.'
  },
  {
    id: 'long_hafts',
    name: 'Long Hafts',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 1,
    row: 5,
    age: 0,
    cost: 360,
    requires: ['field_stripping'],
    effect: 'Bone Spearmen get most of a metre more haft, and fight from the second rank over the man in front.'
  },
  {
    id: 'ward_of_bone',
    name: 'Ward of Bone',
    branch: 'occult',
    kind: 'behaviour',
    ring: 1,
    row: 6,
    age: 0,
    cost: 380,
    requires: ['old_rites'],
    effect:
      'A bound ward on every Bonecrusher: it drinks the first 400 of any single blow, refuses to be shoved, and reknits whenever he kills.'
  },
  {
    id: 'spore_touch',
    name: 'Spore Touch',
    branch: 'blight',
    kind: 'behaviour',
    ring: 1,
    row: 8,
    age: 0,
    cost: 340,
    requires: ['old_rites'],
    effect: 'What a Shaman mends keeps mending — a slow knit that runs for nine seconds after his hands leave.'
  },
  {
    id: 'beast_sense',
    name: 'Beast Sense',
    branch: 'core',
    kind: 'behaviour',
    ring: 1,
    row: 10,
    age: 0,
    cost: 340,
    requires: ['field_stripping'],
    effect: 'Raptors read an unguarded gun line one file over and take it, instead of waiting to be let through.'
  },

  // ──────────── Ring 2 — the directions appear, still cross-linked ─────────
  {
    id: 'butchery',
    name: 'Butchery',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 2,
    row: 0,
    age: 0,
    cost: 650,
    requires: ['field_stripping', 'mob_rule'],
    effect: 'Everything your soldiers kill comes apart, however it died. A dismembered body counts DOUBLE toward a Charnel Yard, so taking this is choosing to make the field messier on purpose.'
  },
  {
    id: 'bonepickers',
    name: 'Bonepickers',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 2,
    row: 2,
    age: 1,
    cost: 900,
    requires: ['field_stripping', 'old_rites'],
    effect: 'Your wounded eat the remains they walk over, healing from each piece they consume.'
  },
  {
    id: 'ricochet',
    name: 'Ricochet Rounds',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 2,
    row: 3,
    age: 1,
    cost: 800,
    requires: ['powder_discipline', 'loose_stones'],
    effect: 'Flat shots that strike armour at a shallow angle skip off it and keep going.'
  },
  {
    id: 'salvage',
    name: 'Salvage Crews',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 2,
    row: 5,
    age: 1,
    cost: 750,
    requires: ['field_stripping', 'powder_discipline', 'long_hafts'],
    effect: 'Wreckage that comes to rest on the field is stripped for gold where it lies.'
  },
  {
    id: 'blood_pact',
    name: 'Blood Pact',
    branch: 'occult',
    kind: 'behaviour',
    ring: 2,
    row: 6,
    age: 1,
    cost: 700,
    requires: ['old_rites', 'ward_of_bone'],
    effect: 'Units finish building instantly. The time is taken out of your fortress instead.'
  },
  {
    id: 'spore_cloud',
    name: 'Spore Cloud',
    branch: 'blight',
    kind: 'behaviour',
    ring: 2,
    row: 8,
    age: 1,
    cost: 720,
    requires: ['old_rites', 'spore_touch'],
    effect: 'Your dead burst. What comes out of them settles on the ground and stays there, hostile.'
  },

  // ───────────────── Ring 3 — lineages, one or two parents ─────────────────
  {
    id: 'bone_harvest',
    name: 'Bone Harvest',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 3,
    row: 0,
    age: 1,
    cost: 1000,
    requires: ['butchery'],
    effect: 'Remains lying on your half are picked over for gold, steadily, for as long as they lie there.'
  },
  {
    id: 'bloodlust',
    name: 'Bloodlust',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 3,
    row: 1,
    age: 2,
    cost: 1600,
    requires: ['bonepickers', 'butchery'],
    effect: 'Your soldiers fight faster the more soaked the ground beneath them is.'
  },
  {
    id: 'shrapnel',
    name: 'Shrapnel',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 3,
    row: 3,
    age: 2,
    cost: 2200,
    requires: ['ricochet'],
    effect: 'Your explosions throw fragments. They fly, fall, and wound whatever they reach.'
  },
  {
    id: 'incendiary',
    name: 'Incendiary Loads',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 3,
    row: 4,
    age: 2,
    cost: 1700,
    requires: ['ricochet'],
    effect: 'Your explosions leave the ground burning. Anything standing in it keeps taking damage.'
  },
  {
    id: 'sappers',
    name: 'Sappers',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 3,
    row: 5,
    age: 2,
    cost: 1500,
    requires: ['salvage'],
    effect: 'Your melee troops dig under a stalled front line and come up behind it.'
  },
  {
    id: 'nanite_field',
    name: 'Nanite Field',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 3,
    row: 6,
    age: 2,
    cost: 1300,
    requires: ['salvage'],
    effect: 'Your vehicles, walkers and aircraft repair themselves continuously while they fight.'
  },
  {
    id: 'soul_tithe',
    name: 'Soul Tithe',
    branch: 'occult',
    kind: 'behaviour',
    ring: 3,
    row: 7,
    age: 1,
    cost: 1000,
    requires: ['blood_pact'],
    effect: 'Every enemy that dies anywhere on the field feeds your special ability.'
  },
  {
    id: 'mycelium',
    name: 'Mycelium',
    branch: 'blight',
    kind: 'behaviour',
    ring: 3,
    row: 9,
    age: 1,
    cost: 1000,
    requires: ['spore_cloud'],
    effect: 'Blighted ground creeps outward on its own, a little further every second.'
  },

  // ──────────────── Ring 4 — the first units, one parent each ──────────────
  {
    id: 'flenser_rite',
    name: 'Rite of the Flenser',
    branch: 'carnage',
    kind: 'unit',
    ring: 4,
    row: 0,
    age: 2,
    cost: 1400,
    requires: ['bone_harvest'],
    unlocks: 'nk_flenser',
    effect: 'Fields the Flenser: a butcher who kills in a wide arc and is very hard to push off it.'
  },
  {
    id: 'plague_wind',
    name: 'Plague Wind',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 4,
    row: 1,
    age: 3,
    cost: 2200,
    requires: ['bloodlust'],
    effect: 'Whatever you kill leaves a cloud of contagion behind it that eats at whoever walks in.'
  },
  {
    id: 'overpressure',
    name: 'Overpressure',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 4,
    row: 2,
    age: 3,
    cost: 2000,
    requires: ['shrapnel', 'powder_discipline'],
    effect: 'Blasts stop nudging and start throwing. Soldiers leave the ground and land badly.'
  },
  {
    id: 'cluster',
    name: 'Cluster Shells',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 4,
    row: 3,
    age: 3,
    cost: 2400,
    requires: ['shrapnel'],
    effect: 'Anything you lob splits at the top of its arc into three smaller shells.'
  },
  {
    id: 'torchbearer_doctrine',
    name: 'Torchbearer Doctrine',
    branch: 'ordnance',
    kind: 'unit',
    ring: 4,
    row: 4,
    age: 3,
    cost: 2100,
    requires: ['incendiary'],
    unlocks: 'ch_torchbearer',
    effect: 'Fields the Torchbearer: twin launchers, no interest at all in what stands behind the target.'
  },
  {
    id: 'demolition',
    name: 'Demolition Charges',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 4,
    row: 5,
    age: 3,
    cost: 2200,
    requires: ['sappers'],
    effect: 'Your soldiers die armed. Whatever killed them is standing too close.'
  },
  {
    id: 'drone_forge',
    name: 'Drone Forge',
    branch: 'engineering',
    kind: 'unit',
    ring: 4,
    row: 6,
    age: 3,
    cost: 2000,
    requires: ['nanite_field'],
    unlocks: 'cy_swarmhost',
    effect: 'Fields the Drone Host: walks behind the line reprinting whatever the line has lost.'
  },
  {
    id: 'evil_eye',
    name: 'The Evil Eye',
    branch: 'occult',
    kind: 'behaviour',
    ring: 4,
    row: 7,
    age: 2,
    cost: 1600,
    requires: ['soul_tithe'],
    effect: 'Enemies who watch a comrade die stagger where they stand, briefly and visibly.'
  },
  {
    id: 'sacrament',
    name: 'Sacrament',
    branch: 'occult',
    kind: 'behaviour',
    ring: 4,
    row: 8,
    age: 3,
    cost: 2300,
    requires: ['soul_tithe'],
    effect: 'When one of yours falls, the rest of the line closes up and heals for it.'
  },
  {
    id: 'rooted',
    name: 'Rooted Stance',
    branch: 'blight',
    kind: 'behaviour',
    ring: 4,
    row: 9,
    age: 2,
    cost: 1500,
    requires: ['mycelium'],
    effect: 'A soldier who holds position digs in. The longer it stands, the harder it is to move or hurt.'
  },
  {
    id: 'sporeling_bloom',
    name: 'Sporeling Bloom',
    branch: 'blight',
    kind: 'unit',
    ring: 4,
    row: 10,
    age: 2,
    cost: 1500,
    requires: ['mycelium'],
    unlocks: 'hb_sporeling',
    effect: 'Fields the Sporeling: cheap, quick, regrows its own wounds, and there is always another.'
  },

  // ────────────────── Ring 5 — deep, committed, single-route ───────────────
  {
    id: 'corpse_wall',
    name: 'Corpse Wall',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 5,
    row: 0,
    age: 3,
    cost: 2700,
    requires: ['plague_wind', 'flenser_rite'],
    excludes: ['necropolis'],
    effect: 'The piled dead are terrain: a mound of them soaks a quarter of every shot crossing its file. Pile up enough and the ground itself is holding your line.'
  },
  {
    id: 'penetrator',
    name: 'Penetrators',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 5,
    row: 2,
    age: 4,
    cost: 3800,
    requires: ['overpressure', 'cluster'],
    excludes: ['ashfall'],
    demand: { metric: 'kills', amount: 40, label: 'Kill 40' },
    effect: 'Your shots pass through the first body they hit and carry on into the next.'
  },
  {
    id: 'ashfall',
    name: 'Ashfall',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 5,
    row: 4,
    age: 4,
    cost: 3300,
    requires: ['torchbearer_doctrine'],
    excludes: ['penetrator'],
    effect: 'Fire spreads on its own and burns far longer — and burning ground is a place rather than a wound: anything crossing it is a third slower and cannot aim.'
  },
  {
    id: 'emp',
    name: 'EMP Warheads',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 5,
    row: 5,
    age: 4,
    cost: 3600,
    requires: ['demolition'],
    excludes: ['aegis'],
    effect: 'Energy hits shut machines down. Tanks and walkers stop dead for a few seconds.'
  },
  {
    id: 'autoforge',
    name: 'Autoforge',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 5,
    row: 6,
    age: 3,
    cost: 2500,
    requires: ['drone_forge'],
    effect: 'Turrets destroyed on your fortress rebuild themselves after a pause. You stop paying twice.'
  },
  {
    id: 'aegis',
    name: 'The Lattice',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 5,
    row: 7,
    age: 4,
    cost: 1900,
    requires: ['demolition', 'nanite_field'],
    excludes: ['emp'],
    effect: 'The Lattice: your defensive buildings and turrets carry each other, sharing everything that lands on any of them. The line breaks all at once or not at all.'
  },
  {
    id: 'hexer_pact',
    name: 'Pact of the Hexer',
    branch: 'occult',
    kind: 'unit',
    ring: 5,
    row: 8,
    age: 3,
    cost: 2100,
    requires: ['evil_eye'],
    unlocks: 'dc_hexer',
    effect: 'Fields the Hexer: points at something and it stops being structurally certain. Its blast hits harder for every extra body caught in it — the stated answer to a swarm.'
  },
  {
    id: 'black_sun',
    name: 'Black Sun',
    branch: 'occult',
    kind: 'behaviour',
    ring: 5,
    row: 8,
    age: 3,
    cost: 2800,
    requires: ['evil_eye', 'sacrament'],
    excludes: ['mind_thrall'],
    effect: 'The light goes wrong. Enemy fire scatters badly and their artillery stops landing where it was aimed.'
  },
  {
    id: 'mind_thrall',
    name: 'Mind Thrall',
    branch: 'occult',
    kind: 'behaviour',
    ring: 5,
    row: 9,
    age: 3,
    cost: 2500,
    requires: ['evil_eye', 'sacrament'],
    excludes: ['black_sun'],
    effect: 'Some of what you kill gets back up on your side instead of theirs.'
  },
  {
    id: 'verdant_tide',
    name: 'Verdant Tide',
    branch: 'blight',
    kind: 'behaviour',
    ring: 5,
    row: 10,
    age: 3,
    cost: 2300,
    requires: ['rooted'],
    excludes: ['contagion'],
    effect: 'Your soldiers heal while they stand on ground the blight has taken.'
  },
  {
    id: 'contagion',
    name: 'Contagion',
    branch: 'blight',
    kind: 'behaviour',
    ring: 5,
    row: 11,
    age: 3,
    cost: 2500,
    requires: ['sporeling_bloom', 'mycelium'],
    excludes: ['verdant_tide'],
    effect: 'Anything that dies in your blight bursts too, and passes it on.'
  },

  // ─────────────── Ring 6 — the last node before the rim ──────────────
  {
    id: 'necropolis',
    name: 'Necropolis',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 6,
    row: 0,
    age: 4,
    cost: 3000,
    requires: ['plague_wind', 'bone_harvest'],
    excludes: ['corpse_wall'],
    demand: { metric: 'losses', amount: 25, label: 'Lose 25 of your own' },
    effect: 'Your half of the field raises what has fallen on it. Enough remains, and they get up again.'
  },
  {
    id: 'ninth_seal',
    name: 'The Ninth Seal',
    branch: 'occult',
    kind: 'unit',
    ring: 6,
    row: 9,
    age: 4,
    cost: 4000,
    requires: ['hexer_pact'],
    requiresAny: ['black_sun', 'mind_thrall'],
    unlocks: 'dc_ninthsign',
    effect: 'Fields the Ninth Sign: the last of them that still needs a body to walk around in.'
  },
  {
    id: 'deep_roots',
    name: 'Deep Roots',
    branch: 'blight',
    kind: 'behaviour',
    ring: 6,
    row: 10,
    age: 4,
    cost: 2500,
    requires: ['rooted', 'mycelium'],
    requiresAny: ['verdant_tide', 'contagion'],
    effect: 'Blighted ground answers to you: enemies crossing it are dragged to a crawl.'
  },
  {
    id: 'titan_seed',
    name: 'Titan Seed',
    branch: 'blight',
    kind: 'unit',
    ring: 6,
    row: 11,
    age: 4,
    cost: 4000,
    requires: ['deep_roots'],
    unlocks: 'hb_titanbloom',
    effect: 'The top of the merge ladder: a third amalgamation stops summing and produces a Titan Bloom instead, which throws its own fruiting bodies.'
  },

  // ── Lane doctrines: research that changes how a file is fought ──
  {
    id: 'phalanx_doctrine',
    name: 'Phalanx Doctrine',
    branch: 'core',
    kind: 'behaviour',
    ring: 3,
    row: 1,
    age: 1,
    cost: 900,
    requires: ['drill_yard'],
    effect: 'Braced spears read a charge before it lands. Your phalanx units punish flankers far harder.'
  },
  {
    id: 'passage_of_lines',
    name: 'Passage of Lines',
    branch: 'core',
    kind: 'behaviour',
    ring: 3,
    row: 2,
    age: 1,
    cost: 900,
    requires: ['drill_yard'],
    effect:
      'Shooters open their ranks and let the fighters through. Your melee units walk past friendly ranged troops who have halted to fire, instead of queueing behind them.'
  },
  {
    id: 'pack_tactics',
    name: 'Pack Tactics',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 3,
    row: 10,
    age: 1,
    cost: 950,
    requires: ['butchery'],
    effect: 'Your flankers stop waiting for permission: blocked for a moment, they are already in the next lane.'
  },
  {
    id: 'iron_line',
    name: 'Iron Line',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 4,
    row: 5,
    age: 2,
    cost: 1400,
    requires: ['shieldwall'],
    effect: 'The file holds. Your infantry press harder from the ranks behind, and light fire no longer staggers them.'
  },
  {
    id: 'plunging_volleys',
    name: 'Plunging Volleys',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 4,
    row: 11,
    age: 2,
    cost: 1500,
    requires: ['long_arms'],
    effect: 'Arcing fire drops two lanes over at a third strength. No file is entirely out of your reach.'
  },

  // ───────────────────────── Ring 7 — the rim ─────────────────────────
  {
    id: 'ascend_nekrotics',
    name: 'ASCEND · Nekrotics',
    branch: 'carnage',
    kind: 'ascension',
    ring: 7,
    row: 0,
    age: 4,
    cost: 6000,
    requires: ['flenser_rite'],
    requiresAny: ['necropolis', 'corpse_wall'],
    becomes: 'nekrotics',
    demand: { metric: 'losses', amount: 60, label: 'Lose 60 of your own — the dead are the point' },
    effect: 'Stop burying your dead. Your roster becomes the Nekrotics, and every soldier you lose gets up once, on its own.'
  },
  {
    id: 'ascend_cinder',
    name: 'ASCEND · Cinder Host',
    branch: 'ordnance',
    kind: 'ascension',
    ring: 7,
    row: 3,
    age: 4,
    cost: 6000,
    requires: ['cluster', 'torchbearer_doctrine'],
    requiresAny: ['penetrator', 'ashfall'],
    becomes: 'cinder_host',
    demand: { metric: 'kills', amount: 90, label: 'Kill 90' },
    effect: 'Burn it all to keep warm. Your roster becomes the Cinder Host, and everything you kill sets fire to where it fell.'
  },
  {
    id: 'ascend_cyborgs',
    name: 'ASCEND · Cyborgs',
    branch: 'engineering',
    kind: 'ascension',
    ring: 7,
    row: 6,
    age: 4,
    cost: 6000,
    requires: ['autoforge', 'demolition'],
    requiresAny: ['emp', 'aegis'],
    becomes: 'cyborgs',
    demand: { metric: 'built', amount: 55, label: 'Build 55 units — the foundry never stops' },
    effect: 'Finish the edit. Your roster becomes the Cyborgs: everything repairs itself, and nothing you field can be shut down.'
  },
  {
    id: 'ascend_circle',
    name: 'ASCEND · Dark Circle',
    branch: 'occult',
    kind: 'ascension',
    ring: 7,
    row: 9,
    age: 4,
    cost: 6000,
    requires: ['ninth_seal'],
    becomes: 'dark_circle',
    demand: { metric: 'baseHeld', amount: 65, label: 'Never let your fortress fall below 65%' },
    effect: 'Take your seat. Your roster becomes the Dark Circle: every death feeds you, and the sky stays dark.'
  },
  {
    id: 'ascend_bloom',
    name: 'ASCEND · Hollow Bloom',
    branch: 'blight',
    kind: 'ascension',
    ring: 7,
    row: 11,
    age: 4,
    cost: 6000,
    requires: ['titan_seed'],
    becomes: 'hollow_bloom',
    demand: { metric: 'peakArmy', amount: 16, label: 'Have 16 units on the field at once' },
    effect: 'Let it through. Your roster becomes the Hollow Bloom: your soldiers root where they stand and feed on the ground they have poisoned.'
  }
]


// ─────────────────────────── Stat research ───────────────────────────

/**
 * Compact constructor for the plain multiplier nodes. There are a lot of them
 * and they are all the same shape, so spelling each one out in full would bury
 * the interesting nodes above in boilerplate.
 */
function stat(
  id: string,
  name: string,
  branch: TechBranch,
  ring: number,
  row: number,
  age: number,
  cost: number,
  requires: string[],
  key: StatKey,
  mult: number,
  effect: string
): TechNode {
  return { id, name, branch, kind: 'stat', ring, row, age, cost, requires, stat: { key, mult }, effect }
}

/**
 * The body of the network. Deliberately spread across every ring and given
 * parents in more than one direction, so the web is dense near the root and
 * there is always something worth buying while you decide where to commit.
 */
export const STAT_TECHS: TechNode[] = [
  // Ring 1 — the basics, straight off the root.
  stat('drill_yard', 'Drill Yard', 'core', 1, 0, 0, 320, ['collapse'], 'unitDamage', 1.09, 'Soldiers drilled properly hit harder. Applies to everything you build from now on.'),
  stat('rations', 'Rations', 'core', 1, 2, 0, 320, ['collapse'], 'unitHp', 1.16, 'Fed troops last longer. New arrivals come out of the gate tougher.'),
  stat('foraging', 'Foraging', 'core', 1, 6, 0, 340, ['collapse'], 'income', 1.15, 'Parties sent out between engagements. Gold arrives faster.'),
  stat('quartermaster', 'Quartermaster', 'core', 1, 8, 0, 360, ['collapse'], 'buildSpeed', 1.2, 'Somebody competent is running the queue. Everything is built sooner.'),

  // Ring 2 — still generic, but now reachable through two different parents.
  stat('forge_work', 'Forge Work', 'core', 2, 1, 1, 620, ['drill_yard', 'field_stripping'], 'unitDamage', 1.1, 'Better steel, better edges. Another flat gain to every weapon you field.'),
  stat('shieldwall', 'Shieldwall', 'core', 2, 4, 1, 640, ['rations', 'powder_discipline'], 'toughness', 1.16, 'Trained to stand together. Everything you own takes less from every hit.'),
  stat('spoils', 'Spoils', 'core', 2, 7, 1, 600, ['foraging', 'old_rites'], 'bounty', 1.25, 'What you kill is worth more. Gold and experience both.'),
  stat('long_arms', 'Long Arms', 'core', 2, 9, 1, 660, ['quartermaster', 'powder_discipline'], 'unitRange', 1.12, 'Longer barrels, longer hafts. Your soldiers reach further before they are reached.'),

  // Ring 3 — leanings start to colour them.
  stat('forced_march', 'Forced March', 'core', 3, 2, 1, 900, ['rations', 'quartermaster'], 'unitSpeed', 1.16, 'Nobody stops. Your line arrives before theirs is ready.'),
  stat('deep_stores', 'Deep Stores', 'core', 3, 4, 2, 1100, ['foraging', 'shieldwall'], 'income', 1.2, 'Reserves nobody has found yet. Income again, and it compounds with the last one.'),
  stat('masonry', 'Masonry', 'engineering', 3, 5, 2, 1150, ['salvage', 'shieldwall'], 'baseHp', 1.25, 'The fortress is rebuilt properly. It holds a great deal more punishment.'),
  stat('war_drums', 'War Drums', 'occult', 3, 7, 2, 1050, ['spoils', 'blood_pact'], 'abilityRate', 1.25, 'Something keeps time. Your special ability comes back faster.'),
  stat('honed_edges', 'Honed Edges', 'carnage', 3, 8, 2, 1200, ['forge_work', 'butchery'], 'unitDamage', 1.1, 'Maintained between engagements rather than after them.'),

  // Ring 4 — the expensive middle, where you are already leaning somewhere.
  stat('tempering', 'Tempering', 'core', 4, 8, 2, 1500, ['forge_work'], 'unitHp', 1.2, 'Worked and quenched again. Everything you build survives more.'),
  stat('marksmanship', 'Marksmanship', 'ordnance', 4, 9, 3, 1700, ['long_arms', 'ricochet'], 'unitRange', 1.15, 'Trained to the sight rather than the volume of fire.'),
  stat('levy', 'Levy', 'core', 4, 10, 2, 1450, ['quartermaster', 'deep_stores'], 'buildSpeed', 1.22, 'Conscription. The queue moves whether or not anyone wants it to.'),
  stat('tribute', 'Tribute', 'occult', 4, 11, 3, 1800, ['spoils', 'war_drums'], 'bounty', 1.3, 'Taken from the dead and counted in front of the living.'),
  stat('outriders', 'Outriders', 'core', 4, 12, 3, 1600, ['forced_march'], 'unitSpeed', 1.15, 'Screening elements ahead of the line. Everything moves up faster.'),

  // Ring 5 — heavy, late, and priced like it.
  stat('plate_lines', 'Plate Lines', 'engineering', 5, 3, 3, 2300, ['tempering', 'masonry'], 'toughness', 1.18, 'Standardised plate, produced in quantity for once.'),
  stat('heavy_powder', 'Heavy Powder', 'ordnance', 5, 4, 4, 2600, ['marksmanship', 'shrapnel'], 'unitDamage', 1.12, 'A coarser, angrier mix. Everything you fire hits appreciably harder.'),
  stat('citadel', 'Citadel', 'engineering', 5, 12, 4, 2700, ['masonry'], 'baseHp', 1.3, 'The fortress is now the strongest thing on the field by a distance.'),
  stat('logistics', 'War Logistics', 'core', 5, 13, 4, 2600, ['deep_stores', 'levy'], 'income', 1.25, 'The whole apparatus behind the line finally works.'),
  stat('zeal', 'Zeal', 'occult', 5, 14, 4, 2500, ['war_drums', 'tribute'], 'abilityRate', 1.3, 'They want to use it. Your ability charges faster again.'),

  // Ring 6 — the last stat nodes, alongside the deep behaviours.
  stat('grand_forge', 'Grand Forge', 'core', 6, 3, 4, 3400, ['heavy_powder', 'honed_edges'], 'unitDamage', 1.12, 'Everything your army carries is made in one place now, and made well.'),
  stat('grand_armoury', 'Grand Armoury', 'core', 6, 4, 4, 3400, ['plate_lines', 'tempering'], 'unitHp', 1.22, 'Full kit, issued to everyone, replaced when it fails.'),
  stat('war_economy', 'War Economy', 'core', 6, 12, 4, 3600, ['logistics', 'citadel'], 'income', 1.3, 'Nothing is produced that is not for this. Income one last time.'),
  stat('total_mobilisation', 'Total Mobilisation', 'core', 6, 13, 4, 3600, ['logistics', 'outriders'], 'buildSpeed', 1.28, 'Everyone who can hold something is holding something.')
]


/**
 * The doctrine buildings' gates, and the deep nodes each creed is actually
 * built around.
 *
 * Everything here exists to make a creed's YARD look different rather than just
 * its roster: a Carnage half is a slaughterhouse, an Ordnance half is a gun
 * park, an Engineering half is a laboratory it cannot afford to lose. Kept in
 * one block, after the main tree, because they are the layer that turns the
 * outworks into an identity — see docs/BUILDINGS_AND_TECH.md.
 */
const DOCTRINE_TECHS: TechNode[] = [
  // ───────────────────────────── CARNAGE ─────────────────────────────
  {
    id: 'charnel_rite',
    name: 'Charnel Rite',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 4,
    row: 1,
    age: 2,
    cost: 1900,
    requires: ['bone_harvest'],
    excludes: ['ossuary_rite'],
    effect: 'Lets you raise a Charnel Yard. The Tide and the Risen are two readings of the same creed and you may only hold one.'
  },
  {
    id: 'ossuary_rite',
    name: 'Ossuary Rite',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 5,
    row: 1,
    age: 3,
    cost: 2900,
    requires: ['necropolis'],
    excludes: ['charnel_rite'],
    effect: 'Lets you raise an Ossuary. Bodies stop being litter and start being savings.'
  },
  {
    id: 'the_hunger',
    name: 'The Hunger',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 5,
    row: 2,
    age: 3,
    cost: 3100,
    requires: ['bloodlust'],
    effect: 'As your own army thins, what is left of it gets faster and hits harder — up to half again as fast once you are down to nothing.'
  },
  {
    id: 'the_butcher',
    name: 'The Butcher',
    branch: 'carnage',
    kind: 'unit',
    ring: 6,
    row: 1,
    age: 4,
    cost: 5200,
    requires: ['flenser_rite'],
    unlocks: 'nk_butcher',
    effect: 'A champion that never stops growing: every kill is permanent damage and health, with no ceiling, and you can watch it happen.'
  },

  // ──────────────────────────── ORDNANCE ─────────────────────────────
  {
    id: 'gun_line',
    name: 'Gun Line',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 3,
    row: 3,
    age: 2,
    cost: 1300,
    requires: ['powder_discipline'],
    effect: 'Shooters in the same file steady each other: +8% damage for every friendly gun beside them, up to +64%. Stack a lane or do not bother.'
  },
  {
    id: 'emplacement',
    name: 'Emplacement',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 4,
    row: 3,
    age: 2,
    cost: 2000,
    requires: ['shrapnel'],
    effect: 'Lets you raise a Battery — artillery that is architecture rather than a soldier, and cannot be moved once it is poured.'
  },
  {
    id: 'forward_magazine',
    name: 'Forward Magazine',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 4,
    row: 4,
    age: 3,
    cost: 2400,
    requires: ['overpressure'],
    effect: 'The Magazine may stand out in FRONT of the gate, and goes up twice as hard when it goes. A liability you site deliberately.'
  },
  {
    id: 'counter_battery',
    name: 'Counter-Battery',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 5,
    row: 3,
    age: 3,
    cost: 3300,
    requires: ['emplacement'],
    effect: 'Your batteries shoot at their buildings before their soldiers. The answer to a mirror match.'
  },

  // ─────────────────────────── ENGINEERING ───────────────────────────
  {
    id: 'field_lab',
    name: 'Field Laboratory',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 3,
    row: 5,
    age: 1,
    cost: 1200,
    requires: ['salvage'],
    effect: 'Lets you raise a Research Hall. Knowledge stops being a side effect of the yard and becomes the point of it.'
  },
  {
    id: 'forward_doctrine',
    name: 'Forward Doctrine',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 4,
    row: 5,
    age: 2,
    cost: 2200,
    requires: ['field_lab'],
    effect: 'A Research Hall on a FRONT plot produces double instead of half again. Put the most precious thing you own where everyone can reach it.'
  },
  {
    id: 'perpetual_engine',
    name: 'Perpetual Engine',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 7,
    row: 5,
    age: 4,
    cost: 7000,
    requires: ['field_lab'],
    requiresAny: ['ascend_cyborgs'],
    effect: 'Every Research Hall you still hold makes your whole army permanently better, every twenty seconds, forever. This is why Engineering runs at ascension.'
  },

  // ──────────────────────────── THE OCCULT ───────────────────────────
  {
    id: 'binding_circle',
    name: 'Binding Circle',
    branch: 'occult',
    kind: 'behaviour',
    ring: 4,
    row: 7,
    age: 2,
    cost: 2300,
    requires: ['sacrament'],
    effect: 'Lets you draw a Summoning Circle. It takes time, it consumes itself, and everyone on the field can see how far along it is.'
  },
  {
    id: 'the_ninth_hour',
    name: 'The Ninth Hour',
    branch: 'occult',
    kind: 'behaviour',
    ring: 7,
    row: 7,
    age: 4,
    cost: 7600,
    requires: ['binding_circle'],
    requiresAny: ['ascend_circle'],
    effect: 'Lets you begin the Great Rite: five minutes, in the open, and if it finishes you have won. There is no second one.'
  },

  // ────────────────────────────── BLIGHT ─────────────────────────────
  {
    id: 'spawning_rite',
    name: 'Spawning Rite',
    branch: 'blight',
    kind: 'behaviour',
    ring: 3,
    row: 9,
    age: 1,
    cost: 1100,
    requires: ['spore_cloud'],
    effect: 'Lets you dig a Spawning Pool. It produces on its own, forever, and it does not ask what you can afford.'
  },
  {
    id: 'amalgamation',
    name: 'Amalgamation',
    branch: 'blight',
    kind: 'behaviour',
    ring: 4,
    row: 9,
    age: 2,
    cost: 2100,
    requires: ['sporeling_bloom'],
    effect: 'Three of your growths that touch become one thing with all their health and half again their damage. What it becomes can merge again.'
  },
  {
    id: 'the_spread',
    name: 'The Spread',
    branch: 'blight',
    kind: 'behaviour',
    ring: 5,
    row: 9,
    age: 3,
    cost: 3200,
    requires: ['verdant_tide'],
    effect: 'Your blight crawls toward their fortress by itself and eats at it when it arrives. Slow, unstoppable, and visible from the first second.'
  }
]

TECHS.push(...DOCTRINE_TECHS)

TECHS.push(...STAT_TECHS)

export const TECHS_BY_ID: Record<string, TechNode> = Object.fromEntries(TECHS.map(t => [t.id, t]))

/** Nodes at one distance from the root. */
export function ringTechs(ring: number): TechNode[] {
  return TECHS.filter(t => t.ring === ring).sort((a, b) => a.row - b.row)
}

/** How many rings deep the network runs. */
export const MAX_RING = TECHS.reduce((n, t) => Math.max(n, t.ring), 0)

/** How many rows tall it is, for layout. */
export const MAX_ROW = TECHS.reduce((n, t) => Math.max(n, t.row), 0)

/** Nodes leaning a given way, in research order. */
export function branchTechs(branch: TechBranch): TechNode[] {
  return TECHS.filter(t => t.branch === branch).sort((a, b) => a.ring - b.ring || a.row - b.row)
}

/**
 * Everything that must be owned to reach a node, the node included, in the
 * order it has to be bought.
 *
 * The network has multi-parent nodes and shared `core` ancestors, so "the
 * carnage branch" is not a list you can filter by branch — the road to the
 * nekrotic ascension runs through nodes that belong to nobody. This walks the
 * requirement graph backwards instead, which is what both the AI and any
 * "research path" hint actually need.
 */
export function lineageFor(id: TechId, prefer: TechId[] = []): TechNode[] {
  const seen = new Set<TechId>()
  const out: TechNode[] = []
  const visit = (nodeId: TechId): void => {
    if (seen.has(nodeId)) return
    seen.add(nodeId)
    const node = TECHS_BY_ID[nodeId]
    if (!node) return
    for (const parent of node.requires) visit(parent)
    // A fork takes exactly one arm: an oath that swore both ways would be no
    // oath at all, and a road that lists both would tell the AI to buy a node
    // it can never own. `prefer` lets a caller choose which arm; otherwise the
    // first authored one wins, which keeps this deterministic across peers.
    if (node.requiresAny && node.requiresAny.length > 0) {
      const arm = node.requiresAny.find(a => prefer.includes(a)) ?? node.requiresAny[0]
      visit(arm)
    }
    out.push(node)
  }
  visit(id)
  // Post-order already respects prerequisites; the ring sort only makes the
  // result read in the order a player would actually buy it.
  return out.sort((a, b) => a.ring - b.ring)
}

/** The ascension node a creed ends at, if it has one. */
export function ascensionFor(branch: TechBranch): TechNode | undefined {
  return TECHS.find(t => t.kind === 'ascension' && t.branch === branch)
}

/** Stable order, used to pack an army's owned techs into the state hash. */
export const TECH_ORDER: string[] = TECHS.map(t => t.id)

/**
 * Oaths, resolved both ways.
 *
 * Exclusion is authored on one arm or both; a commander does not care which
 * way round it was written down, so it is normalised here into a symmetric
 * map. Everything else in the game asks this, never the raw field.
 */
export const OATHS: Record<TechId, TechId[]> = (() => {
  const map: Record<TechId, Set<TechId>> = {}
  const tie = (a: TechId, b: TechId): void => {
    ;(map[a] ??= new Set()).add(b)
    ;(map[b] ??= new Set()).add(a)
  }
  for (const node of TECHS) for (const other of node.excludes ?? []) tie(node.id, other)
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v].sort()]))
})()

/** The node an oath forbids once this one is taken, or null if it is free. */
export function oathRivals(id: TechId): TechNode[] {
  return (OATHS[id] ?? []).map(other => TECHS_BY_ID[other]).filter(Boolean)
}

/** Every unit id any research node can put into a roster. */
export const UNLOCKABLE_UNIT_IDS: string[] = TECHS.filter(t => t.unlocks).map(t => t.unlocks as string)
