/** PLACEHOLDER — being replaced by the full gfx lights module (in authoring). */
import * as THREE from 'three';
import type { BoardSpec, Built, GfxTier } from './contract';

export function buildLights(spec: BoardSpec, shadowMapSize: number, tier: GfxTier): Built & { key: THREE.DirectionalLight } {
  const group = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffce93, 3.0);
  key.position.set(spec.width * 0.62, spec.width * 0.45, spec.height * 0.62);
  key.castShadow = shadowMapSize > 0;
  const sm = Math.max(512, shadowMapSize);
  key.shadow.mapSize.set(sm, sm);
  const span = Math.max(spec.width, spec.height) * 0.55;
  const cam = key.shadow.camera;
  cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
  cam.near = spec.width * 0.4; cam.far = spec.width * 2.2;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = tier === 'low' ? 2 : 3.5;
  const hemi = new THREE.HemisphereLight(0x3a4658, 0x140d06, 0.24);
  group.add(key, hemi);
  return { group, key, dispose: () => {} };
}
