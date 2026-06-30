import type {
  Datasheet,
  GameState,
  ModelInstance,
  Objective,
  PlayerId,
  UnitInstance,
  Vec2,
  Characteristics,
  TerrainPiece,
} from './types';
import { resolveCollisions } from './geometry';

const MM_PER_INCH = 25.4;
export const baseRadiusInches = (mm: number): number => mm / 2 / MM_PER_INCH;

/** Default physical model heights (inches) by silhouette, for clipping/terrain. */
const SILHOUETTE_HEIGHT: Record<NonNullable<Datasheet['proxy']>['silhouette'], number> = {
  infantry: 1.4,
  character: 1.9,
  monster: 3.2,
  vehicle: 3.6,
};

/** Physical height (inches) of a datasheet's models for clearance checks. */
function modelHeightFor(ds: Datasheet): number {
  return ds.proxy?.heightInches ?? SILHOUETTE_HEIGHT[ds.proxy?.silhouette ?? 'infantry'];
}

/** One unit in an army list: a datasheet plus how many models to field. */
export interface ArmyListEntry {
  datasheetId: string;
  modelCount?: number; // defaults to the datasheet's minimum
  /** Optional id of the bodyguard unit a Leader should attach to. */
  attachTo?: string;
  /** Optional stable instance id (used by importers to wire attachments). */
  instanceId?: string;
  /** Start this unit in Strategic Reserves / Deep Strike (off the table). */
  inReserves?: boolean;
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
  const height = modelHeightFor(ds);
  const models: ModelInstance[] = [];
  const perRow = Math.max(1, Math.ceil(Math.sqrt(modelCount)));
  // Bases must not overlap, so space models a touch more than one base apart.
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
      heightInches: height,
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
 * Symmetric terrain layout: paired ruins (obscuring) and craters (cover) placed
 * to give both sides equivalent board presence. Mid-board pieces create real
 * line-of-sight lanes. These are the exact pieces the renderer draws.
 */
export function defaultTerrain(board: { width: number; height: number }): TerrainPiece[] {
  const { width: w, height: h } = board;
  const ruin = (id: string, x: number, y: number, ww: number, dd: number): TerrainPiece => ({
    id,
    kind: 'ruin',
    center: { x, y },
    width: ww,
    depth: dd,
    height: 4,
    obscuring: true,
    clearance: 0, // solid structure: no model base may overlap its footprint
  });
  const crater = (id: string, x: number, y: number, r: number): TerrainPiece => ({
    id,
    kind: 'crater',
    center: { x, y },
    width: r * 2,
    depth: r * 2,
    height: 0.4,
    obscuring: false,
    clearance: 99, // shallow depression: any model may stand in it
  });
  return [
    ruin('r_center', w / 2, h / 2, 9, 6),
    ruin('r_nw', w / 2 - 16, h / 2 + 8, 8, 7),
    ruin('r_se', w / 2 + 16, h / 2 - 8, 8, 7),
    ruin('r_ne', w / 2 + 15, h / 2 + 9, 7, 6),
    ruin('r_sw', w / 2 - 15, h / 2 - 9, 7, 6),
    crater('c_w', w / 2 - 22, h / 2, 4),
    crater('c_e', w / 2 + 22, h / 2, 4),
  ];
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

  // Maps a list entry's stable `instanceId` to the minted unit id, so that an
  // entry's `attachTo` (which references another entry's instanceId) can be
  // resolved into a concrete leader<->bodyguard link after deployment.
  const instanceIdToUnitId: Record<string, string> = {};
  // Per-list parallel array of minted unit ids, indexed by entry position. Lets
  // us resolve a leader entry's own unit id even when it has no `instanceId`.
  const entryUnitIds = new Map<ArmyList, (string | undefined)[]>();

  const deploy = (list: ArmyList, owner: PlayerId): void => {
    const facing: 1 | -1 = owner === 'A' ? 1 : -1;
    const baseY = owner === 'A' ? 8 : board.height - 8;
    const ids: (string | undefined)[] = [];
    list.entries.forEach((entry, i) => {
      const ds = registry[entry.datasheetId];
      if (!ds) {
        console.warn(`Unknown datasheet: ${entry.datasheetId}`);
        ids[i] = undefined;
        return;
      }
      const count = entry.modelCount ?? ds.composition[0]?.min ?? 1;
      const spread = list.entries.length;
      const x = board.width * ((i + 1) / (spread + 1));
      const unit = instantiateUnit(ds, owner, count, { x, y: baseY }, facing);
      if (entry.inReserves) {
        unit.inReserves = true;
        unit.deepStrike = true;
      }
      if (entry.instanceId) instanceIdToUnitId[entry.instanceId] = unit.id;
      ids[i] = unit.id;
      units[unit.id] = unit;
    });
    entryUnitIds.set(list, ids);
  };

  deploy(listA, 'A');
  deploy(listB, 'B');

  // Wire leader attachments now that every unit has a concrete id. A character
  // entry with a Leader ability whose `attachTo` points at a deployed bodyguard
  // unit is linked to it (co-deployed) and recorded via leadingUnitId /
  // attachedLeaderIds. We move the leader on top of the bodyguard so they form
  // a single board presence, and only link if the leader may lead that sheet.
  const linkAttachment = (list: ArmyList): void => {
    const ids = entryUnitIds.get(list) ?? [];
    list.entries.forEach((entry, i) => {
      if (!entry.attachTo) return;
      const leaderId = entry.instanceId ? instanceIdToUnitId[entry.instanceId] : ids[i];
      const bodyguardId = instanceIdToUnitId[entry.attachTo];
      if (!leaderId || !bodyguardId) return;
      const leader = units[leaderId];
      const bodyguard = units[bodyguardId];
      if (!leader || !bodyguard) return;
      const leaderEff = leader.abilities.find((a) => a.effect?.t === 'leader')?.effect;
      const canLead =
        leaderEff?.t === 'leader' && leaderEff.canLeadDatasheetIds.includes(bodyguard.datasheetId);
      if (!canLead) return;
      leader.leadingUnitId = bodyguardId;
      if (!bodyguard.attachedLeaderIds.includes(leaderId)) {
        bodyguard.attachedLeaderIds.push(leaderId);
      }
      // Co-deploy: move the leader's models on top of the bodyguard anchor so
      // the combined unit is physically together (and reserves stay in step).
      if (!leader.inReserves && !bodyguard.inReserves) {
        const anchor = bodyguard.models[0]?.position ?? leader.models[0]?.position;
        if (anchor) {
          leader.models.forEach((m, k) => {
            m.position = { x: anchor.x + (k + 1) * 0.4, y: anchor.y };
          });
        }
      } else {
        // Keep the pair in the same deployment state.
        leader.inReserves = bodyguard.inReserves;
        leader.deepStrike = bodyguard.deepStrike;
      }
    });
  };
  linkAttachment(listA);
  linkAttachment(listB);

  // Settle deployment so no bases overlap each other or solid terrain.
  const terrain = defaultTerrain(board);
  resolveCollisions(units, terrain, board);

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
    terrain,
    board,
    log: [],
    rngSeed: config.seed,
    idCounter: _seq,
  };
}
