/** PLACEHOLDER — being replaced by the full gfx sky module (in authoring). */
import * as THREE from 'three';
import type { BoardSpec, Built, GfxQuality } from './contract';

export function buildAtmosphere(spec: BoardSpec, q: GfxQuality, seed: number): Built {
  void spec; void q; void seed;
  return { group: new THREE.Group(), dispose: () => {} };
}
