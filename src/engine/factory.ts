import type {
  Datasheet,
  GameState,
  ModelInstance,
  Objective,
  PlayerId,
  UnitInstance,
  Vec2,
  Characteristics,
} from './types';

const MM_PER_INCH = 25.4;
export const baseRadiusInches = (mm: number): number => mm / 2 / MM_PER_INCH;

/** One unit in an army list: a datasheet plus how many models to field. */
export interface ArmyListEntry {
  datasheetId: string;
  modelCount?: number; // defaults to the datasheet's minimum
  /** Optional id of the bodyguard unit a Leader should attach to. */
  attachTo?: string;
  /** Optional stable instance id (used by importers to wire attachments). */
  instanceId?: string;
}

export interface ArmyList {
  name: string;
  faction: string;
  entries: ArmyListEntry[];
}

export interface GameConfig {
  seed: number;
  board?: { width: number; height: number };
  players: {
    A: { name: string; faction: string };
    B: { name: string; faction: string };
  };
}

let _seq = 0;
const nextId = (prefix: string): string => `${prefix}_${(_seq++).toString(36)}`;

/** Reset the instance-id sequence (deterministic ids for tests). */
export function resetIds(): void {
  _seq = 0;
}

/** Build a unit instance from a datasheet, deploying its models around `anchor`. */
export function instantiateUnit(
  ds: Datasheet,
  owner: PlayerId,
  modelCount: number,
  anchor: Vec2,
  facingDir: 1 | -1,
): UnitInstance {
  const radius = baseRadiusInches(ds.baseSizeMm);
  const models: ModelInstance[] = [];
  const perRow = Math.max(1, Math.ceil(Math.sqrt(modelCount)));
  const spacing = radius * 2 + 0.4;
  for (let i = 0; i < modelCount; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const offset: Vec2 = {
      x: anchor.x + (col - (perRow - 1) / 2) * spacing,
      y: anchor.y + facingDir * row * spacing,
    };
    models.push({
      id: nextId('m'),
      modelName: ds.composition[0]?.modelName ?? ds.name,
      wounds: ds.statline.wounds,
      maxWounds: ds.statline.wounds,
      position: offset,
      alive: true,
      baseRadius: radius,
    });
  }
  return {
    id: nextId('u'),
    datasheetId: ds.id,
    name: ds.name,
    ownerId: owner,
    models,
    statline: { ...ds.statline } as Characteristics,
    weapons: ds.weapons.map((w) => ({ ...w })),
    abilities: ds.abilities.map((a) => ({ ...a })),
    keywords: [...ds.keywords],
    isCharacter: ds.isCharacter,
    ...(ds.proxy ? { proxy: { ...ds.proxy } } : {}),
    moveState: 'none',
    advanceRoll: 0,
    hasShot: false,
    hasChargedThisTurn: false,
    hasFought: false,
    isBattleShocked: false,
    inReserves: false,
    deepStrike: false,
    attachedLeaderIds: [],
    startingModelCount: modelCount,
  };
}

/** Default battlefield: 60" x 44" (a standard mission size). */
export const DEFAULT_BOARD = { width: 60, height: 44 };

/** Five-objective layout (corners + centre), a common deployment. */
export function defaultObjectives(board: { width: number; height: number }): Objective[] {
  const { width: w, height: h } = board;
  const pts: Vec2[] = [
    { x: w / 2, y: h / 2 },
    { x: w / 2 - 14, y: h / 2 - 10 },
    { x: w / 2 + 14, y: h / 2 + 10 },
    { x: w / 2 - 14, y: h / 2 + 10 },
    { x: w / 2 + 14, y: h / 2 - 10 },
  ];
  return pts.map((p, i) => ({ id: `obj_${i}`, position: p, radius: 3 }));
}

/**
 * Assemble a full game state from two army lists and a registry of datasheets.
 * Player A deploys along the bottom edge, player B along the top.
 */
export function createGame(
  config: GameConfig,
  registry: Record<string, Datasheet>,
  listA: ArmyList,
  listB: ArmyList,
): GameState {
  resetIds();
  const board = config.board ?? DEFAULT_BOARD;
  const units: Record<string, UnitInstance> = {};

  const deploy = (list: ArmyList, owner: PlayerId): void => {
    const facing: 1 | -1 = owner === 'A' ? 1 : -1;
    const baseY = owner === 'A' ? 8 : board.height - 8;
    list.entries.forEach((entry, i) => {
      const ds = registry[entry.datasheetId];
      if (!ds) {
        console.warn(`Unknown datasheet: ${entry.datasheetId}`);
        return;
      }
      const count = entry.modelCount ?? ds.composition[0]?.min ?? 1;
      const spread = list.entries.length;
      const x = board.width * ((i + 1) / (spread + 1));
      const unit = instantiateUnit(ds, owner, count, { x, y: baseY }, facing);
      units[unit.id] = unit;
    });
  };

  deploy(listA, 'A');
  deploy(listB, 'B');

  return {
    round: 1,
    activePlayer: 'A',
    phase: 'command',
    firstPlayer: 'A',
    players: {
      A: { id: 'A', name: config.players.A.name, faction: config.players.A.faction, commandPoints: 0, victoryPoints: 0 },
      B: { id: 'B', name: config.players.B.name, faction: config.players.B.faction, commandPoints: 0, victoryPoints: 0 },
    },
    units,
    objectives: defaultObjectives(board),
    board,
    log: [],
    rngSeed: config.seed,
    idCounter: _seq,
  };
}
