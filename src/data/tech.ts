/**
 * The tech trees.
 *
 * The rule every node here obeys: it must change what the game *does*, not
 * what a number says. There is no "+10% damage" in this file. A tech either
 * gives your army a behaviour it did not have — shots that bounce, soldiers
 * that eat the dead, corpses that stop bullets — or it does not belong.
 *
 * That constraint is also what makes the branches feel different from each
 * other. Carnage is a build that wants a long, bloody, static front line.
 * Ordnance wants open ground and physics. Engineering wants to break the shape
 * of the lane entirely. They interact: shrapnel feeds corpse walls, sappers
 * make a mess behind the lines for bonepickers to eat.
 */

export type TechId =
  | 'butchery'
  | 'bonepickers'
  | 'bloodlust'
  | 'corpse_wall'
  | 'necropolis'
  | 'ricochet'
  | 'shrapnel'
  | 'overpressure'
  | 'cluster'
  | 'penetrator'
  | 'salvage'
  | 'sappers'
  | 'demolition'
  | 'emp'
  | 'aegis'

export type TechBranch = 'carnage' | 'ordnance' | 'engineering'

export interface TechNode {
  id: TechId
  name: string
  branch: TechBranch
  /** Earliest age this can be researched. */
  age: number
  cost: number
  /** Must all be owned first. */
  requires: TechId[]
  /** What it does, stated as a behaviour. */
  effect: string
  /** The colour used for this node in the tree. */
  accent: number
}

export const TECH_BRANCHES: { id: TechBranch; name: string; blurb: string; accent: number }[] = [
  {
    id: 'carnage',
    name: 'CARNAGE',
    blurb: 'Turn the dead into a resource, and the ground they fell on into terrain.',
    accent: 0xc0392b
  },
  {
    id: 'ordnance',
    name: 'ORDNANCE',
    blurb: 'Make every shot a physical object with somewhere else to be afterwards.',
    accent: 0xe08a2e
  },
  {
    id: 'engineering',
    name: 'ENGINEERING',
    blurb: 'Refuse the shape of the lane. Go under it, salvage it, or blow it up.',
    accent: 0x3d8bff
  }
]

export const TECHS: TechNode[] = [
  // ── Carnage ──────────────────────────────────────────────────────────────
  {
    id: 'butchery',
    name: 'Butchery',
    branch: 'carnage',
    age: 0,
    cost: 450,
    requires: [],
    effect: 'Everything your soldiers kill comes apart, however it died. The field fills with bodies.',
    accent: 0xc0392b
  },
  {
    id: 'bonepickers',
    name: 'Bonepickers',
    branch: 'carnage',
    age: 1,
    cost: 950,
    requires: ['butchery'],
    effect: 'Your wounded eat the remains they walk over, healing from each piece they consume.',
    accent: 0xc0392b
  },
  {
    id: 'bloodlust',
    name: 'Bloodlust',
    branch: 'carnage',
    age: 2,
    cost: 1700,
    requires: ['bonepickers'],
    effect: 'Your soldiers fight faster the more soaked the ground beneath them is.',
    accent: 0xc0392b
  },
  {
    id: 'corpse_wall',
    name: 'Corpse Wall',
    branch: 'carnage',
    age: 3,
    cost: 2700,
    requires: ['bloodlust'],
    effect: 'Remains on the ground stop enemy shots. Pile up enough dead and they become cover.',
    accent: 0xc0392b
  },
  {
    id: 'necropolis',
    name: 'Necropolis',
    branch: 'carnage',
    age: 4,
    cost: 4400,
    requires: ['corpse_wall'],
    effect: 'Your half of the field raises what has fallen on it. Enough remains, and they get up again.',
    accent: 0xc0392b
  },

  // ── Ordnance ─────────────────────────────────────────────────────────────
  {
    id: 'ricochet',
    name: 'Ricochet Rounds',
    branch: 'ordnance',
    age: 1,
    cost: 850,
    requires: [],
    effect: 'Flat shots that strike armour at a shallow angle skip off it and keep going.',
    accent: 0xe08a2e
  },
  {
    id: 'shrapnel',
    name: 'Shrapnel',
    branch: 'ordnance',
    age: 2,
    cost: 1600,
    requires: ['ricochet'],
    effect: 'Your explosions throw fragments. They fly, fall, and wound whatever they reach.',
    accent: 0xe08a2e
  },
  {
    id: 'overpressure',
    name: 'Overpressure',
    branch: 'ordnance',
    age: 3,
    cost: 2500,
    requires: ['shrapnel'],
    effect: 'Blasts stop nudging and start throwing. Soldiers leave the ground and land badly.',
    accent: 0xe08a2e
  },
  {
    id: 'cluster',
    name: 'Cluster Shells',
    branch: 'ordnance',
    age: 3,
    cost: 2500,
    requires: ['shrapnel'],
    effect: 'Anything you lob splits at the top of its arc into three smaller shells.',
    accent: 0xe08a2e
  },
  {
    id: 'penetrator',
    name: 'Penetrators',
    branch: 'ordnance',
    age: 4,
    cost: 4000,
    requires: ['overpressure'],
    effect: 'Your shots pass through the first body they hit and carry on into the next.',
    accent: 0xe08a2e
  },

  // ── Engineering ──────────────────────────────────────────────────────────
  {
    id: 'salvage',
    name: 'Salvage Crews',
    branch: 'engineering',
    age: 1,
    cost: 750,
    requires: [],
    effect: 'Wreckage that comes to rest on the field is stripped for gold where it lies.',
    accent: 0x3d8bff
  },
  {
    id: 'sappers',
    name: 'Sappers',
    branch: 'engineering',
    age: 2,
    cost: 1600,
    requires: ['salvage'],
    effect: 'Your melee troops dig under a stalled front line and come up behind it.',
    accent: 0x3d8bff
  },
  {
    id: 'demolition',
    name: 'Demolition Charges',
    branch: 'engineering',
    age: 3,
    cost: 2300,
    requires: ['sappers'],
    effect: 'Your soldiers die armed. Whatever killed them is standing too close.',
    accent: 0x3d8bff
  },
  {
    id: 'emp',
    name: 'EMP Warheads',
    branch: 'engineering',
    age: 4,
    cost: 3800,
    requires: ['demolition'],
    effect: 'Energy hits shut machines down. Tanks and walkers stop dead for a few seconds.',
    accent: 0x3d8bff
  },
  {
    id: 'aegis',
    name: 'Aegis Link',
    branch: 'engineering',
    age: 4,
    cost: 3800,
    requires: ['demolition'],
    effect: 'Soldiers standing together share what they take. Break the formation and it stops.',
    accent: 0x3d8bff
  }
]

export const TECHS_BY_ID: Record<TechId, TechNode> = Object.fromEntries(
  TECHS.map(t => [t.id, t])
) as Record<TechId, TechNode>

/** Nodes belonging to one branch, in research order. */
export function branchTechs(branch: TechBranch): TechNode[] {
  return TECHS.filter(t => t.branch === branch).sort((a, b) => a.age - b.age || a.cost - b.cost)
}

/** Stable index, used to pack an army's owned techs into the state hash. */
export const TECH_ORDER: TechId[] = TECHS.map(t => t.id)
