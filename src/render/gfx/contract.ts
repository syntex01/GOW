/**
 * Shared contract for the modular visual system ("gfx").
 *
 * The renderer (ThreeScene) composes the battlefield from focused modules —
 * textures, board, terrain, scatter, sky, lights, post — instead of one
 * monolith. Every module implements the small interfaces below so the host can
 * build, update and dispose them uniformly, and so modules can be authored and
 * tested independently.
 *
 * Conventions all modules follow:
 *  - Table coordinates are INCHES, origin at the board's bottom-left corner
 *    (the engine's convention). World space: x_world = x - width/2, y_world =
 *    elevation, z_world = -(y - height/2). Use `tableToWorld`.
 *  - All randomness is SEEDED via `sRNG` (deterministic builds; never
 *    Math.random in geometry/texture generation).
 *  - `update(t, dt)` hooks run every frame and MUST NOT allocate.
 *  - `dispose()` releases geometries, materials and textures the module owns.
 *  - Albedo canvas textures get `colorSpace = THREE.SRGBColorSpace`; normal /
 *    roughness maps stay linear (default NoColorSpace).
 */
import * as THREE from 'three';

export type GfxTier = 'low' | 'medium' | 'high';

/** Quality knobs shared by all gfx modules (derived from the host's detector). */
export interface GfxQuality {
  tier: GfxTier;
  /** Long-edge budget (px) for procedural canvas textures. */
  texturePx: number;
  /** Radial segment budget for round geometry. */
  ringSegments: number;
}

/** Playable board dimensions in inches. */
export interface BoardSpec {
  width: number;
  height: number;
}

/** Axis-aligned exclusion rectangle in table inches (terrain, deploy zones…). */
export interface AvoidRect {
  x: number; // centre x
  y: number; // centre y
  w: number; // full width  (x extent)
  d: number; // full depth  (y extent)
}

/** A built visual chunk: one group to attach, optional per-frame hook. */
export interface Built {
  group: THREE.Group;
  /** Per-frame animation hook. `t` = elapsed seconds, `dt` = delta seconds. */
  update?: (t: number, dt: number) => void;
  dispose: () => void;
}

/** Deterministic mulberry32 PRNG — the only randomness source for gfx builds. */
export function sRNG(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map a table point (inches) to world space at elevation `y`. */
export function tableToWorld(
  p: { x: number; y: number },
  spec: BoardSpec,
  y = 0,
): THREE.Vector3 {
  return new THREE.Vector3(p.x - spec.width / 2, y, -(p.y - spec.height / 2));
}

/** A procedural PBR texture bundle (all maps share one wrap/repeat setup). */
export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** Optional glow layer (ember cracks etc.) — hot spots feed the bloom pass. */
  emissiveMap?: THREE.Texture;
  dispose: () => void;
}
