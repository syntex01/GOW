import Phaser from 'phaser'
import { save } from '../core/save'
import { AGE_THEMES, type AgeTheme } from './palette'
import Pix, { RES, ditherAt, mix, pixelNoise, ramp, tone, type PixelCanvas, type Ramp } from './pixel'

/**
 * The world behind the battle.
 *
 * This is a whole environment rather than a backdrop: a sky with weather in it,
 * four ranges of terrain receding into haze, a floor that lies down, and a bank
 * of scenery close enough to the camera to blur past. Every pixel of it is
 * generated here — nothing ships as an image — and every age gets its own
 * landmarks, its own light and its own atmosphere.
 *
 * ## The rules this file obeys, and why
 *
 * 1. **A TileSprite tiles in both axes.** Art shorter than its band repeats
 *    vertically and draws the same crest twice up the screen; art narrower than
 *    the viewport runs a hard seam down the picture. So every layer is authored
 *    at *exactly* its band height, and every layer is authored wider than the
 *    viewport plus the furthest its own tile position can travel. The sizes are
 *    declared once, at the top, and both the art and the sprites read them.
 * 2. **`tilePositionX` counts texture pixels, and every layer draws at a tile
 *    scale of two.** A raw camera offset therefore slides a layer at twice the
 *    camera's speed. Everything is scaled by `RES`.
 * 3. **Aerial perspective is enforced, not hoped for.** All four ranges derive
 *    from one near-rock colour hazed toward the horizon, and then their
 *    luminance is *driven* to a guaranteed separation. A theme cannot repaint
 *    the hills into the wrong order however hard it tries.
 * 4. **No smooth alpha gradients anywhere.** A gradient rectangle has a hard
 *    edge at the row where it starts, which draws a line across the whole
 *    screen. Every fade in here is ordered dithering between two palette tones.
 * 5. **Light comes from the upper right**, five tones per material from
 *    `ramp()`, and outlines — where there are any — are post-passes.
 */

// ──────────────────────────── Geometry ────────────────────────────
//
// World pixels. Art is generated at `RES` times this and drawn back at a tile
// scale of two, which keeps the backdrop on the same pixel grid as the sprites.

/**
 * Authored width of every scrolling layer.
 *
 * The widest viewport is 1280 and the fastest layer (the near bank) travels at
 * 1.35x a camera that can itself only cross `worldWidth - viewport`. 2048 has a
 * wide margin over anything the game can ask for, and it is a power of two, so
 * the periodic noise the terrain is built from wraps exactly.
 */
export const ENV_LAYER_WIDTH = 2048

/**
 * Height of each range, far to near. Each is authored at exactly this.
 *
 * The heights are not arbitrary. Every range's foot sits on the ground line, so
 * its height is what decides where its crest can be, and the four crests have
 * to stack into a readable staircase with the sky left open above the far one —
 * roughly y=140 for the far summits down to y=430 for the near hills, on a
 * 720-tall frame with the ground at 545. Each canvas also carries enough room
 * above its own crest for the tallest landmark that can stand on it.
 */
export const ENV_BAND_HEIGHTS = [544, 440, 330, 244] as const

/** How far below the ground line the foot of every range sits. */
export const ENV_BAND_FOOT = 8

/** The haze band that seats the battlefield against the hills. */
export const ENV_FOG_HEIGHT = 100

/** The battlefield floor. Taller than any viewport shows, so it cannot repeat. */
export const ENV_GROUND_HEIGHT = 200

/** The near bank that frames the battlefield from below. */
export const ENV_BANK_HEIGHT = 150

/** How far above the ground line the near bank's bottom edge sits. */
export const ENV_BANK_DROP = 72

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

/** World pixels to art pixels. */
function A(world: number): number {
  return Math.round(world * RES)
}

function theme(age: number): AgeTheme {
  return AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
}

// ──────────────────────────── Colour ────────────────────────────

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

/** How much sky is mixed into each range. Far is nearly all sky. */
const BAND_HAZE = [0.66, 0.44, 0.24, 0.07]

/**
 * The smallest and largest total spread, in luminance, from the near range to
 * the far one.
 *
 * The floor is what stops the ranges collapsing into one grey mass when a theme
 * paints its rock and its sky at the same value. The ceiling is what stops the
 * far range overshooting the sky it is supposed to be dissolving into — a
 * mountain sixty miles away is *never* brighter than the air in front of it by
 * much, and a range that is reads as a wall of glowing rock.
 */
/**
 * Where the nearest range sits relative to its own horizon. Land reads as land
 * because it is decisively darker than the sky it stands against — or brighter,
 * in the ages whose light comes from the ground.
 */
const NEAR_GROUND_SHARE = 0.56
const BAND_SPREAD_MIN = 27
const BAND_SPREAD_MAX = 46

/**
 * The base colour of one range.
 *
 * Every range is the *same* rock, seen through more or less air, so the
 * ordering is structural: more haze is always closer to the sky. Hazing alone
 * is not enough, though — where a theme's rock and sky sit at the same value,
 * mixing one toward the other changes hue without moving value at all, and the
 * bands collapse into a single grey mass. So the value is driven directly, band
 * by band, until there is a real step between each pair. No palette can defeat
 * that, and none of them can invert it either.
 */
export function envBandBase(age: number, depth: number): number {
  const t = theme(age)
  const rock = t.ridges[2]
  const horizon = t.sky[2]
  const d = Math.max(0, Math.min(BAND_HAZE.length - 1, depth))
  const base = mix(rock, horizon, BAND_HAZE[d])

  const rawNear = lum(mix(rock, horizon, BAND_HAZE[BAND_HAZE.length - 1]))
  // Distance moves a band toward the sky's value. Where sky and rock share a
  // value there is no physical answer, so fall back on the painter's
  // convention: distance lightens.
  const direction = Math.abs(lum(horizon) - rawNear) < 8 ? 1 : Math.sign(lum(horizon) - rawNear)
  // Land has to sit clear of its own sky, not merely a shade off it. The
  // staircase between the ranges was already right, but the whole flight of it
  // started so close to the horizon's value that the ridges, the ground and the
  // soldiers standing on it all washed into one pale field. Anchoring the
  // nearest range well away from the sky, in whichever direction this age's
  // light runs, puts the contrast back without disturbing the steps above it.
  const anchor = direction > 0 ? lum(horizon) * NEAR_GROUND_SHARE : Math.min(238, lum(horizon) / NEAR_GROUND_SHARE)
  const nearLum = direction > 0 ? Math.min(rawNear, anchor) : Math.max(rawNear, anchor)
  const towardSky = lum(horizon) - nearLum
  // Take slightly over half the distance from the rock to the sky, then hold it
  // inside the bounds above, so every theme gets a visible staircase and none
  // of them get a far range that outshines its own horizon.
  const spread = Math.min(
    BAND_SPREAD_MAX,
    Math.max(BAND_SPREAD_MIN, Math.abs(towardSky) * 0.55)
  )
  const steps = BAND_HAZE.length - 1
  const wanted = nearLum + ((steps - d) / steps) * spread * direction

  return driveLum(base, wanted)
}

/**
 * The floor colour, forced to continue the depth sequence past the nearest
 * range. If the units cannot be told from the ground under their feet, nothing
 * else about the scene matters.
 */
export function envGroundBase(age: number): number {
  const t = theme(age)
  const near = envBandBase(age, ENV_BAND_HEIGHTS.length - 1)
  const towardSky = lum(t.sky[2]) - lum(near)
  const direction = Math.abs(towardSky) < 8 ? 1 : Math.sign(towardSky)
  const g = t.ground
  const gap = direction * (lum(near) - lum(g))
  if (gap >= 10) return g
  return driveLum(g, lum(near) - direction * 16)
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
 * slot and jitters within it. That reads as *composed* — the spacing varies,
 * but nothing ever lands on top of anything else.
 */
function scatter(seed: number, width: number, count: number, kinds: readonly string[], min: number, max: number): Placement[] {
  const noise = pixelNoise(seed)
  // Inset by the widest thing that can be placed, so nothing is ever clipped in
  // half by the edge of the layer — which would show as a cut silhouette on the
  // one frame the wrap ever crossed the screen.
  const inset = max * 1.6
  const slot = (width - inset * 2) / count
  const out: Placement[] = []
  for (let i = 0; i < count; i += 1) {
    const jitter = noise(i, 1)
    const pick = noise(i, 2)
    const scale = noise(i, 3)
    out.push({
      x: Math.round(inset + slot * (i + 0.16 + jitter * 0.68)),
      // Weighted toward the head of the list: the first entry is the one that
      // says which age this is, so it should turn up more than the filler.
      kind: kinds[Math.min(kinds.length - 1, Math.floor(Math.pow(pick, 1.7) * kinds.length))],
      size: Math.round(min + scale * (max - min)),
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

/** What stands on the skyline in each age, from the far range to the near one. */
const AGE_CAST: readonly (readonly (readonly string[])[])[] = [
  [
    ['volcano', 'peak', 'peak'],
    ['monolith', 'arch', 'deadTree', 'peak'],
    ['monolith', 'deadTree', 'fern', 'rock'],
    ['fern', 'fern', 'deadTree', 'bonepile', 'rock']
  ],
  [
    ['peakFort', 'peak', 'peak'],
    ['castle', 'towerRuin', 'pine', 'wall'],
    ['windmill', 'pine', 'wall', 'pine'],
    ['pine', 'pine', 'wall', 'rock']
  ],
  [
    ['dome', 'peak', 'cityBlocks'],
    ['towerRuin', 'chimney', 'bridge', 'oak'],
    ['windmill', 'oak', 'wall', 'chimney'],
    ['oak', 'oak', 'crate', 'rock']
  ],
  [
    ['cityBlocks', 'chimney', 'peak'],
    ['towerRuin', 'pylon', 'wreckHull', 'chimney'],
    ['mast', 'pylon', 'wreckHull', 'deadTree'],
    ['wire', 'crate', 'deadTree', 'rock']
  ],
  [
    ['spires', 'cityBlocks', 'peak'],
    ['crashedShip', 'spires', 'pylon', 'dish'],
    ['pylon', 'mast', 'wreckHull', 'spires'],
    ['wire', 'mast', 'crate', 'rock']
  ]
]

/**
 * The small growth scattered along the two near crests.
 *
 * Deliberately a shorter list than the landmark cast: a ruined tower is a thing
 * you notice once, and at scrub size the same silhouette is just a smudge.
 */
const AGE_SCRUB: readonly (readonly string[])[] = [
  ['fern', 'fern', 'rock', 'deadTree'],
  ['pine', 'pine', 'pine', 'rock'],
  ['oak', 'pine', 'rock', 'oak'],
  ['deadTree', 'rock', 'crate', 'deadTree'],
  ['rock', 'crate', 'deadTree', 'rock']
]

/** The landmarks that need a level footing cut for them. Nothing else gets one. */
const BUILT = new Set([
  'peakFort',
  'castle',
  'towerRuin',
  'wall',
  'dome',
  'cityBlocks',
  'chimney',
  'bridge',
  'windmill',
  'crashedShip',
  'wreckHull',
  'spires',
  'crate'
])

/** Things that grow, which have to be sized against the range they stand on. */
const ORGANIC = new Set(['pine', 'oak', 'deadTree', 'fern', 'bonepile', 'rock'])

/** How many landmarks each range carries, and how tall they run, in art pixels. */
const CAST_COUNT = [3, 5, 7, 10]
const CAST_MIN = [26, 24, 18, 12]
const CAST_MAX = [50, 46, 34, 24]

/**
 * One silhouette on the skyline.
 *
 * Everything here is built from the range's own ramp, so a landmark is the same
 * rock as the hill it stands on, only darker — which is what stops it reading
 * as a sticker pasted onto the horizon. Nearer ranges get a lit top and right
 * edge; the far range stays flat, because at that distance nothing has edges.
 */
function drawLandmark(
  p: Pix,
  kind: string,
  x: number,
  baseY: number,
  s: number,
  r: Ramp,
  depth: number,
  glow: number,
  seed: number,
  flip: boolean,
  out: EnvAnchor[]
): void {
  const rnd = pixelNoise(seed + 17)
  const body = r[1]
  const lit = depth === 0 ? r[2] : r[3]
  const dark = depth === 0 ? r[1] : r[0]
  const dir = flip ? -1 : 1
  const S = Math.max(4, s)

  /** A lit block: top and right catch the light, the left falls into shadow. */
  const blk = (bx: number, by: number, bw: number, bh: number): void => {
    const X = Math.round(bx)
    const Y = Math.round(by)
    const W = Math.max(1, Math.round(bw))
    const H = Math.max(1, Math.round(bh))
    p.fill(X, Y, W, H, body)
    p.fill(X, Y, W, 1, lit)
    if (H > 2) p.fill(X, Y + 1, 1, H - 1, dark)
    if (W > 2) p.fill(X + W - 1, Y + 1, 1, H - 1, lit)
  }

  /** A window, vent or beacon: two pixels of light, with an anchor for the live one. */
  const spark = (sx: number, sy: number, live: boolean): void => {
    p.set(Math.round(sx), Math.round(sy), glow)
    if (live && out.length < 40) {
      out.push({ kind: 'light', x: Math.round(sx), y: Math.round(sy), scale: depth >= 2 ? 1.4 : 1, phase: rnd(sx | 0, sy | 0) })
    }
  }

  const smoke = (sx: number, sy: number, scale: number): void => {
    out.push({ kind: 'smoke', x: Math.round(sx), y: Math.round(sy), scale, phase: rnd(sx | 0, 3) })
  }

  switch (kind) {
    case 'peak': {
      // A rocky spur breaking the ridgeline. Asymmetric on purpose: a summit
      // with the same slope on both sides reads as a pyramid, and there are no
      // pyramids in a mountain range.
      const half = Math.max(3, Math.round(S * 0.75))
      const apex = 0.34 + rnd(1, 1) * 0.3
      for (let i = 0; i <= half * 2; i += 1) {
        const t = i / (half * 2)
        const col = Math.round(x - half + i)
        const side = t < apex ? t / apex : (1 - t) / (1 - apex)
        const shoulder = Math.pow(side, t < apex ? 0.72 : 1.45)
        const hgt = Math.round(S * shoulder - rnd(col, 1) * S * 0.14)
        if (hgt <= 0) continue
        p.fill(col, baseY - hgt, 1, hgt, t > apex ? r[2] : body)
        p.set(col, baseY - hgt, t > apex ? lit : dark)
      }
      break
    }
    case 'volcano': {
      // A cone with the crater bitten out of the top, glowing inside.
      const half = Math.max(6, Math.round(S * 1.7))
      for (let i = -half; i <= half; i += 1) {
        const t = Math.abs(i) / half
        // Straight flanks, not a dome: the concave sweep of a shield volcano
        // rounded off into a mushroom.
        const hgt = Math.round(S * (1 - Math.pow(t, 1.25)))
        if (hgt <= 0) continue
        p.fill(x + i, baseY - hgt, 1, hgt, i > 0 ? r[2] : body)
        p.set(x + i, baseY - hgt, i > 0 ? lit : dark)
      }
      const craterW = Math.max(3, Math.round(S * 0.5))
      const craterY = baseY - Math.round(S * 0.94)
      p.fill(x - (craterW >> 1), craterY, craterW, 2, dark)
      for (let i = 0; i < craterW; i += 1) {
        if (ditherAt(x + i, craterY, 0.6)) p.set(x - (craterW >> 1) + i, craterY, glow)
      }
      // Lava creeping down the lit face.
      for (let i = 0; i < 3; i += 1) {
        const lx = x + Math.round((rnd(i, 7) - 0.3) * S * 0.5)
        let ly = craterY + 2
        for (let k = 0; k < S * 0.5; k += 1) {
          if (ditherAt(lx, ly, 0.45)) p.set(lx, ly, glow)
          ly += 1
        }
      }
      smoke(x, craterY - 1, 1.35)
      break
    }
    case 'peakFort': {
      // A keep clinging to a summit: a battered wall, a stepped keep and a
      // watch tower with a pitched roof. Silhouette first — at this distance
      // the roofline is the only thing that says "fortress" rather than "block".
      const w = Math.max(6, Math.round(S * 0.9))
      const wallH = Math.max(3, Math.round(S * 0.34))
      for (let k = 0; k < wallH; k += 1) {
        const t = k / wallH
        const cw = Math.round(w * (0.86 + t * 0.26))
        p.fill(x - (cw >> 1), baseY - wallH + k, cw, 1, body)
        p.set(x - (cw >> 1), baseY - wallH + k, dark)
        if (cw > 2) p.set(x - (cw >> 1) + cw - 1, baseY - wallH + k, lit)
      }
      p.fill(x - (w >> 1), baseY - wallH, w, 1, lit)
      for (let i = 0; i < w; i += 3) p.fill(x - (w >> 1) + i, baseY - wallH - 2, 2, 2, body)
      const kw = Math.max(3, Math.round(w * 0.42))
      const kh = Math.round(S * 0.4)
      const kx = x - (kw >> 1) + dir * Math.round(w * 0.14)
      blk(kx, baseY - wallH - kh, kw, kh)
      // Pitched roof on the tower.
      for (let i = 0; i <= Math.round(kw * 0.7); i += 1) {
        const rw = kw - i * 2
        if (rw <= 0) break
        p.fill(kx + i, baseY - wallH - kh - Math.round(kw * 0.7) + i, rw, 1, i < 2 ? lit : body)
      }
      spark(kx + (kw >> 1), baseY - wallH - Math.round(kh * 0.5), depth <= 1)
      break
    }
    case 'castle': {
      // A curtain wall between two towers, with a gatehouse at the near end.
      const w = Math.max(8, Math.round(S * 1.5))
      const wallH = Math.round(S * 0.4)
      blk(x - (w >> 1), baseY - wallH, w, wallH)
      for (let i = 0; i < w; i += 4) p.fill(x - (w >> 1) + i, baseY - wallH - 2, 2, 2, body)
      const towerH = Math.round(S * 0.8)
      const tw = Math.max(3, Math.round(S * 0.2))
      for (const side of [-1, 1]) {
        const tx = x + side * ((w >> 1) - tw)
        blk(tx, baseY - towerH, tw, towerH)
        // Conical roof.
        for (let i = 0; i < Math.round(tw * 0.9); i += 1) {
          const rw = tw - i * 2
          if (rw <= 0) break
          p.fill(tx + i, baseY - towerH - Math.round(tw * 0.9) + i, rw, 1, i < 2 ? lit : body)
        }
        spark(tx + (tw >> 1), baseY - towerH + 2, depth >= 1)
      }
      for (let i = 0; i < 3; i += 1) spark(x - (w >> 3) + i * 3, baseY - Math.round(wallH * 0.55), false)
      break
    }
    case 'towerRuin': {
      // Broken off at an angle, with the floors showing through the break.
      const w = Math.max(3, Math.round(S * 0.36))
      const h = Math.round(S * 0.95)
      blk(x - (w >> 1), baseY - h, w, h)
      // Bite the top corner out, so it reads as broken rather than unfinished.
      for (let i = 0; i < w; i += 1) {
        const cut = Math.round((dir > 0 ? i / w : 1 - i / w) * S * 0.3 + rnd(i, 11) * 2)
        for (let k = 0; k < cut; k += 1) p.set(x - (w >> 1) + i, baseY - h + k, 0, 0)
        p.set(x - (w >> 1) + i, baseY - h + cut, lit)
      }
      for (let fy = baseY - Math.round(h * 0.5); fy < baseY - 2; fy += Math.max(3, Math.round(S * 0.2))) {
        p.fill(x - (w >> 1) + 1, fy, Math.max(1, w - 2), 1, dark)
      }
      if (w >= 4) spark(x, baseY - Math.round(h * 0.42), depth >= 1)
      // Rubble skirt.
      for (let i = -w; i <= w; i += 1) {
        if (rnd(i + 40, 12) < 0.5) continue
        p.set(x + i, baseY - 1, body)
      }
      break
    }
    case 'wall': {
      // A run of collapsed masonry, its top edge chewed away.
      const w = Math.max(5, Math.round(S * 1.4))
      const h = Math.round(S * 0.32)
      for (let i = 0; i < w; i += 1) {
        const notch = rnd(i, 13) > 0.72 ? Math.round(rnd(i, 14) * h * 0.7) : 0
        const top = baseY - h + notch
        p.fill(x - (w >> 1) + i, top, 1, h - notch, body)
        p.set(x - (w >> 1) + i, top, lit)
      }
      for (let i = 2; i < w; i += 4) p.fill(x - (w >> 1) + i, baseY - h + 2, 1, h - 3, dark)
      break
    }
    case 'dome': {
      // A cathedral: dome, drum and a lantern spire above it.
      const rx = Math.max(3, Math.round(S * 0.44))
      const drum = Math.round(S * 0.3)
      blk(x - rx, baseY - drum, rx * 2, drum)
      p.ellipse(x, baseY - drum, rx, rx * 0.95, body)
      p.ellipse(x + rx * 0.22, baseY - drum - rx * 0.16, rx * 0.7, rx * 0.68, r[2])
      p.ellipse(x + rx * 0.36, baseY - drum - rx * 0.3, rx * 0.3, rx * 0.28, lit)
      p.fill(x, baseY - drum - Math.round(rx * 1.6), 1, Math.round(rx * 0.6), body)
      p.set(x, baseY - drum - Math.round(rx * 1.6), lit)
      for (let i = 0; i < 3; i += 1) spark(x - rx + 2 + i * Math.max(2, rx), baseY - Math.round(drum * 0.5), false)
      break
    }
    case 'cityBlocks': {
      // A skyline: slabs of different heights, some with their tops blown off.
      const w = Math.max(8, Math.round(S * 1.9))
      let cx = x - (w >> 1)
      let i = 0
      while (cx < x + (w >> 1)) {
        const bw = Math.max(2, Math.round(S * (0.14 + rnd(i, 21) * 0.2)))
        const bh = Math.max(3, Math.round(S * (0.3 + rnd(i, 22) * 0.8)))
        blk(cx, baseY - bh, bw, bh)
        if (rnd(i, 23) > 0.62) {
          // A broken crown on this one.
          for (let k = 0; k < bw; k += 1) {
            const cut = Math.round(rnd(cx + k, 24) * S * 0.16)
            for (let q = 0; q < cut; q += 1) p.set(cx + k, baseY - bh + q, 0, 0)
          }
        }
        if (bw >= 3 && bh >= 6) {
          for (let wy = baseY - bh + 3; wy < baseY - 2; wy += 3) {
            for (let wx = cx + 1; wx < cx + bw - 1; wx += 2) {
              if (rnd(wx, wy) > 0.72) spark(wx, wy, false)
            }
          }
        }
        if (rnd(i, 25) > 0.7 && bh > S * 0.7) spark(cx + (bw >> 1), baseY - bh - 1, depth <= 2)
        cx += bw + 1
        i += 1
      }
      if (depth <= 1) smoke(x + Math.round(S * 0.3), baseY - Math.round(S * 0.9), 1)
      break
    }
    case 'chimney': {
      // A works chimney, tapered, with a smoke plume hanging off it.
      const h = Math.round(S * 1.1)
      const wTop = Math.max(2, Math.round(S * 0.1))
      const wBot = Math.max(3, Math.round(S * 0.2))
      for (let k = 0; k < h; k += 1) {
        const t = k / h
        const cw = Math.round(wTop + (wBot - wTop) * t)
        p.fill(x - (cw >> 1), baseY - h + k, cw, 1, body)
        p.set(x - (cw >> 1), baseY - h + k, dark)
        if (cw > 2) p.set(x - (cw >> 1) + cw - 1, baseY - h + k, lit)
      }
      p.fill(x - (wTop >> 1) - 1, baseY - h, wTop + 2, 1, lit)
      blk(x - Math.round(S * 0.3), baseY - Math.round(S * 0.24), Math.round(S * 0.6), Math.round(S * 0.24))
      smoke(x, baseY - h, 0.9)
      break
    }
    case 'bridge': {
      // An aqueduct span: piers under arches, the deck running off both edges.
      const w = Math.max(10, Math.round(S * 2))
      const h = Math.round(S * 0.55)
      p.fill(x - (w >> 1), baseY - h, w, Math.max(2, Math.round(S * 0.1)), body)
      p.fill(x - (w >> 1), baseY - h, w, 1, lit)
      const piers = Math.max(2, Math.round(w / Math.max(4, S * 0.4)))
      for (let i = 0; i <= piers; i += 1) {
        const px = x - (w >> 1) + Math.round((i * w) / piers)
        p.fill(px, baseY - h, Math.max(1, Math.round(S * 0.08)), h, body)
      }
      break
    }
    case 'windmill': {
      // Tower, cap and four sails caught mid-turn.
      const h = Math.round(S * 0.62)
      const w = Math.max(3, Math.round(S * 0.24))
      for (let k = 0; k < h; k += 1) {
        const cw = Math.round(w * (0.7 + (k / h) * 0.5))
        p.fill(x - (cw >> 1), baseY - h + k, cw, 1, body)
        if (cw > 2) p.set(x - (cw >> 1) + cw - 1, baseY - h + k, lit)
      }
      const hubY = baseY - h - 1
      p.fill(x - (w >> 1) - 1, hubY, w + 2, 2, dark)
      const arm = Math.max(3, Math.round(S * 0.34))
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + 0.4
        p.line(x, hubY, x + Math.cos(a) * arm, hubY + Math.sin(a) * arm, body)
      }
      break
    }
    case 'monolith': {
      // Standing stones: a trilithon, leaning, with a fallen one beside it.
      const h = Math.round(S * 0.9)
      const w = Math.max(2, Math.round(S * 0.16))
      const gap = Math.max(3, Math.round(S * 0.45))
      blk(x - gap, baseY - h, w, h)
      blk(x + gap - w, baseY - Math.round(h * 0.86), w, Math.round(h * 0.86))
      p.fill(x - gap, baseY - h - Math.max(1, Math.round(S * 0.08)), gap * 2, Math.max(1, Math.round(S * 0.08)), body)
      p.fill(x - gap, baseY - h - Math.max(1, Math.round(S * 0.08)), gap * 2, 1, lit)
      if (S > 16) p.fill(x + gap + 2, baseY - Math.round(S * 0.12), Math.round(S * 0.4), Math.round(S * 0.12), body)
      break
    }
    case 'arch': {
      // A wind-cut rock arch: two thick legs carrying a sagging span.
      const half = Math.max(4, Math.round(S * 0.62))
      const h = Math.round(S * 0.9)
      const leg = Math.max(2, Math.round(S * 0.24))
      for (const side of [-1, 1]) {
        const lx = x + side * (half - (leg >> 1))
        for (let k = 0; k < h; k += 1) {
          const t = k / h
          const lw = Math.max(1, Math.round(leg * (0.7 + t * 0.7)))
          p.fill(lx - (lw >> 1), baseY - h + k, lw, 1, side > 0 ? r[2] : body)
          p.set(lx - (lw >> 1), baseY - h + k, dark)
          if (lw > 2) p.set(lx - (lw >> 1) + lw - 1, baseY - h + k, side > 0 ? lit : body)
        }
      }
      const spanH = Math.max(2, Math.round(S * 0.2))
      for (let i = -half; i <= half; i += 1) {
        const sag = Math.round(Math.cos((i / half) * 1.3) * spanH * 0.5)
        p.fill(x + i, baseY - h - sag, 1, spanH, body)
        p.set(x + i, baseY - h - sag, lit)
      }
      break
    }
    case 'pylon': {
      // A lattice pylon: cross-braced, arms out, a lamp on the mast head.
      const h = Math.round(S * 1.05)
      const half = Math.max(2, Math.round(S * 0.18))
      p.line(x - half, baseY, x - 1, baseY - h, body)
      p.line(x + half, baseY, x + 1, baseY - h, r[2])
      for (let k = 2; k < h; k += Math.max(2, Math.round(S * 0.14))) {
        const t = k / h
        const hw = Math.max(1, Math.round(half * (1 - t)))
        p.fill(x - hw, baseY - k, hw * 2 + 1, 1, body)
        p.line(x - hw, baseY - k, x + hw, baseY - k - Math.round(S * 0.12), dark)
      }
      for (const arm of [0.62, 0.82]) {
        const ay = baseY - Math.round(h * arm)
        const aw = Math.round(S * 0.4)
        p.fill(x - aw, ay, aw * 2 + 1, 1, body)
        p.set(x - aw, ay - 1, body)
        p.set(x + aw, ay - 1, body)
      }
      p.fill(x, baseY - h - 2, 1, 2, body)
      spark(x, baseY - h - 2, true)
      break
    }
    case 'mast': {
      // A guyed antenna mast with a dish half way up.
      const h = Math.round(S * 1.25)
      p.fill(x, baseY - h, 1, h, body)
      p.set(x, baseY - h, lit)
      p.line(x, baseY - Math.round(h * 0.82), x - Math.round(S * 0.42), baseY, dark)
      p.line(x, baseY - Math.round(h * 0.82), x + Math.round(S * 0.42), baseY, dark)
      for (let k = Math.round(h * 0.2); k < h; k += Math.max(3, Math.round(S * 0.22))) {
        p.fill(x - 1, baseY - k, 3, 1, body)
      }
      p.ellipse(x + 2, baseY - Math.round(h * 0.55), Math.max(1.4, S * 0.1), Math.max(1.4, S * 0.1), body)
      spark(x, baseY - h, true)
      out.push({ kind: 'beam', x, y: baseY - h, scale: 1, phase: rnd(x, 32) })
      break
    }
    case 'dish': {
      // A tracking dish on a stubby pylon.
      const h = Math.round(S * 0.5)
      blk(x - 1, baseY - h, 3, h)
      const rx = Math.max(2, Math.round(S * 0.42))
      p.ellipse(x, baseY - h - rx * 0.5, rx, rx * 0.85, body)
      p.eraseEllipse(x - rx * 0.35, baseY - h - rx * 0.55, rx * 0.72, rx * 0.6)
      p.ellipse(x - rx * 0.1, baseY - h - rx * 0.5, rx * 0.5, rx * 0.45, r[2])
      spark(x + Math.round(rx * 0.6), baseY - h - Math.round(rx * 0.4), true)
      out.push({ kind: 'beam', x, y: baseY - h, scale: 0.8, phase: rnd(x, 33) })
      break
    }
    case 'wreckHull': {
      // An armoured hull, nose down in the dirt, tracks shed behind it.
      const w = Math.max(6, Math.round(S * 1.3))
      const h = Math.max(3, Math.round(S * 0.42))
      const tilt = Math.round(h * 0.7)
      for (let i = 0; i < w; i += 1) {
        const t = i / w
        const top = baseY - h + Math.round(tilt * (dir > 0 ? t : 1 - t))
        p.fill(x - (w >> 1) + i, top, 1, baseY - top, body)
        p.set(x - (w >> 1) + i, top, lit)
      }
      // Turret, knocked half off.
      const tw = Math.max(2, Math.round(w * 0.3))
      blk(x - (tw >> 1) + dir * Math.round(w * 0.1), baseY - h - Math.round(h * 0.6), tw, Math.round(h * 0.6))
      p.fill(x + dir * Math.round(w * 0.3), baseY - h - Math.round(h * 0.4), Math.round(w * 0.3) * dir || 1, 1, body)
      if (rnd(x, 41) > 0.5 && depth <= 2) smoke(x, baseY - h - Math.round(h * 0.6), 0.55)
      break
    }
    case 'crashedShip': {
      // A hull ploughed into the ridge: broken spine, fins up, engines cold.
      const w = Math.max(14, Math.round(S * 2.4))
      const h = Math.max(5, Math.round(S * 0.62))
      const nose = x - dir * (w >> 1)
      for (let i = 0; i < w; i += 1) {
        const t = i / w
        const px = x - (w >> 1) + i
        const rise = Math.round(h * Math.pow(dir > 0 ? t : 1 - t, 1.6))
        const thick = Math.max(1, Math.round(h * (0.35 + 0.5 * Math.sin(Math.PI * t))))
        p.fill(px, baseY - rise - thick, 1, thick + rise, body)
        p.set(px, baseY - rise - thick, lit)
      }
      // A dorsal fin at the high end, and a torn gash in the flank.
      const finX = x + dir * Math.round(w * 0.28)
      p.poly(
        [
          [finX, baseY - h - Math.round(S * 0.5)],
          [finX + dir * Math.round(S * 0.34), baseY - h],
          [finX - dir * Math.round(S * 0.2), baseY - h]
        ],
        body
      )
      for (let i = 0; i < Math.round(w * 0.3); i += 1) {
        const gx = x - dir * Math.round(w * 0.1) + i * dir
        if (rnd(gx, 51) > 0.45) p.set(gx, baseY - Math.round(h * 0.5), dark)
      }
      for (let i = 0; i < 4; i += 1) {
        spark(x - dir * Math.round(w * 0.3) + i * dir * 3, baseY - Math.round(h * 0.75), i === 1)
      }
      p.set(nose, baseY - 1, dark)
      smoke(x + dir * Math.round(w * 0.15), baseY - h - Math.round(S * 0.4), 1.1)
      break
    }
    case 'spires': {
      // Megastructure: three tapering towers with lit seams up their faces.
      const count = 3
      for (let i = 0; i < count; i += 1) {
        const off = Math.round((i - 1) * S * 0.45)
        const h = Math.round(S * (0.7 + rnd(i, 61) * 0.75))
        const w = Math.max(2, Math.round(S * 0.16 * (1 - i * 0.14)))
        for (let k = 0; k < h; k += 1) {
          const t = k / h
          const cw = Math.max(1, Math.round(w * (0.35 + t * 0.75)))
          p.fill(x + off - (cw >> 1), baseY - h + k, cw, 1, body)
          if (cw > 2) p.set(x + off - (cw >> 1) + cw - 1, baseY - h + k, lit)
        }
        for (let k = 3; k < h - 2; k += 1) {
          if (ditherAt(x + off, baseY - h + k, 0.5)) p.set(x + off, baseY - h + k, glow)
        }
        spark(x + off, baseY - h, i === 1)
      }
      break
    }
    case 'deadTree': {
      const h = Math.round(S * 0.8)
      p.fill(x, baseY - h, 1, h, body)
      p.set(x, baseY - h, lit)
      for (let i = 0; i < 4; i += 1) {
        const by = baseY - Math.round(h * (0.45 + i * 0.16))
        const reach = Math.round(S * 0.3 * (1 - i * 0.14)) * (i % 2 === 0 ? 1 : -1)
        p.line(x, by, x + reach, by - Math.round(h * 0.2), body)
      }
      break
    }
    case 'pine': {
      const h = Math.round(S * 0.9)
      p.fill(x, baseY - Math.round(h * 0.2), 1, Math.round(h * 0.2), dark)
      for (let i = 0; i < h; i += 1) {
        const half = Math.round((1 - i / h) * S * 0.3)
        p.fill(x - half, baseY - Math.round(h * 0.2) - i, half * 2 + 1, 1, body)
        if (half > 0) p.set(x + half, baseY - Math.round(h * 0.2) - i, depth >= 2 ? r[2] : body)
      }
      break
    }
    case 'oak': {
      const h = Math.round(S * 0.5)
      p.fill(x, baseY - h, 1, h, dark)
      p.ellipse(x, baseY - h - S * 0.28, S * 0.42, S * 0.32, body)
      p.ellipse(x + S * 0.14, baseY - h - S * 0.36, S * 0.22, S * 0.16, depth >= 2 ? r[2] : body)
      break
    }
    case 'fern': {
      for (let i = -2; i <= 2; i += 1) {
        p.line(x, baseY, x + i * S * 0.28, baseY - S * (0.75 - Math.abs(i) * 0.12), body)
      }
      break
    }
    case 'bonepile': {
      p.ellipse(x, baseY, S * 0.5, S * 0.22, body)
      for (let i = 0; i < 3; i += 1) {
        const bx = x + Math.round((rnd(i, 71) - 0.5) * S)
        p.line(bx, baseY, bx + Math.round((rnd(i, 72) - 0.5) * S * 0.7), baseY - Math.round(S * 0.6), r[2])
      }
      break
    }
    case 'crate': {
      const w = Math.max(3, Math.round(S * 0.7))
      const h = Math.max(2, Math.round(S * 0.5))
      blk(x - (w >> 1), baseY - h, w, h)
      p.line(x - (w >> 1), baseY - h, x - (w >> 1) + w - 1, baseY - 1, dark)
      if (rnd(x, 81) > 0.5) blk(x - (w >> 1) + Math.round(w * 0.5), baseY - h - Math.round(h * 0.7), Math.round(w * 0.6), Math.round(h * 0.7))
      break
    }
    case 'wire': {
      // Barbed wire on stakes: two sagging strands with barbs on them.
      const span = Math.max(6, Math.round(S * 1.6))
      const h = Math.round(S * 0.6)
      for (const px of [x - (span >> 1), x + (span >> 1)]) {
        p.fill(px, baseY - h, 1, h, body)
        p.line(px, baseY - h, px + Math.round(S * 0.2), baseY, dark)
      }
      for (let i = 0; i <= span; i += 1) {
        const t = i / span
        const sag = Math.sin(t * Math.PI) * S * 0.16
        const yy = Math.round(baseY - h + sag)
        p.set(x - (span >> 1) + i, yy, body)
        p.set(x - (span >> 1) + i, Math.round(yy + h * 0.4 + sag * 0.3), body)
        if (i % 5 === 2) {
          p.set(x - (span >> 1) + i, yy - 1, body)
          p.set(x - (span >> 1) + i, yy + 1, body)
        }
      }
      break
    }
    case 'rock':
    default: {
      const rx = Math.max(1.5, S * 0.42)
      p.ellipse(x, baseY, rx, rx * 0.62, body)
      p.ellipse(x + rx * 0.24, baseY - rx * 0.2, rx * 0.5, rx * 0.3, depth === 0 ? body : r[2])
      break
    }
  }
}

// ──────────────────────────── The sky ────────────────────────────

/**
 * The sky for one age: a stepped gradient, a baked glow around the sun, a star
 * field, and one atmospheric feature that belongs to the age.
 *
 * The glow is baked into the sky rather than added as a sprite because a glow
 * sprite is an alpha gradient, and an alpha gradient over a dithered sky is the
 * one thing that would give the whole picture away. Quantised into steps with
 * dithered joins, the sun brightens the air around it without a single soft
 * edge anywhere.
 */
export function envSkyPix(age: number, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const [top, midC, low] = t.sky
  const glowC = mix(t.sun, low, 0.25)
  const sunAt = ENV_SUN_POS[Math.max(0, Math.min(ENV_SUN_POS.length - 1, age))]
  const sunX = sunAt[0] * w
  const sunY = sunAt[1] * h
  const glowR = h * 0.86

  for (let y = 0; y < h; y += 1) {
    const tt = y / (h - 1)
    const local = tt < 0.55 ? tt / 0.55 : (tt - 0.55) / 0.45
    const from = tt < 0.55 ? top : midC
    const to = tt < 0.55 ? midC : low
    const steps = 18
    const scaled = local * steps
    const step = Math.floor(scaled)
    const a = mix(from, to, Math.min(1, step / steps))
    const b = mix(from, to, Math.min(1, (step + 1) / steps))
    for (let x = 0; x < w; x += 1) {
      let c = ditherAt(x, y, scaled % 1) ? b : a
      // Sun glow: six quantised rings, each boundary dithered.
      const d = Math.hypot((x - sunX) * 0.92, y - sunY) / glowR
      if (d < 1) {
        const strength = (1 - d) * (1 - d) * 5.6
        const level = Math.floor(strength) + (ditherAt(x, y, strength % 1) ? 1 : 0)
        if (level > 0) c = mix(c, glowC, Math.min(0.72, level * 0.115))
      }
      p.set(x, y, c)
    }
  }

  // Stars, only where the sky is genuinely dark, and brighter the higher they
  // are. Baked into the sky so the cloud banks in front of them occlude them.
  const stars = pixelNoise(age * 313 + 91)
  for (let y = 0; y < h * 0.8; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const here = p.get(x, y) & 0xffffff
      const dark = 1 - Math.min(1, lum(here) / 120)
      if (dark <= 0.05) continue
      const n = stars(x, y)
      const fall = 1 - y / (h * 0.8)
      if (n > 0.9988) {
        p.set(x, y, mix(here, 0xffffff, 0.85 * dark * (0.35 + fall * 0.65)))
        // A handful get a cross of dimmer pixels, so the field has a few
        // genuine stars in it rather than a uniform sprinkle.
        if (n > 0.99975) {
          const halo = mix(here, 0xffffff, 0.4 * dark)
          p.set(x - 1, y, halo)
          p.set(x + 1, y, halo)
          p.set(x, y - 1, halo)
          p.set(x, y + 1, halo)
        }
      } else if (n > 0.995) {
        p.set(x, y, mix(here, 0xffffff, 0.34 * dark * fall))
      }
    }
  }

  // One thing per age that the sky itself does.
  const feature = pixelNoise(age * 77 + 5)
  switch (age) {
    case 0: {
      // Volcanic murk hanging along the horizon.
      const murk = mix(t.fog, 0x000000, 0.35)
      for (let y = Math.round(h * 0.58); y < h; y += 1) {
        const tt = (y - h * 0.58) / (h * 0.42)
        for (let x = 0; x < w; x += 1) {
          if (ditherAt(x, y, Math.sin(tt * Math.PI) * 0.42)) p.set(x, y, mix(p.get(x, y) & 0xffffff, murk, 0.5))
        }
      }
      break
    }
    case 2: {
      // An overcast ceiling pressing down from the top of the frame.
      const lid = mix(t.sky[0], 0x000000, 0.3)
      const shape = wrapNoise(age * 13 + 1, w, 5, 3)
      for (let x = 0; x < w; x += 1) {
        const edge = h * (0.1 + shape(x) * 0.14)
        for (let y = 0; y < edge + 12; y += 1) {
          const tt = 1 - Math.max(0, (y - edge) / 12)
          if (ditherAt(x, y, tt * 0.9)) p.set(x, y, mix(p.get(x, y) & 0xffffff, lid, 0.6))
        }
      }
      break
    }
    case 3: {
      // Smog: horizontal banding low in the sky.
      for (let y = Math.round(h * 0.44); y < h; y += 1) {
        const band = 0.3 + Math.sin(y * 0.42) * 0.16
        for (let x = 0; x < w; x += 1) {
          if (ditherAt(x, y, band * 0.5)) p.set(x, y, mix(p.get(x, y) & 0xffffff, t.fog, 0.22))
        }
      }
      break
    }
    case 4: {
      // A shattered orbital ring arcing across the whole sky, and a nebula.
      const ringC = mix(t.fog, 0xffffff, 0.45)
      for (let x = 0; x < w; x += 1) {
        const yy = h * 0.34 - Math.sin((x / w) * Math.PI * 0.86 + 0.3) * h * 0.2
        const thick = 1 + Math.round(Math.sin((x / w) * Math.PI) * 2)
        for (let k = 0; k < thick; k += 1) {
          const gapped = feature(x >> 3, k) > 0.12
          if (!gapped) continue
          if (ditherAt(x, Math.round(yy) + k, 0.85 - k * 0.2)) {
            p.set(x, Math.round(yy) + k, mix(p.get(x, Math.round(yy) + k) & 0xffffff, ringC, 0.75))
          }
        }
      }
      const neb = smoothNoise2(age * 91 + 3)
      const nebC = mix(t.fog, 0xffffff, 0.2)
      for (let y = 0; y < h * 0.6; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const v = neb(x * 0.02, y * 0.03)
          if (v > 0.62 && ditherAt(x, y, (v - 0.62) * 2.4)) {
            p.set(x, y, mix(p.get(x, y) & 0xffffff, nebC, 0.3))
          }
        }
      }
      break
    }
    default:
      break
  }
  return p
}

/** The sun or moon: a hard disc, a banded corona and a few glare spikes. */
export function envCelestialPix(age: number): Pix {
  const t = theme(age)
  const moon = age === 4
  const r = moon ? 13 : 15
  const size = r * 2 + 40
  const p = new Pix(size, size)
  const c = size / 2
  const core = mix(t.sun, 0xffffff, moon ? 0.1 : 0.4)
  const rim = t.sun
  const halo = mix(t.sun, t.sky[1], 0.45)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c)
      if (d <= r) {
        p.set(x, y, d > r - 1.6 ? rim : core)
      } else {
        const fall = Math.max(0, 1 - (d - r) / (size / 2 - r))
        const scaled = fall * fall * 3.4
        const level = Math.floor(scaled) + (ditherAt(x, y, scaled % 1) ? 1 : 0)
        if (level > 0) p.set(x, y, level > 2 ? rim : halo)
      }
    }
  }
  if (moon) {
    // Craters, then a bite out of the limb so it reads as a phase.
    const n = pixelNoise(4001)
    for (let i = 0; i < 6; i += 1) {
      const a = n(i, 1) * Math.PI * 2
      const rr = n(i, 2) * r * 0.6
      p.ellipse(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1 + n(i, 3) * 2, 1 + n(i, 3) * 1.6, mix(core, t.sky[1], 0.42))
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (Math.hypot(x - c, y - c) > r) continue
        if (Math.hypot(x - (c - r * 0.62), y - (c - r * 0.16)) < r * 0.94) p.set(x, y, mix(halo, t.sky[0], 0.55))
      }
    }
  } else {
    // Glare: four short spikes, dithered so they do not read as a cross.
    for (let i = 0; i < 4; i += 1) {
      const dx = i < 2 ? (i === 0 ? 1 : -1) : 0
      const dy = i < 2 ? 0 : i === 2 ? 1 : -1
      for (let k = r; k < size / 2 - 1; k += 1) {
        const strength = 1 - (k - r) / (size / 2 - r)
        if (ditherAt(c + dx * k, c + dy * k, strength * strength * 1.4)) {
          p.set(c + dx * k, c + dy * k, rim)
        }
      }
    }
  }
  return p
}

/**
 * A cloud bank, authored to tile: every lump is drawn twice where it crosses
 * the wrap, so there is no seam however far the bank drifts.
 */
export function envCloudPix(age: number, tier: 0 | 1, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const overcast = age === 2 || age === 3
  const bodyC = mix(t.fog, t.sky[1], tier === 0 ? 0.6 : 0.34)
  const litC = mix(bodyC, keyLight(age), tier === 0 ? 0.3 : 0.5)
  const darkC = mix(bodyC, t.sky[0], 0.42)
  const n = pixelNoise(age * 401 + tier * 7)
  // Periodic in x, because the cloud banks drift for the whole match and their
  // wrap *will* cross the screen. A lump drawn on both sides of the wrap has to
  // have the same torn edge on both sides or a seam walks past the camera every
  // few minutes.
  const field = wrapNoise(age * 53 + tier * 11, w, 48, 3, 0.55)

  const stamp = (cx: number, cy: number, rx: number, ry: number, wobble: number): void => {
    for (let off = -w; off <= w; off += w) {
      const ox = cx + off
      if (ox + rx < 0 || ox - rx > w) continue
      for (let y = Math.max(0, Math.floor(cy - ry - 2)); y < Math.min(h, Math.ceil(cy + ry + 2)); y += 1) {
        for (let x = Math.max(0, Math.floor(ox - rx - 2)); x < Math.min(w, Math.ceil(ox + rx + 2)); x += 1) {
          const dx = (x - ox) / rx
          const dy = (y - cy) / ry
          const d = Math.hypot(dx, dy)
          const edge = 1 + (field(x + y * 2.7) - 0.5) * wobble
          if (d > edge) continue
          const core = 1 - d / edge
          if (core < 0.24 && !ditherAt(x, y, core * 3.4)) continue
          // Lit on the top and the right, shadowed underneath: the same key
          // light as every other thing in the game.
          const up = (cy - y) / ry
          const right = (x - ox) / rx
          const litness = up * 0.7 + right * 0.4
          let c = bodyC
          if (litness > 0.34) c = ditherAt(x, y, (litness - 0.34) * 2) ? litC : bodyC
          else if (litness < -0.1) c = ditherAt(x, y, (-litness - 0.1) * 1.7) ? darkC : bodyC
          p.set(x, y, c)
        }
      }
    }
  }

  if (tier === 0) {
    // Cirrus: torn banks of fine cloud, drifting apart. Built from a handful of
    // overlapping puffs rather than one long streak, because a streak drawn as
    // a stretched ellipse reads as a scratch on the lens.
    const count = overcast ? 8 : 5
    for (let i = 0; i < count; i += 1) {
      const cx = n(i, 1) * w
      const cy = h * (0.12 + n(i, 2) * 0.6)
      const len = w * (0.04 + n(i, 3) * 0.05)
      const thick = h * (0.06 + n(i, 4) * 0.07)
      const puffs = 4 + Math.floor(n(i, 6) * 4)
      for (let k = 0; k < puffs; k += 1) {
        const t = k / (puffs - 1) - 0.5
        stamp(
          cx + t * len * 2.4 + (n(i, 10 + k) - 0.5) * len * 0.5,
          cy + t * thick * 1.1 + (n(i, 20 + k) - 0.5) * thick * 0.7,
          len * (0.5 + n(i, 30 + k) * 0.5) * (1 - Math.abs(t) * 0.5),
          thick * (0.45 + n(i, 40 + k) * 0.4) * (1 - Math.abs(t) * 0.6),
          0.7
        )
      }
    }
  } else {
    // Cumulus: stacked masses with flat bottoms and piled tops.
    const count = overcast ? 7 : 5
    for (let i = 0; i < count; i += 1) {
      const cx = n(i, 11) * w
      const cy = h * (0.44 + n(i, 12) * 0.34)
      const rx = h * (0.5 + n(i, 13) * 0.55)
      const ry = h * (0.19 + n(i, 14) * 0.14)
      stamp(cx, cy, rx, ry, 0.32)
      for (let k = 0; k < 4; k += 1) {
        const kx = cx + (n(i, 20 + k) - 0.5) * rx * 1.3
        const ky = cy - ry * (0.35 + n(i, 30 + k) * 0.8)
        stamp(kx, ky, rx * (0.3 + n(i, 40 + k) * 0.26), ry * (0.7 + n(i, 50 + k) * 0.5), 0.42)
      }
      // A flat, shadowed base — the single detail that stops a cloud from
      // looking like a bag of circles.
      for (let x = Math.round(cx - rx); x < Math.round(cx + rx); x += 1) {
        const px = ((x % w) + w) % w
        for (let y = Math.round(cy + ry * 0.5); y < Math.round(cy + ry * 1.1); y += 1) {
          if (p.get(px, y) === 0) continue
          if (ditherAt(px, y, 0.55)) p.set(px, y, darkC)
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
 * One range of terrain.
 *
 * The four of them are the spine of the picture: the same rock at four
 * distances, each with its own profile, its own contrast, its own cast of
 * landmarks and its own scroll rate. The far one is a jagged skyline with
 * almost no contrast; the near one is a hillside with facets, scrub and a foot
 * that sinks into shadow.
 */
export function envBandArt(age: number, depth: number, worldW: number, worldH: number): EnvBandArt {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const anchors: EnvAnchor[] = []
  const d = Math.max(0, Math.min(3, depth))
  const base = envBandBase(age, d)
  const r = ramp(base, { contrast: 0.5 + d * 0.3 })
  const glow = mix(t.fog, keyLight(age), 0.5)

  // Crest window, as a fraction of the layer height measured from its top.
  // Everything above it is headroom for whatever stands on the crest.
  const crestHi = [0.2, 0.23, 0.23, 0.23][d]
  const crestLo = [0.44, 0.47, 0.49, 0.6][d]

  // Two terms, because a landscape has two: the massing, which is where the
  // ground is high and low, and the ridging, which is where it comes to a
  // point. Fractal noise on its own gives smooth lumps; ridged noise on its own
  // gives a row of teeth. Together they give a range.
  const massCells = [4, 5, 5, 6][d]
  const ridgeCells = [7, 9, 10, 12][d]
  const ridgeShare = [0.5, 0.45, 0.36, 0.3][d]
  const ridgeSharp = [1.5, 1.7, 2, 2.2][d]
  const mass = wrapNoise(age * 97 + d * 31, w, massCells, 5, 0.58)
  const rough = wrapNoise(age * 53 + d * 19 + 7, w, ridgeCells, 3, 0.55)

  const tops: number[] = []
  for (let x = 0; x < w; x += 1) {
    // The profile lands inside 0..1 by construction. Clamping it instead
    // flattens every summit into a mesa with sheer sides, which is exactly what
    // a mountain range does not look like.
    const ridged = Math.pow(1 - Math.abs(2 * rough(x) - 1), ridgeSharp)
    let profile = mass(x) * (1 - ridgeShare) + ridged * ridgeShare
    // Fractal noise piles up around its own mean, so a raw profile only ever
    // uses the middle half of the crest window and the range comes out as a
    // gentle swell. An S-curve pushes it back out toward both ends without ever
    // clipping, which is what puts real height between the summits and the
    // passes.
    profile = profile * profile * (3 - 2 * profile)
    tops.push(Math.round(h * crestLo - profile * h * (crestLo - crestHi)))
  }

  /**
   * Cuts a footing under a building so it stands on ground rather than on a
   * slope — and *only* under a building. Levelling a wide span for every prop
   * turns the whole ridgeline into a row of mesas with vertical sides, which is
   * how this layer looked when it was first built. The cut is narrow, and its
   * edges ease back into the natural profile instead of stepping.
   */
  const plinth = (cx: number, half: number, taper: number): void => {
    let deepest = 0
    for (let x = cx - half; x <= cx + half; x += 1) {
      const i = ((x % w) + w) % w
      if (tops[i] > deepest) deepest = tops[i]
    }
    for (let x = cx - half - taper; x <= cx + half + taper; x += 1) {
      const i = ((x % w) + w) % w
      if (tops[i] >= deepest) continue
      const out = Math.max(0, Math.abs(x - cx) - half) / Math.max(1, taper)
      const ease = 1 - out * out * (3 - 2 * out)
      tops[i] = Math.round(tops[i] + (deepest - tops[i]) * ease)
    }
  }

  /**
   * How wide a landmark's base is, as a multiple of its height. A volcano is
   * three times as wide as it is tall; a dead tree is a stick.
   */
  const footHalf = (kind: string, size: number): number => {
    const k =
      kind === 'volcano'
        ? 1.75
        : kind === 'crashedShip'
          ? 1.25
          : kind === 'bridge' || kind === 'cityBlocks'
            ? 1.05
            : kind === 'castle' || kind === 'wall' || kind === 'wire' || kind === 'wreckHull'
              ? 0.85
              : kind === 'arch' || kind === 'monolith' || kind === 'spires'
                ? 0.65
                : 0.45
    return Math.max(1, Math.round(size * k))
  }

  /**
   * The level a landmark stands on: the *lowest* ground anywhere under its
   * footprint.
   *
   * Seating it on the ground directly beneath its centre instead leaves a hole
   * of open sky under one side of anything wider than the terrain is flat —
   * which is what a volcano did, hovering over a crescent of the range behind
   * it. Taking the deepest point buries the base instead, which is what a
   * mountain sitting in a landscape actually does.
   */
  const seat = (cx: number, half: number): number => {
    let deepest = 0
    for (let x = cx - half; x <= cx + half; x += 1) {
      const i = ((x % w) + w) % w
      if (tops[i] > deepest) deepest = tops[i]
    }
    return deepest
  }

  const cast = AGE_CAST[Math.max(0, Math.min(AGE_CAST.length - 1, age))][d]
  const spots = scatter(age * 131 + d * 29 + 3, w, CAST_COUNT[d], cast, CAST_MIN[d], CAST_MAX[d])
  // Flatten before shading, so the footing is shaded like the rest of the hill.
  for (const spot of spots) {
    if (!BUILT.has(spot.kind)) continue
    plinth(spot.x, Math.round(spot.size * 0.45), Math.round(spot.size * 0.8))
  }

  // ── the body of the range ──
  const facetNoise = pixelNoise(age * 17 + d * 5)
  const capped = t.weather === 'snow' || t.weather === 'rain' || age === 1
  // A smoothed copy of the crest to read the facets off. Taking the slope
  // straight from the raw profile picks up every pixel of noise in it and
  // shades the hillside in one-pixel vertical stripes — a barcode, not a hill.
  const smoothTops: number[] = []
  for (let x = 0; x < w; x += 1) {
    let sum = 0
    for (let k = -6; k <= 6; k += 1) sum += tops[((x + k) % w + w) % w]
    smoothTops.push(sum / 13)
  }
  for (let x = 0; x < w; x += 1) {
    const top = Math.max(0, tops[x])
    // Which way this face turns. Falling away to the right means it is lit.
    const near = smoothTops[(x + 6) % w] - smoothTops[(x - 6 + w) % w]
    const far = smoothTops[(x + 22) % w] - smoothTops[(x - 22 + w) % w]
    // Faces turned toward the light get a lighter tone, faces turned away a
    // darker one, always dithered between neighbouring steps. Kept inside the
    // middle of the ramp: swinging the whole hillside from shadow to highlight
    // turns a landscape into a barcode.
    const litness = Math.max(-1, Math.min(1, (near * 0.5 + far * 0.16) / 9)) * (0.55 + d * 0.15)
    const f = Math.max(0.35, Math.min(3.2, 1.75 + litness * 1.15))

    // The facet only describes the shoulder of the hill. Carrying it all the
    // way down the layer paints a full-height vertical stripe wherever one
    // steep face happens to be — a curtain hanging over the picture — so it
    // eases back to the base tone below the crest.
    //
    // The foot shadow is folded into the same pass. It seats this range behind
    // the next one, and both of its steps are dithered: a hard cut here draws a
    // straight line across the whole screen, which no landscape has.
    const faceDepth = Math.max(6, h * 0.3)
    const span = Math.max(1, h - top)
    for (let y = top; y < h; y += 1) {
      const dt = Math.min(1, (y - top) / faceDepth)
      // Seated at the base tone rather than a step above it. Starting the body
      // at r[2] meant the upper half of every slab was painted lighter than the
      // colour the aerial-perspective ramp had just been so careful to choose,
      // and because the farthest band is also the tallest, that lighter half
      // covered most of the screen. The lit tones belong on the crest and the
      // faces turned into the light, not across the whole face of the range.
      const local = 1.45 + (f - 2) * (1 - dt * dt)
      const kk = Math.max(0, Math.min(3, Math.floor(local)))
      let c = ditherAt(x, y, local - kk) ? r[Math.min(4, kk + 1)] : r[kk]
      const tt = (y - top) / span
      if (tt > 0.46 && ditherAt(x, y, (tt - 0.46) * 1.8)) c = r[1]
      if (tt > 0.7 && ditherAt(x + 2, y + 1, (tt - 0.7) * 2.4)) c = r[0]
      p.set(x, y, c)
    }
    // The crest itself catches the light hardest of all — but only where it is
    // actually turned into it. A rim that runs the whole ridgeline is a drawn
    // outline, not a lit edge.
    if (litness > 0.42) {
      p.set(x, top, r[4])
      p.set(x, top + 1, r[3])
    } else if (litness > 0.04) {
      p.set(x, top, r[3])
    } else {
      p.set(x, top, r[1])
      p.set(x, top + 1, r[1])
    }

    // Snow and scree, but only in ages cold enough for it, only on summits that
    // are genuinely high, and only on the faces that catch the light. A cap
    // that follows the whole crest reads as a light band painted along the
    // horizon, and that is what it looked like on the first pass.
    if (capped && d <= 1 && top < h * (crestHi + (crestLo - crestHi) * 0.28) && litness > 0.14) {
      const capC = mix(r[4], keyLight(age), 0.3)
      const depthIn = Math.round(h * 0.014 + facetNoise(x, 9) * h * 0.02)
      for (let y = top + 1; y < top + depthIn; y += 1) {
        const tt = (y - top) / Math.max(1, depthIn)
        if (ditherAt(x, y, (1 - tt) * 0.9)) p.set(x, y, capC)
      }
    }

    // Gullies: a short shadow running down a steep face, tapering out. Long
    // ones read as paint running down the picture.
    if (d >= 1 && facetNoise(x, 3) > 0.965 && litness < 0.2) {
      const len = Math.round(h * (0.02 + facetNoise(x, 4) * 0.05))
      for (let y = top + 2; y < top + 2 + len; y += 1) {
        const fade = 1 - (y - top - 2) / Math.max(1, len)
        if (ditherAt(x, y, fade * 1.2)) p.set(x, y, r[0])
      }
    }
  }

  // ── what stands on it ──
  for (const spot of spots) {
    // A tree on a distant range is a speck. Sized like a building it becomes a
    // lollipop the size of a cathedral, which is exactly how it first looked.
    const size = ORGANIC.has(spot.kind) ? Math.round(spot.size * (d <= 1 ? 0.38 : 0.62)) : spot.size
    const baseY = seat(spot.x, footHalf(spot.kind, size)) + 1
    drawLandmark(p, spot.kind, spot.x, baseY, size, r, d, glow, spot.seed, spot.flip, anchors)
  }

  // Camp fires on the hills of the ages that have no electricity to blink.
  // Something has to be alive out there in every age, not only the ones with
  // pylons on them.
  if (d === 2 && age <= 2) {
    const fires = scatter(age * 307 + 19, w, 3, ['fire'], 6, 10)
    for (const fire of fires) {
      const fy = tops[fire.x % w] - 1
      p.set(fire.x, fy, glow)
      p.set(fire.x - 1, fy + 1, mix(glow, r[1], 0.45))
      p.set(fire.x + 1, fy + 1, mix(glow, r[1], 0.45))
      anchors.push({ kind: 'light', x: fire.x, y: fy, scale: 1.6, phase: fire.seed / 9999 })
    }
  }

  // A scatter of small growth along the crest of the two near ranges, which is
  // what makes a hill read as a place rather than as a shape.
  if (d >= 2) {
    const scrubKinds = AGE_SCRUB[Math.max(0, Math.min(AGE_SCRUB.length - 1, age))]
    const scrub = scatter(age * 211 + d * 41, w, d === 2 ? 30 : 42, scrubKinds, d === 2 ? 4 : 6, d === 2 ? 8 : 13)
    const throwaway: EnvAnchor[] = []
    for (const spot of scrub) {
      const baseY = seat(spot.x, footHalf(spot.kind, spot.size)) + 1
      drawLandmark(p, spot.kind, spot.x, baseY, spot.size, r, d, glow, spot.seed, spot.flip, throwaway)
    }
  }

  return { pix: p, anchors }
}

/**
 * The haze that seats the battlefield against the hills.
 *
 * Dithered, and gone at both edges, so there is no row anywhere that steps —
 * the fault that used to draw a hard horizontal line right across the picture.
 * Wisps are laid through it at slightly different densities so it moves like
 * air rather than sitting there like a sheet of tracing paper.
 */
export function envFogPix(age: number, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  // Tied to the range it sits in front of rather than to the raw theme colour,
  // so the haze is the same air the hills are seen through.
  const bandC = envBandBase(age, ENV_BAND_HEIGHTS.length - 1)
  const near = mix(t.fog, bandC, 0.34)
  const far = mix(mix(t.fog, t.sky[2], 0.45), bandC, 0.25)
  // Both fields are periodic in x: this band drifts as well as scrolling, so
  // its wrap has to match itself.
  const wisp = wrapNoise(age * 71 + 13, w, 26, 3, 0.55)
  const roll = wrapNoise(age * 29 + 3, w, 4, 3)

  for (let y = 0; y < h; y += 1) {
    const tt = h > 1 ? y / (h - 1) : 0
    const density = Math.pow(Math.sin(tt * Math.PI), 1.15) * 0.3
    const colour = tt < 0.45 ? far : near
    for (let x = 0; x < w; x += 1) {
      const local = density * (0.55 + wisp(x + y * 4.3) * 0.9) * (0.75 + roll(x) * 0.5)
      if (ditherAt(x, y, local)) p.set(x, y, colour)
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

/**
 * The near bank: the closest thing to the camera, scrolling faster than the
 * world, almost black, and carrying whatever litters the edge of the field in
 * this age.
 */
export function envBankPix(age: number, worldW: number, worldH: number): Pix {
  const t = theme(age)
  const w = A(worldW)
  const h = A(worldH)
  const p = new Pix(w, h)
  const bodyC = tone(envGroundBase(age), -0.55)
  const edgeC = tone(envGroundBase(age), -0.3)
  const deepC = tone(envGroundBase(age), -0.78)
  const r: Ramp = [deepC, bodyC, bodyC, edgeC, edgeC]
  const noise = pixelNoise(age * 311 + 13)
  const surface = wrapNoise(age * 29 + 5, w, 7, 4, 0.56)
  // The bank sits low in its strip: it frames the battlefield from below and
  // must never climb over the feet of the units fighting on it. Its top edge is
  // swung hard, because a black bar with a level top across the whole screen is
  // the single most artificial thing a backdrop can do.
  const topAt = (x: number): number => {
    const s = surface(x)
    // Pushed out toward both ends, for the same reason the ranges are: fractal
    // noise on its own gives a top edge that barely moves.
    const swung = s * s * (3 - 2 * s)
    return Math.round(h * 0.56 + swung * h * 0.42)
  }

  for (let x = 0; x < w; x += 1) {
    const top = Math.max(0, topAt(x))
    p.fill(x, top, 1, h - top, bodyC)
    p.set(x, top, edgeC)
    // Depth inside the bank itself: it falls away toward the camera.
    for (let y = top + 3; y < h; y += 1) {
      const tt = (y - top - 3) / Math.max(1, h - top - 3)
      if (ditherAt(x, y, tt * 1.3)) p.set(x, y, deepC)
    }
  }

  const kinds: Record<string, string> = {
    embers: 'fern',
    clear: 'pine',
    rain: 'oak',
    ash: 'wire',
    snow: 'wire'
  }
  const kind = kinds[t.weather] ?? 'rock'
  const throwaway: EnvAnchor[] = []
  for (const spot of scatter(age * 613 + 7, w, Math.round(w / 24), [kind, kind, 'rock', kind], 5, 17)) {
    drawLandmark(p, spot.kind, spot.x, topAt(spot.x) + 1, spot.size, r, 3, bodyC, spot.seed, spot.flip, throwaway)
  }
  // The bottom edge has to dissolve rather than stop. This strip ends part way
  // down the floor, and a solid dark band with a straight lower edge draws a
  // line right across the battlefield — the same fault the old fog band had,
  // one layer further forward. Dithered out, it reads as scrub thinning into
  // the dirt.
  const fadeFrom = Math.round(h * 0.6)
  for (let y = fadeFrom; y < h; y += 1) {
    const tt = (y - fadeFrom) / Math.max(1, h - fadeFrom)
    for (let x = 0; x < w; x += 1) {
      if (ditherAt(x + 1, y + 2, tt * 1.3)) p.set(x, y, 0, 0)
    }
  }

  // Tufts breaking the top edge, so the silhouette is never a clean curve.
  for (let x = 0; x < w; x += 2) {
    if (noise(x, 3) < 0.52) continue
    const top = Math.max(0, topAt(x))
    const tall = 2 + Math.round(noise(x, 4) * 5)
    for (let i = -1; i <= 1; i += 1) {
      p.line(x + i, top, x + i * 2, top - tall * (1 - Math.abs(i) * 0.4), bodyC)
    }
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
  private ground!: Phaser.GameObjects.TileSprite
  private bank!: Phaser.GameObjects.TileSprite
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
    this.add(`env:ground:${age}`, () => envGroundPix(age, ENV_LAYER_WIDTH, ENV_GROUND_HEIGHT))
    this.add(`env:bank:${age}`, () => envBankPix(age, ENV_LAYER_WIDTH, ENV_BANK_HEIGHT))
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
      .setScale(1 / RES)

    // Both cloud banks are TileSprites authored at exactly their own height and
    // wider than the viewport, so they can drift forever without a seam.
    this.cirrus = this.scene.add
      .tileSprite(0, ENV_CIRRUS_Y, w, ENV_CIRRUS_HEIGHT, 'env:blank')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-995)
    this.cirrus.setTileScale(1 / RES, 1 / RES)

    this.cumulus = this.scene.add
      .tileSprite(0, ENV_CUMULUS_Y, w, ENV_CUMULUS_HEIGHT, 'env:blank')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-993)
    this.cumulus.setTileScale(1 / RES, 1 / RES)

    // Every range reaches down to the ground line. Staggering their feet leaves
    // a horizontal seam wherever one ends and the next has not started.
    for (let d = 0; d < ENV_BAND_HEIGHTS.length; d += 1) {
      const band = this.scene.add
        .tileSprite(0, this.groundY + ENV_BAND_FOOT, w, ENV_BAND_HEIGHTS[d], 'env:blank')
        .setOrigin(0, 1)
        .setScrollFactor(0)
        .setDepth(-980 + d * 4)
      band.setTileScale(1 / RES, 1 / RES)
      this.bands.push(band)
    }

    this.ground = this.scene.add
      .tileSprite(0, this.groundY, w, ENV_GROUND_HEIGHT, 'env:blank')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-900)
    this.ground.setTileScale(1 / RES, 1 / RES)

    this.fog = this.scene.add
      .tileSprite(0, this.groundY, w, ENV_FOG_HEIGHT, 'env:blank')
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(-899)
    this.fog.setTileScale(1 / RES, 1 / RES)

    this.bank = this.scene.add
      .tileSprite(0, this.groundY + ENV_BANK_DROP, w, ENV_BANK_HEIGHT, 'env:blank')
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(760)
    this.bank.setTileScale(1 / RES, 1 / RES)

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
    this.ground.setTexture(`env:ground:${clamped}`)
    this.fog.setTexture(`env:fog:${clamped}`)
    this.bank.setTexture(`env:bank:${clamped}`)
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
      const bandTop = this.groundY + ENV_BAND_FOOT - ENV_BAND_HEIGHTS[d]
      const depth = -980 + d * 4 + 1
      for (const anchor of anchors) {
        const worldY = bandTop + anchor.y / RES
        if (anchor.kind === 'smoke' && smokeCount < MAX_SMOKE) {
          smokeCount += 1
          const image = this.scene.add
            .image(0, worldY, 'env:smoke:0')
            .setOrigin(0.34, 1)
            .setScrollFactor(0)
            .setDepth(depth)
            .setScale((anchor.scale * (0.55 + d * 0.14)) / RES)
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
            .setScale((anchor.scale * (0.5 + d * 0.22)) / RES)
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
            .setScale(1 / RES)
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
    // camera's speed. Scaling by RES is what makes the ground sit still under
    // the feet of the units standing on it.
    this.cirrus.tilePositionX = scrollX * ENV_SCROLL.cirrus * RES + this.time * 0.0016
    this.cumulus.tilePositionX = scrollX * ENV_SCROLL.cumulus * RES + this.time * 0.0042
    for (let d = 0; d < this.bands.length; d += 1) {
      this.bands[d].tilePositionX = scrollX * ENV_SCROLL.bands[d] * RES
    }
    this.fog.tilePositionX = scrollX * ENV_SCROLL.fog * RES + Math.sin(this.time / 9000) * 3
    this.ground.tilePositionX = scrollX * ENV_SCROLL.ground * RES
    this.bank.tilePositionX = scrollX * ENV_SCROLL.bank * RES

    // Anything hung off a layer has to travel with it, in screen space.
    const place = (band: number, artX: number): number => {
      const period = ENV_LAYER_WIDTH
      let x = artX / RES - scrollX * ENV_SCROLL.bands[band]
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
    this.celestial.setScale((1 + Math.sin(this.time / 2600) * 0.018) / RES)
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
    this.ground.destroy()
    this.bank.destroy()
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
