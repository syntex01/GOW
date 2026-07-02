/**
 * Ruined gothic terrain for the rules' TerrainPiece footprints.
 *
 * The engine's terrain rectangles are RULES geometry (line of sight, cover,
 * movement clearance). This module dresses them without ever changing them:
 * every visual stays inside the footprint (worst offender: a banner cloth
 * 0.06in proud of a wall face — well under the 0.3in tolerance).
 *
 *  - 'ruin'   → a broken multi-storey gothic shell: the SAME 4-segment wall
 *    plan the rules were balanced around (back full W, front 0.55W, left full
 *    D, right 0.55D), but each wall is now a THREE.Shape — jagged broken-top
 *    silhouette, punched lancet windows, a pointed-arch door — extruded 0.35in
 *    thin, with pilaster buttresses, an interior partition + upper-floor stub
 *    on large pieces, a fallen column, rebar sprouting from broken tops, a
 *    rubble skirt hugging the wall bases and (usually) one tattered banner.
 *  - 'crater' → a lathe bowl with a raised, vertex-jittered rim, scorched
 *    vertex-colour gradient (near-black centre → ash rim), slag rocks and a
 *    few pulsing ember pinpricks that feed the bloom pass.
 *
 * Perf strategy — merge aggressively, share everything:
 *  - Materials + PBR texture sets (stone masonry / near-black iron) are
 *    created ONCE and shared by every piece.
 *  - Per ruin: ALL masonry (walls, pilasters, partition, floor slab, column,
 *    rubble) merges into one mesh; all rebar into a second; the banner is a
 *    third. ⇒ 2–3 draw calls per ruin (budget ≤4).
 *  - Per crater: bowl+slag merge into one mesh, embers into another ⇒ 2
 *    draw calls (budget ≤2).
 *  - `update()` allocates nothing: banner cloth waves by rewriting a few
 *    preallocated z components; ember pulse writes one shared material colour
 *    from per-crater `onBeforeRender` closures (uniforms refresh per draw, so
 *    one shared material still yields per-crater phase).
 *
 * Readability: wall albedo is lifted into a warm mid plascrete tone with a
 * soot gradient pulling the lowest 1.2in down toward the dark ground band, so
 * structures read clearly against the mat while unit colours stay dominant.
 * The only saturated accents are the tiny embers (they exist to bloom).
 *
 * Determinism: every piece derives its RNG as sRNG(seed + index*7919); the
 * shared texture sets use fixed offsets of the module seed. No Math.random.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sRNG, tableToWorld } from './contract';
import type { BoardSpec, Built, GfxQuality, PBRSet } from './contract';
import { makeMetalSet, makeStoneSet } from './textures';
import type { TerrainPiece } from '../../engine/types';

const TAU = Math.PI * 2;

/** Wall thickness (in). Outer face sits flush ON the footprint edge, inset inward. */
const TH = 0.35;
/** Stone masonry tile size in inches (extrude UVs are shape-space inches / this). */
const UV_TILE = 4;
const UV_S = 1 / UV_TILE;
/**
 * Abutting walls are pulled back this much at their ends so end-cap faces are
 * never coplanar with the perpendicular wall's face (z-fighting killer). The
 * 0.02in notch at outer corners is invisible at table scale.
 */
const END_INSET = 0.02;
/** Linear multiplier at the wall base of the soot gradient (≈0.12 vs 0.22 band). */
const SOOT_FLOOR = 0.3;
/** Ember brightness multiplier — pushes the pulse peak over the bloom threshold. */
const EMBER_GAIN = 1.7;

/* ------------------------------------------------------------------------ */
/*                              small utilities                              */
/* ------------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Deterministic position-hash noise (0..1). Used for per-vertex value noise
 * so tinting never consumes the piece RNG stream (keeps layout rng stable no
 * matter how many vertices a tier produces).
 */
function vNoise3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Matrix helpers — build-time only (never in update()). */
function mat(rotY: number, x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
}
function trans(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}
function rotXM(a: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationX(a);
}
function rotYM(a: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(a);
}
function rotZM(a: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationZ(a);
}
/** Compose left→right: mul(A,B,C) = A·B·C (C applied to points first). */
function mul(...ms: THREE.Matrix4[]): THREE.Matrix4 {
  const out = ms[0].clone();
  for (let i = 1; i < ms.length; i++) out.multiply(ms[i]);
  return out;
}

/**
 * Normalise a geometry for merging (all merge inputs must be non-indexed
 * because ExtrudeGeometry is), bake its transform, scale UVs to the shared
 * masonry texel density, and push it onto the merge list. The input geometry
 * is consumed (disposed if it was replaced by its non-indexed copy).
 */
function collect(
  list: THREE.BufferGeometry[],
  geo: THREE.BufferGeometry,
  m: THREE.Matrix4 | null,
  uvScale: number,
): void {
  let g = geo;
  if (g.index) {
    const ni = g.toNonIndexed();
    g.dispose();
    g = ni;
  }
  if (m) g.applyMatrix4(m);
  if (uvScale !== 1) {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
    }
  }
  list.push(g);
}

/** Merge + dispose the sources. Returns null when the list is empty. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null; // attribute mismatch — cannot happen with collect()
  return merged;
}

/** Constant vertex colour (linear), with a little per-vertex value jitter. */
function paintSolid(
  geo: THREE.BufferGeometry,
  c: THREE.Color,
  jitter: number,
): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n =
      1 + (vNoise3(pos.getX(i) * 5.1, pos.getY(i) * 4.7, pos.getZ(i) * 5.3) - 0.5) * 2 * jitter;
    colors[i * 3] = c.r * n;
    colors[i * 3 + 1] = c.g * n;
    colors[i * 3 + 2] = c.b * n;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/* ------------------------------------------------------------------------ */
/*                       broken gothic wall construction                     */
/* ------------------------------------------------------------------------ */

/** One horizontal run of the broken-top silhouette (heights at both ends). */
interface Step {
  u0: number;
  u1: number;
  hL: number;
  hR: number;
}

interface WallShell {
  geo: THREE.BufferGeometry; // canonical frame: u along +x, y up, extruded z 0..TH
  steps: Step[];
  /** Lancet window centres along u (sill fixed at y=1.4, total 1.35 tall). */
  windows: number[];
  door: { c: number; halfW: number; springY: number; apexY: number } | null;
}

/**
 * Build one ruined wall as a single Shape → ExtrudeGeometry in a canonical
 * frame (origin at the wall's u=0 end, +z = extrusion = INTO the footprint).
 *
 * Silhouette: piecewise steps every 0.6–1.1in at 0.45–1.0 of full height; at
 * least one step keeps full height, ends adjacent to wall gaps collapse to a
 * 0.3–0.5H "ruin tail", and ~30% of steps get a 20–40° diagonal shear.
 *
 * Openings: the door is carved as a detour of the OUTER contour (a hole that
 * touches the bottom edge would degenerate triangulation); windows are Shape
 * holes. Both use two-arc POINTED gothic arches sized to the art spec's
 * bounding dims (window 0.9×1.35 above a 1.4 sill; door 1.4s×2.1s).
 */
function buildWallShell(
  len: number,
  H: number,
  wantDoor: boolean,
  allowWindows: boolean,
  tailStart: boolean,
  tailEnd: boolean,
  curveSegments: number,
  rng: () => number,
): WallShell {
  /* ---- broken-top steps -------------------------------------------------- */
  const steps: Step[] = [];
  let u = 0;
  while (u < len - 1e-3) {
    const w = Math.min(0.6 + rng() * 0.5, len - u);
    const h = H * (0.45 + rng() * 0.55);
    steps.push({ u0: u, u1: u + w, hL: h, hR: h });
    u += w;
  }
  if (steps.length === 0) steps.push({ u0: 0, u1: len, hL: H * 0.7, hR: H * 0.7 });
  // Fold a trailing sliver into its neighbour so no step is under ~0.35in.
  if (steps.length > 1 && steps[steps.length - 1].u1 - steps[steps.length - 1].u0 < 0.35) {
    const sliver = steps.pop()!;
    steps[steps.length - 1].u1 = sliver.u1;
  }

  /* ---- door (full-length walls only) ------------------------------------- */
  let door: WallShell['door'] = null;
  if (wantDoor) {
    // Scale the door down on short walls so the arch always fits under H.
    const s = clamp((0.75 * H) / 2.1, 0.6, 1);
    const halfW = 0.7 * s;
    const c = clamp(len / 2 + (rng() - 0.5) * 0.4 * len, halfW + 0.5, len - halfW - 0.5);
    door = { c, halfW, springY: 0.888 * s, apexY: 2.1 * s };
  }

  /* ---- guarantee one full-height step (never on a tail end) -------------- */
  const lo = tailStart ? 1 : 0;
  const hi = steps.length - (tailEnd ? 1 : 0);
  const full = lo < hi ? lo + Math.floor(rng() * (hi - lo)) : 0;
  steps[full].hL = steps[full].hR = H;

  /* ---- ruin tails at gap-adjacent ends ------------------------------------ */
  if (tailStart && steps.length > 1) {
    steps[0].hL = steps[0].hR = H * (0.3 + rng() * 0.2);
  }
  if (tailEnd && steps.length > 1) {
    const last = steps[steps.length - 1];
    last.hL = last.hR = H * (0.3 + rng() * 0.2);
  }

  /* ---- diagonal shear on ~30% of steps ------------------------------------ */
  for (const st of steps) {
    if (rng() < 0.3) {
      const drop = Math.min(
        (st.u1 - st.u0) * Math.tan(((20 + rng() * 20) * Math.PI) / 180),
        st.hL * 0.6,
      );
      if (rng() < 0.5) st.hR = Math.max(H * 0.28, st.hR - drop);
      else st.hL = Math.max(H * 0.28, st.hL - drop);
    }
  }

  /* ---- keep masonry above the door arch ----------------------------------- */
  if (door) {
    const need = Math.min(H, door.apexY + 0.3);
    for (const st of steps) {
      if (st.u1 > door.c - door.halfW - 0.2 && st.u0 < door.c + door.halfW + 0.2) {
        st.hL = Math.max(st.hL, need);
        st.hR = Math.max(st.hR, need);
      }
    }
  }

  const minTopOver = (a: number, b: number): number => {
    let m = H;
    for (const st of steps) {
      if (st.u1 > a && st.u0 < b) m = Math.min(m, st.hL, st.hR);
    }
    return m;
  };

  /* ---- lancet windows: sill 1.4, 0.9 wide, 1.35 tall, pitch 1.8 ----------- */
  const windows: number[] = [];
  if (allowWindows && H >= 3) {
    const first = 0.7 + 0.45; // 0.7 end margin to the window EDGE
    const span = len - 2 * first;
    if (span >= 0) {
      const n = Math.floor(span / 1.8) + 1;
      const start = first + (span - (n - 1) * 1.8) / 2;
      for (let wi = 0; wi < n; wi++) {
        const c = start + wi * 1.8;
        if (door && Math.abs(c - door.c) < door.halfW + 0.75) continue;
        // Skip windows whose arch would poke through the broken top (0.3 clear).
        if (minTopOver(c - 0.45, c + 0.45) < 2.75 + 0.3) continue;
        windows.push(c);
      }
    }
  }

  /* ---- outer contour (CCW) with the door as a bottom-edge detour ---------- */
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  if (door) {
    const dL = door.c - door.halfW;
    const dR = door.c + door.halfW;
    const R = door.halfW * 2; // two-arc pointed arch: radius = opening width
    shape.lineTo(dL, 0);
    shape.lineTo(dL, door.springY);
    shape.absarc(dR, door.springY, R, Math.PI, (Math.PI * 2) / 3, true);
    shape.absarc(dL, door.springY, R, Math.PI / 3, 0, true);
    shape.lineTo(dR, 0);
  }
  shape.lineTo(len, 0);
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    shape.lineTo(st.u1, st.hR); // vertical rise/drop into this step
    shape.lineTo(st.u0, st.hL); // the (possibly sheared) top run
  }

  /* ---- window holes (pointed arch atop a 0.57 rect ⇒ 1.35 total) ---------- */
  for (const c of windows) {
    const springY = 1.4 + 0.57;
    const p = new THREE.Path();
    p.moveTo(c - 0.45, 1.4);
    p.lineTo(c - 0.45, springY);
    p.absarc(c + 0.45, springY, 0.9, Math.PI, (Math.PI * 2) / 3, true);
    p.absarc(c - 0.45, springY, 0.9, Math.PI / 3, 0, true);
    p.lineTo(c + 0.45, 1.4);
    shape.holes.push(p);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: TH,
    bevelEnabled: false,
    curveSegments,
    steps: 1,
  });
  return { geo, steps, windows, door };
}

/**
 * Pilaster profile: 0.35 deep, chamfered 45° at the top (5-vertex shape).
 * Built with negative x so a rotY(+90°) maps profile-depth onto the wall's
 * inward (+z) axis without a reflection (which would flip normals).
 */
function pilasterShape(h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.35, 0);
  s.lineTo(-0.35, h - 0.35);
  s.lineTo(-0.06, h);
  s.lineTo(0, h);
  return s;
}

/* ------------------------------------------------------------------------ */
/*                           banner cloth textures                           */
/* ------------------------------------------------------------------------ */

interface BannerKit {
  map: THREE.CanvasTexture;
  alpha: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Tiny (texturePx/8 tall) canvas pair for the tattered banners: dark crimson
 * weathered albedo + a grayscale alpha with a torn bottom edge and a few
 * shot-holes. Alpha stays linear (it's coverage data, not colour).
 */
function makeBannerKit(q: GfxQuality, seed: number): BannerKit {
  const rng = sRNG(seed);
  const h = Math.max(64, Math.round(q.texturePx / 8));
  const w = h >> 1;

  const ac = document.createElement('canvas');
  ac.width = w;
  ac.height = h;
  const ax = ac.getContext('2d')!;
  // Dark crimson field, sooted toward the hem — stays well inside the dark band.
  const g = ax.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5a1512');
  g.addColorStop(0.7, '#4a110e');
  g.addColorStop(1, '#310b09');
  ax.fillStyle = g;
  ax.fillRect(0, 0, w, h);
  // A single pale central stripe — original gothic-industrial heraldry, no
  // real-world iconography.
  ax.fillStyle = 'rgba(196,176,140,0.12)';
  ax.fillRect(w * 0.42, h * 0.06, w * 0.16, h * 0.8);
  // Weave/grime noise + horizontal wear bands.
  for (let i = 0; i < 260; i++) {
    const v = 10 + Math.floor(rng() * 60);
    ax.fillStyle = `rgba(${v},${(v * 0.35) | 0},${(v * 0.3) | 0},${0.05 + rng() * 0.08})`;
    ax.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 6);
  }
  for (let i = 0; i < 5; i++) {
    const y = rng() * h;
    ax.fillStyle = `rgba(8,6,5,${0.08 + rng() * 0.1})`;
    ax.fillRect(0, y, w, 1 + rng() * 3);
  }
  const map = new THREE.CanvasTexture(ac);
  map.colorSpace = THREE.SRGBColorSpace;

  const tc = document.createElement('canvas');
  tc.width = w;
  tc.height = h;
  const tx = tc.getContext('2d')!;
  tx.fillStyle = '#ffffff';
  tx.fillRect(0, 0, w, h);
  // Torn hem: jagged black teeth biting up from the bottom edge.
  tx.fillStyle = '#000000';
  let x = 0;
  while (x < w) {
    const tw = w * (0.06 + rng() * 0.1);
    const td = h * (0.04 + rng() * 0.16);
    tx.beginPath();
    tx.moveTo(x, h);
    tx.lineTo(x + tw / 2, h - td);
    tx.lineTo(x + tw, h);
    tx.closePath();
    tx.fill();
    x += tw * (0.75 + rng() * 0.5);
  }
  // A few shot-holes / burn-throughs in the lower half.
  for (let i = 0; i < 4; i++) {
    tx.beginPath();
    tx.ellipse(
      rng() * w,
      h * (0.45 + rng() * 0.4),
      1 + rng() * (w * 0.05),
      1 + rng() * (w * 0.07),
      rng() * TAU,
      0,
      TAU,
    );
    tx.fill();
  }
  const alpha = new THREE.CanvasTexture(tc);

  return {
    map,
    alpha,
    dispose: () => {
      map.dispose();
      alpha.dispose();
    },
  };
}

/* ------------------------------------------------------------------------ */
/*                                 buildTerrain                              */
/* ------------------------------------------------------------------------ */

/** Per-banner animation record — everything preallocated for update(). */
interface BannerAnim {
  attr: THREE.BufferAttribute;
  array: Float32Array;
  /** Float32Array offsets of the animated z components (bottom two rows). */
  idx: Int32Array;
  base: Float32Array;
  amp: Float32Array;
  phase: Float32Array;
}

export function buildTerrain(
  pieces: TerrainPiece[],
  spec: BoardSpec,
  q: GfxQuality,
  seed: number,
): Built {
  const group = new THREE.Group();
  group.name = 'gfx:terrain';

  const disposables: Array<{ dispose: () => void }> = [];
  const banners: BannerAnim[] = [];
  /** Wall-clock for the ember onBeforeRender closures (written by update()). */
  let now = 0;

  const curveSegments = q.tier === 'high' ? 16 : q.tier === 'medium' ? 10 : 6;
  const embersPerCrater = q.tier === 'high' ? 8 : q.tier === 'medium' ? 5 : 3;

  /* ---- shared materials (create once, share across ALL pieces) ---------- */
  const hasRuin = pieces.some((p) => p.kind === 'ruin');
  const hasCrater = pieces.some((p) => p.kind === 'crater');

  let stoneMat: THREE.MeshStandardMaterial | null = null;
  let metalMat: THREE.MeshStandardMaterial | null = null;
  let bannerMat: THREE.MeshStandardMaterial | null = null;
  if (hasRuin) {
    const stoneSet: PBRSet = makeStoneSet(q, seed + 101);
    const metalSet: PBRSet = makeMetalSet(q, seed + 211);
    disposables.push(stoneSet, metalSet);

    // The shared ashlar map is authored dark (cold grey-blue ~#33353a); this
    // >1 linear tint lifts it into warm mid plascrete (~#5d5648 average) so
    // ruins read clearly against the near-black mat. The vertex-colour soot
    // gradient below pulls wall bases back down to the ~0.12 band.
    stoneMat = new THREE.MeshStandardMaterial({
      map: stoneSet.map,
      normalMap: stoneSet.normalMap,
      roughnessMap: stoneSet.roughnessMap,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.35,
    });
    stoneMat.color.setRGB(3.4, 2.7, 1.7);
    stoneMat.normalScale.set(0.6, 0.6);

    // Rebar/beam iron: near-black warm char (#2a2622 target after the lift),
    // metallic enough to catch the cold rim light.
    metalMat = new THREE.MeshStandardMaterial({
      map: metalSet.map,
      normalMap: metalSet.normalMap,
      roughnessMap: metalSet.roughnessMap,
      metalness: 0.85,
      roughness: 0.5,
      envMapIntensity: 0.7,
    });
    metalMat.color.setRGB(2.9, 2.2, 1.35);

    const bk = makeBannerKit(q, seed + 307);
    disposables.push(bk);
    bannerMat = new THREE.MeshStandardMaterial({
      map: bk.map,
      alphaMap: bk.alpha,
      alphaTest: 0.35, // cutout, not blended — no sorting artefacts, cheaper
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.15,
    });
    disposables.push(stoneMat, metalMat, bannerMat);
  }

  let craterMat: THREE.MeshStandardMaterial | null = null;
  let emberMat: THREE.MeshBasicMaterial | null = null;
  if (hasCrater) {
    // All crater colour lives in vertex colours (scorch gradient + slag), so
    // one untextured material covers every crater.
    craterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.02,
      envMapIntensity: 0.25,
    });
    // Shared ember material: per-crater phase is applied in onBeforeRender —
    // three refreshes material uniforms per draw call, so one material still
    // pulses each crater independently. Unlit + gain>1 so peaks feed bloom.
    emberMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    emberMat.color.setScalar(EMBER_GAIN * 0.8);
    disposables.push(craterMat, emberMat);
  }

  // Linear-space palette (THREE.Color(hex) converts sRGB→working space).
  const cCraterCentre = new THREE.Color(0x100e0c); // scorched char (~0.06)
  const cCraterRim = new THREE.Color(0x2f2b25); // cooled ash (~0.18)
  const cSlag = new THREE.Color(0x1c1814);
  const cEmber = new THREE.Color(0xff6a22);
  const cCrack = new THREE.Color(0x7a2408).multiplyScalar(0.4);
  const tmpColor = new THREE.Color();

  /* ---------------------------------------------------------------------- */
  /*                              ruin builder                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Vertical soot + value-noise vertex tint for merged masonry (positions are
   * piece-local, y = world up): ±8% value noise everywhere, and the lowest
   * 1.2in eased down to SOOT_FLOOR so wall bases sit near the ground band.
   */
  const tintMasonry = (geo: THREE.BufferGeometry): void => {
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const n =
        1 + (vNoise3(pos.getX(i) * 2.13, y * 2.71, pos.getZ(i) * 2.41) - 0.5) * 0.32;
      const soot = SOOT_FLOOR + (1 - SOOT_FLOOR) * smooth01(y / 1.2);
      const v = n * soot;
      colors[i * 3] = v;
      colors[i * 3 + 1] = v;
      colors[i * 3 + 2] = v * 0.99; // hair warmer, plascrete not blue
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  };

  /** Irregular rubble chunk (tetra/dodeca), squashed and tumbled. */
  const rubbleChunk = (
    list: THREE.BufferGeometry[],
    rng: () => number,
    x: number,
    z: number,
    s: number,
  ): void => {
    const geo =
      rng() < 0.35
        ? new THREE.TetrahedronGeometry(s * 1.25, 0)
        : new THREE.DodecahedronGeometry(s, 0);
    const m = mul(
      trans(x, s * 0.35, z), // sunk ~30% below grade
      rotYM(rng() * TAU),
      rotXM(rng() * TAU),
      new THREE.Matrix4().makeScale(1, 0.55 + rng() * 0.4, 1),
    );
    collect(list, geo, m, 0.3);
  };

  const buildRuin = (piece: TerrainPiece, rng: () => number, pg: THREE.Group): void => {
    if (!stoneMat || !metalMat || !bannerMat) return; // hasRuin guarantees these
    const hw = piece.width / 2;
    const hd = piece.depth / 2;
    const H = piece.height;
    const Lf = piece.width * 0.55; // front wall length (rules plan)
    const Lr = piece.depth * 0.55; // right wall length (rules plan)

    // Random corner anchors for the two partial walls (decided FIRST so the
    // rng stream for wall detailing is independent of later feature counts).
    const frontLeft = rng() < 0.5; // front wall hugs the left corner?
    const rightBack = rng() < 0.5; // right wall hugs the back corner?

    const stoneParts: THREE.BufferGeometry[] = [];
    const metalParts: THREE.BufferGeometry[] = [];
    /** Window records for banner placement: canonical→local matrix + u. */
    const windowRecs: Array<{ m: THREE.Matrix4; u: number }> = [];

    /*
     * Canonical wall frame: u along +x from the wall's start corner, y up,
     * extrusion z 0..TH pointing INTO the footprint; the outer face (z=0)
     * lies exactly ON the footprint edge. Piece-local mapping per wall:
     *   back  rotY(0)    origin (-hw, -hd)      u: left→right along the back
     *   front rotY(π)    origin (anchor, +hd)   u runs toward -x
     *   left  rotY(π/2)  origin (-hw, +hd)      u: front→back along the left
     *   right rotY(-π/2) origin (+hw, anchor)   u: start→front/back
     * Tail ends (gap-adjacent) fall out of which corners actually join.
     */
    interface WallDef {
      len: number;
      h: number;
      m: THREE.Matrix4;
      door: boolean;
      windows: boolean;
      pilasters: boolean;
      tailStart: boolean;
      tailEnd: boolean;
      full: boolean;
    }
    const defs: WallDef[] = [
      {
        len: piece.width,
        h: H,
        m: mat(0, -hw, 0, -hd),
        door: true,
        windows: true,
        pilasters: true,
        tailStart: false,
        tailEnd: !rightBack,
        full: true,
      },
      {
        len: Lf,
        h: H,
        m: mat(Math.PI, frontLeft ? -hw + Lf : hw, 0, hd),
        door: false,
        windows: true,
        pilasters: false,
        tailStart: frontLeft ? true : rightBack,
        tailEnd: !frontLeft,
        full: false,
      },
      {
        len: piece.depth,
        h: H,
        m: mat(Math.PI / 2, -hw, 0, hd),
        door: true,
        windows: true,
        pilasters: true,
        tailStart: !frontLeft,
        tailEnd: false,
        full: true,
      },
      {
        len: Lr,
        h: H,
        m: mat(-Math.PI / 2, hw, 0, rightBack ? -hd : hd - Lr),
        door: false,
        windows: true,
        pilasters: false,
        tailStart: !rightBack,
        tailEnd: rightBack ? true : frontLeft,
        full: false,
      },
    ];
    // Interior partition on large pieces (W≥8): half-depth spine at ±0.25W,
    // 0.6H tall, ragged at both ends. Same canonical machinery, no openings.
    if (piece.width >= 8) {
      const xoff = (rng() < 0.5 ? -1 : 1) * piece.width * 0.25;
      defs.push({
        len: piece.depth * 0.5,
        h: H * 0.6,
        m: mat(Math.PI / 2, xoff - TH / 2, 0, piece.depth * 0.25),
        door: false,
        windows: false,
        pilasters: false,
        tailStart: true,
        tailEnd: true,
        full: false,
      });
    }

    for (const def of defs) {
      const effLen = def.len - 2 * END_INSET;
      const wallM = mul(def.m, trans(END_INSET, 0, 0));
      const shell = buildWallShell(
        effLen,
        def.h,
        def.door,
        def.windows,
        def.tailStart,
        def.tailEnd,
        curveSegments,
        rng,
      );
      collect(stoneParts, shell.geo, wallM, UV_S);
      for (const wc of shell.windows) windowRecs.push({ m: wallM, u: wc });

      /* pilasters (inside face — outside would breach the footprint) */
      if (def.pilasters) {
        for (let p = 1.35; p <= effLen - 1.35; p += 2.4) {
          if (shell.door && Math.abs(p - shell.door.c) < shell.door.halfW + 0.55) continue;
          if (shell.windows.some((wc) => Math.abs(p - wc) < 0.85)) continue;
          let ph = Math.min(0.55 * def.h, def.h);
          for (const st of shell.steps) {
            if (st.u1 > p - 0.2 && st.u0 < p + 0.2) ph = Math.min(ph, st.hL, st.hR);
          }
          if (ph < 0.8) continue;
          const geo = new THREE.ExtrudeGeometry(pilasterShape(ph - 0.02), {
            depth: 0.3,
            bevelEnabled: false,
            curveSegments: 2,
            steps: 1,
          });
          collect(stoneParts, geo, mul(wallM, trans(p - 0.15, 0, TH), rotYM(Math.PI / 2)), UV_S);
        }
      }

      /* rebar: 40% of broken step-tops + door arch springs, 2–4 bent rods */
      const sites: Array<{ u: number; y: number }> = [];
      for (const st of shell.steps) {
        // Full-height steps are unbroken masonry — no rebar there.
        if (Math.min(st.hL, st.hR) > def.h - 0.05) continue;
        if (rng() < 0.4) sites.push({ u: (st.u0 + st.u1) / 2, y: Math.min(st.hL, st.hR) });
      }
      if (shell.door) {
        if (rng() < 0.4) sites.push({ u: shell.door.c - shell.door.halfW, y: shell.door.springY });
        if (rng() < 0.4) sites.push({ u: shell.door.c + shell.door.halfW, y: shell.door.springY });
      }
      for (const site of sites) {
        const nBars = 2 + Math.floor(rng() * 3);
        for (let b = 0; b < nBars; b++) {
          const bl = 0.3 + rng() * 0.3;
          // 15–60° off the wall normal ⇒ 30–75° polar tilt from vertical.
          const polar = ((30 + rng() * 45) * Math.PI) / 180;
          const baseM = mul(
            wallM,
            trans(site.u + (rng() - 0.5) * 0.3, site.y - 0.06, TH * 0.5),
            rotYM(rng() * TAU),
            rotXM(polar),
          );
          const main = new THREE.CylinderGeometry(0.02, 0.02, bl, 4, 1, true);
          main.translate(0, bl / 2, 0);
          collect(metalParts, main, baseM, 1);
          const tipLen = bl * 0.45;
          const tip = new THREE.CylinderGeometry(0.02, 0.02, tipLen, 4, 1, true);
          tip.translate(0, tipLen / 2, 0);
          collect(metalParts, tip, mul(baseM, trans(0, bl, 0), rotZM(0.5 + rng() * 0.5)), 1);
        }
      }
    }

    /* ---- interior upper-floor stub on large pieces ------------------------ */
    if (piece.width >= 8 && H >= 3.2) {
      const fy = Math.min(2.3, H * 0.58);
      const sw = piece.width * 0.42;
      const sd = piece.depth * 0.38;
      const sx = -hw + TH + sw / 2;
      const sz = -hd + TH + sd / 2;
      collect(stoneParts, new THREE.BoxGeometry(sw, 0.12, sd), trans(sx, fy, sz), 0.5);
      // Ragged broken edge: a few skewed stubs along the exposed slab edges.
      for (let i = 0; i < 3; i++) {
        const alongX = rng() < 0.5;
        const bx = alongX ? sx - sw / 2 + rng() * sw : sx + sw / 2 - 0.1;
        const bz = alongX ? sz + sd / 2 - 0.1 : sz - sd / 2 + rng() * sd;
        collect(
          stoneParts,
          new THREE.BoxGeometry(0.35 + rng() * 0.3, 0.12, 0.3 + rng() * 0.25),
          mul(trans(bx, fy - 0.01, bz), rotYM((rng() - 0.5) * 0.8)),
          0.5,
        );
      }
    }

    /* ---- fallen column(s) + drum fragments -------------------------------- */
    const nCols = 1 + (rng() < 0.35 ? 1 : 0);
    for (let c = 0; c < nCols; c++) {
      const colLen = 1.5 + rng();
      const yaw = rng() * TAU;
      const maxX = Math.max(0.4, hw - TH - colLen / 2 - 0.4);
      const maxZ = Math.max(0.4, hd - TH - colLen / 2 - 0.4);
      const px = (rng() - 0.5) * 2 * maxX * 0.7;
      const pz = (rng() - 0.5) * 2 * maxZ * 0.7;
      const col = new THREE.CylinderGeometry(0.22, 0.22, colLen, 8, 1);
      collect(stoneParts, col, mul(trans(px, 0.22, pz), rotYM(yaw), rotZM(Math.PI / 2)), 0.4);
      // Drum fragments scattered within 1in of one column end.
      const ex = px + Math.cos(yaw) * colLen * 0.5;
      const ez = pz - Math.sin(yaw) * colLen * 0.5;
      const nDrum = 2 + Math.floor(rng() * 2);
      for (let d = 0; d < nDrum; d++) {
        const a = rng() * TAU;
        const dist = 0.3 + rng() * 0.7;
        const dx = clamp(ex + Math.cos(a) * dist, -hw + 0.6, hw - 0.6);
        const dz = clamp(ez + Math.sin(a) * dist, -hd + 0.6, hd - 0.6);
        const drum = new THREE.CylinderGeometry(0.24, 0.24, 0.3, 8, 1);
        collect(
          stoneParts,
          drum,
          mul(trans(dx, 0.2, dz), rotYM(rng() * TAU), rotZM(Math.PI / 2)),
          0.4,
        );
      }
    }

    /* ---- rubble skirt hugging the wall bases + spill at the wall gaps ----- */
    const per = 2 * (piece.width + piece.depth);
    const nSkirt = 10 + Math.floor(rng() * 9);
    for (let i = 0; i < nSkirt; i++) {
      const t = rng() * per;
      const e = 0.18 + rng() * 0.37; // band: 0.5in inside the footprint edge
      let x: number;
      let z: number;
      if (t < piece.width) {
        x = -hw + t;
        z = -hd + e;
      } else if (t < piece.width + piece.depth) {
        x = hw - e;
        z = -hd + (t - piece.width);
      } else if (t < 2 * piece.width + piece.depth) {
        x = hw - (t - piece.width - piece.depth);
        z = hd - e;
      } else {
        x = -hw + e;
        z = hd - (t - 2 * piece.width - piece.depth);
      }
      rubbleChunk(stoneParts, rng, clamp(x, -hw + 0.5, hw - 0.5), clamp(z, -hd + 0.5, hd - 0.5), 0.15 + rng() * 0.3);
    }
    // Interior spill drifting in through the two wall gaps.
    const gapFrontX = frontLeft ? (-hw + Lf + hw) / 2 : (-hw + hw - Lf) / 2;
    const gapRightZ = rightBack ? (-hd + Lr + hd) / 2 : (-hd + hd - Lr) / 2;
    const nSpill = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < nSpill; i++) {
      const atFront = i % 2 === 0;
      const x = atFront
        ? clamp(gapFrontX + (rng() - 0.5) * 2.2, -hw + 0.6, hw - 0.6)
        : hw - TH - 0.3 - rng() * 1.1;
      const z = atFront
        ? hd - TH - 0.3 - rng() * 1.1
        : clamp(gapRightZ + (rng() - 0.5) * 2.2, -hd + 0.6, hd - 0.6);
      rubbleChunk(stoneParts, rng, x, z, 0.15 + rng() * 0.3);
    }

    /* ---- merge → 1 masonry + 1 rebar draw call ----------------------------- */
    const masonry = mergeParts(stoneParts);
    if (masonry) {
      tintMasonry(masonry);
      const mesh = new THREE.Mesh(masonry, stoneMat);
      mesh.name = `${piece.id}:masonry`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      pg.add(mesh);
      disposables.push(masonry);
    }
    const rebar = mergeParts(metalParts);
    if (rebar) {
      const mesh = new THREE.Mesh(rebar, metalMat);
      mesh.name = `${piece.id}:rebar`;
      // castShadow off: pixel-thin rods only shimmer in a PCF shadow map.
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      pg.add(mesh);
      disposables.push(rebar);
    }

    /* ---- tattered banner (60%), hung out of a window ----------------------- */
    if (windowRecs.length > 0 && rng() < 0.6) {
      const rec = windowRecs[Math.floor(rng() * windowRecs.length)];
      const geo = new THREE.PlaneGeometry(0.9, 1.8, 4, 8);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      pos.setUsage(THREE.DynamicDrawUsage);
      const arr = pos.array as Float32Array;
      // Bottom two vertex rows wave; amplitude 0.06 hem / 0.03 the row above.
      const idx: number[] = [];
      const amp: number[] = [];
      const phs: number[] = [];
      const basePhase = rng() * TAU;
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v);
        if (y > -0.66) continue;
        idx.push(v * 3 + 2);
        amp.push(y < -0.88 ? 0.06 : 0.03);
        phs.push(basePhase + pos.getX(v) * 2.8); // slight cross-cloth ripple
      }
      banners.push({
        attr: pos,
        array: arr,
        idx: Int32Array.from(idx),
        base: Float32Array.from(idx.map((k) => arr[k])),
        amp: Float32Array.from(amp),
        phase: Float32Array.from(phs),
      });
      const mesh = new THREE.Mesh(geo, bannerMat);
      mesh.name = `${piece.id}:banner`;
      // Top edge at the window arch apex (sill 1.4 + 1.35), draped down the
      // OUTER face (0.06 proud — inside the 0.3in footprint tolerance).
      mesh.applyMatrix4(
        mul(rec.m, trans(rec.u, 2.75 - 0.9, -0.06), rotZM((rng() - 0.5) * 0.08)),
      );
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      pg.add(mesh);
      disposables.push(geo);
    }
  };

  /* ---------------------------------------------------------------------- */
  /*                             crater builder                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Crater bowl profile as (radiusFraction, y·H) pairs. NOTE ON GRADE: the
   * art spec puts the floor below y=0, but the sibling board module renders
   * an opaque ground plane at grade that this module cannot cut holes into —
   * anything below it would be depth-occluded. So the profile keeps the exact
   * designed SHAPE (same deltas: floor −0.55H…rim +0.70H) lifted so the
   * centre sits at +0.03in; the raised rim + scorch gradient carry the depth
   * read. If the board ever gains crater cutouts, drop `lift` to 0.
   */
  const buildCrater = (piece: TerrainPiece, rng: () => number, pg: THREE.Group): void => {
    if (!craterMat || !emberMat) return; // hasCrater guarantees these
    const r = Math.min(piece.width, piece.depth) / 2;
    const H = piece.height;
    const lift = 0.65 * H + 0.03;
    const prof: Array<[number, number]> = [
      [0.0, -0.65 * H + lift],
      [0.16, -0.62 * H + lift],
      [0.35, -0.55 * H + lift], // bowl floor
      [0.52, -0.38 * H + lift],
      [0.68, -0.1 * H + lift],
      [0.82, 0.3 * H + lift], // inner shoulder
      [0.9, 0.55 * H + lift],
      [0.98, 0.7 * H + lift], // rim peak
      [1.0, 0.02], // skirt meets grade just above the mat (no z-fight)
    ];
    const profY = (f: number): number => {
      for (let i = 1; i < prof.length; i++) {
        if (f <= prof[i][0]) {
          const [f0, y0] = prof[i - 1];
          const [f1, y1] = prof[i];
          return y0 + ((y1 - y0) * (f - f0)) / (f1 - f0);
        }
      }
      return prof[prof.length - 1][1];
    };

    const seg = Math.max(24, q.ringSegments);
    const rings = prof.length;
    const lathe = new THREE.LatheGeometry(
      prof.map(([f, y]) => new THREE.Vector2(Math.max(f * r, 0), y)),
      seg,
    );

    // Rim jitter (±0.06 radial, ±0.04 vertical, ramped toward the rim). The
    // jitter table is indexed by (segment mod seg, ring) so the duplicated
    // seam column gets identical offsets and stays welded.
    const jr = new Float32Array(seg * rings);
    const jy = new Float32Array(seg * rings);
    for (let i = 0; i < seg * rings; i++) {
      jr[i] = (rng() - 0.5) * 0.12;
      jy[i] = (rng() - 0.5) * 0.08;
    }
    const lpos = lathe.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < lpos.count; v++) {
      const ring = v % rings;
      if (ring === 0) continue; // centre vertex stays put
      const col = Math.floor(v / rings) % seg;
      const w = ring / (rings - 1);
      const baseR = prof[ring][0] * r;
      if (baseR > 0.05) {
        // Outermost ring may only jitter INWARD — the footprint is law.
        const dr = ring === rings - 1 ? Math.min(0, jr[col * rings + ring]) : jr[col * rings + ring] * w;
        const k = (baseR + dr) / baseR;
        lpos.setX(v, lpos.getX(v) * k);
        lpos.setZ(v, lpos.getZ(v) * k);
      }
      lpos.setY(v, lpos.getY(v) + jy[col * rings + ring] * w);
    }
    // Smooth normals, and make sure the interior faces UP (lathe winding
    // depends on profile direction — flip indices if the net normal is down).
    lathe.computeVertexNormals();
    const nrm = lathe.getAttribute('normal');
    let ny = 0;
    for (let v = 0; v < nrm.count; v++) ny += nrm.getY(v);
    if (ny < 0) {
      const li = lathe.getIndex()!;
      for (let i = 0; i < li.count; i += 3) {
        const b = li.getX(i + 1);
        li.setX(i + 1, li.getX(i + 2));
        li.setX(i + 2, b);
      }
      li.needsUpdate = true;
      lathe.computeVertexNormals();
    }

    const bowlParts: THREE.BufferGeometry[] = [];
    const emberParts: THREE.BufferGeometry[] = [];

    // Scorch gradient: near-black glassed centre → ash-grey rim (0.06→0.18).
    {
      let bowl: THREE.BufferGeometry = lathe;
      const ni = bowl.toNonIndexed(); // merge inputs must be non-indexed
      bowl.dispose();
      bowl = ni;
      const pos = bowl.getAttribute('position');
      const colors = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const z = pos.getZ(v);
        const rf = clamp(Math.hypot(x, z) / r, 0, 1);
        tmpColor.lerpColors(cCraterCentre, cCraterRim, smooth01(rf));
        const n = 1 + (vNoise3(x * 3.7, pos.getY(v) * 5.1, z * 3.9) - 0.5) * 0.36;
        colors[v * 3] = tmpColor.r * n;
        colors[v * 3 + 1] = tmpColor.g * n;
        colors[v * 3 + 2] = tmpColor.b * n;
      }
      bowl.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      bowlParts.push(bowl);
    }

    /* ---- slag rocks: half riding the rim crest, half down the bowl -------- */
    const nSlag = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < nSlag; i++) {
      const s = 0.15 + rng() * 0.35;
      const onRim = i % 2 === 0;
      const rf = onRim ? Math.min(0.86 + rng() * 0.1, (r + 0.2 - s) / r) : 0.25 + rng() * 0.4;
      const a = rng() * TAU;
      const x = Math.cos(a) * rf * r;
      const z = Math.sin(a) * rf * r;
      const y = profY(rf) + s * 0.32;
      const rock = new THREE.DodecahedronGeometry(s, 0);
      paintSolid(rock, cSlag, 0.15);
      collect(bowlParts, rock, mul(trans(x, y, z), rotYM(rng() * TAU), rotXM(rng() * TAU)), 0.3);
      // 20%: a dim ember crack peeking from under the rock (rides the ember
      // mesh so the whole crater stays at two draw calls, and it pulses too).
      if (rng() < 0.2) {
        const crack = new THREE.IcosahedronGeometry(s * 0.55, 0);
        crack.scale(1, 0.35, 1);
        paintSolid(crack, cCrack, 0.1);
        collect(emberParts, crack, trans(x, y - s * 0.3, z), 1);
      }
    }

    /* ---- ember pinpricks on the bowl floor -------------------------------- */
    for (let i = 0; i < embersPerCrater; i++) {
      const rf = 0.1 + rng() * 0.4;
      const a = rng() * TAU;
      const ember = new THREE.IcosahedronGeometry(0.05, 0);
      tmpColor.copy(cEmber).multiplyScalar(0.75 + rng() * 0.25);
      paintSolid(ember, tmpColor, 0.05);
      collect(
        emberParts,
        ember,
        trans(Math.cos(a) * rf * r, profY(rf) + 0.03, Math.sin(a) * rf * r),
        1,
      );
    }

    const bowl = mergeParts(bowlParts);
    if (bowl) {
      const mesh = new THREE.Mesh(bowl, craterMat);
      mesh.name = `${piece.id}:bowl`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      pg.add(mesh);
      disposables.push(bowl);
    }
    const embers = mergeParts(emberParts);
    if (embers) {
      const mesh = new THREE.Mesh(embers, emberMat);
      mesh.name = `${piece.id}:embers`;
      mesh.matrixAutoUpdate = false;
      // Per-crater pulse phase on the SHARED material: uniforms are refreshed
      // per draw, so writing the colour just before this mesh renders gives
      // each crater its own phase with zero extra materials or allocations.
      const phase = rng() * TAU;
      const emat = emberMat;
      mesh.onBeforeRender = () => {
        emat.color.setScalar(EMBER_GAIN * (0.8 + 0.2 * Math.sin(now * 2 + phase)));
      };
      pg.add(mesh);
      disposables.push(embers);
    }
  };

  /* ---------------------------------------------------------------------- */
  /*                            assemble all pieces                          */
  /* ---------------------------------------------------------------------- */

  pieces.forEach((piece, index) => {
    // Contracted per-piece stream: layout is stable per board no matter how
    // other pieces change, and identical across reloads.
    const rng = sRNG(seed + index * 7919);
    const pg = new THREE.Group();
    pg.name = `terrain:${piece.id}`;
    pg.position.copy(tableToWorld(piece.center, spec, 0));
    if (piece.kind === 'ruin') buildRuin(piece, rng, pg);
    else buildCrater(piece, rng, pg);
    pg.updateMatrix();
    pg.matrixAutoUpdate = false; // static transforms — skip per-frame compose
    group.add(pg);
  });

  /* ---- per-frame hook: banner cloth + ember clock (zero allocations) ----- */
  const update = (t: number): void => {
    now = t;
    for (let b = 0; b < banners.length; b++) {
      const bn = banners[b];
      const arr = bn.array;
      for (let v = 0; v < bn.idx.length; v++) {
        arr[bn.idx[v]] = bn.base[v] + bn.amp[v] * Math.sin(t * 1.6 + bn.phase[v]);
      }
      bn.attr.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    for (const d of disposables) d.dispose();
  };

  return { group, update, dispose };
}
