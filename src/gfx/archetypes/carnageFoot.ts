import type { UnitVisual } from '../../data/types'
import type { Canvas2D } from '../painter'
import Pix, { RES, pixelNoise } from '../pixel'
import { bone, validateSkeleton, type Clip, type Skeleton } from '../rig'
import {
  blemish,
  boneSpur,
  claw,
  eyeCluster,
  fleshKit,
  fleshMass,
  maw,
  pustule,
  ribCage,
  rimFlesh,
  spine,
  suture,
  tentacleLimb,
  viscera,
  wet,
  type FleshKit
} from '../flesh'
import type { Archetype, ArchetypeBuild, ClipName, PartArt } from './types'

/**
 * THE CARNAGE BIPEDS.
 *
 * Nothing in here inherits from the footman. That is the point: the footman is
 * a *person* — symmetric, upright, wearing kit, holding a tool — and the whole
 * argument of this faction is that its soldiers stopped being people. So these
 * are built from a different skeleton, with different proportions, out of the
 * flesh vocabulary in `gfx/flesh.ts`, and they move on clips that a human rig
 * could not hold.
 *
 * The rules that make them read as one army rather than five experiments:
 *
 *  ASYMMETRY IS THE SIGNATURE. Every one of them is lopsided — one arm longer,
 *  one shoulder higher, the head off the centre line. A symmetrical silhouette
 *  reads as manufactured, and nothing here was manufactured.
 *
 *  THE SPINE LEADS. On a footman the hips lead and the torso follows. Here the
 *  torso is dragged forward ahead of the legs, so every one of them looks like
 *  it is falling toward you and catching itself.
 *
 *  NO CLIP RETURNS TO REST. Human animation settles; these overshoot and hold
 *  slightly wrong, so a rank of them never syncs up into a chorus line.
 */

export type CarnagePlan =
  | 'husk'
  | 'flenser'
  | 'shrike'
  | 'butcher'
  | 'bonewright'
  | 'boneling'

/** Art pixels from a height fraction. Everything is authored at half res. */
const art = (fraction: number, height: number): number => Math.max(1, Math.round(fraction * height * RES))

function pad(w: number, h: number): Pix {
  return new Pix(Math.max(2, w + 4), Math.max(2, h + 4))
}

/**
 * The finish applied to the parts that DEFINE THE SILHOUETTE — torsos, heads,
 * masses. These get the wet pass and an outline, because they are what the eye
 * finds the creature's shape from.
 *
 * Limbs deliberately do not go through here. See `meatLimb`.
 */
function finish(p: Pix, k: FleshKit, seed: number, sheen = 1): Canvas2D {
  wet(p, seed, sheen)
  blemish(p, k, seed)
  rimFlesh(p, k)
  return p.toCanvas() as Canvas2D
}

/**
 * A limb of meat. Authored pointing DOWN, tapering, with the muscle belly
 * bulging off-centre and a fibre highlight down the lit side.
 *
 * Deliberately not `limbSegment`: that draws a sleeve with a ball joint, which
 * is a garment. This is a bundle of muscle with nothing over it.
 *
 * TWO THINGS IT MUST NOT DO, both learned by looking at it:
 *
 *  NO WET PASS. `wet()` lights the top edge of every column, which on a limb
 *  authored pointing down means a bright horizontal band across the shoulder of
 *  each segment. Six segments, six bands — the creature read as a stack of
 *  bricks. The roundness here comes from the cross-section ramp instead, which
 *  runs the right way along the form.
 *
 *  NO OUTLINE. A limb is not a separate object from the arm above it. Outlining
 *  each segment drew a dark border at every joint and turned one creature into
 *  eleven parts sitting near each other. The silhouette is carried by the torso
 *  and by the darkest column of the ramp, which is enough at this size.
 *
 * Segments are also drawn ~18% longer than their bone so consecutive ones
 * overlap and the joint never shows daylight.
 */
function meatLimb(len: number, thick: number, k: FleshKit, seed: number, opts: { hook?: boolean } = {}): PartArt {
  const draw = Math.round(len * 1.18)
  const p = pad(Math.round(thick * 2.2) + 4, draw + 4)
  const cx = p.w / 2
  const top = 2
  const noise = pixelNoise(seed * 1493 + 7)
  for (let i = 0; i < draw; i += 1) {
    const t = i / Math.max(1, draw - 1)
    // The belly of the muscle sits a third of the way down, not in the middle,
    // and the surface is bumpy rather than a clean taper.
    const belly = 1 + Math.sin(Math.min(1, t / 0.34) * Math.PI * 0.5) * 0.42 - t * 0.46
    const wid = Math.max(1, Math.round(thick * belly * (0.94 + noise(i, 3) * 0.14)))
    const lean = opts.hook ? Math.sin(t * 2.1) * thick * 0.3 : 0
    // Where the skin has split. Bands of it, not speckle, so a limb reads as
    // partly flayed rather than dirty.
    const torn = noise(Math.floor(i / 3), 23) > 0.62
    const surface = torn ? k.meat : k.hide
    for (let o = 0; o < wid; o += 1) {
      // A round cross-section: dark far edge, mid body, one bright band two
      // thirds across, then turning away again. Five steps, not three.
      const s = wid <= 1 ? 0.6 : o / (wid - 1)
      const shade = s < 0.12 ? 0 : s < 0.32 ? 1 : s < 0.66 ? 2 : s < 0.86 ? 3 : 2
      p.set(Math.round(cx + lean - wid / 2 + o), top + i, surface[shade])
    }
    // Fibre: broken strands along the lit side of exposed muscle, so a torn
    // stretch reads as bundles rather than as a stain.
    if (torn && wid > 2 && noise(i, 11) > 0.5) {
      p.set(Math.round(cx + lean + wid * 0.16), top + i, k.gristle[3])
    }
  }
  // The joint at the top is a knob of bone, not a ball of cloth — and it is
  // what physically covers the seam with the segment above.
  p.ellipse(cx, top + 1, thick * 0.5, thick * 0.44, k.bone[2])
  p.ellipse(cx + thick * 0.1, top + 0.5, thick * 0.32, thick * 0.28, k.bone[4])
  blemish(p, k, seed, 0.02)
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, top / p.h] }
}

/** A leg. Same construction, thicker, and it does not hook. */
function meatLeg(len: number, thick: number, k: FleshKit, seed: number): PartArt {
  return meatLimb(len, thick, k, seed)
}

function footClaw(size: number, k: FleshKit, seed: number): PartArt {
  const p = pad(size * 3, size * 2 + 3)
  const cx = p.w / 2
  // A pad of meat with three talons off it, splayed. Part of the limb chain, so
  // no outline and no wet pass — see `meatLimb`.
  p.ellipse(cx, 3, size * 0.8, size * 0.6, k.hide[1])
  p.ellipse(cx + size * 0.16, 2.4, size * 0.5, size * 0.4, k.hide[3])
  claw(p, cx + size * 0.55, 3, size * 1.2, k)
  claw(p, cx - size * 0.45, 3, size, k)
  blemish(p, k, seed, 0.02)
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 2 / p.h] }
}

// ────────────────────────────────── HUSK ──────────────────────────────────

/**
 * THE HUSK — the shape of somebody who has stopped.
 *
 * Built wrong on purpose. The head hangs forward off a broken neck so you never
 * see its face; the ribs are open on one side; one arm is long enough to drag.
 * Nothing about it is holding a weapon — the "attack" is the whole upper body
 * being thrown at you, which is why the clip below rotates the torso rather
 * than an arm.
 */
function huskTorso(height: number, k: FleshKit, tier: number): PartArt {
  const w = art(0.3, height)
  const h = art(0.44, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.55, w * 0.46, h * 0.46, k.hide, 3 + tier, 6)
  // Open ribs on the near side. The single most identifying feature.
  ribCage(p, cx - w * 0.04, p.h * 0.24, w * 0.5, h * 0.42, k, 3 + Math.min(1, tier), 1)
  // Vertebrae along the far shoulder, because the spine is riding high.
  spine(p, cx - w * 0.34, p.h * 0.22, cx - w * 0.28, p.h * 0.78, k, 5)
  if (tier >= 1) pustule(p, cx + w * 0.28, p.h * 0.7, 2 + tier * 0.6, k)
  if (tier >= 2) boneSpur(p, cx - w * 0.3, p.h * 0.3, 4 + tier, -1.9, k)
  if (tier >= 3) {
    // A second, smaller torso fused to the first: the Charnel Husk is two.
    fleshMass(p, cx + w * 0.3, p.h * 0.34, w * 0.22, h * 0.2, k.fat, 9, 3)
    suture(p, cx + w * 0.12, p.h * 0.22, cx + w * 0.2, p.h * 0.6, k)
  }
  viscera(p, cx + w * 0.1, p.h * 0.86, Math.round(h * 0.18), k, 4 + tier)
  return { canvas: finish(p, k, 3 + tier), origin: [cx / p.w, (p.h - 2) / p.h] }
}

function huskHead(height: number, k: FleshKit, tier: number): PartArt {
  const r = art(0.13, height)
  const p = pad(r * 2 + 2, r * 2 + 4)
  const cx = p.w / 2
  const cy = p.h * 0.45
  // A skull with the jaw hanging off it and skin only over half.
  p.ellipse(cx, cy, r * 0.92, r, k.bone[2])
  p.ellipse(cx + r * 0.2, cy - r * 0.2, r * 0.6, r * 0.6, k.bone[4])
  p.ellipse(cx - r * 0.3, cy + r * 0.1, r * 0.62, r * 0.72, k.hide[2])
  // Sockets: one empty, one with something still in it.
  p.ellipse(cx + r * 0.34, cy - r * 0.1, r * 0.26, r * 0.3, k.cavity[0])
  if (tier >= 1) eyeCluster(p, cx - r * 0.1, cy - r * 0.05, r * 0.3, k, 1 + tier, 6)
  // THE JAW, dislocated and hanging wide. This is the read that says the thing
  // in front of you is not going to talk: a black gap between the skull and a
  // jaw that is no longer attached to it, with teeth on both edges.
  const jawY = cy + r * 0.72
  p.fill(cx - r * 0.45, cy + r * 0.44, r * 1.05, Math.max(2, r * 0.3), k.cavity[0])
  p.fill(cx - r * 0.45, jawY, r * 1.05, Math.max(2, r * 0.28), k.bone[2])
  p.fill(cx - r * 0.45, jawY, r * 1.05, 1, k.bone[4])
  for (let i = 0; i < 5; i += 1) {
    const tx = Math.round(cx - r * 0.36 + i * r * 0.26)
    p.set(tx, Math.round(jawY - 1), k.bone[4])
    p.set(tx, Math.round(cy + r * 0.44 + Math.max(1, r * 0.3)), k.bone[3])
  }
  if (tier >= 2) {
    boneSpur(p, cx - r * 0.5, cy - r * 0.6, 3 + tier, -2.4, k)
    boneSpur(p, cx + r * 0.5, cy - r * 0.6, 3 + tier, -0.7, k)
  }
  return { canvas: finish(p, k, 11 + tier, 0.8), origin: [cx / p.w, (p.h - 3) / p.h] }
}

const HUSK_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.42, depth: 30 }),
    // The torso is pitched forward hard and the whole rig hangs off it.
    bone('torso', 'root', {
      angle: -Math.PI / 2 + 0.34,
      length: 0.4,
      part: 'torso',
      orient: 'up',
      depth: 31,
      weights: { breathe: 1, lean: 1, flinch: 0.8 }
    }),
    // Broken neck: the head sits forward and DOWN of the shoulders.
    bone('neck', 'torso', { length: 0.06, angle: 0.5, depth: 34 }),
    bone('head', 'neck', { length: 0.1, part: 'head', orient: 'up', depth: 35, weights: { flinch: 1, breathe: 0.5 } }),
    // Long arm — the dragging one — on the near side.
    bone('shoulderF', 'torso', { x: -0.05, y: 0.07, angle: Math.PI, depth: 50 }),
    bone('armF', 'shoulderF', { angle: -0.1, length: 0.26, part: 'armF', depth: 50, weights: { flinch: 0.6 } }),
    bone('foreF', 'armF', { angle: 0.3, length: 0.24, part: 'foreF', depth: 51 }),
    bone('handF', 'foreF', { part: 'handF', depth: 52 }),
    // Short arm, tucked, on the far side.
    bone('shoulderB', 'torso', { x: -0.02, y: -0.06, angle: Math.PI, depth: 20 }),
    bone('armB', 'shoulderB', { angle: 0.34, length: 0.18, part: 'armB', depth: 20 }),
    bone('foreB', 'armB', { angle: 0.5, length: 0.14, part: 'foreB', depth: 21 }),
    // Legs. Deliberately unequal: the near one is stiff and never bends much.
    bone('hipF', 'root', { x: 0.03, angle: Math.PI / 2, depth: 40 }),
    bone('thighF', 'hipF', { length: 0.22, part: 'thighF', depth: 40 }),
    bone('shinF', 'thighF', { length: 0.2, part: 'shinF', depth: 41 }),
    bone('footF', 'shinF', { part: 'footF', depth: 42 }),
    bone('hipB', 'root', { x: -0.03, angle: Math.PI / 2, depth: 10 }),
    bone('thighB', 'hipB', { length: 0.21, part: 'thighB', depth: 10 }),
    bone('shinB', 'thighB', { length: 0.19, part: 'shinB', depth: 11 }),
    bone('footB', 'shinB', { part: 'footB', depth: 12 })
  ]
  validateSkeleton(s, 'husk')
  return s
}

/**
 * THE DRAG-LIMP.
 *
 * A human walk alternates evenly. This does not: the far leg takes a proper
 * step and the near leg is dragged after it without ever leaving the ground,
 * so the body hitches once per cycle instead of twice. The long arm swings a
 * beat late and further than it should, and the head lolls on the hitch.
 */
const HUSK_WALK: Clip = {
  name: 'walk',
  duration: 900,
  loop: true,
  ease: 'sine',
  keys: [
    {
      t: 0,
      pose: {
        root: { y: 0.008 },
        torso: { angle: 0.06 },
        head: { angle: 0.18 },
        thighB: { angle: -0.5 },
        shinB: { angle: 0.2 },
        thighF: { angle: 0.22 },
        shinF: { angle: 0.06 },
        armF: { angle: 0.36 },
        foreF: { angle: 0.12 },
        armB: { angle: -0.1 }
      }
    },
    {
      // The hitch. Weight slams onto the far leg, the near leg scuffs through.
      t: 0.3,
      pose: {
        root: { y: 0.022 },
        torso: { angle: 0.16 },
        head: { angle: 0.34 },
        thighB: { angle: -0.06 },
        shinB: { angle: 0.44 },
        thighF: { angle: 0.3 },
        shinF: { angle: 0.02 },
        armF: { angle: 0.52 },
        foreF: { angle: 0.3 },
        armB: { angle: 0.06 }
      }
    },
    {
      t: 0.62,
      pose: {
        root: { y: -0.006 },
        torso: { angle: 0.02 },
        head: { angle: 0.1 },
        thighB: { angle: 0.34 },
        shinB: { angle: 0.1 },
        thighF: { angle: -0.14 },
        shinF: { angle: 0.16 },
        armF: { angle: -0.24 },
        foreF: { angle: 0.4 },
        armB: { angle: 0.3 }
      }
    },
    {
      // The drag: near foot never clears, so it scrapes forward flat.
      t: 0.84,
      pose: {
        root: { y: 0.004 },
        torso: { angle: 0.1 },
        head: { angle: 0.22 },
        thighB: { angle: 0.1 },
        shinB: { angle: 0.06 },
        thighF: { angle: -0.02 },
        shinF: { angle: 0.06 },
        armF: { angle: 0.06 },
        foreF: { angle: 0.24 },
        armB: { angle: 0.14 }
      }
    }
  ]
}

/**
 * The lunge. It does not swing an arm — it throws its whole upper body, jaw
 * first, and the arms trail behind the torso like something being flung.
 */
const HUSK_ATTACK: Clip = {
  name: 'attack',
  duration: 620,
  loop: false,
  ease: 'quad',
  keys: [
    {
      t: 0,
      pose: { torso: { angle: -0.24 }, head: { angle: -0.3 }, armF: { angle: -0.5 }, foreF: { angle: 0.2 } }
    },
    {
      // Wind: it rears back and the jaw opens.
      t: 0.26,
      pose: { torso: { angle: -0.46 }, head: { angle: -0.62 }, armF: { angle: -0.9 }, foreF: { angle: 0.1 }, root: { y: -0.01 } },
      ease: 'cubic'
    },
    {
      // Contact. Hard cut, no easing in — the body arrives all at once.
      t: 0.44,
      pose: { torso: { angle: 0.52 }, head: { angle: 0.66 }, armF: { angle: 0.7 }, foreF: { angle: 0.5 }, root: { y: 0.014 } },
      ease: 'hold'
    },
    {
      // Overshoot, then a slack recovery that does not quite return.
      t: 0.68,
      pose: { torso: { angle: 0.6 }, head: { angle: 0.5 }, armF: { angle: 0.42 }, foreF: { angle: 0.62 } },
      ease: 'back'
    },
    { t: 1, pose: { torso: { angle: -0.12 }, head: { angle: -0.1 }, armF: { angle: -0.3 }, foreF: { angle: 0.24 } } }
  ]
}

const HUSK_IDLE: Clip = {
  name: 'idle',
  duration: 3100,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { torso: { angle: 0.02 }, head: { angle: 0.2 }, armF: { angle: 0.1 }, foreF: { angle: 0.22 } } },
    // It sways. Nothing is holding it up properly.
    { t: 0.5, pose: { torso: { angle: 0.1 }, head: { angle: 0.34 }, armF: { angle: 0.02 }, foreF: { angle: 0.3 } } }
  ]
}

function huskParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  // Tier read off the bulk the escalation table wrote onto the visual, so a
  // Charnel Husk is drawn as a bigger, worse thing rather than a scaled sprite.
  const tier = Math.max(0, Math.min(3, Math.round(((v.bulk ?? 1) - 1) / 0.16)))
  const thick = art(0.055, height) * (1 + tier * 0.14)
  const parts: Record<string, PartArt> = {
    torso: huskTorso(height, k, tier),
    head: huskHead(height, k, tier),
    armF: meatLimb(art(0.26, height), thick * 1.1, k, 21, { hook: true }),
    foreF: meatLimb(art(0.24, height), thick * 0.9, k, 22, { hook: true }),
    handF: footClaw(Math.round(thick * 1.2), k, 23),
    armB: meatLimb(art(0.18, height), thick * 0.9, k, 24),
    foreB: meatLimb(art(0.14, height), thick * 0.75, k, 25),
    thighF: meatLeg(art(0.22, height), thick * 1.3, k, 26),
    shinF: meatLeg(art(0.2, height), thick * 1.05, k, 27),
    footF: footClaw(Math.round(thick * 1.4), k, 28),
    thighB: meatLeg(art(0.21, height), thick * 1.25, k, 29),
    shinB: meatLeg(art(0.19, height), thick * 1, k, 30),
    footB: footClaw(Math.round(thick * 1.3), k, 31)
  }
  return parts
}

// ───────────────────────────────── FLENSER ─────────────────────────────────

/**
 * THE FLENSER — a butcher with no neck and no need of one.
 *
 * Its silhouette is a wedge: enormous shoulders, forearms thicker than its
 * thighs, and a head sunk so far between them that from the front there is no
 * head at all. It carries a blade in each hand and the attack is a cross-cleave
 * — both arms sweeping through the same point from opposite sides — which is a
 * motion the footman rig cannot make because it only has one weapon hand.
 */
function flenserTorso(height: number, k: FleshKit): PartArt {
  const w = art(0.4, height)
  const h = art(0.42, height)
  const p = pad(w, h)
  const cx = p.w / 2
  // A wedge: wide at the shoulders, narrow at the hips.
  for (let y = 0; y < h; y += 1) {
    const t = y / h
    const wid = w * (0.98 - t * 0.44)
    for (let x = 0; x < wid; x += 1) {
      const px = Math.round(cx - wid / 2 + x)
      const s = x / wid
      p.set(px, 2 + y, k.hide[s < 0.16 ? 1 : s > 0.78 ? 3 : 2])
    }
  }
  fleshMass(p, cx - w * 0.22, p.h * 0.22, w * 0.26, h * 0.2, k.hide, 41, 4)
  fleshMass(p, cx + w * 0.24, p.h * 0.24, w * 0.24, h * 0.18, k.hide, 42, 4)
  // A leather apron of somebody's skin, stitched on.
  p.fill(cx - w * 0.26, p.h * 0.5, w * 0.52, h * 0.44, k.necrotic[2])
  p.fill(cx - w * 0.26, p.h * 0.5, w * 0.52, 1, k.necrotic[3])
  suture(p, cx - w * 0.26, p.h * 0.5, cx + w * 0.26, p.h * 0.5, k)
  for (let i = 0; i < 3; i += 1) pustule(p, cx - w * 0.18 + i * w * 0.18, p.h * 0.66 + (i % 2) * 3, 2, k)
  return { canvas: finish(p, k, 40), origin: [cx / p.w, (p.h - 2) / p.h] }
}

function flenserHead(height: number, k: FleshKit): PartArt {
  const r = art(0.075, height)
  const p = pad(r * 2 + 2, r * 2 + 2)
  const cx = p.w / 2
  const cy = p.h / 2
  // Almost all jaw. A hood of skin over the top, a maw underneath.
  p.ellipse(cx, cy - r * 0.2, r * 0.9, r * 0.7, k.hide[1])
  maw(p, cx + r * 0.1, cy + r * 0.34, r * 0.6, r * 0.4, k, 7, 44)
  eyeCluster(p, cx - r * 0.2, cy - r * 0.24, r * 0.3, k, 3, 45)
  return { canvas: finish(p, k, 43, 0.7), origin: [cx / p.w, (p.h - 2) / p.h] }
}

const FLENSER_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.4, depth: 30 }),
    bone('torso', 'root', { angle: -Math.PI / 2 + 0.2, length: 0.38, part: 'torso', orient: 'up', depth: 31, weights: { breathe: 1, lean: 1 } }),
    bone('neck', 'torso', { length: 0.02, angle: 0.3, depth: 34 }),
    bone('head', 'neck', { length: 0.075, part: 'head', orient: 'up', depth: 33, weights: { flinch: 1 } }),
    // Both arms are full weapon arms. This is the whole difference.
    bone('shoulderF', 'torso', { x: -0.03, y: 0.1, angle: Math.PI, depth: 50 }),
    bone('armF', 'shoulderF', { angle: -0.3, length: 0.18, part: 'armF', depth: 50 }),
    bone('foreF', 'armF', { angle: -0.5, length: 0.2, part: 'foreF', depth: 51 }),
    bone('bladeF', 'foreF', { angle: 0.2, part: 'bladeF', orient: 'right', depth: 53 }),
    bone('shoulderB', 'torso', { x: -0.03, y: -0.1, angle: Math.PI, depth: 20 }),
    bone('armB', 'shoulderB', { angle: 0.3, length: 0.17, part: 'armB', depth: 20 }),
    bone('foreB', 'armB', { angle: -0.4, length: 0.19, part: 'foreB', depth: 21 }),
    bone('bladeB', 'foreB', { angle: 0.2, part: 'bladeB', orient: 'right', depth: 19 }),
    bone('hipF', 'root', { x: 0.045, angle: Math.PI / 2, depth: 40 }),
    bone('thighF', 'hipF', { length: 0.19, part: 'thighF', depth: 40 }),
    bone('shinF', 'thighF', { length: 0.17, part: 'shinF', depth: 41 }),
    bone('footF', 'shinF', { part: 'footF', depth: 42 }),
    bone('hipB', 'root', { x: -0.045, angle: Math.PI / 2, depth: 10 }),
    bone('thighB', 'hipB', { length: 0.19, part: 'thighB', depth: 10 }),
    bone('shinB', 'thighB', { length: 0.17, part: 'shinB', depth: 11 }),
    bone('footB', 'shinB', { part: 'footB', depth: 12 })
  ]
  validateSkeleton(s, 'flenser')
  return s
}

/** A heavy waddle: short steps, huge shoulder roll, the mass leading. */
const FLENSER_WALK: Clip = {
  name: 'walk',
  duration: 780,
  loop: true,
  ease: 'sine',
  keys: [
    {
      t: 0,
      pose: {
        root: { y: 0.01 },
        torso: { angle: 0.1 },
        thighB: { angle: -0.3 },
        shinB: { angle: 0.2 },
        thighF: { angle: 0.26 },
        shinF: { angle: 0.24 },
        armF: { angle: 0.2 },
        armB: { angle: -0.2 }
      }
    },
    {
      t: 0.25,
      pose: {
        root: { y: -0.014 },
        torso: { angle: 0.02 },
        thighB: { angle: 0.02 },
        shinB: { angle: 0.5 },
        thighF: { angle: 0.02 },
        shinF: { angle: 0.06 },
        armF: { angle: 0.34 },
        armB: { angle: -0.06 }
      }
    },
    {
      t: 0.5,
      pose: {
        root: { y: 0.01 },
        torso: { angle: 0.1 },
        thighB: { angle: 0.26 },
        shinB: { angle: 0.24 },
        thighF: { angle: -0.3 },
        shinF: { angle: 0.2 },
        armF: { angle: -0.2 },
        armB: { angle: 0.2 }
      }
    },
    {
      t: 0.75,
      pose: {
        root: { y: -0.014 },
        torso: { angle: 0.02 },
        thighB: { angle: 0.02 },
        shinB: { angle: 0.06 },
        thighF: { angle: 0.02 },
        shinF: { angle: 0.5 },
        armF: { angle: -0.06 },
        armB: { angle: 0.34 }
      }
    }
  ]
}

/** THE CROSS-CLEAVE. Both blades through the same point, from opposite sides. */
const FLENSER_ATTACK: Clip = {
  name: 'attack',
  duration: 760,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { armF: { angle: -0.4 }, foreF: { angle: -0.4 }, armB: { angle: 0.3 }, foreB: { angle: -0.3 }, torso: { angle: 0 } } },
    {
      // Wind: arms thrown wide, torso twisted back. The pose is a held X.
      t: 0.28,
      pose: {
        armF: { angle: -1.5 },
        foreF: { angle: -0.9 },
        armB: { angle: 1.2 },
        foreB: { angle: -0.7 },
        torso: { angle: -0.2 }
      },
      ease: 'cubic'
    },
    {
      // First blade through, hard.
      t: 0.44,
      pose: { armF: { angle: 1.1 }, foreF: { angle: 0.5 }, armB: { angle: 1 }, foreB: { angle: -0.6 }, torso: { angle: 0.2 } },
      ease: 'hold'
    },
    {
      // Second blade through the other way, half a beat later.
      t: 0.6,
      pose: { armF: { angle: 0.9 }, foreF: { angle: 0.6 }, armB: { angle: -1.2 }, foreB: { angle: 0.5 }, torso: { angle: 0.28 } },
      ease: 'hold'
    },
    { t: 0.8, pose: { armF: { angle: 0.2 }, foreF: { angle: 0.1 }, armB: { angle: -0.4 }, foreB: { angle: 0.2 }, torso: { angle: 0.1 } }, ease: 'back' },
    { t: 1, pose: { armF: { angle: -0.3 }, foreF: { angle: -0.3 }, armB: { angle: 0.2 }, foreB: { angle: -0.2 }, torso: { angle: 0 } } }
  ]
}

const FLENSER_IDLE: Clip = {
  name: 'idle',
  duration: 2400,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { armF: { angle: -0.24 }, armB: { angle: 0.2 }, torso: { angle: 0.02 } } },
    { t: 0.5, pose: { armF: { angle: -0.14 }, armB: { angle: 0.3 }, torso: { angle: 0.08 } } }
  ]
}

/** A cleaver of bone and salvaged iron. Authored pointing RIGHT. */
function cleaver(len: number, k: FleshKit, dark = false): PartArt {
  const p = pad(len + 2, Math.round(len * 0.5) + 2)
  const cy = p.h / 2
  const shade = dark ? 1 : 2
  // A wide flat blade with a hooked heel.
  for (let i = 0; i < len; i += 1) {
    const t = i / len
    const h = Math.max(1, Math.round(len * (0.1 + t * 0.32)))
    for (let o = 0; o < h; o += 1) {
      p.set(2 + i, Math.round(cy - h / 2 + o), o === 0 ? k.iron[shade + 2] : k.iron[shade])
    }
  }
  p.fill(2, cy - 1, Math.round(len * 0.24), 2, k.gristle[2])
  // Notched edge: it has been used on bone.
  for (let i = 4; i < len; i += 3) p.set(2 + i, Math.round(cy + len * (0.05 + (i / len) * 0.16)), 0, 0)
  return { canvas: p.toCanvas() as Canvas2D, origin: [2 / p.w, cy / p.h] }
}

function flenserParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const thick = art(0.075, height)
  return {
    torso: flenserTorso(height, k),
    head: flenserHead(height, k),
    armF: meatLimb(art(0.18, height), thick * 1.3, k, 46),
    foreF: meatLimb(art(0.2, height), thick * 1.5, k, 47),
    bladeF: cleaver(art(0.3, height), k),
    armB: meatLimb(art(0.17, height), thick * 1.2, k, 49),
    foreB: meatLimb(art(0.19, height), thick * 1.4, k, 50),
    bladeB: cleaver(art(0.28, height), k, true),
    thighF: meatLeg(art(0.19, height), thick * 1.4, k, 52),
    shinF: meatLeg(art(0.17, height), thick * 1.15, k, 53),
    footF: footClaw(Math.round(thick * 1.5), k, 54),
    thighB: meatLeg(art(0.19, height), thick * 1.35, k, 55),
    shinB: meatLeg(art(0.17, height), thick * 1.1, k, 56),
    footB: footClaw(Math.round(thick * 1.4), k, 57)
  }
}

// ────────────────────────────────── SHRIKE ──────────────────────────────────

/**
 * THE SHRIKE — a stalker with no arms and four tentacles.
 *
 * Tall, thin and wrong: the legs are longer than the body, the shoulders are a
 * bare girdle of bone with four boneless limbs hanging off it, and the head is
 * a beak with no eyes. It reaches over the man in front and stabs, which is why
 * the tentacles are rigged as four independent chains that fire in sequence
 * rather than as a pair of arms that swing together.
 */
function shrikeTorso(height: number, k: FleshKit): PartArt {
  const w = art(0.2, height)
  const h = art(0.4, height)
  const p = pad(w, h)
  const cx = p.w / 2
  // A narrow ribbed column — barely a body, mostly a mounting point.
  for (let y = 0; y < h; y += 1) {
    const t = y / h
    const wid = w * (0.5 + Math.sin(t * Math.PI) * 0.5)
    for (let x = 0; x < wid; x += 1) {
      const s = x / wid
      p.set(Math.round(cx - wid / 2 + x), 2 + y, k.hide[s < 0.2 ? 1 : s > 0.76 ? 3 : 2])
    }
  }
  ribCage(p, cx - w * 0.26, p.h * 0.32, w * 0.56, h * 0.38, k, 4, 1)
  spine(p, cx - w * 0.2, p.h * 0.1, cx - w * 0.16, p.h * 0.9, k, 8)
  // The girdle the tentacles hang from: a hoop of bone at the shoulders.
  p.ellipseFrame(cx, p.h * 0.16, w * 0.46, h * 0.06, k.bone[3])
  viscera(p, cx, p.h * 0.9, Math.round(h * 0.16), k, 61)
  return { canvas: finish(p, k, 60), origin: [cx / p.w, (p.h - 2) / p.h] }
}

function shrikeHead(height: number, k: FleshKit): PartArt {
  const r = art(0.085, height)
  const p = pad(r * 3, r * 2 + 2)
  const cx = p.w * 0.42
  const cy = p.h / 2
  // A blind wedge with a long beak. No eyes at all.
  p.ellipse(cx, cy, r * 0.7, r * 0.8, k.hide[2])
  for (let i = 0; i < r * 1.7; i += 1) {
    const t = i / (r * 1.7)
    const hh = Math.max(1, Math.round(r * 0.5 * (1 - t)))
    for (let o = 0; o < hh; o += 1) p.set(Math.round(cx + r * 0.5 + i), Math.round(cy - hh / 2 + o + t * r * 0.3), k.bone[o === 0 ? 4 : 2])
  }
  // Sensory pits where the eyes should be.
  p.ellipse(cx - r * 0.1, cy - r * 0.3, 1.4, 1.2, k.cavity[0])
  p.ellipse(cx - r * 0.1, cy + r * 0.1, 1.4, 1.2, k.cavity[0])
  return { canvas: finish(p, k, 62, 0.8), origin: [cx / p.w, (p.h - 2) / p.h] }
}

function tentaclePart(len: number, thick: number, k: FleshKit, seed: number): PartArt {
  // Drawn long so consecutive segments overlap, and thick enough to read as a
  // limb rather than a wire — the first pass was two pixels wide and vanished.
  const draw = Math.round(len * 1.2)
  const p = pad(Math.round(thick * 4), draw + 6)
  const cx = p.w / 2
  tentacleLimb(p, cx, 2, draw, Math.max(3, thick), k, seed)
  blemish(p, k, seed, 0.02)
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 2 / p.h] }
}

const SHRIKE_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.56, depth: 30 }),
    bone('torso', 'root', { angle: -Math.PI / 2 + 0.12, length: 0.36, part: 'torso', orient: 'up', depth: 31, weights: { breathe: 1, lean: 1 } }),
    bone('neck', 'torso', { length: 0.05, angle: 0.34, depth: 34 }),
    bone('head', 'neck', { length: 0.085, part: 'head', orient: 'up', depth: 35, weights: { aim: 0.4, flinch: 1 } }),
    // Four tentacles, two per side, each its own chain so they can fire in
    // sequence. This is the reason the plan exists.
    bone('t1', 'torso', { x: -0.02, y: 0.1, angle: Math.PI - 0.3, length: 0.2, part: 't1', depth: 52, weights: { aim: 0.9 } }),
    bone('t1b', 't1', { angle: 0.4, length: 0.16, part: 't1b', depth: 53, weights: { aim: 0.7 } }),
    bone('t2', 'torso', { x: -0.06, y: 0.055, angle: Math.PI - 0.05, length: 0.19, part: 't2', depth: 50, weights: { aim: 0.8 } }),
    bone('t2b', 't2', { angle: 0.5, length: 0.15, part: 't2b', depth: 51, weights: { aim: 0.6 } }),
    bone('t3', 'torso', { x: -0.02, y: -0.09, angle: Math.PI + 0.25, length: 0.18, part: 't3', depth: 20, weights: { aim: 0.7 } }),
    bone('t3b', 't3', { angle: 0.45, length: 0.14, part: 't3b', depth: 21, weights: { aim: 0.5 } }),
    bone('t4', 'torso', { x: -0.07, y: -0.05, angle: Math.PI + 0.5, length: 0.16, part: 't4', depth: 18, weights: { aim: 0.6 } }),
    bone('t4b', 't4', { angle: 0.5, length: 0.13, part: 't4b', depth: 19 }),
    // Long thin digitigrade legs — knee backwards, like a bird's.
    bone('hipF', 'root', { x: 0.025, angle: Math.PI / 2, depth: 40 }),
    bone('thighF', 'hipF', { length: 0.26, part: 'thighF', depth: 40 }),
    bone('shinF', 'thighF', { angle: -0.5, length: 0.24, part: 'shinF', depth: 41 }),
    bone('footF', 'shinF', { angle: 0.5, part: 'footF', depth: 42 }),
    bone('hipB', 'root', { x: -0.025, angle: Math.PI / 2, depth: 10 }),
    bone('thighB', 'hipB', { length: 0.26, part: 'thighB', depth: 10 }),
    bone('shinB', 'thighB', { angle: -0.5, length: 0.24, part: 'shinB', depth: 11 }),
    bone('footB', 'shinB', { angle: 0.5, part: 'footB', depth: 12 })
  ]
  validateSkeleton(s, 'shrike')
  return s
}

/** A high-stepping stalk. The knees come up much further than a man's. */
const SHRIKE_WALK: Clip = {
  name: 'walk',
  duration: 820,
  loop: true,
  ease: 'sine',
  keys: [
    {
      t: 0,
      pose: {
        root: { y: 0.006 },
        thighB: { angle: -0.6 },
        shinB: { angle: -0.2 },
        footB: { angle: 0.3 },
        thighF: { angle: 0.5 },
        shinF: { angle: -0.7 },
        footF: { angle: 0.4 },
        t1: { angle: 0.2 },
        t2: { angle: -0.15 },
        t3: { angle: 0.18 },
        t4: { angle: -0.1 }
      }
    },
    {
      t: 0.25,
      pose: {
        root: { y: -0.02 },
        thighB: { angle: -0.1 },
        shinB: { angle: -0.1 },
        thighF: { angle: -0.3 },
        shinF: { angle: -1.2 },
        footF: { angle: 0.7 },
        t1: { angle: -0.1 },
        t2: { angle: 0.2 },
        t3: { angle: -0.12 },
        t4: { angle: 0.16 }
      }
    },
    {
      t: 0.5,
      pose: {
        root: { y: 0.006 },
        thighB: { angle: 0.5 },
        shinB: { angle: -0.7 },
        footB: { angle: 0.4 },
        thighF: { angle: -0.6 },
        shinF: { angle: -0.2 },
        footF: { angle: 0.3 },
        t1: { angle: -0.18 },
        t2: { angle: 0.15 },
        t3: { angle: -0.2 },
        t4: { angle: 0.12 }
      }
    },
    {
      t: 0.75,
      pose: {
        root: { y: -0.02 },
        thighB: { angle: -0.3 },
        shinB: { angle: -1.2 },
        footB: { angle: 0.7 },
        thighF: { angle: -0.1 },
        shinF: { angle: -0.1 },
        t1: { angle: 0.16 },
        t2: { angle: -0.18 },
        t3: { angle: 0.14 },
        t4: { angle: -0.14 }
      }
    }
  ]
}

/**
 * FOUR STABS, NOT ONE SWING.
 *
 * The tentacles coil back together and then fire one at a time on consecutive
 * beats, each snapping straight and holding for a frame at full extension. That
 * staggered rhythm is the whole read: it does not hit you once, it hits you
 * four times in under a second and the last one takes the head.
 */
const SHRIKE_ATTACK: Clip = {
  name: 'attack',
  duration: 720,
  loop: false,
  ease: 'quad',
  keys: [
    {
      t: 0,
      pose: { t1: { angle: 0.4 }, t1b: { angle: 0.6 }, t2: { angle: 0.4 }, t2b: { angle: 0.6 }, t3: { angle: 0.4 }, t3b: { angle: 0.6 }, t4: { angle: 0.4 }, t4b: { angle: 0.6 } }
    },
    {
      // Coil. Everything pulls back at once — the only moment they agree.
      t: 0.2,
      pose: {
        torso: { angle: -0.12 },
        t1: { angle: 1 }, t1b: { angle: 1.1 },
        t2: { angle: 1 }, t2b: { angle: 1.1 },
        t3: { angle: 1 }, t3b: { angle: 1.1 },
        t4: { angle: 1 }, t4b: { angle: 1.1 }
      },
      ease: 'cubic'
    },
    {
      t: 0.36,
      pose: { torso: { angle: 0.06 }, t1: { angle: -1.3 }, t1b: { angle: -0.5 }, t2: { angle: 0.9 }, t2b: { angle: 1 }, t3: { angle: 0.9 }, t3b: { angle: 1 }, t4: { angle: 0.9 }, t4b: { angle: 1 } },
      ease: 'hold'
    },
    {
      t: 0.52,
      pose: { torso: { angle: 0.1 }, t1: { angle: -0.6 }, t1b: { angle: 0.1 }, t2: { angle: -1.35 }, t2b: { angle: -0.5 }, t3: { angle: 0.9 }, t3b: { angle: 1 }, t4: { angle: 0.9 }, t4b: { angle: 1 } },
      ease: 'hold'
    },
    {
      t: 0.68,
      pose: { torso: { angle: 0.12 }, t1: { angle: 0 }, t1b: { angle: 0.4 }, t2: { angle: -0.6 }, t2b: { angle: 0.1 }, t3: { angle: -1.3 }, t3b: { angle: -0.45 }, t4: { angle: 0.9 }, t4b: { angle: 1 } },
      ease: 'hold'
    },
    {
      t: 0.84,
      pose: { torso: { angle: 0.14 }, t1: { angle: 0.3 }, t1b: { angle: 0.5 }, t2: { angle: 0 }, t2b: { angle: 0.4 }, t3: { angle: -0.6 }, t3b: { angle: 0.1 }, t4: { angle: -1.25 }, t4b: { angle: -0.4 } },
      ease: 'hold'
    },
    {
      t: 1,
      pose: { torso: { angle: 0 }, t1: { angle: 0.4 }, t1b: { angle: 0.6 }, t2: { angle: 0.4 }, t2b: { angle: 0.6 }, t3: { angle: 0.4 }, t3b: { angle: 0.6 }, t4: { angle: 0.4 }, t4b: { angle: 0.6 } },
      ease: 'back'
    }
  ]
}

/** Idle: the tentacles drift independently, never in phase. */
const SHRIKE_IDLE: Clip = {
  name: 'idle',
  duration: 3400,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { t1: { angle: 0.3 }, t2: { angle: 0.5 }, t3: { angle: 0.2 }, t4: { angle: 0.6 }, head: { angle: 0.04 } } },
    { t: 0.33, pose: { t1: { angle: 0.55 }, t2: { angle: 0.25 }, t3: { angle: 0.5 }, t4: { angle: 0.3 }, head: { angle: -0.06 } } },
    { t: 0.66, pose: { t1: { angle: 0.2 }, t2: { angle: 0.6 }, t3: { angle: 0.3 }, t4: { angle: 0.55 }, head: { angle: 0.08 } } }
  ]
}

function shrikeParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const thin = art(0.04, height)
  const tt = Math.max(4, art(0.055, height))
  return {
    torso: shrikeTorso(height, k),
    head: shrikeHead(height, k),
    t1: tentaclePart(art(0.2, height), tt, k, 70),
    t1b: tentaclePart(art(0.16, height), tt * 0.8, k, 71),
    t2: tentaclePart(art(0.19, height), tt, k, 72),
    t2b: tentaclePart(art(0.15, height), tt * 0.8, k, 73),
    t3: tentaclePart(art(0.18, height), tt * 0.9, k, 74),
    t3b: tentaclePart(art(0.14, height), tt * 0.7, k, 75),
    t4: tentaclePart(art(0.16, height), tt * 0.9, k, 76),
    t4b: tentaclePart(art(0.13, height), tt * 0.7, k, 77),
    thighF: meatLeg(art(0.26, height), thin * 1.1, k, 78),
    shinF: meatLeg(art(0.24, height), thin * 0.85, k, 79),
    footF: footClaw(Math.round(thin * 1.6), k, 80),
    thighB: meatLeg(art(0.26, height), thin * 1.05, k, 81),
    shinB: meatLeg(art(0.24, height), thin * 0.8, k, 82),
    footB: footClaw(Math.round(thin * 1.5), k, 83)
  }
}

// ─────────────────────────────── Registration ───────────────────────────────

interface PlanSpec {
  skeleton: () => Skeleton
  parts: (v: UnitVisual, height: number) => Record<string, PartArt>
  clips: Record<ClipName, Clip>
  muzzle: [number, number]
}

const PLANS: Partial<Record<CarnagePlan, PlanSpec>> = {
  husk: { skeleton: HUSK_SKELETON, parts: huskParts, clips: { idle: HUSK_IDLE, walk: HUSK_WALK, attack: HUSK_ATTACK }, muzzle: [0.24, -0.5] },
  flenser: { skeleton: FLENSER_SKELETON, parts: flenserParts, clips: { idle: FLENSER_IDLE, walk: FLENSER_WALK, attack: FLENSER_ATTACK }, muzzle: [0.3, -0.52] },
  shrike: { skeleton: SHRIKE_SKELETON, parts: shrikeParts, clips: { idle: SHRIKE_IDLE, walk: SHRIKE_WALK, attack: SHRIKE_ATTACK }, muzzle: [0.34, -0.62] },
  // The Butcher is a Flenser that got what it wanted: same plan, heavier kit.
  butcher: { skeleton: FLENSER_SKELETON, parts: flenserParts, clips: { idle: FLENSER_IDLE, walk: FLENSER_WALK, attack: FLENSER_ATTACK }, muzzle: [0.3, -0.52] },
  // The gatherers are Husks that were never issued a purpose.
  bonewright: { skeleton: HUSK_SKELETON, parts: huskParts, clips: { idle: HUSK_IDLE, walk: HUSK_WALK, attack: HUSK_ATTACK }, muzzle: [0.2, -0.44] },
  boneling: { skeleton: HUSK_SKELETON, parts: huskParts, clips: { idle: HUSK_IDLE, walk: HUSK_WALK, attack: HUSK_ATTACK }, muzzle: [0.2, -0.46] }
}

export const CARNAGE_FOOT_PLANS = Object.keys(PLANS) as CarnagePlan[]

export const carnageFootArchetype: Archetype = {
  id: 'carnage-foot',
  claims: v => v.plan !== undefined && PLANS[v.plan as CarnagePlan] !== undefined,
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const spec = PLANS[v.plan as CarnagePlan]
    if (!spec) throw new Error(`no carnage foot plan for ${String(v.plan)}`)
    return {
      skeleton: spec.skeleton(),
      parts: spec.parts(v, height),
      clips: spec.clips,
      height,
      muzzle: spec.muzzle
    }
  }
}
