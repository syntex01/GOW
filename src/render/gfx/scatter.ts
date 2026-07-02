/** PLACEHOLDER — being replaced by the full gfx scatter module (in authoring). */
import * as THREE from 'three';
import type { AvoidRect, BoardSpec, Built, GfxQuality } from './contract';

export function buildScatter(spec: BoardSpec, avoid: AvoidRect[], q: GfxQuality, seed: number): Built {
  void spec; void avoid; void q; void seed;
  return { group: new THREE.Group(), dispose: () => {} };
}
