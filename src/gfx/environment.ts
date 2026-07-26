import Phaser from 'phaser'
import { save } from '../core/save'
import { AGE_THEMES, type AgeTheme } from './palette'
import Pix, { ditherAt, mix, pixelNoise, ramp, tone, type PixelCanvas } from './pixel'
import { LANE_Y } from '../sim/types'

/**
 * The world beyond the battlefield.
 *
 * A sky with weather in it, four ranges of terrain receding toward the horizon,
 * and a ribbon of ground haze that seats them on the plane the armies fight on.
 * Every pixel is generated here — nothing ships as an image — and every age gets
 * its own skyline, its own celestial body and its own air.
 *
 * ## What this is trying to look like
 *
 * Flat, layered, painted shapes: the backdrop of a Dead Cells or a Kingdom Two
 * Crowns rather than a photograph seen through gauze. That intent decides every
 * rule below, and each rule exists because breaking it produced *haze* — the
 * one failure this whole file is organised against.
 *
 * 1. **Value before colour.** Six planes — the floor, four ranges, the air at
 *    the horizon — are assigned luminances on a fixed staircase *before* any of
 *    them is assigned a hue, and their colours are then driven onto those
 *    values. No theme can flatten the staircase and none can invert it. See
 *    `ladderFloor` and `envBandBase`.
 * 2. **The staircase needs room, not just rungs.** The ladder is anchored low
 *    on purpose: nineteen points of separation between planes sitting at 140
 *    reads as one grey field, and the same nineteen points between planes
 *    sitting at 60 reads as layers.
 * 3. **The glow finishes above the skyline.** The sky arrives at its horizon
 *    colour at `SKY_GLOW_FRAC`, a little over the top of the far range's crest
 *    window — not on the ground line, where all of it would be hidden behind
 *    the ranges and the mountains would stand against the dim middle of the
 *    gradient with nothing between them.
 * 4. **Dither is a *join*, never a field.** Every gradient here is quantised
 *    into flat bands with a short dithered seam between each pair, and the seams
 *    wander so no boundary is a ruled line. Dithering a whole surface lays a
 *    checkerboard film over the frame, and a checkerboard film is haze.
 * 5. **A lit edge is a lit *face*.** Light is described by value steps across
 *    real areas — a third of a wall, a flank of a cone, the crown of a cloud.
 *    A one-pixel rim following a silhouette is a drawn outline, not light, and
 *    a ridgeline full of them is a tangle of scratches.
 * 6. **A TileSprite tiles in both axes.** Art shorter than its band repeats
 *    vertically and draws the same crest twice up the screen; art narrower than
 *    the viewport runs a hard seam down the picture. Every layer is authored at
 *    *exactly* its band height and at `ENV_LAYER_WIDTH`, from noise that is
 *    periodic over that width, with every landmark drawn three times so shapes
 *    cross the wrap instead of being clipped by it.
 * 7. **Light comes from the upper right**, five tones per material from
 *    `ramp()`, and the environment authors at full resolution (`ENV_RES = 1`).
 */

// ──────────────────────────── Geometry ────────────────────────────
//
// World pixels, and `ENV_RES` is 1, so these are art pixels too.

/**
 * Authored width of every scrolling layer.
 *
 * A layer must cover the viewport plus everything its own tile position can
 * travel. The camera can only cross `worldWidth - viewport` = 1920 - 1280 = 640,
 * and the fastest screen-space layers are the nearest range and the haze at
 * 0.46, so the requirement is 1280 + 0.46 x 640 = 1575. 2048 clears it with
 * room to spare and is a power of two, which is what lets the periodic noise
 * the terrain is built from wrap exactly.
 */
export const ENV_LAYER_WIDTH = 2048

/**
 * Height of each range, far to near. Each is authored at exactly this.
 *
 * The heights are not arbitrary. Every range's foot sits on the ground line, so
 * its height is what decides where its crest window can be — see `CREST_HI` and
 * `CREST_LO`, which are fractions of these. Each canvas also carries enough room
 * above its own crest for the tallest thing that can stand on it, which is why
 * the far one is a good deal taller than the frame: an arcology spire or an
 * orbital elevator has to be able to run off the top of the picture.
 */
export const ENV_BAND_HEIGHTS = [544, 440, 330, 244] as const

/** How far below the ground line the foot of every range sits. */
export const ENV_BAND_FOOT = 8

/**
 * How far above the feet line the ground plane begins — its horizon.
 *
 * The old layout had no ground plane at all above the line the units stand on:
 * the ranges came all the way down to their feet, so the floor behind a soldier
 * was the vertical face of a mountain and the only actual ground was a strip
 * below him. The ranges now stop here and stand *on* the plane.
 */
export const ENV_FLOOR_HORIZON = 138

/** How far the plane continues below the feet line, toward the camera. */
export const ENV_FLOOR_BELOW = 178

/** The haze band that seats the battlefield against the hills. */
export const ENV_FOG_HEIGHT = 52

/** The battlefield floor. Taller than any viewport shows, so it cannot repeat. */
export const ENV_GROUND_HEIGHT = 200

/** High thin cloud: top of screen, slowest. */
export const ENV_CIRRUS_Y = 0
export const ENV_CIRRUS_HEIGHT = 176

/** Low cloud banks: lit on top, drifting faster. */
export const ENV_CUMULUS_Y = 56
export const ENV_CUMULUS_HEIGHT = 208

/** Scroll rate of every layer, as a fraction of the camera. */
export const ENV_SCROLL = {
  cirrus: 0.012,
  cumulus: 0.03,
  bands: [0.06, 0.15, 0.28, 0.46] as const,
  fog: 0.46,
  ground: 1,
  bank: 1.35
}

/** Where the sun or moon hangs, as a fraction of the viewport, per age. */
export const ENV_SUN_POS: readonly (readonly [number, number])[] = [
  [0.79, 0.15],
  [0.71, 0.11],
  [0.26, 0.13],
  [0.76, 0.1],
  [0.22, 0.09]
]

/**
 * The environment authors at full resolution, unlike the units.
 *
 * Chunky pixels are a style on a sixty-pixel soldier and a defect on a
 * mountain: a soldier at half resolution reads as deliberate, while a hillside
 * or a floor at half resolution just reads as a low-resolution hillside. The
 * two are decoupled here so each can be right on its own terms.
 */
const ENV_RES = 1

/** World pixels to art pixels. */
function A(world: number): number {
  return Math.round(world * ENV_RES)
}

function theme(age: number): AgeTheme {
  return AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
}

// ──────────────────────────── Colour ────────────────────────────

/**
 * The RGB hex behind a packed buffer word.
 *
 * `Pix` stores the little-endian ABGR word an ImageData view wants, so masking
 * a pixel with 0xffffff hands back *blue* in the high byte. Reading a pixel
 * back and passing it to `mix` without this swaps every red for every blue —
 * which is why the old star field was tinted against its own sky.
 */
function rgbOf(value: number): number {
  return ((value & 0xff) << 16) | (value & 0xff00) | ((value >>> 16) & 0xff)
}

function lum(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)
}

/**
 * Drives a colour to a target luminance in a single application of `tone()`.
 *
 * Nudging a colour in a loop looks simpler and does not work: at a step small
 * enough to be accurate, each nudge moves every channel by less than half a
 * level, the result rounds back to the colour it started from, and the loop
 * sits on a fixed point a long way from the target. `tone()` is monotonic in
 * its argument, so bisecting it lands on the wanted value exactly once, with no
 * accumulated rounding at all.
 */
function driveLum(base: number, wanted: number): number {
  if (Math.abs(lum(base) - wanted) < 0.8) return base
  let lo = -1
  let hi = 1
  for (let i = 0; i < 26; i += 1) {
    const mid = (lo + hi) / 2
    if (lum(tone(base, mid)) < wanted) lo = mid
    else hi = mid
  }
  return tone(base, (lo + hi) / 2)
}

/**
 * The value ladder.
 *
 * Aerial perspective here is not hoped for, it is a staircase with a fixed
 * rise. Every plane in the picture — the floor the soldiers stand on, the four
 * ranges behind them, the air along the horizon — is assigned a *luminance*
 * before it is assigned a colour, and its colour is then driven onto that
 * value. No theme can flatten the staircase, and none can invert it.
 *
 * The rise is deliberately large. The old backdrop derived its separation from
 * whatever gap a theme happened to leave between its rock and its sky, clamped
 * into a range; where a theme left no gap, the clamp was doing all the work and
 * the ranges arrived as four shades of the same fog. Fixing the rise first and
 * bending the colours to it afterwards is what makes every age read as layers
 * of flat, separated shapes.
 */

/** Luminance between one range and the next. Twelve is the readable minimum. */
const LADDER_STEP = 19

/** Extra rise from the farthest range to the air it stands against. */
const LADDER_SKY_GAP = 24

/**
 * The bottom of the ladder: the value of the ground under the camera.
 *
 * Clamped, because five more steps are built upward from here and a theme whose
 * ground is nearly white leaves no room above it. Night themes are pinned lower
 * still: their skies go black at the zenith and glow along the horizon, which
 * is where every scrap of contrast in a night scene actually lives.
 */
function ladderFloor(age: number): number {
  const t = theme(age)
  // The ceiling matters more than the floor. Five rungs and a sky gap are built
  // on top of this, and an anchor in the eighties puts the whole staircase up
  // in the bright end of the range where a nineteen-point step is a tenth of
  // the value it sits on and the eye stops reading it as a step at all. That is
  // what "hazy" was: not a want of separation but a want of *room*.
  const base = Math.max(30, Math.min(64, lum(t.ground)))
  return lum(t.sky[2]) < 80 ? Math.min(base, 38) : base
}

/** The value of range `d`, far (0) to near (3). */
function ladderLum(age: number, d: number): number {
  return ladderFloor(age) + (ENV_BAND_HEIGHTS.length - d) * LADDER_STEP
}

/**
 * The colour the sky arrives at along the horizon — the top of the ladder.
 *
 * A theme's horizon colour is a suggestion; the value it has to reach is not.
 * Where a theme sits too low, its own sun colour is mixed in *before* the value
 * is driven, so a night sky lifts into a glow rather than into grey.
 */
function skyHorizon(age: number): number {
  const t = theme(age)
  const want = ladderLum(age, 0) + LADDER_SKY_GAP
  const have = lum(t.sky[2])
  const warm = want > have + 4 ? mix(t.sky[2], t.sun, Math.min(0.72, (want - have) / 85)) : t.sky[2]
  return driveLum(warm, want)
}

/** How much horizon air is mixed into each range before its value is set. */
const BAND_HAZE = [0.52, 0.36, 0.19, 0.05]

/**
 * How far each range is pulled toward cold air on top of that.
 *
 * Value separation alone leaves four ranges that are the same colour at four
 * brightnesses, which is exactly what a filter does and exactly what an eye
 * does not believe. Distance is *cool* — the blue end of the spectrum scatters
 * — so the far ranges take a little of it and the near one takes none.
 */
const BAND_COOL = [0.26, 0.17, 0.08, 0]
const COLD_AIR = 0x5a6a94

/**
 * The base colour of one range.
 *
 * Every range is the same rock seen through more or less air, so the hue walks
 * toward the horizon with distance; the value is then driven onto the rung the
 * ladder reserved for it, which is what guarantees the step.
 */
export function envBandBase(age: number, depth: number): number {
  const t = theme(age)
  const d = Math.max(0, Math.min(BAND_HAZE.length - 1, depth))
  const hazed = mix(t.ridges[2], skyHorizon(age), BAND_HAZE[d])
  return driveLum(mix(hazed, COLD_AIR, BAND_COOL[d]), ladderLum(age, d))
}

/**
 * The floor colour: the bottom rung, one step nearer than the nearest range.
 *
 * If the units cannot be told from the ground under their feet, nothing else
 * about the scene matters — so the floor keeps the theme's own hue and takes
 * the ladder's value.
 */
export function envGroundBase(age: number): number {
  return driveLum(theme(age).ground, ladderFloor(age))
}

/** The warm colour the light in this age actually is. */
function keyLight(age: number): number {
  const t = theme(age)
  return mix(t.sun, 0xffffff, 0.15)
}

// ──────────────────────────── Noise ────────────────────────────

/**
 * Fractal value noise that is periodic over `width`.
 *
 * Every terrain profile in this file is built from this rather than from open
 * noise, so the left edge of a layer is the continuation of its right edge. A
 * layer wide enough never to wrap on screen is the first defence against a
 * seam; a profile that matches across the wrap is the second.
 */
function wrapNoise(seed: number, width: number, cells = 6, octaves = 4, gain = 0.5) {
  const hash = (n: number): number => {
    let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  return (x: number): number => {
    let sum = 0
    let amp = 0.5
    let norm = 0
    let c = cells
    for (let o = 0; o < octaves; o += 1) {
      const xs = (x / width) * c
      const i = Math.floor(xs)
      const f = xs - i
      const u = f * f * (3 - 2 * f)
      const a = hash((((i % c) + c) % c) + o * 977)
      const b = hash(((((i + 1) % c) + c) % c) + o * 977)
      sum += (a * (1 - u) + b * u) * amp
      norm += amp
      amp *= gain
      c *= 2
    }
    return sum / norm
  }
}

/** Smooth 2D value noise, for smoke and cloud density. */
function smoothNoise2(seed: number) {
  const h = pixelNoise(seed)
  return (x: number, y: number): number => {
    const i = Math.floor(x)
    const j = Math.floor(y)
    const fx = x - i
    const fy = y - j
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const a = h(i, j)
    const b = h(i + 1, j)
    const c = h(i, j + 1)
    const d = h(i + 1, j + 1)
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy
  }
}

// ──────────────────────────── Placement ────────────────────────────

export interface Placement {
  x: number
  kind: string
  size: number
  flip: boolean
  seed: number
}

/**
 * Places landmarks along a layer.
 *
 * Even spacing looks printed and pure randomness clumps, so each item gets a
 * slot and jitters inside it. Nothing is inset from the edges: every landmark
 * is drawn three times, at `x - width`, `x` and `x + width`, so a shape that
 * straddles the wrap is genuinely continuous rather than merely kept away from
 * it.
 */
function scatter(
  seed: number,
  width: number,
  count: number,
  kinds: readonly string[],
  min: number,
  max: number
): Placement[] {
  const noise = pixelNoise(seed)
  const slot = width / count
  const out: Placement[] = []
  let last = ''
  for (let i = 0; i < count; i += 1) {
    // Weighted toward the head of the list: the first entry is the one that
    // says which age this is, so it should turn up more often than the filler.
    let idx = Math.min(kinds.length - 1, Math.floor(Math.pow(noise(i, 2), 1.35) * kinds.length))
    // …but never twice running. Two walled cities two hundred pixels apart is
    // the one thing that gives a generated skyline away as generated.
    if (kinds[idx] === last) idx = (idx + 1) % kinds.length
    last = kinds[idx]
    out.push({
      x: Math.round(slot * (i + 0.14 + noise(i, 1) * 0.72)),
      kind: kinds[idx],
      size: Math.round(min + noise(i, 3) * (max - min)),
      flip: noise(i, 4) > 0.5,
      seed: Math.round(noise(i, 5) * 9999)
    })
  }
  return out
}

// ──────────────────────────── Landmarks ────────────────────────────

/** Something on a layer that the live scene hangs an animation off. */
export interface EnvAnchor {
  kind: 'smoke' | 'light' | 'beam'
  /** Art-pixel position inside the layer texture. */
  x: number
  y: number
  scale: number
  /** Blink phase, so a row of lights never pulses in unison. */
  phase: number
}

/**
 * Everything one landmark needs to draw itself.
 *
 * Four tones and a light colour, and that is the whole budget. A silhouette on
 * a distant range that reaches for a fifth tone stops being a silhouette; the
 * separation that makes it readable comes from the *ladder*, not from detail
 * inside the shape.
 */
interface Land {
  p: Pix
  /** Centre column and base row, already wrapped into the layer. */
  x: number
  y: number
  /** Nominal height in art pixels. */
  s: number
  body: number
  lit: number
  dark: number
  deep: number
  /** The colour of light in this age — windows, fires, hot rock. */
  key: number
  /** Cold structural colour: stone, steel, bone. */
  pale: number
  seed: number
  flip: boolean
  /** Which range this is standing on. */
  d: number
  /** Null on the two wrap copies, so anchors are only emitted once. */
  anchors: EnvAnchor[] | null
}

type LandFn = (l: Land) => void

function hang(l: Land, kind: EnvAnchor['kind'], x: number, y: number, scale: number): void {
  if (!l.anchors) return
  l.anchors.push({
    kind,
    x: Math.round(x),
    y: Math.round(y),
    scale,
    phase: ((l.seed * 37) % 1000) / 1000
  })
}

/** Deterministic per-landmark variation. */
function vary(l: Land, k: number): number {
  const n = pixelNoise(l.seed + 1)
  return n(k, k * 7 + 3)
}

/**
 * A rectangular mass with a lit face and a shadowed one.
 *
 * The lit face is a *third of the block*, never a one-pixel line down its edge.
 * Rim-lighting every silhouette is what turned the old skyline into a tangle of
 * bright scratches; a value step across a real area reads as a lit wall.
 */
function block(l: Land, cx: number, top: number, half: number, bot: number, body: number, lit: number, dark: number): void {
  const w = Math.max(1, Math.round(half * 2))
  const x0 = Math.round(cx - half)
  l.p.fill(x0, top, w, bot - top, body)
  const litW = Math.max(1, Math.round(w * 0.3))
  l.p.fill(x0 + w - litW, top, litW, bot - top, lit)
  if (w >= 5) l.p.fill(x0, top, Math.max(1, Math.round(w * 0.2)), bot - top, dark)
}

/** A tapered tower: wider at the foot, lit down its right third. */
function taper(l: Land, cx: number, top: number, bot: number, halfTop: number, halfBot: number, body: number, lit: number): void {
  for (let y = top; y < bot; y += 1) {
    const tt = (y - top) / Math.max(1, bot - top)
    const half = halfTop + (halfBot - halfTop) * tt
    const x0 = Math.round(cx - half)
    const w = Math.max(1, Math.round(half * 2))
    l.p.fill(x0, y, w, 1, body)
    l.p.fill(x0 + w - Math.max(1, Math.round(w * 0.32)), y, Math.max(1, Math.round(w * 0.32)), 1, lit)
  }
}

/**
 * Shades a solid of revolution — a cone, a volcano, a spire.
 *
 * Shading a cone by its column alone paints a vertical seam straight down the
 * middle of it and the shape reads as a flat triangle cut in two. The
 * terminator on a real cone fans out from the apex, so each pixel is placed
 * across *the slice it belongs to* instead, and the boundary between light and
 * shadow becomes the slant line that makes the form read as round.
 */
function revolve(
  l: Land,
  half: number,
  topAt: (dx: number) => number,
  halfAt: (y: number) => number,
  body: number,
  lit: number,
  dark: number
): void {
  for (let dx = -half; dx <= half; dx += 1) {
    const top = Math.round(topAt(dx))
    for (let y = top; y < l.y; y += 1) {
      const hw = Math.max(1, halfAt(y))
      const u = Math.max(-1, Math.min(1, dx / hw))
      l.p.set(l.x + dx, y, u > 0.16 ? lit : u < -0.44 ? dark : body)
    }
  }
}

// ── stone age ──

const mesa: LandFn = l => {
  const { p, x, s } = l
  const topH = Math.max(3, Math.round(s * 0.66))
  const botH = Math.max(4, Math.round(s * 1.02))
  const top = l.y - s
  p.poly([[x - botH, l.y], [x - topH, top], [x + topH, top], [x + botH, l.y]], l.body)
  p.poly([[x + topH * 0.18, top], [x + topH, top], [x + botH, l.y], [x + botH * 0.24, l.y]], l.lit)
  p.poly([[x - botH, l.y], [x - topH, top], [x - topH * 0.6, top], [x - botH * 0.66, l.y]], l.dark)
  // Strata: horizontal, two of them, and nothing else. A mesa is a stack of
  // beds; drawing every bed turns it into corduroy.
  for (let k = 1; k <= 2; k += 1) {
    const yy = top + Math.round(s * (0.26 + k * 0.24))
    const half = Math.round(topH + (botH - topH) * ((yy - top) / Math.max(1, s)))
    p.fill(x - half, yy, half * 2, 1, l.dark)
  }
}

const peak: LandFn = l => {
  const { s } = l
  const half = Math.max(3, Math.round(s * (0.78 + vary(l, 1) * 0.4)))
  const expo = 1.1 + vary(l, 2) * 0.35
  revolve(
    l,
    half,
    dx => l.y - s * Math.pow(1 - Math.abs(dx) / half, expo),
    y => half * (1 - Math.pow(Math.max(0, Math.min(1, (l.y - y) / s)), 1 / expo)),
    l.body,
    l.lit,
    l.dark
  )
}

const volcano: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(8, Math.round(s * 1.75))
  const craterHalf = Math.max(3, Math.round(s * 0.3))
  const hot = mix(l.key, 0xff5a1e, 0.55)
  const expo = 1.24
  const rim = Math.round(l.y - s)
  revolve(
    l,
    half,
    dx => {
      const a = Math.abs(dx)
      // A real notch, not a nick: the crater floor sits a fifth of the cone's
      // height below its rim, which is what makes the summit read as open.
      if (a <= craterHalf) return l.y - s * (0.8 + 0.2 * Math.pow(a / craterHalf, 1.6))
      return l.y - s * Math.pow(1 - (a - craterHalf) / (half - craterHalf), expo)
    },
    y => craterHalf + (half - craterHalf) * (1 - Math.pow(Math.max(0, Math.min(1, (l.y - y) / s)), 1 / expo)),
    l.body,
    l.lit,
    l.dark
  )
  // The far wall of the crater in shadow — clipped to the notch itself, so it
  // is a hollow in the summit rather than a box sitting on top of it.
  const floorY = Math.round(l.y - s * 0.8)
  for (let dx = -craterHalf + 1; dx <= craterHalf - 1; dx += 1) {
    const wall = Math.round(l.y - s * (0.8 + 0.2 * Math.pow(Math.abs(dx) / craterHalf, 1.6)))
    p.fill(x + dx, wall, 1, floorY - wall + 1, l.deep)
  }
  for (let dx = -craterHalf + 3; dx <= craterHalf - 3; dx += 1) {
    if (vary(l, 60 + dx) < 0.35) continue
    p.set(x + dx, floorY - 1, hot)
    if (vary(l, 90 + dx) > 0.6) p.set(x + dx, floorY - 2, mix(hot, l.key, 0.55))
  }
  // One lava run down the lit flank, and nothing on the shadowed one.
  let cx = x + craterHalf * 0.9
  let cy = floorY
  const len = Math.round(s * (0.5 + vary(l, 11) * 0.3))
  for (let i = 0; i < len; i += 1) {
    cy += 1
    cx += 0.5 + vary(l, 20 + i) * 0.6
    if (cy >= l.y) break
    if (vary(l, 40 + i) < 0.25) continue
    p.set(Math.round(cx), cy, i % 4 === 0 ? mix(hot, l.key, 0.5) : hot)
  }
  hang(l, 'smoke', x, rim, 2.5)
  hang(l, 'light', x, floorY - 1, 2.2)
}

const archRock: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(5, Math.round(s * 0.8))
  const legW = Math.max(2, Math.round(s * 0.24))
  const spanTop = l.y - s
  const spanH = Math.max(2, Math.round(s * 0.3))
  block(l, x - half + legW / 2, spanTop + spanH, legW / 2, l.y, l.body, l.lit, l.dark)
  block(l, x + half - legW / 2, spanTop + spanH, legW / 2, l.y, l.body, l.lit, l.dark)
  // The span, thicker at the haunches than at the crown.
  for (let dx = -half; dx <= half; dx += 1) {
    const tt = Math.abs(dx) / half
    const thick = Math.round(spanH * (0.6 + tt * tt * 0.9))
    const top = spanTop + Math.round(spanH * (1 - Math.pow(1 - tt, 2) * 0.55)) - thick
    p.fill(x + dx, top, 1, thick, dx > 0 ? l.lit : l.body)
  }
}

const monolith: LandFn = l => {
  const { x, s } = l
  const count = 1 + Math.floor(vary(l, 1) * 3)
  for (let i = 0; i < count; i += 1) {
    const h = Math.round(s * (0.6 + vary(l, 10 + i) * 0.45))
    const half = Math.max(1, Math.round(h * 0.17))
    const cx = x + Math.round((i - (count - 1) / 2) * s * 0.5)
    block(l, cx, l.y - h, half, l.y + 1, l.body, l.lit, l.dark)
  }
}

const ribcage: LandFn = l => {
  const { p, x, s } = l
  const bone = mix(l.lit, l.pale, 0.55)
  const boneDark = mix(l.body, l.dark, 0.5)
  const len = Math.max(8, Math.round(s * 2.4))
  const arcAt = (t: number): number => l.y - s * (0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))))
  const ribs = 6 + Math.floor(vary(l, 1) * 3)
  for (let i = 0; i < ribs; i += 1) {
    const t = 0.16 + (i / (ribs - 1)) * 0.68
    const sx = x - len / 2 + t * len
    const sy = arcAt(t)
    const drop = Math.max(2, Math.round(l.y - sy))
    for (let k = 0; k <= drop; k += 1) {
      const u = k / drop
      const rx = sx - Math.pow(u, 1.6) * s * 0.46
      p.set(Math.round(rx), Math.round(sy) + k, k < drop * 0.72 ? bone : boneDark)
      p.set(Math.round(rx) + 1, Math.round(sy) + k, boneDark)
    }
  }
  // The spine over the top of them, and a skull dropped off one end.
  for (let t = 0.08; t <= 0.92; t += 0.004) {
    const sx = Math.round(x - len / 2 + t * len)
    const sy = Math.round(arcAt(t))
    p.fill(sx, sy - 1, 1, 3, bone)
  }
  const hx = Math.round(x - len / 2 + 0.06 * len)
  const hy = Math.round(arcAt(0.08))
  const hr = Math.max(2, Math.round(s * 0.22))
  p.ellipse(hx, hy + hr, hr * 1.25, hr, bone)
  p.fill(hx - hr, hy + hr, Math.max(1, Math.round(hr * 0.7)), Math.max(1, Math.round(hr * 0.6)), l.deep)
}

const skull: LandFn = l => {
  const { p, x, s } = l
  const bone = mix(l.lit, l.pale, 0.5)
  const rx = Math.max(3, Math.round(s * 0.62))
  const ry = Math.max(3, Math.round(s * 0.52))
  p.ellipse(x, l.y - ry, rx, ry, bone)
  p.fill(x - Math.round(rx * 0.72), l.y - Math.round(ry * 0.9), Math.max(1, Math.round(rx * 0.6)), Math.max(1, Math.round(ry * 0.7)), l.body)
  // Two sockets and a jaw: the three marks that make a skull a skull.
  p.fill(x - Math.round(rx * 0.55), l.y - Math.round(ry * 1.1), Math.max(1, Math.round(rx * 0.3)), Math.max(1, Math.round(ry * 0.34)), l.deep)
  p.fill(x + Math.round(rx * 0.1), l.y - Math.round(ry * 1.1), Math.max(1, Math.round(rx * 0.3)), Math.max(1, Math.round(ry * 0.34)), l.deep)
  p.fill(x - Math.round(rx * 0.6), l.y - 1, Math.round(rx * 1.2), 1, l.deep)
}

const deadTree: LandFn = l => {
  const { p, x, s } = l
  const top = l.y - s
  p.thickLine(x, l.y, x + Math.round(s * 0.1), top, Math.max(1, Math.round(s * 0.12)), l.body)
  const arms = 3 + Math.floor(vary(l, 1) * 3)
  for (let i = 0; i < arms; i += 1) {
    const t = 0.35 + (i / arms) * 0.6
    const by = l.y - s * t
    const dir = i % 2 === 0 ? 1 : -1
    const len = s * (0.3 + vary(l, 10 + i) * 0.26) * (1 - t * 0.4)
    p.line(x, by, x + dir * len, by - len * 0.75, dir > 0 ? l.lit : l.dark)
  }
}

const boulder: LandFn = l => {
  const { p, x, s } = l
  const rx = Math.max(2, Math.round(s * 0.9))
  const ry = Math.max(1, Math.round(s * 0.6))
  p.ellipse(x, l.y - ry + 1, rx, ry, l.body)
  p.ellipse(x + Math.round(rx * 0.3), l.y - ry * 1.2, Math.round(rx * 0.55), Math.round(ry * 0.55), l.lit)
  p.fill(x - rx, l.y - 1, rx * 2, 1, l.deep)
}

const fern: LandFn = l => {
  const { p, x, s } = l
  const fronds = 4 + Math.floor(vary(l, 1) * 3)
  for (let i = 0; i < fronds; i += 1) {
    const a = -Math.PI / 2 + (i / (fronds - 1) - 0.5) * 1.5
    const len = s * (0.7 + vary(l, 10 + i) * 0.5)
    p.line(x, l.y, x + Math.cos(a) * len, l.y + Math.sin(a) * len, i > fronds / 2 ? l.lit : l.body)
  }
}

// ── medieval ──

/** A wall with crenellations: the one detail that says "fortified" at any size. */
function battlement(l: Land, x0: number, x1: number, top: number, bot: number, body: number, lit: number): void {
  l.p.fill(x0, top, x1 - x0, bot - top, body)
  l.p.fill(x0, top, x1 - x0, Math.max(1, Math.round((bot - top) * 0.22)), lit)
  const step = Math.max(3, Math.round((bot - top) * 0.9))
  for (let x = x0; x < x1; x += step) {
    l.p.fill(x, top - Math.max(1, Math.round(step * 0.4)), Math.max(1, Math.round(step * 0.5)), Math.max(1, Math.round(step * 0.4)), body)
  }
}

const cragCity: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(10, Math.round(s * 1.25))
  const crestY = l.y - Math.round(s * 0.5)
  // The crag: a wedge of rock with one sheer lit face.
  p.poly([[x - half, l.y], [x - half * 0.62, crestY], [x + half * 0.7, crestY], [x + half, l.y]], l.body)
  p.poly([[x + half * 0.18, crestY], [x + half * 0.7, crestY], [x + half, l.y], [x + half * 0.42, l.y]], l.lit)
  p.poly([[x - half, l.y], [x - half * 0.62, crestY], [x - half * 0.3, crestY], [x - half * 0.66, l.y]], l.dark)
  // The town on top: a curtain wall, roofs behind it, a keep and a spire.
  const wallH = Math.max(3, Math.round(s * 0.13))
  const stone = mix(l.body, l.pale, 0.4)
  const stoneLit = mix(l.lit, l.pale, 0.45)
  const roof = mix(l.dark, l.body, 0.4)
  const roofCount = 5 + Math.floor(vary(l, 1) * 4)
  for (let i = 0; i < roofCount; i += 1) {
    const rw = Math.max(3, Math.round(s * (0.13 + vary(l, 10 + i) * 0.1)))
    const rh = Math.max(3, Math.round(s * (0.14 + vary(l, 20 + i) * 0.14)))
    const rx = x - half * 0.55 + (i / roofCount) * half * 1.15
    block(l, rx, crestY - rh, rw / 2, crestY, roof, mix(roof, l.pale, 0.3), l.deep)
    p.poly([[rx - rw / 2 - 1, crestY - rh], [rx, crestY - rh - rw * 0.5], [rx + rw / 2 + 1, crestY - rh]], mix(roof, l.deep, 0.35))
  }
  const keepH = Math.round(s * 0.52)
  const keepHalf = Math.max(2, Math.round(s * 0.14))
  block(l, x + half * 0.16, crestY - keepH, keepHalf, crestY, stone, stoneLit, l.dark)
  battlement(l, Math.round(x + half * 0.16 - keepHalf), Math.round(x + half * 0.16 + keepHalf), crestY - keepH, crestY - keepH + wallH, stone, stoneLit)
  // The cathedral spire, the tallest thing in the age.
  const spireH = Math.round(s * 0.72)
  const spireX = x - half * 0.3
  block(l, spireX, crestY - spireH * 0.6, Math.max(1, Math.round(s * 0.075)), crestY, stone, stoneLit, l.dark)
  p.poly([
    [spireX - s * 0.09, crestY - spireH * 0.6],
    [spireX, crestY - spireH],
    [spireX + s * 0.09, crestY - spireH * 0.6]
  ], mix(roof, l.deep, 0.2))
  battlement(l, Math.round(x - half * 0.62), Math.round(x + half * 0.72), crestY - wallH, crestY, stone, stoneLit)
  hang(l, 'light', x + half * 0.16, crestY - keepH - 1, 1.5)
  hang(l, 'light', spireX, crestY - spireH, 1.2)
  hang(l, 'smoke', x - half * 0.05, crestY - Math.round(s * 0.2), 1.1)
}

const cathedral: LandFn = l => {
  const { p, x, s } = l
  const stone = mix(l.body, l.pale, 0.35)
  const stoneLit = mix(l.lit, l.pale, 0.4)
  const roof = mix(l.dark, l.body, 0.35)
  const naveH = Math.round(s * 0.44)
  const naveHalf = Math.max(3, Math.round(s * 0.52))
  block(l, x, l.y - naveH, naveHalf, l.y, stone, stoneLit, l.dark)
  p.poly([[x - naveHalf - 1, l.y - naveH], [x, l.y - naveH - s * 0.16], [x + naveHalf + 1, l.y - naveH]], roof)
  // Two west towers and a crossing spire.
  for (const side of [-1, 1]) {
    const tx = x + side * naveHalf * 0.78
    const th = Math.round(s * (side < 0 ? 0.78 : 0.7))
    const thalf = Math.max(1, Math.round(s * 0.12))
    block(l, tx, l.y - th, thalf, l.y, stone, stoneLit, l.dark)
    p.poly([[tx - thalf - 1, l.y - th], [tx, l.y - th - s * 0.2], [tx + thalf + 1, l.y - th]], roof)
  }
  const spireH = Math.round(s * 1.0)
  p.poly([[x - s * 0.1, l.y - naveH - s * 0.1], [x, l.y - spireH], [x + s * 0.1, l.y - naveH - s * 0.1]], roof)
  p.fill(x, Math.round(l.y - spireH), 1, Math.round(s * 0.5), stoneLit)
  hang(l, 'light', x, l.y - spireH, 1.1)
}

const towerRuin: LandFn = l => {
  const { p, x, s } = l
  const stone = mix(l.body, l.pale, 0.3)
  const stoneLit = mix(l.lit, l.pale, 0.35)
  const half = Math.max(2, Math.round(s * 0.24))
  const top = l.y - s
  block(l, x, top, half, l.y, stone, stoneLit, l.dark)
  // A broken crown: two teeth of different heights, not a saw.
  p.fill(x - half, top, Math.round(half * 0.8), Math.max(1, Math.round(s * 0.16)), 0, 0)
  p.fill(x + Math.round(half * 0.2), top, Math.round(half * 0.6), Math.max(1, Math.round(s * 0.09)), 0, 0)
  const holes = 2 + Math.floor(vary(l, 1) * 2)
  for (let i = 0; i < holes; i += 1) {
    p.fill(x - Math.round(half * 0.3), Math.round(l.y - s * (0.28 + i * 0.24)), Math.max(1, Math.round(half * 0.4)), Math.max(1, Math.round(s * 0.1)), l.deep)
  }
}

const windmill: LandFn = l => {
  const { p, x, s } = l
  const stone = mix(l.body, l.pale, 0.28)
  const bodyH = Math.round(s * 0.62)
  taper(l, x, l.y - bodyH, l.y, s * 0.15, s * 0.24, stone, mix(l.lit, l.pale, 0.35))
  const capY = l.y - bodyH
  p.poly([[x - s * 0.19, capY], [x, capY - s * 0.16], [x + s * 0.19, capY]], l.dark)
  // Four sails as one X, drawn thick enough to survive the distance.
  const hub = capY - Math.round(s * 0.06)
  const arm = s * 0.42
  const t = Math.max(1, Math.round(s * 0.05))
  p.thickLine(x - arm * 0.72, hub - arm * 0.72, x + arm * 0.72, hub + arm * 0.72, t, l.dark)
  p.thickLine(x - arm * 0.72, hub + arm * 0.72, x + arm * 0.72, hub - arm * 0.72, t, l.dark)
}

const curtainWall: LandFn = l => {
  const { x, s } = l
  const half = Math.max(6, Math.round(s * 1.5))
  const stone = mix(l.body, l.pale, 0.3)
  const stoneLit = mix(l.lit, l.pale, 0.35)
  const h = Math.max(3, Math.round(s * 0.55))
  battlement(l, x - half, x + half, l.y - h, l.y, stone, stoneLit)
  for (const side of [-1, 1]) {
    const th = Math.round(h * 1.6)
    block(l, x + side * half, l.y - th, Math.max(2, Math.round(s * 0.18)), l.y, stone, stoneLit, l.dark)
  }
}

const pine: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(1, Math.round(s * 0.34))
  p.fill(x, l.y - Math.round(s * 0.2), 1, Math.round(s * 0.2), l.dark)
  const tiers = 3
  for (let i = 0; i < tiers; i += 1) {
    const t = i / tiers
    const yb = l.y - s * (0.14 + t * 0.6)
    const yt = yb - s * 0.4
    const hw = half * (1 - t * 0.55)
    p.poly([[x - hw, yb], [x, yt], [x + hw, yb]], i === 0 ? l.body : l.body)
    p.poly([[x, yb], [x, yt], [x + hw, yb]], l.lit)
  }
}

// ── renaissance ──

const domeCity: LandFn = l => {
  const { p, x, s } = l
  const stone = mix(l.body, l.pale, 0.42)
  const stoneLit = mix(l.lit, l.pale, 0.5)
  const roof = mix(l.dark, l.body, 0.45)
  const half = Math.max(10, Math.round(s * 1.5))
  // A low city of flat roofs with one great dome rising out of it.
  const blocks = 7 + Math.floor(vary(l, 1) * 5)
  for (let i = 0; i < blocks; i += 1) {
    const bw = Math.max(3, Math.round(s * (0.12 + vary(l, 10 + i) * 0.14)))
    const bh = Math.max(3, Math.round(s * (0.1 + vary(l, 20 + i) * 0.2)))
    const bx = x - half + (i / blocks) * half * 2
    block(l, bx, l.y - bh, bw / 2, l.y, stone, stoneLit, l.dark)
    p.fill(Math.round(bx - bw / 2), Math.round(l.y - bh), bw, 1, roof)
  }
  const drumH = Math.round(s * 0.34)
  const domeR = Math.max(4, Math.round(s * 0.42))
  const drumY = l.y - drumH
  block(l, x, drumY, domeR * 0.9, l.y, stone, stoneLit, l.dark)
  p.ellipse(x, drumY, domeR, domeR * 0.98, roof)
  p.fill(x - domeR, drumY, domeR * 2, 1, stoneLit)
  // The lit quarter of the dome, and the lantern on top.
  for (let dy = -domeR; dy <= 0; dy += 1) {
    for (let dx = 0; dx <= domeR; dx += 1) {
      if (dx * dx + dy * dy > domeR * domeR) continue
      const n = (dx * 0.75 - dy * 0.66) / domeR
      if (n > 0.42) p.set(x + dx, drumY + dy, mix(roof, l.pale, 0.42))
    }
  }
  block(l, x, drumY - domeR - Math.round(s * 0.14), Math.max(1, Math.round(s * 0.05)), drumY - domeR + 1, stoneLit, stoneLit, stone)
  // A campanile off to one side, so the skyline is not symmetrical.
  const cx = x + half * (l.flip ? -0.62 : 0.62)
  const ch = Math.round(s * 0.86)
  block(l, cx, l.y - ch, Math.max(1, Math.round(s * 0.1)), l.y, stone, stoneLit, l.dark)
  p.poly([[cx - s * 0.13, l.y - ch], [cx, l.y - ch - s * 0.16], [cx + s * 0.13, l.y - ch]], roof)
  hang(l, 'light', cx, l.y - ch - 1, 1.2)
  hang(l, 'smoke', x - half * 0.5, l.y - Math.round(s * 0.3), 1.0)
}

const aqueduct: LandFn = l => {
  const { p, x, s } = l
  const stone = mix(l.body, l.pale, 0.34)
  const stoneLit = mix(l.lit, l.pale, 0.4)
  const half = Math.max(10, Math.round(s * 2.1))
  const deckH = Math.max(2, Math.round(s * 0.12))
  const arches = Math.max(3, Math.round((half * 2) / Math.max(4, s * 0.52)))
  const pitch = (half * 2) / arches
  const pierW = Math.max(2, Math.round(pitch * 0.32))
  // Lower tier: tall piers carrying the deck.
  for (let i = 0; i <= arches; i += 1) {
    const px = x - half + i * pitch
    block(l, px, l.y - s * 0.72, pierW / 2, l.y, stone, stoneLit, l.dark)
  }
  p.fill(x - half - 1, Math.round(l.y - s * 0.72), half * 2 + 2, deckH, stone)
  p.fill(x - half - 1, Math.round(l.y - s * 0.72), half * 2 + 2, 1, stoneLit)
  // Upper tier: half as tall, twice as many, which is what an aqueduct does.
  const upper = arches * 2
  const upitch = (half * 2) / upper
  for (let i = 0; i <= upper; i += 1) {
    const px = x - half + i * upitch
    block(l, px, l.y - s, Math.max(1, upitch * 0.3) / 2, l.y - s * 0.72, stone, stoneLit, l.dark)
  }
  p.fill(x - half - 1, Math.round(l.y - s), half * 2 + 2, Math.max(2, Math.round(deckH * 0.7)), stone)
  p.fill(x - half - 1, Math.round(l.y - s), half * 2 + 2, 1, stoneLit)
}

const masts: LandFn = l => {
  const { p, x, s } = l
  const ships = 2 + Math.floor(vary(l, 1) * 3)
  const rope = mix(l.body, l.pale, 0.3)
  for (let i = 0; i < ships; i += 1) {
    const sx = x + Math.round((i - (ships - 1) / 2) * s * 0.85)
    const hullW = Math.max(3, Math.round(s * 0.5))
    const hullH = Math.max(2, Math.round(s * 0.16))
    p.poly([
      [sx - hullW, l.y - hullH],
      [sx + hullW, l.y - hullH],
      [sx + hullW * 0.7, l.y],
      [sx - hullW * 0.7, l.y]
    ], l.dark)
    const mh = s * (0.8 + vary(l, 10 + i) * 0.4)
    p.fill(sx, Math.round(l.y - hullH - mh), 1, Math.round(mh), rope)
    for (let k = 1; k <= 2; k += 1) {
      const yy = Math.round(l.y - hullH - mh * (0.4 + k * 0.25))
      const yw = Math.round(s * 0.22 * (1 - k * 0.25))
      p.fill(sx - yw, yy, yw * 2, 1, rope)
    }
  }
}

const oak: LandFn = l => {
  const { p, x, s } = l
  const cr = Math.max(2, Math.round(s * 0.46))
  p.fill(x, Math.round(l.y - s * 0.5), Math.max(1, Math.round(s * 0.1)), Math.round(s * 0.5), l.dark)
  p.ellipse(x, l.y - s * 0.62, cr * 1.15, cr, l.body)
  p.ellipse(x + cr * 0.4, l.y - s * 0.72, cr * 0.62, cr * 0.55, l.lit)
}

// ── modern ──

const skyline: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(12, Math.round(s * 1.9))
  const conc = mix(l.body, l.dark, 0.35)
  const concLit = l.lit
  const towers = 9 + Math.floor(vary(l, 1) * 6)
  for (let i = 0; i < towers; i += 1) {
    const bw = Math.max(3, Math.round(s * (0.12 + vary(l, 10 + i) * 0.16)))
    const bh = Math.max(4, Math.round(s * (0.24 + Math.pow(vary(l, 20 + i), 1.6) * 0.9)))
    const bx = x - half + (i / (towers - 1)) * half * 2
    block(l, bx, l.y - bh, bw / 2, l.y, conc, concLit, l.deep)
    // A hint of floors — two dark lines, not a grid.
    for (let k = 1; k <= 2; k += 1) {
      p.fill(Math.round(bx - bw / 2), Math.round(l.y - bh * (0.3 + k * 0.26)), bw, 1, l.deep)
    }
    if (bh > s * 0.7 && l.anchors) hang(l, 'light', bx, l.y - bh - 1, 1.1)
  }
  // Two stacks over the roofline, because a skyline needs something vertical.
  for (let k = 0; k < 2; k += 1) {
    const sx = x + half * (k === 0 ? -0.5 : 0.66)
    const sh = Math.round(s * (1.1 + vary(l, 40 + k) * 0.35))
    taper(l, sx, l.y - sh, l.y, s * 0.045, s * 0.085, conc, concLit)
    p.fill(Math.round(sx - s * 0.06), Math.round(l.y - sh), Math.max(2, Math.round(s * 0.12)), Math.max(1, Math.round(s * 0.04)), l.deep)
    hang(l, 'smoke', sx, l.y - sh, 1.5)
  }
}

const coolingTower: LandFn = l => {
  const { p, x, s } = l
  const conc = mix(l.body, l.pale, 0.24)
  const concLit = mix(l.lit, l.pale, 0.3)
  const top = l.y - s
  const halfAt = (t: number): number => {
    // A hyperboloid: wide at the foot, waisted, flaring at the lip.
    const u = t - 0.72
    return s * (0.2 + u * u * 0.58)
  }
  for (let y = top; y < l.y; y += 1) {
    const t = (y - top) / Math.max(1, s)
    const half = halfAt(t)
    const x0 = Math.round(x - half)
    const w = Math.max(1, Math.round(half * 2))
    p.fill(x0, y, w, 1, conc)
    p.fill(x0 + w - Math.max(1, Math.round(w * 0.3)), y, Math.max(1, Math.round(w * 0.3)), 1, concLit)
  }
  // The lip and the shadow inside it.
  const lip = Math.round(halfAt(0))
  p.fill(x - lip, top, lip * 2, Math.max(1, Math.round(s * 0.05)), l.deep)
  p.fill(x - lip, top, lip * 2, 1, concLit)
  hang(l, 'smoke', x, top, 2.2)
}

const smokestack: LandFn = l => {
  const { p, x, s } = l
  const brick = mix(l.body, l.dark, 0.28)
  taper(l, x, l.y - s, l.y, s * 0.05, s * 0.1, brick, l.lit)
  p.fill(Math.round(x - s * 0.07), Math.round(l.y - s), Math.max(2, Math.round(s * 0.14)), Math.max(1, Math.round(s * 0.035)), l.deep)
  for (let k = 1; k <= 2; k += 1) {
    p.fill(Math.round(x - s * 0.07), Math.round(l.y - s * (0.4 + k * 0.22)), Math.max(2, Math.round(s * 0.14)), 1, l.deep)
  }
  hang(l, 'smoke', x, l.y - s, 1.4)
  hang(l, 'light', x, l.y - s * 0.94, 0.8)
}

const gasometer: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(3, Math.round(s * 0.7))
  const steel = mix(l.body, l.pale, 0.22)
  block(l, x, l.y - s * 0.8, half, l.y, steel, mix(l.lit, l.pale, 0.28), l.dark)
  p.ellipse(x, l.y - s * 0.8, half, s * 0.16, mix(steel, l.pale, 0.2))
  // The lattice cage around it: verticals only, widely spaced.
  for (let i = -3; i <= 3; i += 1) {
    const gx = Math.round(x + (i / 3) * half)
    p.fill(gx, Math.round(l.y - s), 1, Math.round(s), l.deep)
  }
  p.fill(x - half, Math.round(l.y - s), half * 2, 1, l.deep)
}

const crane: LandFn = l => {
  const { p, x, s } = l
  const steel = mix(l.body, l.dark, 0.2)
  const legH = Math.round(s * 0.62)
  const legHalf = Math.max(2, Math.round(s * 0.34))
  const dir = l.flip ? -1 : 1
  for (const side of [-1, 1]) {
    p.thickLine(x + side * legHalf, l.y, x + side * legHalf * 0.4, l.y - legH, Math.max(1, Math.round(s * 0.055)), steel)
  }
  // The A-frame and the jib reaching out over the water.
  const apex = l.y - s
  p.thickLine(x - legHalf * 0.4, l.y - legH, x, apex, Math.max(1, Math.round(s * 0.05)), steel)
  p.thickLine(x + legHalf * 0.4, l.y - legH, x, apex, Math.max(1, Math.round(s * 0.05)), steel)
  const jib = s * 1.15
  p.thickLine(x - dir * jib * 0.32, l.y - legH * 1.05, x + dir * jib, l.y - legH * 1.35, Math.max(1, Math.round(s * 0.05)), steel)
  p.line(x, apex, x + dir * jib, l.y - legH * 1.35, l.dark)
  p.line(x, apex, x - dir * jib * 0.32, l.y - legH * 1.05, l.dark)
  p.fill(Math.round(x + dir * jib * 0.75), Math.round(l.y - legH * 1.3), 1, Math.round(s * 0.28), l.deep)
  hang(l, 'light', x, apex, 0.9)
  // The searchlight the modern age sweeps across its own sky rides the gantry.
  hang(l, 'beam', x, apex, 1)
}

const pylon: LandFn = l => {
  const { p, x, s } = l
  const steel = mix(l.body, l.dark, 0.3)
  const halfBot = Math.max(2, Math.round(s * 0.2))
  const halfTop = Math.max(1, Math.round(s * 0.07))
  p.thickLine(x - halfBot, l.y, x - halfTop, l.y - s, 1, steel)
  p.thickLine(x + halfBot, l.y, x + halfTop, l.y - s, 1, steel)
  // Cross-arms, widest at the bottom.
  for (let k = 0; k < 3; k += 1) {
    const yy = l.y - s * (0.5 + k * 0.21)
    const aw = s * (0.44 - k * 0.09)
    p.fill(Math.round(x - aw), Math.round(yy), Math.round(aw * 2), 1, steel)
    p.set(Math.round(x - aw), Math.round(yy) - 1, steel)
    p.set(Math.round(x + aw), Math.round(yy) - 1, steel)
  }
  // A couple of bracing X's rather than a full lattice.
  p.line(x - halfBot, l.y, x + halfTop, l.y - s * 0.5, l.dark)
  p.line(x + halfBot, l.y, x - halfTop, l.y - s * 0.5, l.dark)
}

const warehouse: LandFn = l => {
  const { p, x, s } = l
  const half = Math.max(6, Math.round(s * 1.4))
  const conc = mix(l.body, l.dark, 0.25)
  const h = Math.max(3, Math.round(s * 0.5))
  block(l, x, l.y - h, half, l.y, conc, l.lit, l.deep)
  // A sawtooth roof: north lights, all facing the same way.
  const teeth = Math.max(3, Math.round(half / Math.max(3, s * 0.28)))
  const pitch = (half * 2) / teeth
  for (let i = 0; i < teeth; i += 1) {
    const tx = x - half + i * pitch
    p.poly([
      [tx, l.y - h],
      [tx + pitch, l.y - h - s * 0.2],
      [tx + pitch, l.y - h]
    ], l.dark)
    p.fill(Math.round(tx + pitch) - 1, Math.round(l.y - h - s * 0.2), 1, Math.round(s * 0.2), l.lit)
  }
}

const wire: LandFn = l => {
  const { p, x, s } = l
  const h = Math.max(2, Math.round(s * 0.9))
  p.fill(x, l.y - h, 1, h, l.dark)
  const lean = Math.round(s * 0.5)
  p.line(x, l.y - h, x + lean, l.y - h + Math.round(s * 0.35), l.dark)
  p.line(x, l.y - h, x - lean, l.y - h + Math.round(s * 0.4), l.dark)
}

// ── future ──

const arcology: LandFn = l => {
  const { p, x, s } = l
  const alloy = mix(l.body, l.pale, 0.3)
  const alloyLit = mix(l.lit, l.pale, 0.4)
  const tiers = 5
  let half = s * 0.62
  let base = l.y
  for (let i = 0; i < tiers; i += 1) {
    const th = s * (0.2 - i * 0.022)
    block(l, x, base - th, half, base, alloy, alloyLit, l.deep)
    // A lit deck edge and a row of windows on each terrace.
    p.fill(Math.round(x - half), Math.round(base - th), Math.round(half * 2), 1, alloyLit)
    const wins = Math.max(2, Math.round(half / 3))
    for (let k = 0; k < wins; k += 1) {
      const wx = Math.round(x - half + 2 + (k / wins) * (half * 2 - 3))
      p.set(wx, Math.round(base - th * 0.5), l.key)
    }
    base -= th
    half *= 0.66
  }
  // The mast: a needle carrying the whole silhouette upward.
  const mastH = s * 0.5
  p.fill(x - 1, Math.round(base - mastH), 3, Math.round(mastH), alloy)
  p.fill(x + 1, Math.round(base - mastH), 1, Math.round(mastH), alloyLit)
  hang(l, 'light', x, base - mastH, 1.4)
  hang(l, 'light', x - s * 0.4, l.y - s * 0.16, 1.0)
}

const orbitalElevator: LandFn = l => {
  const { p, x, s } = l
  const alloy = mix(l.body, l.pale, 0.34)
  const alloyLit = mix(l.lit, l.pale, 0.44)
  // The anchor station: a broad terraced base.
  const baseHalf = Math.max(4, Math.round(s * 0.5))
  block(l, x, l.y - s * 0.22, baseHalf, l.y, alloy, alloyLit, l.deep)
  block(l, x, l.y - s * 0.4, baseHalf * 0.55, l.y - s * 0.22, alloy, alloyLit, l.deep)
  // The ribbon: dead straight, thinning, running off the top of the layer.
  const top = -8
  const bot = Math.round(l.y - s * 0.4)
  for (let y = bot; y > top; y -= 1) {
    const t = (bot - y) / Math.max(1, bot - top)
    const wdt = Math.max(1, Math.round(3 * (1 - t * 0.6)))
    p.fill(x - Math.floor(wdt / 2), y, wdt, 1, alloy)
    p.fill(x - Math.floor(wdt / 2) + wdt - 1, y, 1, 1, alloyLit)
  }
  // Climbers on the ribbon: three small lit nodes at different heights.
  for (let k = 0; k < 3; k += 1) {
    const cy = Math.round(bot - (bot - top) * (0.16 + k * 0.28))
    p.fill(x - 2, cy, 5, 3, alloyLit)
    p.fill(x - 1, cy + 1, 3, 1, l.key)
  }
  hang(l, 'beam', x, l.y - s * 0.4, 1)
  hang(l, 'light', x, l.y - s * 0.42, 1.3)
}

const spires: LandFn = l => {
  const { p, x, s } = l
  const alloy = mix(l.body, l.pale, 0.26)
  const alloyLit = mix(l.lit, l.pale, 0.36)
  const count = 3 + Math.floor(vary(l, 1) * 3)
  for (let i = 0; i < count; i += 1) {
    const sx = x + Math.round((i - (count - 1) / 2) * s * 0.42)
    const sh = s * (0.5 + vary(l, 10 + i) * 0.6)
    const half = Math.max(1, s * 0.06)
    taper(l, sx, l.y - sh, l.y, half * 0.5, half, alloy, alloyLit)
    p.fill(Math.round(sx), Math.round(l.y - sh - s * 0.1), 1, Math.round(s * 0.1), alloyLit)
    if (i % 2 === 0) hang(l, 'light', sx, l.y - sh - s * 0.1, 0.9)
  }
}

const habBlock: LandFn = l => {
  const { p, x, s } = l
  const alloy = mix(l.body, l.pale, 0.22)
  const half = Math.max(3, Math.round(s * 0.6))
  const h = Math.round(s * 0.7)
  block(l, x, l.y - h, half, l.y, alloy, mix(l.lit, l.pale, 0.3), l.deep)
  p.ellipse(x, l.y - h, half, s * 0.2, alloy)
  for (let k = 0; k < 3; k += 1) {
    for (let i = -2; i <= 2; i += 1) {
      p.set(Math.round(x + i * (half / 2.6)), Math.round(l.y - h * (0.25 + k * 0.24)), l.key)
    }
  }
}

const dish: LandFn = l => {
  const { p, x, s } = l
  const steel = mix(l.body, l.pale, 0.25)
  p.fill(x, Math.round(l.y - s * 0.55), Math.max(1, Math.round(s * 0.1)), Math.round(s * 0.55), steel)
  const r = Math.max(3, Math.round(s * 0.5))
  const cy = Math.round(l.y - s * 0.62)
  // A dish is a bowl seen edge-on: an ellipse with a bite out of its face.
  p.ellipse(x, cy, r * 0.72, r, steel)
  p.ellipse(x - r * 0.2, cy, r * 0.5, r * 0.82, mix(l.lit, l.pale, 0.36))
  p.fill(x + Math.round(r * 0.5), cy - 1, Math.round(r * 0.5), 2, steel)
}

const rock: LandFn = l => {
  const { p, x, s } = l
  const rx = Math.max(1, Math.round(s * 0.7))
  const ry = Math.max(1, Math.round(s * 0.45))
  p.ellipse(x, l.y - ry, rx, ry, l.body)
  p.ellipse(x + Math.round(rx * 0.3), l.y - ry * 1.3, Math.max(1, Math.round(rx * 0.45)), Math.max(1, Math.round(ry * 0.45)), l.lit)
}

const LANDMARKS: Record<string, LandFn> = {
  mesa,
  peak,
  volcano,
  arch: archRock,
  monolith,
  ribcage,
  skull,
  deadTree,
  boulder,
  fern,
  cragCity,
  cathedral,
  towerRuin,
  windmill,
  wall: curtainWall,
  pine,
  domeCity,
  aqueduct,
  masts,
  oak,
  skyline,
  coolingTower,
  smokestack,
  gasometer,
  crane,
  pylon,
  warehouse,
  wire,
  arcology,
  elevator: orbitalElevator,
  spires,
  hab: habBlock,
  dish,
  rock
}

/** Things that need level ground cut under them before they are drawn. */
const BUILT = new Set([
  'cragCity',
  'cathedral',
  'towerRuin',
  'windmill',
  'wall',
  'domeCity',
  'aqueduct',
  'masts',
  'skyline',
  'coolingTower',
  'smokestack',
  'gasometer',
  'crane',
  'warehouse',
  'arcology',
  'elevator',
  'spires',
  'hab',
  'dish',
  'ribcage'
])

/** How wide a landmark's footprint is, as a multiple of its height. */
const FOOTPRINT: Record<string, number> = {
  volcano: 1.75,
  mesa: 1.05,
  peak: 1.2,
  skyline: 1.95,
  aqueduct: 2.15,
  domeCity: 1.55,
  cragCity: 1.3,
  ribcage: 1.25,
  masts: 1.4,
  wall: 1.55,
  warehouse: 1.45,
  arcology: 0.7,
  spires: 0.75,
  gasometer: 0.75,
  crane: 0.6,
  arch: 0.85,
  monolith: 0.6,
  cathedral: 0.6,
  hab: 0.65,
  elevator: 0.55
}

/** The five tones and the light colour one range lends to what stands on it. */
interface LandTones {
  body: number
  lit: number
  dark: number
  deep: number
  key: number
  pale: number
}

/**
 * Draws one landmark, three times, so a shape that crosses the layer's wrap is
 * continuous instead of clipped in half. Anchors are emitted by the middle copy
 * only; the live scene wraps their positions itself.
 */
function drawLandmark(
  p: Pix,
  w: number,
  spot: Placement,
  size: number,
  baseY: number,
  tones: LandTones,
  d: number,
  anchors: EnvAnchor[]
): void {
  const fn = LANDMARKS[spot.kind]
  if (!fn) return
  for (const off of [-w, 0, w]) {
    fn({
      p,
      x: spot.x + off,
      y: baseY,
      s: size,
      body: tones.body,
      lit: tones.lit,
      dark: tones.dark,
      deep: tones.deep,
      key: tones.key,
      pale: tones.pale,
      seed: spot.seed,
      flip: spot.flip,
      d,
      anchors: off === 0 ? anchors : null
    })
  }
}

// ──────────────────────────── The sky ────────────────────────────

/**
 * Where the sky finishes arriving at its horizon colour.
 *
 * *Not* where the ground plane's horizon is. Arriving at the horizon colour on
 * the ground line puts the entire glow behind the four ranges, where nobody
 * can ever see it, and leaves the far range standing against the dim middle of
 * the gradient with nothing between them. The glow has to be finished *above*
 * the skyline — a little over the top of the far range's crest window — so
 * that what the mountains are actually silhouetted against is the bright part.
 */
const SKY_GLOW_FRAC = 0.3

/**
 * The sky.
 *
 * A big flat gradient field, quantised into broad bands of solid colour with a
 * short dithered join between each pair. That is the whole trick: the old sky
 * dithered *everywhere*, which laid a checkerboard film over the entire frame
 * and read as haze. Here two thirds of every band is one untouched colour, the
 * joins wander by a few pixels so no boundary is a ruled line, and the eye
 * reads a painted sky rather than a screen door.
 */
export function envSkyPix(age: number, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const horizon = skyHorizon(age)
  const stops: readonly (readonly [number, number])[] = [
    [0, t.sky[0]],
    [0.11, t.sky[1]],
    [SKY_GLOW_FRAC, horizon],
    [1, horizon]
  ]
  const colourAt = (tt: number): number => {
    for (let i = 1; i < stops.length; i += 1) {
      if (tt <= stops[i][0] || i === stops.length - 1) {
        const u = Math.min(1, Math.max(0, (tt - stops[i - 1][0]) / Math.max(1e-6, stops[i][0] - stops[i - 1][0])))
        return mix(stops[i - 1][1], stops[i][1], u)
      }
    }
    return horizon
  }

  const STEPS = 44
  const levels: number[] = []
  for (let i = 0; i <= STEPS + 1; i += 1) levels.push(colourAt(i / STEPS))

  // The band edges are not level. A gradient quantised on a flat row draws
  // thirty perfectly horizontal rules across the picture; a few pixels of
  // low-frequency wander makes them air.
  const wob = wrapNoise(age * 17 + 3, w, 3, 2, 0.5)
  const wob2 = wrapNoise(age * 23 + 11, w, 7, 2, 0.5)
  const glowC = mix(horizon, t.sun, 0.55)
  const sunAt = ENV_SUN_POS[Math.max(0, Math.min(ENV_SUN_POS.length - 1, age))]
  const sunX = sunAt[0] * w
  const sunY = sunAt[1] * h
  const glowR = h * 0.78

  for (let x = 0; x < w; x += 1) {
    const shift = (wob(x) - 0.5) * 5 + (wob2(x) - 0.5) * 2
    for (let y = 0; y < h; y += 1) {
      const tt = Math.min(1, Math.max(0, (y + shift) / (h - 1)))
      const q = tt * STEPS
      const k = Math.floor(q)
      const f = q - k
      // Flat, flat, and a narrow dithered join in between.
      const join = f < 0.34 ? 0 : f > 0.68 ? 1 : (f - 0.34) / 0.34
      let c = join <= 0 ? levels[k] : join >= 1 ? levels[k + 1] : ditherAt(x, y, join) ? levels[k + 1] : levels[k]

      // The glow around the sun, in eight small steps rather than four large
      // ones. A big step in a radial ramp draws a visible arc across the sky,
      // and four of them read as a target painted behind the sun.
      const dd = Math.hypot((x - sunX) * 0.94, y - sunY) / glowR
      if (dd < 1) {
        const strength = Math.pow(1 - dd, 2.1) * 8
        const lv = Math.floor(strength)
        const fr = strength - lv
        const edge = fr < 0.3 ? 0 : fr > 0.72 ? 1 : (fr - 0.3) / 0.42
        const level = lv + (edge <= 0 ? 0 : edge >= 1 ? 1 : ditherAt(x, y, edge) ? 1 : 0)
        if (level > 0) c = mix(c, glowC, Math.min(0.5, level * 0.062))
      }
      p.set(x, y, c)
    }
  }

  skyFeature(p, age, w, h, horizon)

  // Stars, only where the sky is genuinely dark. Baked in, so the cloud banks
  // in front of them occlude them.
  const stars = pixelNoise(age * 313 + 91)
  for (let y = 0; y < h * 0.72; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const here = rgbOf(p.get(x, y))
      const dark = 1 - Math.min(1, lum(here) / 82)
      if (dark <= 0.06) continue
      const n = stars(x, y)
      const fall = 1 - y / (h * 0.72)
      if (n > 0.99915) {
        p.set(x, y, mix(here, 0xffffff, 0.9 * dark * (0.4 + fall * 0.6)))
        if (n > 0.99982) {
          const halo = mix(here, 0xffffff, 0.42 * dark)
          p.set(x - 1, y, halo)
          p.set(x + 1, y, halo)
          p.set(x, y - 1, halo)
          p.set(x, y + 1, halo)
        }
      } else if (n > 0.9962) {
        p.set(x, y, mix(here, 0xffffff, 0.4 * dark * fall))
      }
    }
  }
  return p
}

/**
 * A long flat bank of high cloud lying across the sky.
 *
 * Tapered at both ends, wavering along its length and torn into it, because a
 * perfect horizontal lens repeated five times is a set of venetian blinds. Used
 * by the two ages whose air is full of something.
 */
function stratum(
  p: Pix,
  w: number,
  seed: number,
  cx: number,
  cy: number,
  half: number,
  thick: number,
  body: number,
  lit: number
): void {
  const wave = wrapNoise(seed, w, 5, 2, 0.5)
  const tear = wrapNoise(seed + 17, w, 30, 2, 0.5)
  for (let off = -w; off <= w; off += w) {
    for (let dx = -half; dx <= half; dx += 1) {
      const xx = Math.round(cx + dx + off)
      if (xx < 0 || xx >= w) continue
      const u = Math.abs(dx) / half
      const gap = tear(xx)
      if (gap < 0.34 - (1 - u) * 0.26) continue
      const hh = Math.round(thick * (1 - u * u) * (0.4 + gap * 1.2))
      if (hh <= 0) continue
      const yy = Math.round(cy + (wave(xx) - 0.5) * thick * 5)
      p.fill(xx, yy - hh, 1, hh * 2, body)
      p.fill(xx, yy - hh, 1, 1, lit)
    }
  }
}

/** One deliberate thing per age that the sky itself does. */
function skyFeature(p: Pix, age: number, w: number, h: number, horizon: number): void {
  const t = theme(age)
  switch (age) {
    case 0: {
      // Volcanic ash drawn out into long streamers by the wind. Flat, tapered,
      // and well clear of the horizon, so the glow the ranges stand against
      // stays open beneath them.
      const ash = mix(t.sky[1], 0x000000, 0.2)
      const ashLit = mix(ash, t.sun, 0.4)
      const n0 = pixelNoise(701)
      for (let i = 0; i < 5; i += 1) {
        stratum(
          p,
          w,
          701 + i * 13,
          n0(i, 3) * w,
          h * (0.11 + i * 0.038 + n0(i, 1) * 0.02),
          w * (0.13 + n0(i, 2) * 0.15),
          h * (0.006 + n0(i, 4) * 0.01),
          ash,
          ashLit
        )
      }
      break
    }
    case 1: {
      // A warm shelf of air lying on the horizon — the one thing a clear day
      // has that a flat gradient does not.
      const warm = mix(horizon, t.sun, 0.3)
      const edge = wrapNoise(811, w, 6, 3, 0.5)
      for (let x = 0; x < w; x += 1) {
        const y0 = Math.round(h * 0.455 + edge(x) * h * 0.028)
        const y1 = Math.round(h * 0.53)
        p.fill(x, y0 + 4, 1, y1 - y0 - 4, warm)
        for (let k = 0; k < 5; k += 1) if (ditherAt(x, y0 + k, k / 5)) p.set(x, y0 + k, warm)
      }
      break
    }
    case 2: {
      // An overcast lid pressing down from the top of the frame, with a lobed
      // lower edge rather than a straight one.
      const lid = mix(t.sky[0], 0x000000, 0.22)
      const lidLit = mix(lid, t.sun, 0.24)
      // A fractal lower edge. Circular lobes give a scalloped hem, which is
      // bunting; real cloud base is irregular at every scale at once, and four
      // octaves of periodic noise is exactly that.
      const coarse = wrapNoise(907, w, 3, 2, 0.5)
      const fine = wrapNoise(911, w, 11, 4, 0.55)
      for (let x = 0; x < w; x += 1) {
        const y1 = Math.round(h * (0.09 + coarse(x) * 0.16 + (fine(x) - 0.5) * 0.06))
        p.fill(x, 0, 1, y1, lid)
        p.fill(x, Math.max(0, y1 - Math.round(h * 0.025)), 1, Math.round(h * 0.025), lidLit)
      }
      break
    }
    case 3: {
      // Smog: three long strata of denser air, tapered at both ends.
      const smog = mix(t.fog, t.sky[1], 0.34)
      const smogLit = mix(smog, t.sun, 0.22)
      const n = pixelNoise(1009)
      for (let i = 0; i < 5; i += 1) {
        stratum(
          p,
          w,
          1009 + i * 11,
          n(i, 3) * w,
          h * (0.17 + i * 0.04 + n(i, 1) * 0.02),
          w * (0.18 + n(i, 2) * 0.18),
          h * (0.005 + n(i, 4) * 0.009),
          smog,
          smogLit
        )
      }
      break
    }
    case 4: {
      // The planet's own ring, seen edge-on from its surface: a broad banded
      // arc across the whole sky. This is the age's biggest single shape and it
      // is drawn flat, in four solid values, with no dither in it at all.
      const cxr = w * 0.5
      const cyr = h * 2.62
      const R = h * 2.35
      const bands: readonly (readonly [number, number, number])[] = [
        [0, 5, 0.3],
        [6, 15, 0.62],
        [17, 22, 0.4],
        [25, 30, 0.16]
      ]
      const nebC = mix(t.sky[1], t.sun, 0.55)
      const neb = smoothNoise2(913)
      for (let y = 0; y < h * 0.62; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const v = neb(x * 0.013, y * 0.021)
          if (v > 0.7) p.set(x, y, mix(rgbOf(p.get(x, y)), nebC, v > 0.775 ? 0.2 : 0.1))
        }
      }
      for (let x = 0; x < w; x += 1) {
        const dx = x - cxr
        const inner = Math.sqrt(Math.max(0, R * R - dx * dx))
        for (const [a, b, k] of bands) {
          const y0 = Math.round(cyr - inner - b)
          const y1 = Math.round(cyr - inner - a)
          const c = mix(t.sky[1], mix(t.sun, 0xffffff, 0.5), k)
          for (let y = y0; y < y1; y += 1) if (y >= 0 && y < h) p.set(x, y, c)
        }
      }
      break
    }
    default:
      break
  }
}

/**
 * The sun, the moon or whatever else this age hangs in its sky.
 *
 * One hard disc and a corona of three or four solid rings. The rings are
 * quantised and their joins dithered over a couple of pixels, so the body has
 * weight and glare without a soft edge anywhere on it.
 */
export function envCelestialPix(age: number): Pix {
  const t = theme(age)
  const moon = age === 4
  const r = [27, 20, 23, 18, 22][Math.max(0, Math.min(4, age))]
  const pad = Math.round(r * 2.6)
  const size = r * 2 + pad * 2
  const p = new Pix(size, size)
  const c = size / 2
  const core = mix(t.sun, 0xffffff, moon ? 0.12 : 0.45)
  const rim = t.sun
  const halo = mix(t.sun, skyHorizon(age), 0.45)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c)
      if (d <= r) {
        p.set(x, y, d > r - Math.max(1.5, r * 0.11) ? rim : core)
        continue
      }
      // The corona is drawn in *alpha*, not in opaque tones. A halo painted as
      // solid colour has to guess the sky behind it, and on the ages whose sun
      // hangs in a dark zenith that guess is a bright disc — the fried egg the
      // first pass produced. Six quantised alpha steps composite against
      // whatever sky is actually there.
      const fall = Math.max(0, 1 - (d - r) / (size / 2 - r))
      const scaled = Math.pow(fall, 1.5) * 6
      const lv = Math.floor(scaled)
      const fr = scaled - lv
      const edge = fr < 0.32 ? 0 : fr > 0.72 ? 1 : (fr - 0.32) / 0.4
      const level = lv + (edge <= 0 ? 0 : edge >= 1 ? 1 : ditherAt(x, y, edge) ? 1 : 0)
      if (level > 0) p.set(x, y, mix(halo, rim, Math.min(1, level / 5)), Math.min(230, level * 36))
    }
  }

  if (moon) {
    // Craters, then a terminator, so it reads as a body and not a lamp.
    const n = pixelNoise(4001)
    for (let i = 0; i < 8; i += 1) {
      const a = n(i, 1) * Math.PI * 2
      const rr = n(i, 2) * r * 0.66
      p.ellipse(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1.5 + n(i, 3) * 3, 1.2 + n(i, 3) * 2.4, mix(core, halo, 0.5))
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (Math.hypot(x - c, y - c) > r) continue
        if (Math.hypot(x - (c - r * 1.08), y - (c - r * 0.2)) < r * 1.02) p.set(x, y, mix(core, t.sky[0], 0.55))
      }
    }
  } else if (age === 0) {
    // A low sun with two bars of haze lying across it: the single cheapest
    // thing that says "this is the horizon and the air is thick".
    const bar = mix(rim, t.sky[1], 0.55)
    for (let k = 0; k < 2; k += 1) {
      p.fill(c - r, c - r * (0.12 - k * 0.42), r * 2, Math.max(2, Math.round(r * 0.13)), bar)
    }
  } else if (age !== 2) {
    // Glare: four short spikes, dithered out, only on the ages with a clear sky.
    for (let i = 0; i < 4; i += 1) {
      const dx = i < 2 ? (i === 0 ? 1 : -1) : 0
      const dy = i < 2 ? 0 : i === 2 ? 1 : -1
      for (let k = r; k < size / 2 - 1; k += 1) {
        const strength = 1 - (k - r) / (size / 2 - r)
        if (ditherAt(c + dx * k, c + dy * k, strength * strength * 1.5)) p.set(c + dx * k, c + dy * k, rim)
      }
    }
  }
  return p
}

// ──────────────────────────── Cloud ────────────────────────────

/**
 * A cloud bank, drawn as shapes rather than as a density field.
 *
 * Cumulus is a stack of lobes with a *flat* base and a lit crown; cirrus is a
 * thin lens with torn ends. Both are painted in three solid values with hard
 * boundaries — the boundary between a lit lobe and a shaded one is a curve, and
 * a curve drawn as a curve reads better than a curve implied by dithering.
 *
 * Everything is drawn three times, at `x - w`, `x` and `x + w`, so the bank
 * drifts forever without a seam.
 */
export function envCloudPix(age: number, tier: 0 | 1, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const overcast = age === 2 || age === 3
  const horizon = skyHorizon(age)
  const body = mix(horizon, t.sky[1], tier === 0 ? 0.3 : 0.16)
  const lit = mix(body, keyLight(age), tier === 0 ? 0.4 : 0.55)
  const shade = mix(body, t.sky[1], 0.62)
  const deep = mix(shade, t.sky[0], 0.4)
  const n = pixelNoise(age * 401 + tier * 7 + 3)

  if (tier === 1) {
    const count = overcast ? 9 : 7
    for (let i = 0; i < count; i += 1) {
      const cx = ((i + n(i, 1) * 0.75) * w) / count
      const baseY = Math.round(h * (0.5 + n(i, 2) * 0.36))
      const scale = h * (0.13 + n(i, 3) * 0.11)
      const spanX = Math.round(scale * (1.5 + n(i, 4) * 1.4))
      const lobeCount = 3 + Math.floor(n(i, 5) * 4)
      const lobes: { x: number; y: number; r: number }[] = []
      for (let k = 0; k < lobeCount; k += 1) {
        const u = lobeCount === 1 ? 0 : k / (lobeCount - 1) - 0.5
        lobes.push({
          x: u * spanX * 1.5 + (n(i, 10 + k) - 0.5) * spanX * 0.24,
          // The tallest lobe sits off centre. A symmetrical pile reads as a bun.
          y: -scale * (0.45 + Math.pow(Math.sin((k + 0.7) * 1.9) * 0.5 + 0.5, 1.2) * 0.85 + n(i, 20 + k) * 0.2),
          r: scale * (0.55 + n(i, 30 + k) * 0.4) * (1 - Math.abs(u) * 0.42)
        })
      }
      // The silhouette first, as the upper envelope of the lobes. Filling each
      // lobe on its own leaves daylight between them and the cloud reads as a
      // bag of circles; one envelope with one flat base reads as weather.
      const reach = spanX + scale * 2
      const top = new Float64Array(reach * 2 + 1).fill(baseY + 1)
      for (const lb of lobes) {
        for (let dx = Math.ceil(lb.x - lb.r); dx <= Math.floor(lb.x + lb.r); dx += 1) {
          const idx = dx + reach
          if (idx < 0 || idx >= top.length) continue
          const y = baseY + lb.y - Math.sqrt(Math.max(0, lb.r * lb.r - (dx - lb.x) * (dx - lb.x)))
          if (y < top[idx]) top[idx] = y
        }
      }
      for (let off = -w; off <= w; off += w) {
        const ox = cx + off
        if (ox + reach < 0 || ox - reach > w) continue
        for (let dx = -reach; dx <= reach; dx += 1) {
          const x = Math.round(ox + dx)
          if (x < 0 || x >= w) continue
          const y0 = Math.ceil(top[dx + reach])
          if (y0 > baseY - 2) continue
          for (let y = Math.max(0, y0); y <= Math.min(h - 1, baseY); y += 1) {
            // Shading comes from whichever lobe owns this pixel, so the boundary
            // between light and shadow curves the way the lump does.
            let best = -1
            let bnx = 0
            let bny = 0
            for (const lb of lobes) {
              const ddx = (dx - lb.x) / lb.r
              const ddy = (y - (baseY + lb.y)) / lb.r
              const dd = ddx * ddx + ddy * ddy
              if (dd > 1) continue
              if (1 - dd > best) {
                best = 1 - dd
                bnx = ddx
                bny = ddy
              }
            }
            const litness = best < 0 ? -0.2 : -bny * 0.86 + bnx * 0.5
            const fromBase = (baseY - y) / scale
            let c = body
            if (fromBase < 0.1) c = deep
            else if (fromBase < 0.34) c = shade
            else if (litness > 0.56) c = lit
            else if (litness < 0.04) c = shade
            p.set(x, y, c)
          }
        }
      }
    }
  } else {
    const count = overcast ? 9 : 7
    for (let i = 0; i < count; i += 1) {
      const cx = ((i + n(i, 1) * 0.8) * w) / count
      const cy = h * (0.14 + n(i, 2) * 0.6)
      const len = w * (0.06 + n(i, 3) * 0.08)
      const thick = h * (0.008 + n(i, 4) * 0.016)
      const tear = wrapNoise(age * 91 + i * 13 + tier, w, 40, 2, 0.5)
      const slant = (n(i, 6) - 0.5) * thick * 3
      for (let off = -w; off <= w; off += w) {
        const ox = cx + off
        if (ox + len < 0 || ox - len > w) continue
        for (let dx = -len; dx <= len; dx += 1) {
          const x = Math.round(ox + dx)
          if (x < 0 || x >= w) continue
          const u = Math.abs(dx) / len
          const gap = tear(x)
          if (gap < 0.42 - (1 - u) * 0.3) continue
          const half = thick * (1 - Math.pow(u, 1.6)) * (0.3 + gap * 1.5)
          if (half < 0.5) continue
          const yc = cy + (dx / len) * slant
          const y0 = Math.round(yc - half)
          const y1 = Math.round(yc + half)
          for (let y = y0; y <= y1; y += 1) {
            if (y < 0 || y >= h) continue
            const v = (y - y0) / Math.max(1, y1 - y0)
            p.set(x, y, v < 0.42 ? lit : v > 0.8 ? shade : body)
          }
        }
      }
    }
  }
  return p
}

// ──────────────────────────── The ranges ────────────────────────────

export interface EnvBandArt {
  pix: Pix
  anchors: EnvAnchor[]
}

/**
 * The crest window of each range, as a fraction of that range's own height.
 *
 * These are not free parameters. Every range's foot is pinned to the ground
 * line, so the window decides exactly where its skyline lands on screen — and
 * the four windows are chosen so the crests stack into a readable staircase
 * with the top third of the frame left open as sky at every age.
 */
const CREST_HI = [0.66, 0.7, 0.727, 0.787]
const CREST_LO = [0.813, 0.845, 0.885, 0.951]

/** How much of each range is actually visible before the next one covers it. */
const BAND_VISIBLE = [110, 88, 70, 48]

/** What stands on the skyline in each age, from the far range to the near one. */
const AGE_CAST: readonly (readonly (readonly string[])[])[] = [
  [
    ['volcano', 'mesa', 'peak', 'mesa', 'peak'],
    ['mesa', 'peak', 'arch', 'monolith'],
    ['ribcage', 'monolith', 'mesa', 'deadTree'],
    ['skull', 'boulder', 'deadTree', 'ribcage']
  ],
  [
    ['cragCity', 'peak', 'mesa', 'peak', 'peak'],
    ['cathedral', 'towerRuin', 'peak', 'wall'],
    ['windmill', 'wall', 'towerRuin', 'pine'],
    ['pine', 'pine', 'wall', 'boulder']
  ],
  [
    ['domeCity', 'domeCity', 'mesa', 'peak', 'peak'],
    ['aqueduct', 'towerRuin', 'domeCity', 'windmill'],
    ['masts', 'windmill', 'wall', 'oak'],
    ['oak', 'oak', 'wall', 'rock']
  ],
  [
    ['skyline', 'skyline', 'mesa', 'skyline', 'peak'],
    ['coolingTower', 'smokestack', 'gasometer', 'warehouse', 'coolingTower'],
    ['crane', 'warehouse', 'pylon', 'smokestack'],
    ['pylon', 'wire', 'deadTree', 'rock']
  ],
  [
    ['arcology', 'arcology', 'spires', 'mesa', 'spires'],
    ['elevator', 'arcology', 'spires', 'dish'],
    ['spires', 'hab', 'dish', 'pylon'],
    ['wire', 'hab', 'rock', 'pylon']
  ]
]

/** The small growth scattered along the two near crests. */
const AGE_SCRUB: readonly (readonly string[])[] = [
  ['fern', 'fern', 'rock', 'deadTree'],
  ['pine', 'pine', 'rock', 'pine'],
  ['oak', 'oak', 'rock', 'pine'],
  ['wire', 'rock', 'deadTree', 'rock'],
  ['wire', 'rock', 'wire', 'rock']
]

const CAST_COUNT = [4, 6, 8, 11]
const CAST_MIN = [56, 34, 18, 11]
const CAST_MAX = [98, 60, 32, 20]

/** Landmarks that are bigger or smaller than the range's nominal figure. */
const SIZE_SCALE: Record<string, number> = {
  volcano: 1.6,
  cragCity: 1.2,
  domeCity: 1.15,
  skyline: 1.05,
  arcology: 1.35,
  elevator: 1.55,
  aqueduct: 0.8,
  ribcage: 0.8,
  masts: 0.8
}

/** Things that grow, and so are specks at distance rather than buildings. */
const ORGANIC = new Set(['pine', 'oak', 'deadTree', 'fern', 'boulder', 'rock', 'skull', 'wire'])

/** The shape families the land itself is massed from, per age. */
const LANDFORM: readonly (readonly string[])[] = [
  ['mesa', 'mesa', 'cone', 'dome'],
  ['cone', 'dome', 'cone', 'ridge'],
  ['dome', 'cone', 'dome', 'ridge'],
  ['dome', 'ridge', 'dome', 'cone'],
  ['cone', 'cone', 'ridge', 'dome']
]

/**
 * One range of terrain.
 *
 * A clean silhouette and three or four confident value steps, and nothing else.
 * The land is *massed* from big shapes — mesas, cones, domes, long ridges —
 * rather than sculpted out of noise, because noise gives lumps and the eye
 * wants forms. Interior detail is a lit facet where a face genuinely turns into
 * the light, a step down into the valleys, and a shadow at the feet. There is
 * no rim line following the crest and no dither over the body.
 */
export function envBandArt(age: number, depth: number, worldW: number, worldH: number): EnvBandArt {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const anchors: EnvAnchor[] = []
  const d = Math.max(0, Math.min(ENV_BAND_HEIGHTS.length - 1, depth))
  const base = envBandBase(age, d)
  const r = ramp(base, { contrast: [0.3, 0.42, 0.56, 0.72][d], hueShift: 0.05, shadowSat: 0.05 })
  const key = keyLight(age)

  const hi = CREST_HI[d] * h
  const lo = CREST_LO[d] * h
  const span = lo - hi

  // ── massing ──
  const swell = wrapNoise(age * 97 + d * 31 + 5, w, [3, 4, 5, 6][d], 4, 0.5)
  const grain = wrapNoise(age * 53 + d * 19 + 11, w, [9, 14, 22, 34][d], 3, 0.5)
  const tops = new Float64Array(w)
  for (let x = 0; x < w; x += 1) {
    let m = swell(x)
    m = m * m * (3 - 2 * m)
    const g = (grain(x) - 0.5) * [0.1, 0.12, 0.16, 0.2][d]
    tops[x] = lo - (m * 0.34 + g) * span
  }

  const forms = scatter(age * 401 + d * 53 + 9, w, [4, 5, 6, 7][d], LANDFORM[Math.min(4, age)], 0, 1000)
  for (const f of forms) {
    const kind = f.kind
    const rise = span * (0.3 + Math.pow(f.size / 1000, 1.1) * 0.72)
    const summit = lo - rise
    const ratio = kind === 'mesa' ? 1.15 : kind === 'cone' ? 1.05 : kind === 'dome' ? 1.6 : 2.4
    const half = Math.max(8, rise * ratio)
    const reach = (lo - summit) * 1.2 + span * 0.14
    for (let dx = -half; dx <= half; dx += 1) {
      const u = Math.min(1, Math.abs(dx) / half)
      let drop: number
      if (kind === 'mesa') drop = u < 0.5 ? 0 : Math.pow((u - 0.5) / 0.5, 0.62)
      else if (kind === 'cone') drop = Math.pow(u, 1.12)
      else if (kind === 'dome') drop = 1 - Math.sqrt(Math.max(0, 1 - u * u))
      else drop = u < 0.6 ? u * 0.22 : 0.132 + Math.pow((u - 0.6) / 0.4, 0.8) * 0.868
      const y = summit + drop * reach
      // Rounded, and not merely wrapped. `half` is fractional, so `dx` is too,
      // and a fractional index into a typed array reads `undefined`, compares
      // false against everything and writes nowhere — which silently threw away
      // every landform in the range and left four bands of gentle noise.
      const i = (((Math.round(f.x + dx) % w) + w) % w)
      if (y < tops[i]) tops[i] = y
    }
  }

  // ── what stands on it ──
  const cast = AGE_CAST[Math.max(0, Math.min(AGE_CAST.length - 1, age))][d]
  const spots = scatter(age * 131 + d * 29 + 3, w, CAST_COUNT[d], cast, CAST_MIN[d], CAST_MAX[d])
  const sized = spots.map(spot => {
    let size = spot.size * (SIZE_SCALE[spot.kind] ?? 1)
    if (ORGANIC.has(spot.kind)) size *= d <= 1 ? 0.34 : 0.62
    return { spot, size: Math.max(3, Math.round(size)) }
  })

  const footHalf = (kind: string, size: number): number =>
    Math.max(2, Math.round(size * (FOOTPRINT[kind] ?? 0.5)))

  /**
   * Cuts a level footing under a building, and only under a building. Levelling
   * a wide span for every prop turns a ridgeline into a row of mesas with
   * vertical sides; the cut is narrow and its edges ease back into the profile.
   */
  const plinth = (cx: number, half: number): void => {
    const taperW = Math.max(3, Math.round(half * 0.9))
    let deepest = 0
    for (let x = cx - half; x <= cx + half; x += 1) {
      const i = (((x | 0) % w) + w) % w
      if (tops[i] > deepest) deepest = tops[i]
    }
    for (let x = cx - half - taperW; x <= cx + half + taperW; x += 1) {
      const i = (((x | 0) % w) + w) % w
      if (tops[i] >= deepest) continue
      const out = Math.max(0, Math.abs(x - cx) - half) / taperW
      const ease = 1 - out * out * (3 - 2 * out)
      tops[i] = tops[i] + (deepest - tops[i]) * ease
    }
  }
  for (const { spot, size } of sized) {
    if (BUILT.has(spot.kind)) plinth(spot.x, footHalf(spot.kind, size))
  }

  const topsI = new Int32Array(w)
  for (let x = 0; x < w; x += 1) topsI[x] = Math.max(0, Math.round(tops[x]))

  // ── which faces turn into the light ──
  const R = [17, 14, 11, 9][d]
  const sm = new Float64Array(w)
  for (let x = 0; x < w; x += 1) {
    let sum = 0
    for (let k = -R; k <= R; k += 1) sum += topsI[(((x + k) % w) + w) % w]
    sm[x] = sum / (R * 2 + 1)
  }
  const face = new Int8Array(w)
  const litDepth = new Float64Array(w)
  const thresh = R * 0.4
  const cap = BAND_VISIBLE[d] * 0.62
  for (let x = 0; x < w; x += 1) {
    const slope = sm[(x + R) % w] - sm[(((x - R) % w) + w) % w]
    face[x] = slope > thresh ? 1 : slope < -thresh ? -1 : 0
    litDepth[x] = Math.min(cap, Math.abs(slope) * 1.1)
  }
  const runOf = new Int32Array(w)
  for (let i = 0; i < w; ) {
    let j = i
    while (j < w && face[j] === face[i]) j += 1
    for (let k = i; k < j; k += 1) runOf[k] = j - i
    i = j
  }

  // ── the body ──
  // The value steps down into the band's own base, measured from the *foot of
  // the crest window* rather than from each column's summit. Measuring it from
  // the summit paints a dark belt across every mountain at its own height,
  // which reads as a stain on the rock; measuring it from the base is what a
  // valley filling with shadow actually looks like.
  const D1 = lo + (h - lo) * 0.24
  const D2 = lo + (h - lo) * 0.62
  const wob = wrapNoise(age * 61 + d * 7 + 3, w, 7, 2, 0.5)
  const wob2 = wrapNoise(age * 67 + d * 11 + 5, w, 5, 2, 0.5)
  const runMin = [22, 18, 14, 11][d]
  for (let x = 0; x < w; x += 1) {
    const top = topsI[x]
    if (top >= h) continue
    // Not clamped away from the crest. Pushing the step down to `top + n` on a
    // tall summit makes the shadow hug the silhouette, and a shadow that
    // follows an outline is an outline.
    const d1 = D1 + (wob(x) - 0.5) * span * 0.5
    const d2 = D2 + (wob2(x) - 0.5) * span * 0.5
    const ld = litDepth[x]
    const strong = runOf[x] >= runMin
    for (let y = top; y < h; y += 1) {
      const dy = y - top
      let c = r[2]
      if (strong && dy < ld) c = face[x] > 0 ? r[3] : face[x] < 0 ? r[1] : r[2]
      const t1 = (y - d1) / 6
      if (t1 > 0 && (t1 >= 1 || ditherAt(x, y, t1))) c = r[1]
      const t2 = (y - d2) / 7
      if (t2 > 0 && (t2 >= 1 || ditherAt(x, y, t2))) c = r[0]
      p.set(x, y, c)
    }
    // A lit crest, only where a broad face is genuinely turned into the light.
    if (strong && face[x] > 0 && ld > 5) {
      p.set(x, top, r[4])
      p.set(x, top + 1, r[3])
    }
  }

  // ── the feet ──
  //
  // The contact shadow that seats this range on the ground plane. It is dithered
  // in from above so it never draws a rule across the picture, and its lowest
  // rows sit under the floor's own leading edge.
  const foot = h - A(ENV_BAND_FOOT)
  const shadowH = [24, 19, 15, 11][d]
  for (let x = 0; x < w; x += 1) {
    const top = topsI[x]
    for (let y = Math.max(top, foot - shadowH); y < h; y += 1) {
      const tt = (y - (foot - shadowH)) / shadowH
      if (tt >= 0.62 || ditherAt(x, y, tt * 1.5)) p.set(x, y, r[0])
    }
  }

  // ── snow, where the age is cold enough for it ──
  if ((age === 1 || age === 4) && d <= 1) {
    const snowC = mix(r[4], key, 0.34)
    const snowShade = mix(r[3], t.sky[1], 0.34)
    const line = wrapNoise(age * 77 + d * 5 + 1, w, 9, 3, 0.5)
    const snowLine = hi + span * 0.3
    for (let x = 0; x < w; x += 1) {
      const top = topsI[x]
      if (top >= snowLine) continue
      const bottom = Math.round(snowLine + (line(x) - 0.5) * span * 0.34)
      for (let y = top; y < bottom; y += 1) p.set(x, y, face[x] >= 0 ? snowC : snowShade)
    }
  }

  // ── landmarks ──
  const seat = (cx: number, half: number): number => {
    let deepest = 0
    for (let x = cx - half; x <= cx + half; x += 1) {
      const i = (((x | 0) % w) + w) % w
      if (topsI[i] > deepest) deepest = topsI[i]
    }
    return deepest
  }
  // What stands on a range is darker than the range itself, and the further
  // away it is the darker it goes. A distant building lit to the same value as
  // the hill under it has no silhouette at all — which is how the first pass
  // put a pale grey city on a pale grey crag and lost both.
  const sink = [0.62, 0.46, 0.3, 0.16][d]
  const tones: LandTones = {
    body: mix(r[2], r[0], sink),
    lit: mix(r[3], r[1], sink),
    dark: mix(r[1], r[0], 0.55),
    deep: r[0],
    key: mix(key, r[4], 0.15),
    pale: mix(r[4], r[2], sink)
  }
  for (const { spot, size } of sized) {
    drawLandmark(p, w, spot, size, seat(spot.x, footHalf(spot.kind, size)) + 1, tones, d, anchors)
  }

  // Camp fires on the middle range of the ages that have no electricity to
  // blink. Something has to be alive out there in every age.
  if (d === 2 && age <= 2) {
    const fires = scatter(age * 307 + 19, w, 3, ['fire'], 6, 10)
    for (const fire of fires) {
      const fy = topsI[fire.x % w] - 1
      p.set(fire.x, fy, tones.key)
      p.set(fire.x - 1, fy + 1, mix(tones.key, r[1], 0.5))
      p.set(fire.x + 1, fy + 1, mix(tones.key, r[1], 0.5))
      anchors.push({ kind: 'light', x: fire.x, y: fy, scale: 1.5, phase: fire.seed / 9999 })
    }
  }

  // Growth along the two near crests: what makes a hill read as a place.
  if (d >= 2) {
    const scrub = scatter(
      age * 211 + d * 41,
      w,
      d === 2 ? 18 : 26,
      AGE_SCRUB[Math.max(0, Math.min(AGE_SCRUB.length - 1, age))],
      d === 2 ? 4 : 6,
      d === 2 ? 8 : 13
    )
    const throwaway: EnvAnchor[] = []
    for (const spot of scrub) {
      drawLandmark(p, w, spot, spot.size, seat(spot.x, footHalf(spot.kind, spot.size)) + 1, tones, d, throwaway)
    }
  }

  return { pix: p, anchors }
}

/**
 * The ground haze: a thin ribbon of air lying along the horizon, and nothing
 * more.
 *
 * The class draws this at sixty percent alpha with its *bottom* on the ground
 * line, so everything here is authored to be dense in its last few rows and
 * gone well before its top. A fog layer that fills its own strip is a veil over
 * the picture; a fog layer that pools at the feet of the hills is weather.
 */
export function envFogPix(age: number, worldW: number, worldH: number): Pix {
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  // Tied to the range it lies in front of rather than to the raw theme colour:
  // this is the air those hills are already being seen through, so it lifts
  // them a little and never turns into a sheet of light along the ground line.
  const near = envBandBase(age, ENV_BAND_HEIGHTS.length - 1)
  const air = mix(near, skyHorizon(age), 0.42)
  const wisp = wrapNoise(age * 71 + 13, w, 22, 3, 0.55)
  const roll = wrapNoise(age * 29 + 3, w, 5, 3, 0.5)

  for (let y = 0; y < h; y += 1) {
    const tt = h > 1 ? y / (h - 1) : 1
    // Nothing at all above the ribbon, then a fast climb into the ground line.
    const density = Math.pow(Math.max(0, tt - 0.46) / 0.54, 1.8) * 0.6
    if (density <= 0.004) continue
    for (let x = 0; x < w; x += 1) {
      const local = density * (0.6 + wisp(x + y * 5.1) * 0.85) * (0.7 + roll(x) * 0.6)
      if (ditherAt(x, y, local)) p.set(x, y, air)
    }
  }
  // Two flat wisps lying across it, which is what stops a haze band from
  // reading as a printed gradient.
  const n = pixelNoise(age * 17 + 5)
  for (let i = 0; i < 2; i += 1) {
    const cy = Math.round(h * (0.7 + i * 0.11))
    const thick = 1 + Math.round(n(i, 1) * 2)
    const streak = wrapNoise(age * 43 + i * 7, w, 12, 2, 0.5)
    for (let x = 0; x < w; x += 1) {
      const v = streak(x)
      if (v < 0.46) continue
      for (let k = 0; k < thick; k += 1) if (ditherAt(x, cy + k, (v - 0.46) * 2.2)) p.set(x, cy + k, air)
    }
  }
  return p
}

// ──────────────────────────── The floor ────────────────────────────

/**
 * The battlefield floor.
 *
 * A floor has to lie down. The single cue that does that is compression: marks
 * near the horizon are thin and close together, marks near the camera are thick
 * and far apart, and everything runs *across* the picture. So the ruts, the
 * puddles and the grit are all placed on a perspective curve rather than spread
 * evenly, and the bottom third gets its own coarser treatment as the near band.
 */
/**
 * The battlefield floor, drawn the way Age of Empires draws its ground.
 *
 * One world-locked plane, not a stack of screen-space layers. It pans 1:1 with
 * the camera like everything standing on it, so nothing on the floor can ever
 * slide against the soldiers' feet; all the perspective is baked into the art
 * as recession — detail that is fine and dense at the horizon and opens out
 * toward the camera. A worn battle path runs along the line the armies
 * actually fight on, and the open field shows behind and in front of it.
 *
 * `above` is the height between the horizon and the feet line, `below` the
 * apron between the feet line and the bottom of the screen.
 */
export function envFloorPix(age: number, worldW: number, above: number, below: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const hA = A(above)
  const h = hA + A(below)
  const p = new Pix(w, h)
  const base = envGroundBase(age)
  const soil = ramp(base, { contrast: 0.72 })
  const deep = ramp(tone(base, -0.3), { contrast: 0.7 })
  const grass = ramp(t.groundAccent, { contrast: 0.75 })
  const dirt = ramp(tone(mix(base, t.groundAccent, 0.45), 0.14), { contrast: 0.62 })
  const noise = pixelNoise(age * 131 + 7)
  const wet = t.weather === 'rain' || t.weather === 'snow'

  // Deterministic scatter. Baked art, but the house rule holds everywhere.
  let seed = (age * 7919 + 13) >>> 0
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }

  /** How large a mark drawn on this row should be, by foreshortening. */
  const rowScale = (y: number): number => 0.4 + 1.5 * Math.pow(y / h, 1.15)

  // Three worn paths, one per lane, straddling each lane's feet line. The
  // lanes are the game now, so the board draws its own files: a commander
  // reads where a piece will walk the same way a chess player reads a rank.
  const PATH_HALF = 9
  const centres = LANE_Y.map(off => hA + off + 7)
  const pathAt = (x: number, y: number): number => {
    let best = 0
    for (const c of centres) {
      const edge = 4 + noise(x >> 2, 991 + c) * 3
      const d = Math.abs(y - c)
      if (d <= PATH_HALF) return 1
      if (d <= PATH_HALF + edge) best = Math.max(best, 1 - (d - PATH_HALF) / edge)
    }
    return best
  }
  const PATH_TOP = centres[0] - PATH_HALF
  const PATH_BOT = centres[centres.length - 1] + PATH_HALF

  // Base field. Recession lives in the mottle frequency: far rows sample the
  // noise coarsely-in-x so the texture compresses toward the horizon exactly
  // as a receding plane's does. The dither budget is deliberately small — the
  // haze complaint was earned, and solid tone with sparse mottle reads
  // cleaner than an even film of checkerboard.
  for (let y = 0; y < h; y += 1) {
    const rs = rowScale(y)
    const seat = Math.max(0, 1 - y / (hA * 0.35))
    for (let x = 0; x < w; x += 1) {
      const m = noise(Math.floor(x / (0.8 + rs * 1.6)), y)
      let c = m < 0.24 ? soil[1] : m > 0.76 ? soil[3] : soil[2]
      if (seat > 0 && ditherAt(x, y, seat * 0.85)) c = deep[2]
      const path = pathAt(x, y)
      if (path > 0 && (path >= 1 || ditherAt(x, y, path))) {
        c = m < 0.22 ? dirt[1] : m > 0.86 ? dirt[3] : dirt[2]
      }
      p.set(x, y, c)
    }
  }

  // Growth, out in the field but not on the road everyone marches down.
  const PATCHES = Math.round(w * 0.45)
  for (let i = 0; i < PATCHES; i += 1) {
    const y = Math.round(Math.pow(rnd(), 0.8) * (h - 3)) + 1
    const x = Math.round(rnd() * w)
    if (pathAt(x, y) > 0.4) continue
    const rs = rowScale(y)
    const rx = Math.max(1, Math.round((2 + rnd() * 6) * rs))
    const ry = Math.max(1, Math.round(rx * 0.38))
    const dark = rnd() < 0.4
    for (let yy = y - ry; yy <= y + ry; yy += 1) {
      for (let xx = x - rx; xx <= x + rx; xx += 1) {
        const dx = (xx - x) / rx
        const dy = (yy - y) / ry
        if (dx * dx + dy * dy > 1) continue
        if (ditherAt(xx, yy, 0.75 - (dx * dx + dy * dy) * 0.4)) {
          p.set(xx, yy, dark ? grass[1] : grass[2])
        }
      }
    }
    // A few blades standing off the top edge, taller as the patch comes near.
    const blades = 1 + Math.round(rs)
    for (let b = 0; b < blades; b += 1) {
      const bx = x + Math.round((rnd() - 0.5) * rx * 1.4)
      const tall = Math.max(1, Math.round(rs * (1 + rnd())))
      for (let k = 1; k <= tall; k += 1) p.set(bx, y - ry - k, grass[3])
    }
  }

  // Stones, and by the later ages wreckage, sharing the same scatter.
  const STONES = Math.round(w * 0.05)
  for (let i = 0; i < STONES; i += 1) {
    const y = Math.round(Math.pow(rnd(), 0.75) * (h - 4)) + 2
    const x = Math.round(rnd() * w)
    const rs = rowScale(y)
    const r = Math.max(1, Math.round((1 + rnd() * 2) * rs))
    const c = age >= 3 && rnd() < 0.3 ? ramp(t.metal, { contrast: 0.6 }) : deep
    const ry = Math.max(1, Math.round(r * 0.6))
    p.ellipse(x, y, r, ry, c[2])
    p.set(x, y - ry, c[3])
    for (let k = -r; k <= r; k += 1) if (ditherAt(x + k, y + 1, 0.5)) p.set(x + k, y + ry, deep[0])
  }

  // Each road worn by use: a rut along it, and the litter of armies.
  for (let lane = 0; lane < centres.length; lane += 1) {
    const cy = centres[lane]
    for (let x = 0; x < w; x += 1) {
      const y = cy + Math.round(Math.sin(x / (40 + lane * 13) + lane * 2.1) * 2 + noise(x >> 3, lane + 300) * 2)
      if (noise(x >> 1, lane + 310) < 0.3) continue
      p.set(x, y, dirt[0])
      if (noise(x, lane + 320) > 0.8) p.set(x, y - 1, dirt[4])
    }
    const LITTER = Math.round(w * 0.012)
    for (let i = 0; i < LITTER; i += 1) {
      const x = Math.round(rnd() * w)
      const y = cy - PATH_HALF + 3 + Math.round(rnd() * (PATH_HALF * 2 - 6))
      p.set(x, y, rnd() < 0.5 ? deep[0] : soil[4])
    }
  }
  void PATH_TOP
  void PATH_BOT

  // Water where the weather makes it, cracks where it does not — field only.
  if (wet) {
    const skyC = mix(t.sky[2], t.sky[1], 0.4)
    for (let i = 0; i < 14; i += 1) {
      const y = Math.round(Math.pow(rnd(), 0.7) * (h - 8)) + 4
      const x = Math.round(rnd() * w)
      if (pathAt(x, y) > 0.3) continue
      const rs = rowScale(y)
      const rx = Math.max(2, Math.round((3 + rnd() * 9) * rs))
      const ry = Math.max(1, Math.round(rx * 0.3))
      p.ellipse(x, y, rx, ry, deep[0])
      for (let yy = y - ry; yy <= y + ry; yy += 1) {
        for (let xx = x - rx; xx <= x + rx; xx += 1) {
          const dx = (xx - x) / rx
          const dy = (yy - y) / ry
          if (dx * dx + dy * dy > 0.86) continue
          if (ditherAt(xx, yy, 0.35 + ((y - yy) / ry) * 0.8)) p.set(xx, yy, mix(skyC, deep[0], 0.25))
        }
      }
    }
  } else {
    for (let i = 0; i < 10; i += 1) {
      let x = Math.round(rnd() * w)
      let y = Math.round(Math.pow(rnd(), 0.7) * (h - 10)) + 5
      if (pathAt(x, y) > 0.3) continue
      const steps = 8 + Math.round(rnd() * 14)
      for (let k = 0; k < steps; k += 1) {
        const rs = rowScale(y)
        p.set(x, y, deep[0])
        if (rs > 1.1) p.set(x + 1, y, deep[1])
        x += Math.round((rnd() - 0.5) * 4)
        y += rnd() < 0.6 ? 1 : 0
        if (y >= h - 2) break
      }
    }
  }

  // Seat the ranges: a two-pixel contact line at the horizon, and a little
  // weight at the bottom edge so the plane does not just stop.
  for (let x = 0; x < w; x += 1) {
    p.set(x, 0, deep[1])
    p.set(x, 1, deep[1])
    for (let k = 0; k < 5; k += 1) if (ditherAt(x, h - 1 - k, 0.6 - k * 0.12)) p.set(x, h - 1 - k, deep[1])
  }

  return p
}

export function envGroundPix(age: number, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const base = envGroundBase(age)
  const soil = ramp(base, { contrast: 0.95 })
  const deep = ramp(tone(base, -0.32), { contrast: 0.9 })
  const accent = ramp(t.groundAccent)
  const noise = pixelNoise(age * 131 + 7)
  const surface = wrapNoise(age * 19 + 3, w, 8, 3)
  const wet = t.weather === 'rain' || t.weather === 'snow'

  // Recession: steep near the horizon, slow near the camera. An even ramp reads
  // as a vertical wall of dither; the compression *is* the depth cue.
  for (let y = 0; y < h; y += 1) {
    const tt = Math.pow(Math.min(1, y / (h * 0.66)), 0.55)
    for (let x = 0; x < w; x += 1) {
      p.set(x, y, ditherAt(x, y, tt) ? deep[2] : soil[2])
    }
  }

  /**
   * Rows are far at the top and near at the bottom; scale marks accordingly.
   *
   * The curve is gentle rather than steep. Only the top few rows of this
   * texture and everything below the near bank are ever on screen, so piling
   * every mark into the horizon puts the whole floor's detail exactly where the
   * camera cannot see it.
   */
  const spread = (i: number, count: number): number => Math.round(h * Math.pow((i + 0.5) / count, 1.25))

  // Wheel ruts and drag marks, thickening as they come toward the camera.
  const RUTS = 11
  for (let i = 0; i < RUTS; i += 1) {
    const y = spread(i, RUTS)
    if (y >= h - 2) break
    const thick = 1 + Math.floor(y / (h * 0.45))
    const len = Math.round(w * (0.05 + noise(i, 41) * 0.26))
    const x0 = Math.round(noise(i, 42) * (w - len))
    for (let x = x0; x < x0 + len; x += 1) {
      if (noise(x >> 1, i + 60) < 0.58) continue
      for (let k = 0; k < thick; k += 1) p.set(x, y + k, deep[0])
      if (noise(x, i + 70) > 0.76) p.set(x, y - 1, soil[3])
    }
  }

  // Standing water where the weather makes it, dry cracks where it does not.
  if (wet) {
    const skyC = mix(t.sky[2], t.sky[1], 0.4)
    for (let i = 0; i < 16; i += 1) {
      const py = spread(i % 11, 11) + Math.round(noise(i, 81) * 6)
      if (py < 4 || py > h - 4) continue
      const scale = 0.35 + py / h
      const rx = Math.max(2, Math.round((3 + noise(i, 82) * 12) * scale))
      const ry = Math.max(1, Math.round(rx * 0.28))
      const px = Math.round(noise(i, 83) * w)
      p.ellipse(px, py, rx, ry, deep[0])
      // The sky reflected in it, dithered, brightest along the far edge — and
      // no drawn rim, because a ring around a puddle reads as a rope on the
      // ground rather than as water in a hollow.
      for (let y = py - ry; y <= py + ry; y += 1) {
        for (let x = px - rx; x <= px + rx; x += 1) {
          const dx = (x - px) / rx
          const dy = (y - py) / ry
          if (dx * dx + dy * dy > 0.9) continue
          const up = (py - y) / ry
          if (ditherAt(x, y, 0.3 + up * 0.85)) p.set(x, y, mix(skyC, deep[0], 0.2))
        }
      }
      for (let x = px - rx; x <= px + rx; x += 1) {
        const dx = (x - px) / rx
        if (Math.abs(dx) > 0.92) continue
        const y = Math.round(py - ry * Math.sqrt(1 - dx * dx))
        if (ditherAt(x, y, 0.7)) p.set(x, y, soil[3])
      }
    }
  } else {
    const crack = pixelNoise(age * 97 + 31)
    for (let i = 0; i < 22; i += 1) {
      let cx = crack(i, 1) * w
      let cy = spread(i % 11, 11) + crack(i, 2) * 5
      if (cy < 3 || cy > h - 3) continue
      let a = (crack(i, 3) - 0.5) * 1.1
      const len = 6 + crack(i, 4) * (10 + (cy / h) * 26)
      for (let k = 0; k < len; k += 1) {
        a += (crack(Math.round(cx), k) - 0.5) * 0.5
        cx += Math.cos(a) * 1.4
        cy += Math.sin(a) * 0.35
        p.set(Math.round(cx), Math.round(cy), deep[0])
        if (crack(Math.round(cx), k + 9) > 0.8) p.set(Math.round(cx), Math.round(cy) - 1, soil[3])
      }
    }
  }

  // Shell craters, only close enough to the camera to have a rim worth drawing.
  for (let i = 0; i < 3; i += 1) {
    const cy = Math.round(h * (0.5 + noise(i, 91) * 0.36))
    const cx = Math.round(noise(i, 92) * w)
    const rx = Math.round(7 + noise(i, 93) * 12)
    const ry = Math.max(2, Math.round(rx * 0.34))
    p.ellipse(cx, cy, rx, ry, deep[0])
    p.ellipse(cx + rx * 0.1, cy - ry * 0.2, rx * 0.7, ry * 0.6, deep[1])
    // A lip along the far edge only, and a shadow along the near one. Ringing
    // the whole crater lays a bright loop of rope on the ground.
    for (let a = 0; a < Math.PI * 2; a += 0.06) {
      const x = Math.round(cx + Math.cos(a) * rx)
      const y = Math.round(cy + Math.sin(a) * ry)
      const up = Math.sin(a) < -0.25
      if (!ditherAt(x, y, up ? 0.62 : 0.5)) continue
      p.set(x, y, up ? accent[2] : deep[0])
    }
  }

  // The lit crust the soldiers actually stand on, with a hard shadow directly
  // beneath it. Broken up along its length: an unbroken bright line across the
  // full width of the screen reads as a drawn rule, not as a lit edge.
  for (let x = 0; x < w; x += 1) {
    const top = Math.round(surface(x) * 4)
    for (let y = 0; y < top; y += 1) p.set(x, y, deep[0])
    const n = noise(x, 51)
    p.set(x, top, n > 0.82 ? accent[4] : n > 0.3 ? accent[3] : accent[2])
    p.set(x, top + 1, ditherAt(x, top + 1, 0.7) ? accent[2] : soil[3])
    p.fill(x, top + 2, 1, 2, soil[2])
    p.set(x, top + 4, deep[0])
  }

  // The near band: coarser, darker, and separated by a wandering edge rather
  // than a straight one.
  const edge = wrapNoise(age * 61 + 11, w, 5, 3)
  for (let x = 0; x < w; x += 1) {
    const y0 = Math.round(h * (0.6 + edge(x) * 0.1))
    for (let y = y0; y < h; y += 1) {
      const tt = Math.min(1, (y - y0) / Math.max(1, h - y0))
      if (ditherAt(x, y, 0.2 + tt * 0.55)) p.set(x, y, tt > 0.5 ? deep[0] : deep[1])
    }
  }

  // Grit and bedded stones, both growing with proximity.
  for (let y = 6; y < h; y += 1) {
    const near = y / h
    for (let x = 0; x < w; x += 1) {
      const n = noise(x, y)
      if (n > 0.9955 - near * 0.004) p.set(x, y, accent[1])
      else if (n < 0.02 + near * 0.02) p.set(x, y, deep[0])
    }
  }
  for (let i = 0; i < w / 22; i += 1) {
    const ry = Math.round(4 + noise(i, 95) * (h - 8))
    const rx = Math.round(noise(i, 96) * w)
    const rr = 1 + Math.round(noise(i, 97) * 1.6 * (0.5 + ry / h))
    p.ellipse(rx, ry, rr, Math.max(1, rr * 0.7), deep[0])
    p.set(rx + Math.round(rr * 0.4), ry - Math.round(rr * 0.6), soil[3])
  }
  return p
}

// ──────────────────────────── Live details ────────────────────────────

/** How many frames a smoke column cycles through. */
export const ENV_SMOKE_FRAMES = 4

/**
 * One frame of a rising smoke column.
 *
 * The noise is shifted by exactly a quarter of a cell each frame, so four
 * frames return to the start and the column rises forever without a jump. The
 * envelope — how wide and how thin it is at each height — stays put, so what
 * the eye sees is smoke moving through a plume rather than a plume moving.
 */
export function envSmokePix(frame: number): Pix {
  const w = 54
  const h = 118
  const p = new Pix(w, h)
  const field = smoothNoise2(9001)
  const detail = smoothNoise2(9007)
  for (let y = 0; y < h; y += 1) {
    const up = 1 - y / h
    // Widens and thins as it climbs, and leans downwind. Dense at the source
    // and all but gone at the top: a column of even density is a chimney pot
    // standing in the sky, which is what this looked like on the first pass.
    const width = w * (0.07 + Math.pow(up, 0.8) * 0.44)
    const lean = Math.pow(up, 1.4) * w * 0.3
    const cx = w * 0.26 + lean
    const fade = Math.pow(1 - up, 0.85) * 0.9
    for (let x = 0; x < w; x += 1) {
      const dx = Math.abs(x - cx) / Math.max(1, width)
      if (dx > 1.25) continue
      const n = field(x * 0.07, y * 0.07 + frame * 0.25) * 0.65 + detail(x * 0.15, y * 0.15 + frame * 0.6) * 0.35
      const density = (1 - dx * dx) * fade * (0.35 + n * 1.25)
      if (density <= 0.02) continue
      if (!ditherAt(x, y, density)) continue
      // Lit on the right, where the key light is.
      p.set(x, y, density > 0.62 ? 0xffffff : x - cx > -width * 0.1 ? 0xd8d8d8 : 0x9a9a9a)
    }
  }
  return p
}

/** A searchlight wedge, authored pointing straight up, pivoting at its foot. */
export function envBeamPix(): Pix {
  const w = 46
  const h = 150
  const p = new Pix(w, h)
  const apexX = w / 2
  for (let y = 0; y < h; y += 1) {
    const up = 1 - y / h
    const half = 1.5 + up * (w * 0.46)
    const reach = 1 - up * 0.9
    for (let x = Math.round(apexX - half); x <= Math.round(apexX + half); x += 1) {
      const across = 1 - Math.abs(x - apexX) / Math.max(1, half)
      const density = reach * Math.pow(across, 0.7) * 0.85
      if (ditherAt(x, y, density)) p.set(x, y, density > 0.55 ? 0xffffff : 0xbfd4ff)
    }
  }
  return p
}

/** A beacon: a hard core with a dithered halo, so it reads as a light. */
export function envDotPix(): Pix {
  const s = 13
  const p = new Pix(s, s)
  const c = (s - 1) / 2
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const d = Math.hypot(x - c, y - c) / c
      if (d < 0.24) p.set(x, y, 0xffffff)
      else if (d <= 1 && ditherAt(x, y, (1 - d) * (1 - d) * 1.7)) p.set(x, y, 0xdfe8ff)
    }
  }
  return p
}

/** Corner darkening, banded rather than smooth. */
export function envVignettePix(worldW: number, worldH: number): Pix {
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const cx = w / 2
  const cy = h / 2
  const maxD = Math.hypot(cx, cy)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.hypot(x - cx, y - cy) / maxD
      const strength = Math.max(0, (d - 0.54) / 0.46)
      if (strength <= 0) continue
      const scaled = strength * 3.4
      const level = Math.min(3, Math.floor(scaled) + (ditherAt(x, y, scaled % 1) ? 1 : 0))
      if (level > 0) p.set(x, y, 0x000000, level * 50)
    }
  }
  return p
}

/** The four weather sprites, drawn once and tinted per age. */
export function envParticlePix(kind: 'mote' | 'drop' | 'flake' | 'speck'): Pix {
  switch (kind) {
    case 'drop': {
      const p = new Pix(2, 12)
      p.fill(0, 0, 1, 12, 0xffffff)
      p.fill(1, 3, 1, 9, 0xdfe8ff)
      return p
    }
    case 'flake': {
      const p = new Pix(3, 3)
      p.set(1, 0, 0xffffff)
      p.set(0, 1, 0xffffff)
      p.set(1, 1, 0xffffff)
      p.set(2, 1, 0xffffff)
      p.set(1, 2, 0xffffff)
      return p
    }
    case 'speck': {
      const p = new Pix(2, 2)
      p.fill(0, 0, 2, 2, 0xffffff)
      return p
    }
    default: {
      const p = new Pix(16, 16)
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          const d = Math.hypot(x - 7.5, y - 7.5) / 7.5
          if (d > 1) continue
          const strength = (1 - d) * (1 - d)
          if (strength > 0.5 || ditherAt(x, y, strength * 1.8)) p.set(x, y, 0xffffff)
        }
      }
      return p
    }
  }
}

// ──────────────────────────── The live scene ────────────────────────────

const anchorCache = new Map<string, EnvAnchor[]>()

interface SmokeColumn {
  image: Phaser.GameObjects.Image
  band: number
  x: number
  drift: number
}

interface Beacon {
  image: Phaser.GameObjects.Image
  band: number
  x: number
  phase: number
  rate: number
}

/**
 * Layered parallax world: sky, two cloud banks, four ranges of terrain, the
 * haze that seats them, the battlefield floor and the bank in front of it, plus
 * whatever moves in the distance. Re-themable at runtime, so evolving an age
 * visibly changes the world.
 */
export default class Environment {
  private scene: Phaser.Scene
  private worldWidth: number
  private groundY: number
  private viewW: number
  private viewH: number

  private sky!: Phaser.GameObjects.Image
  private celestial!: Phaser.GameObjects.Image
  private cirrus!: Phaser.GameObjects.TileSprite
  private cumulus!: Phaser.GameObjects.TileSprite
  private bands: Phaser.GameObjects.TileSprite[] = []
  private fog!: Phaser.GameObjects.TileSprite
  private floorImg!: Phaser.GameObjects.Image
  private vignette!: Phaser.GameObjects.Image

  private smoke: SmokeColumn[] = []
  private beacons: Beacon[] = []
  private beam?: Phaser.GameObjects.Image
  private beamBand = 1
  private beamX = 0

  private motes?: Phaser.GameObjects.Particles.ParticleEmitter
  private weatherNear?: Phaser.GameObjects.Particles.ParticleEmitter
  private weatherFar?: Phaser.GameObjects.Particles.ParticleEmitter

  private age = -1
  private time = 0
  private scrollX = 0
  private destroyed = false

  constructor(scene: Phaser.Scene, worldWidth: number, groundY: number) {
    this.scene = scene
    this.worldWidth = worldWidth
    this.groundY = groundY
    this.viewW = scene.cameras.main.width
    this.viewH = scene.cameras.main.height
    this.buildShared()
    this.build()
  }

  // ── textures ──

  private add(key: string, make: () => Pix, scale = 1): void {
    if (this.scene.textures.exists(key)) return
    const pix = make()
    const c: PixelCanvas = scale === 1 ? pix.toCanvas() : pix.toCanvasScaled(scale)
    this.scene.textures.addCanvas(key, c.canvas)
  }

  /** Age-independent art: particles, smoke frames, the beam, the vignette. */
  private buildShared(): void {
    // Every layer is created against this and re-pointed by setAge. Building
    // the sprites against a real age instead would generate a whole age's worth
    // of art that the caller is about to replace on the very next line.
    this.add('env:blank', () => new Pix(2, 2))
    for (let i = 0; i < ENV_SMOKE_FRAMES; i += 1) {
      this.add(`env:smoke:${i}`, () => envSmokePix(i))
    }
    this.add('env:beam', () => envBeamPix())
    this.add('env:dot', () => envDotPix())
    this.add('env:mote', () => envParticlePix('mote'), 2)
    this.add('env:drop', () => envParticlePix('drop'), 2)
    this.add('env:flake', () => envParticlePix('flake'), 2)
    this.add('env:speck', () => envParticlePix('speck'), 2)
    this.add('env:vignette', () => envVignettePix(this.viewW, this.viewH))
  }

  /** Everything that belongs to one age. Generated once, then cached forever. */
  private ensureAge(age: number): void {
    this.add(`env:sky:${age}`, () => envSkyPix(age, this.viewW, this.viewH))
    this.add(`env:sun:${age}`, () => envCelestialPix(age))
    this.add(`env:cirrus:${age}`, () => envCloudPix(age, 0, ENV_LAYER_WIDTH, ENV_CIRRUS_HEIGHT))
    this.add(`env:cumulus:${age}`, () => envCloudPix(age, 1, ENV_LAYER_WIDTH, ENV_CUMULUS_HEIGHT))
    for (let d = 0; d < ENV_BAND_HEIGHTS.length; d += 1) {
      const key = `env:band:${age}:${d}`
      const cacheKey = `${age}:${d}`
      if (!this.scene.textures.exists(key) || !anchorCache.has(cacheKey)) {
        const art = envBandArt(age, d, ENV_LAYER_WIDTH, ENV_BAND_HEIGHTS[d])
        anchorCache.set(cacheKey, art.anchors)
        if (!this.scene.textures.exists(key)) {
          this.scene.textures.addCanvas(key, art.pix.toCanvas().canvas)
        }
      }
    }
    this.add(`env:fog:${age}`, () => envFogPix(age, ENV_LAYER_WIDTH, ENV_FOG_HEIGHT))
    this.add(`env:floor:${age}`, () => envFloorPix(age, this.worldWidth, ENV_FLOOR_HORIZON, ENV_FLOOR_BELOW))
  }

  // ── construction ──

  private build(): void {
    const w = this.viewW
    const h = this.viewH

    this.sky = this.scene.add
      .image(0, 0, 'env:blank')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-1000)
      .setDisplaySize(w, h)

    // Registered exactly against the glow baked into the sky, so it must not
    // drift: no scroll factor of its own.
    this.celestial = this.scene.add
      .image(ENV_SUN_POS[0][0] * w, ENV_SUN_POS[0][1] * h, 'env:blank')
      .setScrollFactor(0)
      .setDepth(-997)
      .setScale(1 / ENV_RES)

    // Both cloud banks are TileSprites authored at exactly their own height and
    // wider than the viewport, so they can drift forever without a seam.
    this.cirrus = this.scene.add
      .tileSprite(0, ENV_CIRRUS_Y, w, ENV_CIRRUS_HEIGHT, 'env:blank')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-995)
    this.cirrus.setTileScale(1 / ENV_RES, 1 / ENV_RES)

    this.cumulus = this.scene.add
      .tileSprite(0, ENV_CUMULUS_Y, w, ENV_CUMULUS_HEIGHT, 'env:blank')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-993)
    this.cumulus.setTileScale(1 / ENV_RES, 1 / ENV_RES)

    // Every range reaches down to the ground line. Staggering their feet leaves
    // a horizontal seam wherever one ends and the next has not started.
    for (let d = 0; d < ENV_BAND_HEIGHTS.length; d += 1) {
      const band = this.scene.add
        .tileSprite(0, this.groundY - ENV_FLOOR_HORIZON + ENV_BAND_FOOT, w, ENV_BAND_HEIGHTS[d], 'env:blank')
        .setOrigin(0, 1)
        .setScrollFactor(0)
        .setDepth(-980 + d * 4)
      band.setTileScale(1 / ENV_RES, 1 / ENV_RES)
      this.bands.push(band)
    }

    // The floor is world geometry, not a screen-space layer. It pans 1:1 with
    // the camera — the Age of Empires camera — so nothing on it can ever slide
    // against the feet of the soldiers standing on it, and the drag stutter
    // that differential ground scroll produced is impossible by construction.
    // Parallax still exists, but only beyond the horizon.
    this.floorImg = this.scene.add
      .image(0, this.groundY - ENV_FLOOR_HORIZON, 'env:blank')
      .setOrigin(0, 0)
      .setDepth(-900)

    this.fog = this.scene.add
      .tileSprite(0, this.groundY - ENV_FLOOR_HORIZON + 4, w, ENV_FOG_HEIGHT, 'env:blank')
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(-899)
      .setAlpha(0.6)
    this.fog.setTileScale(1 / ENV_RES, 1 / ENV_RES)


    if (save.settings.particleQuality === 'high') {
      this.motes = this.scene.add
        .particles(0, 0, 'env:mote', {
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-40, h * 0.45, w + 80, h * 0.5),
            quantity: 1
          },
          lifespan: { min: 4000, max: 9000 },
          speedX: { min: -14, max: 10 },
          speedY: { min: -18, max: 6 },
          scale: { min: 0.1, max: 0.3 },
          alpha: { start: 0.3, end: 0, ease: 'Sine.easeInOut' },
          frequency: 190,
          quantity: 1,
          blendMode: Phaser.BlendModes.ADD
        })
        .setScrollFactor(0)
        .setDepth(770)
    }

    this.vignette = this.scene.add
      .image(w / 2, h / 2, 'env:vignette')
      .setScrollFactor(0)
      .setDepth(900)
      .setDisplaySize(w, h)
  }

  // ── theming ──

  setAge(age: number): void {
    if (this.destroyed) return
    const clamped = Math.max(0, Math.min(AGE_THEMES.length - 1, age))
    if (clamped === this.age) return
    this.age = clamped
    this.ensureAge(clamped)
    const t = AGE_THEMES[clamped]
    const w = this.viewW
    const h = this.viewH

    this.sky.setTexture(`env:sky:${clamped}`).setDisplaySize(w, h)
    this.celestial
      .setTexture(`env:sun:${clamped}`)
      .setPosition(ENV_SUN_POS[clamped][0] * w, ENV_SUN_POS[clamped][1] * h)
    this.cirrus.setTexture(`env:cirrus:${clamped}`)
    this.cumulus.setTexture(`env:cumulus:${clamped}`)
    this.bands.forEach((band, d) => band.setTexture(`env:band:${clamped}:${d}`))
    this.floorImg.setTexture(`env:floor:${clamped}`)
    this.fog.setTexture(`env:fog:${clamped}`)
    this.motes?.setParticleTint(mix(t.fog, 0xffffff, 0.25))

    this.buildDetails(clamped)
    this.applyWeather(clamped)
  }

  /**
   * Hangs the moving parts off the landmarks that were drawn into the ranges.
   *
   * The positions come back from the art itself, so a chimney always has its
   * own smoke on it and a mast always has its own lamp — nothing is placed by
   * hand, and nothing can drift out of register with the silhouette it belongs
   * to.
   */
  private buildDetails(age: number): void {
    this.clearDetails()
    const t = AGE_THEMES[age]
    const glow = mix(t.fog, keyLight(age), 0.55)
    const MAX_SMOKE = save.settings.particleQuality === 'low' ? 1 : 3
    const MAX_LIGHTS = save.settings.particleQuality === 'low' ? 4 : 12
    let smokeCount = 0
    let lightCount = 0
    let beamPlaced = false

    for (let d = 0; d < ENV_BAND_HEIGHTS.length; d += 1) {
      const anchors = anchorCache.get(`${age}:${d}`) ?? []
      // The foot of the band is at groundY + FOOT and the art is drawn upward
      // from there at twice its authored size.
      const bandTop = this.groundY - ENV_FLOOR_HORIZON + ENV_BAND_FOOT - ENV_BAND_HEIGHTS[d]
      const depth = -980 + d * 4 + 1
      for (const anchor of anchors) {
        const worldY = bandTop + anchor.y / ENV_RES
        if (anchor.kind === 'smoke' && smokeCount < MAX_SMOKE) {
          smokeCount += 1
          const image = this.scene.add
            .image(0, worldY, 'env:smoke:0')
            .setOrigin(0.34, 1)
            .setScrollFactor(0)
            .setDepth(depth)
            .setScale((anchor.scale * (0.55 + d * 0.14)) / ENV_RES)
            .setAlpha(0.3 + d * 0.05)
            // Sat close to the sky it hangs in, so a plume reads as smoke and
            // not as a searchlight standing on a chimney.
            .setTint(mix(t.sky[1], t.fog, 0.38))
          this.smoke.push({ image, band: d, x: anchor.x, drift: anchor.phase })
        } else if (anchor.kind === 'light' && lightCount < MAX_LIGHTS) {
          lightCount += 1
          const image = this.scene.add
            .image(0, worldY, 'env:dot')
            .setScrollFactor(0)
            .setDepth(depth)
            .setScale((anchor.scale * (0.5 + d * 0.22)) / ENV_RES)
            .setTint(glow)
            .setBlendMode(Phaser.BlendModes.ADD)
          this.beacons.push({
            image,
            band: d,
            x: anchor.x,
            phase: anchor.phase * Math.PI * 2,
            // Modern and future beacons blink; older lights are fires and
            // windows, which flicker instead.
            rate: age >= 3 ? 0.9 + anchor.phase * 0.5 : 2.6 + anchor.phase * 2.4
          })
        } else if (anchor.kind === 'beam' && !beamPlaced && age >= 3 && save.settings.particleQuality !== 'low') {
          beamPlaced = true
          this.beamBand = d
          this.beamX = anchor.x
          this.beam = this.scene.add
            .image(0, worldY, 'env:beam')
            .setOrigin(0.5, 1)
            .setScrollFactor(0)
            .setDepth(depth)
            .setScale(1 / ENV_RES)
            .setAlpha(0.3)
            .setTint(mix(glow, 0xffffff, 0.4))
            .setBlendMode(Phaser.BlendModes.ADD)
        }
      }
    }
  }

  private clearDetails(): void {
    this.smoke.forEach(s => s.image.destroy())
    this.smoke = []
    this.beacons.forEach(b => b.image.destroy())
    this.beacons = []
    this.beam?.destroy()
    this.beam = undefined
  }

  /**
   * Weather that belongs to the age, in two depths.
   *
   * A single sheet of particles in front of everything is what makes weather
   * look sprinkled on. There are two emitters: one behind the floor, small and
   * slow and dim, falling among the hills, and one in front of the camera,
   * large and fast. Both are tinted from the age's own light rather than from a
   * fixed white, so rain in a blue dusk is blue and ash under a red sun is red.
   */
  private applyWeather(age: number): void {
    this.weatherNear?.destroy()
    this.weatherFar?.destroy()
    this.weatherNear = undefined
    this.weatherFar = undefined
    if (save.settings.particleQuality === 'low') return

    const t = AGE_THEMES[age]
    const cam = this.scene.cameras.main
    const density = save.settings.particleQuality === 'high' ? 1 : 0.5
    const key = keyLight(age)
    const top = new Phaser.Geom.Rectangle(-60, -90, cam.width + 120, 40)
    const far = new Phaser.Geom.Rectangle(-60, -90, cam.width + 120, 30)

    switch (t.weather) {
      case 'rain': {
        const tint = mix(t.sky[2], 0xffffff, 0.45)
        this.weatherNear = this.scene.add.particles(0, 0, 'env:drop', {
          emitZone: { type: 'random', source: top, quantity: 1 },
          lifespan: 1300,
          speedY: { min: 760, max: 940 },
          speedX: { min: -150, max: -95 },
          scaleX: 1,
          scaleY: { min: 0.9, max: 1.7 },
          alpha: { start: 0.5, end: 0.14 },
          quantity: Math.round(3 * density),
          frequency: 26,
          tint,
          blendMode: Phaser.BlendModes.ADD
        })
        this.weatherFar = this.scene.add.particles(0, 0, 'env:drop', {
          emitZone: { type: 'random', source: far, quantity: 1 },
          lifespan: 2200,
          speedY: { min: 300, max: 400 },
          speedX: { min: -70, max: -40 },
          scale: { min: 0.35, max: 0.55 },
          alpha: { start: 0.2, end: 0.05 },
          quantity: Math.round(2 * density),
          frequency: 40,
          tint: mix(tint, t.fog, 0.5),
          blendMode: Phaser.BlendModes.ADD
        })
        break
      }
      case 'snow': {
        const tint = mix(key, t.sky[1], 0.25)
        this.weatherNear = this.scene.add.particles(0, 0, 'env:flake', {
          emitZone: { type: 'random', source: top, quantity: 1 },
          lifespan: 6200,
          speedY: { min: 42, max: 84 },
          speedX: { min: -34, max: 26 },
          scale: { min: 0.7, max: 1.5 },
          alpha: { start: 0.85, end: 0.25 },
          rotate: { min: 0, max: 360 },
          quantity: Math.round(2 * density),
          frequency: 70,
          tint
        })
        this.weatherFar = this.scene.add.particles(0, 0, 'env:flake', {
          emitZone: { type: 'random', source: far, quantity: 1 },
          lifespan: 11000,
          speedY: { min: 16, max: 34 },
          speedX: { min: -16, max: 12 },
          scale: { min: 0.3, max: 0.55 },
          alpha: { start: 0.3, end: 0.08 },
          quantity: Math.round(2 * density),
          frequency: 110,
          tint: mix(tint, t.fog, 0.55)
        })
        break
      }
      case 'ash': {
        const tint = mix(t.fog, 0x000000, 0.15)
        this.weatherNear = this.scene.add.particles(0, 0, 'env:speck', {
          emitZone: { type: 'random', source: top, quantity: 1 },
          lifespan: 7200,
          speedY: { min: 26, max: 58 },
          speedX: { min: -58, max: -14 },
          scale: { min: 0.6, max: 1.5 },
          alpha: { start: 0.55, end: 0.1 },
          rotate: { min: 0, max: 360 },
          quantity: Math.round(2 * density),
          frequency: 90,
          tint
        })
        this.weatherFar = this.scene.add.particles(0, 0, 'env:speck', {
          emitZone: { type: 'random', source: far, quantity: 1 },
          lifespan: 13000,
          speedY: { min: 10, max: 24 },
          speedX: { min: -26, max: -6 },
          scale: { min: 0.3, max: 0.7 },
          alpha: { start: 0.26, end: 0.05 },
          quantity: Math.round(2 * density),
          frequency: 120,
          tint: mix(tint, t.sky[2], 0.4)
        })
        break
      }
      case 'embers': {
        const hot = mix(t.sun, 0xff7a2a, 0.45)
        this.weatherNear = this.scene.add.particles(0, 0, 'env:mote', {
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-60, cam.height * 0.52, cam.width + 120, cam.height * 0.44),
            quantity: 1
          },
          lifespan: 4200,
          speedY: { min: -84, max: -30 },
          speedX: { min: -24, max: 24 },
          scale: { min: 0.14, max: 0.34 },
          alpha: { start: 0.95, end: 0 },
          quantity: Math.round(1 * density),
          frequency: 130,
          tint: [hot, mix(t.sun, 0xffffff, 0.4)],
          blendMode: Phaser.BlendModes.ADD
        })
        this.weatherFar = this.scene.add.particles(0, 0, 'env:speck', {
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-60, cam.height * 0.42, cam.width + 120, cam.height * 0.2),
            quantity: 1
          },
          lifespan: 7000,
          speedY: { min: -30, max: -8 },
          speedX: { min: -16, max: 16 },
          scale: { min: 0.4, max: 0.9 },
          alpha: { start: 0.5, end: 0 },
          quantity: 1,
          frequency: 220,
          tint: mix(hot, t.fog, 0.4),
          blendMode: Phaser.BlendModes.ADD
        })
        break
      }
      default: {
        // "Clear" still has air in it: a thin drift of high pollen, lit from
        // the same key as everything else.
        this.weatherFar = this.scene.add.particles(0, 0, 'env:mote', {
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-60, 0, cam.width + 120, cam.height * 0.6),
            quantity: 1
          },
          lifespan: 9000,
          speedY: { min: 6, max: 20 },
          speedX: { min: -22, max: -6 },
          scale: { min: 0.08, max: 0.2 },
          alpha: { start: 0.24, end: 0 },
          quantity: 1,
          frequency: 260,
          tint: mix(key, t.fog, 0.4),
          blendMode: Phaser.BlendModes.ADD
        })
        break
      }
    }
    this.weatherNear?.setScrollFactor(0).setDepth(800)
    this.weatherFar?.setScrollFactor(0).setDepth(-967)
  }

  // ── the frame ──

  /** Called every frame with the camera scroll so layers slide at their own rate. */
  update(delta: number, scrollX: number): void {
    // Scene restarts can land an update between teardown and rebuild; touching
    // a destroyed TileSprite throws inside Phaser's UV update.
    if (this.destroyed) return
    // A caller that forgets to theme the world still gets a world.
    if (this.age < 0) this.setAge(0)
    this.time += delta
    this.scrollX = scrollX

    // tilePositionX counts *texture* pixels and every layer draws at a tile
    // scale of two, so a raw camera offset would slide the art at twice the
    // camera's speed. Scaling by ENV_RES is what makes the ground sit still under
    // the feet of the units standing on it.
    // Every offset lands on a whole texture pixel. A fractional tilePositionX
    // is resolved by the sampler, so each layer would otherwise jump a pixel at
    // its own threshold — and a layer jumping while its neighbour has not is
    // exactly what reads as stutter.
    const at = (rate: number) => Math.round(scrollX * rate * ENV_RES)
    this.cirrus.tilePositionX = at(ENV_SCROLL.cirrus) + Math.round(this.time * 0.0016)
    this.cumulus.tilePositionX = at(ENV_SCROLL.cumulus) + Math.round(this.time * 0.0042)
    for (let d = 0; d < this.bands.length; d += 1) {
      this.bands[d].tilePositionX = at(ENV_SCROLL.bands[d])
    }
    this.fog.tilePositionX = at(ENV_SCROLL.fog) + Math.round(Math.sin(this.time / 9000) * 3)


    // Anything hung off a layer has to travel with it, in screen space.
    const place = (band: number, artX: number): number => {
      const period = ENV_LAYER_WIDTH
      let x = Math.round(artX / ENV_RES - scrollX * ENV_SCROLL.bands[band])
      while (x < -period * 0.5) x += period
      while (x > period * 1.5) x -= period
      return x
    }

    const frame = Math.floor(this.time / 165) % ENV_SMOKE_FRAMES
    for (const column of this.smoke) {
      column.image.x = place(column.band, column.x) + Math.sin(this.time / 3400 + column.drift * 6) * 4
      column.image.setTexture(`env:smoke:${frame}`)
    }

    for (const beacon of this.beacons) {
      beacon.image.x = place(beacon.band, beacon.x)
      // A square pulse, not a sine: a light that fades in and out reads as a
      // dimmer, and these are lamps.
      const cycle = (this.time / 1000) * beacon.rate + beacon.phase
      const on = Math.sin(cycle) > (beacon.rate < 2 ? 0.55 : -0.2)
      beacon.image.setAlpha(on ? 0.95 : 0.12)
    }

    if (this.beam) {
      this.beam.x = place(this.beamBand, this.beamX)
      const sweep = Math.sin(this.time / 5200)
      this.beam.setRotation(sweep * 0.62)
      // Brightest when it points away from the camera, which is when a real
      // beam catches the most air.
      this.beam.setAlpha(0.16 + Math.abs(sweep) * 0.2)
    }

    // The sun breathes, very slightly. Enough to be alive, not enough to notice.
    this.celestial.setScale((1 + Math.sin(this.time / 2600) * 0.018) / ENV_RES)
  }

  /** Briefly washes the sky when a special ability fires. */
  flashSky(color: number, intensity = 0.5, durationMs = 260): void {
    if (this.destroyed) return
    const cam = this.scene.cameras.main
    const flash = this.scene.add
      .rectangle(0, 0, cam.width, cam.height, color, intensity)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(895)
      .setBlendMode(Phaser.BlendModes.ADD)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: durationMs,
      onComplete: () => flash.destroy()
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.clearDetails()
    this.motes?.destroy()
    this.weatherNear?.destroy()
    this.weatherFar?.destroy()
    this.sky.destroy()
    this.celestial.destroy()
    this.cirrus.destroy()
    this.cumulus.destroy()
    this.bands.forEach(b => b.destroy())
    this.fog.destroy()
    this.floorImg.destroy()
    this.vignette.destroy()
  }

  /** The width of the world this environment was built for. */
  get width(): number {
    return this.worldWidth
  }

  /** Where the camera currently is, for anything that wants to follow. */
  get scroll(): number {
    return this.scrollX
  }
}
