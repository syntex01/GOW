/** PLACEHOLDER — being replaced by the full gfx terrain module (in authoring). */
import * as THREE from 'three';
import type { TerrainPiece } from '../../engine/types';
import { tableToWorld, type BoardSpec, type Built, type GfxQuality } from './contract';

export function buildTerrain(pieces: TerrainPiece[], spec: BoardSpec, q: GfxQuality, seed: number): Built {
  void q; void seed;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x232227, roughness: 0.9 });
  const geos: THREE.BufferGeometry[] = [];
  for (const p of pieces) {
    const h = p.kind === 'ruin' ? p.height : 0.4;
    const geo = new THREE.BoxGeometry(p.width, h, p.depth);
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(tableToWorld(p.center, spec, h / 2));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return { group, dispose: () => { geos.forEach((g) => g.dispose()); mat.dispose(); } };
}
