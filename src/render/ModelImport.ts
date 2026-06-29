import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { ThreeScene } from './ThreeScene';

/**
 * Importing user-provided, publicly-available models and attaching them to a
 * unit in place of the procedural proxy.
 *
 * Supports glTF/GLB (recommended — carries materials), OBJ (geometry + basic
 * materials) and STL (raw geometry, given a default material). After loading we
 * normalise scale to a target height in inches and recentre the model so its
 * base sits on the table (y = 0), matching the procedural-proxy convention.
 */

export type ModelFormat = 'gltf' | 'glb' | 'obj' | 'stl';

export interface ImportOptions {
  /** Target height in inches; the model is uniformly scaled to match. */
  targetHeightInches?: number;
  /** Default material colour for formats without materials (STL). */
  color?: number;
}

/** Resolve a URL string from either a URL or a File/Blob. */
function toURL(src: string | File): { url: string; revoke: boolean } {
  if (typeof src === 'string') return { url: src, revoke: false };
  return { url: URL.createObjectURL(src), revoke: true };
}

/**
 * Load a model from a URL or File and return a normalised Object3D whose origin
 * is at the centre of its footprint with the base resting on y = 0.
 */
export async function loadModel(
  src: string | File,
  format: ModelFormat,
  options: ImportOptions = {},
): Promise<THREE.Object3D> {
  const { url, revoke } = toURL(src);
  try {
    const object = await loadRaw(url, format, options.color ?? 0x9aa3ad);
    normalize(object, options.targetHeightInches ?? 2.0);
    return object;
  } finally {
    if (revoke) URL.revokeObjectURL(url);
  }
}

/** Dispatch to the correct loader and return a uniform Object3D. */
function loadRaw(url: string, format: ModelFormat, stlColor: number): Promise<THREE.Object3D> {
  switch (format) {
    case 'gltf':
    case 'glb': {
      const loader = new GLTFLoader();
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (gltf) => resolve(gltf.scene),
          undefined,
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      });
    }
    case 'obj': {
      const loader = new OBJLoader();
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (obj) => resolve(obj),
          undefined,
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      });
    }
    case 'stl': {
      const loader = new STLLoader();
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (geo) => {
            geo.computeVertexNormals();
            const mat = new THREE.MeshStandardMaterial({
              color: stlColor,
              metalness: 0.25,
              roughness: 0.6,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            resolve(mesh);
          },
          undefined,
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      });
    }
    default: {
      const exhaustive: never = format;
      return Promise.reject(new Error(`Unsupported model format: ${String(exhaustive)}`));
    }
  }
}

/**
 * Uniformly scale to a target height (inches) and recentre so the model is
 * centred on X/Z and its lowest point sits at y = 0 (resting on the base).
 */
function normalize(object: THREE.Object3D, targetHeightInches: number): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const size = new THREE.Vector3();
  box.getSize(size);
  const height = size.y || 1e-6;
  const scale = targetHeightInches / height;
  object.scale.multiplyScalar(scale);

  // Recompute the box after scaling to recentre accurately.
  object.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  // Shift so X/Z are centred and the base (min Y) rests on 0.
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box2.min.y;
}

/**
 * Attach an already-loaded Object3D to a unit, replacing its procedural proxy.
 * Thin wrapper over ThreeScene.setUnitModel so callers depend only on this
 * module's surface.
 */
export function applyImportedModelToUnit(
  scene: ThreeScene,
  unitId: string,
  object3d: THREE.Object3D,
): void {
  scene.setUnitModel(unitId, object3d);
}

/** Convenience: load and attach in one call. */
export async function importAndAttach(
  scene: ThreeScene,
  unitId: string,
  src: string | File,
  format: ModelFormat,
  options?: ImportOptions,
): Promise<THREE.Object3D> {
  const obj = await loadModel(src, format, options);
  applyImportedModelToUnit(scene, unitId, obj);
  return obj;
}
