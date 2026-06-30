import type { GameState, Vec2 } from '../engine/types';

/**
 * Contract between the interactive UI and the 3D renderer. The UI talks only to
 * this interface, so the Three.js implementation can evolve independently (and
 * could be swapped for a 2D fallback or a different engine later).
 *
 * Table coordinates are inches with origin at the bottom-left of the board, the
 * same convention used throughout the engine. The renderer is responsible for
 * mapping those to whatever world space it uses internally.
 */
export interface PickResult {
  /** Table coordinate under the cursor (inches). */
  point: Vec2;
  /** Unit id under the cursor, if a model/base was hit. */
  unitId?: string;
}

export interface SceneController {
  /** Build the scene for an initial game state and start rendering. */
  init(container: HTMLElement, state: GameState): void;

  /** Reconcile all meshes (positions, casualties, objective control) with state. */
  sync(state: GameState): void;

  /** Visually emphasise a unit (selection ring), or clear with null. */
  highlightUnit(unitId: string | null): void;

  /** Emphasise a set of units as valid targets (e.g. shooting/charge). */
  setTargets(unitIds: string[]): void;

  /** Draw a measuring tape / range indicator between two table points. */
  showMeasurement(from: Vec2, to: Vec2, label?: string): void;

  /** Draw a movement/threat range ring around a table point. */
  showRange(center: Vec2, radius: number, color?: number): void;

  /** Clear transient overlays (measurements, ranges). */
  clearOverlays(): void;

  /** Register a click handler; receives the picked table point and unit (if any). */
  onPick(handler: (result: PickResult) => void): void;

  /** Register a hover handler for live measurement and tooltips. */
  onHover(handler: (result: PickResult) => void): void;

  /** Pop a floating combat number (damage) above a unit. */
  flashDamage(unitId: string, amount: number): void;

  /* ------------------------------- combat FX ------------------------------ *
   * Fire-and-forget, transient visual effects. They never touch engine state
   * or RNG, never block, spawn pooled/transient objects animated by the
   * renderer's own loop, and auto-dispose when their life ends. Safe to call
   * from the UI on every shooting/fight resolution.
   * ----------------------------------------------------------------------- */

  /**
   * Ranged attack: a few staggered glowing tracers/bolts travelling from a
   * shooter model to a target model, with a muzzle flash at the origin and an
   * impact spark + flash at the target. Colour follows the shooter's faction.
   * @param opts.volleys number of tracers to stagger (clamped per quality tier)
   * @param opts.melee   pass false (reserved); melee shots use playMelee
   */
  playShoot(
    fromUnitId: string,
    toUnitId: string,
    opts?: { volleys?: number; melee?: false },
  ): void;

  /** Melee clash: combatants lunge toward each other, a spark/slash flash at
   * the contact midpoint, and (above 'low' tier) a subtle screen shake. */
  playMelee(aUnitId: string, bUnitId: string): void;

  /** Hit flash + expanding ring on a unit (pairs with flashDamage numbers). */
  playImpact(unitId: string, intensity?: number): void;

  /** When on, FX are shortened or skipped (accessibility / battery). */
  setReducedMotion(on: boolean): void;

  /** Resize to the container. */
  resize(): void;

  /** Frame the camera on the whole board. */
  frameBoard(): void;

  /** Move the camera to a close, low-angle view centred on a table point. */
  frameUnit(center: Vec2, radiusInches?: number): void;

  /* ----------------------------- cinematic camera ------------------------- *
   * Additive, smooth camera direction for cutscene-style shots. They drive the
   * same single orbit state as frameBoard/frameUnit (no second loop, no
   * per-frame allocations), so they compose cleanly with user orbit/pan/zoom.
   * ----------------------------------------------------------------------- */

  /**
   * Smoothly move the orbit camera to look at a table point, optionally
   * reframing it. Omitted options keep their current value.
   * @param opts.radius   orbit distance (world units); clamped to limits
   * @param opts.azimuth  yaw around the target (radians)
   * @param opts.polar    down-tilt from +Y (radians); clamped to a sane range
   * @param opts.immediate snap instead of easing (e.g. for an instant cut)
   */
  focusOn(
    center: Vec2,
    opts?: { radius?: number; azimuth?: number; polar?: number; immediate?: boolean },
  ): void;

  /**
   * Continuously rotate the camera azimuth for an establishing shot. The speed
   * is radians per second; 0 stops the auto-orbit (the camera then rests wherever
   * it is). Integrated into the existing per-frame camera update.
   */
  setAutoOrbit(radPerSec: number): void;

  /**
   * Replace a unit's visual with a user-supplied model loaded from a URL (e.g. a
   * publicly hosted glTF) or a local File. Lets players bring in their own
   * collection. Resolves once applied; rejects on load failure.
   */
  importUnitModel(
    unitId: string,
    src: string | File,
    format: 'gltf' | 'glb' | 'obj' | 'stl',
    heightInches?: number,
  ): Promise<void>;
}
