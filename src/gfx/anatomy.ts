import Pix, { RES, ditherAt, ramp, tone, type Ramp } from './pixel'
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
 * 6. **Joints are volumes, not seams.** Two parts that meet end to end read as
 *    a hinge on a doll. Every joint therefore carries a `jointCap` — a ball
 *    that overlaps the seam and is shaded as a sphere — and every segment
 *    darkens its own first row so it tucks *into* the part above it. Because
 *    each part is outlined separately, a cap that reaches too far past the
 *    joint lays its own outline across the limb it hangs from, which is the
 *    hinge line all over again; so caps hug the joint unless the lump is
 *    deliberate, as at a shoulder or a hip.
 * 7. **Long straight tone boundaries get `softenEdge`.** At three pixels of
 *    width there is no room for a sixth tone to describe the turn away from
 *    the light, so ordered dithering buys the half-step instead.
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

// ──────────────────────────── Softening edges ────────────────────────────

/**
 * Dithers one tone inward from an edge, over pixels that are already there.
 *
 * A tone boundary that runs dead straight down a sprite reads as a cut, not as
 * a curve — the eye needs the shading to *roll* off a surface, and at three
 * pixels of width there is no room for a fourth tone to do it with. Ordered
 * dithering buys the half-step: the column between the shadow edge and the body
 * becomes half one and half the other, which at this scale is read as a soft
 * turn away from the light rather than as a pattern.
 *
 * Transparent pixels are never written, so this can never grow a silhouette —
 * it only ever re-shades what the shape already covers.
 */
export function softenEdge(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  opts: { strength?: number } = {}
): void {
  const strength = opts.strength ?? 0.5
  const x0 = Math.round(x)
  const y0 = Math.round(y)
  const x1 = x0 + Math.max(1, Math.round(w))
  const y1 = y0 + Math.max(1, Math.round(h))
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      if (!p.inside(px, py)) continue
      if ((p.data[p.index(px, py)] >>> 24) === 0) continue
      if (ditherAt(px, py, strength)) p.set(px, py, color)
    }
  }
}

/**
 * The house lighting rolled off both vertical edges of a shape: the shadow
 * tone dithered one column in from the left, the lit tone one column in from
 * the right. The difference between a slab and something with a round back.
 */
export function bevel(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  r: Ramp,
  opts: { shadow?: boolean; light?: boolean; strength?: number } = {}
): void {
  const X = Math.round(x)
  const Y = Math.round(y)
  const W = Math.max(1, Math.round(w))
  const H = Math.max(1, Math.round(h))
  const strength = opts.strength ?? 0.55
  if (opts.shadow !== false && W >= 3) softenEdge(p, X + 1, Y, 1, H, r[1], { strength })
  if (opts.light !== false && W >= 5) {
    softenEdge(p, X + W - 2, Y, 1, H, r[3], { strength: strength * 0.7 })
  }
}

// ─────────────────────────────── Primitives ───────────────────────────────

/**
 * A shaded box: lit top row, base body, shadow along the bottom and the left
 * edge, a lit right edge. The workhorse for armour plates, crates and hulls.
 *
 * Anything big enough to show it gets its vertical edges bevelled, because a
 * hull side that is one flat tone right up to a one-pixel dark line is the
 * single most common way a shape ends up reading as cardboard.
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
  if (W >= 7 && H >= 5) bevel(p, X, Y + 1, W, H - 2, r)
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

/**
 * How tall a joint ball of this radius is. A joint seen side-on is wider than
 * it is tall until it is properly proud, which keeps a wrist from turning into
 * a golf ball. Shared so a caller can place the ball's *crown* on a chosen row
 * rather than guessing where the ellipse will land.
 */
export function jointCapHeight(radius: number, proud = 0.5): number {
  return Math.max(0.6, Math.max(0.7, radius) * (0.66 + 0.14 * Math.max(0, Math.min(1, proud))))
}

export interface JointOptions {
  /**
   * How far the ball stands proud of the limb. 0 is a wrist — barely more than
   * a rounded end; 1 is a shoulder or a knee, a distinct lump in the outline.
   */
  proud?: number
  /** Lays an occlusion crescent under the ball, where it sinks into its socket. */
  seat?: boolean
}

/**
 * The ball of a joint: a shoulder, an elbow, a knee, a hip.
 *
 * **This is the fix for the doll-hinge problem.** Two limb segments butting end
 * to end give two flat edges and a dark line between them, which is exactly
 * what a hinge on a toy looks like. A real joint is a *volume* that both
 * segments disappear into, so the cap is drawn deliberately overlapping the
 * seam — half of it above the joint, half below — and shaded as a sphere:
 * shadow crescent down-left, body, a lit crown up-right. The segment behind
 * then has nowhere to show a flat end.
 *
 * Drawn as concentric offset ellipses rather than as a circle plus a highlight,
 * because at a radius of one or two pixels the offset *is* the shading.
 */
export function jointCap(
  p: Pix,
  cx: number,
  cy: number,
  radius: number,
  r: Ramp,
  opts: JointOptions = {}
): void {
  const proud = Math.max(0, Math.min(1, opts.proud ?? 0.5))
  const rx = Math.max(0.7, radius)
  const ry = jointCapHeight(rx, proud)
  p.ellipse(cx, cy, rx, ry, r[1])
  p.ellipse(cx + rx * 0.18, cy - ry * 0.2, rx * 0.82, ry * 0.8, r[2])
  if (rx >= 1.3) p.ellipse(cx + rx * 0.34, cy - ry * 0.38, rx * 0.52, ry * 0.5, r[3])
  if (rx >= 2.6) p.set(Math.round(cx + rx * 0.4), Math.round(cy - ry * 0.5), r[4])
  if (opts.seat && rx >= 1.5) {
    // Where the ball sinks into the limb below it, on the shadow side only.
    p.set(Math.round(cx - rx * 0.62), Math.round(cy + ry * 0.5), r[0])
  }
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
  /** Draws a *proud* joint ball at the top, for a shoulder or hip. */
  capTop?: boolean
  /** Draws a proud joint ball at the bottom, for a knee or elbow. */
  capBottom?: boolean
  /** An accent band across the segment, at this fraction of its length. */
  band?: { at: number; ramp: Ramp }
  /** Adds a rivet line down the segment — armour rather than cloth. */
  riveted?: boolean
  /** Scales the S-curve along the length. 0 draws a dead straight bar. */
  curve?: number
  /** Which way the belly bows: +1 pushes the upper half toward the light. */
  bow?: 1 | -1
}

/** One drawn row of a limb: the two edge columns it occupies. */
interface LimbRow {
  left: number
  right: number
}

/**
 * The two edges of a limb, row by row.
 *
 * The important detail is that the left and right edges are computed as
 * *fractions* and rounded independently, rather than an integer width being
 * centred on an axis. Centring a rounded width makes both edges step in the
 * same row, which is a visible jog — a kink, not a curve. Rounding each edge
 * on its own lets the shadow side step at one row and the lit side at another,
 * which is exactly how a curve is drawn by hand at this size.
 *
 * Three things shape the profile:
 *
 * - **The taper.** A forearm is narrower at the wrist than at the elbow.
 * - **The muscle belly**, a fractional swell peaking around two fifths down.
 *   On a four-pixel limb it buys one pixel of width in the middle, and that
 *   one pixel is the difference between a limb and a plank.
 * - **The S-curve.** The mass of a limb does not sit on the line between its
 *   joints; it bows off it and back. Sampled per row and rounded, that is a
 *   sub-pixel bias which tips one edge over the rounding boundary a row or two
 *   before the other. Both ends are pinned to the bone, because that is where
 *   the next segment attaches and a displaced end would tear the chain apart.
 *
 * The joints at both ends tuck in slightly, so the ball drawn over them stands
 * proud of the shaft instead of being flush with it.
 */
function limbRows(
  rows: number,
  thickness: number,
  taper: number,
  cx: number,
  curve: number,
  bow: number
): LimbRow[] {
  const belly = Math.max(0.5, thickness * 0.2)
  const sway = Math.min(0.55, Math.max(0, (rows - 5) * 0.12)) * curve * bow
  const out: LimbRow[] = []
  for (let i = 0; i < rows; i += 1) {
    const t = rows > 1 ? i / (rows - 1) : 0
    let hw = (thickness * (1 - (1 - taper) * t)) / 2
    hw += (belly * Math.sin(Math.PI * Math.pow(t, 0.72))) / 2
    hw -= 0.45 * Math.max(0, (t - 0.78) / 0.22)
    hw -= 0.3 * Math.max(0, (0.12 - t) / 0.12)
    const c = cx + Math.sin(t * Math.PI * 2) * sway
    const left = Math.round(c - hw)
    out.push({ left, right: Math.max(left + 1, Math.round(c + hw)) })
  }
  return out
}

/**
 * The ball radius for a joint on a limb this thick.
 *
 * A shoulder or a hip stands proud of the limb it caps; every other joint is
 * barely wider than the shaft, because a ball that overhangs a limb it is not
 * meant to be a lump on reads as a swelling, and — worse — its own outline then
 * lands across whatever it is drawn over.
 */
function jointRadius(thickness: number, proud: boolean): number {
  return Math.max(0.9, thickness * (proud ? 0.58 : 0.52))
}

/**
 * One limb segment: a thigh, a shin, an upper arm, a forearm.
 *
 * Authored pointing **down** with its origin at the top-centre, which is the
 * joint it rotates about. This is the single most important piece of the whole
 * rework: the old rig had one bone per limb, so nothing had a knee or an
 * elbow, and no amount of shading fixes a leg that cannot bend.
 *
 * What is drawn, in order, and why each part of it is there:
 *
 * 1. **The shaft**, from `limbRows` — tapered, swollen at the muscle belly,
 *    bowed off the bone line and back, and tucked in at both joints. Straight
 *    parallel edges are what makes a limb read as a stick.
 * 2. **The shading**, three tones across the width with the turn between them
 *    dithered, so the shadow side rolls away instead of being cut.
 * 3. **The socket**, a row or two of shadow at the top, so the segment reads as
 *    tucking *into* the one above rather than being stacked on it.
 * 4. **The joint balls**, which are what stop the seam reading as a hinge.
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
  const r = material.ramp
  const bow = opts.bow ?? 1
  const curve = opts.curve ?? 1

  // Every segment gets a ball at the top, whether or not the caller asked for
  // one: the top of a limb *is* a joint, and the ball is what hides the flat
  // end of whatever it hangs from. `capTop` only chooses how proud it stands.
  const topR = jointRadius(T, opts.capTop === true)
  const botR = jointRadius(Math.max(1, T * taper), opts.capBottom === true)

  const p = partCanvas(T + 6, L + Math.ceil(topR + botR) * 2 + 2)
  const cx = Math.round(p.w / 2)
  // Room above the first drawn row for a proud shoulder or hip to stand in.
  const top = PAD + Math.ceil(topR) + 1

  const rows = limbRows(L, T, taper, cx, curve, bow)
  const mid = (i: number) => (rows[i].left + rows[i].right - 1) / 2

  for (let i = 0; i < L; i += 1) {
    const { left, right } = rows[i]
    const w = right - left
    const y = top + i
    p.fill(left, y, w, 1, r[2])
    // Left edge away from the light, right edge into it.
    p.set(left, y, r[1])
    if (w > 2) p.set(right - 1, y, r[3])
    // …and the turn between them dithered, so the shadow side is a roll-off
    // rather than a ruled line down the limb.
    if (w >= 4) softenEdge(p, left + 1, y, 1, 1, r[1], { strength: 0.55 })
    if (w >= 5) softenEdge(p, right - 2, y, 1, 1, r[3], { strength: 0.4 })
  }

  // The first row or two of a segment sit *inside* the joint above them. Making
  // them the shadow tone is what lets the eye read the segment as tucking under
  // its parent instead of being stacked on top of it.
  const socket = L >= 5 ? 2 : 1
  for (let i = 0; i < socket && i < L; i += 1) {
    const { left, right } = rows[i]
    if (i === 0) p.fill(left, top, right - left, 1, r[1])
    else softenEdge(p, left, top + i, right - left, 1, r[1], { strength: 0.55 })
  }
  // The far end is a socket too, unless a ball is about to be drawn over it.
  if (!opts.capBottom) {
    const { left, right } = rows[L - 1]
    softenEdge(p, left, top + L - 1, right - left, 1, r[1], { strength: 0.7 })
  }

  // Where the top ball's crown lands decides whether the seam reads as a joint
  // or as a cut. Every part carries its own outline, so a ball that reaches two
  // rows above the joint lays a dark line clean across the limb it hangs from —
  // the hinge line. A plain segment therefore keeps its crown *on* the joint
  // row, and only a proud shoulder or hip is allowed to stand above it, where
  // the lump is the point.
  const proudTop = opts.capTop === true
  const capY = proudTop ? top : top + jointCapHeight(topR, 0.2)
  jointCap(p, mid(0), capY, topR, r, { proud: proudTop ? 1 : 0.2 })
  if (opts.capBottom) {
    // Half a row low, so the ball straddles the joint and fills the notch the
    // next segment leaves behind it when the limb bends.
    jointCap(p, mid(L - 1), top + L - 0.5, botR, r, { proud: 0.85, seat: true })
  }

  if (opts.band) {
    const i = Math.max(0, Math.min(L - 1, Math.round(L * Math.max(0, Math.min(1, opts.band.at)))))
    const w = Math.max(1, rows[i].right - rows[i].left - 1)
    trim(p, rows[i].left + 1, top + i, w, opts.band.ramp)
  }

  if (opts.riveted && T >= 3) {
    for (let i = Math.round(L * 0.2); i < L - 1; i += Math.max(3, Math.round(L * 0.35))) {
      rivet(p, rows[i].right - 2, top + i, r)
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
  const p = partCanvas(S + 4, S + 4)
  const cx = Math.round(p.w / 2)
  const top = PAD + 1
  const r = material.ramp

  // A fist is not a square. It pinches at the wrist, swells across the
  // knuckles, and its front edge is *scalloped* — that scallop is the one
  // feature that survives at four pixels, so it is drawn into the silhouette
  // rather than shaded on afterwards.
  const rows: { x: number; w: number }[] = []
  for (let i = 0; i < S; i += 1) {
    let w = S
    if (i === 0) w = Math.max(2, S - 1)
    if (i === S - 1 && S > 2) w = S - 1
    rows.push({ x: cx - (w >> 1), w })
  }

  if (opts.armoured) {
    for (let i = 0; i < S; i += 1) {
      const { x, w } = rows[i]
      p.fill(x, top + i, w, 1, r[2])
      p.set(x, top + i, r[1])
      if (w > 2) p.set(x + w - 1, top + i, r[3])
    }
    // A gauntlet reads as a cuff, a knuckle bar and a plated back.
    p.fill(rows[0].x, top, rows[0].w, 1, r[1])
    if (S >= 3) {
      const k = rows[1]
      p.fill(k.x + 1, top + 1, Math.max(1, k.w - 1), 1, r[3])
      p.set(k.x + k.w - 1, top + 1, r[4])
    }
    if (S >= 5) softenEdge(p, rows[2].x + 1, top + 2, 1, S - 3, r[1], { strength: 0.5 })
  } else {
    for (let i = 0; i < S; i += 1) {
      const { x, w } = rows[i]
      p.fill(x, top + i, w, 1, r[2])
      p.set(x, top + i, r[1])
      if (w > 2) p.set(x + w - 1, top + i, r[3])
    }
    p.fill(rows[0].x, top, rows[0].w, 1, r[1])
  }

  // Knuckles: every other row along the front edge steps proud, and the row
  // between it is knocked out. Two notches is a fist; a straight edge is a bat.
  if (S >= 4) {
    for (let i = 2; i < S - 1; i += 2) {
      const { x, w } = rows[i]
      p.set(x + w - 1, top + i, 0, 0)
      if (w > 2) p.set(x + w - 2, top + i, r[1])
    }
    for (let i = 1; i < S - 1; i += 2) {
      const { x, w } = rows[i]
      p.set(x + w - 1, top + i, r[4])
    }
  }

  // The thumb, laid over the fingers on the shadow side. One pixel of overhang,
  // and it is the difference between a hand and a lump.
  if (S >= 3) {
    const { x } = rows[1]
    p.set(x - 1, top + 1, r[1])
    if (S >= 5) p.set(x - 1, top + 2, r[2])
  }

  // Bottom of the fist rolls under, away from the light.
  const last = rows[S - 1]
  softenEdge(p, last.x, top + S - 1, last.w, 1, r[0], { strength: 0.6 })

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
  const p = partCanvas(L + 3, H + 3)
  const top = PAD + 1
  const r = material.ramp

  // The ankle is the whole problem with a boot at this size. A rectangle the
  // full length of the foot, starting at the shin, is a brick with a leg stuck
  // in it. So the top row is only as wide as the ankle and the shape *grows*
  // forward as it falls — heel back, toe forward, the instep sloping between.
  // Three pixels is the floor: a boot narrower than that at the ankle stops
  // reading as a foot at all, and the foot is most of what tells the eye a
  // figure is standing on the ground rather than floating over it.
  const ankleW = Math.max(3, Math.round(L * 0.55))
  const ankleX = PAD + Math.round(L * 0.34)
  const ankleL = Math.max(PAD, ankleX - (ankleW >> 1))
  const ankleR = ankleL + ankleW
  const heel = PAD
  const toe = PAD + L

  const rows: { x0: number; x1: number }[] = []
  for (let i = 0; i < H; i += 1) {
    const t = H > 1 ? i / (H - 1) : 1
    // The toe runs out ahead of the heel coming back, which is what gives the
    // silhouette its forward lean instead of a symmetrical wedge.
    const x0 = Math.round(ankleL + (heel - ankleL) * Math.pow(t, 0.85))
    const x1 = Math.round(ankleR + (toe - ankleR) * Math.pow(t, 0.5))
    rows.push({ x0, x1: Math.max(x0 + 1, x1) })
  }

  for (let i = 0; i < H; i += 1) {
    const { x0, x1 } = rows[i]
    const w = x1 - x0
    p.fill(x0, top + i, w, 1, r[2])
    p.set(x0, top + i, r[1])
    if (w > 2) p.set(x1 - 1, top + i, r[3])
  }
  // Instep catches the light; the sole never does.
  p.fill(rows[0].x0, top, rows[0].x1 - rows[0].x0, 1, r[3])
  const sole = rows[H - 1]
  p.fill(sole.x0, top + H - 1, sole.x1 - sole.x0, 1, r[0])
  // The turn from the instep down the outside of the boot, dithered rather than
  // cut — the one long straight edge a boot has.
  if (H >= 3) softenEdge(p, rows[1].x0 + 1, top + 1, 1, H - 2, r[1], { strength: 0.5 })
  // Toe cap and heel corner rounded off.
  if (L >= 5 && H >= 3) {
    p.set(sole.x1 - 1, top + H - 1, 0, 0)
    p.set(rows[H - 2].x1 - 1, top + H - 2, r[3])
  }

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
    // Hips are widest just below the belt and round off underneath, so the
    // taper is a curve rather than a straight cut down to the crotch.
    let rowW = Math.max(2, Math.round(W * (1 - 0.3 * t * t)))
    if (i === H - 1 && rowW > 3) rowW -= 1
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, r[2])
    p.set(x, top + i, r[1])
    if (rowW > 2) p.set(x + rowW - 1, top + i, r[3])
    if (rowW >= 5) softenEdge(p, x + 1, top + i, 1, 1, r[1], { strength: 0.5 })
  }
  p.fill(cx - (W >> 1), top, W, 1, r[3])
  // The crease where the legs come out of it, on the shadow side.
  if (H >= 3 && W >= 5) softenEdge(p, cx - (W >> 2), top + H - 1, 2, 1, r[0], { strength: 0.7 })
  const canvas = sealPart(p, material.base)
  return { canvas, origin: [cx / p.w, top / p.h] }
}

/**
 * The trunk's width on row `i`, in whole pixels.
 *
 * Exported because anything laid over the body — a pauldron, a quiver strap, a
 * fauld — has to line up with the body's actual edge to the pixel, and the only
 * way to guarantee that is for everyone to ask the same function.
 *
 * The profile is a straight shoulder-to-waist taper with two integer
 * corrections: a pixel of barrel across the ribcage and a pixel of flare at the
 * hip. Both *add*, never subtract, so nothing anchored to the plain taper can
 * end up hanging off the edge of the body.
 */
export function trunkRowWidth(
  shoulderW: number,
  waistW: number,
  height: number,
  i: number
): number {
  const H = Math.max(1, Math.round(height))
  const t = H > 1 ? i / (H - 1) : 0
  let w = shoulderW + (waistW - shoulderW) * t
  if (H >= 7 && Math.round(shoulderW) >= 6) {
    // The ribcage carries its width out past the shoulder-to-waist line and
    // back in again; the hip goes out once more below the waist. Both are
    // fractional and rounded, so each buys one pixel where it crosses the
    // boundary instead of stepping the whole band at once.
    w += 0.95 * Math.sin(Math.PI * Math.min(1, t / 0.66))
    w += 0.85 * Math.max(0, (t - 0.84) / 0.16)
  }
  return Math.max(2, Math.round(w))
}

/**
 * A tapered trunk — the shared basis for every chest in the game, before any
 * armour or clothing is laid over it. Drawn top-down so callers can keep
 * stacking onto the same Pix.
 *
 * A pure linear taper is a trapezoid, and a trapezoid is what the eye reads: a
 * box with sloped sides. A body is a *barrel* — the ribcage carries its width
 * out past the line between the shoulder and the waist, the waist comes back
 * in, and the hip goes out again. Three one-pixel corrections over a
 * thirteen-pixel torso, and the silhouette stops being furniture.
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
    const rowW = trunkRowWidth(shoulderW, waistW, height, i)
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, r[2])
    p.set(x, top + i, r[1])
    if (rowW > 2) p.set(x + rowW - 1, top + i, r[3])
    // The body turns away from the light around the ribs; dithering that turn
    // is what stops the shadow edge reading as a seam down the side.
    if (rowW >= 6) softenEdge(p, x + 1, top + i, 1, 1, r[1], { strength: 0.5 })
    if (rowW >= 8) softenEdge(p, x + rowW - 2, top + i, 1, 1, r[3], { strength: 0.38 })
  }
  const w0 = trunkRowWidth(shoulderW, waistW, height, 0)
  p.fill(cx - (w0 >> 1), top, w0, 1, r[3])
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
