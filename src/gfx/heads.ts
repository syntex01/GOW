import type { HelmetVisual, UnitVisual } from '../data/types'
import {
  PAD,
  cloth as clothMat,
  contactShadow,
  emissive,
  leather as leatherMat,
  metal as metalMat,
  partCanvas,
  rivet,
  sealPart,
  skin as skinMat,
  trim,
  type Material
} from './anatomy'
import type { Canvas2D } from './painter'
import Pix, { RES, mix, tone, type Ramp } from './pixel'

/**
 * Heads.
 *
 * A head in this game is seven pixels across and nine tall. There is no room in
 * that for a face: two pixels of eye shadow under a brow is the entire budget,
 * and a nose drawn at this size is a smudge that reads as dirt. So the head is
 * not what identifies a unit — **the helmet silhouette is**. A player picks a
 * kettle hat out of a line of forty men by its brim, a great helm by its flat
 * slab, a hooded figure by the peak and the black hole where a face should be.
 * Every one of the eleven kinds below is shaped so that its *outline alone* is
 * unambiguous, and the interior detail only ever exists to explain the outline.
 *
 * The house rules apply without exception:
 *
 * - Light comes from the upper right. Lit edges are top and right, shadow is
 *   bottom and left, on the skull and on every piece of gear over it.
 * - Five tones per material, from `ramp()` via the `Material` helpers in
 *   `anatomy.ts`. Cloth is soft, metal is hard, skin sits between, and that
 *   difference is chosen by the material rather than by hand-picked colours.
 * - The outline is a single post-pass (`sealPart`). Nothing is stroked as it is
 *   drawn, so a horn and the skull it grows from share one silhouette.
 * - Everything is written through `Pix`, on the integer grid.
 *
 * ## The rim line
 *
 * Every helmet that leaves a face visible lands its bottom rim on the same row,
 * one pixel above the skull's centre, with its cast shadow on the next row down
 * and the eyes on the one below that. Fixing those three rows once — rather than
 * per helmet — is what stops a kepi's peak from swallowing the eyes while a
 * headband floats a mile above them, and it means the whole roster blinks at
 * the same height.
 */

// ─────────────────────────────── Layout ───────────────────────────────

/**
 * How far past the skull centre each helmet reaches, in head radii. Horns and a
 * halo need real room above and outside the skull; a great helm barely needs
 * any. Sizing the canvas per kind keeps the textures small without ever risking
 * a clipped brim.
 */
const EXTENT: Record<HelmetVisual, { up: number; side: number }> = {
  none: { up: 1.5, side: 1.3 },
  band: { up: 1.5, side: 1.75 },
  horns: { up: 2.6, side: 2.95 },
  hood: { up: 2.25, side: 1.8 },
  kettle: { up: 2.15, side: 2.05 },
  great: { up: 2.1, side: 1.4 },
  tricorn: { up: 2.1, side: 2.25 },
  kepi: { up: 1.95, side: 1.85 },
  combat: { up: 1.95, side: 1.5 },
  visor: { up: 1.65, side: 1.65 },
  halo: { up: 3.05, side: 1.5 }
}

/** Room below the skull centre: the jaw, plus the neck stub down to the join. */
const DOWN = 1.6

/** Where a helmet's bottom rim sits, in head radii below the skull centre. */
const RIM = -0.3
/** Where the eyes sit. One row below the rim's cast shadow, always. */
const EYE = 0.2

/** Which material's darkness the silhouette outline is tinted from. */
function outlineBase(v: UnitVisual): number {
  switch (v.helmet) {
    case 'kettle':
    case 'great':
    case 'visor':
    case 'halo':
      return v.metal
    case 'combat':
    case 'horns':
      return v.cloth2
    case 'hood':
    case 'tricorn':
    case 'kepi':
    case 'band':
      return v.cloth
    default:
      return v.skin
  }
}

// ─────────────────────────────── Primitives ───────────────────────────────

/**
 * The horizontal run of a row centred on `cx` with half-width `hw`.
 *
 * Rounding both ends outward from the centre — rather than picking a width and
 * then a left edge — is what keeps the skull symmetrical row to row. Left-biased
 * rounding gives a head with one flat cheek, which at nine pixels tall reads as
 * a dent rather than as a jaw.
 */
function span(cx: number, hw: number): [number, number] {
  const x0 = Math.round(cx - hw + 0.5)
  const x1 = Math.round(cx + hw - 0.5)
  return [Math.min(x0, x1), Math.max(x0, x1)]
}

/** One shaded row of a solid form: shadow at the left edge, light at the right. */
function shadedRow(p: Pix, cx: number, hw: number, y: number, r: Ramp): void {
  if (hw < 0.35) return
  const [x0, x1] = span(cx, hw)
  p.fill(x0, y, x1 - x0 + 1, 1, r[2])
  p.set(x0, y, r[1])
  if (x1 > x0 + 1) p.set(x1, y, r[3])
}

/**
 * The half-width of the skull at a given row.
 *
 * A near-circular cranium that narrows below the cheekbone into a chin. The
 * exponent keeps the sides of the head vertical through the middle rows instead
 * of bowing them, because a true ellipse at this size reads as an egg.
 */
function skullHalf(r: number, dy: number, ry: number): number {
  const t = dy / (ry + 0.6)
  let hw = r * Math.sqrt(Math.max(0, 1 - Math.abs(t) ** 2.6))
  if (t > 0.2) hw *= 1 - 0.42 * (t - 0.2)
  return hw
}

/** Quadratic Bézier sample — the spine of a horn, and nothing else. */
function bez(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  t: number
): [number, number] {
  const u = 1 - t
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]
}

/**
 * A tapered curved form — a horn, a tusk, a crest fin.
 *
 * Built as a ribbon around a sampled spine so the thing genuinely curves; a horn
 * drawn as a straight triangle reads as a spike, and spikes belong to a
 * different kind of unit. The lit edge is picked per segment from the surface
 * normal, so a horn sweeping up and to the left is still lit on its upper-right
 * face — the one place where "light from the upper right" is not simply "the
 * right-hand column of pixels".
 */
function taperedCurve(
  p: Pix,
  spine: readonly (readonly [number, number])[],
  w0: number,
  w1: number,
  r: Ramp
): void {
  const n = spine.length
  if (n < 2) return
  const a: [number, number][] = []
  const b: [number, number][] = []
  const litIsA: boolean[] = []
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1)
    const hw = Math.max(0.5, (w0 + (w1 - w0) * t) / 2)
    const [x, y] = spine[i]
    const prev = spine[Math.max(0, i - 1)]
    const next = spine[Math.min(n - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    a.push([x + nx * hw, y + ny * hw])
    b.push([x - nx * hw, y - ny * hw])
    litIsA.push(nx * 0.55 - ny * 0.84 > 0)
  }
  p.poly([...a, ...[...b].reverse()], r[2])
  for (let i = 0; i + 1 < n; i += 1) {
    const lit = litIsA[i] ? a : b
    const dark = litIsA[i] ? b : a
    p.line(lit[i][0], lit[i][1], lit[i + 1][0], lit[i + 1][1], r[3])
    p.line(dark[i][0], dark[i][1], dark[i + 1][0], dark[i + 1][1], r[1])
  }
}

// ─────────────────────────────── The head ───────────────────────────────

interface HeadCtx {
  p: Pix
  /** Skull centre, in canvas pixels. */
  cx: number
  cy: number
  /** Head radius in art pixels — roughly half the seven-pixel width. */
  r: number
  /** Skull half-height, in whole rows. */
  ry: number
  /** The shared rim row every helmet's underside lands on. */
  rimY: number
  v: UnitVisual
  skinM: Material
  hairM: Material
  clothM: Material
  cloth2M: Material
  metalM: Material
  accentM: Material
}

/** The neck: a short stub, so the head meets a collar instead of hovering. */
function drawNeck(c: HeadCtx): void {
  const { p, cx, cy, r } = c
  const n = c.skinM.ramp
  const hw = r * 0.46
  const top = Math.round(cy + r * 0.5)
  const bottom = Math.round(cy + r * 1.55)
  for (let y = top; y <= bottom; y += 1) shadedRow(p, cx, hw, y, n)
  // The jaw throws a hard shadow straight down the throat. Without it the head
  // and the neck read as one continuous tube.
  contactShadow(p, cx - hw, top, hw * 2, n)
}

function drawSkull(c: HeadCtx): void {
  const { p, cx, cy, r, ry } = c
  const s = c.skinM.ramp
  for (let dy = -ry; dy <= ry; dy += 1) shadedRow(p, cx, skullHalf(r, dy, ry), cy + dy, s)
  // Lit crown, a highlight on the temple, and shadow gathering under the jaw.
  const crown = span(cx, skullHalf(r, -ry, ry))
  p.fill(crown[0], cy - ry, crown[1] - crown[0] + 1, 1, s[3])
  if (r >= 3) p.set(Math.round(cx + r * 0.45), Math.round(cy - r * 0.7), s[4])
  const jaw = span(cx, skullHalf(r, ry, ry))
  p.fill(jaw[0], cy + ry, jaw[1] - jaw[0] + 1, 1, s[1])
  // The cheek away from the light stays in half-shadow.
  p.fill(Math.round(cx - r * 0.85), Math.round(cy + r * 0.25), 1, Math.max(1, Math.round(r * 0.6)), s[1])
}

/**
 * The face: two pixels of eye shadow under a brow, and that is all of it.
 *
 * The eyes sit right of centre because every unit is authored facing right, so
 * the head reads as three-quarter rather than as a mugshot.
 */
function drawFace(c: HeadCtx): void {
  const { p, cx, cy, r } = c
  const s = c.skinM.ramp
  const dark = tone(c.v.skin, -0.72)
  const y = Math.round(cy + r * EYE)
  const xR = Math.round(cx + r * 0.5)
  const xL = Math.round(cx - r * 0.4)
  p.set(xR, y, dark)
  p.set(xR, y - 1, s[1])
  if (r >= 3 && xL < xR - 1) {
    p.set(xL, y, dark)
    p.set(xL, y - 1, s[1])
  }
}

/**
 * Hair, for the heads that show any.
 *
 * A cap that follows the skull and sits a pixel proud of it, which is enough to
 * change the silhouette — a bare head and a banded head should not be the same
 * outline with a stripe painted on.
 */
function drawHair(c: HeadCtx, downTo: number): void {
  const { p, cx, cy, r, ry } = c
  const h = c.hairM.ramp
  for (let dy = -ry - 1; dy <= downTo; dy += 1) {
    const base = skullHalf(r, Math.max(-ry, dy), ry)
    shadedRow(p, cx, base + (dy < -ry * 0.4 ? 0.55 : 0.15), cy + dy, h)
  }
  // A fringe falling over the brow on the shadow side, and a sideburn.
  const fringe = cy + downTo + 1
  p.set(Math.round(cx - r * 0.62), fringe, h[1])
  p.set(Math.round(cx - r * 0.62), fringe + 1, h[1])
  const [x0] = span(cx, skullHalf(r, 1, ry))
  p.set(x0, Math.round(cy + r * 0.2), h[1])
}

/** A snug skullcap down to a given row — the base half of several helmets. */
function skullCap(c: HeadCtx, r5: Ramp, bottom: number, swell = 0.4): void {
  const { p, cx, cy, r, ry } = c
  for (let y = cy - ry - 1; y <= bottom; y += 1) {
    const dy = Math.max(-ry, y - cy)
    shadedRow(p, cx, skullHalf(r, dy, ry) + swell, y, r5)
  }
  const [x0, x1] = span(cx, skullHalf(r, bottom - cy, ry) + swell)
  p.fill(x0, bottom, x1 - x0 + 1, 1, r5[1])
  contactShadow(p, x0 + 1, bottom + 1, x1 - x0 - 1, c.skinM.ramp)
}

// ─────────────────────────────── Helmets ───────────────────────────────

function drawBand(c: HeadCtx): void {
  const { p, cx, cy, r, ry, rimY } = c
  const b = c.cloth2M.ramp
  drawHair(c, rimY - cy - 2)
  // Two rows across the brow, with an accent thread woven through them.
  const y = rimY - 1
  const hw = skullHalf(r, y - cy, ry) + 0.45
  const [x0, x1] = span(cx, hw)
  const w = x1 - x0 + 1
  p.fill(x0, y, w, 2, b[2])
  p.fill(x0, y, w, 1, b[3])
  p.fill(x0, y + 1, w, 1, b[1])
  if (r >= 3.2) trim(p, x0 + 1, y, Math.max(1, r * 0.55), c.accentM.ramp)
  contactShadow(p, x0 + 1, rimY + 1, w - 2, c.skinM.ramp)
  // The knot and its tails, trailing behind as a solid pennant. Two crossing
  // one-pixel strokes look like a scratch at this size; a shape does not.
  p.poly(
    [
      [x0, y],
      [x0 - r * 1.05, y + r * 0.35],
      [x0 - r * 0.85, y + r * 1.15],
      [x0, y + 2]
    ],
    b[2]
  )
  p.line(x0, y, x0 - r * 1.05, y + r * 0.35, b[3])
  p.line(x0 - r * 1.05, y + r * 0.35, x0 - r * 0.85, y + r * 1.15, b[1])
}

function drawHorns(c: HeadCtx): void {
  const { p, cx, cy, r, rimY } = c
  const cap = leatherMat(tone(c.v.cloth2, -0.08)).ramp
  skullCap(c, cap, rimY, 0.45)
  if (r >= 3) rivet(p, Math.round(cx + r * 0.55), rimY - 2, cap)
  // Horns sweep out hard before they turn up. The sideways run has to be at
  // least as long as the rise or they read as ears; this is the one part of the
  // file that is allowed — required — to break the head's silhouette outward.
  const a = c.accentM.ramp
  for (const side of [-1, 1] as const) {
    const spine: [number, number][] = []
    for (let i = 0; i <= 7; i += 1) {
      spine.push(
        bez(
          [cx + side * r * 0.75, cy - r * 0.55],
          [cx + side * r * 2.15, cy - r * 0.85],
          [cx + side * r * 2.5, cy - r * 2.1],
          i / 7
        )
      )
    }
    taperedCurve(p, spine, Math.max(2, r * 0.6), 1, a)
  }
}

function drawHood(c: HeadCtx): void {
  const { p, cx, cy, r } = c
  const cl = c.clothM.ramp
  // The face opening: forward and low, and small — the cloth in front of it must
  // never round away to nothing or the hood loses its front edge.
  const fx = cx + r * 0.28
  const fy = cy + r * 0.12
  const frx = r * 0.58
  const fry = r * 0.86
  const inHole = (x: number, y: number): boolean => {
    const dx = (x + 0.5 - fx) / frx
    const dy = (y + 0.5 - fy) / fry
    return dx * dx + dy * dy <= 1
  }

  const topY = Math.round(cy - r * 2.1)
  const botY = Math.round(cy + r * 1.5)
  const rows = Math.max(1, botY - topY)
  for (let y = topY; y <= botY; y += 1) {
    const t = (y - topY) / rows
    const s = Math.sqrt(Math.min(1, t * 1.35))
    // Asymmetric on purpose: the cowl swells forward over the brow faster than
    // it falls behind, and the apex leans back over the crown. A symmetrical
    // hood is a traffic cone.
    const hwL = r * (0.3 + 1.12 * s)
    const hwR = r * (0.18 + 1.3 * s)
    const lean = -r * 0.22 * (1 - t)
    const x0 = Math.round(cx + lean - hwL + 0.5)
    const x1 = Math.round(cx + lean + hwR - 0.5)
    for (let x = x0; x <= x1; x += 1) {
      if (inHole(x, y)) continue
      let col = cl[2]
      if (x === x0 || (x === x0 + 1 && t > 0.4)) col = cl[1]
      else if (x === x1 || (x === x1 - 1 && t > 0.35)) col = cl[3]
      if (y === topY) col = cl[3]
      p.set(x, y, col)
    }
  }

  // Everything inside the opening falls into deep shade. This is the read of a
  // hood: not the cloth, the absence where the face should be.
  for (let y = Math.floor(fy - fry) - 1; y <= Math.ceil(fy + fry) + 1; y += 1) {
    for (let x = Math.floor(fx - frx) - 1; x <= Math.ceil(fx + frx) + 1; x += 1) {
      if (!inHole(x, y)) continue
      if ((p.get(x, y) >>> 24) === 0) p.set(x, y, tone(c.v.cloth, -0.88))
      else p.blend(x, y, 0x070a10, 0.8)
    }
  }
  // Two cold glints where the eyes should be, and the lip of the cowl above them.
  const eyeY = Math.round(fy - r * 0.05)
  p.set(Math.round(fx + r * 0.3), eyeY, tone(c.v.accent, 0.42))
  if (r >= 3) p.set(Math.round(fx - r * 0.28), eyeY, tone(c.v.accent, -0.05))
  p.line(fx - r * 0.62, fy - r * 0.66, fx + r * 0.42, fy - r * 0.9, cl[1])
  // One fold down each side of the drape, lit on the front, shadowed behind.
  p.line(cx - r * 0.95, cy + r * 0.25, cx - r * 1.15, cy + r * 1.4, cl[1])
  p.line(cx + r * 1.02, cy + r * 0.5, cx + r * 1.18, cy + r * 1.4, cl[3])
}

function drawKettle(c: HeadCtx): void {
  const { p, cx, cy, r, rimY } = c
  const m = c.metalM.ramp
  // A shallow bowl, high enough that the brim never eats it…
  p.ellipse(cx, cy - r * 1.15, r * 0.95, r * 0.8, m[1])
  p.ellipse(cx + r * 0.12, cy - r * 1.28, r * 0.82, r * 0.68, m[2])
  p.ellipse(cx + r * 0.3, cy - r * 1.45, r * 0.42, r * 0.32, m[3])
  p.set(Math.round(cx + r * 0.42), Math.round(cy - r * 1.65), m[4])
  // …under a wide flat brim, which is the whole silhouette of a kettle hat.
  const by = cy - r * 0.62
  p.ellipse(cx, by, r * 1.9, r * 0.42, m[1])
  p.ellipse(cx, by - 1, r * 1.84, r * 0.36, m[2])
  p.ellipse(cx + r * 0.14, by - 1, r * 1.5, r * 0.24, m[3])
  p.set(Math.round(cx + r * 1.3), Math.round(by - 1), m[4])
  // The brim's own shadow, thrown across the brow.
  contactShadow(p, cx - r * 0.9, rimY + 1, r * 1.8, c.skinM.ramp)
  if (r >= 3) rivet(p, Math.round(cx - r * 0.55), Math.round(by - 1), m)
}

function drawGreat(c: HeadCtx): void {
  const { p, cx, cy, r } = c
  const m = c.metalM.ramp
  const top = Math.round(cy - r * 1.38)
  const bottom = Math.round(cy + r * 1.32)
  const [x0, x1] = span(cx, r * 1.08)
  const w = x1 - x0 + 1
  // A slab. Flat top, flat sides, no concession whatsoever to the head inside.
  p.fill(x0, top, w, bottom - top + 1, m[2])
  p.fill(x0, top, w, 1, m[3])
  p.fill(x0, bottom, w, 1, m[1])
  p.fill(x0, top, 1, bottom - top + 1, m[1])
  p.fill(x1, top + 1, 1, bottom - top - 1, m[3])
  // Corners knocked off the crown only — the chin stays square and heavy.
  p.set(x0, top, 0, 0)
  p.set(x1, top, 0, 0)

  // The vision slit, with a lit brow ridge riding above it. This one dark line
  // is the entire expression a great helm has.
  const slitY = Math.round(cy - r * 0.3)
  const slitH = Math.max(1, Math.round(r * 0.26))
  p.fill(x0 + 1, slitY, w - 2, slitH, tone(c.v.metal, -0.86))
  p.fill(x0 + 1, slitY - 1, w - 2, 1, m[4])
  p.fill(x0 + 1, slitY + slitH, w - 2, 1, m[1])
  // Breath holes, forward of centre where the mouth would be.
  const holeY = Math.round(cy + r * 0.62)
  p.set(Math.round(cx - r * 0.12), holeY, tone(c.v.metal, -0.7))
  p.set(Math.round(cx + r * 0.58), holeY, tone(c.v.metal, -0.7))
  if (r >= 3) {
    rivet(p, x0 + 1, Math.round(cy + r * 1.02), m)
    rivet(p, x1 - 1, Math.round(cy + r * 1.02), m)
    // A crest fin, so the slab is not a featureless brick at a distance.
    const a = c.accentM.ramp
    const cw = Math.max(2, Math.round(r * 0.34))
    const ch = Math.max(2, Math.round(r * 0.6))
    p.fill(cx - (cw >> 1), top - ch, cw, ch, a[2])
    p.fill(cx - (cw >> 1) + cw - 1, top - ch, 1, ch, a[3])
    p.fill(cx - (cw >> 1), top - ch, cw, 1, a[4])
  }
}

function drawTricorn(c: HeadCtx): void {
  const { p, cx, cy, r, ry, rimY } = c
  const cl = c.clothM.ramp
  // The crown, drawn first and left standing proud through the dip in the brim.
  // It is the middle one of the three points the eye counts.
  for (let y = Math.round(cy - r * 1.9); y <= rimY; y += 1) {
    shadedRow(p, cx, skullHalf(r, Math.max(-ry, y - cy), ry) * 0.82, y, cl)
  }
  // The brim: one band, cocked up at both ends. Kept a full tone darker than
  // the crown, because three overlapping shapes in one tone is porridge — the
  // brim is seen edge-on and sits in the crown's shadow, so it earns it.
  const half = r * 1.9
  const baseY = rimY - 1
  const h = Math.max(2, Math.round(r * 0.75))
  for (let dx = -Math.round(half); dx <= Math.round(half); dx += 1) {
    const t = Math.abs(dx) / half
    const y = Math.round(baseY - r * 0.95 * t ** 1.7)
    p.fill(cx + dx, y, 1, h, cl[1])
    p.set(cx + dx, y, dx > 0 ? cl[3] : cl[2])
    p.set(cx + dx, y + h - 1, cl[0])
  }
  // The third corner: a low notch cocked toward the viewer, right of the crown
  // and deliberately shorter than it, so the three points read in order.
  p.poly(
    [
      [cx + r * 0.32, cy - r * 0.75],
      [cx + r * 0.78, cy - r * 1.5],
      [cx + r * 1.15, cy - r * 0.7]
    ],
    cl[2]
  )
  p.line(cx + r * 0.78, cy - r * 1.5, cx + r * 1.15, cy - r * 0.7, cl[3])
  p.line(cx + r * 0.32, cy - r * 0.75, cx + r * 0.78, cy - r * 1.5, cl[1])
  // A cockade at the foot of the lit corner, and the brim's shadow on the brow.
  if (r >= 3) emissive(p, cx + r * 1.3, cy - r * 1.15, r * 0.26, r * 0.26, c.accentM.ramp)
  contactShadow(p, cx - r * 0.8, rimY + 1, r * 1.6, c.skinM.ramp)
}

function drawKepi(c: HeadCtx): void {
  const { p, cx, cy, r, rimY } = c
  const cl = c.clothM.ramp
  const b = c.cloth2M.ramp
  // Flat top and straight sides: a kepi is a small cylinder and should look it.
  const [x0, x1] = span(cx, r * 0.98)
  const w = x1 - x0 + 1
  const top = Math.round(cy - r * 1.8)
  // The band sits a full row above the rim, so the peak below it is a separate
  // shape rather than the band simply being wider on one side.
  const bandH = Math.max(2, Math.round(r * 0.42))
  const bandY = rimY - bandH
  p.fill(x0, top, w, bandY - top, cl[2])
  p.fill(x0, top, w, 1, cl[3])
  p.fill(x0, top, 1, bandY - top, cl[1])
  p.fill(x1, top + 1, 1, bandY - top - 1, cl[3])
  // The band, then the short forward peak jutting out over the eyes.
  p.fill(x0, bandY, w, bandH, b[2])
  p.fill(x0, bandY, w, 1, b[3])
  p.fill(x0, bandY, 1, bandH, b[1])
  const px0 = Math.round(cx + r * 0.2)
  const px1 = Math.round(cx + r * 1.65)
  p.fill(px0, rimY, px1 - px0 + 1, 1, b[2])
  p.fill(px0, rimY - 1, px1 - px0, 1, b[3])
  // The tip droops, which is what stops the peak reading as a shelf.
  p.set(px1, rimY + 1, b[1])
  contactShadow(p, px0 - Math.round(r * 0.5), rimY + 1, r * 1.0, c.skinM.ramp)
  if (r >= 3) p.set(Math.round(cx + r * 0.1), bandY + (bandH >> 1), c.accentM.ramp[4])
}

function drawCombat(c: HeadCtx): void {
  const { p, cx, cy, r, rimY } = c
  const sh = c.cloth2M.ramp
  const strapR = leatherMat(tone(c.v.cloth2, -0.42)).ramp
  // A rounded shell hugging the skull — the smooth dome is the read, so it gets
  // three clean tonal bands and nothing else.
  p.ellipse(cx, cy - r * 0.85, r * 1.2, r * 0.92, sh[1])
  p.ellipse(cx + r * 0.12, cy - r * 0.98, r * 1.06, r * 0.78, sh[2])
  p.ellipse(cx + r * 0.34, cy - r * 1.18, r * 0.5, r * 0.38, sh[3])
  p.set(Math.round(cx + r * 0.5), Math.round(cy - r * 1.4), sh[4])
  // The flared lip, a pixel wider than the shell on each side.
  const [x0, x1] = span(cx, r * 1.32)
  p.fill(x0, rimY, x1 - x0 + 1, 1, sh[1])
  p.fill(x0, rimY - 1, x1 - x0 + 1, 1, sh[2])
  p.set(x1, rimY - 1, sh[3])
  contactShadow(p, x0 + 1, rimY + 1, x1 - x0 - 1, c.skinM.ramp)
  // Chin strap: down the shadowed jaw, under the chin, with a buckle on it.
  p.line(x0, rimY + 1, cx - r * 0.45, cy + r * 1.0, strapR[1])
  p.line(x1, rimY + 1, cx + r * 0.5, cy + r * 0.95, strapR[2])
  p.set(Math.round(cx - r * 0.45), Math.round(cy + r * 1.0), strapR[3])
}

function drawVisor(c: HeadCtx): void {
  const { p, cx, cy, r } = c
  const m = c.metalM.ramp
  const glow = c.accentM.ramp
  // A hard angular wedge with a forward point: no curve anywhere on it, which is
  // exactly what separates it from the rounded combat shell at eight pixels wide.
  p.poly(
    [
      [cx - r * 1.05, cy - r * 1.05],
      [cx + r * 0.5, cy - r * 1.4],
      [cx + r * 1.45, cy - r * 0.2],
      [cx + r * 0.62, cy + r * 1.1],
      [cx - r * 1.0, cy + r * 0.75]
    ],
    m[2]
  )
  // The top plane catches the light; the jaw plane falls away from it.
  p.poly(
    [
      [cx - r * 1.05, cy - r * 1.05],
      [cx + r * 0.5, cy - r * 1.4],
      [cx + r * 1.35, cy - r * 0.3],
      [cx - r * 0.2, cy - r * 0.62]
    ],
    m[3]
  )
  p.poly(
    [
      [cx - r * 1.0, cy + r * 0.75],
      [cx + r * 0.62, cy + r * 1.1],
      [cx + r * 1.02, cy + r * 0.4],
      [cx - r * 1.0, cy + r * 0.2]
    ],
    m[1]
  )
  // The emissive band, raked to follow the wedge and undercut by a dark line so
  // it reads as a lit slot rather than as bright paint.
  const bh = Math.max(1, Math.round(r * 0.3))
  const bx0 = Math.round(cx - r * 0.8)
  const bx1 = Math.round(cx + r * 1.2)
  for (let x = bx0; x <= bx1; x += 1) {
    const t = (x - bx0) / Math.max(1, bx1 - bx0)
    const y = Math.round(cy - r * 0.5 + t * r * 0.28)
    p.set(x, y - 1, m[0])
    p.fill(x, y, 1, bh, glow[3])
    p.set(x, y, glow[4])
  }
  if (r >= 3) {
    emissive(p, bx1 - 1, cy - r * 0.15, r * 0.22, r * 0.22, glow)
    rivet(p, Math.round(cx - r * 0.82), Math.round(cy + r * 0.42), m)
  }
}

function drawHalo(c: HeadCtx): void {
  const { p, cx, cy, r, ry, rimY } = c
  const m = c.metalM.ramp
  const a = c.accentM.ramp
  drawHair(c, rimY - cy - 1)
  // A plain circlet, so the ring above has something on the head to belong to.
  const [x0, x1] = span(cx, skullHalf(r, rimY - cy, ry) + 0.4)
  p.fill(x0, rimY, x1 - x0 + 1, 1, m[3])
  p.set(x0, rimY, m[1])
  p.set(Math.round(cx + r * 0.45), rimY, a[4])
  contactShadow(p, x0 + 1, rimY + 1, x1 - x0 - 1, c.skinM.ramp)

  // The ring itself: detached and floating, its near arc bright and its far arc
  // dim, so it reads as a disc seen edge-on instead of as a flat oval.
  const rx2 = r * 1.2
  const ry2 = Math.max(1, r * 0.42)
  const cyR = cy - r * 2.45
  const steps = Math.max(24, Math.round(rx2 * 8))
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2
    p.set(Math.round(cx + Math.cos(t) * rx2), Math.round(cyR + Math.sin(t) * ry2), Math.sin(t) > 0 ? a[4] : a[2])
  }
  // A little spill onto the crown. Without it the ring is a hoop of painted
  // metal hanging in the air rather than a light.
  for (let dx = -Math.round(r * 0.7); dx <= Math.round(r * 0.7); dx += 1) {
    p.blend(cx + dx, cy - ry - 1, c.v.accent, 0.22)
  }
}

// ─────────────────────────────── Entry point ───────────────────────────────

/** Helmets that leave nothing of the face showing. */
const FACELESS = new Set<HelmetVisual>(['hood', 'great', 'visor'])

/**
 * Draws a unit's head, upright, and hands back the point where the neck joins
 * the body in 0..1 texture space so the rig can anchor it there.
 *
 * `headRadiusPx` is in world pixels — the same number `rigMetrics` calls
 * `headR` — and is converted into art pixels here, once.
 */
export function drawHeadHi(
  v: UnitVisual,
  headRadiusPx: number
): { canvas: Canvas2D; origin: [number, number] } {
  const r = Math.max(2.2, headRadiusPx * RES)
  const ext = EXTENT[v.helmet] ?? EXTENT.none
  const p = partCanvas(r * 2 * ext.side, r * (ext.up + DOWN))
  const cx = Math.round(p.w / 2)
  const cy = PAD + Math.round(r * ext.up)

  const c: HeadCtx = {
    p,
    cx,
    cy,
    r,
    ry: Math.max(2, Math.round(r * 1.15)),
    rimY: cy + Math.round(r * RIM),
    v,
    skinM: skinMat(v.skin),
    hairM: leatherMat(mix(v.skin, 0x241a15, 0.78)),
    clothM: clothMat(v.cloth),
    cloth2M: clothMat(v.cloth2),
    metalM: metalMat(v.metal),
    accentM: metalMat(v.accent)
  }

  drawNeck(c)
  drawSkull(c)

  switch (v.helmet) {
    case 'band':
      drawBand(c)
      break
    case 'horns':
      drawHorns(c)
      break
    case 'hood':
      drawHood(c)
      break
    case 'kettle':
      drawKettle(c)
      break
    case 'great':
      drawGreat(c)
      break
    case 'tricorn':
      drawTricorn(c)
      break
    case 'kepi':
      drawKepi(c)
      break
    case 'combat':
      drawCombat(c)
      break
    case 'visor':
      drawVisor(c)
      break
    case 'halo':
      drawHalo(c)
      break
    case 'none':
    default:
      drawHair(c, c.rimY - cy - 1)
      break
  }

  // The face goes on last, so no brim, band or strap can ever land on top of the
  // two pixels that make the unit look alive.
  if (!FACELESS.has(v.helmet)) drawFace(c)

  const canvas = sealPart(p, outlineBase(v))
  return { canvas, origin: [cx / p.w, Math.round(cy + r * 1.38) / p.h] }
}
