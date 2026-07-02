/**
 * gfx/scatter — instanced battlefield litter.
 *
 * Strews deterministic grimdark debris across the OPEN battlefield: irregular
 * rubble chunks, shattered ferrocrete slabs, scorched stakes, spent brass
 * shell casings (high tier only) and low ash-pebble clumps. Everything here is
 * purely cosmetic — the group is never raycast (per-mesh `raycast` is a no-op)
 * and no instance is ever placed inside a rules footprint.
 *
 * Perf contract (mid-range GPU):
 *  - <= 6 draw calls total. One InstancedMesh per kit: rubble + slabs +
 *    stakes + pebbles (+ casings on 'high') = 5 high / 4 medium & low.
 *  - Instance budgets per tier: ~700 high / ~350 medium / ~120 low (exact
 *    split in `COUNTS`). Total geometry cost ~40k tris on high.
 *  - Only the slab kit casts shadows, and only on 'high' (slabs are the one
 *    silhouette large enough to earn its shadow-map rasterisation). Everything
 *    else neither casts nor (for the tiny kits) receives.
 *  - No `update` hook at all — scatter is fully static, zero per-frame cost.
 *
 * Placement (matches the exclusion conventions of the legacy monolith
 * ThreeScene.buildScatter): the host passes terrain footprints, padded
 * objective discs and the two 22%-depth deployment bands as `avoid` rects.
 * This module rejection-samples table positions and rejects any point within
 * a 0.5" margin of ANY avoid rect, or within 1.0" of the board edge. On top
 * of that, a density falloff doubles litter weight within 6.0" of any LOCAL
 * avoid rect (terrain footprints / objective areas — identified as rects that
 * don't span the whole board, unlike the full-width deploy bands): debris
 * piles up around ruins and fought-over ground, thins out in the open lanes.
 *
 * Gameplay-readability contract: every per-instance albedo is authored in
 * HSL and clamped to lightness <= 0.30 / saturation <= 0.35, comfortably
 * inside the ground's 0.05–0.35 luminance band — faction rings and unit
 * colours always pop over the litter. The only accent above that is the
 * brass of the casings kit (< 2% of ground pixels, high tier only).
 *
 * Grounding: the board's displacement is clamped to [-0.12, +0.03], so every
 * instance is sunk into the plane — rubble 25% of its height, pebble clumps
 * half, stake bases and slab edges buried — plus a small seeded y jitter
 * (±0.02) so contact lines never read as a uniform shelf. Nothing floats.
 *
 * Determinism: all randomness flows from `sRNG` streams derived from the
 * build seed, one stream per kit (`seed + kit offset`) so re-tuning one kit's
 * count never reshuffles the others.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  sRNG,
  type AvoidRect,
  type BoardSpec,
  type Built,
  type GfxQuality,
} from './contract';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ------------------------------ tuning knobs ------------------------------ */

/** Keep-out margin added around every avoid rect (inches). */
const RECT_PAD = 0.5;
/** Litter never spawns closer than this to the playable edge (inches). */
const EDGE_MARGIN = 1.0;
/** Density falloff: 2x weight within this range of a local avoid rect. */
const NEAR_RANGE = 6.0;
/** Acceptance probability for candidates OUTSIDE the near range (=> 2x near). */
const FAR_KEEP = 0.5;
/** Rejection-sampling attempts per instance before the slot is skipped. */
const MAX_TRIES = 40;
/** Seeded resting-height jitter so contact lines never read as a shelf. */
const Y_JITTER = 0.02;

/** Per-kit instance budgets. Rows sum to 700 / 350 / 120. Casings are a
 *  high-tier-only garnish; their medium/low share moves into ash pebbles. */
const COUNTS: Record<GfxQuality['tier'], {
  rubble: number; slab: number; stake: number; casing: number; pebble: number;
}> = {
  high: { rubble: 220, slab: 120, stake: 55, casing: 80, pebble: 35 },
  medium: { rubble: 185, slab: 90, stake: 30, casing: 0, pebble: 45 },
  low: { rubble: 65, slab: 28, stake: 10, casing: 0, pebble: 17 },
};

/* --------------------------- deterministic jitter -------------------------- */

/**
 * Position-keyed vertex hash -> [0,1). Duplicated corner vertices (polyhedron
 * geometry stores one copy per face) quantise to the same key and therefore
 * receive the SAME displacement, keeping the jittered hull watertight —
 * unlike drawing from a serial RNG stream, which would tear shared corners.
 */
function vhash(x: number, y: number, z: number, s: number): number {
  const ix = Math.round(x * 512) | 0;
  const iy = Math.round(y * 512) | 0;
  const iz = Math.round(z * 512) | 0;
  let h =
    (Math.imul(ix, 374761393) +
      Math.imul(iy, 668265263) +
      Math.imul(iz, 2246822519) +
      Math.imul(s, 1274126177)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Displace every vertex by a position-hashed offset, then reflatten normals. */
function jitterVertices(geo: THREE.BufferGeometry, amp: number, s: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(
      i,
      x + (vhash(x, y, z, s) - 0.5) * amp,
      y + (vhash(x, y, z, s + 101) - 0.5) * amp,
      z + (vhash(x, y, z, s + 202) - 0.5) * amp,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals(); // non-indexed polyhedra stay faceted (flat)
}

/* ------------------------------ kit geometry ------------------------------ */

/**
 * Irregular rubble chunk: two jittered low-poly dodecahedra fused into one
 * asymmetric mass (mergeGeometries), so a single 72-tri geometry reads as a
 * broken concrete lump rather than a maths solid from any angle.
 */
function makeRubbleGeo(): THREE.BufferGeometry {
  const a = new THREE.DodecahedronGeometry(0.5, 0);
  jitterVertices(a, 0.22, 11);
  const b = new THREE.DodecahedronGeometry(0.5, 0);
  jitterVertices(b, 0.22, 12);
  b.scale(0.72, 0.6, 0.72);
  b.translate(0.3, -0.12, 0.18);
  const merged = mergeGeometries([a, b])!;
  a.dispose();
  b.dispose();
  return merged;
}

/**
 * Shattered slab: 1.2 x 0.15 x 0.8 with pre-bevelled edges (extruded shape
 * with a 1-segment bevel) — the chamfer catches the raking key light so slabs
 * read as cast plates instead of flat-shaded boxes, at ~zero extra cost.
 */
function makeSlabGeo(): THREE.BufferGeometry {
  const bevel = 0.03;
  const hw = 0.6 - bevel;
  const hd = 0.4 - bevel;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo(hw, -hd);
  shape.lineTo(hw, hd);
  shape.lineTo(-hw, hd);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.15 - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  // Extrusion runs along +z; stand the slab flat with thickness on y.
  geo.rotateX(-Math.PI / 2);
  geo.center();
  // Fracture the perfect rectangle so slabs read as broken rockcrete, not tiles.
  jitterVertices(geo, 0.06, 21);
  return geo;
}

/**
 * Ash pebble clump: three jittered mini icosahedra merged into one geometry,
 * so each instance reads as a scatter of 3 pebbles — triple the apparent
 * density for a single instance slot.
 */
function makePebbleGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spots: Array<[number, number, number, number]> = [
    [0, 0, 0, 0.15],
    [0.22, -0.02, 0.1, 0.1],
    [-0.16, -0.03, -0.14, 0.09],
  ];
  for (let i = 0; i < spots.length; i++) {
    const [x, y, z, r] = spots[i];
    const g = new THREE.IcosahedronGeometry(r, 0);
    jitterVertices(g, r * 0.4, 31 + i);
    g.translate(x, y, z);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

/* ------------------------------- placement -------------------------------- */

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Local features (terrain/objectives) drive the 2x near-density weight. */
  local: boolean;
}

/** Distance from a table point to a rect's boundary (0 inside). */
function rectDist(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dy = Math.max(r.minY - y, 0, y - r.maxY);
  return Math.hypot(dx, dy);
}

/** Precompute padded exclusion rects + local-feature classification. */
function prepRects(spec: BoardSpec, avoid: AvoidRect[]): Rect[] {
  return avoid.map((a) => ({
    minX: a.x - a.w / 2 - RECT_PAD,
    maxX: a.x + a.w / 2 + RECT_PAD,
    minY: a.y - a.d / 2 - RECT_PAD,
    maxY: a.y + a.d / 2 + RECT_PAD,
    // Full-board bands (deployment zones) are not "features" — anything
    // smaller (terrain footprints, objective pads) attracts extra debris.
    local: a.w < spec.width * 0.95 && a.d < spec.height * 0.95,
  }));
}

/** True when (x, y) is outside every padded avoid rect and the edge margin. */
function allowed(rects: Rect[], spec: BoardSpec, x: number, y: number): boolean {
  if (
    x < EDGE_MARGIN ||
    x > spec.width - EDGE_MARGIN ||
    y < EDGE_MARGIN ||
    y > spec.height - EDGE_MARGIN
  ) {
    return false;
  }
  for (const r of rects) {
    if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) return false;
  }
  return true;
}

/** True when within `NEAR_RANGE` of any local feature (=> full density). */
function nearFeature(rects: Rect[], x: number, y: number): boolean {
  for (const r of rects) {
    if (r.local && rectDist(r, x, y) <= NEAR_RANGE) return true;
  }
  return false;
}

/**
 * Rejection-sample one legal, density-weighted table position into `out`.
 * Candidates in the open field are kept with probability `FAR_KEEP`, so
 * debris near terrain lands at 2x the open-field density. Returns false if
 * `MAX_TRIES` candidates all fail (crowded board) — the caller skips the slot.
 */
function samplePos(
  rects: Rect[],
  spec: BoardSpec,
  rng: () => number,
  out: { x: number; y: number },
): boolean {
  for (let i = 0; i < MAX_TRIES; i++) {
    const x = EDGE_MARGIN + rng() * (spec.width - 2 * EDGE_MARGIN);
    const y = EDGE_MARGIN + rng() * (spec.height - 2 * EDGE_MARGIN);
    if (!allowed(rects, spec, x, y)) continue;
    if (!nearFeature(rects, x, y) && rng() >= FAR_KEEP) continue;
    out.x = x;
    out.y = y;
    return true;
  }
  return false;
}

/* --------------------------------- build ---------------------------------- */

/**
 * Build the instanced scatter kits for one board. Host contract: attach
 * `group` under the board group (table origin = board bottom-left, handled
 * here via the shared world mapping), call `dispose` on teardown. No
 * `update` hook — the litter is completely static.
 */
export function buildScatter(
  spec: BoardSpec,
  avoid: AvoidRect[],
  q: GfxQuality,
  seed: number,
): Built {
  const group = new THREE.Group();
  group.name = 'gfx-scatter';

  const rects = prepRects(spec, avoid);
  const counts = COUNTS[q.tier];

  // Shared scratch objects for instance composition (build-time only, but
  // reused anyway so the fill loops stay allocation-light).
  const M = new THREE.Matrix4();
  const P = new THREE.Vector3();
  const S = new THREE.Vector3();
  const E = new THREE.Euler();
  const QT = new THREE.Quaternion();
  const Q2 = new THREE.Quaternion();
  const AXIS = new THREE.Vector3();
  const YUP = new THREE.Vector3(0, 1, 0);
  const C = new THREE.Color();
  const pos = { x: 0, y: 0 };

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const meshes: THREE.InstancedMesh[] = [];

  /** Table -> world (inches; boardGroup is centred on the world origin). */
  const wx = (tx: number): number => tx - spec.width / 2;
  const wz = (ty: number): number => -(ty - spec.height / 2);

  /**
   * One kit = one InstancedMesh. Material colour stays white so
   * `instanceColor` IS the albedo (set per instance in full HSL, keeping the
   * readability clamp in one place). Never raycast: picking must always fall
   * through litter to the battlemat / unit bases.
   */
  const makeKit = (
    name: string,
    geo: THREE.BufferGeometry,
    capacity: number,
    matProps: THREE.MeshStandardMaterialParameters,
    receiveShadow: boolean,
  ): THREE.InstancedMesh => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, ...matProps });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(capacity, 1));
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    mesh.raycast = () => {};
    geos.push(geo);
    mats.push(mat);
    meshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  /** Compose + write one instance; returns the next free index. */
  const put = (mesh: THREE.InstancedMesh, i: number): number => {
    M.compose(P, QT, S);
    mesh.setMatrixAt(i, M);
    mesh.setColorAt(i, C);
    return i + 1;
  };

  /** Clamp per-instance albedo into the readability band (see header). */
  const setHSL = (h: number, s: number, l: number): void => {
    C.setHSL(((h % 1) + 1) % 1, Math.min(s, 0.35), Math.min(l, 0.3));
  };

  /* -- kit 1: rubble chunks — jittered low-poly lumps, sunk 25% ------------ */
  {
    const rng = sRNG(seed + 1);
    const baseHSL = { h: 0, s: 0, l: 0 };
    new THREE.Color('#3c3f45').getHSL(baseHSL);
    const mesh = makeKit(
      'scatter-rubble',
      makeRubbleGeo(),
      counts.rubble,
      { roughness: 0.95, metalness: 0.0, flatShading: true },
      true,
    );
    let n = 0;
    for (let i = 0; i < counts.rubble; i++) {
      if (!samplePos(rects, spec, rng, pos)) continue;
      const s = 0.2 + rng() * 0.5; // 0.2–0.7
      const sy = s * (0.5 + rng() * 0.4); // squashed: y * 0.5–0.9
      S.set(s, sy, s);
      QT.setFromEuler(E.set(rng() * TAU, rng() * TAU, rng() * TAU));
      // Sunk 25% of the chunk's height + jitter — always intersects the
      // displaced ground (range [-0.12, +0.03]) instead of floating on it.
      P.set(wx(pos.x), 0.25 * s + (rng() * 2 - 1) * Y_JITTER, wz(pos.y));
      setHSL(
        baseHSL.h + (rng() * 2 - 1) * 0.015,
        0.05 + rng() * 0.07,
        0.14 + rng() * 0.12,
      );
      n = put(mesh, n);
    }
    mesh.count = n;
  }

  /* -- kit 2: shattered slabs — tilted plates, 30% stacked pairs ------------ */
  {
    const rng = sRNG(seed + 2);
    const baseHSL = { h: 0, s: 0, l: 0 };
    new THREE.Color('#4c4f55').getHSL(baseHSL);
    const mesh = makeKit(
      'scatter-slabs',
      makeSlabGeo(),
      counts.slab,
      { roughness: 0.9, metalness: 0.0 },
      true,
    );
    // The one kit big enough to earn shadow-map cost — high tier only.
    mesh.castShadow = q.tier === 'high';
    let n = 0;
    while (n < counts.slab) {
      if (!samplePos(rects, spec, rng, pos)) break;
      const s = 0.6 + rng() * 0.8; // 0.6–1.4
      const yaw = rng() * TAU;
      const tilt = rng() * 18 * DEG;
      const az = rng() * TAU;
      S.set(s * (0.7 + rng() * 0.8), s * (0.8 + rng() * 0.4), s * (0.5 + rng() * 1.0));
      Q2.setFromAxisAngle(YUP, yaw);
      AXIS.set(Math.cos(az), 0, Math.sin(az));
      QT.setFromAxisAngle(AXIS, tilt).multiply(Q2);
      // Rest below half-thickness: the low edge digs into the ash.
      P.set(wx(pos.x), 0.06 * s + (rng() * 2 - 1) * Y_JITTER, wz(pos.y));
      setHSL(baseHSL.h + (rng() * 2 - 1) * 0.01, 0.08 + rng() * 0.06, 0.16 + rng() * 0.12);
      n = put(mesh, n);
      // 30% stacked pairs: second plate dropped on top, yawed 20–60 deg.
      if (n < counts.slab && rng() < 0.3) {
        const s2 = s * (0.8 + rng() * 0.25);
        S.set(s2 * (0.7 + rng() * 0.8), s2, s2 * (0.5 + rng() * 1.0));
        Q2.setFromAxisAngle(YUP, yaw + (20 + rng() * 40) * DEG * (rng() < 0.5 ? 1 : -1));
        AXIS.set(Math.cos(az + 1.7), 0, Math.sin(az + 1.7));
        QT.setFromAxisAngle(AXIS, rng() * 10 * DEG).multiply(Q2);
        P.set(
          wx(pos.x) + (rng() * 2 - 1) * 0.15,
          0.06 * s + 0.15 * s2,
          wz(pos.y) + (rng() * 2 - 1) * 0.15,
        );
        setHSL(baseHSL.h + (rng() * 2 - 1) * 0.01, 0.08 + rng() * 0.06, 0.16 + rng() * 0.12);
        n = put(mesh, n);
      }
    }
    mesh.count = n;
  }

  /* -- kit 3: scorched stakes — leaning charred pikes ----------------------- */
  {
    const rng = sRNG(seed + 3);
    const baseHSL = { h: 0, s: 0, l: 0 };
    new THREE.Color('#23272e').getHSL(baseHSL);
    const geo = new THREE.ConeGeometry(0.14, 2.2, 5);
    geo.translate(0, 1.1, 0); // base at y=0, tip up — lean pivots at the ground
    const mesh = makeKit(
      'scatter-stakes',
      geo,
      counts.stake,
      { roughness: 0.55, metalness: 0.75, flatShading: true },
      false,
    );
    let n = 0;
    for (let i = 0; i < counts.stake; i++) {
      if (!samplePos(rects, spec, rng, pos)) continue;
      const s = 0.7 + rng() * 0.6; // 0.7–1.3
      const az = rng() * TAU;
      S.set(s, s, s);
      Q2.setFromAxisAngle(YUP, rng() * TAU);
      AXIS.set(Math.cos(az), 0, Math.sin(az));
      QT.setFromAxisAngle(AXIS, (5 + rng() * 20) * DEG).multiply(Q2);
      // Base buried well past the deepest ground dip (-0.12).
      P.set(wx(pos.x), -0.15 * s + (rng() * 2 - 1) * Y_JITTER, wz(pos.y));
      if (rng() < 0.15) {
        setHSL(0.05, 0.3, 0.09 + rng() * 0.05); // rusted iron tint
      } else {
        setHSL(baseHSL.h, baseHSL.s, 0.08 + rng() * 0.06); // cold scorched steel
      }
      n = put(mesh, n);
    }
    mesh.count = n;
  }

  /* -- kit 4: spent shell casings — brass clusters, HIGH tier only ---------- */
  if (counts.casing > 0) {
    const rng = sRNG(seed + 4);
    const baseHSL = { h: 0, s: 0, l: 0 };
    new THREE.Color('#6b5a2e').getHSL(baseHSL);
    const mesh = makeKit(
      'scatter-casings',
      new THREE.CylinderGeometry(0.05, 0.05, 0.28, 6),
      counts.casing,
      { roughness: 0.35, metalness: 0.9 },
      false,
    );
    let n = 0;
    // Casings spawn in clusters of 4–8 within a 0.6" radius — reads as a
    // firing position rather than uniform confetti.
    while (n < counts.casing) {
      if (!samplePos(rects, spec, rng, pos)) break;
      const clusterN = 4 + Math.floor(rng() * 5);
      for (let k = 0; k < clusterN && n < counts.casing; k++) {
        const r = rng() * 0.6;
        const a = rng() * TAU;
        const cx = pos.x + Math.cos(a) * r;
        const cy = pos.y + Math.sin(a) * r;
        if (!allowed(rects, spec, cx, cy)) continue;
        const s = 0.8 + rng() * 0.4;
        S.set(s, s, s);
        // Lying on the side: roll ~90 deg about x (±15), then random yaw.
        QT.setFromEuler(E.set((90 + (rng() * 2 - 1) * 15) * DEG, 0, 0));
        Q2.setFromAxisAngle(YUP, rng() * TAU);
        QT.premultiply(Q2);
        P.set(wx(cx), 0.04 * s + (rng() * 2 - 1) * 0.01, wz(cy));
        // Brass accent — the one deliberate glint, capped by the HSL clamp.
        setHSL(baseHSL.h + (rng() * 2 - 1) * 0.01, 0.3 + rng() * 0.05, 0.18 + rng() * 0.12);
        n = put(mesh, n);
      }
    }
    mesh.count = n;
  }

  /* -- kit 5: ash pebble clumps — 3 pebbles per instance, half sunk --------- */
  {
    const rng = sRNG(seed + 5);
    const mesh = makeKit(
      'scatter-pebbles',
      makePebbleGeo(),
      counts.pebble,
      { roughness: 1.0, metalness: 0.0, flatShading: true },
      true,
    );
    let n = 0;
    for (let i = 0; i < counts.pebble; i++) {
      if (!samplePos(rects, spec, rng, pos)) continue;
      const s = 0.6 + rng() * 1.0; // 0.6–1.6
      S.set(s, s * (0.6 + rng() * 0.3), s);
      QT.setFromAxisAngle(YUP, rng() * TAU);
      // Clump origin at ground level => lower halves buried in the ash.
      P.set(wx(pos.x), -0.02 * s + (rng() * 2 - 1) * Y_JITTER, wz(pos.y));
      setHSL(0.60 + (rng() * 2 - 1) * 0.015, 0.03 + rng() * 0.05, 0.14 + rng() * 0.1);
      n = put(mesh, n);
    }
    mesh.count = n;
  }

  // Finalise: instance-aware bounds so culling works with the real spread.
  for (const mesh of meshes) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  return {
    group,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose(); // frees instance GPU buffers
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      group.clear();
    },
  };
}
