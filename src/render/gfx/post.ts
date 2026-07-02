/**
 * gfx/post — the cinematic post-processing chain, extracted from the renderer
 * monolith as a focused module.
 *
 * Pass order (each optional stage degrades gracefully — a failure in one never
 * breaks the frame; the whole build is wrapped and returns null on disaster so
 * the host can fall back to direct rendering):
 *
 *   RenderPass                                (beauty)
 *   -> GTAOPass          (high tier only)     ground-truth AO: crevice/contact
 *                                             darkening BEFORE bloom samples
 *                                             the frame, so AO never blooms
 *   -> UnrealBloomPass   (all tiers)          firelight/plasma glow; render
 *                                             targets run DOWNSCALED on lower
 *                                             tiers (soft low-frequency effect
 *                                             — visually free, big fill win)
 *   -> grade ShaderPass  (all tiers)          grimdark grade: neutral desat,
 *                                             split-tone (cool shadows / warm
 *                                             highlights), filmic toe lift,
 *                                             highlight-only amber glow bias,
 *                                             aspect-correct vignette to a cool
 *                                             near-black, shadow-weighted grain
 *   -> BokehPass         (high tier only)     shallow "photographed miniatures"
 *                                             depth of field tracking the orbit
 *   -> OutputPass                             tone mapping + colour space
 *   -> SMAAPass          (medium + high)      sub-pixel edge AA on the final
 *                                             composite (MSAA is unavailable
 *                                             through the composer)
 *
 * Perf notes:
 *  - `updatePerFrame` writes three uniform values and allocates NOTHING (the
 *    bokeh focus/aperture uniform objects are captured once at build time).
 *  - The grade pass is a single full-screen quad with one texture fetch and a
 *    handful of ALU ops — the two refinements below (toe lift + highlight glow)
 *    add ~5 ALU total, no extra fetches, no extra passes.
 *  - GTAO is the heaviest stage (depth+normal G-buffer + Poisson denoise) and
 *    is therefore gated to the high tier, matching the tuned baseline.
 *
 * Gameplay readability: everything here is tuned so faction colours and the
 * overlay rings stay legible over the 0.05–0.35-luminance ash ground — the
 * bloom threshold (0.62) only passes genuine emitters, the vignette bottoms
 * out at an in-palette cool near-black (never pure black), and the toe lift
 * explicitly protects the 0.05-luminance floor from being crushed.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { GfxTier } from './contract';

/* ------------------------------- tuning -------------------------------- */
/* Baseline constants ported verbatim from the tuned monolith chain
 * (setupComposer/addGradePass). Change with care — these were dialled in
 * against real screenshots of the board. */

/** Bloom: soft firelight, not neon. High threshold = only true emitters. */
const BLOOM_STRENGTH = 0.9;
const BLOOM_RADIUS = 0.72;
const BLOOM_THRESHOLD = 0.62;

/** GTAO: world units are INCHES (board 60x44, bases ~1–2in), so the r169
 *  default radius (0.25) is invisible — we need ~1.6 to shade crevices. */
const GTAO_RADIUS = 1.6;
const GTAO_BLEND = 0.85;

/** Depth of field: a subtle tilt-shift, driven per-frame by orbit distance. */
const DOF_APERTURE_BASE = 0.00055;
const DOF_APERTURE_REF_DIST = 70; // orbit distance at which aperture == base
const DOF_FOCUS_BIAS = 0.92; // bias focus onto the front rank of figures
const DOF_MAX_BLUR = 0.011;

/** Grade: the grimdark split-tone finish. */
const GRADE_VIGNETTE = 0.45; // 0 = none, 1 = heavy corners (softened so wide-board
// left/right deployment-edge units aren't buried; corners still fall dark)
const GRADE_DESAT = 0.18; // neutral desat; the split-tone carries the cast
const GRADE_GRAIN = 0.022; // grain amplitude (0 on low tier)
const GRADE_SHADOW_TINT = 0x33465e; // cool blue-steel shadows
const GRADE_HI_TINT = 0xffd9a8; // warm firelit highlights
const GRADE_SPLIT = 0.35; // split-tone strength

/** Refinement 1 (art-director spec): filmic toe lift — gently crushes
 *  near-blacks toward a film response curve while keeping the 0.05-luminance
 *  ground floor readable. col = col*(1-toe) + toe*pow(col, 1.35). */
const GRADE_TOE = 0.22;
/** Refinement 2 (art-director spec): highlight-only warm glow bias — a +0.02
 *  amber lift on TRUE highlights only (l > 0.75), tying hot emitters into the
 *  warm key light. ~3 ALU, no new passes, no extra fetches. */
const GRADE_HI_GLOW = 0.02;

/* ------------------------------ interface ------------------------------ */

export interface PostChain {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  gtao: GTAOPass | null;
  bokeh: BokehPass | null;
  smaa: SMAAPass | null;
  grade: ShaderPass | null;
  setSize(w: number, h: number): void;
  setPixelRatio(pr: number): void;
  updatePerFrame(t: number, camDist: number): void;
  dispose(): void;
}

/* ------------------------------ grade pass ----------------------------- */

/**
 * Build the single cheap full-screen grade pass:
 *  - neutral DESATURATION toward grey first (no darkening), then a
 *    luminance-driven SPLIT-TONE (cool blue-steel shadows, warm firelit
 *    highlights). The `* 2.0` renormalises mid-grey back toward unity so the
 *    tint never secretly halves exposure.
 *  - FILMIC TOE + HIGHLIGHT GLOW (the two spec'd refinements, see constants),
 *  - aspect-correct radial VIGNETTE falling toward a cool in-palette
 *    near-black (uShadowTint * 0.4), never pure black,
 *  - faint animated FILM GRAIN weighted into the shadows, using the REAL
 *    canvas resolution (uResolution — kept in sync by setSize). Grain is the
 *    only per-pixel-random work, so the low tier sets its amplitude to 0 and
 *    the branch is skipped entirely.
 *
 * Returns null on failure — the chain simply proceeds without a grade.
 */
function buildGradePass(width: number, height: number, tier: GfxTier): ShaderPass | null {
  try {
    const grain = tier === 'low' ? 0.0 : 1.0;
    const shader = {
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
        uVignette: { value: GRADE_VIGNETTE },
        uDesat: { value: GRADE_DESAT },
        uGrain: { value: grain * GRADE_GRAIN },
        uShadowTint: { value: new THREE.Color(GRADE_SHADOW_TINT) },
        uHiTint: { value: new THREE.Color(GRADE_HI_TINT) },
        uSplit: { value: GRADE_SPLIT },
        uToe: { value: GRADE_TOE },
        uHiGlow: { value: GRADE_HI_GLOW },
        uResolution: { value: new THREE.Vector2(Math.max(1, width), Math.max(1, height)) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uVignette;
        uniform float uDesat;
        uniform float uGrain;
        uniform vec3 uShadowTint;
        uniform vec3 uHiTint;
        uniform float uSplit;
        uniform float uToe;
        uniform float uHiGlow;
        uniform vec2 uResolution;
        varying vec2 vUv;
        // cheap hash for grain
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
          // Neutral desat first (no darkening), then luminance-driven split-tone:
          // shadows go cool blue-steel, highlights go warm firelit.
          vec3 base = mix(col.rgb, vec3(l), uDesat);
          // The grade runs BEFORE tonemap (linear space), so mid-grey lands at
          // luminance ~0.21, not 0.5. Window the split on the linear ash band
          // (0.04..0.35) so shadows go cool but mid-bright terrain isn't forced
          // cold — otherwise the whole board reads as a flat cold cast.
          vec3 toneMul = mix(uShadowTint * 2.0, uHiTint * 2.0, smoothstep(0.04, 0.35, l));
          base = mix(base, base * toneMul, uSplit);
          col.rgb = base;
          // Filmic toe lift: gentle near-black crush toward a film response
          // curve; keeps the 0.05-luminance ground readable.
          col.rgb = col.rgb * (1.0 - uToe) + uToe * pow(max(col.rgb, vec3(0.0)), vec3(1.35));
          // Highlight-only warm glow bias: a faint amber lift on true
          // highlights, tying emitters into the warm key light.
          col.rgb += uHiTint * uHiGlow * smoothstep(0.55, 0.85, l);
          // Aspect-correct radial vignette; corners fall toward a cool near-black
          // instead of pure black so the murk stays in-palette.
          float aspect = uResolution.x / max(uResolution.y, 1.0);
          vec2 dv = (vUv - 0.5) * vec2(aspect, 1.0);
          float v = smoothstep(1.05, 0.6, length(dv));
          col.rgb = mix(uShadowTint * 0.4, col.rgb, mix(1.0, v, uVignette));
          // Faint animated film grain, weighted into the shadows, using the real
          // canvas resolution (no hardcoded 1920x1080 dependency).
          if (uGrain > 0.0) {
            float g = hash(vUv * uResolution + fract(uTime) * 100.0);
            col.rgb += (g - 0.5) * uGrain * (1.3 - l);
          }
          gl_FragColor = col;
        }
      `,
    };
    return new ShaderPass(shader);
  } catch (err) {
    console.warn('[gfx/post] grade pass unavailable, skipping', err);
    return null;
  }
}

/* ------------------------------ chain build ----------------------------- */

/**
 * Build the full post chain. Returns null if the composer itself cannot be
 * constructed (e.g. a GL context that cannot allocate the float render targets
 * bloom needs) — the host then renders directly, which still looks good thanks
 * to the tuned emissive/lighting rig.
 */
export function buildPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts: { tier: GfxTier; width: number; height: number; bloomDownscale: number },
): PostChain | null {
  try {
    const w = Math.max(1, Math.floor(opts.width));
    const h = Math.max(1, Math.floor(opts.height));
    // Bloom downscale: the bloom render targets run at a fraction of the
    // canvas resolution on lower tiers — a big mobile-fill-rate win that is
    // visually almost free because bloom is a soft, low-frequency effect.
    const ds = Math.max(1, opts.bloomDownscale);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    // Ground-truth ambient occlusion — darkens crevices, contact seams and the
    // pooled shadow where models meet the mat. High tier only (heaviest stage),
    // inserted BEFORE bloom so AO darkens the beauty pass before the bloom
    // threshold reads it. Wrapped so a failure never breaks the scene.
    let gtao: GTAOPass | null = null;
    if (opts.tier === 'high') {
      try {
        const pass = new GTAOPass(scene, camera, w, h);
        pass.output = GTAOPass.OUTPUT.Default;
        pass.blendIntensity = GTAO_BLEND;
        pass.updateGtaoMaterial({
          radius: GTAO_RADIUS,
          distanceExponent: 1.0,
          thickness: 1.0,
          scale: 1.0,
          samples: 8,
          screenSpaceRadius: false,
        });
        pass.updatePdMaterial({
          lumaPhi: 10,
          depthPhi: 2,
          normalPhi: 3,
          radius: 4,
          radiusExponent: 1,
          rings: 2,
          samples: 8,
        });
        composer.addPass(pass);
        gtao = pass;
      } catch {
        gtao = null;
      }
    }

    // Tuned so glow reads as firelight/plasma, not neon: a hot core with a
    // wide, hazy radius and a high threshold so ONLY the hottest emissive
    // (objective relics, Necron glow, muzzle/plasma FX) blooms — the rest of
    // the desaturated board stays grounded and dark. Bloom runs PRE-tonemap.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(w / ds)), Math.max(1, Math.floor(h / ds))),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    composer.addPass(bloom);

    // Cheap grimdark grade (see buildGradePass). On failure it is simply
    // skipped and bloom still renders.
    const grade = buildGradePass(w, h, opts.tier);
    if (grade) composer.addPass(grade);

    // Depth of field — the SINGLE biggest "this is a real photographed
    // miniatures diorama" cue. The focal plane tracks the orbit distance (fed
    // per-frame via updatePerFrame), so figures near the pivot stay crisp
    // while the far/near board falls softly out of focus. High tier only —
    // it renders an extra depth pass, so phones/low GPUs skip it.
    let bokeh: BokehPass | null = null;
    let bokehFocus: { value: number } | null = null;
    let bokehAperture: { value: number } | null = null;
    if (opts.tier === 'high') {
      try {
        const pass = new BokehPass(scene, camera, {
          focus: DOF_APERTURE_REF_DIST,
          aperture: DOF_APERTURE_BASE, // subtle — shallow miniatures DoF, not a blur wall
          maxblur: DOF_MAX_BLUR, // let the far board/frame actually soften (tilt-shift)
        });
        composer.addPass(pass);
        bokeh = pass;
        // Capture the uniform objects ONCE so updatePerFrame never allocates
        // (and never repeats the untyped-uniforms cast per frame).
        const u = pass.uniforms as Record<string, { value: number } | undefined>;
        bokehFocus = u.focus ?? null;
        bokehAperture = u.aperture ?? null;
      } catch {
        bokeh = null;
      }
    }

    // OutputPass applies tone mapping + colour space conversion correctly when
    // rendering through a composer.
    composer.addPass(new OutputPass());

    // SMAA — clean sub-pixel edge antialiasing on the fully-composited image.
    // Skipped on the low tier to save fill rate; AA is a nice-to-have, so a
    // failure here never breaks the scene.
    let smaa: SMAAPass | null = null;
    if (opts.tier !== 'low') {
      try {
        const pass = new SMAAPass(w, h);
        composer.addPass(pass);
        smaa = pass;
      } catch {
        smaa = null;
      }
    }

    composer.setSize(w, h);

    // Grade uTime uniform, captured once for the allocation-free frame hook.
    const gradeTime = grade ? (grade.uniforms.uTime as { value: number }) : null;

    return {
      composer,
      bloom,
      gtao,
      bokeh,
      smaa,
      grade,
      setSize(width: number, height: number): void {
        try {
          const sw = Math.max(1, Math.floor(width));
          const sh = Math.max(1, Math.floor(height));
          // Composer resizes every pass to the device resolution; bloom is then
          // re-shrunk to its downscaled targets (the composer's blanket resize
          // would otherwise silently promote it to full resolution), and GTAO's
          // G-buffer follows the canvas.
          composer.setSize(sw, sh);
          bloom.setSize(Math.max(1, Math.floor(sw / ds)), Math.max(1, Math.floor(sh / ds)));
          if (gtao) gtao.setSize(sw, sh);
          // Keep the grade's resolution in sync (drives the aspect-correct
          // vignette + the grain's pixel lattice).
          if (grade) {
            const res = grade.uniforms.uResolution;
            if (res) (res.value as THREE.Vector2).set(sw, sh);
          }
        } catch (err) {
          console.warn('[gfx/post] resize failed', err);
        }
      },
      setPixelRatio(pr: number): void {
        try {
          // EffectComposer re-runs setSize internally with the new ratio, so
          // every pass's device-pixel targets stay consistent.
          composer.setPixelRatio(pr);
        } catch (err) {
          console.warn('[gfx/post] setPixelRatio failed', err);
        }
      },
      updatePerFrame(t: number, camDist: number): void {
        // Zero allocations: three uniform writes, all objects pre-captured.
        if (gradeTime) gradeTime.value = t; // advances the film grain
        // Bias focus onto the front rank so the nearest figures are tack-sharp,
        // and drive aperture by distance so the DoF thickness stays constant
        // instead of going razor-thin zoomed-in / flat zoomed-out (the CoC
        // formula divides by focus distance).
        if (bokehFocus) bokehFocus.value = camDist * DOF_FOCUS_BIAS;
        if (bokehAperture) bokehAperture.value = DOF_APERTURE_BASE * (camDist / DOF_APERTURE_REF_DIST);
      },
      dispose(): void {
        // Every pass we created owns render targets / materials / textures
        // (SMAA's area+search LUTs, GTAO's noise textures, bloom's mip chain,
        // bokeh's depth target, the grade's ShaderMaterial). Pass.dispose()
        // frees them; the composer then frees its own ping-pong targets. Each
        // call is guarded so one failed teardown can't leak the rest.
        try { gtao?.dispose(); } catch { /* already torn down */ }
        try { bloom.dispose(); } catch { /* already torn down */ }
        try { grade?.dispose(); } catch { /* already torn down */ }
        try { bokeh?.dispose(); } catch { /* already torn down */ }
        try { smaa?.dispose(); } catch { /* already torn down */ }
        try { composer.dispose(); } catch { /* already torn down */ }
      },
    };
  } catch (err) {
    // Robust fallback: no composer, the host renders directly. Never break the
    // scene over post-processing.
    console.warn('[gfx/post] composer unavailable, rendering directly', err);
    return null;
  }
}
