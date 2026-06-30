import * as THREE from 'three';
import type {
  GameState,
  Objective,
  PlayerId,
  ProxyDescriptor,
  UnitInstance,
  Vec2,
} from '../engine/types';
import type { PickResult, SceneController } from './SceneController';
import {
  ModelLibrary,
  resolveModelEntry,
  type ModelRegistryEntry,
} from './ModelRegistry';
import { loadModel } from './ModelImport';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Three.js implementation of the renderer contract.
 *
 * Design goals:
 *  - Grimdark atmosphere: dark fog, filmic tone mapping, soft shadows.
 *  - Cheap & idempotent sync(): meshes are created lazily and cached; per-frame
 *    work is just transform updates, so calling sync() every frame is fine.
 *  - Robust input: a hand-rolled orbit/pan/zoom controller built on pointer
 *    events (no fragile example imports for the core experience).
 *
 * Coordinate convention: table coords are inches, origin bottom-left, X in
 * [0,width], Y in [0,height]. We map onto the XZ plane (y = up):
 *    worldX = tableX - width/2
 *    worldZ = -(tableY - height/2)
 * See tableToWorld / worldToTable.
 */

/* --------------------------- small math helpers --------------------------- */

const TAU = Math.PI * 2;
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ----------------------------- quality tiers ------------------------------ */

/**
 * Auto-detected quality tier. Drives pixel-ratio cap, shadow-map size, whether
 * bloom is enabled (and at what downscale), texture resolutions and how much
 * procedural geometry detail we spend. Detected once at init from screen size /
 * pixel ratio / GL capabilities, so the whole pipeline scales to the device
 * without any per-frame branching.
 */
type QualityTier = 'low' | 'medium' | 'high';

interface QualitySettings {
  tier: QualityTier;
  /** Hard cap on renderer pixel ratio (device DPR is clamped to this). */
  pixelRatioCap: number;
  /** Shadow map dimension (square). 0 disables shadows entirely. */
  shadowMapSize: number;
  /** Whether the bloom composer is built at all. */
  bloom: boolean;
  /** Bloom render-target downscale (1 = full res, 2 = half res — cheaper). */
  bloomDownscale: number;
  /** Battlemat canvas texture resolution (px on the long edge). */
  battlematPx: number;
  /** Radial segment budget for round geometry (bases, rings, discs). */
  ringSegments: number;
  /** Whether to render the soft contact-shadow blob under each model. */
  contactShadows: boolean;
}

/**
 * Pick a quality tier from the environment. Phones (small CSS viewport and/or
 * high DPR with limited GPU) land on 'low'/'medium'; desktops on 'high'. We err
 * toward smoothness: a wrong guess only costs a little fidelity, never frames.
 */
function detectQuality(width: number, height: number, gl: THREE.WebGLRenderer): QualitySettings {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const minSide = Math.min(width || 800, height || 600);
  const coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  // WebGL2 gives us float render targets for clean bloom; without it, downscale.
  const isWebGL2 = gl.capabilities.isWebGL2 === true;

  // Heuristic: small viewport OR coarse pointer (touch) with modest cores -> phone.
  const phone = minSide < 640 || (coarsePointer && cores <= 6);
  const tablet = !phone && (minSide < 1024 || coarsePointer);

  if (phone) {
    return {
      tier: 'low',
      pixelRatioCap: Math.min(dpr, 1.5),
      shadowMapSize: 1024,
      bloom: isWebGL2, // skip bloom on flaky WebGL1 mobile contexts
      bloomDownscale: 2,
      battlematPx: 1024,
      ringSegments: 28,
      contactShadows: true,
    };
  }
  if (tablet) {
    return {
      tier: 'medium',
      pixelRatioCap: Math.min(dpr, 1.5),
      shadowMapSize: 2048,
      bloom: true,
      bloomDownscale: isWebGL2 ? 1 : 2,
      battlematPx: 1536,
      ringSegments: 40,
      contactShadows: true,
    };
  }
  return {
    tier: 'high',
    // 1.5 is the sweet spot even on retina/4K: with bloom + grain + grain the
    // extra pixels of a full 2x are imperceptible but cost ~80% more fill rate.
    // The adaptive governor scales this further down if the GPU can't keep up.
    pixelRatioCap: Math.min(dpr, 1.5),
    shadowMapSize: 2048,
    bloom: true,
    bloomDownscale: 1,
    battlematPx: 2048,
    ringSegments: 56,
    contactShadows: true,
  };
}

/* ----------------------------- per-unit cache ----------------------------- */

interface ModelVisual {
  /** The whole model: base + body, positioned at table location. */
  group: THREE.Group;
  /**
   * The body sub-group (procedural silhouette OR a real glTF clone). Swapped in
   * place when an async GLB load completes; the base ring lives directly on
   * `group` so it shows immediately and survives the swap.
   */
  body: THREE.Group;
  /** Cached "alive" flag so we can detect death transitions. */
  alive: boolean;
  /** Animation progress for the death sink (1 = fully alive, 0 = sunk). */
  vitality: number;
}

interface UnitVisual {
  group: THREE.Group;
  models: ModelVisual[];
  ownerId: PlayerId;
  /** Faction proxy colour (hex int) used to tint combat FX (tracers etc.). */
  factionColor: number;
  /** Optional imported model that replaces the procedural proxies. */
  imported?: THREE.Object3D;
}

/* -------------------------------- combat FX ------------------------------- *
 * Transient, fire-and-forget effects animated by the existing rAF loop.
 * Each active FX is a small struct with an `update(dt) -> alive` step; when it
 * dies we detach + dispose its objects. A hard particle cap keeps perf bounded.
 * ------------------------------------------------------------------------- */
interface FxEffect {
  /** Advance by dt seconds; return false when finished (then it is disposed). */
  update(dt: number): boolean;
  /** Detach + free all GPU resources owned by this effect. */
  dispose(): void;
  /** Approximate live sprite/mesh count, for the global cap. */
  cost: number;
}

/* ------------------------------ overlay types ----------------------------- */

interface FloatingNumber {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  baseY: number;
}

export class ThreeScene implements SceneController {
  /* --- three core --- */
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private container!: HTMLElement;
  private clock = new THREE.Clock();

  /* --- board --- */
  private board = { width: 60, height: 44 };
  private boardGroup = new THREE.Group();

  /* --- units / objectives --- */
  private unitVisuals = new Map<string, UnitVisual>();
  private objectiveMeshes = new Map<string, THREE.Mesh>();
  private unitsGroup = new THREE.Group();
  private objectivesGroup = new THREE.Group();

  /* --- overlays --- */
  private overlayGroup = new THREE.Group();
  private highlightRing: THREE.Mesh | null = null;
  private highlightedUnit: string | null = null;
  private targetRings = new Map<string, THREE.Mesh>();
  private floatingNumbers: FloatingNumber[] = [];

  /* --- combat FX --- */
  /** Dedicated group so FX never interfere with picking (it's never raycast). */
  private fxGroup = new THREE.Group();
  /** Active transient effects, stepped by the rAF loop and auto-disposed. */
  private fxEffects: FxEffect[] = [];
  /** Live sprite/mesh particle count, kept under a per-tier hard cap. */
  private fxParticleCount = 0;
  /** Subtle screen-space shake state (decays each frame). */
  private fxShake = 0;
  /** Accessibility/battery: shorten or skip FX when on. */
  private reducedMotion = false;
  /** Cached shared FX resources (sprite textures, geometries, materials). */
  private fxGlowTex: THREE.Texture | null = null;
  private fxSparkTex: THREE.Texture | null = null;

  /* --- selection/target ring template materials --- */
  private ringGeoCache = new Map<string, THREE.RingGeometry>();

  /* --- shared geometry / material caches (perf) --- */
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();

  /* --- real-model loader (GLB cache + per-model clones) --- */
  private modelLibrary = new ModelLibrary();

  /* --- input --- */
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pickHandler: ((r: PickResult) => void) | null = null;
  private hoverHandler: ((r: PickResult) => void) | null = null;

  /* --- camera orbit state (hand-rolled controls) --- */
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitAzimuth = 0.6; // radians around Y
  private orbitPolar = 0.95; // radians from +Y axis (down-tilt)
  private orbitRadius = 70;
  private orbitMinRadius = 12;
  private orbitMaxRadius = 220;
  // smoothed targets for inertia
  private targetAzimuth = 0.6;
  private targetPolar = 0.95;
  private targetRadius = 70;
  private targetPivot = new THREE.Vector3(0, 0, 0);
  /** Cinematic auto-orbit speed (rad/sec around Y); 0 = off. Integrated into
   *  the single per-frame camera update — no second loop, no allocations. */
  private autoOrbitSpeed = 0;

  private dragMode: 'none' | 'orbit' | 'pan' = 'none';
  private lastPointer = { x: 0, y: 0 };
  private movedDuringDrag = false;
  private activePointerId: number | null = null;

  private rafId = 0;
  private disposed = false;

  /* --- postprocessing (gentle bloom so glow/objectives pop) --- */
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  /** Cheap final grimdark grade (vignette + desaturation + optional grain). */
  private gradePass: ShaderPass | null = null;

  /* --- quality / mobile-perf --- */
  private quality!: QualitySettings;
  /* Adaptive performance governor: measures frame time and scales the effective
   * pixel ratio down (and, as a last resort, drops bloom) when the GPU can't
   * hold a smooth frame rate — then recovers when there's headroom. Keeps the
   * sim smooth on weak/integrated/mobile GPUs without a fixed low-quality mode. */
  private basePixelRatio = 1; // the tier's chosen cap (governor scales from this)
  private perfScale = 1; // adaptive multiplier on basePixelRatio (1 .. 0.6)
  private perfFrameMs = 16.7; // EMA of frame time (ms)
  private perfAccum = 0; // seconds since last governor evaluation
  private perfGoodHolds = 0; // consecutive good evaluations (for slow recovery)
  private perfBloomDropped = false; // bloom disabled by the governor (floor state)
  /* Offline capture: when true the rAF loop stops and frames are driven by
   * tick(dt) with a virtual clock, for smooth deterministic video on any GPU. */
  private manualMode = false;
  private manualTime = 0;
  /** PMREM-generated environment map (procedural) for PBR reflections. */
  private envTexture: THREE.Texture | null = null;
  /** Animated objective groups (holo-ring spin + bob). */
  private objectiveGroups: THREE.Group[] = [];
  /** Faint ground-haze plane (additive) drifting just above the mat. */
  private haze: THREE.Mesh | null = null;
  /** Cheap additive dust-mote points; null/empty on 'low' tier. */
  private dustMotes: THREE.Points | null = null;
  /** Per-mote base data for the slow drift animation (xz extent + speeds). */
  private dustData: { baseY: Float32Array; phase: Float32Array; speed: Float32Array } | null =
    null;
  /** Local idle mixers for imported skinned models (driven in the render loop). */
  private importedMixers: THREE.AnimationMixer[] = [];
  /** Reusable scratch vectors to avoid per-frame allocation in pan/update. */
  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private readonly UP = new THREE.Vector3(0, 1, 0);

  /* ============================== lifecycle ============================== */

  init(container: HTMLElement, state: GameState): void {
    this.container = container;
    this.board = { width: state.board.width, height: state.board.height };

    const cw = container.clientWidth || 800;
    const ch = container.clientHeight || 600;

    /* renderer */
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });

    /* auto-detect a quality tier from screen size / DPR / GL capabilities so the
     * whole pipeline (pixel ratio, shadows, bloom, texture sizes) scales to the
     * device — phones stay smooth, desktops look premium. */
    this.quality = detectQuality(cw, ch, this.renderer);
    this.basePixelRatio = this.quality.pixelRatioCap;

    this.renderer.setPixelRatio(this.quality.pixelRatioCap);
    this.renderer.setSize(cw, ch);
    // Filmic tone mapping pulled down for a moodier, more cinematic grimdark
    // grade: deeper shadows, slightly crushed highlights so firelight/plasma
    // glow reads as hot light rather than a washed-out scene.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    /* scene + grimdark atmosphere: a colder, deeper near-black with a faint
     * steel-blue cast. Fog drawn in a touch closer so the board edges dissolve
     * into murk sooner, reading as a battlefield swallowed by ash and dark. */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070809);
    this.scene.fog = new THREE.Fog(0x080a0d, this.board.width * 0.8, this.board.width * 2.3);

    /* procedural environment: gives PBR materials real, subtle reflections and
     * a soft cool ambient. Built once via PMREM from RoomEnvironment, tinted
     * cold to stay grimdark. Robust: failures simply leave scene.environment
     * null and everything still renders from the explicit lights. */
    this.setupEnvironment();

    /* camera */
    this.camera = new THREE.PerspectiveCamera(50, cw / ch, 0.1, 1000);

    /* lights */
    this.setupLights();

    /* world graph */
    this.scene.add(this.boardGroup);
    this.scene.add(this.objectivesGroup);
    this.scene.add(this.unitsGroup);
    this.scene.add(this.overlayGroup);
    this.scene.add(this.fxGroup);

    this.buildBoard();
    this.buildTerrain(state);

    /* grimdark battlefield grit: low-poly rubble + broken gothic-industrial
     * props scattered deterministically, never over terrain or deployment
     * zones. Skipped on 'low' tier (phones) to keep draw calls down. */
    this.buildScatter(state);

    /* grimdark mood: faint ground haze + cheap drifting dust motes */
    this.buildAtmosphere();

    /* postprocessing (optional, robust): gentle bloom for glow + objectives */
    this.setupComposer();

    /* input + sizing */
    this.attachInput();
    this.resize();
    this.frameBoard();

    /* initial population */
    this.sync(state);

    /* render loop */
    this.clock.start();
    this.animate();
  }

  /**
   * Build a procedural environment map for image-based lighting / reflections.
   *
   * RoomEnvironment (a three example scene of soft area lights) is run through a
   * PMREMGenerator to produce a pre-filtered cube map. We assign it to
   * scene.environment so every PBR material picks up gentle, physically-plausible
   * reflections and ambient — the single biggest "premium" upgrade for the units
   * and metal terrain. We intentionally do NOT set it as the background (we keep
   * the dark fog colour) so the mood stays grimdark.
   *
   * Robust: the generator/float-target path can fail on limited contexts, so the
   * whole thing is wrapped — on failure scene.environment stays null and the
   * explicit three-point lighting carries the scene.
   */
  private setupEnvironment(): void {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const envScene = new RoomEnvironment();
      const rt = pmrem.fromScene(envScene, 0.04);
      this.envTexture = rt.texture;
      this.scene.environment = this.envTexture;
      // Keep reflections subtle/cold so they read as grimdark, not showroom.
      // Trimmed a touch for the moodier grade — metal catches just a cold
      // sheen, never a bright studio reflection.
      this.scene.environmentIntensity = 0.28;
      pmrem.dispose();
      // RoomEnvironment builds throwaway geometry/materials; free them.
      this.disposeObject(envScene);
    } catch (err) {
      console.warn('[ThreeScene] environment map unavailable, using lights only', err);
      this.envTexture = null;
      this.scene.environment = null;
    }
  }

  /**
   * Richer three-point lighting with a grimdark palette: a warm raking key with
   * soft shadows, a cold rim/back light to carve silhouettes against the dark
   * board, and a dim cool fill. Hemisphere adds a touch of sky/ground bounce.
   */
  private setupLights(): void {
    // Hemisphere fill: cold steel sky, dim ember-warm ground bounce. Pulled
    // down hard for grimdark — ambient barely lifts the blacks so the key light
    // carves dramatic, deep shadows and the board sinks into murk at the edges.
    const hemi = new THREE.HemisphereLight(0x424e63, 0x140d06, 0.34);
    this.scene.add(hemi);

    // Key directional light with shadows — warm firelight, raking angle for
    // drama. Slightly hotter/oranger than before so lit faces read as torch or
    // furnace light against the cold dark.
    const key = new THREE.DirectionalLight(0xffdcaa, 2.7);
    key.position.set(this.board.width * 0.4, this.board.width * 0.9, this.board.height * 0.5);
    key.castShadow = this.quality.shadowMapSize > 0;
    const sm = Math.max(512, this.quality.shadowMapSize);
    key.shadow.mapSize.set(sm, sm);
    const span = Math.max(this.board.width, this.board.height) * 0.75;
    const cam = key.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = this.board.width * 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    // Cold steel rim/back light from behind to carve model silhouettes out of
    // the dark board — bumped a little to keep figures readable now that the
    // ambient is darker. This is the cool counterpoint to the warm key.
    const rim = new THREE.DirectionalLight(0x9cc0ff, 0.95);
    rim.position.set(-this.board.width * 0.45, this.board.width * 0.55, -this.board.height * 0.6);
    this.scene.add(rim);

    // Subtle cool fill from the opposite low side, no shadows — lifts the
    // deepest shadows just enough to keep detail without killing contrast.
    const fill = new THREE.DirectionalLight(0x4a5f96, 0.3);
    fill.position.set(-this.board.width * 0.5, this.board.width * 0.3, this.board.height * 0.3);
    this.scene.add(fill);

    // Warm ember point light low over the board centre — a faint pool of
    // firelight that warms the middle of the battlefield and falls off into the
    // cold dark, the "embers of warm light" of the grimdark grade. No shadow
    // (cheap), modest range so it never flattens the contrast.
    const ember = new THREE.PointLight(0xff8a3c, 0.55, this.board.width * 0.9, 2.0);
    ember.position.set(0, 6, 0);
    this.scene.add(ember);
  }

  /**
   * Build an EffectComposer with a gentle UnrealBloom so Necron glow and
   * objective beacons pop. Wrapped in try/catch and a manual capability check:
   * if the GL context can't support the float targets bloom needs (e.g. some
   * headless contexts), we silently fall back to direct rendering — the scene
   * still looks good thanks to tuned emissive/lighting.
   */
  private setupComposer(): void {
    // Quality gate: low-end / flaky WebGL contexts skip bloom entirely and render
    // directly. Tuned emissive + the environment map keep the look strong.
    if (!this.quality.bloom) {
      this.composer = null;
      this.bloomPass = null;
      return;
    }
    try {
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const w = Math.max(1, size.x);
      const h = Math.max(1, size.y);
      // Optional bloom downscale: the bloom render targets run at a fraction of
      // the canvas resolution on lower tiers — a big mobile-fill-rate win that is
      // visually almost free because bloom is a soft, low-frequency effect.
      const ds = Math.max(1, this.quality.bloomDownscale);
      const bw = Math.max(1, Math.floor(w / ds));
      const bh = Math.max(1, Math.floor(h / ds));

      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));

      // Tuned so glow reads as firelight/plasma, not neon: a softer strength
      // with a wide, hazy radius and a high threshold so ONLY the hottest
      // emissive (objective relics, Necron glow, muzzle/plasma FX) blooms — the
      // rest of the desaturated board stays grounded and dark.
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(bw, bh),
        0.48, // strength (gentle halo, not a neon wash)
        0.85, // radius (wide, soft — reads as glow in haze)
        0.86, // threshold (only the brightest hot spots bloom)
      );
      composer.addPass(bloom);

      // Cheap grimdark grade pass (vignette + desaturation toward steel/ash +
      // faint film grain). Wrapped in its own try/catch inside; on any failure
      // it is simply skipped and bloom still renders.
      this.addGradePass(composer);

      // OutputPass applies tone mapping + colour space conversion correctly when
      // rendering through a composer.
      composer.addPass(new OutputPass());

      composer.setPixelRatio(this.quality.pixelRatioCap);
      composer.setSize(w, h);

      this.composer = composer;
      this.bloomPass = bloom;
    } catch (err) {
      // Robust fallback: no composer, render directly. Never break the scene.
      console.warn('[ThreeScene] bloom composer unavailable, rendering directly', err);
      this.composer = null;
      this.bloomPass = null;
    }
  }

  /**
   * Add a single, cheap full-screen grade pass to the composer for a cinematic
   * grimdark finish:
   *  - radial VIGNETTE (deepens the corners into murk),
   *  - global DESATURATION pulled toward a steel/ash tint (kills the bright,
   *    "video-game" colour and unifies the palette),
   *  - faint animated FILM GRAIN (skipped on 'low' tier — phones get a static
   *    cheaper path) so the image reads as gritty film, not clean CG.
   *
   * One extra fragment pass over the canvas: a few math ops per pixel, no
   * texture fetches beyond the input — robust on the swiftshader headless
   * renderer and cheap on mobile. Entirely wrapped: any failure leaves the
   * composer with just bloom + output (the scene still renders).
   */
  private addGradePass(composer: EffectComposer): void {
    try {
      // Grain is the only per-pixel-random work; disable it on 'low' so phones
      // pay nothing for it. The vignette + desaturation are effectively free.
      const grain = this.quality.tier === 'low' ? 0.0 : 1.0;
      const shader = {
        uniforms: {
          tDiffuse: { value: null as THREE.Texture | null },
          uTime: { value: 0 },
          uVignette: { value: 0.62 }, // 0 = none, 1 = heavy corners
          uDesat: { value: 0.26 }, // pull toward grey/steel
          uGrain: { value: grain * 0.05 }, // grain amplitude
          uTint: { value: new THREE.Color(0x8088a0) }, // cold steel/ash tint
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
          uniform vec3 uTint;
          varying vec2 vUv;
          // cheap hash for grain
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          void main() {
            vec4 col = texture2D(tDiffuse, vUv);
            // Desaturate toward luma, then bias the grey toward a cold tint so
            // the whole frame settles into desaturated steel/ash.
            float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
            vec3 steel = mix(vec3(l), l * uTint, 0.5);
            col.rgb = mix(col.rgb, steel, uDesat);
            // Radial vignette: darken corners into murk.
            vec2 d = vUv - 0.5;
            float v = smoothstep(0.8, 0.18, dot(d, d) * 2.0);
            col.rgb *= mix(1.0, v, uVignette);
            // Faint animated film grain (amplitude 0 on low tier).
            if (uGrain > 0.0) {
              float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0);
              col.rgb += (g - 0.5) * uGrain;
            }
            gl_FragColor = col;
          }
        `,
      };
      const pass = new ShaderPass(shader);
      composer.addPass(pass);
      this.gradePass = pass;
    } catch (err) {
      console.warn('[ThreeScene] grade pass unavailable, skipping', err);
      this.gradePass = null;
    }
  }

  /* ============================ coordinate maps ============================ */

  private tableToWorld(p: Vec2, y = 0): THREE.Vector3 {
    return new THREE.Vector3(p.x - this.board.width / 2, y, -(p.y - this.board.height / 2));
  }

  private worldToTable(v: THREE.Vector3): Vec2 {
    return { x: v.x + this.board.width / 2, y: -v.z + this.board.height / 2 };
  }

  /* ============================== board build ============================= */

  private buildBoard(): void {
    const { width, height } = this.board;

    // Procedural battlemat: albedo (ash/rubble + painted deployment zones + a
    // faint measured grid) plus a matching roughness map for cheap surface
    // variation, so wet/scorched patches catch the light differently.
    const built = this.makeBattlematTextures(width, height);
    const mat = new THREE.MeshStandardMaterial({
      map: built.albedo,
      roughnessMap: built.roughness ?? undefined,
      roughness: 0.95,
      metalness: 0.0,
      color: 0xffffff,
      // Environment reflections are very subtle on the mat; keep it matte.
      envMapIntensity: 0.25,
    });
    const boardGeo = new THREE.PlaneGeometry(width, height, 1, 1);
    boardGeo.rotateX(-Math.PI / 2); // lie flat on XZ
    const boardMesh = new THREE.Mesh(boardGeo, mat);
    boardMesh.receiveShadow = true;
    boardMesh.name = 'battlemat';
    this.boardGroup.add(boardMesh);

    // A raised plinth/table beneath the mat: a dark, slightly inset slab plus a
    // beveled metal frame around it, so the board reads as a real gaming table
    // rather than a floating plane.
    const plinthH = 1.6;
    const plinthOver = 2.6; // how far the plinth extends past the play area
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x0c0e12,
      roughness: 0.85,
      metalness: 0.1,
      envMapIntensity: 0.3,
    });
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(width + plinthOver * 2, plinthH, height + plinthOver * 2),
      plinthMat,
    );
    plinth.position.y = -plinthH / 2 - 0.02;
    plinth.receiveShadow = true;
    this.boardGroup.add(plinth);

    // Gothic-industrial war-table edge: chamfered brass-and-iron rails with
    // repeating engraved panels, corner bastion blocks, rivets and a faint
    // hazard-stripe inlay. Built as a frame strictly OUTSIDE the play area so it
    // never overlaps the mat or any terrain footprint.
    this.buildWarTableFrame(width, height);
  }

  /**
   * Gothic-industrial war-table frame surrounding the play surface. All original
   * motifs (chamfered iron rails, engraved recessed panels, corner bastion
   * blocks, rivet rows, hazard-stripe inlay) — no real-world / GW iconography.
   *
   * Geometry budget scales with the quality tier: rivets and per-panel engraving
   * are dropped on 'low' so phones stay light. The frame lives entirely beyond
   * ±width/2 / ±height/2, so it can never cover the mat or a terrain footprint.
   */
  private buildWarTableFrame(width: number, height: number): void {
    const frame = new THREE.Group();
    frame.name = 'warTableFrame';

    const lowTier = this.quality.tier === 'low';
    const railT = 2.0; // rail thickness (outward from play edge)
    const railH = 1.15; // rail height
    const innerLipH = 0.35; // a slim raised inner lip kissing the mat edge

    // --- shared materials (cached so frames across rebuilds share state) ---
    const ironMat = this.getMaterial('frameIron', () =>
      new THREE.MeshStandardMaterial({
        color: 0x1c2026,
        roughness: 0.55,
        metalness: 0.85,
        envMapIntensity: 0.9,
      }),
    );
    const brassMat = this.getMaterial('frameBrass', () =>
      new THREE.MeshStandardMaterial({
        color: 0x6e5a2e,
        roughness: 0.42,
        metalness: 0.95,
        emissive: 0x140e04,
        emissiveIntensity: 0.4,
        envMapIntensity: 1.0,
      }),
    );
    const panelMat = this.getMaterial('framePanel', () =>
      new THREE.MeshStandardMaterial({
        color: 0x101216,
        roughness: 0.7,
        metalness: 0.6,
        envMapIntensity: 0.5,
      }),
    );
    const hazardMat = this.getMaterial('frameHazard', () => {
      const m = new THREE.MeshStandardMaterial({
        roughness: 0.6,
        metalness: 0.3,
        map: this.makeHazardStripeTexture(),
        envMapIntensity: 0.4,
      });
      return m;
    });

    // half extents of the play surface; rails are centred on the lines just
    // outside these so the inner face sits flush with the mat edge.
    const hw = width / 2;
    const hh = height / 2;

    /**
     * Build one chamfered rail of length `len` running along an axis. Returned in
     * local space (long axis = X, thickness = Z, height = Y) so callers rotate +
     * position it. The chamfer is faked with a wider base box + a narrower bevel
     * cap, plus a brass top fillet and recessed engraved panels along its face.
     */
    const makeRail = (len: number): THREE.Group => {
      const g = new THREE.Group();
      // Lower iron body (slightly wider, the structural rail).
      const body = new THREE.Mesh(
        this.getGeometry(`railBody:${len.toFixed(1)}:${railT}:${railH}`, () =>
          new THREE.BoxGeometry(len, railH, railT),
        ),
        ironMat,
      );
      body.position.y = railH / 2 - 0.02;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);

      // Chamfered iron cap (narrower in Z, sits on top) -> reads as a bevel.
      const cap = new THREE.Mesh(
        this.getGeometry(`railCap:${len.toFixed(1)}:${railT}:${railH}`, () =>
          new THREE.BoxGeometry(len, railH * 0.28, railT * 0.62),
        ),
        ironMat,
      );
      cap.position.y = railH - 0.02;
      cap.castShadow = true;
      g.add(cap);

      // Brass top fillet running the rail length (the warm metal highlight).
      const fillet = new THREE.Mesh(
        this.getGeometry(`railFillet:${len.toFixed(1)}`, () =>
          new THREE.BoxGeometry(len, railH * 0.12, railT * 0.3),
        ),
        brassMat,
      );
      fillet.position.y = railH + railH * 0.1 - 0.02;
      g.add(fillet);

      // Hazard-stripe inlay strip on the outer top face (faint, painted look).
      const hazard = new THREE.Mesh(
        this.getGeometry(`railHazard:${len.toFixed(1)}`, () => {
          const hg = new THREE.PlaneGeometry(len, railT * 0.22);
          hg.rotateX(-Math.PI / 2);
          return hg;
        }),
        hazardMat,
      );
      hazard.position.set(0, railH + 0.02, railT * 0.34);
      hazard.receiveShadow = true;
      g.add(hazard);

      // Repeating engraved recessed panels along the inner face. On 'low' tier we
      // skip these to save draw calls — the rail still reads as a frame.
      if (!lowTier) {
        const panelW = 3.4;
        const gap = 1.0;
        const pitch = panelW + gap;
        const count = Math.max(1, Math.floor((len - gap) / pitch));
        const used = count * pitch - gap;
        const start = -used / 2 + panelW / 2;
        const panelGeo = this.getGeometry('framePanelGeo', () =>
          new THREE.BoxGeometry(panelW, railH * 0.5, 0.12),
        );
        const brassGeo = this.getGeometry('framePanelStud', () =>
          new THREE.BoxGeometry(panelW * 0.18, railH * 0.5 * 0.7, 0.16),
        );
        for (let i = 0; i < count; i++) {
          const px = start + i * pitch;
          const panel = new THREE.Mesh(panelGeo, panelMat);
          // recessed slightly into the inner face (toward -Z, the play side)
          panel.position.set(px, railH * 0.5, -railT / 2 + 0.05);
          g.add(panel);
          // a slim central brass stud/boss for the engraved motif accent
          const stud = new THREE.Mesh(brassGeo, brassMat);
          stud.position.set(px, railH * 0.5, -railT / 2 + 0.02);
          g.add(stud);
        }
      }

      // Rivet rows along the top edge (additive detail; skipped on 'low').
      if (!lowTier) {
        const rivetGeo = this.getGeometry('frameRivet', () =>
          new THREE.SphereGeometry(0.12, 6, 5),
        );
        const rivetPitch = 2.4;
        const n = Math.max(2, Math.floor(len / rivetPitch));
        for (let i = 0; i <= n; i++) {
          const rx = -len / 2 + (i / n) * len;
          const rivet = new THREE.Mesh(rivetGeo, brassMat);
          rivet.position.set(rx, railH - 0.02, -railT * 0.28);
          g.add(rivet);
        }
      }

      return g;
    };

    // Long rails span the full width plus the corner bastions; place them just
    // outside the top/bottom play edges.
    const railLen = width; // inner face flush; bastions cover the corners
    const top = makeRail(railLen);
    top.position.set(0, 0, hh + railT / 2);
    frame.add(top);

    const bottom = makeRail(railLen);
    bottom.rotation.y = Math.PI; // engraved face still points inward
    bottom.position.set(0, 0, -hh - railT / 2);
    frame.add(bottom);

    const left = makeRail(height);
    left.rotation.y = Math.PI / 2;
    left.position.set(-hw - railT / 2, 0, 0);
    frame.add(left);

    const right = makeRail(height);
    right.rotation.y = -Math.PI / 2;
    right.position.set(hw + railT / 2, 0, 0);
    frame.add(right);

    // Corner bastion blocks: taller chamfered towers anchoring each corner,
    // capped with a brass boss. They sit fully outside the play area.
    const bastionGeo = this.getGeometry('frameBastion', () =>
      new THREE.BoxGeometry(railT * 1.7, railH * 1.7, railT * 1.7),
    );
    const bastionCapGeo = this.getGeometry('frameBastionCap', () =>
      new THREE.BoxGeometry(railT * 1.2, railH * 0.3, railT * 1.2),
    );
    const bossGeo = this.getGeometry('frameBoss', () =>
      new THREE.CylinderGeometry(railT * 0.34, railT * 0.42, railH * 0.45, 6),
    );
    const cornerX = hw + railT / 2;
    const cornerZ = hh + railT / 2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const b = new THREE.Mesh(bastionGeo, ironMat);
        b.position.set(sx * cornerX, (railH * 1.7) / 2 - 0.02, sz * cornerZ);
        b.castShadow = true;
        b.receiveShadow = true;
        frame.add(b);
        const cap = new THREE.Mesh(bastionCapGeo, ironMat);
        cap.position.set(sx * cornerX, railH * 1.7 - 0.02, sz * cornerZ);
        frame.add(cap);
        const boss = new THREE.Mesh(bossGeo, brassMat);
        boss.position.set(sx * cornerX, railH * 1.7 + railH * 0.18, sz * cornerZ);
        frame.add(boss);
      }
    }

    // A slim raised inner lip hugging the mat edge so the play surface reads as
    // recessed within the frame (kept just outside the mat to avoid z-fighting).
    const lipMat = ironMat;
    const makeLip = (w: number, d: number, x: number, z: number) => {
      const lip = new THREE.Mesh(
        this.getGeometry(`frameLip:${w.toFixed(1)}:${d.toFixed(1)}`, () =>
          new THREE.BoxGeometry(w, innerLipH, d),
        ),
        lipMat,
      );
      lip.position.set(x, innerLipH / 2 + 0.01, z);
      lip.receiveShadow = true;
      frame.add(lip);
    };
    const lipT = 0.5;
    makeLip(width + lipT * 2, lipT, 0, hh + lipT / 2);
    makeLip(width + lipT * 2, lipT, 0, -hh - lipT / 2);
    makeLip(lipT, height, hw + lipT / 2, 0);
    makeLip(lipT, height, -hw - lipT / 2, 0);

    this.boardGroup.add(frame);
  }

  /**
   * Procedural hazard-stripe texture (dark/brass diagonal caution stripes) for
   * the faint rim inlay. Cached + low-res; reads as worn painted metal.
   */
  private hazardStripeTex: THREE.Texture | null = null;
  private makeHazardStripeTexture(): THREE.Texture {
    if (this.hazardStripeTex) return this.hazardStripeTex;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#15171b';
    ctx.fillRect(0, 0, c.width, c.height);
    // diagonal brass/iron stripes
    const stripeW = 22;
    ctx.lineWidth = stripeW;
    ctx.strokeStyle = '#5a4a24';
    for (let x = -c.height; x < c.width + c.height; x += stripeW * 2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + c.height, c.height);
      ctx.stroke();
    }
    // grime/scratch overlay so the paint looks worn, not pristine
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 6, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(12, 1);
    tex.needsUpdate = true;
    this.hazardStripeTex = tex;
    return tex;
  }

  /* ============================== atmosphere ============================== */

  /**
   * Grimdark mood layer over the board:
   *  - a faint, additive ground-haze plane drifting just above the mat (a cheap
   *    fake of volumetric fog — one soft radial texture, no extra passes), and
   *  - capped, additive dust motes as THREE.Points (disabled on 'low' tier).
   *
   * Both are purely cosmetic, never raycast (they live in their own throwaway
   * objects under boardGroup) and are kept subtle so models/objectives stay
   * readable. All per-frame cost is a single attribute write + matrix update.
   */
  private buildAtmosphere(): void {
    const { width, height } = this.board;

    // --- ground haze: a big soft additive quad hovering low over the mat ---
    const hazeGeo = new THREE.PlaneGeometry(width * 1.1, height * 1.1, 1, 1);
    hazeGeo.rotateX(-Math.PI / 2);
    const hazeMat = new THREE.MeshBasicMaterial({
      map: this.makeHazeTexture(),
      transparent: true,
      opacity: this.quality.tier === 'low' ? 0.1 : 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0x2a3340, // cold blue-grey haze, kept dim so contrast holds
      fog: false,
    });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.position.y = 0.8;
    haze.renderOrder = 2; // draw after the mat/terrain
    this.haze = haze;
    this.boardGroup.add(haze);

    // --- dust motes: cheap additive points, capped, skipped on 'low' tier ---
    if (this.quality.tier === 'low') {
      this.dustMotes = null;
      this.dustData = null;
      return;
    }
    const count = this.quality.tier === 'high' ? 280 : 150;
    const positions = new Float32Array(count * 3);
    const baseY = new Float32Array(count);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const spanX = width * 0.95;
    const spanZ = height * 0.95;
    const ceiling = 9; // motes drift between ~0.4 and 9 inches up
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spanX;
      const y = 0.4 + Math.random() * ceiling;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spanZ;
      baseY[i] = y;
      phase[i] = Math.random() * TAU;
      speed[i] = 0.15 + Math.random() * 0.35;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      map: this.makeMoteTexture(),
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xb9c4d6,
      fog: true,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 3;
    points.frustumCulled = false;
    this.dustMotes = points;
    this.dustData = { baseY, phase, speed };
    this.boardGroup.add(points);
  }

  /** Soft radial haze texture (bright centre -> transparent edge), cached. */
  private hazeTex: THREE.Texture | null = null;
  private makeHazeTexture(): THREE.Texture {
    if (this.hazeTex) return this.hazeTex;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // a little large-scale blotch so the haze isn't a perfect disc
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 20 + Math.random() * 60;
      const bg = ctx.createRadialGradient(x, y, 2, x, y, r);
      bg.addColorStop(0, 'rgba(255,255,255,0.06)');
      bg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    this.hazeTex = tex;
    return tex;
  }

  /** Tiny soft circular sprite for dust motes (white core -> transparent). */
  private moteTex: THREE.Texture | null = null;
  private makeMoteTexture(): THREE.Texture {
    if (this.moteTex) return this.moteTex;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    this.moteTex = tex;
    return tex;
  }

  /**
   * Procedural battlemat texture set. Returns an albedo map (urban ash/rubble
   * with faintly painted deployment zones, a measured grid and a soft edge
   * vignette) and, when the tier affords it, a roughness map derived from the
   * same noise so scorched/wet patches vary their gloss. All canvas work runs
   * once at init; resolution scales with the quality tier.
   */
  private makeBattlematTextures(
    width: number,
    height: number,
  ): { albedo: THREE.Texture; roughness: THREE.Texture | null } {
    const px = this.quality.battlematPx;
    const cw = px;
    const ch = Math.round(px * (height / width));
    const pxPerInchX = cw / width;
    const pxPerInchY = ch / height;

    /* ---- albedo ---- */
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;

    // Base dark urban/ash tone with a faint vertical tonal gradient.
    const baseGrad = ctx.createLinearGradient(0, 0, 0, ch);
    baseGrad.addColorStop(0, '#171a20');
    baseGrad.addColorStop(0.5, '#131519');
    baseGrad.addColorStop(1, '#16181d');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, cw, ch);

    // Painted deployment zones: two large, soft translucent bands at the short
    // edges (player A near +Y short edge, player B near -Y), tinted by the
    // default faction colours but kept low-opacity so they read as paint.
    const zoneDepth = ch * 0.22;
    const paintZone = (top: number, h: number, col: string) => {
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, col.replace('ALPHA', '0.0'));
      g.addColorStop(0.6, col.replace('ALPHA', '0.16'));
      g.addColorStop(1, col.replace('ALPHA', '0.22'));
      ctx.fillStyle = g;
      ctx.fillRect(0, top, cw, h);
      // dashed boundary line
      ctx.strokeStyle = col.replace('ALPHA', '0.5');
      ctx.lineWidth = Math.max(2, cw * 0.0025);
      ctx.setLineDash([cw * 0.02, cw * 0.014]);
      const ly = top < ch / 2 ? top + h : top;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(cw, ly);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // top band (table Y near max) and bottom band; "rgba(r,g,b,ALPHA)" template.
    paintZone(0, zoneDepth, 'rgba(58,123,255,ALPHA)');
    paintZone(ch - zoneDepth, zoneDepth, 'rgba(255,64,48,ALPHA)');

    // Procedural mottling for an ashen, weathered look (rubble flecks).
    const flecks = Math.round(2600 * (px / 1024));
    for (let i = 0; i < flecks; i++) {
      const r = Math.random();
      const shade = 18 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgba(${shade},${shade + 2},${shade + 6},${0.04 + r * 0.06})`;
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      const s = (2 + Math.random() * 26) * (px / 1024);
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
    }
    // Scattered rubble chunks (small angular highlights) for texture.
    for (let i = 0; i < Math.round(220 * (px / 1024)); i++) {
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      const s = (3 + Math.random() * 7) * (px / 1024);
      ctx.fillStyle = `rgba(${60 + Math.random() * 30 | 0},${58 + Math.random() * 28 | 0},${
        54 + Math.random() * 26 | 0
      },0.18)`;
      ctx.fillRect(x, y, s, s * (0.5 + Math.random()));
    }
    // A few rust/ember streaks.
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(120,60,30,${0.03 + Math.random() * 0.05})`;
      ctx.lineWidth = (1 + Math.random() * 3) * (px / 1024);
      ctx.beginPath();
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120);
      ctx.stroke();
    }

    // Scorch blast marks: soft dark radial burns with a faint ember-warm core,
    // as if shells and plasma have cooked the rockcrete. Deterministic count
    // scaled to resolution; reads as battle damage, not noise.
    const scorchN = Math.round(16 * (px / 1024));
    for (let i = 0; i < scorchN; i++) {
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      const r = (16 + Math.random() * 64) * (px / 1024);
      const sg = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
      sg.addColorStop(0, 'rgba(10,8,6,0.5)');
      sg.addColorStop(0.4, 'rgba(14,11,8,0.32)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      // a faint warm rim where the burn cooled
      ctx.strokeStyle = `rgba(110,52,22,${0.05 + Math.random() * 0.05})`;
      ctx.lineWidth = (1 + Math.random() * 2) * (px / 1024);
      ctx.beginPath();
      ctx.arc(x, y, r * (0.5 + Math.random() * 0.3), 0, TAU);
      ctx.stroke();
    }

    // Blood-rust pools: dark oxidised crimson stains soaking into the ash.
    const stainN = Math.round(20 * (px / 1024));
    for (let i = 0; i < stainN; i++) {
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      const r = (8 + Math.random() * 34) * (px / 1024);
      const bg = ctx.createRadialGradient(x, y, 1, x, y, r);
      const a = 0.05 + Math.random() * 0.08;
      bg.addColorStop(0, `rgba(74,18,12,${a})`);
      bg.addColorStop(0.7, `rgba(52,14,10,${a * 0.6})`);
      bg.addColorStop(1, 'rgba(40,12,8,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      // irregular blob via a few overlapping arcs
      for (let k = 0; k < 3; k++) {
        const ox = (Math.random() - 0.5) * r;
        const oy = (Math.random() - 0.5) * r;
        ctx.moveTo(x + ox + r, y + oy);
        ctx.arc(x + ox, y + oy, r * (0.5 + Math.random() * 0.5), 0, TAU);
      }
      ctx.fill();
    }

    // Oil / promethium slicks: low-frequency dark glossy smears (the matching
    // roughness map below also dips here so they catch the light wet).
    for (let i = 0; i < Math.round(10 * (px / 1024)); i++) {
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      const w = (30 + Math.random() * 90) * (px / 1024);
      const h = (10 + Math.random() * 30) * (px / 1024);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * TAU);
      const og = ctx.createRadialGradient(0, 0, 1, 0, 0, w / 2);
      og.addColorStop(0, 'rgba(6,7,9,0.4)');
      og.addColorStop(1, 'rgba(6,7,9,0)');
      ctx.fillStyle = og;
      ctx.scale(1, h / w);
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Faint stencilled deployment chevrons + unit-marking ticks near the zone
    // boundaries — worn painted directional markings, original geometry only.
    const drawChevron = (cxp: number, cyp: number, size: number, col: string, up: boolean) => {
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
    const chevCols = ['rgba(70,90,130,0.10)', 'rgba(150,50,40,0.10)'];
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
    // Cracked plating: scatter darker fault lines for depth.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 70; i++) {
      ctx.lineWidth = (0.5 + Math.random() * 1.5) * (px / 1024);
      ctx.beginPath();
      let x = Math.random() * cw;
      let y = Math.random() * ch;
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segs; s++) {
        x += (Math.random() - 0.5) * 90 * (px / 1024);
        y += (Math.random() - 0.5) * 90 * (px / 1024);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Faint measured grid every 6 inches (minor) and 12 inches (major).
    const drawGrid = (step: number, style: string, lw: number) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      for (let gx = 0; gx <= width + 0.001; gx += step) {
        const x = gx * pxPerInchX;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch);
        ctx.stroke();
      }
      for (let gy = 0; gy <= height + 0.001; gy += step) {
        const y = gy * pxPerInchY;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cw, y);
        ctx.stroke();
      }
    };
    drawGrid(6, 'rgba(120,140,170,0.05)', 1);
    drawGrid(12, 'rgba(130,150,180,0.12)', 1);

    // Vignette: radial edge darkening so the board reads as a lit arena.
    const cx = cw / 2;
    const cy = ch / 2;
    const grad = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(cx, cy) * 0.4,
      cx,
      cy,
      Math.max(cx, cy) * 1.05,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    const albedo = new THREE.CanvasTexture(canvas);
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    albedo.needsUpdate = true;

    // Low tier skips the roughness map to save memory + a texture fetch.
    if (this.quality.tier === 'low') {
      return { albedo, roughness: null };
    }

    /* ---- roughness map: blotchy, so scorched/wet patches vary gloss ---- */
    const rCanvas = document.createElement('canvas');
    // Roughness can be lower-res; it's low frequency.
    rCanvas.width = Math.max(256, Math.floor(cw / 2));
    rCanvas.height = Math.max(256, Math.floor(ch / 2));
    const rctx = rCanvas.getContext('2d')!;
    rctx.fillStyle = '#d8d8d8'; // mostly rough (0.85-ish)
    rctx.fillRect(0, 0, rCanvas.width, rCanvas.height);
    for (let i = 0; i < 600; i++) {
      const x = Math.random() * rCanvas.width;
      const y = Math.random() * rCanvas.height;
      const s = 6 + Math.random() * 60;
      // Darker = smoother (wet/scorched glossy patches).
      const v = 120 + Math.floor(Math.random() * 80);
      rctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
      rctx.beginPath();
      rctx.arc(x, y, s, 0, TAU);
      rctx.fill();
    }
    const roughness = new THREE.CanvasTexture(rCanvas);
    roughness.needsUpdate = true;
    return { albedo, roughness };
  }

  /**
   * Draw the engine's terrain pieces 1:1 — what you see is exactly the footprint
   * the rules use for line of sight and cover. Ruins are rendered as broken-wall
   * shells (so you can see models inside), craters as sunken discs.
   */
  private buildTerrain(state: GameState): void {
    const terrainGroup = new THREE.Group();

    // Weathered concrete ruin material with a procedural noise texture so the
    // walls read as cast plascrete rather than flat boxes. Shared across ruins.
    const ruinTex = this.makeConcreteTexture();
    const ruinMat = new THREE.MeshStandardMaterial({
      color: 0x6a6253,
      map: ruinTex,
      roughness: 0.92,
      metalness: 0.05,
      envMapIntensity: 0.4,
    });
    const craterMat = new THREE.MeshStandardMaterial({
      color: 0x14110d,
      roughness: 1.0,
      metalness: 0.0,
    });
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x2f2b24,
      roughness: 0.96,
      metalness: 0.0,
    });

    for (const t of state.terrain) {
      const c = this.tableToWorld(t.center);
      if (t.kind === 'crater') {
        // Sunken crater: a dark bowl ring plus a debris lip, deterministic.
        const r = Math.max(t.width, t.depth) / 2;
        const bowl = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.78, r * 1.08, 0.5, this.quality.ringSegments),
          craterMat,
        );
        bowl.position.set(c.x, -0.05, c.z);
        bowl.receiveShadow = true;
        terrainGroup.add(bowl);
        // raised debris lip torus for readability + shadow catch
        const lip = new THREE.Mesh(
          new THREE.TorusGeometry(r * 0.95, 0.22, 6, this.quality.ringSegments),
          ruinMat,
        );
        lip.rotation.x = -Math.PI / 2;
        lip.position.set(c.x, 0.18, c.z);
        lip.castShadow = true;
        lip.receiveShadow = true;
        terrainGroup.add(lip);
        continue;
      }

      // Ruin: the SAME four wall segments + gaps as before (LoS/cover footprint
      // must not change), but each wall is now a broken-top shell with window
      // cut-outs. We build the wall from stacked blocks so the silhouette is
      // jagged and (for tall walls) punched with windows — purely visual; the
      // footprint rectangle each wall occupies is identical to the old box.
      const hw = t.width / 2;
      const hd = t.depth / 2;
      const th = 0.6; // wall thickness
      const walls: Array<[number, number, number, number]> = [
        [0, hd, t.width, th], // back
        [0, -hd, t.width * 0.55, th], // front (gap)
        [-hw, 0, th, t.depth], // left
        [hw, 0, th, t.depth * 0.55], // right (gap)
      ];
      // Deterministic per-piece RNG so terrain looks identical every render.
      let seed = this.hashId(t.id);
      const rng = () => {
        // xorshift32 — stable, no allocations.
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 10000) / 10000;
      };
      for (const [ox, oz, ww, dd] of walls) {
        const wall = this.buildRuinWall(ww, t.height, dd, ruinMat, rng);
        wall.position.set(c.x + ox, 0, c.z - oz);
        terrainGroup.add(wall);
      }
      // A faint floor pad to read the footprint from above.
      const pad = new THREE.Mesh(new THREE.BoxGeometry(t.width, 0.12, t.depth), padMat);
      pad.position.set(c.x, 0.07, c.z);
      pad.receiveShadow = true;
      terrainGroup.add(pad);
    }

    this.boardGroup.add(terrainGroup);
  }

  /**
   * Deterministic grimdark scatter: low-poly rubble chunks and a handful of
   * broken gothic-industrial props (leaning spikes, tattered banner poles,
   * cairn/skull-pile style mounds) strewn across the open battlefield. All
   * shapes are ORIGINAL gothic-industrial geometry — no real-world iconography.
   *
   * Placement is fully deterministic (seeded from the board size, no Math.random
   * in the layout) and rejection-sampled so a prop NEVER overlaps a terrain
   * footprint, the two deployment-zone bands, or sits too close to the table
   * centre line. Purely cosmetic: scatter lives in its own group and is never
   * raycast, so it can't interfere with picking or the rules footprints.
   *
   * Budget scales with tier: skipped entirely on 'low'; a modest count on
   * 'medium'; more on 'high'. Geometry + materials are cached/shared.
   */
  private buildScatter(state: GameState): void {
    if (this.quality.tier === 'low') return;
    const group = new THREE.Group();
    group.name = 'scatter';

    const { width, height } = this.board;
    // Forbidden rectangles (in table coords) = terrain footprints, padded.
    const blocked = state.terrain.map((t) => ({
      x: t.center.x,
      y: t.center.y,
      hw: t.width / 2 + 1.0,
      hd: t.depth / 2 + 1.0,
    }));
    // Deployment-zone depth mirrors the painted bands on the mat (~22%).
    const zoneDepth = height * 0.22;

    // Seeded RNG (xorshift32) keyed off board dims so layout is identical every
    // load but varies between boards. No allocations in the loop.
    let seed = this.hashId(`scatter:${width}x${height}`);
    const rng = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 100000) / 100000;
    };
    const free = (x: number, y: number, pad: number): boolean => {
      if (x < pad || x > width - pad || y < pad || y > height - pad) return false;
      if (y < zoneDepth || y > height - zoneDepth) return false; // keep zones clear
      for (const b of blocked) {
        if (Math.abs(x - b.x) < b.hw + pad && Math.abs(y - b.y) < b.hd + pad) return false;
      }
      return true;
    };

    // --- shared low-poly materials (cached) ---
    const rubbleMat = this.getMaterial('scatterRubble', () =>
      new THREE.MeshStandardMaterial({
        color: 0x4a4438,
        roughness: 0.95,
        metalness: 0.04,
        envMapIntensity: 0.3,
      }),
    );
    const ironMat = this.getMaterial('scatterIron', () =>
      new THREE.MeshStandardMaterial({
        color: 0x20242b,
        roughness: 0.6,
        metalness: 0.8,
        envMapIntensity: 0.7,
      }),
    );
    const boneMat = this.getMaterial('scatterBone', () =>
      new THREE.MeshStandardMaterial({
        color: 0x6e6450,
        roughness: 0.85,
        metalness: 0.02,
        envMapIntensity: 0.25,
      }),
    );
    const clothMat = this.getMaterial('scatterCloth', () =>
      new THREE.MeshStandardMaterial({
        color: 0x4a1410,
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.DoubleSide,
        envMapIntensity: 0.15,
      }),
    );

    const seg = Math.max(6, Math.round(this.quality.ringSegments * 0.3));
    const rubbleGeo = this.getGeometry('scatterRock', () =>
      new THREE.DodecahedronGeometry(0.5, 0),
    );

    const placeRubbleCluster = (x: number, y: number): void => {
      const w = this.tableToWorld({ x, y });
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const rock = new THREE.Mesh(rubbleGeo, rubbleMat);
        const s = 0.3 + rng() * 0.6;
        rock.scale.set(s, s * (0.5 + rng() * 0.4), s);
        rock.position.set(
          w.x + (rng() - 0.5) * 1.6,
          s * 0.3,
          w.z + (rng() - 0.5) * 1.6,
        );
        rock.rotation.set(rng() * TAU, rng() * TAU, rng() * TAU);
        rock.castShadow = true;
        rock.receiveShadow = true;
        group.add(rock);
      }
    };

    const placeSpike = (x: number, y: number): void => {
      const w = this.tableToWorld({ x, y });
      // A leaning iron spike/stake driven into the ground (original shape).
      const spike = new THREE.Mesh(
        this.getGeometry('scatterSpike', () =>
          new THREE.ConeGeometry(0.18, 2.6, 5),
        ),
        ironMat,
      );
      spike.position.set(w.x, 1.0, w.z);
      spike.rotation.z = (rng() - 0.5) * 0.5;
      spike.rotation.x = (rng() - 0.5) * 0.4;
      spike.castShadow = true;
      group.add(spike);
      // a rubble collar at its base
      placeRubbleCluster(x, y);
    };

    const placeBanner = (x: number, y: number): void => {
      const w = this.tableToWorld({ x, y });
      const pole = new THREE.Mesh(
        this.getGeometry('scatterPole', () =>
          new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6),
        ),
        ironMat,
      );
      const lean = (rng() - 0.5) * 0.35;
      pole.position.set(w.x, 2.0, w.z);
      pole.rotation.z = lean;
      pole.castShadow = true;
      group.add(pole);
      // crossbar
      const bar = new THREE.Mesh(
        this.getGeometry('scatterBannerBar', () =>
          new THREE.CylinderGeometry(0.05, 0.05, 1.5, 5),
        ),
        ironMat,
      );
      bar.position.set(w.x + Math.sin(lean) * 1.6, 3.5, w.z);
      bar.rotation.z = Math.PI / 2 + lean;
      group.add(bar);
      // tattered hanging cloth (a thin tapered slab, ragged via a notched clip)
      const cloth = new THREE.Mesh(
        this.getGeometry('scatterBannerCloth', () => {
          const g = new THREE.PlaneGeometry(1.3, 2.0, 1, 1);
          return g;
        }),
        clothMat,
      );
      cloth.position.set(w.x + Math.sin(lean) * 1.6, 2.5, w.z + 0.02);
      cloth.rotation.z = lean;
      cloth.castShadow = true;
      group.add(cloth);
    };

    const placeCairn = (x: number, y: number): void => {
      const w = this.tableToWorld({ x, y });
      // A low mound of pale rounded forms — a battlefield cairn / bone-pile,
      // built from clustered spheres (original, abstracted — no GW skull motif).
      const n = 4 + Math.floor(rng() * 4);
      const boneGeo = this.getGeometry('scatterBoneBall', () =>
        new THREE.SphereGeometry(0.26, seg, Math.max(4, seg - 2)),
      );
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(boneGeo, boneMat);
        const s = 0.6 + rng() * 0.7;
        b.scale.setScalar(s);
        b.position.set(
          w.x + (rng() - 0.5) * 1.4,
          0.2 + rng() * 0.5,
          w.z + (rng() - 0.5) * 1.4,
        );
        b.castShadow = true;
        b.receiveShadow = true;
        group.add(b);
      }
    };

    // Target counts by tier.
    const counts =
      this.quality.tier === 'high'
        ? { rubble: 14, spike: 5, banner: 3, cairn: 3 }
        : { rubble: 8, spike: 3, banner: 2, cairn: 2 };

    const place = (kind: 'rubble' | 'spike' | 'banner' | 'cairn', want: number) => {
      let placed = 0;
      let tries = 0;
      const pad = kind === 'rubble' ? 1.4 : 2.0;
      while (placed < want && tries < want * 12) {
        tries++;
        const x = rng() * width;
        const y = rng() * height;
        if (!free(x, y, pad)) continue;
        if (kind === 'rubble') placeRubbleCluster(x, y);
        else if (kind === 'spike') placeSpike(x, y);
        else if (kind === 'banner') placeBanner(x, y);
        else placeCairn(x, y);
        placed++;
      }
    };
    place('rubble', counts.rubble);
    place('spike', counts.spike);
    place('banner', counts.banner);
    place('cairn', counts.cairn);

    this.boardGroup.add(group);
  }

  /** Stable 32-bit hash of a string id, for deterministic terrain detailing. */
  private hashId(id: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // Ensure non-zero for xorshift.
    return (h || 0x9e3779b9) >>> 0;
  }

  /**
   * Build one ruined wall segment that occupies exactly a (ww × dd) footprint
   * and `height` tall — but as a broken shell: the wall is split into a few
   * vertical merlons of varying height (jagged broken top) and, when tall
   * enough, has window cut-outs left as gaps between blocks. The visual stays
   * within the wall's footprint so line-of-sight/cover read is unchanged.
   */
  private buildRuinWall(
    ww: number,
    height: number,
    dd: number,
    mat: THREE.Material,
    rng: () => number,
  ): THREE.Group {
    const g = new THREE.Group();
    // The wall runs along its longer horizontal axis.
    const along = Math.max(ww, dd);
    const horizontal = ww >= dd; // true: spans X, false: spans Z
    const segCount = clamp(Math.round(along / 2.2), 2, 6);
    const segLen = along / segCount;
    const hasWindows = height >= 1.6;

    for (let i = 0; i < segCount; i++) {
      // Jagged broken top: each merlon gets a fraction of full height.
      const frac = 0.55 + rng() * 0.45;
      const segH = height * frac;
      const center = -along / 2 + segLen * (i + 0.5);
      const segThk = horizontal ? dd : ww;

      if (hasWindows && i % 2 === 1 && rng() > 0.35) {
        // Punch a window: build the merlon as a bottom sill + a lintel above,
        // leaving a gap in the middle. Stays inside footprint.
        const sillH = segH * 0.38;
        const lintelH = segH * 0.22;
        const sill = new THREE.Mesh(this.wallBlockGeo(segLen * 0.92, sillH, segThk), mat);
        const lintel = new THREE.Mesh(this.wallBlockGeo(segLen * 0.92, lintelH, segThk), mat);
        if (horizontal) {
          sill.position.set(center, sillH / 2, 0);
          lintel.position.set(center, segH - lintelH / 2, 0);
        } else {
          sill.position.set(0, sillH / 2, center);
          lintel.position.set(0, segH - lintelH / 2, center);
        }
        for (const m of [sill, lintel]) {
          m.castShadow = true;
          m.receiveShadow = true;
          g.add(m);
        }
      } else {
        const block = new THREE.Mesh(this.wallBlockGeo(segLen * 0.96, segH, segThk), mat);
        if (horizontal) block.position.set(center, segH / 2, 0);
        else block.position.set(0, segH / 2, center);
        block.castShadow = true;
        block.receiveShadow = true;
        g.add(block);
      }
    }
    return g;
  }

  /** Cached box geometry for ruin wall blocks (keyed + rounded to share). */
  private wallBlockGeo(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = `wall:${w.toFixed(1)}:${h.toFixed(1)}:${d.toFixed(1)}`;
    return this.getGeometry(key, () => new THREE.BoxGeometry(w, h, d));
  }

  /** Small procedural concrete/plascrete texture for ruin walls (cached). */
  private makeConcreteTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#5f584a';
    ctx.fillRect(0, 0, 256, 256);
    // speckle + grime
    for (let i = 0; i < 1400; i++) {
      const v = 70 + Math.floor(Math.random() * 60);
      ctx.fillStyle = `rgba(${v},${v - 6},${v - 16},0.12)`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // dark streaks (water staining)
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = 'rgba(20,18,14,0.18)';
      ctx.lineWidth = 1 + Math.random() * 3;
      const x = Math.random() * 256;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 30, 256);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    tex.needsUpdate = true;
    return tex;
  }

  /* ============================ shared resources ========================== */

  private getMaterial(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.matCache.get(key);
    if (!m) {
      m = make();
      this.matCache.set(key, m);
    }
    return m;
  }

  private getGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** Standard material keyed by the proxy's visual signature, so it is shared. */
  private proxyMaterials(proxy: ProxyDescriptor): {
    primary: THREE.Material;
    secondary: THREE.Material;
  } {
    const metal = proxy.metalness ?? 0.3;
    const glow = proxy.glow ?? '';
    const pKey = `prim:${proxy.primary}:${metal}:${glow}`;
    const sKey = `sec:${proxy.secondary}:${metal}:${glow}`;
    const primary = this.getMaterial(pKey, () => {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(proxy.primary),
        metalness: metal,
        roughness: 0.55,
        envMapIntensity: 0.7,
      });
      if (glow) {
        m.emissive = new THREE.Color(glow);
        m.emissiveIntensity = 0.6;
      }
      return m;
    });
    const secondary = this.getMaterial(sKey, () => {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(proxy.secondary),
        metalness: clamp(metal + 0.2, 0, 1),
        roughness: 0.4,
        envMapIntensity: 0.8,
      });
      return m;
    });
    return { primary, secondary };
  }

  /* ============================== unit visuals ============================ */

  private defaultProxy(unit: UnitInstance): ProxyDescriptor {
    // Fallback proxy if the unit carries none — colour by owner.
    const owner = unit.ownerId;
    return {
      silhouette: unit.isCharacter ? 'character' : 'infantry',
      primary: owner === 'A' ? '#2b4f8e' : '#8e2b2b',
      secondary: owner === 'A' ? '#16263f' : '#3f1616',
      metalness: 0.3,
      heightInches: unit.isCharacter ? 2.4 : 1.8,
    };
  }

  /**
   * Build the faction-coloured round base (dark disc + a coloured rim ring) for
   * a single model. The base lives directly on the per-model group so it shows
   * immediately and persists whether the body is procedural or a real glTF clone.
   */
  private buildBase(proxy: ProxyDescriptor, baseRadius: number): THREE.Group {
    const g = new THREE.Group();
    const seg = this.quality.ringSegments;

    // Soft contact-shadow / AO blob under the model: a radial-gradient sprite-ish
    // disc that grounds the model on the mat. Cheap (one transparent quad, no
    // shadow-map cost) and reads as ambient occlusion. Skipped on lowest budget.
    if (this.quality.contactShadows) {
      const blobGeo = this.getGeometry(`blob:${baseRadius.toFixed(2)}`, () => {
        const cg = new THREE.CircleGeometry(baseRadius * 1.55, 32);
        cg.rotateX(-Math.PI / 2);
        return cg;
      });
      const blobMat = this.getMaterial('contactBlobMat', () => {
        return new THREE.MeshBasicMaterial({
          map: this.makeContactShadowTexture(),
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          color: 0x000000,
        });
      });
      const blob = new THREE.Mesh(blobGeo, blobMat);
      blob.position.y = 0.045; // just above the mat to avoid z-fighting
      blob.renderOrder = -1;
      g.add(blob);
    }

    // Beveled plinth disc: a wider lower lip + a narrower top, so the base reads
    // as a turned/beveled gaming base instead of a flat coin.
    const lipGeo = this.getGeometry(`baseLip:${baseRadius.toFixed(2)}`, () =>
      new THREE.CylinderGeometry(baseRadius, baseRadius * 1.04, 0.1, seg),
    );
    const topGeo = this.getGeometry(`baseTop:${baseRadius.toFixed(2)}`, () =>
      new THREE.CylinderGeometry(baseRadius * 0.92, baseRadius, 0.12, seg),
    );
    const baseMat = this.getMaterial('baseMat', () =>
      new THREE.MeshStandardMaterial({
        color: 0x121319,
        roughness: 0.7,
        metalness: 0.35,
        envMapIntensity: 0.6,
      }),
    );
    const lip = new THREE.Mesh(lipGeo, baseMat);
    lip.position.y = 0.05;
    lip.castShadow = true;
    lip.receiveShadow = true;
    lip.userData.isBase = true;
    g.add(lip);
    const top = new THREE.Mesh(topGeo, baseMat);
    top.position.y = 0.13;
    top.castShadow = true;
    top.receiveShadow = true;
    top.userData.isBase = true;
    g.add(top);

    // Faction-coloured glowing rim ring around the top edge of the base, so even
    // units sharing a model read their colour at a glance. Emissive so it picks
    // up the bloom subtly.
    const ringGeo = this.getGeometry(`baseRing:${baseRadius.toFixed(2)}:${seg}`, () => {
      const rg = new THREE.RingGeometry(baseRadius * 0.8, baseRadius * 0.99, seg);
      rg.rotateX(-Math.PI / 2);
      return rg;
    });
    const ringMat = this.getMaterial(`baseRingMat:${proxy.primary}`, () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(proxy.primary),
        emissive: new THREE.Color(proxy.primary),
        emissiveIntensity: 0.55,
        roughness: 0.4,
        metalness: 0.35,
      }),
    );
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.192;
    g.add(ring);

    // Ornate brass trim ring around the outer rim of the base — a slim warm
    // metal band that catches the key/ember light, so bases read as turned
    // gothic plinths. Shared dark-brass material (one extra cached draw).
    const trimGeo = this.getGeometry(`baseTrim:${baseRadius.toFixed(2)}:${seg}`, () => {
      const rg = new THREE.RingGeometry(baseRadius * 0.99, baseRadius * 1.06, seg);
      rg.rotateX(-Math.PI / 2);
      return rg;
    });
    const trimMat = this.getMaterial('baseTrimMat', () =>
      new THREE.MeshStandardMaterial({
        color: 0x4a3a1c,
        roughness: 0.45,
        metalness: 0.9,
        envMapIntensity: 0.8,
      }),
    );
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.y = 0.105;
    g.add(trim);
    return g;
  }

  /** Radial soft-shadow texture (white center -> transparent edge), cached. */
  private contactShadowTex: THREE.Texture | null = null;
  private makeContactShadowTexture(): THREE.Texture {
    if (this.contactShadowTex) return this.contactShadowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    // White at center = full opacity (multiplied by material opacity); fades out.
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    this.contactShadowTex = tex;
    return tex;
  }

  /** Build a procedural model body (silhouette only) for a unit's proxy. */
  private buildProceduralBody(proxy: ProxyDescriptor, baseRadius: number): THREE.Group {
    const body = new THREE.Group();
    const { primary, secondary } = this.proxyMaterials(proxy);
    const h = proxy.heightInches ?? 1.8;
    body.position.y = 0.18;

    switch (proxy.silhouette) {
      case 'infantry':
        this.buildInfantry(body, primary, secondary, h, baseRadius);
        break;
      case 'character':
        this.buildCharacter(body, primary, secondary, h, baseRadius);
        break;
      case 'monster':
        this.buildMonster(body, primary, secondary, h, baseRadius);
        break;
      case 'vehicle':
        this.buildVehicle(body, primary, secondary, h, baseRadius);
        break;
    }

    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return body;
  }

  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private buildInfantry(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 0.9;
    const legH = h * 0.4;
    const torsoH = h * 0.42;
    const headR = r * 0.34;
    // legs
    this.addMesh(body, this.getGeometry(`leg:${w}:${legH}`, () =>
      new THREE.BoxGeometry(w * 0.85, legH, w * 0.6)), secondary, 0, legH / 2, 0);
    // torso
    this.addMesh(body, this.getGeometry(`torso:${w}:${torsoH}`, () =>
      new THREE.BoxGeometry(w, torsoH, w * 0.7)), primary, 0, legH + torsoH / 2, 0);
    // head
    this.addMesh(body, this.getGeometry(`head:${headR}`, () =>
      new THREE.SphereGeometry(headR, 10, 8)), secondary, 0, legH + torsoH + headR * 0.9, 0);
    // a small shoulder weapon nub
    this.addMesh(body, this.getGeometry(`gun:${w}`, () =>
      new THREE.BoxGeometry(w * 0.2, w * 0.2, w * 1.3)), secondary, w * 0.55, legH + torsoH * 0.7, w * 0.2);
  }

  private buildCharacter(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 0.95;
    const legH = h * 0.42;
    const torsoH = h * 0.46;
    const headR = r * 0.33;
    this.addMesh(body, this.getGeometry(`cleg:${w}:${legH}`, () =>
      new THREE.BoxGeometry(w * 0.9, legH, w * 0.62)), secondary, 0, legH / 2, 0);
    this.addMesh(body, this.getGeometry(`ctorso:${w}:${torsoH}`, () =>
      new THREE.BoxGeometry(w * 1.05, torsoH, w * 0.75)), primary, 0, legH + torsoH / 2, 0);
    this.addMesh(body, this.getGeometry(`chead:${headR}`, () =>
      new THREE.SphereGeometry(headR, 10, 8)), secondary, 0, legH + torsoH + headR, 0);
    // Cloak: a thin tapered slab behind the torso.
    const cloak = this.addMesh(body, this.getGeometry(`cloak:${w}:${h}`, () =>
      new THREE.BoxGeometry(w * 1.2, torsoH * 1.3, w * 0.12)), primary, 0, legH + torsoH * 0.55, -w * 0.42);
    cloak.rotation.x = -0.12;
    // Banner pole + flag accent (secondary colour, slight glow look via emissive
    // is left to material; here just a tall thin pole + flag).
    this.addMesh(body, this.getGeometry('pole', () =>
      new THREE.CylinderGeometry(0.04, 0.04, h * 1.1, 6)), secondary, w * 0.6, legH + torsoH + h * 0.2, -w * 0.2);
    this.addMesh(body, this.getGeometry(`flag:${w}`, () =>
      new THREE.BoxGeometry(w * 0.5, h * 0.5, 0.04)), primary, w * 0.85, legH + torsoH + h * 0.5, -w * 0.2);
  }

  private buildMonster(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 1.4;
    const legH = h * 0.38;
    const torsoH = h * 0.5;
    // hunched bulky torso
    this.addMesh(body, this.getGeometry(`mleg:${w}:${legH}`, () =>
      new THREE.BoxGeometry(w * 1.1, legH, w * 0.9)), secondary, 0, legH / 2, 0);
    const torso = this.addMesh(body, this.getGeometry(`mtorso:${w}:${torsoH}`, () =>
      new THREE.BoxGeometry(w * 1.25, torsoH, w)), primary, 0, legH + torsoH / 2, 0);
    torso.rotation.x = 0.15;
    // head low and forward
    this.addMesh(body, this.getGeometry(`mhead:${r}`, () =>
      new THREE.SphereGeometry(r * 0.5, 10, 8)), secondary, 0, legH + torsoH * 0.9, w * 0.5);
    // two arms / claws
    this.addMesh(body, this.getGeometry(`marm:${w}`, () =>
      new THREE.BoxGeometry(w * 0.3, torsoH * 0.9, w * 0.3)), primary, w * 0.75, legH + torsoH * 0.6, w * 0.2);
    this.addMesh(body, this.getGeometry(`marm:${w}`, () =>
      new THREE.BoxGeometry(w * 0.3, torsoH * 0.9, w * 0.3)), primary, -w * 0.75, legH + torsoH * 0.6, w * 0.2);
  }

  private buildVehicle(
    body: THREE.Group,
    primary: THREE.Material,
    secondary: THREE.Material,
    h: number,
    r: number,
  ): void {
    const w = r * 1.7;
    const hullH = h * 0.5;
    // main hull
    this.addMesh(body, this.getGeometry(`hull:${w}:${hullH}`, () =>
      new THREE.BoxGeometry(w * 1.6, hullH, w)), primary, 0, hullH / 2, 0);
    // sloped glacis
    const glacis = this.addMesh(body, this.getGeometry(`glacis:${w}`, () =>
      new THREE.BoxGeometry(w * 0.6, hullH * 0.8, w)), secondary, w * 0.85, hullH * 0.5, 0);
    glacis.rotation.z = 0.4;
    // turret
    this.addMesh(body, this.getGeometry(`turret:${w}`, () =>
      new THREE.CylinderGeometry(w * 0.4, w * 0.5, hullH * 0.6, 10)), secondary, -w * 0.1, hullH + hullH * 0.3, 0);
    // barrel
    const barrel = this.addMesh(body, this.getGeometry('barrel', () =>
      new THREE.CylinderGeometry(0.08, 0.08, w * 1.0, 8)), secondary, w * 0.5, hullH + hullH * 0.3, 0);
    barrel.rotation.z = Math.PI / 2;
    // tracks
    this.addMesh(body, this.getGeometry(`track:${w}`, () =>
      new THREE.BoxGeometry(w * 1.6, hullH * 0.4, w * 0.22)), secondary, 0, hullH * 0.2, w * 0.5);
    this.addMesh(body, this.getGeometry(`track:${w}`, () =>
      new THREE.BoxGeometry(w * 1.6, hullH * 0.4, w * 0.22)), secondary, 0, hullH * 0.2, -w * 0.5);
  }

  private ensureUnitVisual(unit: UnitInstance): UnitVisual {
    let uv = this.unitVisuals.get(unit.id);
    if (uv) return uv;

    const proxy = unit.proxy ?? this.defaultProxy(unit);
    // Pick a real model from the unit's keywords; null => procedural fallback.
    const entry = resolveModelEntry(unit);
    const group = new THREE.Group();
    group.name = `unit:${unit.id}`;
    const models: ModelVisual[] = [];

    for (const m of unit.models) {
      // Per-model group: holds the base ring + a swappable body.
      const modelGroup = new THREE.Group();
      // Face direction by owner: A faces +Z, B faces -Z.
      modelGroup.rotation.y = unit.ownerId === 'A' ? 0 : Math.PI;

      // Base is always present and shows immediately.
      const base = this.buildBase(proxy, m.baseRadius);
      modelGroup.add(base);

      // Body: procedural by default. If a real model matched, we add the
      // procedural body now as an instant placeholder and swap it for the GLB
      // clone once it finishes loading (so the board is never empty).
      const body = this.buildProceduralBody(proxy, m.baseRadius);
      modelGroup.add(body);

      // Tag the whole model group for picking.
      modelGroup.userData.unitId = unit.id;
      modelGroup.traverse((o) => (o.userData.unitId = unit.id));

      group.add(modelGroup);
      const mv: ModelVisual = {
        group: modelGroup,
        body,
        alive: m.alive,
        vitality: m.alive ? 1 : 0,
      };
      models.push(mv);

      if (entry) {
        this.loadRealModelBody(unit.id, mv, proxy, entry);
      }
    }

    // Faction colour for combat FX: the proxy's primary, else owner fallback.
    let factionColor = unit.ownerId === 'A' ? 0x6fa8ff : 0xff6a4a;
    try {
      const hex = (unit.proxy ?? proxy).primary;
      if (hex) factionColor = new THREE.Color(hex).getHex();
    } catch {
      /* keep fallback */
    }

    uv = { group, models, ownerId: unit.ownerId, factionColor };
    this.unitVisuals.set(unit.id, uv);
    this.unitsGroup.add(group);
    return uv;
  }

  /**
   * Asynchronously load + clone a real glTF model for one model instance and
   * swap it in for the procedural placeholder body. The base ring, position,
   * death-sink and picking all keep working because we only replace `mv.body`.
   */
  private loadRealModelBody(
    unitId: string,
    mv: ModelVisual,
    proxy: ProxyDescriptor,
    entry: ModelRegistryEntry,
  ): void {
    this.modelLibrary.instantiate(
      entry.url,
      proxy,
      entry,
      (clone) => {
        // The unit may have been disposed before the load resolved.
        if (this.disposed) {
          this.disposeObject(clone);
          return;
        }
        // Rest the model on top of the base disc.
        clone.position.y = 0.18;
        // Tag clone meshes for picking.
        clone.userData.unitId = unitId;
        clone.traverse((o) => (o.userData.unitId = unitId));

        // Remove the procedural placeholder and attach the real model.
        mv.group.remove(mv.body);
        this.disposeObject(mv.body);
        mv.group.add(clone);
        mv.body = clone;
        // Re-apply current death-sink scale so a model that died while loading
        // doesn't pop to full size.
        clone.visible = mv.vitality > 0.01;
      },
      // On error we simply keep the procedural placeholder (graceful fallback).
    );
  }

  /* ================================= sync ================================= */

  sync(state: GameState): void {
    // Objectives.
    for (const obj of state.objectives) {
      this.ensureObjective(obj);
      this.retintObjective(obj);
    }

    // Units.
    for (const unit of Object.values(state.units)) {
      const uv = this.ensureUnitVisual(unit);

      // Units held in Strategic Reserves are off the table — hide them entirely
      // until they arrive (Deep Strike clears inReserves).
      uv.group.visible = !unit.inReserves;
      if (unit.inReserves) continue;

      // If an imported model is in use, keep it centred on the unit centroid.
      if (uv.imported) {
        this.positionImported(unit, uv);
        continue;
      }

      // Update each model transform; handle new/removed model counts gracefully.
      const n = Math.min(uv.models.length, unit.models.length);
      for (let i = 0; i < n; i++) {
        const mv = uv.models[i];
        const m = unit.models[i];
        const world = this.tableToWorld(m.position);
        mv.group.position.x = world.x;
        mv.group.position.z = world.z;

        // Death transition: sink + shrink. Revival: pop back.
        if (m.alive && !mv.alive) {
          mv.alive = true;
        } else if (!m.alive && mv.alive) {
          mv.alive = false;
        }
        mv.alive = m.alive;
      }
    }

    // Update highlight/target rings to follow units.
    this.updateAttachedRings(state);
  }

  private positionImported(unit: UnitInstance, uv: UnitVisual): void {
    // Centre the imported object on the average position of living models.
    const alive = unit.models.filter((m) => m.alive);
    const src = alive.length ? alive : unit.models;
    let x = 0;
    let y = 0;
    for (const m of src) {
      x += m.position.x;
      y += m.position.y;
    }
    x /= src.length || 1;
    y /= src.length || 1;
    const world = this.tableToWorld({ x, y });
    if (uv.imported) {
      uv.imported.position.x = world.x;
      uv.imported.position.z = world.z;
      uv.imported.visible = alive.length > 0;
    }
  }

  /* ============================== objectives ============================= */

  private ensureObjective(obj: Objective): THREE.Mesh {
    let mesh = this.objectiveMeshes.get(obj.id);
    if (mesh) return mesh;

    const seg = this.quality.ringSegments;
    // A glowing control-zone disc + animated holo-ring + floating icon.
    const group = new THREE.Group();
    const world = this.tableToWorld(obj.position);
    group.position.copy(world);

    // Control-zone tint disc (radius = control radius), low and translucent.
    const discGeo = this.getGeometry(`objdisc:${obj.radius}:${seg}`, () => {
      const g = new THREE.CircleGeometry(obj.radius, seg);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 0.06;
    group.add(disc);

    // Bright rim ring at the control radius.
    const ringGeo = this.getGeometry(`objring:${obj.radius}:${seg}`, () => {
      const g = new THREE.RingGeometry(obj.radius - 0.35, obj.radius, seg);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.12;
    group.add(ring);

    // A faint inner ward ring just inside the control radius for a more ornate,
    // ritual-circle read on the relic's zone (shares the tinted ring material).
    const wardGeo = this.getGeometry(`objward:${obj.radius}:${seg}`, () => {
      const g = new THREE.RingGeometry(obj.radius * 0.55, obj.radius * 0.55 + 0.12, seg);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    const ward = new THREE.Mesh(wardGeo, ringMat);
    ward.position.y = 0.1;
    group.add(ward);

    // Ominous relic plinth: a dark gothic-industrial stub the holo projects
    // from — a stepped iron base + a chamfered obelisk, so the objective reads
    // as a recovered war-relic rather than a flat marker. Shared dark material.
    const relicMat = this.getMaterial('objRelicIron', () =>
      new THREE.MeshStandardMaterial({
        color: 0x161a1f,
        roughness: 0.6,
        metalness: 0.8,
        envMapIntensity: 0.6,
      }),
    );
    const relicBrass = this.getMaterial('objRelicBrass', () =>
      new THREE.MeshStandardMaterial({
        color: 0x5c4a24,
        roughness: 0.45,
        metalness: 0.92,
        emissive: 0x140d03,
        emissiveIntensity: 0.5,
        envMapIntensity: 0.9,
      }),
    );
    const plinthBase = new THREE.Mesh(
      this.getGeometry('objRelicBase', () =>
        new THREE.CylinderGeometry(0.7, 0.95, 0.45, 8),
      ),
      relicMat,
    );
    plinthBase.position.y = 0.28;
    plinthBase.castShadow = true;
    plinthBase.receiveShadow = true;
    group.add(plinthBase);
    const obelisk = new THREE.Mesh(
      this.getGeometry('objRelicObelisk', () =>
        new THREE.CylinderGeometry(0.22, 0.42, 1.6, 6),
      ),
      relicMat,
    );
    obelisk.position.y = 1.2;
    obelisk.castShadow = true;
    group.add(obelisk);
    // brass collar band on the obelisk for a touch of warm relic metal
    const collar = new THREE.Mesh(
      this.getGeometry('objRelicCollar', () =>
        new THREE.TorusGeometry(0.34, 0.07, 6, 8),
      ),
      relicBrass,
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.75;
    group.add(collar);

    // Floating holo-ring that spins + bobs above the relic (animated group).
    const holo = new THREE.Group();
    holo.name = 'objHolo';
    const holoRing = new THREE.Mesh(
      this.getGeometry('objHoloRing', () => new THREE.TorusGeometry(0.9, 0.07, 8, 32)),
      ringMat,
    );
    holoRing.rotation.x = Math.PI / 2;
    holo.add(holoRing);
    // A second, smaller counter-cant ring for a more ornate reliquary halo.
    const holoRing2 = new THREE.Mesh(
      this.getGeometry('objHoloRing2', () => new THREE.TorusGeometry(0.58, 0.05, 8, 28)),
      ringMat,
    );
    holoRing2.rotation.x = Math.PI / 2;
    holoRing2.rotation.z = 0.5;
    holo.add(holoRing2);
    // Floating icon: a small emissive diamond at the centre of the holo-ring.
    const icon = new THREE.Mesh(
      this.getGeometry('objIcon', () => new THREE.OctahedronGeometry(0.42, 0)),
      discMat,
    );
    holo.add(icon);
    holo.position.y = 2.6;
    holo.userData.holo = true;
    group.add(holo);

    // A short central beacon stub so the holo reads as projected from the relic.
    const beacon = new THREE.Mesh(
      this.getGeometry('objbeacon', () => new THREE.CylinderGeometry(0.1, 0.22, 0.9, 10)),
      discMat,
    );
    beacon.position.y = 2.05;
    group.add(beacon);

    this.objectivesGroup.add(group);
    this.objectiveGroups.push(group);
    // Store the disc mesh as the handle but keep refs via userData.
    disc.userData.group = group;
    disc.userData.ringMat = ringMat;
    disc.userData.discMat = discMat;
    disc.userData.holo = holo;
    this.objectiveMeshes.set(obj.id, disc);
    return disc;
  }

  private objectiveColor(owner?: PlayerId): number {
    if (owner === 'A') return 0x3a7bff;
    if (owner === 'B') return 0xff4030;
    return 0x9aa0aa;
  }

  private retintObjective(obj: Objective): void {
    const disc = this.objectiveMeshes.get(obj.id);
    if (!disc) return;
    const col = this.objectiveColor(obj.controlledBy);
    const discMat = disc.userData.discMat as THREE.MeshBasicMaterial;
    const ringMat = disc.userData.ringMat as THREE.MeshBasicMaterial;
    discMat.color.setHex(col);
    // Brighter zone fill + ring when controlled, so capture is obvious.
    discMat.opacity = obj.controlledBy ? 0.24 : 0.12;
    ringMat.color.setHex(col);
  }

  /* =============================== overlays ============================== */

  private flatRingGeo(inner: number, outer: number): THREE.RingGeometry {
    const key = `${inner.toFixed(2)}:${outer.toFixed(2)}`;
    let g = this.ringGeoCache.get(key);
    if (!g) {
      g = new THREE.RingGeometry(inner, outer, 48);
      g.rotateX(-Math.PI / 2);
      this.ringGeoCache.set(key, g);
    }
    return g;
  }

  highlightUnit(unitId: string | null): void {
    this.highlightedUnit = unitId;
    if (!unitId) {
      if (this.highlightRing) this.highlightRing.visible = false;
      return;
    }
    if (!this.highlightRing) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe27a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      // Selection: a bright thin ring plus a faint wider halo for a premium glow.
      this.highlightRing = new THREE.Mesh(this.flatRingGeo(1.7, 2.0), mat);
      this.highlightRing.name = 'highlightRing';
      this.highlightRing.renderOrder = 2;
      const halo = new THREE.Mesh(
        this.flatRingGeo(2.0, 2.6),
        new THREE.MeshBasicMaterial({
          color: 0xffe27a,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      halo.position.y = -0.005;
      halo.name = 'halo';
      this.highlightRing.add(halo);
      this.overlayGroup.add(this.highlightRing);
    }
    this.highlightRing.visible = true;
    // Position handled in updateAttachedRings / animate (pulse).
  }

  setTargets(unitIds: string[]): void {
    // Hide existing target rings not in the new set.
    for (const [id, ring] of this.targetRings) {
      if (!unitIds.includes(id)) {
        ring.visible = false;
      }
    }
    const mat = this.getMaterial(
      'targetRingMat',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff3322,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
    );
    const innerMat = this.getMaterial(
      'targetRingInnerMat',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff6a55,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
    );
    for (const id of unitIds) {
      let ring = this.targetRings.get(id);
      if (!ring) {
        // Outer reticle ring + a faint inner ring (counter-rotates in animate).
        ring = new THREE.Mesh(this.flatRingGeo(1.5, 1.8), mat);
        ring.name = `targetRing:${id}`;
        ring.renderOrder = 2;
        const inner = new THREE.Mesh(this.flatRingGeo(1.0, 1.18), innerMat);
        inner.name = 'inner';
        inner.position.y = 0.005;
        ring.add(inner);
        this.overlayGroup.add(ring);
        this.targetRings.set(id, ring);
      }
      ring.visible = true;
    }
  }

  /** Re-centre highlight/target rings under the relevant units each sync. */
  private updateAttachedRings(state: GameState): void {
    if (this.highlightRing && this.highlightedUnit) {
      const c = this.unitCenterWorld(state, this.highlightedUnit);
      if (c) {
        this.highlightRing.position.set(c.x, 0.16, c.z);
        this.highlightRing.visible = true;
      } else {
        this.highlightRing.visible = false;
      }
    }
    for (const [id, ring] of this.targetRings) {
      if (!ring.visible) continue;
      const c = this.unitCenterWorld(state, id);
      if (c) ring.position.set(c.x, 0.15, c.z);
      else ring.visible = false;
    }
  }

  private unitCenterWorld(state: GameState, unitId: string): THREE.Vector3 | null {
    const unit = state.units[unitId];
    if (!unit) return null;
    const alive = unit.models.filter((m) => m.alive);
    const src = alive.length ? alive : unit.models;
    if (!src.length) return null;
    let x = 0;
    let y = 0;
    for (const m of src) {
      x += m.position.x;
      y += m.position.y;
    }
    return this.tableToWorld({ x: x / src.length, y: y / src.length });
  }

  showMeasurement(from: Vec2, to: Vec2, label?: string): void {
    const a = this.tableToWorld(from, 0.22);
    const b = this.tableToWorld(to, 0.22);

    // Glowing dashed tape line.
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
      color: 0x7fe9ff,
      dashSize: 1.0,
      gapSize: 0.5,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.userData.overlayKind = 'measurement';
    this.overlayGroup.add(line);

    // End caps: small bright discs at each measured point for a "tape pin" feel.
    const capMat = this.getMaterial(
      'measureCapMat',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xaef4ff,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
    );
    const capGeo = this.getGeometry('measureCap', () => {
      const g = new THREE.RingGeometry(0.25, 0.5, 20);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    for (const p of [a, b]) {
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(p.x, 0.2, p.z);
      cap.userData.overlayKind = 'measurement';
      this.overlayGroup.add(cap);
    }

    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const text = label ?? `${dist.toFixed(1)}"`;
    const sprite = this.makeTextSprite(text, '#aef4ff');
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = 2.2;
    sprite.position.copy(mid);
    sprite.userData.overlayKind = 'measurement';
    this.overlayGroup.add(sprite);
  }

  showRange(center: Vec2, radius: number, color = 0x55ff88): void {
    const world = this.tableToWorld(center, 0.14);
    // translucent disc
    const discMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const discGeo = new THREE.CircleGeometry(radius, 48);
    discGeo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.copy(world);
    disc.userData.overlayKind = 'range';
    this.overlayGroup.add(disc);

    // bright rim
    const rimMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const rim = new THREE.Mesh(new THREE.RingGeometry(radius - 0.25, radius, 64), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.copy(world);
    rim.position.y += 0.01;
    rim.userData.overlayKind = 'range';
    this.overlayGroup.add(rim);
  }

  clearOverlays(): void {
    // Remove measurement lines & range rings (but keep highlight/target rings).
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.overlayGroup.children) {
      const kind = child.userData.overlayKind;
      if (kind === 'measurement' || kind === 'range') toRemove.push(child);
    }
    for (const c of toRemove) {
      this.overlayGroup.remove(c);
      this.disposeObject(c);
    }
  }

  private disposeObject(o: THREE.Object3D): void {
    o.traverse((child) => {
      const mesh = child as THREE.Mesh & THREE.Line & THREE.Sprite;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat.dispose();
      }
    });
  }

  /* ============================ floating numbers ========================= */

  flashDamage(unitId: string, amount: number): void {
    const uv = this.unitVisuals.get(unitId);
    if (!uv) return;
    // Anchor above the first model's group.
    const anchor = uv.models[0]?.group.position ?? new THREE.Vector3();
    const sprite = this.makeTextSprite(`-${amount}`, '#ff5544', 56, true);
    const baseY = 3.0;
    sprite.position.set(anchor.x, baseY, anchor.z);
    this.overlayGroup.add(sprite);
    this.floatingNumbers.push({ sprite, age: 0, life: 1.4, baseY });
  }

  private updateFloatingNumbers(dt: number): void {
    for (let i = this.floatingNumbers.length - 1; i >= 0; i--) {
      const fn = this.floatingNumbers[i];
      fn.age += dt;
      const t = fn.age / fn.life;
      fn.sprite.position.y = fn.baseY + t * 2.5;
      const mat = fn.sprite.material as THREE.SpriteMaterial;
      mat.opacity = clamp(1 - t, 0, 1);
      if (fn.age >= fn.life) {
        this.overlayGroup.remove(fn.sprite);
        this.disposeObject(fn.sprite);
        this.floatingNumbers.splice(i, 1);
      }
    }
  }

  /* ============================== combat FX ============================== */

  /**
   * Per-tier FX budget. Caps concurrent particles and tunes how lavish each
   * effect is so phones ('low') stay smooth: fewer tracers, no screen shake.
   */
  private fxBudget(): {
    maxParticles: number;
    maxVolleys: number;
    shake: boolean;
    sparkCount: number;
  } {
    switch (this.quality.tier) {
      case 'low':
        return { maxParticles: 48, maxVolleys: 2, shake: false, sparkCount: 4 };
      case 'medium':
        return { maxParticles: 120, maxVolleys: 4, shake: true, sparkCount: 7 };
      default: // high
        return { maxParticles: 220, maxVolleys: 6, shake: true, sparkCount: 10 };
    }
  }

  /** Radial soft glow sprite texture (white core -> transparent), additive. */
  private getFxGlowTexture(): THREE.Texture {
    if (this.fxGlowTex) return this.fxGlowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.fxGlowTex = tex;
    return tex;
  }

  /** Sharp 4-point star spark texture for impact sparks/slashes, additive. */
  private getFxSparkTexture(): THREE.Texture {
    if (this.fxSparkTex) return this.fxSparkTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    // soft core
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 18);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 18, 0, TAU);
    ctx.fill();
    // cross flare
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(32, 2);
    ctx.lineTo(32, 62);
    ctx.moveTo(2, 32);
    ctx.lineTo(62, 32);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.fxSparkTex = tex;
    return tex;
  }

  /** A fresh additive sprite material (FX own their materials so fades are
   * independent; disposed when the effect ends). */
  private makeFxSpriteMat(tex: THREE.Texture, color: number, opacity: number): THREE.SpriteMaterial {
    return new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
  }

  /** World position of a unit's model (clamped index), or its centroid. */
  private fxUnitPoint(unitId: string, modelIndex = 0): THREE.Vector3 | null {
    const uv = this.unitVisuals.get(unitId);
    if (!uv) return null;
    if (uv.imported) return uv.imported.position.clone();
    const live = uv.models.filter((m) => m.vitality > 0.05);
    const src = live.length ? live : uv.models;
    if (!src.length) return null;
    const mv = src[clamp(modelIndex, 0, src.length - 1) | 0];
    return mv.group.position.clone();
  }

  /** Register an effect, respecting the per-tier particle cap (drops if full). */
  private addFxEffect(eff: FxEffect): void {
    if (this.fxParticleCount + eff.cost > this.fxBudget().maxParticles) {
      eff.dispose();
      return;
    }
    this.fxParticleCount += eff.cost;
    this.fxEffects.push(eff);
  }

  playShoot(
    fromUnitId: string,
    toUnitId: string,
    opts?: { volleys?: number; melee?: false },
  ): void {
    if (this.reducedMotion) {
      // Reduced motion: just a soft impact flash, no travelling tracers.
      this.playImpact(toUnitId, 0.7);
      return;
    }
    const from = this.fxUnitPoint(fromUnitId);
    const to = this.fxUnitPoint(toUnitId);
    if (!from || !to) return;
    const budget = this.fxBudget();
    const requested = Math.max(1, Math.round(opts?.volleys ?? 3));
    const volleys = clamp(requested, 1, budget.maxVolleys);
    const color = this.unitVisuals.get(fromUnitId)?.factionColor ?? 0xffae5c;

    // Muzzle flash at the shooter, slightly above the base.
    this.spawnFlash(from.clone().setY(from.y + 1.0), color, 1.1, 0.12);

    // Stagger several tracers; each is a thin additive sprite that streaks from
    // muzzle to target then triggers a small impact spark + flash on arrival.
    for (let i = 0; i < volleys; i++) {
      const delay = i * 0.06;
      // Small per-shot spread at the target so they don't all stack.
      const jitter = 0.35;
      const target = to.clone().setY(to.y + 0.9);
      target.x += (((i * 1357) % 7) / 7 - 0.5) * jitter * 2;
      target.z += (((i * 911) % 5) / 5 - 0.5) * jitter * 2;
      const origin = from.clone().setY(from.y + 1.0);
      this.addFxEffect(this.makeTracer(origin, target, color, delay, budget.sparkCount));
    }
  }

  playMelee(aUnitId: string, bUnitId: string): void {
    const a = this.fxUnitPoint(aUnitId);
    const b = this.fxUnitPoint(bUnitId);
    if (!a || !b) return;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = Math.max(a.y, b.y) + 0.9;

    if (!this.reducedMotion) {
      // Lunge: nudge both combatants toward the midpoint and ease back.
      this.addFxEffect(this.makeLunge(aUnitId, mid));
      this.addFxEffect(this.makeLunge(bUnitId, mid));
    }
    // Clash spark/slash flash at the contact point (warm white-hot).
    const budget = this.fxBudget();
    this.spawnFlash(mid, 0xffe6b0, 1.5, 0.14);
    this.addFxEffect(this.makeSparkBurst(mid, 0xfff1c8, budget.sparkCount, 7));
    // Subtle screen shake on capable tiers (skipped on 'low' / reduced motion).
    if (budget.shake && !this.reducedMotion) {
      this.fxShake = Math.min(this.fxShake + 0.5, 1);
    }
  }

  playImpact(unitId: string, intensity = 1): void {
    const p = this.fxUnitPoint(unitId);
    if (!p) return;
    const k = clamp(intensity, 0.2, 2);
    const at = p.clone().setY(p.y + 0.8);
    this.spawnFlash(at, 0xff7a4a, 1.1 * k, 0.16);
    // Expanding hit ring on the ground at the unit's feet.
    this.addFxEffect(this.makeImpactRing(p.clone().setY(0.2), 0xff8a5a, k));
    if (!this.reducedMotion) {
      this.addFxEffect(this.makeSparkBurst(at, 0xffb070, this.fxBudget().sparkCount, 5 * k));
    }
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) this.fxShake = 0;
  }

  /** One-shot additive glow puff (muzzle/impact flash). */
  private spawnFlash(pos: THREE.Vector3, color: number, size: number, life: number): void {
    const mat = this.makeFxSpriteMat(this.getFxGlowTexture(), color, 1);
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.setScalar(size * 0.6);
    this.fxGroup.add(sprite);
    let age = 0;
    this.addFxEffect({
      cost: 1,
      update: (dt) => {
        age += dt;
        const t = age / life;
        if (t >= 1) return false;
        sprite.scale.setScalar(size * (0.6 + t * 1.1));
        mat.opacity = (1 - t) * 0.9;
        return true;
      },
      dispose: () => {
        this.fxGroup.remove(sprite);
        mat.map = null; // shared texture; don't dispose it
        mat.dispose();
      },
    });
  }

  /** A glowing tracer/bolt sprite that streaks origin->target, then impacts. */
  private makeTracer(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    color: number,
    delay: number,
    sparkCount: number,
  ): FxEffect {
    const mat = this.makeFxSpriteMat(this.getFxGlowTexture(), color, 1);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.35, 0.9, 1); // stretched bolt
    sprite.position.copy(origin);
    sprite.visible = false;
    this.fxGroup.add(sprite);
    const travel = 0.16; // seconds origin->target
    let age = 0;
    let impacted = false;
    return {
      cost: 1,
      update: (dt) => {
        age += dt;
        if (age < delay) return true;
        const t = (age - delay) / travel;
        if (t < 1) {
          sprite.visible = true;
          sprite.position.lerpVectors(origin, target, t);
          mat.opacity = 0.95;
          return true;
        }
        if (!impacted) {
          impacted = true;
          sprite.visible = false;
          // Impact spark + flash at the target end.
          this.spawnFlash(target, color, 0.9, 0.12);
          this.addFxEffect(this.makeSparkBurst(target, color, Math.max(3, sparkCount - 2), 4));
        }
        return false;
      },
      dispose: () => {
        this.fxGroup.remove(sprite);
        mat.map = null;
        mat.dispose();
      },
    };
  }

  /** A short burst of additive spark sprites flying outward then fading. */
  private makeSparkBurst(
    center: THREE.Vector3,
    color: number,
    count: number,
    speed: number,
  ): FxEffect {
    const n = Math.max(1, Math.min(count, 12));
    const tex = this.getFxSparkTexture();
    const sprites: THREE.Sprite[] = [];
    const vel: THREE.Vector3[] = [];
    const mat = this.makeFxSpriteMat(tex, color, 1); // shared across this burst
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mat);
      s.position.copy(center);
      s.scale.setScalar(0.45);
      // Deterministic spread (no RNG): even fan + slight upward bias.
      const a = (i / n) * TAU + (i % 2) * 0.4;
      const up = 0.4 + (i % 3) * 0.25;
      vel.push(
        new THREE.Vector3(Math.cos(a), up, Math.sin(a)).multiplyScalar(speed * (0.6 + (i % 4) * 0.15)),
      );
      sprites.push(s);
      this.fxGroup.add(s);
    }
    const life = 0.3;
    let age = 0;
    return {
      cost: n,
      update: (dt) => {
        age += dt;
        const t = age / life;
        if (t >= 1) return false;
        for (let i = 0; i < sprites.length; i++) {
          const s = sprites[i];
          s.position.addScaledVector(vel[i], dt);
          vel[i].y -= 9 * dt; // gravity
          s.scale.setScalar(0.45 * (1 - t * 0.6));
        }
        mat.opacity = (1 - t) * 0.95;
        return true;
      },
      dispose: () => {
        for (const s of sprites) this.fxGroup.remove(s);
        mat.map = null;
        mat.dispose();
      },
    };
  }

  /** Expanding flat ground ring at an impact (additive, fades as it grows). */
  private makeImpactRing(at: THREE.Vector3, color: number, scale: number): FxEffect {
    const geo = new THREE.RingGeometry(0.2, 0.45, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(at);
    ring.renderOrder = 3;
    this.fxGroup.add(ring);
    const life = 0.4;
    const maxS = 2.4 * scale;
    let age = 0;
    return {
      cost: 1,
      update: (dt) => {
        age += dt;
        const t = age / life;
        if (t >= 1) return false;
        const s = 1 + t * maxS;
        ring.scale.set(s, 1, s);
        mat.opacity = (1 - t) * 0.9;
        return true;
      },
      dispose: () => {
        this.fxGroup.remove(ring);
        geo.dispose();
        mat.dispose();
      },
    };
  }

  /** Quick lunge of a unit's living models toward a point, then ease back.
   * Animates the per-model group offset only (does not touch engine state or
   * the sync()-driven base position); fully self-resets on completion. */
  private makeLunge(unitId: string, toward: THREE.Vector3): FxEffect {
    const uv = this.unitVisuals.get(unitId);
    // No body groups to lunge (imported model) -> no-op effect.
    const groups = uv && !uv.imported ? uv.models.map((m) => m.group) : [];
    const dirs = groups.map((g) => {
      const d = toward.clone().sub(g.position);
      d.y = 0;
      const len = d.length();
      return len > 0.001 ? d.multiplyScalar(1 / len) : new THREE.Vector3();
    });
    const reach = 0.5; // inches of lunge
    const life = 0.22;
    let age = 0;
    let prevOff = 0;
    return {
      cost: 0, // moves existing meshes; spawns nothing
      update: (dt) => {
        age += dt;
        const t = clamp(age / life, 0, 1);
        // 0 -> peak -> 0 (a quick jab).
        const off = Math.sin(t * Math.PI) * reach;
        const delta = off - prevOff;
        prevOff = off;
        for (let i = 0; i < groups.length; i++) {
          groups[i].position.addScaledVector(dirs[i], delta);
        }
        return t < 1;
      },
      dispose: () => {
        // Remove any residual offset so sync() positions stay authoritative.
        for (let i = 0; i < groups.length; i++) {
          groups[i].position.addScaledVector(dirs[i], -prevOff);
        }
      },
    };
  }

  /** Step all active FX; dispose finished ones. Called from the rAF loop. */
  private updateFx(dt: number): void {
    for (let i = this.fxEffects.length - 1; i >= 0; i--) {
      const eff = this.fxEffects[i];
      let alive: boolean;
      try {
        alive = eff.update(dt);
      } catch {
        alive = false;
      }
      if (!alive) {
        eff.dispose();
        this.fxParticleCount = Math.max(0, this.fxParticleCount - eff.cost);
        this.fxEffects.splice(i, 1);
      }
    }
    // Decay screen shake.
    if (this.fxShake > 0) {
      this.fxShake = Math.max(0, this.fxShake - dt * 4);
    }
  }

  /* ============================== text sprites =========================== */

  /** Build a Sprite from a canvas texture for crisp world-space labels. */
  private makeTextSprite(
    text: string,
    color = '#ffffff',
    fontPx = 44,
    bold = false,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const pad = 24;
    const font = `${bold ? 'bold ' : ''}${fontPx}px system-ui, sans-serif`;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width) + pad * 2;
    const h = fontPx + pad * 2;
    canvas.width = w;
    canvas.height = h;
    // re-set after resize
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // soft dark plate for legibility
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    this.roundRect(ctx, 2, 2, w - 4, h - 4, 10);
    ctx.fill();
    // outline + text
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // Scale to world units; keep text ~constant readable size.
    const worldH = 1.6;
    sprite.scale.set(worldH * (w / h), worldH, 1);
    return sprite;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ================================ picking ============================== */

  onPick(handler: (result: PickResult) => void): void {
    this.pickHandler = handler;
  }

  onHover(handler: (result: PickResult) => void): void {
    this.hoverHandler = handler;
  }

  private computePick(clientX: number, clientY: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // First, test against unit meshes for a unitId.
    const hits = this.raycaster.intersectObject(this.unitsGroup, true);
    let unitId: string | undefined;
    if (hits.length) {
      // Walk up to find a unitId tag.
      let o: THREE.Object3D | null = hits[0].object;
      while (o && unitId === undefined) {
        if (o.userData && typeof o.userData.unitId === 'string') {
          unitId = o.userData.unitId as string;
        }
        o = o.parent;
      }
    }

    // Always resolve the table point via the ground plane.
    const point = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.tablePlane, point);
    if (!ok) return null;
    const table = this.worldToTable(point);
    return unitId !== undefined ? { point: table, unitId } : { point: table };
  }

  /* =============================== input ================================= */

  private attachInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', this.onWindowResize);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.activePointerId = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.movedDuringDrag = false;
    // Right button or shift => pan; left => orbit.
    if (e.button === 2 || e.shiftKey) this.dragMode = 'pan';
    else this.dragMode = 'orbit';
  };

  private onPointerMove = (e: PointerEvent): void => {
    // Hover handler regardless of drag (but skip while actively dragging camera).
    if (this.dragMode === 'none') {
      if (this.hoverHandler) {
        const res = this.computePick(e.clientX, e.clientY);
        if (res) this.hoverHandler(res);
      }
      return;
    }

    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.movedDuringDrag = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    if (this.dragMode === 'orbit') {
      this.targetAzimuth -= dx * 0.005;
      this.targetPolar = clamp(this.targetPolar - dy * 0.005, 0.15, Math.PI / 2 - 0.05);
    } else if (this.dragMode === 'pan') {
      // Pan in the camera's local right/forward (projected to ground) basis.
      // Uses preallocated scratch vectors to avoid per-move GC pressure.
      const panScale = this.orbitRadius * 0.0016;
      const fwd = this.tmpV1;
      const right = this.tmpV2;
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      right.crossVectors(fwd, this.UP).normalize();
      // dragging right should move the view left (content follows cursor)
      this.targetPivot.addScaledVector(right, -dx * panScale);
      this.targetPivot.addScaledVector(fwd, dy * panScale);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.activePointerId !== null) {
      (e.target as HTMLElement).releasePointerCapture?.(this.activePointerId);
    }
    const wasDrag = this.movedDuringDrag;
    const mode = this.dragMode;
    this.dragMode = 'none';
    this.activePointerId = null;

    // A click (no significant drag) with the left button => pick.
    if (!wasDrag && mode === 'orbit' && this.pickHandler) {
      const res = this.computePick(e.clientX, e.clientY);
      if (res) this.pickHandler(res);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012);
    this.targetRadius = clamp(this.targetRadius * factor, this.orbitMinRadius, this.orbitMaxRadius);
  };

  private onWindowResize = (): void => this.resize();

  /* =============================== camera ================================ */

  /**
   * Apply the current effective pixel ratio (tier cap × adaptive scale) to the
   * renderer and the bloom composer. Cheap; only called when the governor
   * actually changes a step, so render-target reallocation stays rare.
   */
  private applyEffectivePixelRatio(): void {
    const pr = Math.max(0.6, this.basePixelRatio * this.perfScale);
    this.renderer.setPixelRatio(pr);
    if (this.composer) {
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      this.composer.setPixelRatio(pr);
      this.composer.setSize(size.x, size.y);
    }
  }

  /**
   * Adaptive performance governor. Tracks an EMA of frame time and, ~once per
   * second, steps the effective resolution down when the GPU is behind (and, as
   * a last resort once resolution bottoms out, disables bloom). When there is
   * sustained headroom it recovers resolution one step at a time. Skips the first
   * few seconds so one-off load/shader-compile spikes don't trigger a downscale.
   */
  private governPerformance(dt: number, t: number): void {
    if (this.manualMode) return; // capture uses a virtual clock — never govern
    // Exponential moving average of frame time in milliseconds.
    this.perfFrameMs = this.perfFrameMs * 0.9 + dt * 1000 * 0.1;
    if (t < 3) return; // warm-up: ignore asset decode / shader compile spikes

    this.perfAccum += dt;
    if (this.perfAccum < 1) return; // evaluate about once per second
    this.perfAccum = 0;

    const slow = this.perfFrameMs > 30; // sustained < ~33 fps → shed load
    const fast = this.perfFrameMs < 20; // sustained > ~50 fps → headroom to recover

    if (slow) {
      this.perfGoodHolds = 0;
      if (this.perfScale > 0.62) {
        this.perfScale = Math.max(0.6, this.perfScale - 0.15);
        this.applyEffectivePixelRatio();
      } else if (this.composer && !this.perfBloomDropped) {
        // Resolution floor reached and still slow: drop bloom entirely. The
        // tuned emissive/lighting keeps the look strong without it.
        this.perfBloomDropped = true;
        this.composer = null;
      }
    } else if (fast && this.perfScale < 1 && !this.perfBloomDropped) {
      // Recover slowly (only after several good seconds) to avoid oscillation.
      if (++this.perfGoodHolds >= 4) {
        this.perfScale = Math.min(1, this.perfScale + 0.1);
        this.applyEffectivePixelRatio();
        this.perfGoodHolds = 0;
      }
    } else {
      this.perfGoodHolds = 0;
    }
  }

  private updateCamera(dt: number): void {
    // Cinematic auto-orbit: advance BOTH the smoothed value and its target by the
    // same delta so the orbit drifts continuously without ever fighting the
    // damping (and so user drag still composes on top). Pure scalar add — no
    // allocations, folded into this single existing per-frame update.
    if (this.autoOrbitSpeed !== 0) {
      const d = this.autoOrbitSpeed * dt;
      this.targetAzimuth += d;
      this.orbitAzimuth += d;
    }

    // Smoothly approach targets (frame-rate independent damping).
    const k = 1 - Math.pow(0.0001, dt);
    this.orbitAzimuth = lerp(this.orbitAzimuth, this.targetAzimuth, k);
    this.orbitPolar = lerp(this.orbitPolar, this.targetPolar, k);
    this.orbitRadius = lerp(this.orbitRadius, this.targetRadius, k);
    this.orbitTarget.lerp(this.targetPivot, k);

    const sinP = Math.sin(this.orbitPolar);
    const x = this.orbitRadius * sinP * Math.sin(this.orbitAzimuth);
    const y = this.orbitRadius * Math.cos(this.orbitPolar);
    const z = this.orbitRadius * sinP * Math.cos(this.orbitAzimuth);
    this.camera.position.set(
      this.orbitTarget.x + x,
      this.orbitTarget.y + y,
      this.orbitTarget.z + z,
    );
    this.camera.lookAt(this.orbitTarget);
  }

  frameBoard(): void {
    // Position the orbit pivot at board centre and pick a radius that fits.
    this.targetPivot.set(0, 0, 0);
    const maxDim = Math.max(this.board.width, this.board.height);
    this.targetRadius = clamp(maxDim * 1.15, this.orbitMinRadius, this.orbitMaxRadius);
    this.targetAzimuth = 0.5;
    this.targetPolar = 0.95;
  }

  /** Move the camera to a close, low-angle view of a table point (e.g. a unit). */
  frameUnit(center: Vec2, radiusInches = 8): void {
    const w = this.tableToWorld(center);
    this.targetPivot.set(w.x, 1.5, w.z);
    this.targetRadius = clamp(radiusInches * 2.2 + 6, this.orbitMinRadius, this.orbitMaxRadius);
    this.targetPolar = 1.18; // lower, near eye-level for a miniatures look
  }

  /* ---------------------------- cinematic camera --------------------------- */

  /**
   * Smoothly move the orbit camera to look at a table point, optionally
   * reframing radius/azimuth/polar. Omitted options keep their current target.
   * `immediate` snaps the smoothed state to the target for an instant cut.
   * Drives the SAME orbit state as frameBoard/frameUnit, so it composes with
   * user input and the auto-orbit.
   */
  focusOn(
    center: Vec2,
    opts?: { radius?: number; azimuth?: number; polar?: number; immediate?: boolean },
  ): void {
    const w = this.tableToWorld(center);
    // Aim a touch above the table so figures sit in frame rather than the mat.
    this.targetPivot.set(w.x, 1.5, w.z);
    if (opts?.radius !== undefined) {
      this.targetRadius = clamp(opts.radius, this.orbitMinRadius, this.orbitMaxRadius);
    }
    if (opts?.azimuth !== undefined) {
      this.targetAzimuth = opts.azimuth;
    }
    if (opts?.polar !== undefined) {
      // Keep above the table and below the zenith (matches drag clamp).
      this.targetPolar = clamp(opts.polar, 0.15, Math.PI / 2 - 0.05);
    }
    if (opts?.immediate) {
      this.orbitTarget.copy(this.targetPivot);
      this.orbitAzimuth = this.targetAzimuth;
      this.orbitPolar = this.targetPolar;
      this.orbitRadius = this.targetRadius;
    }
  }

  /**
   * Continuously rotate the camera azimuth for an establishing shot. Speed is
   * radians/second; 0 stops it (the camera rests where it is). Integrated into
   * the existing per-frame camera update — no second loop, no allocations.
   */
  setAutoOrbit(radPerSec: number): void {
    this.autoOrbitSpeed = radPerSec;
  }

  resize(): void {
    if (!this.renderer) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the composer + bloom render targets in sync with the canvas.
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloomPass) this.bloomPass.setSize(w, h);
  }

  /* ============================== animation ============================== */

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    if (this.manualMode) return; // capture mode drives frames via tick()
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.frame(dt, t);
  };

  /**
   * Deterministic single-frame render for offline capture. Advances a virtual
   * clock by exactly `dtSeconds` and renders one frame — independent of how long
   * the GPU actually takes. Lets a software renderer produce perfectly smooth
   * video (each output frame is a fixed timestep) at the cost of wall-clock time.
   * Enables manual mode on first call so the rAF loop stops driving frames.
   */
  tick(dtSeconds: number): void {
    if (this.disposed) return;
    this.manualMode = true;
    this.manualTime += dtSeconds;
    this.frame(dtSeconds, this.manualTime);
  }

  /** One frame of updates + render, shared by the rAF loop and manual capture. */
  private frame(dt: number, t: number): void {
    this.governPerformance(dt, t);
    this.updateCamera(dt);
    this.updateDeathAnimations(dt);
    this.updateFloatingNumbers(dt);
    this.updateFx(dt);
    this.modelLibrary.update(dt); // subtle idle animation on real-model figures
    for (const m of this.importedMixers) m.update(dt); // imported skinned idles
    this.updateAtmosphere(dt, t);

    // Subtle screen shake: jitter the camera position slightly (post-orbit so
    // it never corrupts the smoothed orbit state). Deterministic-ish wobble.
    if (this.fxShake > 0.001) {
      const amp = this.fxShake * 0.25;
      this.camera.position.x += Math.sin(t * 90) * amp;
      this.camera.position.y += Math.sin(t * 77 + 1.3) * amp * 0.6;
      this.camera.position.z += Math.cos(t * 83) * amp;
    }

    // Pulse the highlight ring.
    if (this.highlightRing && this.highlightRing.visible) {
      const s = 1 + Math.sin(t * 4) * 0.08;
      this.highlightRing.scale.set(s, 1, s);
      (this.highlightRing.material as THREE.MeshBasicMaterial).opacity =
        0.6 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
    }
    // Pulse + spin target reticles; counter-rotate the inner ring.
    for (const ring of this.targetRings.values()) {
      if (!ring.visible) continue;
      const s = 1 + Math.sin(t * 6) * 0.06;
      ring.scale.set(s, 1, s);
      ring.rotation.y = t * 0.6;
      const inner = ring.getObjectByName('inner');
      if (inner) inner.rotation.y = -t * 1.1;
    }
    // Objective holo-rings: slow spin + gentle vertical bob over the relic.
    for (const g of this.objectiveGroups) {
      const holo = g.getObjectByName('objHolo');
      if (holo) {
        holo.rotation.y = t * 0.7;
        holo.position.y = 2.6 + Math.sin(t * 1.4 + g.position.x) * 0.16;
      }
    }

    // Advance the grade pass's grain time (only when grain is active).
    if (this.gradePass) {
      this.gradePass.uniforms.uTime.value = t;
    }

    // Render through the bloom composer when available, else direct.
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Smoothly sink dead models and pop revived ones. */
  private updateDeathAnimations(dt: number): void {
    const speed = dt * 4;
    for (const uv of this.unitVisuals.values()) {
      if (uv.imported) continue;
      for (const mv of uv.models) {
        const target = mv.alive ? 1 : 0;
        if (mv.vitality === target) {
          mv.group.visible = mv.vitality > 0.01;
          continue;
        }
        mv.vitality += (target - mv.vitality) * Math.min(1, speed);
        if (Math.abs(mv.vitality - target) < 0.01) mv.vitality = target;
        const v = mv.vitality;
        mv.group.visible = v > 0.01;
        mv.group.scale.setScalar(clamp(v, 0.001, 1));
        // sink into the table as it dies
        mv.group.position.y = (v - 1) * 0.6;
      }
    }
  }

  /**
   * Drift the ground haze and dust motes. Cheap: the haze just slowly rotates +
   * breathes its opacity; motes do one bob/sway attribute write per frame. No
   * work at all when motes are disabled ('low' tier) or reduced motion is on.
   */
  private updateAtmosphere(dt: number, t: number): void {
    if (this.haze) {
      this.haze.rotation.y = t * 0.012;
      const base = this.quality.tier === 'low' ? 0.1 : 0.16;
      (this.haze.material as THREE.MeshBasicMaterial).opacity =
        base + Math.sin(t * 0.5) * 0.025;
    }
    if (this.reducedMotion) return;
    const motes = this.dustMotes;
    const data = this.dustData;
    if (!motes || !data) return;
    const attr = motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = data.baseY.length;
    for (let i = 0; i < n; i++) {
      const ph = data.phase[i];
      const sp = data.speed[i];
      // gentle vertical bob + slow horizontal sway (no per-mote allocation)
      arr[i * 3 + 1] = data.baseY[i] + Math.sin(t * sp + ph) * 0.5;
      arr[i * 3] += Math.sin(t * sp * 0.5 + ph) * dt * 0.4;
      arr[i * 3 + 2] += Math.cos(t * sp * 0.4 + ph) * dt * 0.4;
    }
    attr.needsUpdate = true;
  }

  /* ========================= imported-model hook ========================= */

  /**
   * Replace a unit's procedural proxy models with an imported Object3D.
   * Public so ModelImport.applyImportedModelToUnit can drive it.
   */
  setUnitModel(unitId: string, object3d: THREE.Object3D): void {
    const uv = this.unitVisuals.get(unitId);
    if (!uv) return;
    // Remove old imported, if any (also tear down its idle mixer).
    if (uv.imported) {
      this.detachImportedIdle(uv.imported);
      uv.group.remove(uv.imported);
      this.disposeObject(uv.imported);
      uv.imported = undefined;
    }
    // Hide procedural models.
    for (const mv of uv.models) mv.group.visible = false;
    // Tag for picking and attach. Note whether any skinned mesh exists so we can
    // decide whether to drive an idle (static meshes are left untouched).
    let hasSkinned = false;
    object3d.traverse((o) => {
      o.userData.unitId = unitId;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) hasSkinned = true;
    });
    uv.group.add(object3d);
    uv.imported = object3d;

    // Subtle idle for imported skinned models that carry animation clips, driven
    // by the render loop via a local mixer (mirrors ModelLibrary's mechanism).
    // No skin or no clips -> the model is simply left static. Never throws.
    this.attachImportedIdle(object3d, hasSkinned);
  }

  /**
   * If `object3d` is a skinned model carrying animation clips, start a subtle,
   * looping idle on a local AnimationMixer and register it for per-frame update.
   * Picks an idle-ish clip (avoiding bare T/bind poses). Safe on static meshes:
   * with no skin or no clips it does nothing.
   */
  private attachImportedIdle(object3d: THREE.Object3D, hasSkinned: boolean): void {
    const clips = (object3d.animations ?? []) as THREE.AnimationClip[];
    if (!hasSkinned || clips.length === 0) return;
    const clip =
      clips.find((c) => /idle|survey|stand|breath/i.test(c.name) && !/t.?pose/i.test(c.name)) ??
      clips.find((c) => !/t.?pose/i.test(c.name)) ??
      clips[0];
    if (!clip) return;
    try {
      const mixer = new THREE.AnimationMixer(object3d);
      mixer.clipAction(clip).play();
      mixer.setTime(Math.random() * 2); // desync from other imports
      object3d.userData.idleMixer = mixer;
      this.importedMixers.push(mixer);
    } catch {
      /* fall back to a static pose — never crash on an odd rig */
    }
  }

  /** Stop + unregister the idle mixer attached to an imported model, if any. */
  private detachImportedIdle(object3d: THREE.Object3D): void {
    const mixer = object3d.userData.idleMixer as THREE.AnimationMixer | undefined;
    if (!mixer) return;
    mixer.stopAllAction();
    const i = this.importedMixers.indexOf(mixer);
    if (i >= 0) this.importedMixers.splice(i, 1);
    object3d.userData.idleMixer = undefined;
  }

  /** Access the live scene (used by import helpers if needed). */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /** Load a user-supplied model (URL or File) and apply it to a unit. */
  async importUnitModel(
    unitId: string,
    src: string | File,
    format: 'gltf' | 'glb' | 'obj' | 'stl',
    heightInches = 3,
  ): Promise<void> {
    const obj = await loadModel(src, format, { targetHeightInches: heightInches });
    this.setUnitModel(unitId, obj);
  }

  /** Tear down the renderer and listeners. */
  dispose(): void {
    this.disposed = true;
    this.modelLibrary.dispose();
    // Stop + drop any imported-model idle mixers.
    for (const m of this.importedMixers) m.stopAllAction();
    this.importedMixers.length = 0;
    cancelAnimationFrame(this.rafId);
    const el = this.renderer?.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointercancel', this.onPointerUp);
      el.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('resize', this.onWindowResize);
    // Tear down any in-flight combat FX and their shared textures.
    for (const eff of this.fxEffects) eff.dispose();
    this.fxEffects.length = 0;
    this.fxParticleCount = 0;
    this.fxGlowTex?.dispose();
    this.fxSparkTex?.dispose();
    this.composer?.dispose();
    this.gradePass = null;
    this.envTexture?.dispose();
    this.contactShadowTex?.dispose();
    // Atmosphere + frame textures.
    this.hazardStripeTex?.dispose();
    this.hazeTex?.dispose();
    this.moteTex?.dispose();
    if (this.haze) this.disposeObject(this.haze);
    if (this.dustMotes) this.disposeObject(this.dustMotes);
    this.renderer?.dispose();
    if (el && el.parentElement) el.parentElement.removeChild(el);
  }
}
