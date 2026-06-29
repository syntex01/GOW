/**
 * Core data model for the wargame engine.
 *
 * Two layers:
 *  - Datasheet layer: static, faction-authored definitions of what a unit *is*
 *    (its profile, weapons, abilities). Think of it as the printed datasheet.
 *  - Instance layer: the live state of a unit on the battlefield during a game
 *    (positions, wounds remaining, what it has done this turn).
 *
 * All distances are in inches and all positions are 2D table coordinates in
 * inches with the origin at the bottom-left corner of the board. Stats follow
 * tabletop conventions: a save/skill/leadership of N means "N+" on a D6.
 */

export type PlayerId = 'A' | 'B';

export type Vec2 = { x: number; y: number };

/** A dice expression: a flat number, or a string like "D6", "D3", "2D6", "D6+2". */
export type DiceExpr = number | string;

/** Model/unit characteristic profile (one line of the datasheet). */
export interface Characteristics {
  move: number; // inches
  toughness: number;
  save: number; // armour save, N means N+
  invuln?: number; // invulnerable save, N means N+
  feelNoPain?: number; // N means N+
  wounds: number;
  leadership: number; // N means N+
  objectiveControl: number;
}

export type WeaponKind = 'ranged' | 'melee';

/**
 * Weapon special rules, modelled structurally so values travel with the rule.
 * Names mirror the standard tabletop weapon-ability set.
 */
export type WeaponKeyword =
  | { t: 'rapidFire'; x: number }
  | { t: 'sustainedHits'; x: number }
  | { t: 'lethalHits' }
  | { t: 'devastatingWounds' }
  | { t: 'twinLinked' }
  | { t: 'anti'; keyword: string; x: number } // ANTI-keyword X+
  | { t: 'blast' }
  | { t: 'melta'; x: number }
  | { t: 'heavy' }
  | { t: 'assault' }
  | { t: 'pistol' }
  | { t: 'torrent' }
  | { t: 'precision' }
  | { t: 'lance' }
  | { t: 'indirectFire' }
  | { t: 'ignoresCover' }
  | { t: 'hazardous' }
  | { t: 'extraAttacks' }
  | { t: 'oneShot' };

export interface Weapon {
  id: string;
  name: string;
  kind: WeaponKind;
  range: number; // inches; melee weapons use 0
  attacks: DiceExpr;
  skill: number; // BS (ranged) or WS (melee); 0 means auto-hit (e.g. Torrent)
  strength: number;
  ap: number; // stored as a non-negative magnitude; AP -2 is { ap: 2 }
  damage: DiceExpr;
  keywords: WeaponKeyword[];
}

/** A datasheet ability. `effect` is a machine-readable hook used by the engine. */
export interface Ability {
  name: string;
  text: string; // concise, original summary
  effect?: AbilityEffect;
}

/** Structured ability effects the engine knows how to apply. */
export type AbilityEffect =
  | { t: 'leader'; canLeadDatasheetIds: string[] }
  | { t: 'feelNoPain'; value: number }
  | { t: 'invuln'; value: number }
  | { t: 'reanimation'; wounds: number } // restore W worth of models each turn
  | { t: 'deepStrike' }
  | { t: 'scouts'; inches: number }
  | { t: 'infiltrators' }
  | { t: 'loneOperative' }
  | { t: 'stealth' }
  | { t: 'fightsFirst' }
  | { t: 'reroll'; phase: 'hit' | 'wound'; scope: 'ones' | 'all' }
  | { t: 'oathOfMoment' }
  | { t: 'rerollOcWhenBelowStartingStrength' };

/** One model type within a unit's composition. */
export interface UnitCompositionEntry {
  modelName: string;
  min: number;
  max: number;
  /** Per-model characteristic overrides (e.g. a sergeant). Optional. */
  characteristics?: Partial<Characteristics>;
  /** Weapon ids (from the datasheet) this model carries by default. */
  defaultWeaponIds?: string[];
}

export interface Datasheet {
  id: string;
  name: string;
  faction: string;
  keywords: string[]; // includes faction + unit-type keywords
  statline: Characteristics;
  weapons: Weapon[];
  abilities: Ability[];
  composition: UnitCompositionEntry[];
  baseSizeMm: number; // round base diameter in millimetres
  isCharacter: boolean;
  points: number; // points for the default unit size
  /** Rough visual proxy descriptor used by the renderer until a model is imported. */
  proxy?: ProxyDescriptor;
}

export interface ProxyDescriptor {
  silhouette: 'infantry' | 'character' | 'monster' | 'vehicle';
  primary: string; // hex colour
  secondary: string; // hex colour
  metalness?: number;
  glow?: string; // optional emissive hex
  heightInches?: number;
}

/* ----------------------------- Instance layer ----------------------------- */

export interface ModelInstance {
  id: string;
  modelName: string;
  wounds: number; // current
  maxWounds: number;
  position: Vec2;
  alive: boolean;
  baseRadius: number; // inches
}

export type MoveState =
  | 'none'
  | 'normal'
  | 'advanced'
  | 'fellBack'
  | 'remainedStationary';

export interface UnitInstance {
  id: string;
  datasheetId: string;
  name: string;
  ownerId: PlayerId;
  models: ModelInstance[];
  statline: Characteristics;
  weapons: Weapon[];
  abilities: Ability[];
  keywords: string[];
  isCharacter: boolean;
  proxy?: ProxyDescriptor;

  // Per-turn status
  moveState: MoveState;
  advanceRoll: number; // inches gained this turn from advancing
  hasShot: boolean;
  hasChargedThisTurn: boolean;
  hasFought: boolean;
  isBattleShocked: boolean;

  // Reserves / deployment
  inReserves: boolean;
  deepStrike: boolean;

  // Leader attachment
  leadingUnitId?: string; // if this is a leader, the bodyguard unit it joined
  attachedLeaderIds: string[]; // if this is a bodyguard, leaders attached to it

  startingModelCount: number;
}

export interface Objective {
  id: string;
  position: Vec2;
  radius: number; // control radius in inches (objective marker = 3" default)
  controlledBy?: PlayerId;
}

export type Phase =
  | 'command'
  | 'movement'
  | 'shooting'
  | 'charge'
  | 'fight'
  | 'end';

export interface PlayerState {
  id: PlayerId;
  name: string;
  faction: string;
  commandPoints: number;
  victoryPoints: number;
}

export interface LogEntry {
  round: number;
  phase: Phase;
  player: PlayerId;
  message: string;
  detail?: string;
}

export interface BoardSize {
  width: number; // inches (table X)
  height: number; // inches (table Y)
}

export interface GameState {
  round: number;
  activePlayer: PlayerId;
  phase: Phase;
  firstPlayer: PlayerId;
  players: Record<PlayerId, PlayerState>;
  units: Record<string, UnitInstance>;
  objectives: Objective[];
  board: BoardSize;
  log: LogEntry[];
  rngSeed: number;
  /** Monotonic counter used to mint unique ids deterministically. */
  idCounter: number;
}
