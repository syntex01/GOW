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
  viscera,
  wet,
  type FleshKit
} from '../flesh'
import type { Archetype, ArchetypeBuild, ClipName, PartArt } from './types'

/**
 * THE CARNAGE HORRORS — the bodies that are not bipeds at all.
 *
 * The bipeds in `carnageFoot.ts` are still recognisably built from a person.
 * These are not. Each one is a different answer to "what if you stopped
 * pretending a soldier has to have a head at one end and legs at the other":
 *
 *   MONSTRUM   a mass on many small legs, mouth on top, that grows as it eats
 *   MAW        almost entirely jaws, with a body as an afterthought behind them
 *   FLESHWALL  architecture. No legs. It breathes and it inches
 *   RIPJAW     a quadruped built to leave the ground
 *   WAGON      a cart of viscera, hauled by things in harness
 *   WIDOW      a ribcage that learned to fly
 *   MOUND      a blistered heap with no head that gets about by rolling
 *   FLAYER     a robe with nothing under it and a curtain where a face was
 *
 * They share the flesh vocabulary and nothing else — no common skeleton, no
 * shared clip, and in three cases no legs in the usual sense. What holds them
 * together as one army is the material, which is the right thing to share.
 */

export type HorrorPlan =
  | 'monstrum'
  | 'maw'
  | 'fleshwall'
  | 'ripjaw'
  | 'wagon'
  | 'widow'
  | 'brainstealer'
  | 'mindflayer'
  | 'skinrider'
  | 'charnelengine'
  | 'widowqueen'
  | 'incarnation'

const art = (fraction: number, height: number): number => Math.max(1, Math.round(fraction * height * RES))

function pad(w: number, h: number): Pix {
  return new Pix(Math.max(2, Math.round(w) + 4), Math.max(2, Math.round(h) + 4))
}

function finish(p: Pix, k: FleshKit, seed: number, sheen = 1): Canvas2D {
  wet(p, seed, sheen)
  blemish(p, k, seed)
  rimFlesh(p, k)
  return p.toCanvas() as Canvas2D
}

/**
 * The same pass for a SMALL part. `wet` lights the top of every column and
 * `blemish` scatters a stray pixel every thirty, which on a canvas under about
 * twenty pixels tall stops being texture and becomes damage — it eats the
 * silhouette the shape was carrying. So small parts get the rim and nothing else.
 */
function finishSmall(p: Pix, k: FleshKit, seed: number): Canvas2D {
  wet(p, seed, 0.35)
  rimFlesh(p, k)
  return p.toCanvas() as Canvas2D
}

/** A soft segment with no outline — for anything inside a silhouette. */
function softLimb(len: number, thick: number, k: FleshKit, seed: number, ramp = k.hide): PartArt {
  const draw = Math.round(len * 1.2)
  const p = pad(thick * 2.2, draw)
  const cx = p.w / 2
  const noise = pixelNoise(seed * 977 + 5)
  for (let i = 0; i < draw; i += 1) {
    const t = i / Math.max(1, draw - 1)
    const wid = Math.max(1, Math.round(thick * (1.05 - t * 0.5) * (0.94 + noise(i, 3) * 0.14)))
    for (let o = 0; o < wid; o += 1) {
      const s = wid <= 1 ? 0.6 : o / (wid - 1)
      const shade = s < 0.14 ? 0 : s < 0.34 ? 1 : s < 0.68 ? 2 : s < 0.88 ? 3 : 2
      p.set(Math.round(cx - wid / 2 + o), 2 + i, ramp[shade])
    }
  }
  p.ellipse(cx, 3, thick * 0.5, thick * 0.42, k.bone[2])
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 2 / p.h] }
}

// ──────────────────────────────── MONSTRUM ────────────────────────────────

/**
 * THE MONSTRUM — a stomach that grew legs.
 *
 * Its whole silhouette is one enormous sagging mass with a feeding mouth on TOP
 * of it, carried on six small mismatched legs that are far too short for what
 * they are holding up. The read is meant to be "that should not be able to
 * move", and then it does, in a centipede ripple where the legs fire in a wave
 * along the body instead of alternating in pairs.
 *
 * It eats and it KEEPS what it eats, so the mass is drawn with growth rings and
 * half-digested things pressing out from inside it.
 */
function monstrumBody(height: number, k: FleshKit): PartArt {
  const w = art(0.86, height)
  const h = art(0.56, height)
  const p = pad(w, h)
  const cx = p.w / 2
  const cy = p.h * 0.56
  // A sagging bag, wider at the bottom than the top — it is full.
  fleshMass(p, cx, cy, w * 0.48, h * 0.44, k.hide, 3, 7)
  fleshMass(p, cx - w * 0.1, cy + h * 0.16, w * 0.4, h * 0.3, k.fat, 5, 5)
  // Growth rings: seams where it has swollen past its own skin.
  for (let i = 0; i < 4; i += 1) {
    const t = 0.24 + i * 0.16
    suture(p, cx - w * 0.4, cy - h * 0.3 + h * t * 0.8, cx + w * 0.38, cy - h * 0.24 + h * t * 0.8, k)
  }
  // Things pressing out from inside: a hand, a ribcage, a face.
  ribCage(p, cx + w * 0.16, cy - h * 0.16, w * 0.24, h * 0.26, k, 3, 1)
  for (let i = 0; i < 5; i += 1) {
    pustule(p, cx - w * 0.34 + i * w * 0.14, cy + h * 0.26 + (i % 2) * 4, 2.4 + (i % 3), k)
  }
  boneSpur(p, cx - w * 0.42, cy - h * 0.1, art(0.09, height), -2.5, k)
  boneSpur(p, cx + w * 0.44, cy, art(0.07, height), -0.6, k)
  // THE FEEDING MOUTH, on the top surface where a back should be.
  maw(p, cx + w * 0.04, cy - h * 0.38, w * 0.2, h * 0.13, k, 11, 9)
  eyeCluster(p, cx + w * 0.3, cy - h * 0.3, w * 0.08, k, 5, 13)
  viscera(p, cx - w * 0.2, cy + h * 0.42, art(0.1, height), k, 17)
  viscera(p, cx + w * 0.22, cy + h * 0.4, art(0.08, height), k, 19)
  return { canvas: finish(p, k, 3), origin: [cx / p.w, (cy + h * 0.44) / p.h] }
}

const MONSTRUM_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.2, depth: 30 }),
    bone('body', 'root', { angle: -Math.PI / 2, length: 0.3, part: 'body', orient: 'up', depth: 31, weights: { breathe: 1, lean: 0.6 } })
  ]
  // SIX LEGS, front to back, each on its own beat. Three per side, mismatched
  // lengths so the wave never looks like a machine.
  const at = [-0.3, -0.12, 0.06, 0.24, 0.4, -0.42]
  at.forEach((x, i) => {
    const back = i % 2 === 1
    s.push(bone(`hip${i}`, 'root', { x, y: back ? -0.02 : 0.02, angle: Math.PI / 2, depth: back ? 8 : 44 }))
    s.push(bone(`thigh${i}`, `hip${i}`, { length: 0.11 + (i % 3) * 0.012, part: `thigh${i}`, depth: back ? 8 : 44 }))
    s.push(bone(`shin${i}`, `thigh${i}`, { angle: 0.5, length: 0.1, part: `shin${i}`, depth: back ? 9 : 45 }))
    s.push(bone(`foot${i}`, `shin${i}`, { angle: -0.5, part: `foot${i}`, depth: back ? 10 : 46 }))
  })
  validateSkeleton(s, 'monstrum')
  return s
}

/** The ripple: each leg fires a sixth of a cycle after the one in front. */
function rippleWalk(legs: number, duration: number): Clip {
  const keys = []
  const steps = 6
  for (let s = 0; s < steps; s += 1) {
    const pose: Record<string, { angle?: number; y?: number }> = {
      body: { angle: Math.sin((s / steps) * Math.PI * 2) * 0.05 },
      root: { y: Math.abs(Math.sin((s / steps) * Math.PI * 2)) * -0.008 }
    }
    for (let i = 0; i < legs; i += 1) {
      // Phase offset per leg: the wave travels along the body.
      const ph = ((s / steps) - i / legs + 1) % 1
      pose[`thigh${i}`] = { angle: Math.sin(ph * Math.PI * 2) * 0.5 }
      pose[`shin${i}`] = { angle: 0.4 + Math.max(0, Math.cos(ph * Math.PI * 2)) * 0.6 }
    }
    keys.push({ t: s / steps, pose })
  }
  return { name: 'walk', duration, loop: true, ease: 'sine', keys }
}

/** It does not swing anything. It falls on you and the mouth does the work. */
const MONSTRUM_ATTACK: Clip = {
  name: 'attack',
  duration: 900,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { body: { angle: 0 }, root: { y: 0 } } },
    // It rears — the whole mass lifts off the front legs.
    { t: 0.3, pose: { body: { angle: -0.3, stretch: 1.08 }, root: { y: -0.05 }, thigh0: { angle: -0.7 }, thigh2: { angle: -0.5 } }, ease: 'cubic' },
    // And drops. Hard cut.
    { t: 0.46, pose: { body: { angle: 0.34, stretch: 0.94 }, root: { y: 0.03 }, thigh0: { angle: 0.6 }, thigh2: { angle: 0.4 } }, ease: 'hold' },
    { t: 0.7, pose: { body: { angle: 0.16, stretch: 1.02 }, root: { y: 0 } }, ease: 'back' },
    { t: 1, pose: { body: { angle: 0 }, root: { y: 0 } } }
  ]
}

/** Idle: it is digesting. The mass swells and settles, the legs shuffle. */
const MONSTRUM_IDLE: Clip = {
  name: 'idle',
  duration: 3800,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { body: { stretch: 1 }, root: { y: 0 } } },
    { t: 0.45, pose: { body: { stretch: 1.05 }, root: { y: -0.008 } } },
    { t: 0.7, pose: { body: { stretch: 0.98 }, root: { y: 0.004 } } }
  ]
}

function monstrumParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const parts: Record<string, PartArt> = { body: monstrumBody(height, k) }
  for (let i = 0; i < 6; i += 1) {
    const back = i % 2 === 1
    const r = back ? k.necrotic : k.hide
    parts[`thigh${i}`] = softLimb(art(0.11, height), art(0.045, height), k, 20 + i, r)
    parts[`shin${i}`] = softLimb(art(0.1, height), art(0.035, height), k, 30 + i, r)
    parts[`foot${i}`] = hoofPart(art(0.035, height), k, 40 + i)
  }
  return parts
}

function hoofPart(size: number, k: FleshKit, seed: number): PartArt {
  const p = pad(size * 3, size * 2)
  const cx = p.w / 2
  p.ellipse(cx, 3, size * 0.8, size * 0.6, k.hide[1])
  claw(p, cx, 3, size * 1.3, k)
  blemish(p, k, seed, 0.02)
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 2 / p.h] }
}

// ─────────────────────────────────── MAW ───────────────────────────────────

/**
 * THE GREAT MAW — a mouth that grew a body to carry it.
 *
 * Two enormous mandibles hinged at the front, taking up two thirds of the
 * silhouette, with a stunted torso behind them and two legs underneath doing
 * their best. The attack is a LUNGE-BITE: the jaws snap forward PAST the body,
 * which is only possible because they are rigged ahead of the root rather than
 * on a head at the end of a neck.
 */
function mawJaw(height: number, k: FleshKit, upper: boolean): PartArt {
  const len = art(0.44, height)
  const h = art(0.16, height)
  const p = pad(len, h)
  const cy = upper ? p.h - 3 : 3
  // A tapering blade of jaw, thicker at the hinge.
  for (let i = 0; i < len; i += 1) {
    const t = i / len
    const th = Math.max(2, Math.round(h * (0.9 - t * 0.55)))
    for (let o = 0; o < th; o += 1) {
      const y = upper ? cy - o : cy + o
      const s = o / Math.max(1, th - 1)
      p.set(2 + i, y, k.hide[s < 0.2 ? 1 : s > 0.72 ? 3 : 2])
    }
  }
  // Teeth along the biting edge, angled back so nothing gets out.
  for (let i = 3; i < len - 2; i += Math.max(3, Math.round(h * 0.4))) {
    const t = i / len
    const tl = Math.max(2, Math.round(h * (0.5 - t * 0.25)))
    for (let j = 0; j < tl; j += 1) {
      const y = upper ? cy + j : cy - j
      p.set(2 + i - Math.round(j * 0.4), y, k.bone[j === 0 ? 2 : 4])
    }
  }
  // Gum line and the hinge knuckle.
  p.ellipse(3, cy + (upper ? -h * 0.3 : h * 0.3), h * 0.34, h * 0.3, k.necrotic[1])
  return { canvas: finish(p, k, upper ? 51 : 52, 0.8), origin: [3 / p.w, cy / p.h] }
}

function mawBody(height: number, k: FleshKit): PartArt {
  const w = art(0.34, height)
  const h = art(0.4, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.5, w * 0.44, h * 0.44, k.hide, 61, 5)
  ribCage(p, cx - w * 0.1, p.h * 0.28, w * 0.4, h * 0.34, k, 3, 1)
  spine(p, cx - w * 0.3, p.h * 0.2, cx - w * 0.24, p.h * 0.8, k, 7)
  // A gullet: a second throat behind the jaws, so the bite goes somewhere.
  maw(p, cx + w * 0.26, p.h * 0.42, w * 0.14, h * 0.1, k, 7, 63)
  viscera(p, cx, p.h * 0.86, art(0.09, height), k, 65)
  return { canvas: finish(p, k, 60), origin: [cx / p.w, (p.h - 2) / p.h] }
}

const MAW_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.28, depth: 30 }),
    bone('body', 'root', { angle: -Math.PI / 2 + 0.4, length: 0.26, part: 'body', orient: 'up', depth: 20, weights: { breathe: 1, lean: 0.8 } }),
    // The jaw hinge sits FORWARD of the body, at the front of the silhouette.
    bone('hinge', 'body', { x: -0.04, y: 0.12, depth: 50 }),
    bone('jawUpper', 'hinge', { angle: -0.34, part: 'jawUpper', orient: 'right', depth: 52, weights: { aim: 0.5 } }),
    bone('jawLower', 'hinge', { angle: 0.4, part: 'jawLower', orient: 'right', depth: 51, weights: { aim: 0.5 } }),
    bone('hipF', 'root', { x: 0.03, angle: Math.PI / 2, depth: 44 }),
    bone('thighF', 'hipF', { length: 0.15, part: 'thighF', depth: 44 }),
    bone('shinF', 'thighF', { angle: 0.55, length: 0.14, part: 'shinF', depth: 45 }),
    bone('footF', 'shinF', { angle: -0.55, part: 'footF', depth: 46 }),
    bone('hipB', 'root', { x: -0.04, angle: Math.PI / 2, depth: 8 }),
    bone('thighB', 'hipB', { length: 0.15, part: 'thighB', depth: 8 }),
    bone('shinB', 'thighB', { angle: 0.55, length: 0.14, part: 'shinB', depth: 9 }),
    bone('footB', 'shinB', { angle: -0.55, part: 'footB', depth: 10 })
  ]
  validateSkeleton(s, 'maw')
  return s
}

/** A heavy two-beat plod, the jaws swinging loose because nothing holds them. */
const MAW_WALK: Clip = {
  name: 'walk',
  duration: 950,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { root: { y: 0.012 }, body: { angle: 0.06 }, thighB: { angle: -0.4 }, shinB: { angle: 0.3 }, thighF: { angle: 0.3 }, shinF: { angle: 0.5 }, jawUpper: { angle: -0.1 }, jawLower: { angle: 0.16 } } },
    { t: 0.25, pose: { root: { y: -0.016 }, body: { angle: 0 }, thighB: { angle: 0 }, shinB: { angle: 0.7 }, thighF: { angle: 0 }, shinF: { angle: 0.2 }, jawUpper: { angle: 0.08 }, jawLower: { angle: -0.06 } } },
    { t: 0.5, pose: { root: { y: 0.012 }, body: { angle: 0.06 }, thighB: { angle: 0.3 }, shinB: { angle: 0.5 }, thighF: { angle: -0.4 }, shinF: { angle: 0.3 }, jawUpper: { angle: -0.12 }, jawLower: { angle: 0.18 } } },
    { t: 0.75, pose: { root: { y: -0.016 }, body: { angle: 0 }, thighB: { angle: 0 }, shinB: { angle: 0.2 }, thighF: { angle: 0 }, shinF: { angle: 0.7 }, jawUpper: { angle: 0.06 }, jawLower: { angle: -0.04 } } }
  ]
}

/**
 * THE LUNGE-BITE. The jaws gape wide, the body throws itself forward, and the
 * jaws slam shut PAST the front of the body — which is the whole reason they are
 * hinged forward of the root instead of on a neck.
 */
const MAW_ATTACK: Clip = {
  name: 'attack',
  duration: 820,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { jawUpper: { angle: -0.1 }, jawLower: { angle: 0.14 }, body: { angle: 0 }, root: { x: 0 } } },
    // Gape. Nearly ninety degrees of mouth.
    { t: 0.3, pose: { jawUpper: { angle: -0.85 }, jawLower: { angle: 0.9 }, body: { angle: -0.2 }, root: { x: -0.03 } }, ease: 'cubic' },
    // Snap, and the body goes with it.
    { t: 0.46, pose: { jawUpper: { angle: 0.16 }, jawLower: { angle: -0.14 }, body: { angle: 0.3 }, root: { x: 0.06 } }, ease: 'hold' },
    // Worry it — a second smaller shake with the mouth shut.
    { t: 0.62, pose: { jawUpper: { angle: 0.06 }, jawLower: { angle: -0.04 }, body: { angle: 0.14 }, root: { x: 0.04 } } },
    { t: 0.78, pose: { jawUpper: { angle: 0.18 }, jawLower: { angle: -0.16 }, body: { angle: 0.24 }, root: { x: 0.05 } }, ease: 'hold' },
    { t: 1, pose: { jawUpper: { angle: -0.1 }, jawLower: { angle: 0.14 }, body: { angle: 0 }, root: { x: 0 } }, ease: 'back' }
  ]
}

const MAW_IDLE: Clip = {
  name: 'idle',
  duration: 3200,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { jawUpper: { angle: -0.06 }, jawLower: { angle: 0.1 }, body: { angle: 0.02 } } },
    // It breathes through the mouth, because it has nothing else.
    { t: 0.5, pose: { jawUpper: { angle: -0.24 }, jawLower: { angle: 0.28 }, body: { angle: 0.06 } } }
  ]
}

function mawParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const thick = art(0.06, height)
  return {
    body: mawBody(height, k),
    jawUpper: mawJaw(height, k, true),
    jawLower: mawJaw(height, k, false),
    thighF: softLimb(art(0.15, height), thick * 1.4, k, 70),
    shinF: softLimb(art(0.14, height), thick * 1.1, k, 71),
    footF: hoofPart(Math.round(thick * 1.4), k, 72),
    thighB: softLimb(art(0.15, height), thick * 1.3, k, 73, k.necrotic),
    shinB: softLimb(art(0.14, height), thick, k, 74, k.necrotic),
    footB: hoofPart(Math.round(thick * 1.3), k, 75)
  }
}

// ───────────────────────────────── FLESHWALL ─────────────────────────────────

/**
 * THE FLESH WALL — architecture, not a soldier.
 *
 * No legs at all. It is a slab of fused bodies standing on stubby buttresses of
 * grown bone, three files wide, with mouths and faces pressed out of its surface
 * where the seams did not take. Its "walk" is an INCH: the whole mass leans,
 * the buttresses re-grip, and it arrives a little closer without ever taking a
 * step. Its idle is a slow breath that swells the entire silhouette, which is
 * the single most alive thing on the board.
 */
/**
 * THE SLAB — fifty-nine pixels by eighty-five, so unlike the small bodies this
 * one can afford detail. The first version squandered it.
 *
 * What was wrong, precisely: the shading picked ramp steps 1, 2 and 3 out of five
 * and never touched 0 or 4, so the whole face lived inside the middle of the
 * value range and had nowhere to go; the surface texture switched ramps on a
 * `noise(floor(x/5), floor(y/7))` test, which is a grid of five-by-seven
 * rectangles and reads as patterned wallpaper; and five rib cages, four sutures,
 * three mouths, an eye cluster and seven pustules were scattered at even
 * intervals with no size hierarchy, so none of them was a feature. A rectangle
 * of evenly-spaced confetti at a single value. A rug on legs.
 *
 * Rebuilt around three ideas:
 *
 *  1. IT IS MASONRY. Five horizontal COURSES of fused torsos with a hard dark
 *     mortar seam between them. Big shapes stated first, in the full 0..4 range.
 *  2. THE LIGHT COMES FROM ABOVE. A real vertical gradient — near-white along the
 *     top course, near-black in the last one — and each course individually lit
 *     on its own top edge and shadowed under its own belly, so the courses read
 *     as separate slabs of meat rather than as bands of paint.
 *  3. THE SILHOUETTE IS NOT A RECTANGLE. It batters — wider at the base than the
 *     top — and the top edge is broken by the shoulders and skulls of whatever
 *     went into the last course.
 *
 * Only three accents survive, and they differ in size by a factor of four so the
 * eye has somewhere to land: one big mouth low down, one cluster of faces at
 * centre height, and bone breaking out of the top line.
 */
function wallSlab(height: number, k: FleshKit): PartArt {
  const w = art(0.62, height)
  const h = art(0.9, height)
  const p = pad(w, h)
  const cx = p.w / 2
  const noise = pixelNoise(8123)
  const COURSES = 5
  const courseH = h / COURSES

  // The batter: half a pixel of inset per row up, so the wall leans in as it
  // rises. Plus a per-column wobble, because nothing here was quarried.
  const inset = (y: number): number => {
    const up = 1 - y / Math.max(1, h)
    return w * 0.09 * up
  }

  for (let y = 0; y < h; y += 1) {
    const course = Math.min(COURSES - 1, Math.floor(y / courseH))
    // Where in its own course this row falls: 0 at the top of the course, 1 at
    // the bottom. This is what makes each course a separate rounded mass.
    const inCourse = (y - course * courseH) / courseH
    const left = Math.round(inset(y) + noise(y, 31) * 1.6)
    const right = w - Math.round(inset(y) + noise(y, 37) * 1.6)
    // The top course is broken by whatever is sticking out of it.
    if (course === 0) {
      const crest = Math.round(courseH * 0.55 * noise(Math.floor(y * 0.7), 41))
      if (y < crest) continue
    }
    for (let x = left; x < right; x += 1) {
      // Vertical light: the top of the wall catches the sky, the base is in its
      // own shadow. This is the term the old version did not have at all.
      const sky = 1 - y / Math.max(1, h - 1)
      // Each course lit on its own upper surface and dark under its belly.
      const form = 1 - Math.abs(inCourse - 0.28) * 1.5
      // And a horizontal turn, so the wall has a near side and a far side.
      const turn = 1 - Math.abs((x - left) / Math.max(1, right - left) - 0.62) * 1.1
      const v = sky * 0.52 + form * 0.32 + turn * 0.16 + noise(x, y) * 0.06
      // The full range, ends included.
      const step = v < 0.26 ? 0 : v < 0.42 ? 1 : v < 0.58 ? 2 : v < 0.76 ? 3 : 4
      // Torsos, not tiles: the ramp is chosen per BODY. Six or so bodies to a
      // course, shifted by an odd amount each course so no two rows line up —
      // at three bodies a course it split each row into a big pale half and a
      // big red half, which is two-tone blocks, not a wall of corpses.
      const span = Math.max(3, Math.round(w * 0.16))
      const body = Math.floor((x + course * 5 + (course % 2) * 3) / span)
      const ramp = noise(body, course * 7 + 5) > 0.6 ? k.meat : k.hide
      p.set(x + 2, y + 2, ramp[step])
      // MORTAR. A hard dark line in the last two rows of every course, which is
      // the single change that stops the face reading as one flat plane.
      if (inCourse > 0.9) p.set(x + 2, y + 2, k.cavity[step > 2 ? 2 : 1])
    }
  }

  // One rib cage per course, sized to its course and offset so they do not line
  // up into a column — the bodies in a wall do not stack tidily.
  for (let i = 0; i < COURSES; i += 1) {
    const bx = 4 + ((i * 2 + 1) % 5) * w * 0.19
    const by = 2 + (i + 0.36) * courseH
    ribCage(p, bx, by, w * 0.2, courseH * 0.46, k, 3, 1)
  }
  // Three accents, and they differ in size by a factor of four.
  //
  // THE MOUTH — low, wide, and the largest single feature on the wall.
  maw(p, cx + w * 0.06, 2 + courseH * 3.55, w * 0.26, courseH * 0.34, k, 13, 22)
  // THE FACES — a cluster at centre height, a quarter the size of the mouth.
  eyeCluster(p, cx - w * 0.22, 2 + courseH * 2.3, w * 0.13, k, 6, 24)
  // THE BONE — breaking out of the top line, so the crest is not just noise.
  boneSpur(p, cx - w * 0.3, 2 + courseH * 0.5, art(0.09, height), -1.9, k)
  boneSpur(p, cx + w * 0.18, 2 + courseH * 0.32, art(0.07, height), -1.5, k)
  // A few pustules only where the light already is, so they read as raised.
  for (let i = 0; i < 3; i += 1) {
    pustule(p, cx + w * (0.1 - i * 0.16), 2 + courseH * (1.3 + i * 0.9), 2 + (i % 2), k)
  }
  return { canvas: finish(p, k, 20, 0.85), origin: [cx / p.w, (p.h - 3) / p.h] }
}

function buttress(height: number, k: FleshKit, seed: number): PartArt {
  const w = art(0.1, height)
  const h = art(0.14, height)
  const p = pad(w, h)
  const cx = p.w / 2
  // A stubby root of grown bone and gristle, splayed at the base.
  for (let y = 0; y < h; y += 1) {
    const t = y / h
    const wid = Math.max(2, Math.round(w * (0.5 + t * 0.5)))
    for (let o = 0; o < wid; o += 1) {
      const s = o / Math.max(1, wid - 1)
      p.set(Math.round(cx - wid / 2 + o), 2 + y, k.gristle[s < 0.2 ? 1 : s > 0.75 ? 3 : 2])
    }
  }
  claw(p, cx, h, Math.round(w * 0.6), k)
  blemish(p, k, seed, 0.02)
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 2 / p.h] }
}

const WALL_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.1, depth: 30 }),
    bone('slab', 'root', { angle: -Math.PI / 2, length: 0.8, part: 'slab', orient: 'up', depth: 31, weights: { breathe: 1, flinch: 0.4 } })
  ]
  // Four buttresses, not legs. They re-grip rather than step.
  ;[-0.22, -0.07, 0.08, 0.23].forEach((x, i) => {
    s.push(bone(`stub${i}`, 'root', { x, angle: Math.PI / 2, length: 0.1, part: `stub${i}`, depth: i % 2 === 0 ? 44 : 8 }))
  })
  validateSkeleton(s, 'fleshwall')
  return s
}

/**
 * THE INCH. Not a walk — a lean, a re-grip, and a settle. The buttresses take
 * turns letting go, and the whole slab tilts a degree and a half either way.
 */
const WALL_WALK: Clip = {
  name: 'walk',
  duration: 1900,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { slab: { angle: -0.03, stretch: 1 }, root: { y: 0 }, stub0: { angle: 0.1 }, stub1: { angle: -0.06 }, stub2: { angle: 0.08 }, stub3: { angle: -0.04 } } },
    // Lean forward, front pair bearing it.
    { t: 0.3, pose: { slab: { angle: 0.05, stretch: 1.02 }, root: { y: -0.006 }, stub0: { angle: -0.16 }, stub1: { angle: 0.2 }, stub2: { angle: -0.12 }, stub3: { angle: 0.18 } } },
    // The back pair let go and re-plant. This is the only "step" it takes.
    { t: 0.58, pose: { slab: { angle: 0.02, stretch: 0.98 }, root: { y: 0.006 }, stub0: { angle: 0.22 }, stub1: { angle: -0.18 }, stub2: { angle: 0.2 }, stub3: { angle: -0.14 } }, ease: 'quad' },
    { t: 0.82, pose: { slab: { angle: -0.04, stretch: 1.01 }, root: { y: -0.002 }, stub0: { angle: 0.04 }, stub1: { angle: 0.02 }, stub2: { angle: 0.02 }, stub3: { angle: 0.04 } } }
  ]
}

/** It does not attack so much as press. The whole slab bulges forward. */
const WALL_ATTACK: Clip = {
  name: 'attack',
  duration: 1100,
  loop: false,
  ease: 'sine',
  keys: [
    { t: 0, pose: { slab: { angle: 0, stretch: 1 } } },
    { t: 0.34, pose: { slab: { angle: -0.08, stretch: 0.95 } }, ease: 'cubic' },
    { t: 0.52, pose: { slab: { angle: 0.14, stretch: 1.1 }, root: { y: 0.008 } }, ease: 'hold' },
    { t: 0.78, pose: { slab: { angle: 0.04, stretch: 1.02 } }, ease: 'back' },
    { t: 1, pose: { slab: { angle: 0, stretch: 1 } } }
  ]
}

/** The breath. Enormous, slow, and the reason it reads as alive. */
const WALL_IDLE: Clip = {
  name: 'idle',
  duration: 4600,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { slab: { stretch: 1 }, root: { y: 0 } } },
    { t: 0.42, pose: { slab: { stretch: 1.045 }, root: { y: -0.007 } } },
    { t: 0.72, pose: { slab: { stretch: 0.985 }, root: { y: 0.003 } } }
  ]
}

function wallParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const parts: Record<string, PartArt> = { slab: wallSlab(height, k) }
  for (let i = 0; i < 4; i += 1) parts[`stub${i}`] = buttress(height, k, 80 + i)
  return parts
}

// ─────────────────────────────────── RIPJAW ───────────────────────────────────

/**
 * THE RIPJAW — a quadruped built to leave the ground.
 *
 * Low slung, deep chested, hind legs far heavier than the front ones, and a head
 * that is mostly jaw carried out in front of the shoulders rather than above
 * them. Its gallop is a four-beat bound — both hind feet together, then both
 * front — and the leap pose tucks all four limbs under the body and extends
 * them again, which is the shape that sells a jump.
 */
/**
 * THE RIPJAW'S TORSO — twenty-two pixels by fourteen.
 *
 * That number is the whole design constraint and the first two attempts at this
 * body ignored it. A rib cage, a spine, three bone spurs and a loop of viscera
 * were all being drawn into three hundred pixels, and the result was noise: at
 * playing size the animal read as a dark blob with pink stripes through it and
 * no discernible head, legs or direction.
 *
 * So the detail is gone and the SHAPE carries it. What is left is a silhouette
 * with a shoulder hump, one hard three-band value gradient (near-black along the
 * spine, mid flank, pale belly) and exactly two bright features: the spine ridge
 * and a single dark shoulder socket. Everything drawn darker than the flank —
 * the legs, the skull, the tail — separates from it for free.
 */
function ripjawBody(height: number, k: FleshKit): PartArt {
  const w = art(0.62, height)
  const h = art(0.40, height)
  const p = pad(w, h)
  const noise = pixelNoise(741)
  for (let x = 0; x < w; x += 1) {
    const t = x / Math.max(1, w - 1)
    // A hump over the shoulder at t≈0.76 collapsing to narrow hips at the back:
    // the weight sits over the front legs, which is what makes the jump look as
    // though it comes from the back end.
    const hump = Math.exp(-((t - 0.76) * (t - 0.76)) / 0.1)
    const th = Math.max(3, Math.round(h * (0.34 + 0.58 * hump + 0.1 * t)))
    // The belly line stays flat. All the change happens along the back.
    const belly = Math.round(p.h * 0.86)
    const top = belly - th
    for (let y = top; y < belly; y += 1) {
      const s = (y - top) / Math.max(1, th - 1)
      // Three bands with a one-pixel jitter on the boundaries, so the gradient
      // does not read as printed stripes.
      const j = noise(x, 2) * 0.08
      if (s < 0.26 + j) p.set(x + 2, y, k.necrotic[s < 0.1 ? 0 : 1])
      else if (s > 0.8) p.set(x + 2, y, k.fat[1])
      else p.set(x + 2, y, k.hide[s < 0.45 ? 3 : 2])
    }
  }
  // Two features, and only two. The spine is the one bright line up there —
  // the highest-contrast thing on the body, sitting on the darkest band.
  spine(p, 3, p.h * 0.3, p.w - 3, p.h * 0.2, k, 12)
  // And one dark hollow behind the shoulder, which reads as mass at any size.
  p.ellipse(w * 0.58 + 2, p.h * 0.62, Math.max(1.2, w * 0.06), Math.max(1.2, h * 0.11), k.cavity[1])
  boneSpur(p, w * 0.7 + 2, p.h * 0.24, art(0.07, height), -1.6, k)
  return { canvas: finishSmall(p, k, 90), origin: [0.1, 0.62] }
}

/**
 * THE SKULL — ten pixels by seven, so it gets three marks and no more: a bony
 * ramp for the braincase, two teeth, one socket. Drawn on the BONE ramp rather
 * than the hide ramp, which is the only reason it separates from the shoulder
 * behind it; the first version was the same pale tone as the flank and vanished
 * into it completely.
 */
function ripjawSkull(height: number, k: FleshKit): PartArt {
  const len = art(0.30, height)
  const h = art(0.19, height)
  const p = pad(len, h)
  const cy = p.h * 0.5
  for (let i = 0; i < len; i += 1) {
    const t = i / Math.max(1, len - 1)
    // A broad braincase narrowing hard into the snout.
    const th = Math.max(2, Math.round(h * (0.98 - t * 0.6)))
    const mid = cy - h * 0.05 * t
    for (let o = 0; o < th; o += 1) {
      const s = o / Math.max(1, th - 1)
      p.set(2 + i, Math.round(mid - th / 2 + o), s > 0.72 ? k.gristle[1] : k.bone[s < 0.34 ? 3 : 2])
    }
  }
  // Two teeth, at the SNOUT end of the jaw line. They are the brightest pixels
  // on the unit, which is where the eye should land.
  const jawY = Math.round(cy + h * 0.3)
  p.set(2 + len - 1, jawY, k.bone[4])
  p.set(2 + len - 1 - Math.max(2, Math.round(len * 0.22)), jawY, k.bone[4])
  // One sunk socket, back in the braincase. Not a cluster — there is no room.
  const sock = 2 + Math.round(len * 0.2)
  p.set(sock, Math.round(cy - h * 0.22), k.cavity[0])
  p.set(sock, Math.round(cy - h * 0.22) + 1, k.accent[2])
  // Origin at the BACK of the canvas: with `orient: 'right'` the art is laid out
  // forwards from the joint, so the braincase must sit at the joint and the
  // snout at the far end. Anchoring it at the snout instead pointed the whole
  // head backwards over the shoulder, which is exactly what it looked like.
  return { canvas: finishSmall(p, k, 92), origin: [2 / p.w, cy / p.h] }
}

/** The lower jaw. Nine pixels by three: a wedge and two teeth. */
function ripjawJaw(height: number, k: FleshKit): PartArt {
  const len = art(0.26, height)
  const h = art(0.09, height)
  const p = pad(len, h)
  const cy = p.h * 0.5
  for (let i = 0; i < len; i += 1) {
    const t = i / Math.max(1, len - 1)
    const th = Math.max(2, Math.round(h * (1 - t * 0.4)))
    for (let o = 0; o < th; o += 1) {
      p.set(2 + i, Math.round(cy - th / 2 + o), o === 0 ? k.bone[3] : k.gristle[1])
    }
  }
  // Teeth on the mandible point UP, at the snout end, so a closed mouth
  // interlocks with the two coming down off the skull.
  const tipY = Math.round(cy - h * 0.4)
  p.set(2 + len - 1, tipY, k.bone[4])
  p.set(2 + len - 1 - Math.max(2, Math.round(len * 0.25)), tipY, k.bone[4])
  // Hinged at the back, same as the skull, so the two run parallel.
  return { canvas: p.toCanvas() as Canvas2D, origin: [2 / p.w, cy / p.h] }
}

const RIPJAW_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    // Higher than before. The first version put the root at 0.34 with legs that
    // only reached 0.27 down once bent, so the animal hovered with its belly
    // almost on the dirt — a long low smear rather than something coiled to
    // jump. At 0.46 with longer legs the chest clears the ground and the jump
    // has somewhere to come FROM.
    bone('root', null, { y: -0.46, depth: 30 }),
    // The body is HORIZONTAL. Nothing else in the game is.
    bone('body', 'root', { angle: -0.08, length: 0.46, part: 'body', orient: 'right', depth: 31, weights: { breathe: 1, lean: 1 } }),
    // The skull hangs straight off the front of the body, dropped below the
    // shoulder line by a y offset rather than by an intermediate neck bone.
    //
    // The neck WAS a bone of its own carrying a `softLimb` part — and a softLimb
    // is authored pointing DOWN while the bone declared `orient: 'right'`. That
    // mismatch rotated the whole chain a quarter turn and threw the head back
    // over the animal's own shoulder. One less joint is one less thing to get
    // wrong, and at twenty-two pixels long there was never room to see a neck.
    bone('head', 'body', { x: 0.02, y: 0.05, angle: 0.06, part: 'head', orient: 'right', depth: 41, weights: { aim: 0.6, flinch: 1 } }),
    // The mandible hinges off the skull's own root, so opening the mouth swings
    // the lower jaw alone and the teeth part instead of the whole head stretching.
    bone('jaw', 'head', { x: -0.02, y: 0.03, angle: 0.1, part: 'jaw', orient: 'right', depth: 39, weights: { flinch: 0.6 } }),
    // A long counterweight tail. It is what stops the silhouette ending in a
    // blunt vertical edge at the hips, and in the bound it whips.
    //
    // ANGLES ON THIS RIG, measured rather than assumed (`partRotation` in
    // rig.ts, plus a probe of the live sprite positions): a part authored
    // pointing DOWN renders at `angle - π/2`, so angle 0 points FORWARD, π/2
    // points straight down — which is why every hip here is π/2 — and π points
    // BACKWARD. A tail therefore wants π, not 0.
    bone('tailA', 'root', { x: -0.1, angle: Math.PI - 0.22, length: 0.2, part: 'tailA', depth: 22, weights: { lean: 1.4 } }),
    bone('tailB', 'tailA', { angle: -0.2, length: 0.16, part: 'tailB', depth: 21 }),
    bone('tailC', 'tailB', { angle: -0.26, part: 'tailC', depth: 20 }),
    // Hind legs, heavy, set well back and longer than the fore pair.
    bone('hipB', 'root', { x: -0.15, angle: Math.PI / 2, depth: 10 }),
    bone('hindB', 'hipB', { angle: -0.5, length: 0.23, part: 'hindB', depth: 10 }),
    bone('hockB', 'hindB', { angle: 1.05, length: 0.2, part: 'hockB', depth: 11 }),
    bone('pawB', 'hockB', { angle: -0.55, part: 'pawB', depth: 12 }),
    bone('hipB2', 'root', { x: -0.12, angle: Math.PI / 2, depth: 44 }),
    bone('hindB2', 'hipB2', { angle: -0.5, length: 0.23, part: 'hindB2', depth: 44 }),
    bone('hockB2', 'hindB2', { angle: 1.05, length: 0.2, part: 'hockB2', depth: 45 }),
    bone('pawB2', 'hockB2', { angle: -0.55, part: 'pawB2', depth: 46 }),
    // Fore legs, lighter, under the chest.
    bone('hipF', 'root', { x: 0.17, angle: Math.PI / 2, depth: 8 }),
    bone('foreF', 'hipF', { angle: 0.22, length: 0.2, part: 'foreF', depth: 8 }),
    bone('kneeF', 'foreF', { angle: -0.3, length: 0.19, part: 'kneeF', depth: 9 }),
    bone('pawF', 'kneeF', { angle: 0.08, part: 'pawF', depth: 10 }),
    bone('hipF2', 'root', { x: 0.2, angle: Math.PI / 2, depth: 48 }),
    bone('foreF2', 'hipF2', { angle: 0.22, length: 0.2, part: 'foreF2', depth: 48 }),
    bone('kneeF2', 'foreF2', { angle: -0.3, length: 0.19, part: 'kneeF2', depth: 49 }),
    bone('pawF2', 'kneeF2', { angle: 0.08, part: 'pawF2', depth: 50 })
  ]
  validateSkeleton(s, 'ripjaw')
  return s
}

/** A four-beat bound: hind pair together, then fore pair, with a flight phase. */
const RIPJAW_WALK: Clip = {
  name: 'walk',
  duration: 560,
  loop: true,
  ease: 'sine',
  keys: [
    {
      // Gather: hind feet planted under the body, back arched.
      t: 0,
      pose: {
        root: { y: 0.012 },
        body: { angle: -0.16 },
        hindB: { angle: 0.5 }, hockB: { angle: 1.2 },
        hindB2: { angle: 0.45 }, hockB2: { angle: 1.15 },
        foreF: { angle: -0.7 }, kneeF: { angle: -0.5 },
        foreF2: { angle: -0.65 }, kneeF2: { angle: -0.45 },
        head: { angle: 0.16 }, jaw: { angle: 0.18 }, tailA: { angle: 0.22 }, tailB: { angle: 0.14 }, tailC: { angle: 0.1 }
      }
    },
    {
      // Drive: hind legs extend, body straightens, front reaches out.
      t: 0.25,
      pose: {
        root: { y: -0.03 },
        body: { angle: 0.04 },
        hindB: { angle: -0.7 }, hockB: { angle: 0.1 },
        hindB2: { angle: -0.65 }, hockB2: { angle: 0.15 },
        foreF: { angle: 0.6 }, kneeF: { angle: 0.2 },
        foreF2: { angle: 0.55 }, kneeF2: { angle: 0.25 },
        head: { angle: -0.1 }, jaw: { angle: 0.34 }, tailA: { angle: -0.2 }, tailB: { angle: -0.16 }, tailC: { angle: -0.12 }
      },
      ease: 'quad'
    },
    {
      // Flight. Nothing touching.
      t: 0.45,
      pose: {
        root: { y: -0.05 },
        body: { angle: 0.12 },
        hindB: { angle: -0.3 }, hockB: { angle: 0.6 },
        hindB2: { angle: -0.25 }, hockB2: { angle: 0.65 },
        foreF: { angle: 0.2 }, kneeF: { angle: -0.2 },
        foreF2: { angle: 0.15 }, kneeF2: { angle: -0.15 },
        head: { angle: -0.16 }, jaw: { angle: 0.4 }, tailA: { angle: -0.34 }, tailB: { angle: -0.24 }, tailC: { angle: -0.18 }
      }
    },
    {
      // Fore feet land and take it.
      t: 0.7,
      pose: {
        root: { y: 0.016 },
        body: { angle: -0.06 },
        hindB: { angle: 0.2 }, hockB: { angle: 0.9 },
        hindB2: { angle: 0.25 }, hockB2: { angle: 0.85 },
        foreF: { angle: -0.3 }, kneeF: { angle: 0.1 },
        foreF2: { angle: -0.25 }, kneeF2: { angle: 0.15 },
        head: { angle: 0.1 }, jaw: { angle: 0.2 }, tailA: { angle: 0.12 }, tailB: { angle: 0.08 }, tailC: { angle: 0.06 }
      },
      ease: 'quad'
    }
  ]
}

/** The bite, taken on the run — head down, shoulders into it, one shake. */
const RIPJAW_ATTACK: Clip = {
  name: 'attack',
  duration: 520,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { head: { angle: 0 }, jaw: { angle: 0.1 }, body: { angle: 0 } } },
    // Rear back and GAPE. The mouth opening is the wind-up, not the strike.
    { t: 0.26, pose: { head: { angle: -0.5 }, jaw: { angle: 1.15 }, body: { angle: -0.14 }, root: { y: -0.01 }, tailA: { angle: 0.3 } }, ease: 'cubic' },
    // Slam. Head down, jaw shut on the same frame, held.
    { t: 0.42, pose: { head: { angle: 0.5 }, jaw: { angle: -0.06 }, body: { angle: 0.16 }, root: { y: 0.012 }, tailA: { angle: -0.28 } }, ease: 'hold' },
    // And then the shake — the thing every dog does and nothing else here does.
    { t: 0.56, pose: { head: { angle: 0.14 }, jaw: { angle: 0.06 }, body: { angle: 0.04 }, tailA: { angle: 0.18 } } },
    { t: 0.68, pose: { head: { angle: 0.46 }, jaw: { angle: -0.04 }, body: { angle: 0.12 }, tailA: { angle: -0.2 } }, ease: 'hold' },
    { t: 0.8, pose: { head: { angle: 0.2 }, jaw: { angle: 0.08 }, body: { angle: 0.05 }, tailA: { angle: 0.14 } } },
    { t: 1, pose: { head: { angle: 0 }, jaw: { angle: 0.1 }, body: { angle: 0 }, tailA: { angle: 0 } }, ease: 'back' }
  ]
}

const RIPJAW_IDLE: Clip = {
  name: 'idle',
  duration: 2200,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { head: { angle: 0.04 }, jaw: { angle: 0.16 }, body: { angle: -0.02 }, tailA: { angle: 0.1 }, tailB: { angle: 0.14 } } },
    { t: 0.35, pose: { head: { angle: -0.02 }, jaw: { angle: 0.3 }, body: { angle: 0 }, tailA: { angle: -0.06 }, tailB: { angle: 0.2 } } },
    { t: 0.5, pose: { head: { angle: -0.06 }, jaw: { angle: 0.12 }, body: { angle: 0.02 }, tailA: { angle: -0.12 }, tailB: { angle: -0.08 } } },
    { t: 0.78, pose: { head: { angle: 0 }, jaw: { angle: 0.24 }, body: { angle: 0 }, tailA: { angle: 0.04 }, tailB: { angle: -0.16 } } }
  ]
}

function ripjawParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const t = art(0.05, height)
  // Far legs drawn on the NECROTIC ramp and near legs on the hide ramp, so the
  // two pairs sit at visibly different depths instead of tangling into one mat
  // of limbs under the chest.
  return {
    body: ripjawBody(height, k),
    head: ripjawSkull(height, k),
    jaw: ripjawJaw(height, k),
    tailA: softLimb(art(0.2, height), t * 1.1, k, 96, k.necrotic),
    tailB: softLimb(art(0.16, height), t * 0.8, k, 97, k.necrotic),
    tailC: softLimb(art(0.1, height), t * 0.5, k, 98, k.gristle),
    hindB: softLimb(art(0.23, height), t * 1.5, k, 100, k.necrotic),
    hockB: softLimb(art(0.2, height), t * 1.0, k, 101, k.necrotic),
    pawB: hoofPart(Math.round(t * 1.3), k, 102),
    hindB2: softLimb(art(0.23, height), t * 1.7, k, 103),
    hockB2: softLimb(art(0.2, height), t * 1.2, k, 104),
    pawB2: hoofPart(Math.round(t * 1.4), k, 105),
    foreF: softLimb(art(0.2, height), t * 1.0, k, 106, k.necrotic),
    kneeF: softLimb(art(0.19, height), t * 0.85, k, 107, k.necrotic),
    pawF: hoofPart(Math.round(t * 1.1), k, 108),
    foreF2: softLimb(art(0.2, height), t * 1.2, k, 109),
    kneeF2: softLimb(art(0.19, height), t, k, 110),
    pawF2: hoofPart(Math.round(t * 1.2), k, 111)
  }
}

// ─────────────────────────────────── WAGON ───────────────────────────────────

/**
 * THE FLESH WAGON — a vat on wheels, hauled by things in harness.
 *
 * The only Carnage body with a machine in it, and the machine is the worst part:
 * two big spoked wheels, a tub of viscera slung between them, and a crane arm
 * over the back that lifts remains in. The wheels turn, the tub sloshes, the
 * crane bobs — three separate rhythms, none of them a walk cycle.
 */
function wagonTub(height: number, k: FleshKit): PartArt {
  const w = art(0.5, height)
  const h = art(0.3, height)
  const p = pad(w, h)
  const cx = p.w / 2
  // A slat tub, bound with iron.
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      const s = (x % 5) / 5
      p.set(x + 2, y + 2, k.necrotic[s < 0.2 ? 1 : s > 0.7 ? 3 : 2])
    }
  }
  p.fill(2, 2, w, 1, k.iron[3])
  p.fill(2, 2 + Math.round(h * 0.5), w, 1, k.iron[2])
  p.fill(2, p.h - 3, w, 1, k.iron[1])
  // What is in it, standing proud of the rim.
  for (let i = 0; i < 6; i += 1) {
    fleshMass(p, 4 + (i * (w - 8)) / 5, 3 + h * 0.14, w * 0.09, h * 0.13, k.meat, 120 + i, 3)
  }
  eyeCluster(p, cx, 4, w * 0.16, k, 4, 127)
  return { canvas: finish(p, k, 120, 0.9), origin: [cx / p.w, (p.h - 3) / p.h] }
}

function wagonWheel(height: number, k: FleshKit): PartArt {
  const r = art(0.17, height)
  const p = pad(r * 2, r * 2)
  const cx = p.w / 2
  const cy = p.h / 2
  p.ellipseFrame(cx, cy, r, r, k.iron[1])
  p.ellipseFrame(cx, cy, r - 1, r - 1, k.iron[3])
  // Spokes of long bone.
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2
    p.thickLine(cx, cy, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 1, k.bone[2])
  }
  p.ellipse(cx, cy, r * 0.2, r * 0.2, k.iron[2])
  return { canvas: p.toCanvas() as Canvas2D, origin: [0.5, 0.5] }
}

function wagonCrane(height: number, k: FleshKit): PartArt {
  const len = art(0.3, height)
  const p = pad(len, art(0.06, height))
  const cy = p.h / 2
  p.fill(2, cy - 1, len, 2, k.bone[2])
  p.fill(2, cy - 1, len, 1, k.bone[4])
  // A hook of bone at the far end, and a hanging chain of gristle.
  claw(p, 2 + len - 2, cy, Math.round(p.h * 0.4), k)
  return { canvas: p.toCanvas() as Canvas2D, origin: [2 / p.w, cy / p.h] }
}

const WAGON_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.2, depth: 30 }),
    bone('tub', 'root', { angle: -Math.PI / 2, length: 0.26, part: 'tub', orient: 'up', depth: 31, weights: { breathe: 0.6 } }),
    bone('wheelB', 'root', { x: -0.14, y: 0.02, part: 'wheelB', depth: 8 }),
    bone('wheelF', 'root', { x: 0.16, y: 0.02, part: 'wheelF', depth: 48 }),
    bone('mast', 'tub', { y: -0.02, angle: -0.2, length: 0.06, depth: 20 }),
    bone('crane', 'mast', { angle: -0.5, part: 'crane', orient: 'right', depth: 21 }),
    // Two haulers in harness at the front. Just torsos and legs — they are not
    // going anywhere else.
    bone('haulHip', 'root', { x: 0.3, angle: Math.PI / 2, depth: 44 }),
    bone('haulLeg', 'haulHip', { length: 0.12, part: 'haulLeg', depth: 44 }),
    bone('haulShin', 'haulLeg', { angle: 0.4, length: 0.11, part: 'haulShin', depth: 45 }),
    bone('haulHip2', 'root', { x: 0.34, angle: Math.PI / 2, depth: 6 }),
    bone('haulLeg2', 'haulHip2', { length: 0.12, part: 'haulLeg2', depth: 6 }),
    bone('haulShin2', 'haulLeg2', { angle: 0.4, length: 0.11, part: 'haulShin2', depth: 7 })
  ]
  validateSkeleton(s, 'wagon')
  return s
}

/** Wheels turn, tub rocks, crane bobs, haulers trudge — four rhythms. */
const WAGON_WALK: Clip = {
  name: 'walk',
  duration: 1000,
  loop: true,
  ease: 'linear',
  keys: [
    { t: 0, pose: { wheelB: { angle: 0 }, wheelF: { angle: 0 }, tub: { angle: -0.02 }, crane: { angle: 0.04 }, haulLeg: { angle: -0.4 }, haulShin: { angle: 0.3 }, haulLeg2: { angle: 0.4 }, haulShin2: { angle: 0.1 } } },
    { t: 0.25, pose: { wheelB: { angle: 1.57 }, wheelF: { angle: 1.57 }, tub: { angle: 0.02 }, crane: { angle: -0.06 }, haulLeg: { angle: 0 }, haulShin: { angle: 0.6 }, haulLeg2: { angle: 0 }, haulShin2: { angle: 0.2 } } },
    { t: 0.5, pose: { wheelB: { angle: 3.14 }, wheelF: { angle: 3.14 }, tub: { angle: -0.02 }, crane: { angle: 0.05 }, haulLeg: { angle: 0.4 }, haulShin: { angle: 0.1 }, haulLeg2: { angle: -0.4 }, haulShin2: { angle: 0.3 } } },
    { t: 0.75, pose: { wheelB: { angle: 4.71 }, wheelF: { angle: 4.71 }, tub: { angle: 0.02 }, crane: { angle: -0.04 }, haulLeg: { angle: 0 }, haulShin: { angle: 0.2 }, haulLeg2: { angle: 0 }, haulShin2: { angle: 0.6 } } }
  ]
}

/** The crane swings out, dips, and hauls something up into the tub. */
const WAGON_ATTACK: Clip = {
  name: 'attack',
  duration: 1400,
  loop: false,
  ease: 'sine',
  keys: [
    { t: 0, pose: { crane: { angle: 0 }, tub: { angle: 0 } } },
    { t: 0.24, pose: { crane: { angle: 0.8 }, tub: { angle: -0.04 } }, ease: 'quad' },
    { t: 0.44, pose: { crane: { angle: 1.15 } }, ease: 'hold' },
    { t: 0.7, pose: { crane: { angle: -0.35 }, tub: { angle: 0.06 } }, ease: 'cubic' },
    { t: 0.86, pose: { crane: { angle: -0.15 }, tub: { angle: -0.03 } }, ease: 'back' },
    { t: 1, pose: { crane: { angle: 0 }, tub: { angle: 0 } } }
  ]
}

const WAGON_IDLE: Clip = {
  name: 'idle',
  duration: 3000,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { tub: { angle: -0.015 }, crane: { angle: 0.03 } } },
    { t: 0.5, pose: { tub: { angle: 0.015 }, crane: { angle: -0.03 } } }
  ]
}

function wagonParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const t = art(0.045, height)
  return {
    tub: wagonTub(height, k),
    wheelB: wagonWheel(height, k),
    wheelF: wagonWheel(height, k),
    crane: wagonCrane(height, k),
    haulLeg: softLimb(art(0.12, height), t, k, 130, k.necrotic),
    haulShin: softLimb(art(0.11, height), t * 0.85, k, 131, k.necrotic),
    haulLeg2: softLimb(art(0.12, height), t * 1.05, k, 132),
    haulShin2: softLimb(art(0.11, height), t * 0.9, k, 133)
  }
}

// ─────────────────────────────────── WIDOW ───────────────────────────────────

/**
 * THE CARRION WIDOW — a ribcage that learned to fly.
 *
 * No fuselage: the body IS a hanging cage of bone with the organs still in it,
 * and the wings are membranes stretched on arm bones far too long for the body.
 * Everything below the cage trails — legs, viscera, a tail of gut — so it reads
 * as suspended rather than as flying, which is the difference between this and
 * an aircraft.
 */
/**
 * THE WIDOW'S CAGE — the smallest body in the faction, and it was the most
 * overdrawn. At the old fractions the canvas was eight pixels by eleven and it
 * was being given a four-bar rib cage, an eight-vertebra spine, a heart, a bone
 * collar, an eye cluster and a loop of viscera: six features in eighty-eight
 * pixels, which is not a hanging ribcage, it is grey mush.
 *
 * Drawn larger — the art fraction is purely visual, the unit's `height` and
 * therefore its reach and hitbox are untouched — and cut to the three marks that
 * make the silhouette: the bars, a dark heart hanging inside them, and the bone
 * collar where a neck used to be. An empty ribcage swinging under a pair of
 * wings is a strong enough read on its own.
 */
/**
 * THE WIDOW'S CAGE — an empty human ribcage hung from a pair of wings.
 *
 * The previous version was wrong twice over. Its art called `ribCage` across the
 * full width of an eight-by-eleven canvas, which is not a ribcage, it is a crate
 * lid: five bars of equal length at equal spacing filling a rectangle. And the
 * bone that carried it sat at `angle: Math.PI / 2` with `orient: 'up'`, which
 * `partRotation` turns into a rotation of π — the whole thing rendered UPSIDE
 * DOWN, collar at the bottom.
 *
 * So the bars are drawn here rather than borrowed. What makes a ribcage read is
 * that it TAPERS and that it is OPEN: the bars run from each flank inward and
 * stop short of the middle, so the gap down the centre shows the dark heart
 * hanging inside. That gap is the whole silhouette.
 */
function widowCage(height: number, k: FleshKit): PartArt {
  const w = art(0.5, height)
  const h = art(0.66, height)
  const p = pad(w, h)
  const cx = p.w / 2
  const bars = 5
  for (let i = 0; i < bars; i += 1) {
    const t = i / (bars - 1)
    // Full width at the collar, three fifths of it at the bottom of the cage.
    const half = (w * 0.5) * (1 - t * 0.42)
    const y = Math.round(3 + h * (0.16 + t * 0.66))
    // The gap widens as the cage narrows, so the opening is always visible.
    const gap = Math.max(1, Math.round(half * (0.18 + t * 0.22)))
    for (let o = gap; o <= half; o += 1) {
      // Two pixels thick with a lit top edge — one-pixel bars are noise at this
      // size, which is the lesson the Ripjaw's rib cage taught.
      for (const s of [-1, 1]) {
        p.set(Math.round(cx + s * o), y, k.bone[3])
        p.set(Math.round(cx + s * o), y + 1, k.gristle[1])
      }
    }
  }
  // The sternum: one bright vertical down the front, tying the bars together.
  for (let y = 3; y < 3 + h * 0.86; y += 1) p.set(Math.round(cx), Math.round(y), k.bone[y % 3 === 0 ? 4 : 2])
  // The heart, hung in the opening and the darkest thing on the unit — which is
  // what tells the eye the bars are bars and not stripes.
  p.ellipse(cx, 3 + h * 0.52, Math.max(1.6, w * 0.17), Math.max(1.8, h * 0.15), k.cavity[0])
  p.ellipse(cx - w * 0.04, 3 + h * 0.48, Math.max(1, w * 0.08), Math.max(1, h * 0.07), k.meat[2])
  // A collar of skull at the top where the neck used to be.
  p.ellipse(cx, 4, w * 0.3, h * 0.05, k.bone[3])
  p.set(Math.round(cx), 3, k.bone[4])
  return { canvas: finishSmall(p, k, 140), origin: [cx / p.w, 2 / p.h] }
}

/**
 * A WING, drawn LEFTWARD from an origin at its own trailing edge.
 *
 * Authoring it the other way round — extending right from a left-hand origin —
 * forced the bone to sit at angle π to sweep the wing backward, and a rotation
 * of π also turns the membrane upside down, so the leading-edge spar ended up
 * underneath. Drawn leftward, a small negative angle sweeps it back and up with
 * no flip, which is the pose a wing actually holds.
 */
function widowWing(height: number, k: FleshKit, seed: number): PartArt {
  const span = art(0.72, height)
  const drop = art(0.34, height)
  const p = pad(span, drop + 4)
  const noise = pixelNoise(seed * 811 + 3)
  const tip = 2
  const root = 2 + span
  // The leading spar runs the whole span along the top edge.
  p.thickLine(root, 3, tip, 3 + drop * 0.28, 2, k.bone[3])
  // The membrane hangs off it, deepest near the body and pinched at the tip.
  for (let i = 0; i <= span; i += 1) {
    const t = i / Math.max(1, span)
    const x = root - i
    const top = 3 + drop * 0.28 * t
    const deep = drop * (0.28 + Math.sin((1 - t) * Math.PI * 0.8) * 0.72)
    for (let y = 0; y < deep; y += 1) {
      const s = y / Math.max(1, deep)
      p.set(x, Math.round(top + y), k.membrane[s > 0.78 ? 1 : s > 0.4 ? 2 : 3])
    }
    // Torn along the trailing edge. Nothing on this thing is intact.
    if (noise(i, 5) > 0.66) p.set(x, Math.round(top + deep - 1), 0, 0)
  }
  // Three finger bones fanning out through the web.
  for (let f = 1; f <= 3; f += 1) {
    const t = f / 4
    const x = root - Math.round(span * t)
    const deep = drop * (0.28 + Math.sin((1 - t) * Math.PI * 0.8) * 0.72)
    p.thickLine(root, 4, x, 3 + drop * 0.28 * t + deep * 0.9, 1, k.gristle[2])
  }
  // Origin at the trailing edge, next to the body.
  return { canvas: p.toCanvas() as Canvas2D, origin: [root / p.w, 3 / p.h] }
}

const WIDOW_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.5, depth: 30 }),
    // `orient: 'up'` renders at `angle + π/2`, so -π/2 is upright and +π/2 —
    // what this was — is a rotation of π: the cage hung collar-DOWN.
    bone('cage', 'root', { angle: -Math.PI / 2, length: 0.36, part: 'cage', orient: 'up', depth: 31, weights: { breathe: 1, flinch: 1 } }),
    // Wings hinge at the collar and sweep back — one near, one far. The art is
    // drawn leftward from its own trailing edge, so a small negative angle
    // sweeps it back and up without the 180° flip that would invert the spar.
    // BOTH wings sit BEHIND the cage. The near one used to be drawn in front of
    // it at depth 48, and since its membrane hangs nine pixels below its own spar
    // it covered the ribs completely — hiding the one feature the unit is. The
    // cage is the identity; the wings frame it.
    //
    // Swept up as well as back, so the membrane hangs into empty air above the
    // cage rather than across it.
    bone('wingF', 'root', { x: -0.02, y: 0.08, angle: -0.45, part: 'wingF', orient: 'right', depth: 26 }),
    bone('wingB', 'root', { x: -0.07, y: 0.03, angle: -0.95, part: 'wingB', orient: 'right', depth: 8 }),
    // Trailing legs. They never touch anything.
    bone('legF', 'cage', { x: 0.02, y: 0.05, angle: -0.2, length: 0.14, part: 'legF', depth: 44 }),
    bone('legF2', 'legF', { angle: 0.3, length: 0.12, part: 'legF2', depth: 45 }),
    bone('legB', 'cage', { x: 0.02, y: -0.05, angle: -0.1, length: 0.13, part: 'legB', depth: 6 }),
    bone('legB2', 'legB', { angle: 0.35, length: 0.11, part: 'legB2', depth: 7 })
  ]
  validateSkeleton(s, 'widow')
  return s
}

/**
 * The beat. Slow, deep, and the body RISES ON THE UPSTROKE and sinks on the
 * down — the opposite of what people expect, and what makes big wings read as
 * carrying weight. The legs trail a beat behind everything.
 */
const WIDOW_WALK: Clip = {
  name: 'walk',
  duration: 700,
  loop: true,
  ease: 'sine',
  keys: [
    // THE FAR WING LAGS, and beats through a shallower arc. Both wings used to
    // sit within a tenth of a radian of each other for the whole cycle, so they
    // drew on top of one another and the Widow appeared to have one wing. A 2D
    // side view sells a wingbeat through foreshortening and phase, not amplitude.
    { t: 0, pose: { wingF: { angle: -0.9 }, wingB: { angle: 0.34 }, root: { y: -0.02 }, cage: { angle: 0.06 }, legF: { angle: 0.2 }, legB: { angle: 0.16 } } },
    { t: 0.3, pose: { wingF: { angle: 0.55 }, wingB: { angle: -0.46 }, root: { y: 0.024 }, cage: { angle: -0.05 }, legF: { angle: -0.16 }, legB: { angle: -0.12 } }, ease: 'quad' },
    { t: 0.55, pose: { wingF: { angle: 0.7 }, wingB: { angle: 0.1 }, root: { y: 0.014 }, cage: { angle: 0 }, legF: { angle: 0.24 }, legB: { angle: 0.2 } } },
    { t: 0.8, pose: { wingF: { angle: -0.5 }, wingB: { angle: 0.42 }, root: { y: -0.014 }, cage: { angle: 0.04 }, legF: { angle: 0.1 }, legB: { angle: 0.06 } }, ease: 'cubic' }
  ]
}

/** A stoop: wings fold, it drops onto the target, wings flare to stop. */
const WIDOW_ATTACK: Clip = {
  name: 'attack',
  duration: 640,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { wingF: { angle: -0.3 }, wingB: { angle: 0.2 }, cage: { angle: 0 } } },
    // Both wings FOLD for the stoop — this is the one beat where they agree, and
    // it reads as commitment precisely because they are apart the rest of the time.
    { t: 0.24, pose: { wingF: { angle: 1.1 }, wingB: { angle: 0.95 }, cage: { angle: 0.2 }, root: { y: 0.03 } }, ease: 'cubic' },
    { t: 0.42, pose: { wingF: { angle: 1.3 }, wingB: { angle: 1.16 }, cage: { angle: 0.34 }, root: { y: 0.05 } }, ease: 'hold' },
    // And flare, hard, out of phase again to stop the dive.
    { t: 0.66, pose: { wingF: { angle: -1.1 }, wingB: { angle: -0.5 }, cage: { angle: -0.1 }, root: { y: -0.02 } }, ease: 'back' },
    { t: 1, pose: { wingF: { angle: -0.3 }, wingB: { angle: 0.2 }, cage: { angle: 0 }, root: { y: 0 } } }
  ]
}

const WIDOW_IDLE: Clip = WIDOW_WALK

function widowParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const t = art(0.04, height)
  return {
    cage: widowCage(height, k),
    wingF: widowWing(height, k, 150),
    wingB: widowWing(height, k, 151),
    legF: softLimb(art(0.14, height), t, k, 152),
    legF2: softLimb(art(0.12, height), t * 0.8, k, 153),
    legB: softLimb(art(0.13, height), t * 0.9, k, 154, k.necrotic),
    legB2: softLimb(art(0.11, height), t * 0.75, k, 155, k.necrotic)
  }
}


// ──────────────────────────── THE BRAIN STEALER ────────────────────────────

/**
 * A MOUND, and the only body in the army with no head and no visible legs.
 *
 * Everything else in the creed is built from something that used to walk. This
 * is built from something that used to be a heap: a low blistered mass, wider
 * than it is tall, that gets across the ground by ROLLING its own weight from
 * one side to the other. Two stub feet paddle underneath and never leave it.
 *
 * The read has to survive being the slowest thing on the board, so the
 * silhouette does all the work — a flat wide dome breaks the skyline of a rank
 * of uprights. The brood sac is a pale swelling in the top-forward quadrant of
 * the same shape, with the opening cut into it — the one bright thing on a
 * mid-toned heap, so the eye knows which end throws.
 */
function moundBody(height: number, k: FleshKit, big: boolean): PartArt {
  const w = art(big ? 0.92 : 0.8, height)
  const h = art(big ? 0.44 : 0.4, height)
  const p = pad(w, h)
  const cx = p.w / 2
  const cy = p.h * 0.62
  // Wider at the bottom than a sphere would be: it is sitting on itself.
  fleshMass(p, cx, cy, w * 0.5, h * 0.46, k.hide, 3, 11)
  // A gut shadow INSIDE the dome, not a stripe along the bottom of it. Drawn in
  // fat at nearly full width it came out as a pale band under the whole body,
  // which the rim then outlined — the mound read as a plank rather than a heap.
  fleshMass(p, cx - w * 0.08, cy + h * 0.12, w * 0.3, h * 0.2, k.meat, 4, 13)
  // Blisters along the CROWN only, and small.
  //
  // The first pass put nine of them across the whole body at radius two to four.
  // The canvas is twenty-five pixels by twelve, so that is a row of pale lumps
  // most of a body-height across: it stopped reading as blistered skin and
  // started reading as a cart carrying a row of skulls — which is the Carrion
  // Choir's silhouette, the one thing this body must not be mistaken for. Five,
  // small, and above the waterline, so the dome stays a dome.
  for (let i = 0; i < 5; i += 1) {
    const t = i / 4
    const bx = cx - w * 0.3 + t * w * 0.6
    const by = cy - h * 0.26 + Math.sin(t * Math.PI) * -h * 0.1
    pustule(p, bx, by, 1.4 + (i % 2) * 0.7, k)
  }
  // A seam round the middle where the two halves of it have grown together.
  suture(p, cx - w * 0.44, cy + h * 0.06, cx + w * 0.42, cy + h * 0.03, k)
  // THE BROOD SAC IS PART OF THE SAME CANVAS.
  //
  // It was its own part on its own bone, and at six pixels by five it could not
  // carry a swelling, an opening, a rim and an outline — it came back as a dark
  // cap on top of a wide body, which reads as a hooded man on a cart. There is
  // no pixel budget for a separate head-sized object on a body twelve pixels
  // tall, so the sac is a pale swelling in the top-forward quadrant of the mound
  // itself, with the opening cut into it. One shape, and it cannot go wrong.
  const sx = cx + w * 0.2
  const sy = cy - h * 0.34
  fleshMass(p, sx, sy, w * 0.22, h * 0.3, k.fat, 4, 17)
  maw(p, sx + w * 0.06, sy - h * 0.12, w * 0.14, h * 0.14, k, 3)
  return { canvas: finish(p, k, 21, 1.2) as Canvas2D, origin: [cx / p.w, cy / p.h] }
}

/** A stub. Barely a leg — a foot on a wrist, doing all the walking. */
function stubFoot(height: number, k: FleshKit, seed: number): PartArt {
  const w = art(0.15, height)
  const h = art(0.13, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.44, w * 0.42, h * 0.4, k.meat, 3, seed)
  claw(p, cx, Math.round(p.h * 0.6), Math.round(h * 0.4), k)
  return { canvas: finishSmall(p, k, seed) as Canvas2D, origin: [cx / p.w, 0.2] }
}

const MOUND_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.2, depth: 30 }),
    // The mass tips rather than bends: one bone, and the walk rolls it.
    bone('mass', 'root', { angle: -Math.PI / 2, length: 0.3, part: 'mass', orient: 'up', depth: 30, weights: { breathe: 1.4, lean: 0.5 } }),
    bone('footF', 'root', { x: 0.12, y: 0.13, angle: Math.PI / 2, length: 0.13, part: 'footF', depth: 40 }),
    bone('footB', 'root', { x: -0.12, y: 0.13, angle: Math.PI / 2, length: 0.13, part: 'footB', depth: 10 })
  ]
  validateSkeleton(s, 'brainstealer')
  return s
}

/**
 * THE ROLL. Not a gait — a series of controlled falls.
 *
 * The whole mass leans hard one way, the stub on that side takes the weight and
 * paddles, and then it falls back the other way. `root.x` moves with the lean so
 * the body genuinely travels on the tip rather than sliding while it wobbles,
 * which is the difference between reading as a rolling weight and reading as a
 * sprite being shaken.
 */
const MOUND_WALK: Clip = {
  name: 'walk',
  duration: 1500,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { root: { x: -0.012, y: 0.004 }, mass: { angle: -0.13 }, footF: { angle: -0.32 }, footB: { angle: 0.26 } } },
    { t: 0.25, pose: { root: { x: 0, y: -0.016 }, mass: { angle: 0 }, footF: { angle: 0.1 }, footB: { angle: 0.1 } } },
    { t: 0.5, pose: { root: { x: 0.012, y: 0.004 }, mass: { angle: 0.13 }, footF: { angle: 0.26 }, footB: { angle: -0.32 } } },
    { t: 0.75, pose: { root: { x: 0, y: -0.016 }, mass: { angle: 0 }, footF: { angle: 0.1 }, footB: { angle: 0.1 } } }
  ]
}

/**
 * THE THROW. It rears back onto its heels, holds, and then kicks the whole mass
 * forward and rocks back off it — the thing being thrown is heavy relative to the
 * thing throwing it. There are no arms and no separate sac to animate; the recoil
 * IS the animation, which is why the mass gets a hold frame at full extension.
 */
const MOUND_ATTACK: Clip = {
  name: 'attack',
  duration: 900,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { mass: { angle: 0 } } },
    // Clench, and rear.
    { t: 0.34, pose: { root: { y: 0.01 }, mass: { angle: -0.2 } }, ease: 'cubic' },
    // Kick. One frame held at full extension so the release reads.
    { t: 0.5, pose: { root: { y: -0.012 }, mass: { angle: 0.12 } }, ease: 'hold' },
    { t: 0.7, pose: { root: { y: 0.006 }, mass: { angle: -0.1 } } },
    { t: 1, pose: { root: { y: 0 }, mass: { angle: 0 } }, ease: 'back' }
  ]
}

/** Idle: it breathes, and the whole heap shifts as things move inside it. */
const MOUND_IDLE: Clip = {
  name: 'idle',
  duration: 3800,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { mass: { angle: -0.03 } } },
    { t: 0.4, pose: { mass: { angle: 0.02 } } },
    { t: 0.7, pose: { mass: { angle: -0.01 } } }
  ]
}

function moundParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  // The Brood Nurse is the same animal with more of it — the tier bump the
  // vision document describes — so it takes this plan at a larger bulk rather
  // than a second body that would have to be told apart from the first.
  const big = (v.bulk ?? 1) > 1.45
  return {
    mass: moundBody(height, k, big),
    footF: stubFoot(height, k, 25),
    footB: stubFoot(height, k, 26)
  }
}

// ───────────────────────────── THE MIND FLAYER ─────────────────────────────

/**
 * A ROBE WITH NOTHING UNDER IT, and a face that is a curtain.
 *
 * The mound throws. This one does not throw anything, and the body has to say
 * so: no arms held ready, no opening, nothing that could be a muzzle. It is a
 * tall narrow cone that never breaks its outline — it GLIDES, hem dragging, and
 * the only things that move are the tentacles hanging where a face should be and
 * two thin arms held out to either side like a man feeling his way in the dark.
 *
 * Against the mound it is the exact opposite silhouette: tall where that is
 * wide, still where that rocks, vertical where that is horizontal. Two bodies in
 * one line have to be told apart at a glance, and height is the cheapest way.
 */
function flayerRobe(height: number, k: FleshKit): PartArt {
  const w = art(0.4, height)
  const h = art(0.72, height)
  const p = pad(w, h)
  const cx = p.w / 2
  // A cone, drawn column by column so the hem flares and the shoulders taper.
  const noise = pixelNoise(931)
  for (let i = 0; i < h; i += 1) {
    const t = i / Math.max(1, h - 1)
    const wid = Math.max(2, Math.round(w * (0.2 + t * 0.78) * (0.95 + noise(i, 5) * 0.1)))
    for (let o = 0; o < wid; o += 1) {
      const sh = o / Math.max(1, wid - 1)
      const shade = sh < 0.16 ? 1 : sh < 0.4 ? 2 : sh < 0.74 ? 3 : 2
      p.set(Math.round(cx - wid / 2 + o), 2 + i, k.cavity[shade])
    }
  }
  // Vertical folds. Three, not ten: at twenty pixels wide the fourth is noise.
  for (let f = 0; f < 3; f += 1) {
    const fx = cx - w * 0.24 + f * w * 0.24
    for (let i = Math.round(h * 0.3); i < h; i += 1) p.set(Math.round(fx + (i - h * 0.3) * 0.06), 2 + i, k.cavity[1])
  }
  spine(p, cx, p.h * 0.22, cx, p.h * 0.8, k, 7)
  return { canvas: finish(p, k, 31, 0.7) as Canvas2D, origin: [cx / p.w, 1] }
}

/** The crown: a smooth lobe, no eyes, no mouth. The tentacles are the face. */
function flayerCrown(height: number, k: FleshKit): PartArt {
  const w = art(0.2, height)
  const h = art(0.18, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.5, w * 0.44, h * 0.46, k.hide, 3, 33)
  // One dark band where a brow would be, which is all the face it gets.
  p.fill(Math.round(cx - w * 0.3), Math.round(p.h * 0.52), Math.max(2, Math.round(w * 0.6)), 1, k.cavity[1])
  return { canvas: finishSmall(p, k, 33) as Canvas2D, origin: [cx / p.w, 0.86] }
}

const FLAYER_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.5, depth: 30 }),
    bone('robe', 'root', { angle: Math.PI / 2, length: 0.7, part: 'robe', depth: 30, weights: { breathe: 0.6, lean: 1 } }),
    bone('crown', 'root', { angle: -Math.PI / 2, length: 0.16, part: 'crown', orient: 'up', depth: 35, weights: { flinch: 1 } }),
    // Six of them, hanging DOWN from the crown — a curtain, not a beard.
    bone('f1', 'crown', { x: -0.03, angle: Math.PI - 0.1, length: 0.15, part: 'f1', depth: 36 }),
    bone('f2', 'crown', { x: -0.01, angle: Math.PI + 0.06, length: 0.17, part: 'f2', depth: 37 }),
    bone('f3', 'crown', { x: 0.02, angle: Math.PI + 0.2, length: 0.14, part: 'f3', depth: 38 }),
    bone('f4', 'crown', { x: 0.04, angle: Math.PI + 0.34, length: 0.12, part: 'f4', depth: 39 }),
    // Two thin arms, held out. They never strike anything.
    bone('armF', 'root', { x: 0.03, y: -0.16, angle: Math.PI - 0.9, length: 0.3, part: 'armF', depth: 42, weights: { aim: 0.5 } }),
    bone('armB', 'root', { x: -0.03, y: -0.16, angle: Math.PI - 1.5, length: 0.28, part: 'armB', depth: 14, weights: { aim: 0.4 } })
  ]
  validateSkeleton(s, 'mindflayer')
  return s
}

/** No gait at all. The hem drags and the curtain swings a beat behind it. */
const FLAYER_WALK: Clip = {
  name: 'walk',
  duration: 1700,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { root: { y: -0.004 }, robe: { angle: -0.03 }, f1: { angle: 0.16 }, f2: { angle: 0.1 }, f3: { angle: 0.2 }, f4: { angle: 0.06 } } },
    { t: 0.5, pose: { root: { y: 0.004 }, robe: { angle: 0.03 }, f1: { angle: -0.14 }, f2: { angle: -0.08 }, f3: { angle: -0.18 }, f4: { angle: -0.04 } } }
  ]
}

/**
 * THE SEEDING. Arms open wide, the curtain lifts, and everything shivers
 * outward at once — a body opening rather than a body striking. Nothing about it
 * travels toward the target, because the rule does not either.
 */
const FLAYER_ATTACK: Clip = {
  name: 'attack',
  duration: 1100,
  loop: false,
  ease: 'sine',
  keys: [
    { t: 0, pose: { armF: { angle: 0 }, armB: { angle: 0 }, f1: { angle: 0 }, f2: { angle: 0 }, f3: { angle: 0 }, f4: { angle: 0 } } },
    { t: 0.3, pose: { armF: { angle: -0.5 }, armB: { angle: 0.4 }, crown: { angle: -0.1 }, f1: { angle: -0.5 }, f2: { angle: -0.35 }, f3: { angle: -0.55 }, f4: { angle: -0.3 } }, ease: 'cubic' },
    { t: 0.55, pose: { armF: { angle: -0.9 }, armB: { angle: 0.8 }, crown: { angle: 0.06 }, f1: { angle: -0.9 }, f2: { angle: -0.7 }, f3: { angle: -1 }, f4: { angle: -0.6 } }, ease: 'hold' },
    { t: 1, pose: { armF: { angle: 0 }, armB: { angle: 0 }, crown: { angle: 0 }, f1: { angle: 0 }, f2: { angle: 0 }, f3: { angle: 0 }, f4: { angle: 0 } }, ease: 'back' }
  ]
}

/** Idle: only the curtain moves, and never all of it together. */
const FLAYER_IDLE: Clip = {
  name: 'idle',
  duration: 4200,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { f1: { angle: 0.12 }, f2: { angle: -0.08 }, f3: { angle: 0.16 }, f4: { angle: -0.1 } } },
    { t: 0.3, pose: { f1: { angle: -0.1 }, f2: { angle: 0.14 }, f3: { angle: -0.06 }, f4: { angle: 0.12 } } },
    { t: 0.65, pose: { f1: { angle: 0.08 }, f2: { angle: -0.12 }, f3: { angle: 0.1 }, f4: { angle: -0.14 } } }
  ]
}

function flayerParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const t = Math.max(3, art(0.03, height))
  return {
    robe: flayerRobe(height, k),
    crown: flayerCrown(height, k),
    f1: softLimb(art(0.15, height), t, k, 41, k.membrane),
    f2: softLimb(art(0.17, height), t, k, 42, k.membrane),
    f3: softLimb(art(0.14, height), t * 0.9, k, 43, k.membrane),
    f4: softLimb(art(0.12, height), t * 0.9, k, 44, k.membrane),
    armF: softLimb(art(0.3, height), t * 1.1, k, 45),
    armB: softLimb(art(0.28, height), t, k, 46)
  }
}



// ───────────────────────────── APEX MUTATIONS ─────────────────────────────

/** A parasite torso fused onto the back of the animal it is wearing. */
function skinriderBody(height: number, k: FleshKit): PartArt {
  const w = art(0.25, height)
  const h = art(0.34, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.56, w * 0.42, h * 0.42, k.necrotic, 3, 240)
  ribCage(p, cx - w * 0.22, p.h * 0.3, w * 0.46, h * 0.36, k, 4, 1)
  spine(p, cx, p.h * 0.12, cx, p.h * 0.86, k, 7)
  // The skin-hook that says this body is mounted, not riding willingly.
  boneSpur(p, cx - w * 0.35, p.h * 0.72, art(0.11, height), 2.6, k)
  boneSpur(p, cx + w * 0.35, p.h * 0.72, art(0.11, height), 0.55, k)
  return { canvas: finish(p, k, 240, 0.8), origin: [cx / p.w, (p.h - 2) / p.h] }
}

function skinriderHead(height: number, k: FleshKit): PartArt {
  const r = art(0.09, height)
  const p = pad(r * 2.4, r * 2.2)
  const cx = p.w / 2
  const cy = p.h * 0.5
  p.ellipse(cx, cy, r * 0.78, r * 0.9, k.bone[2])
  p.ellipse(cx + r * 0.18, cy - r * 0.2, r * 0.45, r * 0.42, k.bone[4])
  p.fill(Math.round(cx - r * 0.25), Math.round(cy), Math.max(2, Math.round(r * 0.6)), 1, k.cavity[0])
  p.set(Math.round(cx + r * 0.12), Math.round(cy - r * 0.18), k.accent[4])
  return { canvas: finishSmall(p, k, 241), origin: [cx / p.w, 0.82] }
}

const SKINRIDER_SKELETON = (): Skeleton => {
  const s = RIPJAW_SKELETON()
  s.push(
    bone('rider', 'body', { x: -0.08, y: -0.08, angle: -Math.PI / 2 + 0.12, length: 0.28, part: 'rider', orient: 'up', depth: 55, weights: { breathe: 1, lean: 1 } }),
    bone('riderHead', 'rider', { angle: -0.08, length: 0.12, part: 'riderHead', orient: 'up', depth: 56, weights: { flinch: 1 } }),
    bone('hookF', 'rider', { x: 0.02, y: -0.04, angle: 1.4, length: 0.24, part: 'hookF', depth: 57 }),
    bone('hookB', 'rider', { x: -0.03, y: -0.04, angle: 1.85, length: 0.22, part: 'hookB', depth: 18 })
  )
  validateSkeleton(s, 'skinrider')
  return s
}

function skinriderParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const parts = ripjawParts(v, height)
  parts.rider = skinriderBody(height, k)
  parts.riderHead = skinriderHead(height, k)
  parts.hookF = softLimb(art(0.25, height), Math.max(3, art(0.04, height)), k, 242, k.necrotic)
  parts.hookB = softLimb(art(0.23, height), Math.max(3, art(0.038, height)), k, 243, k.necrotic)
  return parts
}

/** The Charnel Engine's vertical mill: rollers, furnace throat and bone stack. */
function engineMill(height: number, k: FleshKit): PartArt {
  const w = art(0.44, height)
  const h = art(0.58, height)
  const p = pad(w, h)
  const cx = p.w / 2
  // Iron cage around a breathing flesh core.
  p.fill(3, 4, w - 2, h - 2, k.iron[1])
  p.fill(5, 6, w - 6, h - 6, k.cavity[0])
  fleshMass(p, cx, p.h * 0.48, w * 0.34, h * 0.34, k.meat, 5, 250)
  // Three crushing rollers; bright bone teeth give the machine its read.
  for (let i = 0; i < 3; i += 1) {
    const y = p.h * (0.26 + i * 0.22)
    p.ellipse(cx, y, w * 0.34, h * 0.075, k.iron[2])
    p.ellipseFrame(cx, y, w * 0.34, h * 0.075, k.bone[3])
    for (let x = -3; x <= 3; x += 1) p.set(Math.round(cx + x * w * 0.08), Math.round(y), k.bone[4])
  }
  maw(p, cx, p.h * 0.82, w * 0.18, h * 0.08, k, 8, 251)
  return { canvas: finish(p, k, 250, 0.65), origin: [cx / p.w, (p.h - 2) / p.h] }
}

function engineStack(height: number, k: FleshKit): PartArt {
  const w = art(0.14, height)
  const h = art(0.42, height)
  const p = pad(w, h)
  const cx = p.w / 2
  p.fill(Math.round(cx - w * 0.28), 2, Math.max(2, Math.round(w * 0.56)), h, k.bone[2])
  p.fill(Math.round(cx - w * 0.18), 2, Math.max(1, Math.round(w * 0.2)), h, k.bone[4])
  for (let y = 4; y < h; y += 4) p.fill(Math.round(cx - w * 0.42), y, Math.max(2, Math.round(w * 0.84)), 1, k.iron[2])
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 1] }
}

const CHARNEL_ENGINE_SKELETON = (): Skeleton => {
  const s = WAGON_SKELETON()
  s.push(
    bone('mill', 'tub', { y: -0.08, angle: -Math.PI / 2, length: 0.42, part: 'mill', orient: 'up', depth: 52, weights: { breathe: 0.5 } }),
    bone('stack', 'mill', { x: -0.1, y: -0.05, angle: -Math.PI / 2, length: 0.28, part: 'stack', orient: 'up', depth: 51 })
  )
  validateSkeleton(s, 'charnelengine')
  return s
}

function charnelEngineParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const parts = wagonParts(v, height)
  parts.mill = engineMill(height, k)
  parts.stack = engineStack(height, k)
  return parts
}

/** A swollen egg-throne suspended below the Queen's rib cage. */
function queenSac(height: number, k: FleshKit): PartArt {
  const w = art(0.42, height)
  const h = art(0.38, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.52, w * 0.46, h * 0.44, k.fat, 4, 260)
  for (let i = 0; i < 5; i += 1) pustule(p, cx - w * 0.25 + i * w * 0.13, p.h * (0.42 + (i % 2) * 0.16), 2.2, k)
  suture(p, cx - w * 0.32, p.h * 0.25, cx + w * 0.32, p.h * 0.72, k)
  return { canvas: finish(p, k, 260, 1.15), origin: [cx / p.w, 0.12] }
}

function queenCrown(height: number, k: FleshKit): PartArt {
  const w = art(0.34, height)
  const h = art(0.22, height)
  const p = pad(w, h)
  const cx = p.w / 2
  p.ellipse(cx, p.h * 0.62, w * 0.28, h * 0.22, k.bone[2])
  for (let i = 0; i < 7; i += 1) boneSpur(p, cx - w * 0.32 + i * w * 0.105, p.h * 0.56, art(0.09, height), -2.4 + i * 0.26, k)
  p.set(Math.round(cx), Math.round(p.h * 0.6), k.accent[4])
  return { canvas: finishSmall(p, k, 261), origin: [cx / p.w, 0.9] }
}

const WIDOW_QUEEN_SKELETON = (): Skeleton => {
  const s = WIDOW_SKELETON()
  s.push(
    bone('sac', 'cage', { y: 0.14, angle: Math.PI / 2, length: 0.26, part: 'sac', depth: 29, weights: { breathe: 1 } }),
    bone('crown', 'cage', { y: -0.08, angle: -Math.PI / 2, length: 0.16, part: 'crown', orient: 'up', depth: 52 })
  )
  validateSkeleton(s, 'widowqueen')
  return s
}

function widowQueenParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const parts = widowParts(v, height)
  parts.sac = queenSac(height, k)
  parts.crown = queenCrown(height, k)
  // Queen wings are visibly longer and more ragged than the hunter's.
  parts.wingF = widowWing(height * 1.18, k, 262)
  parts.wingB = widowWing(height * 1.12, k, 263)
  return parts
}

/** The capstone torso: a ribbed demon column with an open furnace-heart. */
/**
 * THE INCARNATION'S TORSO. Narrow on purpose.
 *
 * Every other horror in this file is built out of MASS — a Monstrum is a heap,
 * a Maw is jaws with a body trailing behind. This one is the opposite argument:
 * it is the tallest thing the faction fields and one of the thinnest, so it
 * reads as a lord standing among its own animals rather than the biggest animal.
 *
 * Which means the silhouette has to survive being narrow. The ribs run the full
 * height rather than clustering at the chest, and the radial scar sits high, so
 * at battle zoom the shape is a long pale column with a red star in it.
 */
function incarnationTorso(height: number, k: FleshKit): PartArt {
  const w = art(0.23, height)
  const h = art(0.42, height)
  const p = pad(w, h)
  const cx = p.w / 2
  fleshMass(p, cx, p.h * 0.58, w * 0.33, h * 0.44, k.necrotic, 5, 270)
  ribCage(p, cx - w * 0.25, p.h * 0.2, w * 0.5, h * 0.44, k, 8, 1)
  spine(p, cx, p.h * 0.04, cx, p.h * 0.96, k, 13)
  // A narrow waist, so the ribs above it read as a cage rather than a barrel.
  p.ellipse(cx, p.h * 0.82, w * 0.2, h * 0.13, k.necrotic[2])
  // The scar it is named for. Six arms, not eight: fewer and longer survives
  // the smaller canvas a slender body gets.
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2
    p.thickLine(cx, p.h * 0.42, cx + Math.cos(a) * w * 0.26, p.h * 0.42 + Math.sin(a) * h * 0.22, 1, k.accent[3])
  }
  return { canvas: finish(p, k, 270, 1.2), origin: [cx / p.w, (p.h - 2) / p.h] }
}

/**
 * A long skull under a crown of horns.
 *
 * The horns are the read at distance, not the face — a head this size is eight
 * pixels of skull at battle zoom, and eight pixels cannot carry an expression.
 * So the canvas is mostly empty air above the skull with four spurs sweeping
 * back into it, which is what makes the silhouette legible from across the field.
 */
function incarnationHead(height: number, k: FleshKit): PartArt {
  const r = art(0.075, height)
  const horn = art(0.19, height)
  const p = pad(r * 5.2, r * 2.4 + horn)
  const cx = p.w / 2
  const cy = p.h - r * 1.4
  // Long and narrow rather than round: a stag's skull, not a man's.
  p.ellipse(cx, cy, r * 0.58, r * 1.08, k.bone[2])
  p.ellipse(cx, cy + r * 0.62, r * 0.4, r * 0.46, k.bone[1])
  maw(p, cx, cy + r * 0.78, r * 0.32, r * 0.28, k, 7, 272)
  eyeCluster(p, cx, cy - r * 0.34, r * 0.28, k, 3, 273)
  // The crown: a tall outer pair swept back, a shorter inner pair inside them.
  boneSpur(p, cx - r * 0.46, cy - r * 0.8, horn, -2.05, k)
  boneSpur(p, cx + r * 0.4, cy - r * 0.8, horn, -1.16, k)
  boneSpur(p, cx - r * 0.16, cy - r * 0.98, horn * 0.62, -1.82, k)
  boneSpur(p, cx + r * 0.14, cy - r * 0.98, horn * 0.62, -1.36, k)
  return { canvas: finish(p, k, 272, 1.0), origin: [cx / p.w, (cy + r * 1.1) / p.h] }
}

/**
 * THE SWORD. Longer than the legs, and the reason the pose works.
 *
 * A slender body swinging a small blade reads as a skirmisher. The whole point
 * of this one is that a single swing clears a clump, so the weapon has to be
 * absurd — bone grown into a blade, held one-handed by something that should
 * not be able to lift it.
 */
function incarnationSword(height: number, k: FleshKit): PartArt {
  const len = art(0.66, height)
  const wide = Math.max(3, art(0.05, height))
  const p = pad(wide * 2.6, len)
  const cx = p.w / 2
  const grip = Math.max(3, Math.round(len * 0.14))
  const base = p.h - 3
  const guard = base - grip
  p.thickLine(cx, base, cx, guard, Math.max(2, Math.round(wide * 0.3)), k.iron[1])
  // Crossguard, grown rather than forged.
  boneSpur(p, cx, guard, wide * 1.05, -0.42, k)
  boneSpur(p, cx, guard, wide * 1.05, Math.PI + 0.42, k)
  // Blade: a slow taper, so it is a cleaver at the guard and a point at the tip.
  const tip = 3
  for (let y = guard - 1; y >= tip; y -= 1) {
    const t = (guard - 1 - y) / Math.max(1, guard - 1 - tip)
    const bw = Math.max(1, Math.round(wide * (1 - t * 0.66)))
    for (let o = 0; o < bw; o += 1) {
      const s = bw <= 1 ? 0.5 : o / (bw - 1)
      p.set(Math.round(cx - bw / 2 + o), y, k.iron[s < 0.22 ? 0 : s < 0.52 ? 1 : s < 0.82 ? 2 : 3])
    }
  }
  // The fed edge. One accent line down the cutting side is the only colour on
  // the weapon, so the eye follows the blade rather than the arm holding it.
  p.line(cx + Math.round(wide * 0.4), guard - 2, cx, tip + 2, k.accent[2])
  return { canvas: finishSmall(p, k, 279), origin: [cx / p.w, base / p.h] }
}

/**
 * A hanging drape, tattered at the hem.
 *
 * It does no anatomical work — it exists so the walk has something trailing a
 * beat behind it, which is most of what makes a tall thin body read as heavy
 * rather than spindly.
 */
function incarnationCape(height: number, k: FleshKit): PartArt {
  const w = art(0.36, height)
  const h = art(0.5, height)
  const p = pad(w, h)
  const cx = p.w / 2
  const noise = pixelNoise(281 * 977 + 11)
  for (let y = 0; y < h; y += 1) {
    const t = y / Math.max(1, h - 1)
    let half = w * (0.16 + t * 0.3)
    // Tatters: the last fifth is eaten into by a per-column ragged edge.
    if (t > 0.78) half -= noise(y, 7) * w * 0.3
    if (half <= 0.5) continue
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x += 1) {
      const s = Math.abs(x - cx) / Math.max(1, half)
      p.set(x, 2 + y, k.necrotic[s < 0.28 ? 1 : s < 0.66 ? 2 : 3])
    }
  }
  return { canvas: finishSmall(p, k, 281), origin: [cx / p.w, 2 / p.h] }
}

function incarnationClaw(height: number, k: FleshKit, seed: number): PartArt {
  const size = art(0.11, height)
  const p = pad(size * 3, size * 2.2)
  const cx = p.w / 2
  p.ellipse(cx, 3, size * 0.82, size * 0.62, k.meat[2])
  for (let i = -1; i <= 1; i += 1) claw(p, cx + i * size * 0.5, 3, size * (1.3 - Math.abs(i) * 0.15), k)
  blemish(p, k, seed, 0.01)
  return { canvas: p.toCanvas() as Canvas2D, origin: [cx / p.w, 2 / p.h] }
}

/**
 * A LORD, NOT A BEAST. Two arms, two legs, and every segment long.
 *
 * The previous rig was a four-armed clawed horror — the right answer when the
 * capstone was a possession that wore somebody else's body, and the wrong one
 * for something that walks on carrying a sword. Everything here is stretched
 * instead of thickened: the legs are nearly half the total height, the torso
 * rides high on them, and the head sits above the shoulders rather than between
 * them, which is the difference between a tall man and a big animal.
 */
const INCARNATION_SKELETON = (): Skeleton => {
  const s: Skeleton = [
    bone('root', null, { y: -0.52, depth: 30 }),
    bone('torso', 'root', { angle: -Math.PI / 2 + 0.06, length: 0.4, part: 'torso', orient: 'up', depth: 31, weights: { breathe: 1, lean: 1, flinch: 1 } }),
    // Behind everything, and hung off the shoulders so it swings from the top.
    bone('cape', 'torso', { x: -0.04, y: -0.1, angle: 0.06, part: 'cape', orient: 'down', depth: 4 }),
    bone('neck', 'torso', { angle: -0.03, length: 0.07, depth: 54 }),
    bone('head', 'neck', { angle: -0.02, length: 0.14, part: 'head', orient: 'up', depth: 55, weights: { aim: 0.5, flinch: 1 } }),
    // SWORD ARM, in front. Long upper, long forearm, blade off the wrist.
    bone('armR', 'torso', { x: 0.035, y: -0.13, angle: 0.62, length: 0.23, part: 'armR', depth: 50 }),
    bone('foreR', 'armR', { angle: -0.34, length: 0.22, part: 'foreR', depth: 51 }),
    bone('sword', 'foreR', { angle: 0.24, part: 'sword', orient: 'up', depth: 58 }),
    // Off hand, behind the torso.
    bone('armL', 'torso', { x: -0.035, y: -0.11, angle: 2.42, length: 0.22, part: 'armL', depth: 12 }),
    bone('foreL', 'armL', { angle: 0.46, length: 0.21, part: 'foreL', depth: 13 }),
    bone('clawL', 'foreL', { angle: -0.12, part: 'clawL', depth: 14 }),
    bone('hipF', 'root', { x: 0.05, angle: Math.PI / 2, depth: 44 }),
    bone('thighF', 'hipF', { length: 0.26, part: 'thighF', depth: 44 }),
    bone('shinF', 'thighF', { angle: 0.3, length: 0.25, part: 'shinF', depth: 45 }),
    bone('footF', 'shinF', { angle: -0.24, part: 'footF', depth: 46 }),
    bone('hipB', 'root', { x: -0.06, angle: Math.PI / 2, depth: 8 }),
    bone('thighB', 'hipB', { length: 0.26, part: 'thighB', depth: 8 }),
    bone('shinB', 'thighB', { angle: 0.3, length: 0.25, part: 'shinB', depth: 9 }),
    bone('footB', 'shinB', { angle: -0.24, part: 'footB', depth: 10 })
  ]
  validateSkeleton(s, 'incarnation')
  return s
}

/**
 * A LONG, SLOW STRIDE. Half the speed of the footmen and twice the reach.
 *
 * The cape trails the torso by a beat rather than matching it — same swing,
 * opposite sign at the extremes — which is the cheapest way to make a thin
 * silhouette feel like it has weight behind it.
 */
const INCARNATION_WALK: Clip = {
  name: 'walk', duration: 1250, loop: true, ease: 'sine', keys: [
    { t: 0, pose: { root: { y: 0.016 }, thighF: { angle: 0.36 }, shinF: { angle: 0.42 }, thighB: { angle: -0.4 }, shinB: { angle: 0.16 }, cape: { angle: -0.14 }, armL: { angle: -0.12 }, armR: { angle: 0.1 } } },
    { t: 0.5, pose: { root: { y: -0.018 }, thighF: { angle: -0.4 }, shinF: { angle: 0.16 }, thighB: { angle: 0.36 }, shinB: { angle: 0.42 }, cape: { angle: 0.16 }, armL: { angle: 0.12 }, armR: { angle: -0.08 } } }
  ]
}
/**
 * ONE SWING, OVERHEAD, AND A LONG RECOVERY.
 *
 * The sim gives this body 1500 damage on a 3.2 s cooldown, so the animation has
 * to sell an execution rather than a rate of work: a slow wind-up that carries
 * the blade back past the shoulder, a fast fall, then a HOLD at the bottom —
 * the pause is what makes the swing look heavy and what makes it dodgeable.
 */
const INCARNATION_ATTACK: Clip = {
  name: 'attack', duration: 1150, loop: false, ease: 'quad', keys: [
    { t: 0, pose: { armR: { angle: 0 }, foreR: { angle: 0 }, sword: { angle: 0 }, torso: { angle: 0 } } },
    // Wind up: blade goes up and back, weight onto the back foot.
    { t: 0.34, pose: { torso: { angle: -0.22 }, armR: { angle: -1.35 }, foreR: { angle: -0.5 }, sword: { angle: -0.55 }, cape: { angle: -0.3 }, armL: { angle: 0.3 } }, ease: 'cubic' },
    // The fall.
    { t: 0.56, pose: { torso: { angle: 0.34 }, armR: { angle: 1.15 }, foreR: { angle: 0.32 }, sword: { angle: 0.4 }, cape: { angle: 0.34 }, armL: { angle: -0.24 } }, ease: 'hold' },
    // Blade stays buried a beat before it comes back up.
    { t: 0.74, pose: { torso: { angle: 0.28 }, armR: { angle: 1.05 }, foreR: { angle: 0.28 }, sword: { angle: 0.34 } }, ease: 'sine' },
    { t: 1, pose: { torso: { angle: 0 }, armR: { angle: 0 }, foreR: { angle: 0 }, sword: { angle: 0 }, cape: { angle: 0 }, armL: { angle: 0 } }, ease: 'back' }
  ]
}
/** Standing still: breathing, and the blade drifting under its own weight. */
const INCARNATION_IDLE: Clip = {
  name: 'idle', duration: 3600, loop: true, ease: 'sine', keys: [
    { t: 0, pose: { cape: { angle: -0.05 }, armR: { angle: 0.04 }, sword: { angle: -0.06 }, armL: { angle: -0.04 } } },
    { t: 0.5, pose: { cape: { angle: 0.06 }, armR: { angle: -0.03 }, sword: { angle: 0.05 }, armL: { angle: 0.04 } } }
  ]
}

/**
 * SLENDER IS A THICKNESS, NOT A HEIGHT.
 *
 * Limb thickness is the whole difference between this and the other horrors.
 * The Monstrum's legs are 0.07 of its height; these are 0.045 and carry a body
 * that is TALLER, so the same drawing vocabulary reads as a lord rather than a
 * beast. The back-side limbs take the necrotic ramp so the two sides separate
 * at a glance, which matters more on a thin body than a thick one — there is
 * less silhouette to tell them apart with.
 */
function incarnationParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const k = fleshKit(v.skin, v.cloth, v.accent)
  const arm = Math.max(4, art(0.04, height))
  const leg = Math.max(5, art(0.045, height))
  return {
    torso: incarnationTorso(height, k),
    head: incarnationHead(height, k),
    cape: incarnationCape(height, k),
    sword: incarnationSword(height, k),
    armR: softLimb(art(0.23, height), arm, k, 276),
    foreR: softLimb(art(0.22, height), arm * 0.88, k, 277),
    armL: softLimb(art(0.22, height), arm * 0.95, k, 282, k.necrotic),
    foreL: softLimb(art(0.21, height), arm * 0.84, k, 283, k.necrotic),
    clawL: incarnationClaw(height, k, 284),
    thighF: softLimb(art(0.26, height), leg, k, 288),
    shinF: softLimb(art(0.25, height), leg * 0.82, k, 289),
    footF: stubFoot(height * 0.85, k, 290),
    thighB: softLimb(art(0.26, height), leg, k, 291, k.necrotic),
    shinB: softLimb(art(0.25, height), leg * 0.82, k, 292, k.necrotic),
    footB: stubFoot(height * 0.85, k, 293)
  }
}

// ─────────────────────────────── Registration ───────────────────────────────

interface PlanSpec {
  skeleton: () => Skeleton
  parts: (v: UnitVisual, height: number) => Record<string, PartArt>
  clips: Record<ClipName, Clip>
  muzzle: [number, number]
}

const PLANS: Record<HorrorPlan, PlanSpec> = {
  monstrum: {
    skeleton: MONSTRUM_SKELETON,
    parts: monstrumParts,
    clips: { idle: MONSTRUM_IDLE, walk: rippleWalk(6, 900), attack: MONSTRUM_ATTACK },
    muzzle: [0.2, -0.4]
  },
  maw: { skeleton: MAW_SKELETON, parts: mawParts, clips: { idle: MAW_IDLE, walk: MAW_WALK, attack: MAW_ATTACK }, muzzle: [0.42, -0.34] },
  fleshwall: { skeleton: WALL_SKELETON, parts: wallParts, clips: { idle: WALL_IDLE, walk: WALL_WALK, attack: WALL_ATTACK }, muzzle: [0.2, -0.5] },
  ripjaw: { skeleton: RIPJAW_SKELETON, parts: ripjawParts, clips: { idle: RIPJAW_IDLE, walk: RIPJAW_WALK, attack: RIPJAW_ATTACK }, muzzle: [0.4, -0.36] },
  wagon: { skeleton: WAGON_SKELETON, parts: wagonParts, clips: { idle: WAGON_IDLE, walk: WAGON_WALK, attack: WAGON_ATTACK }, muzzle: [0.28, -0.3] },
  widow: { skeleton: WIDOW_SKELETON, parts: widowParts, clips: { idle: WIDOW_IDLE, walk: WIDOW_WALK, attack: WIDOW_ATTACK }, muzzle: [0.14, -0.1] },
  // The mound serves both rungs of the mind line's lower half: the Brood Nurse
  // is a tier bump, which the vision defines as the same body with more of it,
  // and `moundParts` reads the bulk to decide how much more.
  brainstealer: {
    skeleton: MOUND_SKELETON,
    parts: moundParts,
    clips: { idle: MOUND_IDLE, walk: MOUND_WALK, attack: MOUND_ATTACK },
    muzzle: [0.14, -0.46]
  },
  mindflayer: {
    skeleton: FLAYER_SKELETON,
    parts: flayerParts,
    clips: { idle: FLAYER_IDLE, walk: FLAYER_WALK, attack: FLAYER_ATTACK },
    muzzle: [0.1, -0.6]
  },
  skinrider: { skeleton: SKINRIDER_SKELETON, parts: skinriderParts, clips: { idle: RIPJAW_IDLE, walk: RIPJAW_WALK, attack: RIPJAW_ATTACK }, muzzle: [0.48, -0.52] },
  charnelengine: { skeleton: CHARNEL_ENGINE_SKELETON, parts: charnelEngineParts, clips: { idle: WAGON_IDLE, walk: WAGON_WALK, attack: WAGON_ATTACK }, muzzle: [0.28, -0.55] },
  widowqueen: { skeleton: WIDOW_QUEEN_SKELETON, parts: widowQueenParts, clips: { idle: WIDOW_IDLE, walk: WIDOW_WALK, attack: WIDOW_ATTACK }, muzzle: [0.18, -0.2] },
  incarnation: { skeleton: INCARNATION_SKELETON, parts: incarnationParts, clips: { idle: INCARNATION_IDLE, walk: INCARNATION_WALK, attack: INCARNATION_ATTACK }, muzzle: [0.42, -0.65] }
}

export const CARNAGE_HORROR_PLANS = Object.keys(PLANS) as HorrorPlan[]

export const carnageHorrorArchetype: Archetype = {
  id: 'carnage-horror',
  claims: v => v.plan !== undefined && PLANS[v.plan as HorrorPlan] !== undefined,
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const spec = PLANS[v.plan as HorrorPlan]
    if (!spec) throw new Error(`no carnage horror plan for ${String(v.plan)}`)
    return { skeleton: spec.skeleton(), parts: spec.parts(v, height), clips: spec.clips, height, muzzle: spec.muzzle }
  }
}
