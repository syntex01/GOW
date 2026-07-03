/**
 * gfx/sky — sky dome + atmosphere module.
 *
 * Builds, in one `Built` chunk, everything the battlefield sees when it looks
 * UP or OUT: the sky itself, the fiction at the horizon, and the air over the
 * table. Concretely:
 *
 *  - "skyDome": an inverted sphere (BackSide) carrying one procedural canvas
 *    — near-black zenith falling to a cold blue-grey horizon, a single amber
 *    war-glow band concentrated toward the key-light corner (a burning city
 *    in the distance, NOT a sunset ring), sparse static stars, and painted
 *    smog streaks. `fog:false` + `depthWrite:false` + `renderOrder:-10` so it
 *    paints first and is never eaten by the host's scene fog (the fog far
 *    plane at width*2.3 would otherwise swallow the whole dome).
 *  - "burning city": 3-5 additive skyline billboards just above the horizon
 *    inside the war-glow arc — black ruined-tower silhouettes over an ember
 *    gradient, each with an independent, pre-phased slow flicker.
 *  - "smoke columns": 2-4 stacks of soot sprites near the billboards, each
 *    puff drifting sideways (faster with height, wrapping every 8") and
 *    slowly rolling — cheap standing smoke without any particle system.
 *  - "ground haze": two counter-rotating additive quads low over the table —
 *    a large cold layer (the legacy buildAtmosphere haze) plus a small warm
 *    layer over the ember pool whose opacity breathes with the same
 *    incommensurate-sine flicker the ember light uses, tying air to fire.
 *  - "dust motes / embers": two THREE.Points clouds — cool drifting dust and
 *    a 12% subset of warm rising embers that respawn low. Low tier gets a
 *    small static cloud (previously it got none).
 *
 * Perf contract (mid-range GPU):
 *  - Draw calls: high 1 dome + 5 city + 24 smoke + 2 haze + 2 points = 34;
 *    medium 1+3+12+2+2 = 20; low 1+0+0+2+2 = 5. Every extra call is a tiny
 *    transparent quad/point cloud — fill cost is what matters and all layers
 *    are deliberately dim (additive alpha <= 0.35) and mostly off-board.
 *  - `update(t, dt)` writes only preallocated typed arrays and material
 *    scalars: city opacities, smoke offsets/rotations, two haze rotations,
 *    one haze opacity and the mote position attribute. ZERO allocation.
 *  - All canvases are built once at construction; nothing repaints per frame
 *    (stars intentionally do not twinkle — static is free).
 *
 * Gameplay-readability contract:
 *  - The war-glow band peaks at alpha 0.30 over a 0.04-luminance horizon, so
 *    its lit luminance stays <= ~0.28 — below every faction ring/overlay.
 *  - The two haze quads together add <= ~0.04 luminance over the mat
 *    (0.12 cold + 0.06 warm additive, radially feathered), preserving the
 *    0.05-0.35 ground albedo band the overlays are tuned against.
 *  - Everything here is cosmetic: nothing is raycast, nothing overlaps unit
 *    silhouettes with saturated colour.
 *
 * Determinism: all randomness flows from `sRNG` streams derived from the
 * build seed — separate streams per subsystem (dome paint / city / smoke /
 * motes) so a tier change reshuffles only the layers whose counts changed.
 */
import * as THREE from 'three';
import { sRNG, type BoardSpec, type Built, type GfxQuality } from './contract';

const TAU = Math.PI * 2;

/* ------------------------------ tuning knobs ------------------------------ */

/** Dome radius as a multiple of board width. MUST exceed the max orbit radius
 *  (220 ≈ 3.67x a 60" board) or the camera exits the BackSide dome at wide zoom
 *  and the sky vanishes to the near-black background. 4.5x = 270" > 220 gives
 *  margin; the camera far plane is widened to 700 to clear the far hemisphere. */
const DOME_RADIUS_MUL = 4.5;
/** Azimuth of the war-glow / key-light corner: toward world (+x, +z). */
const KEY_AZ = Math.PI / 4;
/** War-glow band: centre/sigma in "sky v" (0 = horizon, 1 = zenith). */
const GLOW_V = 0.045;
const GLOW_SIGMA = 0.035;
const GLOW_PEAK_ALPHA = 0.3;
/** Azimuthal half-arc (degrees) of the war-glow / city / smoke placements. */
const GLOW_ARC_DEG = 100;
/** Burning-city billboards: size (inches) + base opacity. */
const CITY_W = 26;
const CITY_H = 9;
const CITY_BASE_Y = 0.5;
const CITY_OPACITY = 0.35;
/** Smoke columns: puffs per column + sideways wrap length (inches). */
const SMOKE_PUFFS = 6;
const SMOKE_WRAP = 8;
/** Ground haze: heights, base opacities, tints. */
const HAZE_COLD_Y = 0.6;
const HAZE_COLD_OPACITY = 0.12;
const HAZE_COLD_TINT = 0x2a3340;
const HAZE_WARM_Y = 1.4;
const HAZE_WARM_OPACITY = 0.06;
const HAZE_WARM_TINT = 0x3a2a1c;
/** Dust motes: counts per tier, ember subset fraction + rise behaviour. */
const MOTES_BY_TIER = { high: 320, medium: 160, low: 40 } as const;
const EMBER_FRAC = 0.12;
const EMBER_RISE = 0.3; // inches / second
const EMBER_TOP = 9; // respawn ceiling
const EMBER_FLOOR = 0.3;

/* --------------------------------- build ---------------------------------- */

/** Sky dome + horizon fiction + table atmosphere. See module header. */
export function buildAtmosphere(spec: BoardSpec, q: GfxQuality, seed: number): Built {
  const group = new THREE.Group();
  group.name = 'atmosphere';
  const low = q.tier === 'low';

  // Everything created here funnels into these for a leak-free dispose().
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  /* ------------------------------- sky dome ------------------------------- */

  const radius = spec.width * DOME_RADIUS_MUL;
  const skyTex = makeSkyTexture(q, sRNG(seed));
  textures.push(skyTex);
  const domeGeo = new THREE.SphereGeometry(radius, low ? 16 : 32, low ? 8 : 16);
  geometries.push(domeGeo);
  const domeMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    fog: false, // the dome IS the "beyond the fog" — fogging it kills it
    depthWrite: false,
  });
  materials.push(domeMat);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.name = 'skyDome';
  dome.renderOrder = -10; // painted first, behind every fogged/transparent layer
  dome.frustumCulled = false; // camera lives inside the sphere
  group.add(dome);

  /* -------------------------- burning-city horizon ------------------------ */
  // Camera-facing additive sprites: black skyline silhouettes over an ember
  // gradient. Additive means the black towers contribute nothing — they read
  // as buildings occluding the fire behind them, for free.

  const cityCount = q.tier === 'high' ? 5 : q.tier === 'medium' ? 3 : 0;
  const cityMats: THREE.SpriteMaterial[] = [];
  const cityPhase = new Float32Array(Math.max(1, cityCount));
  {
    const rng = sRNG(seed + 101);
    const arc = ((GLOW_ARC_DEG - 30) * Math.PI) / 180; // keep fully inside glow
    for (let i = 0; i < cityCount; i++) {
      const tex = makeSkylineTexture(rng);
      textures.push(tex);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false, // 85-100" out — scene fog would erase it entirely
        opacity: CITY_OPACITY,
      });
      materials.push(mat);
      cityMats.push(mat);
      const spread = cityCount > 1 ? (i / (cityCount - 1)) * 2 - 1 : 0;
      const az = KEY_AZ + spread * arc + (rng() - 0.5) * 0.12;
      const r = 85 + rng() * 15;
      const sprite = new THREE.Sprite(mat);
      sprite.name = `burningCity${i}`;
      sprite.position.set(Math.cos(az) * r, CITY_BASE_Y + CITY_H / 2, Math.sin(az) * r);
      sprite.scale.set(CITY_W, CITY_H, 1);
      sprite.renderOrder = -8;
      cityPhase[i] = rng() * TAU;
      group.add(sprite);
    }
  }

  /* ------------------------------ smoke columns --------------------------- */
  // Stacked soot puffs rising from the burning horizon. Each puff drifts
  // sideways faster the higher it sits (wind shear) and wraps every 8" —
  // at opacity <= 0.16 the wrap pop is invisible, and six sprites per column
  // are far cheaper than any real particle emitter.

  const columnCount = q.tier === 'high' ? 4 : q.tier === 'medium' ? 2 : 0;
  const puffCount = columnCount * SMOKE_PUFFS;
  const smokeSprites: THREE.Sprite[] = [];
  const smokeMats: THREE.SpriteMaterial[] = [];
  const smokeBaseX = new Float32Array(Math.max(1, puffCount));
  const smokeOff = new Float32Array(Math.max(1, puffCount));
  const smokeFrac = new Float32Array(Math.max(1, puffCount));
  if (columnCount > 0) {
    const rng = sRNG(seed + 211);
    const sootTex = makeSootTexture();
    textures.push(sootTex);
    const arc = ((GLOW_ARC_DEG - 40) * Math.PI) / 180;
    for (let c = 0; c < columnCount; c++) {
      const az = KEY_AZ + (rng() - 0.5) * 2 * arc;
      const r = 70 + rng() * 20;
      const bx = Math.cos(az) * r;
      const bz = Math.sin(az) * r;
      for (let i = 0; i < SMOKE_PUFFS; i++) {
        const frac = i / (SMOKE_PUFFS - 1); // 0 bottom -> 1 top
        const mat = new THREE.SpriteMaterial({
          map: sootTex,
          transparent: true,
          depthWrite: false,
          fog: false,
          opacity: 0.16 - 0.11 * frac, // 0.16 bottom -> 0.05 top
          rotation: rng() * TAU,
        });
        materials.push(mat);
        const puff = new THREE.Sprite(mat);
        const w = 6 + 8 * frac; // 6" -> 14" wide going up
        puff.scale.set(w, w * 0.85, 1);
        puff.position.set(bx, 2 + 24 * frac, bz); // 2" -> 26" tall
        puff.renderOrder = -7;
        const idx = c * SMOKE_PUFFS + i;
        smokeBaseX[idx] = bx;
        smokeOff[idx] = rng() * SMOKE_WRAP - SMOKE_WRAP / 2; // desync columns
        smokeFrac[idx] = frac;
        smokeSprites.push(puff);
        smokeMats.push(mat);
        group.add(puff);
      }
    }
  }

  /* ------------------------------- ground haze ---------------------------- */
  // Two additive quads faking a volumetric layer with zero extra passes:
  //  - cold: the legacy haze, board-wide at y=0.6;
  //  - warm: a small quad over the ember pool at y=1.4 whose opacity breathes
  //    with the SAME incommensurate-sine flicker the ember point light uses
  //    (gfx/lights, spec B.1) — same closed-form of t, so the two modules
  //    stay in sync with no cross-module coupling.
  // Counter-rotation of the radial textures sells slow air movement without
  // UV-offset tiling seams.

  const hazeTex = makeRadialTexture(256, [
    [0.0, 'rgba(255,255,255,0.85)'],
    [0.45, 'rgba(255,255,255,0.38)'],
    [1.0, 'rgba(255,255,255,0)'],
  ]);
  textures.push(hazeTex);

  const coldGeo = new THREE.PlaneGeometry(spec.width * 1.25, spec.height * 1.25);
  geometries.push(coldGeo);
  const coldMat = new THREE.MeshBasicMaterial({
    map: hazeTex,
    color: HAZE_COLD_TINT,
    transparent: true,
    opacity: HAZE_COLD_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  materials.push(coldMat);
  const hazeCold = new THREE.Mesh(coldGeo, coldMat);
  hazeCold.name = 'hazeCold';
  hazeCold.rotation.x = -Math.PI / 2;
  hazeCold.position.y = HAZE_COLD_Y;
  group.add(hazeCold);

  // Warm layer sits offset toward the key-light corner — the "ember pool"
  // side the light rig's flickering point light warms. 40x30" quad = the
  // spec's "within 20 inches of the pool centre".
  const warmGeo = new THREE.PlaneGeometry(
    Math.min(40, spec.width * 0.66),
    Math.min(30, spec.height * 0.66),
  );
  geometries.push(warmGeo);
  const warmMat = new THREE.MeshBasicMaterial({
    map: hazeTex,
    color: HAZE_WARM_TINT,
    transparent: true,
    opacity: HAZE_WARM_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  materials.push(warmMat);
  const hazeWarm = new THREE.Mesh(warmGeo, warmMat);
  hazeWarm.name = 'hazeWarm';
  hazeWarm.rotation.x = -Math.PI / 2;
  const poolDist = Math.min(spec.width, spec.height) * 0.18;
  hazeWarm.position.set(Math.cos(KEY_AZ) * poolDist, HAZE_WARM_Y, Math.sin(KEY_AZ) * poolDist);
  group.add(hazeWarm);

  /* ---------------------------- dust motes / embers ----------------------- */
  // Two Points clouds sharing one soft-dot texture: cool dust that drifts on
  // per-point sine phases, and a 12% warm ember subset that rises and
  // respawns low (feeding a hint of motion into the bloom). Low tier keeps a
  // small STATIC cloud — zero per-frame cost, but the air no longer reads
  // dead flat on phones.

  const moteTotal = MOTES_BY_TIER[q.tier];
  const emberCount = Math.round(moteTotal * EMBER_FRAC);
  const dustCount = moteTotal - emberCount;
  const animate = !low;

  const dotTex = makeRadialTexture(32, [
    [0.0, 'rgba(255,255,255,1)'],
    [0.4, 'rgba(255,255,255,0.55)'],
    [1.0, 'rgba(255,255,255,0)'],
  ]);
  textures.push(dotTex);

  const rngM = sRNG(seed + 307);
  const spawn = (n: number, yMax: number): Float32Array => {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = (rngM() * 1.1 - 0.55) * spec.width;
      a[i * 3 + 1] = EMBER_FLOOR + rngM() * (yMax - EMBER_FLOOR);
      a[i * 3 + 2] = (rngM() * 1.1 - 0.55) * spec.height;
    }
    return a;
  };

  // Dust: keep a pristine base copy + two phase arrays so update() is a pure
  // function of (t) into the live attribute — no error accumulation, no alloc.
  const dustBase = spawn(dustCount, 8.5);
  const dustLive = new Float32Array(dustBase);
  const dustPhaseA = new Float32Array(dustCount);
  const dustPhaseB = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPhaseA[i] = rngM() * TAU;
    dustPhaseB[i] = rngM() * TAU;
  }
  const dustGeo = new THREE.BufferGeometry();
  geometries.push(dustGeo);
  const dustAttr = new THREE.BufferAttribute(dustLive, 3);
  dustAttr.setUsage(animate ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
  dustGeo.setAttribute('position', dustAttr);
  const dustMat = new THREE.PointsMaterial({
    map: dotTex,
    color: 0xb9c4d6,
    size: 0.45,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    fog: false,
  });
  materials.push(dustMat);
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'dustMotes';
  dust.frustumCulled = false; // points drift; skip bound recomputes entirely
  group.add(dust);

  // Embers: mutated in place (rise + wrap), so only a live array is needed.
  const emberLive = spawn(emberCount, EMBER_TOP);
  const emberGeo = new THREE.BufferGeometry();
  geometries.push(emberGeo);
  const emberAttr = new THREE.BufferAttribute(emberLive, 3);
  emberAttr.setUsage(animate ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
  emberGeo.setAttribute('position', emberAttr);
  const emberMat = new THREE.PointsMaterial({
    map: dotTex,
    color: 0xffb066,
    size: 0.6,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    fog: false,
  });
  materials.push(emberMat);
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.name = 'emberMotes';
  embers.frustumCulled = false;
  group.add(embers);

  /* ------------------------------- update hook ---------------------------- */
  // Budget: ~(5 + 24) material scalars + 2 rotations + (dust+ember)*3 floats
  // into preallocated buffers. No vector/array construction anywhere below.

  const update = (t: number, dt: number): void => {
    // Burning-city flicker: two incommensurate sines per billboard, phases
    // pre-seeded — never strobes, never syncs across billboards.
    for (let i = 0; i < cityMats.length; i++) {
      const ph = cityPhase[i];
      cityMats[i].opacity =
        CITY_OPACITY * (0.85 + 0.15 * Math.sin(t * 0.7 + ph) + 0.06 * Math.sin(t * 2.3 + 1.7 * ph));
    }

    // Smoke drift: sideways speed scales with height fraction (wind shear),
    // wrapping every 8" around the column base; slow roll on each puff.
    for (let i = 0; i < smokeSprites.length; i++) {
      let off = smokeOff[i] + 0.15 * dt * smokeFrac[i];
      if (off > SMOKE_WRAP / 2) off -= SMOKE_WRAP; // dt spikes: one wrap/frame is fine
      smokeOff[i] = off;
      smokeSprites[i].position.x = smokeBaseX[i] + off;
      smokeMats[i].rotation += 0.02 * dt;
    }

    // Haze: slow counter-rotation (opposing "drift" without UV tiling seams)
    // + warm layer breathing with the ember light's exact flicker curve.
    hazeCold.rotation.z += 0.008 * dt;
    hazeWarm.rotation.z -= 0.008 * dt;
    const flick =
      0.9 + 0.07 * Math.sin(t * 1.3) + 0.04 * Math.sin(t * 4.7) + 0.03 * Math.sin(t * 9.1);
    warmMat.opacity = HAZE_WARM_OPACITY * flick;

    if (!animate) return; // low tier: static motes, zero attribute traffic

    // Dust: gentle 3-axis sinusoidal drift, pure function of t (no drift-off).
    for (let i = 0; i < dustCount; i++) {
      const j = i * 3;
      const pa = dustPhaseA[i];
      const pb = dustPhaseB[i];
      dustLive[j] = dustBase[j] + 0.35 * Math.sin(t * 0.33 + pa);
      dustLive[j + 1] = dustBase[j + 1] + 0.18 * Math.sin(t * 0.21 + pb);
      dustLive[j + 2] = dustBase[j + 2] + 0.35 * Math.cos(t * 0.27 + pa + pb);
    }
    dustAttr.needsUpdate = true;

    // Embers: rise and respawn low — an endless slow updraft.
    for (let i = 0; i < emberCount; i++) {
      const j = i * 3 + 1;
      let y = emberLive[j] + EMBER_RISE * dt;
      if (y > EMBER_TOP) y = EMBER_FLOOR;
      emberLive[j] = y;
    }
    emberAttr.needsUpdate = true;
  };

  /* --------------------------------- dispose ------------------------------ */
  // Note: THREE.Sprite geometry is a module-level shared quad inside three —
  // it is intentionally NOT disposed here.

  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const tx of textures) tx.dispose();
  };

  return { group, update, dispose };
}

/* ------------------------------ canvas painters ---------------------------- */

/** Largest power of two <= n (canvas sizes stay mip-friendly on every tier). */
function potFloor(n: number): number {
  return 2 ** Math.floor(Math.log2(Math.max(2, n)));
}

/**
 * The dome's equirect canvas. Layout: canvas row 0 = zenith (texture v=1 =
 * sphere top), row h/2 = horizon (sphere equator at table y=0), rows below =
 * under-horizon murk (mostly hidden by the board/plinth, faded dark so a low
 * camera never sees a bright band under the world). "Sky v" used by the spec
 * (0 = horizon, 1 = zenith) therefore maps to canvas y = (0.5 - v/2) * h.
 *
 * Painted layers, in order:
 *  1. vertical gradient — near-black zenith -> cold blue-grey horizon, whose
 *     horizon stop (#2b3442) sits close to the fog colour (0x080a0d family)
 *     so the fogged board edge dissolves into the dome without a seam;
 *  2. amber war-glow band, gaussian in v, cos^2-arced in azimuth toward the
 *     key-light corner (u = 0.375 for world azimuth +45 deg given three's
 *     sphere UV parameterisation x = -cos(2*pi*u), z = sin(2*pi*u));
 *  3. sparse static stars above v = 0.35 (90/50/24 by tier, 8 brighter);
 *  4. blurred horizontal smog streaks, 3 of them warm inside the glow arc.
 */
function makeSkyTexture(q: GfxQuality, rng: () => number): THREE.CanvasTexture {
  const w = Math.min(1024, potFloor(q.texturePx));
  const h = w / 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const vRow = (v: number): number => (0.5 - v / 2) * h;

  // 1. Vertical gradient, zenith (row 0) to horizon (row h/2).
  const grad = ctx.createLinearGradient(0, 0, 0, h / 2);
  const stops: Array<[number, string]> = [
    [0.0, '#2b3442'],
    [0.06, '#232c3a'],
    [0.14, '#161c26'],
    [0.3, '#0c1017'],
    [0.55, '#080a0e'],
    [1.0, '#050608'],
  ];
  for (const [v, col] of stops) grad.addColorStop(1 - v, col);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h / 2);
  // Below-horizon murk: horizon colour sinking to near-black.
  const under = ctx.createLinearGradient(0, h / 2, 0, h);
  under.addColorStop(0, '#2b3442');
  under.addColorStop(0.3, '#12161e');
  under.addColorStop(1, '#080a0d');
  ctx.fillStyle = under;
  ctx.fillRect(0, h / 2, w, h / 2);

  // 2. War-glow band. A 1px-wide gaussian strip is stamped per column with a
  // cos^2 azimuthal weight — ~w tiny drawImage calls, build-time only.
  const sigma = (GLOW_SIGMA / 2) * h; // sky-v sigma -> canvas px
  const stripH = Math.max(4, Math.ceil(sigma * 6));
  const strip = document.createElement('canvas');
  strip.width = 1;
  strip.height = stripH;
  const sctx = strip.getContext('2d')!;
  const sg = sctx.createLinearGradient(0, 0, 0, stripH);
  for (let k = 0; k <= 12; k++) {
    const p = k / 12;
    const d = (p - 0.5) * 6; // offset in sigmas
    const a = GLOW_PEAK_ALPHA * Math.exp(-0.5 * d * d);
    sg.addColorStop(p, `rgba(179,84,30,${a.toFixed(4)})`); // #b3541e
  }
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 1, stripH);
  const bandTop = Math.round(vRow(GLOW_V) - stripH / 2);
  const uGlow = 0.375; // sphere-u of world azimuth KEY_AZ (see doc comment)
  ctx.globalCompositeOperation = 'lighter';
  for (let x = 0; x < w; x++) {
    let du = Math.abs((x + 0.5) / w - uGlow);
    if (du > 0.5) du = 1 - du; // wrap the seam
    const dAz = du * 360;
    if (dAz >= GLOW_ARC_DEG) continue;
    const c = Math.cos(((dAz / GLOW_ARC_DEG) * Math.PI) / 2);
    ctx.globalAlpha = c * c;
    ctx.drawImage(strip, x, bandTop, 1, stripH);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // 3. Stars: static (no twinkle — free), only above sky-v 0.35.
  const starCount = q.tier === 'high' ? 90 : q.tier === 'medium' ? 50 : 24;
  const starCeil = vRow(0.35); // rows [0, starCeil] are eligible
  const bright = 8;
  for (let i = 0; i < starCount; i++) {
    const big = i < bright;
    const a = big ? 0.45 + rng() * 0.25 : 0.25 + rng() * 0.35;
    ctx.fillStyle = `rgba(205,216,234,${a.toFixed(3)})`; // #cdd8ea
    ctx.fillRect(Math.floor(rng() * w), Math.floor(rng() * starCeil), big ? 2 : 1, big ? 2 : 1);
  }

  // 4. Smog streaks: blurred horizontal smears in the low sky; three warm
  // ones sit inside the glow arc so the fire reads as smoking.
  const blurPx = Math.max(2, Math.round(6 * (w / 1024)));
  ctx.filter = `blur(${blurPx}px)`;
  const streakCount = 10 + Math.floor(rng() * 5); // 10-14
  const yLo = vRow(0.28);
  const yHi = vRow(0.05);
  for (let i = 0; i < streakCount; i++) {
    const sw = (0.15 + rng() * 0.25) * w;
    const sh = 4 + rng() * 6;
    const a = 0.1 + rng() * 0.12;
    ctx.fillStyle = `rgba(16,20,27,${a.toFixed(3)})`; // #10141b
    ctx.fillRect(rng() * w - sw / 2, yLo + rng() * (yHi - yLo), sw, sh);
  }
  for (let i = 0; i < 3; i++) {
    const sw = (0.12 + rng() * 0.18) * w;
    const cx = (uGlow + (rng() - 0.5) * 0.35) * w;
    ctx.fillStyle = 'rgba(58,35,20,0.12)'; // #3a2314
    ctx.fillRect(cx - sw / 2, yLo + rng() * (yHi - yLo), sw, 4 + rng() * 5);
  }
  ctx.filter = 'none';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // seamless around the full azimuth
  return tex;
}

/**
 * One burning-city billboard: an ember gradient (hot bottom -> transparent
 * top) with an ORIGINAL ruined skyline blocked out in opaque black. Under
 * additive blending black contributes nothing, so the towers read as distant
 * buildings silhouetted against firelight.
 */
function makeSkylineTexture(rng: () => number): THREE.CanvasTexture {
  const w = 256;
  const h = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#ff8a3c');
  g.addColorStop(0.6, '#4a1c08');
  g.addColorStop(1, 'rgba(74,28,8,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 8-14 rectangular towers with jagged, war-broken tops (crenel stubs).
  ctx.fillStyle = '#000000';
  const towers = 8 + Math.floor(rng() * 7);
  let x = rng() * 6;
  for (let i = 0; i < towers && x < w; i++) {
    const tw = 10 + rng() * (w / towers);
    const th = 8 + rng() * 32; // 8-40 px tall
    ctx.fillRect(x, h - th, tw, th);
    const stubs = 1 + Math.floor(rng() * 3);
    for (let s = 0; s < stubs; s++) {
      const sw = 2 + rng() * 4;
      ctx.fillRect(x + rng() * Math.max(1, tw - sw), h - th - (2 + rng() * 5), sw, 8);
    }
    x += tw + rng() * 8;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial soot puff (#11141a core fading out) for the smoke columns. */
function makeSootTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(17,20,26,0.9)'); // #11141a
  g.addColorStop(0.55, 'rgba(17,20,26,0.42)');
  g.addColorStop(1, 'rgba(17,20,26,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Generic white radial-falloff sprite (tinted by materials): haze + motes. */
function makeRadialTexture(size: number, stops: Array<[number, string]>): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
