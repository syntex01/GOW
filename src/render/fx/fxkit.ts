/**
 * FxKit — the low-level weapon visual-effects toolkit contract.
 *
 * The renderer (ThreeScene) implements this by wrapping its pooled sprite/mesh
 * FX primitives; the per-archetype composers in `archetypes.ts` build every
 * weapon effect purely from these calls, so they never touch Three.js or the
 * scene directly. All positions are WORLD-SPACE plain records (`V3`), converted
 * to THREE.Vector3 inside the implementation.
 *
 * Every call is fire-and-forget, transient, pooled and auto-disposing, and is
 * bounded by the adaptive perf `budget` (composers clamp their counts to it).
 */

/** Plain world-space point (renderer converts to THREE.Vector3). */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface FxKit {
  /** Additive glow puff (muzzle bloom, impact flash). `life` in seconds. */
  flash(pos: V3, color: number, size: number, life: number): void;

  /** Thin fast streak from `from`→`to`. `speed` scales travel time (1 = base). */
  tracer(
    from: V3,
    to: V3,
    color: number,
    opts?: { delay?: number; thickness?: number; speed?: number },
  ): void;

  /** Fat glowing projectile with a trail (plasma/missile). Lower `speed` = slower. */
  bolt(
    from: V3,
    to: V3,
    color: number,
    opts?: { delay?: number; size?: number; speed?: number; trailColor?: number },
  ): void;

  /** Instant hitscan beam (las/gauss/melta) — a straight glowing shaft that flickers out. */
  beam(
    from: V3,
    to: V3,
    color: number,
    opts?: { life?: number; thickness?: number; flicker?: number },
  ): void;

  /** Directional particle cone toward `to` (flamer). `spread` in radians-ish (0..1). */
  cone(
    from: V3,
    to: V3,
    color: number,
    opts?: { life?: number; spread?: number; count?: number },
  ): void;

  /** Radial spark burst that flies out and falls under gravity. */
  sparks(pos: V3, color: number, count: number, speed: number): void;

  /** Expanding flat ground shock ring. */
  ring(pos: V3, color: number, scale: number): void;

  /** Explosion: fireball + debris sparks + shock ring + flash, sized by `size`. */
  boom(pos: V3, color: number, size: number): void;

  /** Transient dynamic point light (heavy/impact accent). Use sparingly. */
  glowLight(pos: V3, color: number, intensity: number, life: number): void;

  /** Camera shake, 0..1 (heavy weapons only). */
  shake(amount: number): void;

  /** Adaptive perf caps — composers clamp their volley/spark/particle counts. */
  readonly budget: { volleys: number; sparks: number; tier: 'low' | 'medium' | 'high' };
}
