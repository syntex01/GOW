/**
 * Grimdark light rig (gfx/lights).
 *
 * Ports the tuned three-point-plus-ember rig from the old ThreeScene monolith
 * VERBATIM as the baseline — every colour, intensity, position and shadow knob
 * below was dialled in against the grade pass (vignette/desat/split-tone) and
 * must not drift, or the whole look shifts. On top of the baseline this module
 * adds the art-director refinements:
 *
 *  - a seeded, period-incommensurate ember flicker (three sines, never
 *    strobing, never repeating on a visible cycle) so the central firelight
 *    pool reads as live embers rather than a static bulb;
 *  - two very dim steel-blue accent PointLights hovering over the deployment
 *    ends (no shadows, tight range) that lift far-corner model silhouettes
 *    without flattening the raked key/rim contrast — skipped on the low tier;
 *  - one faint warm kicker DirectionalLight from the war-glow horizon azimuth
 *    (the burning-city arc painted by gfx/sky) so the off-board fiction and
 *    the on-board light agree.
 *
 * Perf notes: exactly one shadow-casting light (the key) with a snug frustum
 * hugging the board for maximum texel density; every other light is
 * shadowless. The per-frame update writes a single float (ember intensity) —
 * zero allocation. dispose() releases the key's shadow map render target.
 *
 * The key light is exposed on the return value so the host's adaptive quality
 * governor can toggle/resize its shadow map without reaching into the group.
 */
import * as THREE from 'three';
import type { BoardSpec, Built, GfxTier } from './contract';

/**
 * Build the full light rig for a board. All lights live inside the returned
 * group; `key` is also returned directly for the host's shadow control.
 *
 * @param spec          Playable board dimensions (inches).
 * @param shadowMapSize Shadow map edge in px; <=0 disables key shadows.
 * @param tier          Quality tier — trims penumbra and skips the accent
 *                      points on 'low'.
 */
export function buildLights(
  spec: BoardSpec,
  shadowMapSize: number,
  tier: GfxTier,
): Built & { key: THREE.DirectionalLight } {
  const group = new THREE.Group();
  group.name = 'gfx-lights';

  /* ------------------------------ hemisphere ----------------------------- */
  // Cold steel sky, dim ember-warm ground bounce. Pulled down hard for
  // grimdark — ambient barely lifts the blacks so the key light carves
  // dramatic, deep shadows and the board sinks into murk at the edges.
  const hemi = new THREE.HemisphereLight(0x3a4658, 0x140d06, 0.24);
  group.add(hemi);

  /* ------------------------------- key light ----------------------------- */
  // Warm firelight key at a low raking angle (~30° elevation vs a boring
  // near-overhead): long directional shadows + side-lit models are the single
  // biggest drama lever. Slightly hot/orange so lit faces read as torch or
  // furnace light against the cold dark.
  const key = new THREE.DirectionalLight(0xffce93, 3.0);
  key.position.set(spec.width * 0.62, spec.width * 0.45, spec.height * 0.62);
  key.castShadow = shadowMapSize > 0;
  const sm = Math.max(512, shadowMapSize);
  key.shadow.mapSize.set(sm, sm);
  // Snug frustum that hugs the board (a loose 0.75 span wasted most of the
  // map on empty margin) — ~2× texel density on the models for crisper,
  // better-grounded shadows at no extra memory.
  const span = Math.max(spec.width, spec.height) * 0.55;
  const cam = key.shadow.camera;
  cam.left = -span;
  cam.right = span;
  cam.top = span;
  cam.bottom = -span;
  cam.near = spec.width * 0.4;
  cam.far = spec.width * 2.2;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.035;
  // Soft penumbra (honoured by PCFSoftShadowMap): crisp at contact, soft at
  // the shadow tips. Lighter on the low tier to save fill.
  key.shadow.radius = tier === 'low' ? 2 : 3.5;
  group.add(key);

  /* ------------------------------- rim light ----------------------------- */
  // Cold steel rim/back light from behind to carve model silhouettes out of
  // the dark board — the cool counterpoint to the warm key. Low and far
  // behind = a grazing silhouette rim, not a top-down wash. No shadow.
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.5);
  rim.position.set(-spec.width * 0.5, spec.width * 0.3, -spec.height * 0.8);
  group.add(rim);

  /* ------------------------------ fill light ----------------------------- */
  // Subtle cool fill from the opposite low side, no shadows — lifts the
  // deepest shadows just enough to keep detail without killing contrast.
  const fill = new THREE.DirectionalLight(0x435780, 0.22);
  fill.position.set(-spec.width * 0.5, spec.width * 0.3, spec.height * 0.3);
  group.add(fill);

  /* ------------------------------ ember pool ----------------------------- */
  // Warm ember point light low over the board centre — a faint pool of
  // firelight that warms the middle of the battlefield and falls off into the
  // cold dark. No shadow (cheap), modest range so it never flattens contrast.
  const ember = new THREE.PointLight(0xff7a2c, 0.85, spec.width * 0.7, 2.0);
  ember.position.set(0, 4, 0);
  group.add(ember);

  /* ----------------------- cool deployment accents ----------------------- */
  // Two very dim steel-blue points hovering over the deployment ends (table
  // corners diagonal to each other, mirroring the classic dawn-of-war zones).
  // They lift the far-corner silhouettes that neither key nor rim reaches
  // without adding a competing shadow or flattening the raked look. Tight
  // range + quadratic decay keeps their footprint local. Skipped on 'low':
  // extra point lights cost per-fragment work in the forward renderer.
  if (tier !== 'low') {
    // Table-inch anchors (8,36)/(52,8) on the reference 60x44 board, expressed
    // as board fractions so odd table sizes keep the same composition.
    // tableToWorld inlined (constants, no per-frame math): x-w/2, y, -(ty-h/2).
    const ax = spec.width * (8 / 60);
    const ay = spec.height * (36 / 44);
    const bx = spec.width * (52 / 60);
    const by = spec.height * (8 / 44);
    const accentA = new THREE.PointLight(0x5a78b0, 0.35, 18, 2.0);
    accentA.position.set(ax - spec.width / 2, 3, -(ay - spec.height / 2));
    const accentB = new THREE.PointLight(0x5a78b0, 0.35, 18, 2.0);
    accentB.position.set(bx - spec.width / 2, 3, -(by - spec.height / 2));
    group.add(accentA, accentB);
  }

  /* --------------------------- war-glow kicker --------------------------- */
  // Faint warm directional matching the burning-city horizon billboards
  // (gfx/sky paints the war-glow arc toward the +x/+z key corner, azimuth
  // ~45°). Elevation 8° — a grazing amber kiss on silhouettes facing the
  // burning horizon that ties the off-board fiction to on-board light.
  // Deliberately tiny (0.12) so it never fights the key. No shadow.
  const kicker = new THREE.DirectionalLight(0xc06030, 0.12);
  {
    const az = Math.PI / 4; // toward (+x, +z), matching sky's war-glow arc
    const el = (8 * Math.PI) / 180;
    const d = spec.width; // distance is irrelevant for directionals; keep sane
    kicker.position.set(
      Math.cos(el) * Math.cos(az) * d,
      Math.sin(el) * d,
      Math.cos(el) * Math.sin(az) * d,
    );
  }
  group.add(kicker);

  /* ------------------------------- flicker ------------------------------- */
  // Ember flicker: three sines at period-incommensurate frequencies
  // (1.3/4.7/9.1 rad/s share no small common multiple) so the combined wave
  // never visibly loops or strobes. Amplitude sums to ±0.14 around a 0.9
  // pedestal → intensity swings ~±12% of the 0.85 baseline (0.646–0.884
  // absolute, typically 0.71–0.97 of baseline as the phases rarely align).
  // Pure float math on a captured reference — zero allocation per frame.
  const emberBase = 0.85;
  const update = (t: number): void => {
    ember.intensity =
      emberBase *
      (0.9 + 0.07 * Math.sin(t * 1.3) + 0.04 * Math.sin(t * 4.7) + 0.03 * Math.sin(t * 9.1));
  };

  /* ------------------------------- dispose ------------------------------- */
  // Lights own no geometry/material/texture; the only GPU resource is the
  // key's shadow map render target, allocated lazily on first shadow render.
  const dispose = (): void => {
    key.shadow.map?.dispose();
    key.shadow.map = null;
    key.dispose();
    rim.dispose();
    fill.dispose();
    hemi.dispose();
    ember.dispose();
    kicker.dispose();
    group.clear();
  };

  return { group, key, update, dispose };
}
