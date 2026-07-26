import Pix, { RES, ramp, tone, type Ramp } from './pixel'
import type { Canvas2D } from './painter'

/**
 * The shared drawing vocabulary.
 *
 * Coherence is the hard part of this job. Thirty-two units across five ages
 * plus twenty-five faction units, all drawn by different hands at different
 * times, will look like thirty-two units unless every one of them is built
 * from the same primitives, lit from the same direction, and shaded with the
 * same number of steps. That is what this file is: the small set of marks
 * everything else is made of.
 *
 * ## The rules everything here obeys
 *
 * 1. **Light comes from the upper right.** Always. A lit edge is the top and
 *    the right; shadow is the bottom and the left. No exceptions, because the
 *    moment one sprite disagrees it reads as belonging to a different game.
 * 2. **Five tones per material, no more.** `ramp()` gives shadow, dark, base,
 *    light, highlight. A sixth tone at this scale is noise the instant the
 *    sprite moves.
 * 3. **The outline is a post-pass**, applied once to the finished part by
 *    `sealPart`. Outlining each shape as it is drawn turns a soldier into a
 *    pile of separately-outlined pieces.
 * 4. **Limb parts are authored pointing straight down**, with their origin at
 *    the joint they rotate about — the top-centre. The rig rotates them from
 *    there, so a thigh at rest hangs down and a thigh at bone-angle 0 points
 *    right. `boneRotation()` does that conversion in one place.
 * 5. **Nothing is drawn with the canvas path API.** Everything goes through
 *    `Pix`, on the integer grid, because a single antialiased curve gives the
 *    whole thing away.
 */

/** Breathing room so outlines and overhangs are never clipped off. */
export const PAD = 3

/**
 * A part texture is authored pointing down; a bone at angle 0 points right.
 * Every archetype converts with this rather than sprinkling `- Math.PI / 2`
 * through its own code, so the convention can never drift apart.
 */
export function boneRotation(boneAngle: number): number {
  return boneAngle - Math.PI / 2
}

/** A canvas sized for a part, with padding already allowed for. */
export function partCanvas(w: number, h: number): Pix {
  return new Pix(Math.max(1, Math.ceil(w) + PAD * 2), Math.max(1, Math.ceil(h) + PAD * 2))
}

/**
 * Wraps a finished part in its silhouette outline and hands back a canvas.
 *
 * One pixel, on the outside only. Darkening the sprite's own edge as well
 * looks richer on a large sprite and eats a third of a three-pixel forearm on
 * this one.
 */
export function sealPart(p: Pix, base: number): Canvas2D {
  p.outline(tone(base, -0.82), { diagonals: true })
  return p.toCanvas() as Canvas2D
}

// ───────────────────────────── Material handling ─────────────────────────────

/**
 * A material is a ramp plus the knowledge of how hard it catches light.
 *
 * Cloth is soft and barely specular; metal has a narrow, bright highlight;
 * skin sits between. Giving each its own contrast and hue shift is most of
 * what makes a plated knight read as metal and a robed cultist as cloth,
 * before a single detail is drawn.
 */
export interface Material {
  ramp: Ramp
  base: number
}

export function cloth(color: number): Material {
  return { ramp: ramp(color, { contrast: 0.72, hueShift: 0.03 }), base: color }
}

export function metal(color: number): Material {
  return { ramp: ramp(color, { contrast: 1.25, hueShift: 0.02 }), base: color }
}

export function skin(color: number): Material {
  return { ramp: ramp(color, { contrast: 0.62, hueShift: 0.05 }), base: color }
}

export function leather(color: number): Material {
  return { ramp: ramp(color, { contrast: 0.9, hueShift: 0.04 }), base: color }
}

export function energy(color: number): Material {
  return { ramp: ramp(color, { contrast: 1.5, hueShift: 0 }), base: color }
}

// ─────────────────────────────── Primitives ───────────────────────────────

/**
 * A shaded box: lit top row, base body, shadow along the bottom and the left
 * edge, a lit right edge. The workhorse for armour plates, crates and hulls.
 */
export function box(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  r: Ramp,
  opts: { flat?: boolean } = {}
): void {
  const W = Math.max(1, Math.round(w))
  const H = Math.max(1, Math.round(h))
  const X = Math.round(x)
  const Y = Math.round(y)
  p.fill(X, Y, W, H, r[2])
  if (opts.flat || H < 3 || W < 2) return
  p.fill(X, Y, W, 1, r[3])
  p.fill(X, Y + H - 1, W, 1, r[1])
  p.fill(X, Y, 1, H, r[1])
  if (W > 3) p.fill(X + W - 1, Y + 1, 1, H - 2, r[3])
}

/** A box with its corner pixels knocked out, so it reads as rounded. */
export function chamfer(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
  box(p, x, y, w, h, r)
  const X = Math.round(x)
  const Y = Math.round(y)
  const W = Math.max(1, Math.round(w))
  const H = Math.max(1, Math.round(h))
  if (W < 3 || H < 3) return
  p.set(X, Y, 0, 0)
  p.set(X + W - 1, Y, 0, 0)
  p.set(X, Y + H - 1, 0, 0)
  p.set(X + W - 1, Y + H - 1, 0, 0)
}

/** A shaded blob: shadow crescent down-left, core, lit crescent up-right. */
export function orb(p: Pix, cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
  p.ellipse(cx, cy, rx, ry, r[1])
  p.ellipse(cx + rx * 0.12, cy - ry * 0.12, rx * 0.88, ry * 0.88, r[2])
  if (rx >= 2.2 && ry >= 2.2) p.ellipse(cx + rx * 0.3, cy - ry * 0.32, rx * 0.5, ry * 0.5, r[3])
  if (rx >= 3.6 && ry >= 3.6) p.set(Math.round(cx + rx * 0.42), Math.round(cy - ry * 0.5), r[4])
}

/** A limb or haft drawn along a vector, lit on its upper side. */
export function shaft(
  p: Pix,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  r: Ramp
): void {
  p.thickLine(x0, y0, x1, y1, Math.max(1, Math.round(width)), r[2])
  if (width >= 2) {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const off = (Math.max(1, Math.round(width)) - 1) / 2
    p.line(x0 + nx * off, y0 + ny * off, x1 + nx * off, y1 + ny * off, r[3])
  }
}

/**
 * A rivet, stud or bolt: one lit pixel with a shadow under it.
 *
 * Two pixels of detail, and the single cheapest way to make a flat plate read
 * as fabricated metal rather than painted card.
 */
export function rivet(p: Pix, x: number, y: number, r: Ramp): void {
  p.set(Math.round(x), Math.round(y), r[4])
  p.set(Math.round(x), Math.round(y) + 1, r[0])
}

/**
 * A row of rivets along an edge, spaced so they never land on adjacent pixels.
 */
export function rivetRow(p: Pix, x: number, y: number, w: number, step: number, r: Ramp): void {
  const gap = Math.max(2, Math.round(step))
  for (let i = gap >> 1; i < Math.round(w); i += gap) rivet(p, x + i, y, r)
}

/**
 * A fold or seam in cloth: a shadow stroke with a lit stroke beside it.
 *
 * Cloth without folds reads as plastic. Two strokes is all there is room for.
 */
export function fold(p: Pix, x0: number, y0: number, x1: number, y1: number, r: Ramp): void {
  p.line(x0, y0, x1, y1, r[1])
  p.line(x0 + 1, y0, x1 + 1, y1, r[3])
}

/** A strap or belt crossing a body: a dark band with a lit top edge. */
export function strap(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
  const H = Math.max(1, Math.round(h))
  p.fill(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), H, r[1])
  p.fill(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), 1, r[2])
}

/**
 * An emissive mark — a lens, a vent, a rune.
 *
 * Drawn as a bright core with a dimmer halo rather than a single bright pixel,
 * because a lone maximum-value pixel reads as a dead pixel, not as a light.
 */
export function emissive(p: Pix, cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
  p.ellipse(cx, cy, rx, ry, r[3])
  p.ellipse(cx, cy, Math.max(0.6, rx * 0.55), Math.max(0.6, ry * 0.55), r[4])
}

/**
 * A trim line in an accent colour, used for faction and unit-tier stripes.
 *
 * Kept to a single pixel and always paired with a shadow beneath, so a stripe
 * sits *in* the surface rather than floating on it.
 */
export function trim(p: Pix, x: number, y: number, w: number, r: Ramp): void {
  const W = Math.max(1, Math.round(w))
  p.fill(Math.round(x), Math.round(y), W, 1, r[4])
  p.fill(Math.round(x), Math.round(y) + 1, W, 1, r[0])
}

// ──────────────────────────────── Limbs ────────────────────────────────

export interface SegmentOptions {
  /** Fraction of the thickness left at the far end. 1 keeps it parallel. */
  taper?: number
  /** Draws a rounded joint cap at the top, for a shoulder or hip. */
  capTop?: boolean
  /** Draws a rounded joint cap at the bottom, for a knee or elbow. */
  capBottom?: boolean
  /** An accent band across the segment, at this fraction of its length. */
  band?: { at: number; ramp: Ramp }
  /** Adds a rivet line down the segment — armour rather than cloth. */
  riveted?: boolean
}

/**
 * One limb segment: a thigh, a shin, an upper arm, a forearm.
 *
 * Authored pointing **down** with its origin at the top-centre, which is the
 * joint it rotates about. This is the single most important piece of the whole
 * rework: the old rig had one bone per limb, so nothing had a knee or an
 * elbow, and no amount of shading fixes a leg that cannot bend.
 *
 * Returned along with the origin the rig should use, in 0..1 texture space.
 */
export function limbSegment(
  lengthPx: number,
  thicknessPx: number,
  material: Material,
  opts: SegmentOptions = {}
): { canvas: Canvas2D; origin: [number, number] } {
  const L = Math.max(2, Math.round(lengthPx * RES))
  const T = Math.max(1, Math.round(thicknessPx * RES))
  const taper = opts.taper ?? 0.82
  const capR = Math.max(1, T * 0.62)
  const p = partCanvas(T + 4, L + capR * 2 + 2)
  const cx = Math.round(p.w / 2)
  const top = PAD + Math.round(opts.capTop ? capR * 0.4 : 0)
  const r = material.ramp

  // The taper is what separates a limb from a stick: a forearm is narrower at
  // the wrist than at the elbow, and the eye reads that as anatomy.
  for (let i = 0; i < L; i += 1) {
    const t = L > 1 ? i / (L - 1) : 0
    const rowW = Math.max(1, Math.round(T * (1 - (1 - taper) * t)))
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, r[2])
    // Left edge away from the light, right edge into it.
    p.set(x, top + i, r[1])
    if (rowW > 2) p.set(x + rowW - 1, top + i, r[3])
  }

  if (opts.capTop) orb(p, cx, top, T * 0.58, capR * 0.72, r)
  if (opts.capBottom) orb(p, cx, top + L - 1, T * 0.5 * taper, capR * 0.6, r)

  if (opts.band) {
    const y = top + Math.round(L * Math.max(0, Math.min(1, opts.band.at)))
    const w = Math.max(1, Math.round(T * 0.9))
    trim(p, cx - (w >> 1), y, w, opts.band.ramp)
  }

  if (opts.riveted && T >= 3) {
    for (let i = Math.round(L * 0.2); i < L; i += Math.max(3, Math.round(L * 0.35))) {
      rivet(p, cx + Math.max(1, (T >> 1) - 1), top + i, r)
    }
  }

  const canvas = sealPart(p, material.base)
  return { canvas, origin: [cx / p.w, top / p.h] }
}

/**
 * A hand or gauntlet, drawn as a closed fist because every hand in this game
 * is holding something. Origin at the wrist.
 */
export function hand(
  sizePx: number,
  material: Material,
  opts: { armoured?: boolean } = {}
): { canvas: Canvas2D; origin: [number, number] } {
  const S = Math.max(2, Math.round(sizePx * RES))
  const p = partCanvas(S + 2, S + 2)
  const cx = Math.round(p.w / 2)
  const top = PAD
  const r = material.ramp

  if (opts.armoured) {
    chamfer(p, cx - Math.ceil(S / 2), top, S, S, r)
    // Knuckle ridge, on the lit side.
    if (S >= 4) p.fill(cx - Math.ceil(S / 2) + 1, top + 1, S - 2, 1, r[3])
  } else {
    orb(p, cx, top + S * 0.5, S * 0.5, S * 0.52, r)
  }
  const canvas = sealPart(p, material.base)
  return { canvas, origin: [cx / p.w, top / p.h] }
}

/**
 * A foot or boot. Origin at the ankle, toe pointing right, because the rig
 * mirrors the whole container for facing.
 */
export function foot(
  lengthPx: number,
  heightPx: number,
  material: Material
): { canvas: Canvas2D; origin: [number, number] } {
  const L = Math.max(3, Math.round(lengthPx * RES))
  const H = Math.max(2, Math.round(heightPx * RES))
  const p = partCanvas(L + 2, H + 2)
  const ankleX = PAD + Math.round(L * 0.34)
  const top = PAD
  const r = material.ramp

  box(p, PAD, top, L, H, r)
  // Sole in shadow, and a lifted toe so the boot is not a brick.
  p.fill(PAD, top + H - 1, L, 1, r[0])
  if (L >= 5) p.set(PAD + L - 1, top + H - 1, 0, 0)

  const canvas = sealPart(p, material.base)
  return { canvas, origin: [ankleX / p.w, top / p.h] }
}

/**
 * The pelvis: a small wedge the legs hang from.
 *
 * The old rig hung both legs off the torso's bottom edge, which is why units
 * had no hips to swing. Giving it its own bone lets the whole lower body
 * counter-rotate against the shoulders through a stride.
 */
export function pelvis(
  widthPx: number,
  heightPx: number,
  material: Material
): { canvas: Canvas2D; origin: [number, number] } {
  const W = Math.max(3, Math.round(widthPx * RES))
  const H = Math.max(2, Math.round(heightPx * RES))
  const p = partCanvas(W + 2, H + 2)
  const cx = Math.round(p.w / 2)
  const top = PAD
  const r = material.ramp
  for (let i = 0; i < H; i += 1) {
    const t = H > 1 ? i / (H - 1) : 0
    const rowW = Math.max(2, Math.round(W * (1 - 0.18 * t)))
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, r[2])
    p.set(x, top + i, r[1])
    if (rowW > 2) p.set(x + rowW - 1, top + i, r[3])
  }
  p.fill(cx - (W >> 1), top, W, 1, r[3])
  const canvas = sealPart(p, material.base)
  return { canvas, origin: [cx / p.w, top / p.h] }
}

/**
 * A tapered trunk — the shared basis for every chest in the game, before any
 * armour or clothing is laid over it. Wide at the shoulders, narrow at the
 * waist, drawn top-down so callers can keep stacking onto the same Pix.
 */
export function trunk(
  p: Pix,
  cx: number,
  top: number,
  shoulderW: number,
  waistW: number,
  height: number,
  r: Ramp
): void {
  const H = Math.max(1, Math.round(height))
  for (let i = 0; i < H; i += 1) {
    const t = H > 1 ? i / (H - 1) : 0
    const rowW = Math.max(2, Math.round(shoulderW + (waistW - shoulderW) * t))
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, r[2])
    p.set(x, top + i, r[1])
    if (rowW > 2) p.set(x + rowW - 1, top + i, r[3])
  }
  p.fill(cx - (Math.round(shoulderW) >> 1), top, Math.round(shoulderW), 1, r[3])
}

/**
 * Ambient occlusion under an overhang — a helmet brim, a pauldron, a hull lip.
 *
 * One row of the shadow tone directly beneath the edge. It costs a single line
 * and it is the difference between a helmet sitting *on* a head and floating
 * a pixel above it.
 */
export function contactShadow(p: Pix, x: number, y: number, w: number, r: Ramp): void {
  p.fill(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), 1, r[0])
}

/**
 * Scales a length that was authored for a reference unit height.
 *
 * Every archetype is authored against a nominal 60px soldier and scaled from
 * there, so a titan and a clubman share proportions instead of each being
 * hand-tuned into a slightly different species.
 */
export const REFERENCE_HEIGHT = 60

export function forHeight(value: number, height: number): number {
  return (value * height) / REFERENCE_HEIGHT
}
