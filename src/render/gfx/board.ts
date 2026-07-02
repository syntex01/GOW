/** PLACEHOLDER — being replaced by the full gfx board module (in authoring). */
import * as THREE from 'three';
import type { BoardSpec, Built, GfxQuality } from './contract';

export function buildBoard(spec: BoardSpec, q: GfxQuality, seed: number): Built & { matMesh: THREE.Mesh } {
  void q; void seed;
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(spec.width, spec.height, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const matMesh = new THREE.Mesh(geo, mat);
  matMesh.name = 'battlemat';
  matMesh.receiveShadow = true;
  group.add(matMesh);
  return { group, matMesh, dispose: () => { geo.dispose(); mat.dispose(); } };
}
