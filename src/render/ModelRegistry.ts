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
}

/**
 * Faction -> model table. Necrons use the robot; Adeptus Astartes / Ultramarines
 * use the marine. Extend by adding rows (most specific first if they overlap).
 */
export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  // Necrons -> the robot model (matched case-insensitively).
  { keywords: ['necrons'], url: 'models/necron.glb', heightScale: 1.0 },
  // Power-armoured humanoids (loyalist + heretic Astartes) -> the soldier model.
  {
    keywords: ['adeptus astartes', 'ultramarines', 'heretic astartes', 'chaos'],
    url: 'models/marine.glb',
    heightScale: 1.0,
  },
  // Orks -> the soldier model as a bulkier stand-in (real humanoid > a blob).
  { keywords: ['orks'], url: 'models/marine.glb', heightScale: 1.15 },
];

/**
 * Resolve the registry entry for a unit, or null to use the procedural proxy.
 * Matching is CASE-INSENSITIVE (datasheet keywords are uppercase, e.g.
 * 'NECRONS'). Vehicles and monsters keep the procedural body — a human-scale
 * figure model would misrepresent a tank/walker; those get bespoke models later.
 */
export function resolveModelEntry(unit: UnitInstance): ModelRegistryEntry | null {
  const sil = unit.proxy?.silhouette;
  if (sil === 'vehicle' || sil === 'monster') return null;
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
  /** An idle-ish clip to pose each clone into a natural stance (or null). */
  poseClip: THREE.AnimationClip | null;
}

export class ModelLibrary {
  private loader = new GLTFLoader();
  private cache = new Map<string, Promise<Template>>();

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
          const clips = gltf.animations ?? [];
          // Choose an idle-ish stance clip (never the bare T/bind pose). Each
          // clone is posed into one frame of it so figures read as miniatures.
          const poseClip =
            clips.find((c) => /idle|survey|stand|breath/i.test(c.name) && !/t.?pose/i.test(c.name)) ??
            clips.find((c) => !/t.?pose/i.test(c.name)) ??
            clips[0] ??
            null;
          gltf.animations = [];
          root.updateMatrixWorld(true);
          resolve({ root, poseClip });
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
        // Pose this clone into a natural idle stance (sample one frame), then
        // discard the mixer — the bones hold the pose and stay fully static.
        if (template.poseClip) {
          try {
            const mixer = new THREE.AnimationMixer(clone);
            mixer.clipAction(template.poseClip).play();
            mixer.update(0.4);
            mixer.stopAllAction();
            clone.updateMatrixWorld(true);
          } catch {
            /* fall back to bind pose */
          }
        }
        const group = new THREE.Group();
        group.add(clone);

        // Tint + clone materials so each unit can carry its own faction colours
        // without disturbing the shared template or other units.
        tintModel(clone, proxy);

        // Normalise: scale uniformly to the target height and rest feet on y=0.
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
 * Clone every material on the model and tint it toward the proxy's primary
 * colour, keeping the original shading readable (we blend, not flatten). For
 * Necrons (proxy.glow set) we add an emissive so the green glow survives and
 * pops under bloom.
 */
function tintModel(root: THREE.Object3D, proxy: ProxyDescriptor): void {
  const primary = new THREE.Color(proxy.primary);
  const glow = proxy.glow ? new THREE.Color(proxy.glow) : null;
  const metalness = proxy.metalness ?? 0.35;

  // Cache cloned materials by their source so shared source materials within a
  // single model stay shared after cloning (cheaper, fewer draw-state changes).
  const seen = new Map<THREE.Material, THREE.Material>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    if (Array.isArray(src)) {
      mesh.material = src.map((m) => tintMaterial(m, primary, glow, metalness, seen));
    } else if (src) {
      mesh.material = tintMaterial(src, primary, glow, metalness, seen);
    }
  });
}

function tintMaterial(
  src: THREE.Material,
  primary: THREE.Color,
  glow: THREE.Color | null,
  metalness: number,
  seen: Map<THREE.Material, THREE.Material>,
): THREE.Material {
  const cached = seen.get(src);
  if (cached) return cached;

  const out = src.clone();
  // Only standard-like materials carry colour/PBR fields; guard with a cast.
  const std = out as THREE.MeshStandardMaterial;
  if (std.color) {
    // Blend the model's own colour toward the faction primary so detail (and any
    // baked texture) stays visible rather than being painted flat.
    std.color.lerp(primary, 0.55);
  }
  if ('metalness' in std) {
    std.metalness = THREE.MathUtils.clamp(metalness, 0, 1);
  }
  if ('roughness' in std && typeof std.roughness === 'number') {
    // Nudge toward a slightly glossy wargame finish without going mirror-like.
    std.roughness = THREE.MathUtils.clamp(std.roughness * 0.9, 0.25, 0.9);
  }
  if (glow && std.emissive) {
    std.emissive.copy(glow);
    std.emissiveIntensity = 0.7;
  }
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
