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
  /** Explicit visual weight. Carnage uses this to separate defining rites from support research. */
  prominence?: 'minor' | 'notable' | 'keystone'
  /** Optional thematic lane shown as a section label in the graph. */
  cluster?: string
  /** Distance from the root. Drives layout and, loosely, cost. */
  ring: number
  /**
   * Vertical slot. Layout only — nothing in the simulation reads it.
   *
   * Every creed owns a contiguous BAND of rows, sized to its widest ring, with
   * one blank row between bands:
   *
   *   carnage 0–6 · ordnance 8–14 · core 16–23 · engineering 25–29 ·
   *   occult 31–34 · blight 36–38
   *
   * This used to be aspirational rather than true. The rows were hand-picked one
   * node at a time and had drifted badly: nineteen nodes sat in somebody else's
   * band — a core income node inside carnage, an engineering node inside
   * ordnance — and seven pairs shared a slot outright, which the view papered
   * over by pushing the loser down into whatever row happened to be free. The
   * result was a graph you could only read by tracing each link with a finger.
   *
   * Two rules keep it readable, and `scratchpad/treeorder.mjs` enforces both:
   *
   *  1. **No two nodes share a ring and a row.** A collision is not a layout
   *     nicety, it is two nodes drawn on top of each other.
   *  2. **A node's row is inside its own creed's band.** If a ring outgrows the
   *     band, widen that band and shift the ones below it — never borrow a row
   *     from the neighbour.
   *
   * Within a band, keep a chain on one row: carnage row 0 is the spine
   * (Butchery → Bone Harvest → Flenser Rite → Corpse Wall → Necropolis → the
   * Maw), row 3 is the harvest ladder, row 4 is the mind line.
   */
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
  /**
   * This node does not count as LEANING toward its branch.
   *
   * The machine doctrines are filed under whichever creed would plausibly have
   * built the thing, but a tank is nobody's religion. Without this, buying the
   * siege train and an armoured corps made an army two nodes deep in ordnance
   * and two in engineering, and the roster consolidated at age 4 around a creed
   * the commander had never chosen — it came back holding nothing but Cyborgs.
   */
  noLean?: boolean
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
    row: 16,
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
    row: 20,
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
    row: 21,
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
    row: 22,
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
    row: 8,
    age: 0,
    cost: 340,
    requires: ['powder_discipline'],
    effect:
      'Slingers stop throwing only at what is in front of them. With their own file clear they loose into the one next door, at the cross-file price.'
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
    row: 25,
    age: 0,
    cost: 360,
    requires: ['field_stripping'],
    effect: 'Bone Spearmen get most of a metre more haft. Only a front rank can bring a weapon to bear — these fight from the second, over the one man in front of them.'
  },
  {
    id: 'ward_of_bone',
    name: 'Ward of Bone',
    branch: 'occult',
    kind: 'behaviour',
    ring: 1,
    row: 31,
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
    row: 36,
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
    row: 23,
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
    effect: 'Your soldiers land ten points more critical hits, and anything a critical FINISHES comes apart completely — however small the blow was. A dismembered body counts DOUBLE toward a Charnel Yard, so taking this is choosing to make the field messier on purpose.'
  },
  {
    id: 'bonepickers',
    name: 'Bonepickers',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 2,
    row: 1,
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
    row: 8,
    age: 1,
    cost: 800,
    requires: ['powder_discipline', 'loose_stones'],
    effect: 'Flat shots that strike armour at a shallow angle skip off it and keep going.'
  },
  {
    // ── MACHINE DOCTRINE ─ nobody starts an age already owning one of these ──
    //
    // Five nodes, and between them they hold every siege engine, rocket, tank,
    // walker, aircraft and Titan in the game. Until one is finished its slot on
    // the command bar is simply EMPTY — which is the whole point: an empty slot
    // is room for a creed to put its own answer there. See `data/lines.ts`.
    id: 'siege_train',
    name: 'The Siege Train',
    branch: 'ordnance',
    kind: 'unit',
    ring: 2,
    row: 9,
    age: 1,
    cost: 900,
    requires: ['powder_discipline'],
    noLean: true,
    effect:
      'Raise a train: teamsters, timber, and men who know how far a stone falls. The siege slot fills, and refills with the age — catapult, then cannon, then mortar, then a walker with a rail down its spine.'
  },
  {
    id: 'salvage',
    name: 'Salvage Crews',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 2,
    row: 25,
    age: 1,
    cost: 750,
    requires: ['field_stripping', 'powder_discipline', 'long_hafts'],
    effect: 'Wreckage that comes to rest on the field is stripped for gold where it lies.'
  },
  {
    id: 'armoured_corps',
    name: 'Armoured Corps',
    branch: 'engineering',
    kind: 'unit',
    ring: 2,
    row: 26,
    age: 2,
    cost: 1200,
    requires: ['salvage'],
    noLean: true,
    effect:
      'Stop stripping the wrecks and start building them. The armour slot fills the moment you have an age to field it in: a tank first, and a walking gun after that.'
  },
  {
    id: 'blood_pact',
    name: 'Blood Pact',
    branch: 'occult',
    kind: 'behaviour',
    ring: 2,
    row: 31,
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
    row: 36,
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
    effect: 'Five small crooked things come out of your yard, one to a lane. They crouch over what is lying on your half, fill a sack, and carry it home for gold. They do not fight, they run when struck, and they are slow to replace.'
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
    row: 9,
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
    row: 10,
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
    row: 27,
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
    row: 28,
    age: 2,
    cost: 1300,
    requires: ['salvage'],
    effect: 'Your vehicles, walkers and aircraft repair themselves continuously while they fight.'
  },
  {
    id: 'shaped_charges',
    name: 'Shaped Charges',
    branch: 'ordnance',
    kind: 'unit',
    ring: 3,
    row: 11,
    age: 3,
    cost: 1900,
    requires: ['siege_train', 'shrapnel'],
    noLean: true,
    effect:
      'A charge that throws its blast forward instead of everywhere. Small enough for one man to carry, which is how a rocket team happens.'
  },
  {
    id: 'rotary_wing',
    name: 'Rotary Wing',
    branch: 'engineering',
    kind: 'unit',
    ring: 3,
    row: 29,
    age: 3,
    cost: 2000,
    requires: ['armoured_corps', 'nanite_field'],
    noLean: true,
    effect:
      'Get off the ground. Nothing in a lane can answer a thing that is above the lane — the air slot fills with a gunship, and later with the swarm that replaces its crew.'
  },
  {
    id: 'soul_tithe',
    name: 'Soul Tithe',
    branch: 'occult',
    kind: 'behaviour',
    ring: 3,
    row: 32,
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
    row: 36,
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
    row: 8,
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
    row: 9,
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
    row: 12,
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
    row: 25,
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
    row: 28,
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
    row: 33,
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
    row: 34,
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
    row: 37,
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
    row: 38,
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
    row: 9,
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
    row: 11,
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
    row: 26,
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
    row: 27,
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
    row: 28,
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
    row: 33,
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
    row: 32,
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
    row: 34,
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
    row: 37,
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
    row: 38,
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
    id: 'titan_program',
    name: 'The Titan Program',
    branch: 'engineering',
    kind: 'unit',
    ring: 6,
    row: 25,
    age: 4,
    cost: 4600,
    requires: ['armoured_corps', 'aegis'],
    noLean: true,
    effect:
      'One machine, and a field around it. Nobody is handed a Titan for surviving into the last age — you build the corps, you learn to hold a shield up, and then you build the thing.'
  },
  {
    id: 'ninth_seal',
    name: 'The Ninth Seal',
    branch: 'occult',
    kind: 'unit',
    ring: 6,
    row: 31,
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
    row: 36,
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
    row: 37,
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
    row: 18,
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
    row: 19,
    age: 1,
    cost: 900,
    requires: ['drill_yard'],
    effect:
      'Shooters open their ranks and let the fighters through. Your melee units walk past friendly ranged troops who have halted to fire, instead of queueing behind them.'
  },
  {
    // ─────────────── The age-four bodies are EARNED, not inherited ───────────
    //
    // Leaning carnage used to hand you the whole last age the moment you got
    // there. These four are the creed's identity, so each one is a node: the bar
    // at age four is what you researched toward, not what the lean gave you.
    id: 'flesh_architecture',
    name: 'Flesh Architecture',
    branch: 'carnage',
    kind: 'unit',
    ring: 6,
    row: 2,
    age: 4,
    cost: 3200,
    requires: ['corpse_wall'],
    unlocks: 'nk_fleshwall',
    effect: 'Grow a Flesh Wall: three files of architecture that knits itself back together out of whatever is lying near it.'
  },
  {
    id: 'the_hunger_made_flesh',
    name: 'The Hunger Made Flesh',
    branch: 'carnage',
    kind: 'unit',
    ring: 6,
    row: 1,
    age: 3,
    cost: 3000,
    requires: ['bone_levy'],
    unlocks: 'nk_monstrum',
    effect: 'Fields the Monstrum: it eats what it walks over and KEEPS it, with no ceiling. Bought into a clean field it is a mediocre elite; walked across a slaughter it ends the match.'
  },
  {
    id: 'the_maw',
    name: 'The Great Maw',
    branch: 'carnage',
    kind: 'unit',
    ring: 7,
    row: 0,
    age: 4,
    cost: 4400,
    requires: ['the_hunger_made_flesh'],
    unlocks: 'nk_maw',
    effect: 'A mouth on legs. It drags what it reaches toward itself instead of shoving it away, and whatever dies in it is rendered onto YOUR ground wherever the body was standing.'
  },
  {
    id: 'incarnation_rite',
    name: 'The Incarnation of Slaughter',
    branch: 'carnage',
    kind: 'unit',
    ring: 7,
    row: 2,
    age: 4,
    cost: 5000,
    requires: ['necropolis'],
    unlocks: 'nk_incarnation',
    demand: { metric: 'kills', amount: 120, label: 'Kill 120 — it only answers a slaughter' },
    effect: 'A standing offer you pay into. Every half minute it takes the best melee body on the board — whoever owns it — and raises a demon-lord where it stood.'
  },
  {
    id: 'clean_kills',
    name: 'Clean Kills',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 4,
    row: 3,
    age: 2,
    cost: 1800,
    requires: ['bone_harvest'],
    effect: 'Kill it without ruining it. A spear, a bolt or a beam now leaves an EXTRA skull, and your gatherers start carrying heads home to be read rather than sold. Clubs and shells still leave nothing worth reading.'
  },
  {
    id: 'bone_levy',
    name: 'The Bone Levy',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 5,
    row: 3,
    age: 3,
    cost: 2600,
    requires: ['clean_kills'],
    effect: 'Frames carried home are stacked, and four of them stand up as a Boneling and walk out on their own. Bone comes off what you kill cleanly and off what you kill in armour — and unlike meat, bone keeps.'
  },
  {
    id: 'death_throes',
    name: 'Death Throes',
    branch: 'carnage',
    kind: 'behaviour',
    ring: 3,
    row: 2,
    age: 1,
    cost: 950,
    requires: ['butchery'],
    effect: 'Nobody here is told when they have died. Killed by anything short of an obliterating blow, your soldier keeps swinging for two more seconds at DOUBLE speed — short a limb or two, and emptying onto the ground as it goes. Take both arms off it and all it can do is stagger about bleeding.'
  },
  {
    id: 'iron_line',
    name: 'Iron Line',
    branch: 'engineering',
    kind: 'behaviour',
    ring: 4,
    row: 27,
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
    row: 14,
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
    row: 1,
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
    row: 8,
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
    row: 26,
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
    row: 32,
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
    row: 36,
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
  stat('drill_yard', 'Drill Yard', 'core', 1, 16, 0, 320, ['collapse'], 'unitDamage', 1.09, 'Soldiers drilled properly hit harder. Applies to everything you build from now on.'),
  stat('rations', 'Rations', 'core', 1, 17, 0, 320, ['collapse'], 'unitHp', 1.16, 'Fed troops last longer. New arrivals come out of the gate tougher.'),
  stat('foraging', 'Foraging', 'core', 1, 18, 0, 340, ['collapse'], 'income', 1.15, 'Parties sent out between engagements. Gold arrives faster.'),
  stat('quartermaster', 'Quartermaster', 'core', 1, 19, 0, 360, ['collapse'], 'buildSpeed', 1.2, 'Somebody competent is running the queue. Everything is built sooner.'),

  // Ring 2 — still generic, but now reachable through two different parents.
  stat('forge_work', 'Forge Work', 'core', 2, 16, 1, 620, ['drill_yard', 'field_stripping'], 'unitDamage', 1.1, 'Better steel, better edges. Another flat gain to every weapon you field.'),
  stat('shieldwall', 'Shieldwall', 'core', 2, 17, 1, 640, ['rations', 'powder_discipline'], 'toughness', 1.16, 'Trained to stand together. Everything you own takes less from every hit.'),
  stat('spoils', 'Spoils', 'core', 2, 18, 1, 600, ['foraging', 'old_rites'], 'bounty', 1.25, 'What you kill is worth more. Gold and experience both.'),
  stat('long_arms', 'Long Arms', 'core', 2, 19, 1, 660, ['quartermaster', 'powder_discipline'], 'unitRange', 1.12, 'Longer barrels, longer hafts. Your soldiers reach further before they are reached.'),

  // Ring 3 — leanings start to colour them.
  stat('forced_march', 'Forced March', 'core', 3, 16, 1, 900, ['rations', 'quartermaster'], 'unitSpeed', 1.16, 'Nobody stops. Your line arrives before theirs is ready.'),
  stat('deep_stores', 'Deep Stores', 'core', 3, 17, 2, 1100, ['foraging', 'shieldwall'], 'income', 1.2, 'Reserves nobody has found yet. Income again, and it compounds with the last one.'),
  stat('masonry', 'Masonry', 'engineering', 3, 25, 2, 1150, ['salvage', 'shieldwall'], 'baseHp', 1.25, 'The fortress is rebuilt properly. It holds a great deal more punishment.'),
  stat('war_drums', 'War Drums', 'occult', 3, 31, 2, 1050, ['spoils', 'blood_pact'], 'abilityRate', 1.25, 'Something keeps time. Your special ability comes back faster.'),
  stat('honed_edges', 'Honed Edges', 'carnage', 3, 6, 2, 1200, ['forge_work', 'butchery'], 'unitDamage', 1.1, 'Maintained between engagements rather than after them.'),

  // Ring 4 — the expensive middle, where you are already leaning somewhere.
  stat('tempering', 'Tempering', 'core', 4, 16, 2, 1500, ['forge_work'], 'unitHp', 1.2, 'Worked and quenched again. Everything you build survives more.'),
  stat('marksmanship', 'Marksmanship', 'ordnance', 4, 13, 3, 1700, ['long_arms', 'ricochet'], 'unitRange', 1.15, 'Trained to the sight rather than the volume of fire.'),
  stat('levy', 'Levy', 'core', 4, 17, 2, 1450, ['quartermaster', 'deep_stores'], 'buildSpeed', 1.22, 'Conscription. The queue moves whether or not anyone wants it to.'),
  stat('tribute', 'Tribute', 'occult', 4, 31, 3, 1800, ['spoils', 'war_drums'], 'bounty', 1.3, 'Taken from the dead and counted in front of the living.'),
  stat('outriders', 'Outriders', 'core', 4, 18, 3, 1600, ['forced_march'], 'unitSpeed', 1.15, 'Screening elements ahead of the line. Everything moves up faster.'),

  // Ring 5 — heavy, late, and priced like it.
  stat('plate_lines', 'Plate Lines', 'engineering', 5, 29, 3, 2300, ['tempering', 'masonry'], 'toughness', 1.18, 'Standardised plate, produced in quantity for once.'),
  stat('heavy_powder', 'Heavy Powder', 'ordnance', 5, 8, 4, 2600, ['marksmanship', 'shrapnel'], 'unitDamage', 1.12, 'A coarser, angrier mix. Everything you fire hits appreciably harder.'),
  stat('citadel', 'Citadel', 'engineering', 5, 25, 4, 2700, ['masonry'], 'baseHp', 1.3, 'The fortress is now the strongest thing on the field by a distance.'),
  stat('logistics', 'War Logistics', 'core', 5, 16, 4, 2600, ['deep_stores', 'levy'], 'income', 1.25, 'The whole apparatus behind the line finally works.'),
  stat('zeal', 'Zeal', 'occult', 5, 31, 4, 2500, ['war_drums', 'tribute'], 'abilityRate', 1.3, 'They want to use it. Your ability charges faster again.'),

  // Ring 6 — the last stat nodes, alongside the deep behaviours.
  stat('grand_forge', 'Grand Forge', 'core', 6, 19, 4, 3400, ['heavy_powder', 'honed_edges'], 'unitDamage', 1.12, 'Everything your army carries is made in one place now, and made well.'),
  stat('grand_armoury', 'Grand Armoury', 'core', 6, 16, 4, 3400, ['plate_lines', 'tempering'], 'unitHp', 1.22, 'Full kit, issued to everyone, replaced when it fails.'),
  stat('war_economy', 'War Economy', 'core', 6, 17, 4, 3600, ['logistics', 'citadel'], 'income', 1.3, 'Nothing is produced that is not for this. Income one last time.'),
  stat('total_mobilisation', 'Total Mobilisation', 'core', 6, 18, 4, 3600, ['logistics', 'outriders'], 'buildSpeed', 1.28, 'Everyone who can hold something is holding something.')
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
    row: 2,
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
    // Ring 7 and age 4, not ring 5 and age 3. It requires Necropolis, which is
    // ring 6 and age 4, so the old numbers put a node BEFORE its own
    // prerequisite: the tree drew an arrow pointing backwards down the rings and
    // the age-3 gate on it could never be the binding one.
    ring: 7,
    row: 6,
    age: 4,
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
    row: 1,
    age: 3,
    cost: 3100,
    requires: ['bloodlust'],
    effect: 'While you are outnumbered on the field, what is left of your line fights faster and harder — up to half again at three to one against.'
  },
  {
    id: 'the_butcher',
    name: 'The Butcher',
    branch: 'carnage',
    kind: 'unit',
    ring: 5,
    row: 2,
    age: 3,
    cost: 2400,
    requires: ['flenser_rite'],
    unlocks: 'nk_butcher',
    // Was describing the Monstrum, which a different node fields.
    effect:
      'The Butcher of the Yard takes the Flenser’s place on the bar. Bigger, slower, and it drinks two fifths of every wound it opens — starving it is the only argument it hears.'
  },
  {
    // ─────────────── THE CARNAGE MUTATIONS ─ seven line changes ───────────────
    //
    // A tier bump is free with the age. These are the OTHER kind: a different
    // body doing a different thing, and each one takes over a slot from the rung
    // below it rather than being added beside it. Nothing here lengthens the bar.
    id: 'brain_thieves',
    name: 'Brain Thieves',
    branch: 'carnage',
    kind: 'unit',
    ring: 3,
    row: 4,
    age: 2,
    cost: 1500,
    requires: ['bonepickers'],
    unlocks: 'nk_brainstealer',
    effect:
      'Opens the mind slot with a Brain Stealer, and the creed stops having to kill a thing to learn from it. What it throws climbs, piles up, and walks the head home.'
  },
  {
    id: 'mind_flayers',
    name: 'Mind Flayers',
    branch: 'carnage',
    kind: 'unit',
    ring: 6,
    row: 4,
    age: 4,
    cost: 4000,
    requires: ['brain_thieves', 'bone_levy'],
    unlocks: 'nk_mindflayer',
    effect:
      'The Mind Flayer takes the Brood Nurse’s place. It stops throwing them: everything hostile standing near it is already carrying them.'
  },
  {
    id: 'skinriders',
    name: 'Skinriders',
    branch: 'carnage',
    kind: 'unit',
    ring: 6,
    row: 5,
    age: 4,
    cost: 3400,
    requires: ['the_hunger'],
    unlocks: 'nk_skinrider',
    effect:
      'The Skinrider takes the Ripjaw’s place in the flank slot. It lands on the biggest thing in the file and stays there, and while it is being worn that thing cannot swing.'
  },
  {
    id: 'flensing_hosts',
    name: 'Flensing Hosts',
    branch: 'carnage',
    kind: 'unit',
    ring: 6,
    row: 3,
    age: 4,
    cost: 3800,
    requires: ['the_butcher'],
    unlocks: 'nk_flensing_host',
    effect:
      'The Butcher becomes a Host: three lesser ones sharing one nervous system, so a kill by any of them quickens all three.'
  },
  {
    id: 'headsman_rite',
    name: 'Rite of the Headsman',
    branch: 'carnage',
    kind: 'unit',
    ring: 7,
    row: 3,
    age: 4,
    cost: 4200,
    requires: ['bone_levy'],
    unlocks: 'nk_headsman',
    effect:
      'The Headsman takes the Shrike’s place. Anything under the line is finished outright rather than fought, and the file watches it happen and flinches.'
  },
  {
    id: 'charnel_engine',
    name: 'The Charnel Engine',
    branch: 'carnage',
    kind: 'unit',
    ring: 7,
    row: 4,
    age: 4,
    cost: 4400,
    requires: ['bone_levy'],
    // Either arm of the oath gets it: one reads the field as a wall, the other
    // as a workforce, and a mill serves both readings.
    requiresAny: ['necropolis', 'corpse_wall'],
    unlocks: 'nk_charnel_engine',
    effect:
      'The Choir becomes an Engine. It does not wait to be asked — it mills your half of the field continuously, faster than the field can rot, and what comes out walks forward.'
  },
  {
    id: 'widow_queen',
    name: 'The Widow Queen',
    branch: 'carnage',
    kind: 'unit',
    ring: 7,
    row: 5,
    age: 4,
    cost: 4600,
    requires: ['the_hunger', 'plague_wind'],
    unlocks: 'nk_widow_queen',
    effect:
      'The Widow stops feeding on what it kills and starts laying in it. Every kill leaves an egg where the body fell, and what climbs out of the egg walks forward.'
  },

  // ──────────────────────────── ORDNANCE ─────────────────────────────
  {
    id: 'gun_line',
    name: 'Gun Line',
    branch: 'ordnance',
    kind: 'behaviour',
    ring: 3,
    row: 8,
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
    row: 10,
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
    row: 11,
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
    row: 10,
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
    row: 26,
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
    row: 26,
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
    row: 25,
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
    row: 32,
    // Age 3, not 2. It requires Sacrament, which is age 3 — so the age-2 gate on
    // it could never be the binding one, and the card advertised an availability
    // it did not have.
    age: 3,
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
    row: 31,
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
    row: 37,
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
    row: 36,
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
    row: 36,
    age: 3,
    cost: 3200,
    requires: ['verdant_tide'],
    effect: 'Your blight crawls toward their fortress by itself and eats at it when it arrives. Slow, unstoppable, and visible from the first second.'
  }
]

const CARNAGE_ROSTER_TECHS: TechNode[] = [
  {
    id: 'ripjaw_brood',
    name: 'Predatory Glands',
    branch: 'carnage',
    kind: 'unit',
    ring: 3,
    row: 4,
    age: 2,
    cost: 1650,
    requires: ['butchery'],
    unlocks: 'nk_ripjaw',
    effect: 'The Cuirassier slot becomes Ripjaw. It becomes Ripjaw Alpha with age three and never returns to a human cavalry line.'
  },
  {
    id: 'carrion_choir',
    name: 'Choir of Ruin',
    branch: 'carnage',
    kind: 'unit',
    ring: 5,
    row: 11,
    age: 3,
    cost: 2400,
    requires: ['charnel_rite'],
    unlocks: 'nk_carrion',
    effect: 'The medic slot becomes Carrion Choir. Every corpse-support improvement already owned continues to apply to the Choir and its Engine.'
  },
  {
    id: 'shrike_rite',
    name: 'Shrike Brood',
    branch: 'carnage',
    kind: 'unit',
    ring: 4,
    row: 5,
    age: 3,
    cost: 2400,
    requires: ['flenser_rite'],
    unlocks: 'nk_shrike',
    effect: 'The disabled rocket slot becomes Shrike: a living execution weapon with no launcher, ammunition or firearm.'
  },
  {
    id: 'widow_hatchery',
    name: 'Widow Hatchery',
    branch: 'carnage',
    kind: 'unit',
    ring: 4,
    row: 14,
    age: 3,
    cost: 2800,
    requires: ['plague_wind'],
    unlocks: 'nk_widow',
    effect: 'The disabled aircraft slot becomes Carrion Widow, the faction’s organic answer to the sky.'
  }
]

TECHS.push(...DOCTRINE_TECHS)
TECHS.push(...CARNAGE_ROSTER_TECHS)
TECHS.push(...STAT_TECHS)

/** Labelled lanes in the widened Carnage band. */
export const CARNAGE_CLUSTERS = [
  { name: 'SWARM & CORRUPTION', row: 0 },
  { name: 'PREDATORS & ASSAULT', row: 3 },
  { name: 'PARASITES & RANGED', row: 7 },
  { name: 'FLESHCRAFT SUPPORT', row: 9 },
  { name: 'MONSTROSITIES & CAPSTONES', row: 14 }
] as const

/**
 * Carnage is the first creed authored as a deliberately readable sub-tree.
 * The literals above retain history; this table is the canonical presentation
 * and balance pass. Every chain stays on one row after it branches, so no two
 * Carnage links need to cross to explain progression.
 */
const CARNAGE_REWORK: Record<string, Partial<TechNode>> = {
  mob_rule: {
    ring: 1, row: 0, age: 0, cost: 320, prominence: 'minor', cluster: 'Swarm & Corruption',
    effect: 'Clubmen train cheaper and faster. A small opening improvement, not yet a roster commitment.'
  },
  butchery: {
    ring: 2, row: 0, age: 0, cost: 1000, prominence: 'keystone', cluster: 'Swarm & Corruption',
    requires: ['field_stripping', 'mob_rule'],
    effect: 'Commit to Carnage. Early humans become corrupted; conventional siege, rockets, armour, aircraft and Titan research closes. Every Carnage replacement permanently owns its battlefield slot.'
  },
  death_throes: {
    kind: 'unit', ring: 3, row: 0, age: 1, cost: 1350, prominence: 'keystone', cluster: 'Swarm & Corruption',
    requires: ['butchery'], unlocks: 'nk_husk',
    effect: 'Replace the corrupted Man-at-Arms with Husk. The Husk grows through every later age, and all current and future Carnage-slot bodies keep fighting briefly after a non-obliterating death.'
  },
  honed_edges: {
    ring: 3, row: 1, age: 2, cost: 850, prominence: 'minor', cluster: 'Swarm & Corruption',
    requires: ['butchery'],
    effect: 'All bodies you build now and every later Carnage evolution deal 10% more damage.'
  },
  bloodlust: {
    ring: 4, row: 0, age: 2, cost: 1200, prominence: 'minor', cluster: 'Swarm & Corruption',
    requires: ['death_throes'],
    effect: 'Every current and future Carnage-slot unit attacks and moves faster on blood-soaked ground.'
  },
  the_hunger: {
    ring: 5, row: 0, age: 3, cost: 2400, prominence: 'notable', cluster: 'Swarm & Corruption',
    requires: ['bloodlust'],
    effect: 'While outnumbered, the entire Carnage roster — including later tier replacements — gains up to 50% attack and movement speed.'
  },

  flenser_rite: {
    ring: 3, row: 3, age: 2, cost: 1700, prominence: 'notable', cluster: 'Predators & Assault',
    requires: ['butchery'], unlocks: 'nk_flenser',
    effect: 'Replace the Grenadier anti-horde slot with Flenser. Butcher and Flensing Host inherit the slot and every earlier Carnage-wide improvement.'
  },
  the_butcher: {
    ring: 4, row: 3, age: 3, cost: 2600, prominence: 'notable', cluster: 'Predators & Assault',
    requires: ['flenser_rite'], unlocks: 'nk_butcher',
    effect: 'Evolve Flenser into Butcher in the same anti-horde slot. It heals for two fifths of the wounds it opens.'
  },
  flensing_hosts: {
    ring: 5, row: 3, age: 4, cost: 3900, prominence: 'keystone', cluster: 'Predators & Assault',
    requires: ['the_butcher'], unlocks: 'nk_flensing_host',
    effect: 'Evolve Butcher into Flensing Host. No additional command-bar card is created.'
  },
  ripjaw_brood: {
    ring: 3, row: 4, age: 2, cost: 1650, prominence: 'notable', cluster: 'Predators & Assault',
    requires: ['butchery'], unlocks: 'nk_ripjaw',
    effect: 'Replace the Cuirassier fast-assault slot with Ripjaw. It becomes Ripjaw Alpha automatically in age three.'
  },
  skinriders: {
    ring: 5, row: 4, age: 4, cost: 3600, prominence: 'keystone', cluster: 'Predators & Assault',
    requires: ['ripjaw_brood'], unlocks: 'nk_skinrider',
    effect: 'Evolve Ripjaw Alpha into Skinrider. Predatory and Carnage-wide buffs remain attached to the slot.'
  },
  shrike_rite: {
    ring: 4, row: 5, age: 3, cost: 2400, prominence: 'notable', cluster: 'Predators & Assault',
    requires: ['flenser_rite'], unlocks: 'nk_shrike',
    effect: 'Fill the disabled rocket slot with Shrike, a close organic execution specialist rather than a weapon team.'
  },
  headsman_rite: {
    ring: 5, row: 5, age: 4, cost: 4000, prominence: 'keystone', cluster: 'Predators & Assault',
    requires: ['shrike_rite'], unlocks: 'nk_headsman',
    effect: 'Evolve Shrike into Headsman in the execution slot. Earlier execution and Carnage-wide effects continue to apply.'
  },

  bonepickers: {
    ring: 3, row: 7, age: 1, cost: 700, prominence: 'minor', cluster: 'Parasites & Ranged',
    requires: ['butchery'],
    effect: 'Wounded Carnage bodies consume nearby remains to heal. The rule follows every later body occupying their slot.'
  },
  brain_thieves: {
    ring: 4, row: 7, age: 2, cost: 1700, prominence: 'notable', cluster: 'Parasites & Ranged',
    requires: ['bonepickers'], unlocks: 'nk_brainstealer',
    effect: 'Replace the Musketeer firearm slot with Brain Stealer. It becomes Brood Nurse automatically in age three and supplies Carnage’s limited ranged pressure through parasites.'
  },
  mind_flayers: {
    ring: 5, row: 7, age: 4, cost: 3900, prominence: 'keystone', cluster: 'Parasites & Ranged',
    requires: ['brain_thieves'], unlocks: 'nk_mindflayer',
    effect: 'Evolve Brood Nurse into Mind Flayer. Every parasite and research-economy benefit from the earlier line remains active.'
  },

  bone_harvest: {
    ring: 3, row: 10, age: 1, cost: 900, prominence: 'notable', cluster: 'Fleshcraft Support',
    requires: ['butchery'],
    effect: 'Raise one Bonewright per lane to carry usable remains home. This opens the corpse-support economy.'
  },
  charnel_rite: {
    ring: 4, row: 10, age: 2, cost: 1200, prominence: 'minor', cluster: 'Fleshcraft Support',
    requires: ['bone_harvest'], excludes: undefined,
    effect: 'Unlock the Charnel Yard. It accelerates the cheapest line body and turns corpses on your half into damage.'
  },
  corpse_wall: {
    ring: 5, row: 9, age: 3, cost: 2700, prominence: 'keystone', cluster: 'Fleshcraft Support',
    requires: ['charnel_rite'], excludes: ['necropolis'],
    effect: 'Choose fortification: settled remains block fire and deep piles become physical terrain.'
  },
  necropolis: {
    ring: 5, row: 10, age: 4, cost: 3000, prominence: 'keystone', cluster: 'Fleshcraft Support',
    requires: ['charnel_rite'], excludes: ['corpse_wall'],
    effect: 'Choose resurrection: corpse pieces on your half periodically assemble into a free age-appropriate soldier.'
  },
  flesh_architecture: {
    ring: 6, row: 9, age: 4, cost: 3600, prominence: 'keystone', cluster: 'Fleshcraft Support',
    requires: ['corpse_wall'], unlocks: 'nk_fleshwall',
    effect: 'Replace the Aegis screen slot with Flesh Wall, a three-file living bulwark that repairs itself from nearby remains.'
  },
  ossuary_rite: {
    ring: 6, row: 10, age: 4, cost: 1800, prominence: 'minor', cluster: 'Fleshcraft Support',
    requires: ['necropolis'], excludes: undefined,
    effect: 'Unlock the Ossuary and turn gathered remains into stored strategic value.'
  },
  carrion_choir: {
    ring: 5, row: 11, age: 3, cost: 2400, prominence: 'notable', cluster: 'Fleshcraft Support',
    requires: ['charnel_rite'], unlocks: 'nk_carrion',
    effect: 'Replace Combat Medic with Carrion Choir. The temporary human support line ends here.'
  },
  charnel_engine: {
    ring: 6, row: 11, age: 4, cost: 4200, prominence: 'keystone', cluster: 'Fleshcraft Support',
    requires: ['carrion_choir'], requiresAny: ['corpse_wall', 'necropolis'], unlocks: 'nk_charnel_engine',
    effect: 'Evolve Carrion Choir into Charnel Engine. It continuously mills your half of the field and inherits every corpse-support improvement.'
  },
  clean_kills: {
    ring: 4, row: 12, age: 2, cost: 900, prominence: 'minor', cluster: 'Fleshcraft Support',
    requires: ['bone_harvest'],
    effect: 'Clean kills leave extra skulls, and Bonewrights return them as research instead of gold.'
  },
  bone_levy: {
    ring: 5, row: 12, age: 3, cost: 2200, prominence: 'notable', cluster: 'Fleshcraft Support',
    requires: ['clean_kills'],
    effect: 'Bonewrights carry frames as well as meat; four frames raised at home become a free Boneling.'
  },

  plague_wind: {
    ring: 3, row: 14, age: 3, cost: 2200, prominence: 'minor', cluster: 'Monstrosities & Capstones',
    requires: ['butchery'],
    effect: 'Every enemy killed by any current or later Carnage body leaves a damaging plague cloud in its lane.'
  },
  widow_hatchery: {
    ring: 4, row: 14, age: 3, cost: 2800, prominence: 'notable', cluster: 'Monstrosities & Capstones',
    requires: ['plague_wind'], unlocks: 'nk_widow',
    effect: 'Fill the disabled aircraft slot with Carrion Widow, an organic air hunter that feeds on what it strikes.'
  },
  widow_queen: {
    ring: 5, row: 14, age: 4, cost: 4200, prominence: 'keystone', cluster: 'Monstrosities & Capstones',
    requires: ['widow_hatchery'], unlocks: 'nk_widow_queen',
    effect: 'Evolve Carrion Widow into Widow Queen. The same air-hunter slot now turns kills into eggs and replacements.'
  },
  the_hunger_made_flesh: {
    ring: 3, row: 15, age: 3, cost: 3100, prominence: 'keystone', cluster: 'Monstrosities & Capstones',
    requires: ['butchery'], unlocks: 'nk_monstrum',
    effect: 'Fill the disabled armour slot with Monstrum. It permanently gains health, damage and size from the remains it consumes.'
  },
  the_maw: {
    ring: 5, row: 15, age: 4, cost: 4400, prominence: 'keystone', cluster: 'Monstrosities & Capstones',
    requires: ['the_hunger_made_flesh'], unlocks: 'nk_maw',
    effect: 'Evolve Monstrum into Great Maw. It drags prey inward and renders its kills onto your side of the field.'
  },
  incarnation_rite: {
    ring: 6, row: 15, age: 4, cost: 6200, prominence: 'keystone', cluster: 'Monstrosities & Capstones',
    requires: ['the_maw'], unlocks: 'nk_incarnation',
    demand: { metric: 'kills', amount: 120, label: 'Kill 120 — it only answers a slaughter' },
    effect: 'Fill the disabled Titan slot with the Incarnation of Slaughter. Each card bought grows the sigil over your fortress; every thirty seconds the best melee body on the board — either side — is taken, and a sword-bearing demon-lord rises in its place.'
  },
  ascend_nekrotics: {
    ring: 7, row: 10, age: 4, cost: 7000, prominence: 'keystone', cluster: 'Fleshcraft Support',
    requires: ['charnel_rite'], requiresAny: ['corpse_wall', 'necropolis'],
    effect: 'Ascend as the Nekrotics. Keep the Carnage slots you actually researched; every soldier you lose rises once at reduced health.'
  }
}

// Carnage now owns rows 0–16. Preserve every other branch's relative layout by
// shifting the old lower bands together rather than letting the view resolve
// collisions differently in each ring.
for (const node of TECHS) {
  if (node.branch !== 'carnage' && node.row >= 8) node.row += 10
}
for (const [id, patch] of Object.entries(CARNAGE_REWORK)) {
  const node = TECHS.find(candidate => candidate.id === id)
  if (!node) throw new Error(`Carnage rework references missing technology: ${id}`)
  Object.assign(node, patch)
}

// A collision inside the authored Carnage band is a data error, not something
// the UI should silently push into another thematic lane.
const carnageSlots = new Set<string>()
for (const node of TECHS.filter(candidate => candidate.branch === 'carnage')) {
  const key = `${node.ring}:${node.row}`
  if (carnageSlots.has(key)) throw new Error(`Carnage technology slot collision: ${key}`)
  carnageSlots.add(key)
}

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
