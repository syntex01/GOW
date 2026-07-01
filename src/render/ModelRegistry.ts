import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ProxyDescriptor, UnitInstance } from '../engine/types';

/**
 * Real-model registry + loader cache.
 *
 * Responsibilities:
 *  - Map a unit (by keyword) to a real glTF model URL, with an easily-extended
 *    table. Units that don't match fall back to the procedural proxy (the caller
 *    handles that path; we just return `null` here).
 *  - Load each GLB exactly once, sharing a single in-flight Promise between all
 *    units that need it (so 30 models of the same faction trigger one fetch).
 *  - Hand out per-model clones via SkeletonUtils.clone (correct for skinned
 *    meshes), with materials cloned + faction-tinted and geometry shared.
 *
 * No animations are played: any AnimationMixer is intentionally never created,
 * and clips are dropped. The model is left in its static bind pose. (Animation
 * support is a deliberate future step.)
 */

/* ----------------------------- registry table ----------------------------- */

/**
 * One entry maps a set of unit keywords to a model URL and tuning. The first
 * entry whose `keywords` intersect the unit's keywords wins, so order = priority.
 * Add new factions by appending rows here — nothing else needs to change.
 */
export interface ModelRegistryEntry {
  /** Any of these keywords on the unit selects this model. */
  keywords: string[];
  /** Runtime URL (vite serves /public at the site root; base is './'). */
  url: string;
  /**
   * Multiplier applied to the proxy height so a faction can read a touch
   * larger/smaller than its nominal proxy size. 1 = exactly proxy height.
   */
  heightScale?: number;
  /**
   * Pre-rotation (radians about +Y) baked into the model clone so the figure's
   * own FORWARD axis points toward the engine's +Z. After this correction the
   * existing per-owner rotation (A: 0, B: π) makes BOTH armies face the centre
   * line — A's figures look toward +Z, B's toward -Z.
   *
   * Derived by inspecting each GLB's default orientation (head/face silhouette,
   * toe direction and front/back mass split via a GLTFLoader probe). All four
   * supplied CC0 figures already author their forward along +Z, so the
   * correction is 0 for every faction; the field exists so a future model
   * authored along a different axis (e.g. -Z => Math.PI, +X => -Math.PI/2) can
   * be fixed by one number without touching code.
   */
  yaw?: number;
  /**
   * Optional explicit name (or regex source) of the animation clip to pose into.
   * When omitted we auto-pick a grounded idle/ready stance and avoid any T-pose.
   */
  poseClip?: string;
  /**
   * When set, the chosen clip is FROZEN at this time (seconds) into a single
   * deliberate, battle-ready frame instead of looping. Leave undefined to play a
   * slow perpetual idle. Lets a weak idle be replaced by a menacing held pose.
   */
  poseFreezeAt?: number;
  /**
   * Whether the renderer should shrink the model to fit inside its round base
   * (true/undefined for infantry & characters, so figures never overhang and
   * clip neighbours). Vehicles legitimately overhang their footprint, so they
   * set this false and keep their natural normalized size.
   */
  fitToBase?: boolean;
}

/**
 * Generic CC0 sci-fi tank (Quaternius, public domain, via poly.pizza) used for
 * any unit whose proxy silhouette is 'vehicle', across factions (tinted to the
 * faction colour at instantiation). A single well-made hull reads far better
 * than the procedural box, and replaces the old "vehicles are procedural" path.
 */
export const VEHICLE_ENTRY: ModelRegistryEntry = {
  keywords: [], // selected by silhouette, not keyword
  url: 'models/factions/tank.glb',
  heightScale: 1.15,
  yaw: 0,
  fitToBase: false, // a tank's hull overhangs its base — don't shrink it
};

/**
 * Generic CC0 sci-fi WALKER/MECH (public domain, via poly.pizza) for any unit
 * whose proxy silhouette is 'monster' (dreadnoughts, war-walkers, big beasts),
 * across factions (faction-tinted). Replaces the procedural monster body — a
 * striding mech reads far better than a box for a walker-class model.
 */
export const MONSTER_ENTRY: ModelRegistryEntry = {
  keywords: [],
  url: 'models/factions/walker.glb',
  heightScale: 1.25,
  yaw: 0,
  fitToBase: false, // a walker's stance overhangs its base — keep it at scale
  poseClip: 'idle', // it ships with a T-pose bind; freeze a grounded idle frame
  poseFreezeAt: 0.4,
};

/**
 * Faction -> model table. Necrons use the robot; Adeptus Astartes / Ultramarines
 * use the marine. Extend by adding rows (most specific first if they overlap).
 */
export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  // Faction-fitting CC0 (public-domain) figures by Quaternius (via poly.pizza).
  // Matched case-insensitively. Order = priority (Chaos before generic Astartes).
  //
  // `yaw` corrects each model's authored forward to engine +Z (see field doc).
  // All four figures already face +Z (verified via a GLTFLoader silhouette/toe
  // probe), so yaw = 0 across the board — but it is set explicitly so the
  // facing contract is intentional and self-documenting.
  //
  // The skeletal Necron and the armoured warrior ship WITHOUT animation clips,
  // so they hold their authored static stance (already a grounded, weapon-ready
  // pose — not a flat T-pose). The demon and orc carry the Quaternius clip set;
  // we freeze them into a single menacing, grounded combat frame rather than a
  // bouncy loop so a battle line reads as deliberate and braced.
  {
    keywords: ['necrons'],
    url: 'models/factions/necron.glb', // animated CC0 skeleton (poses via Idle clip)
    heightScale: 1.0,
    yaw: 0,
    poseClip: 'idle', // freeze a grounded idle frame instead of the T-pose bind
    poseFreezeAt: 0.5,
  }, // skeletal
  {
    keywords: ['chaos', 'heretic astartes'],
    url: 'models/factions/chaos.glb',
    heightScale: 1.05,
    yaw: 0,
    poseClip: 'idle',
    poseFreezeAt: 0.55, // hold a grounded, braced idle frame (menacing, still)
  }, // demon
  {
    keywords: ['orks'],
    url: 'models/factions/ork.glb',
    heightScale: 1.1,
    yaw: 0,
    poseClip: 'idle',
    poseFreezeAt: 0.4, // hunched, ready-to-charge held frame
  }, // orc
  {
    keywords: ['adeptus astartes', 'ultramarines', 'imperium'],
    url: 'models/factions/ultramarine.glb', // armoured warrior
    heightScale: 1.0,
    yaw: 0,
  },
];

/**
 * Resolve the registry entry for a unit, or null to use the procedural proxy.
 * Matching is CASE-INSENSITIVE (datasheet keywords are uppercase, e.g.
 * 'NECRONS'). Vehicles and monsters keep the procedural body — a human-scale
 * figure model would misrepresent a tank/walker; those get bespoke models later.
 */
export function resolveModelEntry(unit: UnitInstance): ModelRegistryEntry | null {
  const sil = unit.proxy?.silhouette;
  // Vehicles use the shared tank hull (selected by silhouette). Monsters keep
  // the procedural body for now (no fitting CC0 creature sourced yet).
  if (sil === 'vehicle') return VEHICLE_ENTRY;
  if (sil === 'monster') return MONSTER_ENTRY;
  const kw = (unit.keywords ?? []).map((k) => k.toLowerCase());
  for (const entry of MODEL_REGISTRY) {
    if (entry.keywords.some((k) => kw.includes(k.toLowerCase()))) return entry;
  }
  return null;
}

/* ------------------------------ default sizes ----------------------------- */

/** Nominal model heights in inches when a proxy doesn't specify one. */
const DEFAULT_INFANTRY_HEIGHT = 3.2;
const DEFAULT_CHARACTER_HEIGHT = 4.2;

function targetHeightInches(proxy: ProxyDescriptor, entry: ModelRegistryEntry): number {
  const base =
    proxy.heightInches ??
    (proxy.silhouette === 'character' || proxy.silhouette === 'monster'
      ? DEFAULT_CHARACTER_HEIGHT
      : DEFAULT_INFANTRY_HEIGHT);
  return base * (entry.heightScale ?? 1);
}

/* ------------------------------ loader cache ------------------------------ */

/**
 * Caches the *prepared template* scene per URL. The template is already
 * normalised onto a unit-cube convention so per-unit clones only need to scale.
 * We store a Promise so concurrent requests share a single network load.
 */
interface Template {
  root: THREE.Object3D;
  /** All clips shipped with the GLB (may be empty). Clip CHOICE happens per
   *  registry entry in `instantiate`, so different factions can pose differently
   *  from the same loader cache. */
  clips: THREE.AnimationClip[];
}

/**
 * Choose the best grounded, battle-ready stance clip for a model, honouring an
 * optional explicit preference from the registry entry. Always avoids a bare
 * T/bind pose. Returns null when the GLB has no usable clip (then the clone
 * holds its authored static stance).
 */
function pickPoseClip(
  clips: THREE.AnimationClip[],
  entry: ModelRegistryEntry,
): THREE.AnimationClip | null {
  if (clips.length === 0) return null;
  const notTpose = (c: THREE.AnimationClip) => !/t.?pose|bind|a.?pose/i.test(c.name);

  // 1) Explicit preference from the registry (name or regex source).
  if (entry.poseClip) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(entry.poseClip, 'i');
    } catch {
      re = null;
    }
    const wanted = clips.find((c) =>
      re ? re.test(c.name) : c.name.toLowerCase() === entry.poseClip!.toLowerCase(),
    );
    if (wanted) return wanted;
  }

  // 2) A grounded idle/ready/combat stance (never a locomotion or T-pose clip).
  return (
    clips.find((c) => /idle|survey|stand|breath|ready|guard|combat/i.test(c.name) && notTpose(c)) ??
    clips.find((c) => notTpose(c)) ??
    clips[0] ??
    null
  );
}

export class ModelLibrary {
  private loader = new GLTFLoader();
  private cache = new Map<string, Promise<Template>>();
  /** Live per-clone mixers driving a subtle idle so figures aren't static T-poses. */
  private mixers: THREE.AnimationMixer[] = [];

  /** Advance all idle animations; call once per frame from the render loop. */
  update(dt: number): void {
    for (const m of this.mixers) m.update(dt);
  }

  /** Stop & drop all idle mixers (called on scene dispose). */
  dispose(): void {
    for (const m of this.mixers) m.stopAllAction();
    this.mixers.length = 0;
  }

  /**
   * Load (or reuse) the template scene for a URL. The returned object is the
   * SHARED template — never mutate or add it to the scene directly; clone it via
   * `instantiate`.
   */
  private loadTemplate(url: string): Promise<Template> {
    let p = this.cache.get(url);
    if (p) return p;
    p = new Promise<Template>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          // Keep every clip on the template; the per-faction registry entry picks
          // the right grounded stance at instantiate time (so the same cached
          // load can pose different factions differently).
          const clips = gltf.animations ?? [];
          gltf.animations = [];
          root.updateMatrixWorld(true);
          resolve({ root, clips });
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
    this.cache.set(url, p);
    return p;
  }

  /**
   * Produce a tinted, scaled, base-resting clone of the model for one model
   * instance. Returns a Group whose origin is at the model's feet (y = 0),
   * centred on X/Z — matching the procedural-proxy convention so the existing
   * positioning / death-sink / picking code works unchanged.
   *
   * @param onReady called with the prepared clone once the GLB has loaded.
   */
  instantiate(
    url: string,
    proxy: ProxyDescriptor,
    entry: ModelRegistryEntry,
    onReady: (clone: THREE.Group) => void,
    onError?: (err: unknown) => void,
  ): void {
    this.loadTemplate(url)
      .then((template) => {
        const clone = skeletonClone(template.root) as THREE.Object3D;

        // Pose the skeleton FIRST so the bounding box used for scaling/centring
        // reflects the actual stance (feet rest on y=0 even for a hunched combat
        // frame). A frozen pose holds one deliberate, battle-ready frame; an
        // unspecified one plays a slow perpetual idle, desynced per clone so a
        // squad doesn't breathe in lockstep.
        const clip = pickPoseClip(template.clips, entry);
        if (clip) {
          try {
            const mixer = new THREE.AnimationMixer(clone);
            mixer.clipAction(clip).play();
            if (entry.poseFreezeAt !== undefined) {
              // Hold a single menacing frame; do NOT register the mixer so it is
              // never advanced — the stance stays locked and costs nothing.
              mixer.setTime(entry.poseFreezeAt);
              mixer.update(0); // write the frozen pose into the bones now
            } else {
              mixer.setTime(Math.random() * 2); // desync squad members
              this.mixers.push(mixer);
            }
          } catch {
            /* fall back to authored static stance */
          }
        }

        // Correct the model's authored forward to engine +Z (independent of the
        // per-owner rotation applied by the caller). Applied to the inner clone
        // so the owner rotation on the parent group still spins both armies to
        // face the centre line.
        clone.rotation.y = entry.yaw ?? 0;

        const group = new THREE.Group();
        group.add(clone);

        // Tint + clone materials so each unit can carry its own faction colours
        // without disturbing the shared template or other units.
        tintModel(clone, proxy);

        // Normalise: scale uniformly to the target height and rest feet on y=0.
        // Runs AFTER posing + yaw so the box is measured in final orientation.
        normalizeToHeight(clone, targetHeightInches(proxy, entry));

        // Shadows on every mesh.
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        onReady(group);
      })
      .catch((err) => {
        if (onError) onError(err);
        else console.warn(`[ModelRegistry] failed to load ${url}`, err);
      });
  }
}

/* --------------------------- material tinting ----------------------------- */

/**
 * Repaint every material on the model into a GRIMDARK finish: the faction
 * primary is desaturated and darkened toward a weathered war-paint tone, then
 * blended over the model's own shading; roughness is driven up and the surface
 * given a cold metal response with a faint dark ambient wash in the recesses.
 *
 * Necrons (proxy.glow set) KEEP a green emissive so the undying glow survives
 * and pops under bloom — read as cold metal-bone. Everything else is made
 * NON-emissive and gritty: the demon dark and ominous, the orc dark olive/iron,
 * the armoured warrior dark battle-worn steel.
 */
function tintModel(root: THREE.Object3D, proxy: ProxyDescriptor): void {
  // Grimdark war-paint: pull the faction primary toward grey (desaturate) and
  // darken it so nothing reads bright or cartoony. We compute this ONCE per unit.
  const primary = new THREE.Color(proxy.primary);
  const grimPrimary = grimdarkify(primary);
  const glow = proxy.glow ? new THREE.Color(proxy.glow) : null;
  // Higher base metalness for a cold, gunmetal sheen rather than plastic.
  const metalness = proxy.metalness ?? 0.55;

  // Cache cloned materials by their source so shared source materials within a
  // single model stay shared after cloning (cheaper, fewer draw-state changes).
  const seen = new Map<THREE.Material, THREE.Material>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    if (Array.isArray(src)) {
      mesh.material = src.map((m) => tintMaterial(m, grimPrimary, glow, metalness, seen));
    } else if (src) {
      mesh.material = tintMaterial(src, grimPrimary, glow, metalness, seen);
    }
  });
}

/**
 * Turn a faction colour into a grimdark war-paint tone: desaturate toward steel
 * and darken, so even a "bright blue" Ultramarine reads as dark battle-worn
 * steel-blue rather than a toy. Hue is preserved so factions stay distinct.
 */
function grimdarkify(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Desaturate and crush the value into the lower-mid range (weathered), but
  // hold a saturation/lightness FLOOR so distinct factions never collapse into
  // the same dark steel — a "bright blue" and a "bright red" must still read as
  // blue and red, only battle-worn.
  const s = THREE.MathUtils.clamp(hsl.s * 0.8, 0.34, 0.9);
  const l = THREE.MathUtils.clamp(hsl.l * 0.72, 0.09, 0.5);
  return new THREE.Color().setHSL(hsl.h, s, l);
}

function tintMaterial(
  src: THREE.Material,
  grimPrimary: THREE.Color,
  glow: THREE.Color | null,
  metalness: number,
  seen: Map<THREE.Material, THREE.Material>,
): THREE.Material {
  const cached = seen.get(src);
  if (cached) return cached;

  const out = src.clone();
  // Only standard-like materials carry colour/PBR fields; guard with a cast.
  const std = out as THREE.MeshStandardMaterial;
  const hasTexture = !!(std as unknown as { map?: unknown }).map;
  if (std.color) {
    // Blend toward the grim faction tone, but GENTLY when the model has a real
    // texture (so its sculpted detail survives instead of being painted a solid
    // faction colour). Flat/untextured models get a stronger pull so they still
    // read as the faction rather than raw white/grey.
    std.color.lerp(grimPrimary, hasTexture ? 0.45 : 0.62);
    std.color.multiplyScalar(0.88); // light dark wash — sink the midtones a touch
  }
  // Near-binary metalness: preserve genuinely-metallic source parts (push them
  // to a firm metal value) and force dielectrics (cloth/skin/plastic) fully to
  // 0. Forcing a flat 0.55 on EVERY mesh was the "injection-moulded plastic"
  // look — half-metal reads as neither metal nor dielectric.
  const wasMetallic = 'metalness' in std ? (std.metalness as number) : 0;
  const isMetal = wasMetallic > 0.5;
  if ('metalness' in std) {
    std.metalness = isMetal ? THREE.MathUtils.clamp(metalness, 0.6, 1.0) : 0.0;
  }
  if ('roughness' in std && typeof std.roughness === 'number') {
    // Metal gets a lower roughness floor so it catches a crisp specular streak
    // off the rim/key; dielectrics stay high-roughness and matte.
    std.roughness = isMetal
      ? THREE.MathUtils.clamp(std.roughness * 1.1 + 0.05, 0.35, 0.7)
      : THREE.MathUtils.clamp(std.roughness * 1.15 + 0.22, 0.6, 0.96);
  }
  // Feed metal specular from the (now brighter) environment map; keep dielectrics
  // grounded so they don't pick up a chromed sheen.
  if ('envMapIntensity' in std) {
    std.envMapIntensity = isMetal ? 0.9 : 0.25;
  }
  if (std.emissive) {
    // Only parts that were ALREADY emissive in the source (eyes / energy cells)
    // keep a glow. Copying the faction glow onto EVERY material is what turned
    // whole models (e.g. Necrons) a solid glowing green.
    const wasEmissive = std.emissive.r + std.emissive.g + std.emissive.b > 0.03;
    if (glow && wasEmissive) {
      std.emissive.copy(glow); // cold undying glow survives and blooms
      // Pushed into HDR so it clears the bloom threshold cleanly and reads as a
      // genuine hot emitter (eyes / energy cells), not a warm-grey panel.
      std.emissiveIntensity = 1.4;
    } else {
      std.emissive.setRGB(0, 0, 0);
      std.emissiveIntensity = 0;
    }
  }
  std.needsUpdate = true;
  seen.set(src, out);
  return out;
}

/* ----------------------------- normalisation ------------------------------ */

/**
 * Uniformly scale `inner` so it is `targetHeight` inches tall, then recentre on
 * X/Z and drop so the lowest point rests on y = 0 (feet on the base).
 */
function normalizeToHeight(inner: THREE.Object3D, targetHeight: number): void {
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  if (box.isEmpty()) return;

  const size = new THREE.Vector3();
  box.getSize(size);
  const height = size.y || 1e-6;
  const scale = targetHeight / height;
  inner.scale.multiplyScalar(scale);

  // Recompute after scaling for an accurate recentre.
  inner.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(inner);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  inner.position.x -= center.x;
  inner.position.z -= center.z;
  inner.position.y -= box2.min.y;
}
