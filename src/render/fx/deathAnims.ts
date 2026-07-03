/**
 * Procedural death animations. Models are static GLBs (no death clips), so every
 * archetype is driven per-frame here by manipulating the model's Group transform
 * + materials and firing cheap, budget-bounded FxKit bursts (sparks, flash,
 * ring, boom, glowLight, shake). Each archetype was designed by the death-fx
 * workflow; this file implements them. `makeDeathAnim` returns an updater that is
 * ticked by ThreeScene until it returns false (finished → model hidden).
 */
import * as THREE from 'three';
import type { FxKit, V3 } from './fxkit';
import type { DeathArchetype } from './deathFxMap';

export interface DeathCtx {
  /** Model root — its world x/z are set by the scene; y is the sink axis. */
  group: THREE.Group;
  /** The figure sub-group we tilt / scale / tint (base ring stays on `group`). */
  body: THREE.Object3D;
  /** Themed effect colour (faction tint or an impact-role colour). */
  color: number;
  kit: FxKit;
  explosion: boolean;
}

/** Per-frame updater (false = finished). `reset()` restores the model to its
 *  pre-death transform + materials, for a reanimation/revive. */
export type DeathUpdater = ((dt: number) => boolean) & { reset(): void };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeIn = (t: number): number => t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Gather the figure's standard materials once, forcing them fade-ready. */
function collectMats(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && 'opacity' in sm) {
        sm.transparent = true;
        out.push(sm);
      }
    }
  });
  return out;
}

/**
 * Build the per-frame updater for one dying model. Captures the model's rest
 * transform + materials so it can drive and finally hide it.
 */
export function makeDeathAnim(archetype: DeathArchetype, ctx: DeathCtx): DeathUpdater {
  const { group, body, color, kit } = ctx;
  const mats = collectMats(body);
  const baseEmissive = mats.map((m) => ({ hex: m.emissive?.getHex?.() ?? 0, int: m.emissiveIntensity ?? 1 }));
  const restRotX = body.rotation.x;
  const restRotZ = body.rotation.z;
  const restScale = body.scale.clone();
  const restY = group.position.y;
  // Approx figure height for anchoring bursts above the base.
  const box = new THREE.Box3().setFromObject(body);
  const hy = Math.max(0.6, (box.max.y - box.min.y) || 1);
  const at = (yFrac = 0.5): V3 => ({ x: group.position.x, y: restY + hy * yFrac, z: group.position.z });

  // Random but deterministic-per-anim tilt direction (varies the line's fall).
  const dir = (group.position.x * 13.1 + group.position.z * 7.7) % 1 < 0.5 ? 1 : -1;

  const restColors = mats.map((m) => m.color?.getHex?.() ?? 0xffffff);

  let t = 0;
  const dur = archetype === 'catastrophic-hull-detonation' || archetype === 'burning-wreck-topple' ? 1.3
    : archetype === 'spark-slump' || archetype === 'warp-pyre-immolation' ? 1.1
    : 0.85;
  const fired = new Set<string>();
  const once = (k: string): boolean => (fired.has(k) ? false : (fired.add(k), true));

  const update: DeathUpdater = ((dt: number): boolean => run(dt)) as DeathUpdater;
  update.reset = (): void => {
    body.rotation.x = restRotX;
    body.rotation.z = restRotZ;
    body.scale.copy(restScale);
    group.position.y = restY;
    group.visible = true;
    mats.forEach((m, i) => {
      m.opacity = 1;
      m.transparent = false;
      m.color?.setHex?.(restColors[i]);
      m.emissive?.setHex?.(baseEmissive[i].hex);
      m.emissiveIntensity = baseEmissive[i].int;
    });
  };

  const setOpacity = (o: number): void => { for (const m of mats) m.opacity = o; };
  const setEmissive = (hex: number, intensity: number): void => {
    for (const m of mats) { m.emissive?.setHex?.(hex); m.emissiveIntensity = intensity; }
  };
  const restoreEmissive = (): void => {
    mats.forEach((m, i) => { m.emissive?.setHex?.(baseEmissive[i].hex); m.emissiveIntensity = baseEmissive[i].int; });
  };
  const sparkN = kit.budget.sparks;

  function run(dt: number): boolean {
    t = Math.min(1, t + dt / dur);
    const done = t >= 1;

    switch (archetype) {
      case 'reanimation-failed': {
        // Topple, then twitch with failing green self-repair, then go dark.
        if (t < 0.4) {
          body.rotation.z = restRotZ + easeIn(t / 0.4) * 0.9 * dir;
          group.position.y = restY - (t / 0.4) * 0.15;
        } else {
          const twitch = Math.sin(t * 60) * (1 - t) * 0.05;
          body.rotation.z = restRotZ + 0.9 * dir + twitch;
          setEmissive(0x2bff6a, ((Math.sin(t * 40) > 0.4 ? 1.6 : 0.2)) * (1 - t));
          if (Math.floor(t * 12) !== Math.floor((t - dt / dur) * 12)) kit.sparks(at(0.55), 0x39ff7a, Math.min(4, sparkN), 2.5);
        }
        setOpacity(t > 0.8 ? lerp(1, 0, (t - 0.8) / 0.2) : 1);
        break;
      }
      case 'phase-out': {
        // Flare, stretch into a vertical scanline, blink out.
        body.scale.set(restScale.x * (1 - t), restScale.y * (1 + 0.6 * t), restScale.z * (1 - t));
        setEmissive(t < 0.5 ? 0x39ff7a : 0xffffff, 2 * (1 - t * 0.5));
        setOpacity(1 - t * t);
        if (once('a') ) { kit.flash(at(0.6), 0x39ff7a, 1.1, 0.25); }
        if (t > 0.5 && once('b')) { kit.sparks(at(0.7), 0x39ff7a, Math.min(6, sparkN), 3); kit.ring(at(0), 0x39ff7a, 1.4); }
        break;
      }
      case 'green-disintegrate': {
        // Thin away and rise as green motes.
        body.scale.set(restScale.x * (1 - t), restScale.y * (1 - t * 0.5), restScale.z * (1 - t));
        group.position.y = restY + t * 0.3;
        setEmissive(0x2bff6a, (1 - t) * (0.6 + Math.abs(Math.sin(t * 20)) * 0.8));
        setOpacity(1 - t);
        if (once('a')) kit.sparks(at(0.5), 0x39ff7a, Math.min(5, sparkN), 2);
        if (t > 0.5 && once('b')) { kit.sparks(at(0.7), 0x39ff7a, Math.min(5, sparkN), 2.5); }
        if (done) kit.ring(at(0), 0x39ff7a, 1.0);
        break;
      }
      case 'rigid-topple': {
        // Felled-statue pivot about the foot with an overshoot settle.
        const f = easeOut(t);
        const overshoot = Math.sin(t * Math.PI) * 0.12 * (1 - t);
        body.rotation.x = restRotX + (f * 1.5 + overshoot);
        if (once('a')) { kit.sparks(at(0.6), color, Math.min(5, sparkN), 3); kit.flash(at(0.6), color, 0.6, 0.18); }
        if (t > 0.55 && once('hit')) { kit.sparks(at(0.05), 0x9fd0ff, Math.min(5, sparkN), 2); kit.ring(at(0), 0x9aa0a8, 1.1); kit.shake(0.2); }
        setOpacity(t > 0.7 ? lerp(1, 0.2, (t - 0.7) / 0.3) : 1);
        group.position.y = restY - t * 0.15;
        break;
      }
      case 'spark-slump': {
        // Systems fail: sputter, sink to a kneel, fade with a dim light.
        body.rotation.x = restRotX + easeIn(t) * 0.8;
        group.position.y = restY - t * 0.2;
        if (Math.floor(t * 8) !== Math.floor((t - dt / dur) * 8) && t < 0.8) kit.sparks(at(0.85), 0xbfe0ff, Math.min(3, sparkN), 1.6);
        setEmissive(0x8fbfff, (Math.sin(t * 30) > 0.3 ? 1.2 : 0.1) * (1 - t));
        if (once('l')) kit.glowLight(at(0.7), 0x88bbff, 1.2, 0.5);
        setOpacity(t > 0.6 ? lerp(1, 0, (t - 0.6) / 0.4) : 1);
        if (done) kit.flash(at(0.4), 0x445566, 0.7, 0.4);
        break;
      }
      case 'squig-green-splat': {
        // Flatten in a wet green burst with a lingering splat.
        body.scale.set(restScale.x * (1 + (1 - Math.max(0, 1 - t * 1.4)) * 0.8), restScale.y * Math.max(0.08, 1 - t * 1.4), restScale.z * (1 + (1 - Math.max(0, 1 - t * 1.4)) * 0.8));
        setEmissive(0x33ff22, (1 - t) * 1.5);
        group.position.y = restY - t * 0.1;
        if (t > 0.2 && once('splat')) { kit.sparks(at(0.3), 0x33ff22, Math.min(sparkN, 8), 4); kit.ring(at(0), 0x2a8a1a, 1.3); }
        setOpacity(t > 0.7 ? lerp(1, 0, (t - 0.7) / 0.3) : 1);
        break;
      }
      case 'ork-timber-faceplant': {
        // Stiff faceplant with an accelerating fall and a dusty thud.
        body.rotation.x = restRotX + easeIn(t) * 1.55;
        if (t > 0.6 && once('thud')) { kit.sparks(at(0.05), 0xb99a6a, Math.min(6, sparkN), 3); kit.ring(at(0), 0x8a6a3a, 1.4); kit.shake(0.4); }
        // squash-bounce on impact
        if (t > 0.6) { const b = 1 - Math.abs(Math.sin((t - 0.6) / 0.4 * Math.PI)) * 0.25; body.scale.set(restScale.x, restScale.y * b, restScale.z); }
        setOpacity(t > 0.8 ? lerp(1, 0.3, (t - 0.8) / 0.2) : 1);
        break;
      }
      case 'warp-pyre-immolation': {
        // Violet-cored flame climbs; body blackens, sags, collapses to embers.
        const peak = Math.sin(t * Math.PI);
        setEmissive(t < 0.5 ? 0xff7a2a : 0x9a3cff, peak * 2.2);
        for (const m of mats) if (m.color) m.color.lerp(new THREE.Color(0x1a1418), dt * 1.2);
        body.rotation.z = restRotZ + easeIn(Math.max(0, t - 0.4) / 0.6) * 0.7 * dir;
        group.position.y = restY - Math.max(0, t - 0.4) * 0.25;
        if (Math.floor(t * 6) !== Math.floor((t - dt / dur) * 6)) kit.sparks(at(0.6 + Math.random() * 0.3), t < 0.5 ? 0xff8a3a : 0x9a3cff, Math.min(4, sparkN), 2.5);
        if (once('l')) kit.glowLight(at(0.5), 0xaa4aff, 1.5, dur * 0.8);
        setOpacity(t > 0.75 ? lerp(1, 0.15, (t - 0.75) / 0.25) : 1);
        if (done) kit.ring(at(0), 0x6a1a8a, 1.2);
        break;
      }
      case 'warp-dissolve-ash': {
        // Desaturate to ash, glow violet at the edges, stream upward.
        for (const m of mats) if (m.color) m.color.lerp(new THREE.Color(0x6a6a70), dt * 1.4);
        setEmissive(0x6a1a8a, (1 - t) * 0.9);
        group.position.y = restY + t * 0.4;
        body.rotation.y += dt * 1.5;
        setOpacity(1 - t);
        if (Math.floor(t * 6) !== Math.floor((t - dt / dur) * 6)) { kit.sparks(at(0.6), 0x9a3cff, Math.min(4, sparkN), 1.8); kit.flash(at(0.7), 0x6a3a8a, 0.5, 0.35); }
        break;
      }
      case 'catastrophic-hull-detonation': {
        // Charge white, erupt in a fireball + debris + scorch, sink to a shell.
        if (t < 0.18) {
          setEmissive(0xffffff, t / 0.18 * 2);
          body.scale.setScalar(lerp(1, 1.08, t / 0.18) * restScale.x);
        } else {
          if (once('boom')) {
            kit.boom(at(0.5), 0xffb040, 1.8);
            kit.glowLight(at(0.6), 0xffa030, 3, 0.5);
            kit.ring(at(0), 0x30231a, 2.2);
            kit.shake(0.5);
            for (let i = 0; i < Math.min(3, kit.budget.volleys); i++) kit.sparks(at(0.4 + i * 0.2), 0xffaa40, sparkN, 7);
          }
          const p = (t - 0.18) / 0.82;
          setEmissive(0x662010, (1 - p) * 1.5);
          for (const m of mats) if (m.color) m.color.lerp(new THREE.Color(0x201818), dt);
          group.position.y = restY - p * 0.18;
          body.rotation.z = restRotZ + p * 0.25 * dir;
          if (Math.floor(t * 4) !== Math.floor((t - dt / dur) * 4)) kit.flash(at(0.7), 0x552211, 0.9, 0.5); // venting smoke
        }
        break;
      }
      case 'burning-wreck-topple': {
        // Lose footing, tip over one axis, then burn under a smoke column.
        const f = easeOut(Math.min(1, t / 0.55));
        body.rotation.z = restRotZ + f * 1.2 * dir;
        group.position.y = restY - f * 0.12;
        if (t > 0.5 && once('hit')) { kit.ring(at(0), 0x30231a, 1.6); kit.sparks(at(0.2), 0xffaa40, Math.min(6, sparkN), 4); kit.shake(0.3); }
        if (t > 0.5) {
          setEmissive(0x882810, 1.2 + Math.sin(t * 25) * 0.5);
          if (Math.floor(t * 5) !== Math.floor((t - dt / dur) * 5)) kit.flash(at(0.7), 0x552211, 0.8, 0.6);
          if (Math.floor(t * 3) !== Math.floor((t - dt / dur) * 3)) kit.sparks(at(0.5), 0xffaa40, Math.min(3, sparkN), 3);
        }
        setOpacity(t > 0.85 ? lerp(1, 0.5, (t - 0.85) / 0.15) : 1);
        break;
      }
      case 'topple-crumble':
      default: {
        // Universal fallback: tip away, crumple into a dust puff, sink + fade.
        body.rotation.z = restRotZ + easeOut(t) * 1.4 * dir;
        if (t > 0.5) body.scale.set(restScale.x, restScale.y * lerp(1, 0.6, (t - 0.5) / 0.5), restScale.z);
        group.position.y = restY - t * 0.5;
        setOpacity(1 - t);
        if (once('a')) { kit.sparks(at(0.4), color, Math.min(5, sparkN), 3); kit.ring(at(0), 0x888888, 1.0); }
        break;
      }
    }

    if (done) {
      // Freeze hidden; restore emissive so a later revive/reuse looks right.
      group.visible = false;
      setOpacity(0);
      restoreEmissive();
    }
    return !done;
  }

  return update;
}
