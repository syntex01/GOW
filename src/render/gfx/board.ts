/**
 * gfx/board — the ground plane + gaming-table module.
 *
 * Builds, in one `Built` chunk:
 *  - "battlemat": a displaced, PBR-textured ground plane covering EXACTLY the
 *    playable rectangle. The host raycasts this mesh for picking, so it is
 *    returned separately as `matMesh` and its footprint never deviates from
 *    `spec.width x spec.height` (displacement moves Y only and tapers to 0 at
 *    the rim so the frame seam stays flush).
 *  - "zoneOverlay": the deployment-zone bands, stencilled chevrons, measured
 *    grid and centre line that the legacy `makeBattlematTextures` baked into
 *    the mat albedo — reproduced on a separate low-opacity unlit plane
 *    conformed 0.02" above the ground, so the scorched-ash PBR surface
 *    underneath stays clean and re-lightable.
 *  - a dark stone plinth slab and an ornate gothic-industrial table frame
 *    strictly OUTSIDE the play area: chamfered iron rails with engraved panel
 *    insets and pointed-arch brass fillets, corner bastion blocks topped by
 *    flickering braziers, instanced rivet studs, a brass inlay strip and a
 *    muted hazard-stripe skirt on the plinth sides.
 *
 * Perf contract (mid-range GPU):
 *  - <= 10 draw calls for everything here. Achieved by merging every static
 *    material batch with `mergeGeometries` and instancing the rivets/coals:
 *    ground(1) + overlay(1) + plinth(1) + iron(1) + brass(1) + panels(1) +
 *    hazard skirt(1) + rivets[instanced](1) + brazier coals[instanced](1) = 9
 *    (8 on 'low', which drops the rivet mesh).
 *  - Ground tris: ~59k high / ~21k medium / ~6k low; the conforming overlay
 *    runs at half the ground's segment density (~15k/5k/1.5k), keeping the
 *    pair comfortably under the 85k high-tier budget. The frame is ~5-6k tris
 *    plus one instanced rivet mesh.
 *  - `update(t)` only rewrites one material scalar (ember pulse) and a
 *    preallocated 4x3 instance-colour buffer (brazier flicker) — zero
 *    allocation per frame.
 *
 * Gameplay-readability contract:
 *  - Displacement is HARD-CLAMPED to [-0.12, +0.03] inches so bases sitting
 *    at y=0 never float or sink visibly, and the host's contact blobs at
 *    y=0.045 always clear the surface (max ground height +0.03).
 *  - The overlay draws unlit (MeshBasicMaterial) at ~0.18 opacity with
 *    depthWrite off and renderOrder -1: it never fights the ground for depth
 *    and every other transparent marker (rings, blobs, reach fields) sorts
 *    above it. Its raycast is a no-op so picking always falls through to the
 *    battlemat.
 *  - No faction colour is baked into the PBR albedo — zone paint lives only
 *    on the overlay plane, so the ground module owes nothing to scenario
 *    styling and the 0.05-0.35 albedo luminance band stays intact.
 *
 * Determinism: every random choice flows from `sRNG` streams derived from the
 * build seed. Crater dents use a dedicated stream `sRNG(seed + 2601)` drawing
 * (x, y, radius) triplets — documented so gfx/textures could mirror the same
 * 26 centres if burn-to-dent alignment is ever wanted; today the albedo's
 * scorch marks are laid out independently, which simply reads as a mix of
 * fresh burns and older, weathered impact dents.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sRNG, type BoardSpec, type Built, type GfxQuality } from './contract';
import { makeGroundSet, makeStoneSet, makeMetalSet } from './textures';

const TAU = Math.PI * 2;

/* ------------------------------ tuning knobs ------------------------------ */

/** Ground displacement clamp (inches). Units sit at y=0; blobs at y=0.045. */
const DISP_MIN = -0.12;
const DISP_MAX = 0.03;
/** Outer rim band over which displacement tapers to exactly 0 (flush seam). */
const RIM_TAPER = 1.5;
/** Ember-crack emissive: warm base tint + slow pulse that feeds the bloom. */
const EMBER_COLOR = 0xff5a22;
const EMBER_BASE = 0.55;
const EMBER_PULSE = 0.12; // ~22% swing — same ratio as the spec's 1.6 ± 0.35
/** Zone overlay plane: lift above the (displaced) ground + overall opacity. */
const OVERLAY_LIFT = 0.02;
const OVERLAY_OPACITY = 0.18;
/** Table frame section constants (inches) — all outside the play rectangle. */
const RAIL_W = 2.6; // rail thickness, outward from the play edge
const RAIL_TOP = 1.45; // rail top height (base sits at -0.05 on the plinth)
const RAIL_BASE = -0.05;
const BASTION = 3.2; // corner block footprint (flush with the play corner)
const PLINTH_OVER = 3.25; // plinth overhang past the play area per side
const PLINTH_H = 2.4;

/* --------------------------- deterministic noise --------------------------- */

/**
 * Integer lattice hash -> [0,1). Mulberry-style avalanche over (ix, iy, s) so
 * the height field is stable across builds and independent of evaluation
 * order (unlike drawing from a serial RNG stream per vertex, which would
 * couple the terrain shape to the vertex count / quality tier).
 */
function lat(ix: number, iy: number, s: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise on the unit lattice, range [0,1). */
function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lat(ix, iy, s);
  const b = lat(ix + 1, iy, s);
  const c = lat(ix, iy + 1, s);
  const d = lat(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Standard fBm over `vnoise` (lacunarity 2, gain 0.5), normalised to [0,1). */
function fbm2(x: number, y: number, octaves: number, s: number): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(fx, fy, s + o * 7919) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/* ------------------------------- the module ------------------------------- */

/**
 * Build the ground + gaming table. `matMesh` is the raycastable battlemat
 * plane (name 'battlemat'), guaranteed to cover exactly the board rectangle.
 */
export function buildBoard(
  spec: BoardSpec,
  q: GfxQuality,
  seed: number,
): Built & { matMesh: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'board';

  const { width: W, height: H } = spec;
  const hw = W / 2;
  const hh = H / 2;
  const high = q.tier === 'high';
  const low = q.tier === 'low';

  // Everything we create gets tracked for a complete dispose().
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  /* -------------------------- procedural PBR sets -------------------------- */
  // Distinct sub-seeds per set so re-rolling one surface never reshuffles the
  // others. The ground set is board-shaped (clamped, UV 0..1 across the mat);
  // the stone/metal sets tile (RepeatWrapping is baked in by gfx/textures).
  const groundSet = makeGroundSet(spec, q, seed);
  const stoneSet = makeStoneSet(q, seed + 101);
  const metalSet = makeMetalSet(q, seed + 202);

  // The mat is mostly seen at raking angles; a fixed anisotropy of 8 keeps
  // the crack/tread detail legible into the distance. gfx/textures leaves
  // anisotropy to consumers, and three clamps it to the device max, so a
  // constant is safe without renderer access (which this module doesn't get).
  for (const tx of [groundSet.map, groundSet.normalMap, groundSet.roughnessMap]) {
    tx.anisotropy = 8;
  }

  /* -------------------------- ground height field -------------------------- */
  // Crater dents draw 26 (x, y, radius) triplets from the dedicated stream
  // sRNG(seed + 2601) — see the module doc comment for the alignment note.
  const scorchRng = sRNG(seed + 2601);
  const SCORCH_N = 26;
  const craterX = new Float64Array(SCORCH_N);
  const craterY = new Float64Array(SCORCH_N);
  const craterR = new Float64Array(SCORCH_N);
  for (let i = 0; i < SCORCH_N; i++) {
    craterX[i] = 2 + scorchRng() * (W - 4);
    craterY[i] = 2 + scorchRng() * (H - 4);
    craterR[i] = (1.5 + scorchRng() * 3.5) * 1.2; // dent reads wider than burn
  }
  const nSeed = (seed ^ 0x68e31da4) | 0; // large-scale undulation lattice
  const mSeed = (seed ^ 0x2545f491) | 0; // micro-roughness lattice

  /**
   * Ground elevation (inches) at a table point. Large-scale fBm undulation
   * (4 octaves, ~10" cells) mapped to [-0.06, +0.03], plus fine ash
   * micro-roughness (±0.01, ~0.9" cells), plus smoothstep crater bowls
   * (-0.05 at each centre). Hard-clamped to [-0.12, +0.03] and tapered to
   * exactly 0 over the outer 1.5" rim so the mat meets the frame's inner lip
   * flush. Wheel-rut grooves from the art spec are intentionally left to the
   * normal map: at 0.25-0.75" vertex pitch a 0.35"-wide groove cannot be
   * resolved without shimmering aliasing.
   */
  const groundHeight = (tx: number, ty: number): number => {
    let e = -0.06 + fbm2(tx / 10, ty / 10, 4, nSeed) * 0.09;
    e += (vnoise(tx / 0.9, ty / 0.9, mSeed) - 0.5) * 0.02;
    for (let i = 0; i < SCORCH_N; i++) {
      const dx = tx - craterX[i];
      const dy = ty - craterY[i];
      const rr = craterR[i];
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) / rr;
        const s = d * d * (3 - 2 * d); // 0 at centre -> 1 at rim
        e -= 0.05 * (1 - s);
      }
    }
    if (e < DISP_MIN) e = DISP_MIN;
    else if (e > DISP_MAX) e = DISP_MAX;
    // Rim taper — guarantees y=0 (and thus a hidden seam) at the exact edge.
    const dEdge = Math.min(tx, W - tx, ty, H - ty);
    if (dEdge <= 0) return 0;
    if (dEdge < RIM_TAPER) {
      const t = dEdge / RIM_TAPER;
      e *= t * t * (3 - 2 * t);
    }
    return e;
  };

  /** Displace a flat (already rotated) plane's Y by the height field + lift. */
  const displace = (geo: THREE.BufferGeometry, lift: number): void => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const tx = pos.getX(i) + hw; // world x -> table x
      const ty = -pos.getZ(i) + hh; // world z -> table y
      pos.setY(i, groundHeight(tx, ty) + lift);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals(); // smooth: the indexed plane shares vertices
    geo.computeBoundingSphere();
  };

  /* ------------------------------- battlemat ------------------------------- */
  const segX = high ? 200 : low ? 64 : 120;
  const segY = Math.max(2, Math.round(segX * (H / W)));
  const matGeo = new THREE.PlaneGeometry(W, H, segX, segY);
  matGeo.rotateX(-Math.PI / 2); // flat on XZ; +v texture edge = table y max
  displace(matGeo, 0);
  geometries.push(matGeo);

  const matMat = new THREE.MeshStandardMaterial({
    map: groundSet.map,
    normalMap: groundSet.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: groundSet.roughnessMap,
    roughness: 1.0, // multiplies the map — pass it through untouched
    metalness: 0.0,
    envMapIntensity: 0.25, // matte ash; reflections stay whisper-quiet
  });
  // Ember cracks glow only where the emissive map is lit. Gated on the map:
  // without one, an emissive colour would wash the whole mat orange.
  const hasEmber = !!groundSet.emissiveMap;
  if (groundSet.emissiveMap) {
    matMat.emissiveMap = groundSet.emissiveMap;
    matMat.emissive = new THREE.Color(EMBER_COLOR);
    matMat.emissiveIntensity = EMBER_BASE;
  }
  materials.push(matMat);

  const matMesh = new THREE.Mesh(matGeo, matMat);
  matMesh.name = 'battlemat'; // the host raycasts this mesh for picking
  matMesh.receiveShadow = true;
  group.add(matMesh);

  /* ------------------------------ zone overlay ------------------------------ */
  // Same shapes the legacy makeBattlematTextures painted into the albedo —
  // deployment bands, dashed boundaries, chevrons, 6"/12" measured grid —
  // plus the halfway centre line, on their own plane. Canvas alphas are
  // pre-boosted ~2.2x because the whole plane renders at 0.18 opacity; the
  // relative strengths between fill / boundary / grid are preserved.
  const overlayTex = makeZoneOverlayTexture(spec, Math.min(q.texturePx, 1024));
  overlayTex.anisotropy = 4; // grid lines at grazing angles
  textures.push(overlayTex);
  const overlayMat = new THREE.MeshBasicMaterial({
    map: overlayTex,
    transparent: true,
    opacity: OVERLAY_OPACITY,
    depthWrite: false, // never occludes; blobs/rings above always win
  });
  materials.push(overlayMat);
  // Conform the overlay to the ground (half density is plenty — the height
  // field is smooth at that scale) so a +0.03 bump can never poke through it
  // and eat a grid line.
  const overlayGeo = new THREE.PlaneGeometry(
    W,
    H,
    Math.max(2, segX >> 1),
    Math.max(2, segY >> 1),
  );
  overlayGeo.rotateX(-Math.PI / 2);
  displace(overlayGeo, OVERLAY_LIFT);
  geometries.push(overlayGeo);
  const overlay = new THREE.Mesh(overlayGeo, overlayMat);
  overlay.name = 'zoneOverlay';
  overlay.renderOrder = -1; // first among transparents: all markers sort above
  overlay.raycast = () => {}; // picking must always fall through to the mat
  group.add(overlay);

  /* --------------------------------- plinth --------------------------------- */
  // Dark ashlar slab under everything: top at y=-0.05 so the mat plane (y=0)
  // reads as resting ON it. Built as an extrusion (not a Box) so the UVs come
  // out in world inches — scaled 1/8 below, the stone set tiles every 8" on
  // the caps and sides instead of stretching one tile across a 66" face.
  const phw = hw + PLINTH_OVER;
  const phh = hh + PLINTH_OVER;
  const plinthShape = new THREE.Shape();
  plinthShape.moveTo(-phw, -phh);
  plinthShape.lineTo(phw, -phh);
  plinthShape.lineTo(phw, phh);
  plinthShape.lineTo(-phw, phh);
  plinthShape.closePath();
  const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, {
    depth: PLINTH_H,
    bevelEnabled: false,
  });
  plinthGeo.rotateX(-Math.PI / 2); // extrusion axis -> +Y
  plinthGeo.translate(0, RAIL_BASE - PLINTH_H, 0); // top face at y=-0.05
  scaleUVs(plinthGeo, 1 / 8);
  geometries.push(plinthGeo);
  // Tint targets ~#0B0D11 after multiplying the stone albedo (linear-space
  // product of the ~#2d2f36 masonry mean and this grey lands on the spec).
  const plinthMat = new THREE.MeshStandardMaterial({
    map: stoneSet.map,
    normalMap: stoneSet.normalMap,
    roughnessMap: stoneSet.roughnessMap,
    color: 0x676c74,
    roughness: 0.85,
    metalness: 0.1,
    envMapIntensity: 0.3,
  });
  materials.push(plinthMat);
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.name = 'boardPlinth';
  plinth.receiveShadow = true;
  group.add(plinth);

  /* ------------------------------- table frame ------------------------------- */
  // Shared frame materials. The metal set's albedo is already near-black cold
  // iron (#121317 base), so it passes through untinted; brass and the panel
  // insets are plain tuned materials (small parts — a texture fetch would buy
  // nothing at their on-screen size).
  const ironMat = new THREE.MeshStandardMaterial({
    map: metalSet.map,
    normalMap: metalSet.normalMap,
    roughnessMap: metalSet.roughnessMap,
    roughness: 1.0, // roughnessMap carries the ~0.5 worn-iron base
    metalness: 0.85,
    envMapIntensity: 0.9,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0x7a6430,
    roughness: 0.4,
    metalness: 0.95,
    emissive: 0x1a1004, // faint constant warmth so brass never reads dead
    emissiveIntensity: 0.5,
    envMapIntensity: 1.0,
  });
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x0f1115,
    roughness: 0.7,
    metalness: 0.6,
    envMapIntensity: 0.5,
  });
  materials.push(ironMat, brassMat, panelMat);

  // Geometry batches accumulated per material, merged to one draw call each.
  const ironParts: THREE.BufferGeometry[] = [];
  const brassParts: THREE.BufferGeometry[] = [];
  const panelParts: THREE.BufferGeometry[] = [];
  const scraps: THREE.BufferGeometry[] = []; // intermediates freed post-merge
  const m4 = new THREE.Matrix4();
  const railM = new THREE.Matrix4();
  /** Clone `base`, transform by railM * translate(lx,ly,lz), add to `batch`. */
  const place = (
    base: THREE.BufferGeometry,
    batch: THREE.BufferGeometry[],
    lx: number,
    ly: number,
    lz: number,
  ): void => {
    const g = base.clone();
    m4.makeTranslation(lx, ly, lz).premultiply(railM);
    g.applyMatrix4(m4);
    batch.push(g);
    scraps.push(g);
  };

  // Chamfered rail profile (extruded along the rail): X = outward from the
  // play edge, Y = up. A 0.10"-high inner lip hugs the mat edge — it hides
  // the displaced mesh seam while staying below any unit's eye-line — then
  // the inner face rises to a 0.35" 45-degree top chamfer; a 0.12" outer
  // break stands in for the machined recess of the art spec.
  const railShape = new THREE.Shape();
  railShape.moveTo(0, RAIL_BASE);
  railShape.lineTo(0, 0.1); // inner lip face at the mat edge
  railShape.lineTo(0.25, 0.1); // lip ledge
  railShape.lineTo(0.25, RAIL_TOP - 0.35); // inner face (panels mount here)
  railShape.lineTo(0.6, RAIL_TOP); // 45-degree top chamfer
  railShape.lineTo(RAIL_W - 0.12, RAIL_TOP); // top plateau
  railShape.lineTo(RAIL_W, RAIL_TOP - 0.12); // outer machined break
  railShape.lineTo(RAIL_W, RAIL_BASE);
  railShape.closePath();
  const railGeoByLen = new Map<number, THREE.BufferGeometry>();
  const railGeo = (len: number): THREE.BufferGeometry => {
    let g = railGeoByLen.get(len);
    if (!g) {
      g = new THREE.ExtrudeGeometry(railShape, { depth: len, bevelEnabled: false });
      g.translate(0, 0, -len / 2); // centre the run on the rail's midpoint
      railGeoByLen.set(len, g);
      scraps.push(g);
    }
    return g;
  };

  // Shared detail geometry (cloned per placement, freed after the merge).
  const panelGeo = new THREE.BoxGeometry(0.06, 0.8, 4.5); // thick, tall, long
  const archGeo = new THREE.TorusGeometry(0.35, 0.05, 5, low ? 8 : 12, Math.PI);
  archGeo.rotateY(Math.PI / 2); // arc into the rail's (up, along) plane
  const filletGeoByLen = new Map<number, THREE.BufferGeometry>();
  scraps.push(panelGeo, archGeo);

  // Rivet stud world positions, collected while walking the rails/bastions.
  const rivetPos: Array<[number, number, number]> = [];
  const rivetPitch = high ? 1.5 : 3; // medium halves the stud count

  // The four rails tile the edge bands [±hw|±hh, +RAIL_W]; rail-local +X is
  // the outward direction and +Z runs along the rail. Table y+ is world -Z.
  const railDefs: Array<{ len: number; rot: number; px: number; pz: number; panels: number }> = [
    { len: W, rot: Math.PI / 2, px: 0, pz: -hh, panels: 9 }, // north (y max)
    { len: W, rot: -Math.PI / 2, px: 0, pz: hh, panels: 9 }, // south
    { len: H, rot: 0, px: hw, pz: 0, panels: 7 }, // east
    { len: H, rot: Math.PI, px: -hw, pz: 0, panels: 7 }, // west
  ];
  const worldPt = new THREE.Vector3();
  for (const def of railDefs) {
    railM.makeRotationY(def.rot).setPosition(def.px, 0, def.pz);

    // Structural rail beam.
    const rg = railGeo(def.len).clone();
    rg.applyMatrix4(railM);
    ironParts.push(rg);
    scraps.push(rg);

    // Brass top fillet strip along the plateau's inner edge — the warm
    // highlight line that catches the raking key light across the table.
    let fg = filletGeoByLen.get(def.len);
    if (!fg) {
      fg = new THREE.BoxGeometry(0.18, 0.06, def.len - 0.2);
      filletGeoByLen.set(def.len, fg);
      scraps.push(fg);
    }
    place(fg, brassParts, 0.85, RAIL_TOP + 0.03, 0);

    // Recessed gothic panels + pointed-arch brass fillets on the inner face.
    // The near-black plate sits 0.03" proud of the face; with the brass arch
    // outline it reads as an engraved inset without any boolean geometry.
    const pitch = (def.len - 4) / def.panels;
    for (let i = 0; i < def.panels; i++) {
      const zi = (i - (def.panels - 1) / 2) * pitch;
      place(panelGeo, panelParts, 0.25, 0.62, zi);
      if (!low) place(archGeo, brassParts, 0.24, 0.7, zi);
    }

    // Rivet rows along the outer half of the top plateau (skipped on 'low').
    if (!low) {
      const span = def.len / 2 - 2;
      for (let z = -span; z <= span + 1e-6; z += rivetPitch) {
        worldPt.set(1.9, RAIL_TOP + 0.05, z).applyMatrix4(railM);
        rivetPos.push([worldPt.x, worldPt.y, worldPt.z]);
      }
    }
  }

  // Corner bastion blocks: chamfered octagon towers filling the four corner
  // squares — flush with the play corners, never over them. The extrude bevel
  // re-expands the shape to the full 3.2" mid-section, giving the top/bottom
  // edges the same 0.5"-class chamfer as the corners.
  const bastShape = new THREE.Shape();
  {
    const hb = BASTION / 2 - 0.18;
    const chm = 0.5;
    bastShape.moveTo(-hb + chm, -hb);
    bastShape.lineTo(hb - chm, -hb);
    bastShape.lineTo(hb, -hb + chm);
    bastShape.lineTo(hb, hb - chm);
    bastShape.lineTo(hb - chm, hb);
    bastShape.lineTo(-hb + chm, hb);
    bastShape.lineTo(-hb, hb - chm);
    bastShape.lineTo(-hb, -hb + chm);
    bastShape.closePath();
  }
  const bastGeo = new THREE.ExtrudeGeometry(bastShape, {
    depth: 1.9 - 0.36,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.18,
    bevelSegments: 1,
  });
  bastGeo.rotateX(-Math.PI / 2); // stand the extrusion up (+Y)
  bastGeo.translate(0, 0.18 + RAIL_BASE, 0); // base flush with the rail base
  scraps.push(bastGeo);

  // Brazier bowl profile (10-point lathe): a shallow iron fire-bowl with a
  // rolled lip. The glowing coal disc inside is instanced separately so each
  // corner can flicker on its own phase without extra draw calls.
  const bowlPts: THREE.Vector2[] = [
    new THREE.Vector2(0.1, 0),
    new THREE.Vector2(0.3, 0.06),
    new THREE.Vector2(0.44, 0.16),
    new THREE.Vector2(0.52, 0.3),
    new THREE.Vector2(0.55, 0.44),
    new THREE.Vector2(0.53, 0.52),
    new THREE.Vector2(0.46, 0.56),
    new THREE.Vector2(0.34, 0.52),
    new THREE.Vector2(0.2, 0.46),
    new THREE.Vector2(0.12, 0.42),
  ];
  const bowlGeo = new THREE.LatheGeometry(bowlPts, low ? 10 : 12);
  scraps.push(bowlGeo);

  const bastTopY = RAIL_BASE + 1.9;
  const corners: Array<[number, number]> = [
    [hw + BASTION / 2, hh + BASTION / 2],
    [-(hw + BASTION / 2), hh + BASTION / 2],
    [hw + BASTION / 2, -(hh + BASTION / 2)],
    [-(hw + BASTION / 2), -(hh + BASTION / 2)],
  ];
  railM.identity(); // corner details place in plain world space
  for (const [cx, cz] of corners) {
    place(bastGeo, ironParts, cx, 0, cz);
    place(bowlGeo, ironParts, cx, bastTopY, cz);
    if (!low) {
      // Four brass studs on each bastion top.
      for (const [ox, oz] of [
        [0.9, 0.9],
        [-0.9, 0.9],
        [0.9, -0.9],
        [-0.9, -0.9],
      ] as Array<[number, number]>) {
        rivetPos.push([cx + ox, bastTopY + 0.05, cz + oz]);
      }
    }
  }

  /** Merge a batch (normalised to non-indexed) into one shadow-casting mesh. */
  const mergeBatch = (
    parts: THREE.BufferGeometry[],
    mat: THREE.Material,
    name: string,
  ): THREE.Mesh => {
    const normalised = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(normalised, false);
    for (const g of normalised) if (!parts.includes(g)) g.dispose(); // temp copies
    if (!merged) throw new Error(`gfx/board: mergeGeometries failed for ${name}`);
    geometries.push(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const ironMesh = mergeBatch(ironParts, ironMat, 'frameIron');
  // Extrude UVs are in world inches; 1/8 makes the metal set tile every ~8"
  // along the rails (its internal 4x4 panel grid then repeats every 2").
  scaleUVs(ironMesh.geometry, 1 / 8);
  mergeBatch(brassParts, brassMat, 'frameBrass');
  mergeBatch(panelParts, panelMat, 'framePanels');

  /* --------------------------- hazard-stripe skirt --------------------------- */
  // Muted 45-degree hazard inlay banding the plinth sides — grimdark set
  // dressing kept visually subordinate to gameplay overlays. One canvas
  // period tiles horizontally; each strip's U axis is scaled so the world
  // period is exactly 1.5" on every side regardless of board dimensions.
  const hazardTex = makeHazardTexture();
  textures.push(hazardTex);
  const hazardMat = new THREE.MeshStandardMaterial({
    map: hazardTex,
    roughness: 0.6,
    metalness: 0.3,
    envMapIntensity: 0.4,
  });
  materials.push(hazardMat);
  {
    const skirtY = -0.38; // just below the plinth's exposed top edge
    const eps = 0.012; // proud of the face — no coplanar z-fighting
    const strips: THREE.BufferGeometry[] = [];
    const skirt = (len: number, rotY: number, px: number, pz: number): void => {
      const g = new THREE.PlaneGeometry(len, 0.35);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 1.5));
      g.rotateY(rotY);
      g.translate(px, skirtY, pz);
      strips.push(g);
      scraps.push(g);
    };
    skirt(phw * 2, 0, 0, phh + eps); // south face (+Z)
    skirt(phw * 2, Math.PI, 0, -phh - eps); // north face (-Z)
    skirt(phh * 2, Math.PI / 2, phw + eps, 0); // east face (+X)
    skirt(phh * 2, -Math.PI / 2, -phw - eps, 0); // west face (-X)
    const merged = mergeGeometries(
      strips.map((g) => (g.index ? g.toNonIndexed() : g)),
      false,
    );
    if (!merged) throw new Error('gfx/board: mergeGeometries failed for frameHazard');
    geometries.push(merged);
    const mesh = new THREE.Mesh(merged, hazardMat);
    mesh.name = 'frameHazard';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /* ------------------------ instanced rivets + coals ------------------------ */
  let rivets: THREE.InstancedMesh | null = null;
  if (rivetPos.length > 0) {
    const rivetGeo = new THREE.SphereGeometry(0.09, 8, 6);
    geometries.push(rivetGeo);
    rivets = new THREE.InstancedMesh(rivetGeo, brassMat, rivetPos.length);
    rivets.name = 'frameRivets';
    for (let i = 0; i < rivetPos.length; i++) {
      const [x, y, z] = rivetPos[i];
      rivets.setMatrixAt(i, m4.makeTranslation(x, y, z));
    }
    rivets.instanceMatrix.needsUpdate = true;
    rivets.frustumCulled = false; // instances ring the whole table
    group.add(rivets);
  }

  // Brazier coals: four unlit HDR-orange discs, one per corner, instanced so
  // a single draw call still allows per-corner flicker phase via
  // instanceColor (MeshBasicMaterial multiplies it straight into the output;
  // values > 1 survive to the bloom threshold — four warm accents at the
  // table corners feeding the bloom pass).
  const coalGeo = new THREE.CylinderGeometry(0.34, 0.3, 0.1, low ? 10 : 12);
  geometries.push(coalGeo);
  const coalMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  materials.push(coalMat);
  const coals = new THREE.InstancedMesh(coalGeo, coalMat, corners.length);
  coals.name = 'frameCoals';
  const coalColors = new THREE.InstancedBufferAttribute(
    new Float32Array(corners.length * 3),
    3,
  );
  coals.instanceColor = coalColors;
  for (let k = 0; k < corners.length; k++) {
    const [cx, cz] = corners[k];
    coals.setMatrixAt(k, m4.makeTranslation(cx, bastTopY + 0.4, cz));
  }
  coals.instanceMatrix.needsUpdate = true;
  coals.frustumCulled = false;
  group.add(coals);

  // Free every intermediate clone/base now that the merges own the data.
  for (const g of scraps) g.dispose();
  scraps.length = 0;

  /* ------------------------------- update hook ------------------------------- */
  // Ember-crack pulse (slow smoulder) + brazier flicker (fast firelight).
  // Preallocated: writes one scalar and 12 floats — no per-frame allocation.
  const emberPhase = (seed % 628) / 100; // deterministic per-board phase
  const coalArr = coalColors.array as Float32Array;
  const COAL_R = 1.0; // #FF7A20
  const COAL_G = 0.478;
  const COAL_B = 0.125;
  const update = (t: number): void => {
    if (hasEmber) {
      matMat.emissiveIntensity = EMBER_BASE + EMBER_PULSE * Math.sin(t * 0.7 + emberPhase);
    }
    for (let k = 0; k < 4; k++) {
      const s = 2.2 + 0.5 * Math.sin(t * 9 + k * 1.7);
      coalArr[k * 3] = COAL_R * s;
      coalArr[k * 3 + 1] = COAL_G * s;
      coalArr[k * 3 + 2] = COAL_B * s;
    }
    coalColors.needsUpdate = true;
  };

  /* --------------------------------- dispose --------------------------------- */
  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const tx of textures) tx.dispose();
    rivets?.dispose(); // frees the instance-attribute GPU buffers
    coals.dispose();
    groundSet.dispose();
    stoneSet.dispose();
    metalSet.dispose();
  };

  return { group, update, dispose, matMesh };
}

/* ------------------------------ local helpers ------------------------------ */

/** Scale a geometry's UVs uniformly (retiles world-inch extrude UVs). */
function scaleUVs(geo: THREE.BufferGeometry, s: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  uv.needsUpdate = true;
}

/**
 * The tactical overlay canvas: a faithful re-creation of everything the old
 * `makeBattlematTextures` painted OVER its albedo — the two deployment bands
 * (blue at table-y-max / red at table-y-min, 22% deep, gradient fill with a
 * dashed boundary), the worn stencilled chevrons behind each boundary and the
 * 6" minor / 12" major measured grid — plus the halfway centre line between
 * the zones. Alphas are painted ~2.2x the legacy values because the host
 * plane renders at 0.18 opacity; ratios between elements are preserved, so
 * the layer reads the same, just correctly subordinate to the PBR ground.
 * Canvas top row = texture v=1 = table y max (CanvasTexture flipY), exactly
 * how the legacy painter oriented its bands.
 */
function makeZoneOverlayTexture(spec: BoardSpec, px: number): THREE.CanvasTexture {
  const cw = px;
  const ch = Math.max(2, Math.round(px * (spec.height / spec.width)));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, cw, ch); // fully transparent base

  // Deployment bands with a dashed line on each band's inner (mid) edge.
  const zoneDepth = ch * 0.22;
  const paintZone = (top: number, h: number, col: string): void => {
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, col.replace('ALPHA', '0.0'));
    g.addColorStop(0.6, col.replace('ALPHA', '0.35'));
    g.addColorStop(1, col.replace('ALPHA', '0.48'));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, cw, h);
    ctx.strokeStyle = col.replace('ALPHA', '1.0');
    ctx.lineWidth = Math.max(2, cw * 0.0025);
    ctx.setLineDash([cw * 0.02, cw * 0.014]);
    const ly = top < ch / 2 ? top + h : top;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(cw, ly);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // Gradient must run outer edge -> boundary for both bands: the bottom band
  // draws with its own top/height so stop 1.0 lands on its inner edge.
  paintZone(0, zoneDepth, 'rgba(58,123,255,ALPHA)'); // player A, table y max
  {
    // Mirror the gradient for the bottom band (outer edge = canvas bottom).
    const top = ch - zoneDepth;
    const g = ctx.createLinearGradient(0, ch, 0, top);
    g.addColorStop(0, 'rgba(255,64,48,0.0)');
    g.addColorStop(0.6, 'rgba(255,64,48,0.35)');
    g.addColorStop(1, 'rgba(255,64,48,0.48)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, cw, zoneDepth);
    ctx.strokeStyle = 'rgba(255,64,48,1.0)';
    ctx.lineWidth = Math.max(2, cw * 0.0025);
    ctx.setLineDash([cw * 0.02, cw * 0.014]);
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(cw, top);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Worn stencilled chevrons pointing out of each zone (legacy geometry:
  // 2 bands x 3 clusters x 3 rows).
  const drawChevron = (cxp: number, cyp: number, size: number, col: string, up: boolean): void => {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.lineCap = 'round';
    const dir = up ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(cxp - size, cyp + dir * size * 0.5);
    ctx.lineTo(cxp, cyp - dir * size * 0.5);
    ctx.lineTo(cxp + size, cyp + dir * size * 0.5);
    ctx.stroke();
  };
  const chevSize = cw * 0.018;
  const chevCols = ['rgba(70,90,130,0.22)', 'rgba(150,50,40,0.22)'];
  for (let band = 0; band < 2; band++) {
    const yBase = band === 0 ? ch * 0.14 : ch * 0.86;
    const col = chevCols[band];
    const up = band === 0;
    for (let i = 0; i < 3; i++) {
      const cxp = cw * (0.18 + i * 0.32);
      for (let r = 0; r < 3; r++) {
        drawChevron(cxp, yBase + r * chevSize * 1.1 * (up ? 1 : -1), chevSize, col, up);
      }
    }
  }

  // Measured grid: faint 6" minors, brighter 12" majors — the ruler the whole
  // movement/shooting game is read against.
  const pxPerInchX = cw / spec.width;
  const pxPerInchY = ch / spec.height;
  const drawGrid = (step: number, style: string, lw: number): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    for (let gx = 0; gx <= spec.width + 0.001; gx += step) {
      const x = gx * pxPerInchX;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
      ctx.stroke();
    }
    for (let gy = 0; gy <= spec.height + 0.001; gy += step) {
      const y = gy * pxPerInchY;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
      ctx.stroke();
    }
  };
  drawGrid(6, 'rgba(120,140,170,0.11)', 1);
  drawGrid(12, 'rgba(130,150,180,0.26)', 1);

  // Halfway centre line between the deployment zones — dashed, cool-neutral,
  // a touch brighter than the major grid so "your half / my half" reads at a
  // glance without competing with faction colour.
  ctx.strokeStyle = 'rgba(190,205,225,0.8)';
  ctx.lineWidth = Math.max(2, cw * 0.002);
  ctx.setLineDash([cw * 0.03, cw * 0.02]);
  ctx.beginPath();
  ctx.moveTo(0, ch / 2);
  ctx.lineTo(cw, ch / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; // painted colour layer
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * One period of muted 45-degree hazard striping (#4A3A14 gold-drab over
 * #14151A iron-black) for the plinth skirt. The canvas holds exactly one
 * period; skirt strips scale their U coordinates to len/1.5 so the pattern
 * repeats every 1.5" in world space on every side. The 30px slant over the
 * 32px height keeps the stripe a true ~45 degrees at the strips' 1.5" x
 * 0.35" world aspect.
 */
function makeHazardTexture(): THREE.CanvasTexture {
  const cw = 128;
  const ch = 32;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14151A';
  ctx.fillRect(0, 0, cw, ch);
  const slant = 30; // ~45 degrees in world space (see doc comment)
  ctx.fillStyle = '#4A3A14';
  for (let i = -1; i <= 1; i++) {
    const x0 = i * cw;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + cw / 2, 0);
    ctx.lineTo(x0 + cw / 2 - slant, ch);
    ctx.lineTo(x0 - slant, ch);
    ctx.closePath();
    ctx.fill();
  }
  // A pass of dark scuffs so the striping reads worn, not freshly painted.
  // Fixed lattice layout — ten marks need no RNG stream to look irregular.
  ctx.fillStyle = 'rgba(10,11,14,0.35)';
  for (let i = 0; i < 10; i++) {
    const x = ((i * 37) % cw) + 4;
    const y = (i * 13) % ch;
    ctx.beginPath();
    ctx.arc(x, y, 3 + (i % 3) * 2, 0, TAU);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // tiles along the skirt
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
