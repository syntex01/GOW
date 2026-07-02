/** PLACEHOLDER — being replaced by the full gfx post module (in authoring). */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { UnrealBloomPass as Bloom } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { GfxTier } from './contract';

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

export function buildPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts: { tier: GfxTier; width: number; height: number; bloomDownscale: number },
): PostChain | null {
  try {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const ds = Math.max(1, opts.bloomDownscale);
    const bloom = new Bloom(
      new THREE.Vector2(Math.max(1, Math.floor(opts.width / ds)), Math.max(1, Math.floor(opts.height / ds))),
      0.9, 0.72, 0.62,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(opts.width, opts.height);
    return {
      composer, bloom, gtao: null, bokeh: null, smaa: null, grade: null,
      setSize: (w, h) => { composer.setSize(w, h); bloom.setSize(w, h); },
      setPixelRatio: (pr) => composer.setPixelRatio(pr),
      updatePerFrame: () => {},
      dispose: () => composer.dispose(),
    };
  } catch {
    return null;
  }
}
