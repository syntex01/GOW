import type { TurretDef } from '../data/types'
import {
  box,
  chamfer,
  contactShadow,
  emissive,
  orb,
  rivet,
  rivetRow,
  sealPart,
  strap,
  trim
} from './anatomy'
import type { Canvas2D } from './painter'
import Pix, { ditherAt, mix, pixelNoise, ramp, tone, type Ramp } from './pixel'

/**
 * Turret emplacements.
 *
 * The old turret art was one trapezoid with three dots on it, re-tinted twelve
 * times, and a horizontal bar for a barrel. From ten feet away a ballista and a
 * tesla coil were the same object in two colours, which means the base — the
 * thing the player is looking at for the whole match — was carrying no
 * information at all.
 *
 * So every turret here gets its own *emplacement*, built around its own
 * silhouette: a tripod, a crib, a roofed tower, a torsion frame, a stone
 * parapet, a sandbag crater, a pedestal, a launcher skid, a spoked wheel, a
 * finned column, an insulator stack, a recoil sled. Read as pure black shapes
 * they are twelve different objects. That is the whole point.
 *
 * The house rules from `anatomy.ts` apply without exception: light from the
 * upper right, five tones per material out of `ramp()`, a single outline
 * post-pass through `sealPart`, and not one call into the canvas path API.
 */

// ───────────────────────────── Canvas geometry ─────────────────────────────

/**
 * Every base texture is this size. Uniformity matters more than tightness
 * here: the runtime places all twelve with one origin, so one canvas size and
 * one anchor means the placement code never has to know which turret it holds.
 */
export const TURRET_BASE_W = 36
export const TURRET_BASE_H = 34

/**
 * The origin the runtime must use for a base sprite — unchanged from the old
 * art, so the sprite still hangs off the same point on the wall.
 */
export const TURRET_BASE_ORIGIN: readonly [number, number] = [0.5, 0.7]

/** Centre column of a base texture; the emplacement is symmetric about it. */
const CX = 18
/**
 * The trunnion row. The runtime puts the barrel sprite 8 world pixels (4 art
 * pixels) above the base anchor, and the base anchor is at 0.7 * 34 = 23.8, so
 * anything that should sit *under* the gun belongs at or below this row.
 */
const MOUNT_Y = 20
/** Last row the emplacement may occupy; below this is the wall it stands on. */
const FOOT = 30

// ───────────────────────────────── Materials ─────────────────────────────────

const TIMBER = ramp(0x6f4c2c, { contrast: 1.05 })
const TIMBER_DARK = ramp(0x4e3520, { contrast: 1.0 })
const OAK = ramp(0x8a6238, { contrast: 1.0 })
const ROPE = ramp(0xb9a373, { contrast: 0.78 })
const WICKER = ramp(0xa8874e, { contrast: 0.92 })
const STONE = ramp(0x8a8378, { contrast: 0.95 })
const ROCK = ramp(0x6e6a5e, { contrast: 1.0 })
const IRON = ramp(0x59606b, { contrast: 1.3 })
const STEEL = ramp(0x7b838f, { contrast: 1.3 })
const BRASS = ramp(0xc19a45, { contrast: 1.2 })
const SHINGLE = ramp(0x7a4b38, { contrast: 1.0 })
const CERAMIC = ramp(0xd6cfbb, { contrast: 0.85 })
const SANDBAG = ramp(0x9a8a63, { contrast: 0.82 })
const DIRT = ramp(0x54452f, { contrast: 0.9 })
const COMPOSITE = ramp(0x656d7d, { contrast: 1.25 })
const DARKMETAL = ramp(0x3d434e, { contrast: 1.15 })
const CYAN = ramp(0x74f0ff, { contrast: 1.45 })
const VIOLET = ramp(0xb46bff, { contrast: 1.45 })
const HOT = ramp(0xffc45a, { contrast: 1.4 })

const grainNoise = pixelNoise(7717)
const stoneNoise = pixelNoise(3391)

// ───────────────────────────────── Helpers ─────────────────────────────────

/**
 * A structural member drawn along a vector: a leg, a post, a trail, a mast.
 *
 * Deliberately *not* `shaft`. `thickLine` stacks parallel Bresenham lines, and
 * on a 45° diagonal those three lines land on alternating pixels and the whole
 * beam comes out as a checkerboard with holes in it — which is exactly what
 * the first pass of these tripods looked like. Filling the quad instead gives a
 * solid beam at any angle, and the lit edge is chosen from the geometry so it
 * always faces the upper right.
 */
function member(p: Pix, x0: number, y0: number, x1: number, y1: number, w: number, r: Ramp): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const h = Math.max(0.9, w / 2)
  p.poly(
    [
      [x0 + nx * h, y0 + ny * h],
      [x1 + nx * h, y1 + ny * h],
      [x1 - nx * h, y1 - ny * h],
      [x0 - nx * h, y0 - ny * h]
    ],
    r[2]
  )
  // Whichever face points up and to the right is the one the sun reaches.
  const s = nx - ny > 0 ? 1 : -1
  p.line(x0 + nx * h * s, y0 + ny * h * s, x1 + nx * h * s, y1 + ny * h * s, r[3])
  p.line(x0 - nx * h * s, y0 - ny * h * s, x1 - nx * h * s, y1 - ny * h * s, r[1])
}

/** Speckle that only lands on pixels that already exist. */
function speckle(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  r: Ramp,
  noise = grainNoise,
  hi = 0.9,
  lo = 0.1
): void {
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const px = x + i
      const py = y + j
      if ((p.get(px, py) >>> 24) === 0) continue
      const n = noise(px, py)
      if (n > hi) p.set(px, py, r[3])
      else if (n < lo) p.set(px, py, r[1])
    }
  }
}

/** A run of horizontal planking, seams and all. */
function planks(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
  box(p, x, y, w, h, r)
  for (let j = 2; j < h; j += 2) p.fill(x, y + j, w, 1, r[1])
  speckle(p, x, y, w, h, r)
}

/** Coursed blockwork, offset row to row. */
function masonry(p: Pix, x: number, y: number, w: number, h: number, r: Ramp, bh = 3): void {
  p.fill(x, y, w, h, r[2])
  for (let by = 0; by < h; by += bh) {
    p.fill(x, y + by, w, 1, r[3])
    const off = (by / bh) % 2 === 0 ? 0 : 3
    for (let bx = off; bx < w; bx += 6) p.fill(x + bx, y + by, 1, Math.min(bh, h - by), r[1])
  }
  p.fill(x, y + h - 1, w, 1, r[1])
  p.fill(x, y, 1, h, r[1])
  p.fill(x + w - 1, y, 1, h, r[3])
  speckle(p, x, y, w, h, r, stoneNoise, 0.93, 0.07)
}

/** One stubby capsule of a sandbag wall. */
function bag(p: Pix, x: number, y: number, w: number, r: Ramp): void {
  p.fill(x, y, w, 3, r[2])
  p.fill(x, y, w, 1, r[3])
  p.fill(x, y + 2, w, 1, r[1])
  p.set(x, y, 0, 0)
  p.set(x + w - 1, y, 0, 0)
  p.set(x, y + 2, 0, 0)
  p.set(x + w - 1, y + 2, 0, 0)
  p.set(x + w - 1, y + 1, r[3])
  p.set(x, y + 1, r[1])
}

/** A rope binding: alternating strand pixels with a shadow beneath. */
function lashing(p: Pix, x: number, y: number, w: number): void {
  for (let i = 0; i < w; i += 1) p.set(x + i, y, i % 2 === 0 ? ROPE[3] : ROPE[1])
  p.fill(x, y + 1, w, 1, ROPE[0])
}

/** A spoked carriage wheel, seen from the side. */
function wheel(p: Pix, cx: number, cy: number, rr: number, r: Ramp, hub: Ramp): void {
  // The gaps between spokes stay *filled* rather than punched through. Erasing
  // them looks correct in isolation and then the outline post-pass wraps every
  // spoke in black and the wheel turns into a smudge.
  p.ellipse(cx, cy, rr, rr, r[1])
  for (let a = -2.3; a < 0.3; a += 0.05) {
    p.set(Math.round(cx + Math.cos(a) * (rr - 0.6)), Math.round(cy + Math.sin(a) * (rr - 0.6)), r[3])
  }
  // Interior dark, spokes bright: the other way round and the whole wheel
  // averages out to one grey disc the moment it is shown at game scale.
  p.ellipse(cx + 0.3, cy - 0.3, rr - 2, rr - 2, r[0])
  p.ellipseFrame(cx, cy, rr - 2, rr - 2, r[3])
  for (let i = 0; i < 6; i += 1) {
    const a = i * (Math.PI / 3) + 0.25
    p.line(cx, cy, cx + Math.cos(a) * (rr - 2), cy + Math.sin(a) * (rr - 2), r[4])
  }
  orb(p, cx, cy, 1.8, 1.8, hub)
}

/** A dithered energy halo, for anything that is meant to be radiating. */
function halo(p: Pix, cx: number, cy: number, rr: number, r: Ramp): void {
  for (let y = Math.round(cy - rr); y <= Math.round(cy + rr); y += 1) {
    for (let x = Math.round(cx - rr); x <= Math.round(cx + rr); x += 1) {
      const d = Math.hypot(x - cx, y - cy) / rr
      if (d > 1) continue
      if (ditherAt(x, y, (1 - d) * 0.8)) p.set(x, y, r[d < 0.5 ? 4 : 3])
    }
  }
}

/** A jagged electrical arc between two points. */
function arc(p: Pix, x0: number, y0: number, x1: number, y1: number, r: Ramp, seed: number): void {
  const n = pixelNoise(seed)
  const steps = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 2))
  let px = x0
  let py = y0
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const wobble = 1 - Math.abs(t - 0.5) * 2
    const jx = x0 + (x1 - x0) * t + (n(i, seed) - 0.5) * 2.2 * wobble
    const jy = y0 + (y1 - y0) * t + (n(i, seed + 31) - 0.5) * 3.4 * wobble
    // A dim sheath under a bright core, or the bolt reads as loose confetti.
    p.line(px, py + 1, jx, jy + 1, r[2])
    p.line(px, py, jx, jy, r[4])
    px = jx
    py = jy
  }
}

// ───────────────────────────────── Bases ─────────────────────────────────

type BaseDraw = (p: Pix, id: Ramp) => void

/** A woven basket slung in a timber tripod, river rock stacked at its feet. */
const slingPost: BaseDraw = (p, id) => {
  // Splayed tripod, meeting in a lashed head above the throwing arm.
  member(p, 19, 14, 19, 29, 2, TIMBER_DARK)
  member(p, 18, 14, 6, FOOT, 3, TIMBER)
  member(p, 18, 14, 30, FOOT, 3, TIMBER)
  member(p, 10, 27, 26, 27, 2, TIMBER_DARK)

  // The basket: a woven bowl with a rounded belly, not a slatted box. The
  // weave is a sparse diagonal lattice — alternating every pixel turned it into
  // horizontal stripes and it read as a slatted table.
  const belly = [16, 16, 15, 14, 13, 11, 9, 7, 5, 3]
  for (let i = 0; i < belly.length; i += 1) {
    const y = 19 + i
    const w = belly[i]
    const x = CX - (w >> 1)
    // Two-pixel checks, not one: a one-pixel alternation resolves as horizontal
    // stripes at this size and the basket reads as a slatted stool.
    for (let k = 0; k < w; k += 1) {
      p.set(x + k, y, (((k >> 1) + (i >> 1)) & 1) === 0 ? WICKER[3] : WICKER[2])
    }
    p.set(x, y, WICKER[0])
    p.set(x + 1, y, WICKER[1])
    p.set(x + 2, y, WICKER[1])
    p.set(x + w - 1, y, WICKER[3])
  }
  p.fill(9, 18, 18, 1, WICKER[3])
  p.fill(10, 19, 16, 1, WICKER[0])
  trim(p, 12, 22, 7, id)

  // Ammunition heaped in the mouth of the basket.
  orb(p, 12, 17, 2.6, 2, ROCK)
  orb(p, 17, 16, 2.8, 2.2, STONE)
  // Lashed tripod head.
  lashing(p, 15, 12, 7)
  lashing(p, 14, 15, 9)

  // A spare pile of river rock at the foot of the near leg.
  orb(p, 4, 29, 3.4, 2.4, ROCK)
  orb(p, 9, 29, 2.8, 2.2, STONE)
  orb(p, 6, 26, 2.8, 2.4, ROCK)
  contactShadow(p, 2, 31, 12, ROCK)
}

/** A log crane over a rock crib, counterweighted with lashed boulders. */
const boulderDrop: BaseDraw = (p, id) => {
  planks(p, 2, 29, 32, 2, TIMBER_DARK)
  // A-frame: the peak is the fulcrum the drop arm swings from.
  member(p, 10, 29, 17, 12, 3, TIMBER)
  member(p, 27, 29, 20, 12, 3, TIMBER)
  member(p, 13, 22, 24, 22, 2, TIMBER_DARK)
  lashing(p, 14, 14, 9)
  p.fill(15, 10, 7, 3, id[2])
  p.fill(15, 10, 7, 1, id[3])

  // Counterweight: boulders bound into a timber crate.
  box(p, 1, 22, 9, 8, TIMBER)
  p.fill(2, 23, 7, 6, TIMBER_DARK[0])
  orb(p, 4, 25, 2.6, 2.2, ROCK)
  orb(p, 7, 27, 2.4, 2, STONE)
  lashing(p, 1, 24, 9)
  lashing(p, 1, 28, 9)

  // The crib the next boulder is rolled into.
  box(p, 27, 24, 8, 6, TIMBER)
  p.fill(28, 25, 6, 4, TIMBER_DARK[0])
  orb(p, 30, 27, 2.8, 2.4, ROCK)
  orb(p, 33, 27, 2, 1.8, STONE)
  for (let x = 27; x < 35; x += 3) p.fill(x, 24, 1, 6, TIMBER[1])
  p.fill(27, 24, 8, 1, TIMBER[4])
  contactShadow(p, 2, 31, 32, TIMBER)
}

/** A raised platform under a shingled roof, open railing to the front. */
const archerTower: BaseDraw = (p, id) => {
  member(p, 8, FOOT, 9, 21, 3, TIMBER)
  member(p, 27, FOOT, 26, 21, 3, TIMBER)
  p.line(9, 29, 26, 23, TIMBER_DARK[2])
  p.line(26, 29, 9, 23, TIMBER_DARK[2])
  planks(p, 4, 20, 29, 3, OAK)
  p.fill(4, 20, 29, 1, OAK[4])
  contactShadow(p, 5, 23, 27, OAK)

  // Roof posts and a gabled, shingled roof over the rear half. It stops short
  // of the centre column so the bow, which is drawn behind the base, is not
  // buried under it every time the tower elevates.
  member(p, 2, MOUNT_Y, 2, 13, 2, TIMBER)
  member(p, 14, MOUNT_Y, 14, 13, 2, TIMBER)
  for (let i = 0; i < 10; i += 1) {
    const y = 4 + i
    const half = Math.round(1 + i * 0.85)
    const x0 = 7 - half
    const x1 = 7 + half
    p.fill(x0, y, x1 - x0 + 1, 1, SHINGLE[i % 3 === 0 ? 3 : 2])
    p.set(x0, y, SHINGLE[1])
    p.set(x1, y, SHINGLE[3])
  }
  p.fill(0, 13, 17, 2, SHINGLE[1])
  p.fill(0, 13, 17, 1, SHINGLE[3])
  for (let x = 1; x < 16; x += 3) p.set(x, 14, SHINGLE[0])
  p.set(7, 3, id[4])
  p.set(7, 2, id[3])

  // Front railing the archers shoot over.
  for (const rx of [23, 27, 31]) p.fill(rx, 15, 2, 5, OAK[2])
  p.fill(22, 14, 11, 2, OAK[2])
  p.fill(22, 14, 11, 1, OAK[4])
  p.fill(22, 17, 11, 1, OAK[1])
  trim(p, 21, 21, 12, id)
}

/** A heavy torsion frame: two skein posts, cross-beams and a windlass. */
const ballista: BaseDraw = (p, id) => {
  // Sledge, with the tail beam braced against the wall behind it.
  planks(p, 3, 27, 30, 4, TIMBER)
  p.poly([[29, 27], [34, 29], [34, 31], [29, 31]], TIMBER[1])

  // Two torsion posts and a lintel: an open frame the bow swings inside, so
  // the window between them has to be big enough to actually see the bow in.
  for (const px of [5, 25]) {
    box(p, px, 8, 6, 20, OAK)
    // The skein: rope wound in tight courses between iron washers.
    for (let y = 13; y < 23; y += 1) {
      p.fill(px - 1, y, 8, 1, ROPE[y % 2 === 0 ? 3 : 1])
    }
    p.fill(px - 1, 12, 8, 1, IRON[3])
    p.fill(px - 1, 23, 8, 1, IRON[2])
    p.fill(px - 1, 24, 8, 1, IRON[0])
    p.fill(px + 5, 8, 1, 20, OAK[3])
    p.fill(px, 8, 1, 20, OAK[1])
  }
  planks(p, 3, 4, 30, 4, OAK)
  p.fill(3, 4, 30, 1, OAK[4])
  contactShadow(p, 4, 8, 28, OAK)

  // Windlass drum and crank, tucked under the near post.
  orb(p, 2, 21, 2.8, 2.8, IRON)
  for (let i = 0; i < 4; i += 1) {
    const a = i * (Math.PI / 4) + 0.4
    p.line(2, 21, 2 + Math.cos(a) * 2, 21 + Math.sin(a) * 2, IRON[1])
  }
  p.line(2, 21, 0, 18, IRON[3])
  trim(p, 12, 28, 12, id)
}

/** A stone parapet with an iron swivel yoke bolted to the coping. */
const swivelGun: BaseDraw = (p, id) => {
  masonry(p, 3, 23, 30, 8, STONE, 3)
  // Coping course, slightly proud of the wall below it.
  p.fill(2, 21, 32, 2, STONE[3])
  p.fill(2, 21, 32, 1, STONE[4])
  contactShadow(p, 2, 23, 32, STONE)
  // A merlon at the rear, which is what breaks the flat top edge.
  masonry(p, 2, 15, 9, 7, STONE, 3)
  p.fill(2, 15, 9, 1, STONE[4])
  // Powder bucket and rammer leaning on the wall at the front.
  box(p, 28, 16, 6, 6, OAK)
  p.fill(28, 16, 6, 1, IRON[3])
  lashing(p, 28, 19, 6)
  member(p, 26, 21, 32, 12, 1, TIMBER)
  p.fill(31, 11, 2, 2, IRON[2])

  // The yoke: a socket, a stem and two arms cradling the gun.
  box(p, CX - 3, 21, 7, 3, IRON)
  p.fill(CX - 1, 19, 3, 3, IRON[2])
  p.fill(CX + 1, 19, 1, 3, IRON[3])
  member(p, CX, 21, CX - 4, 16, 2, IRON)
  member(p, CX, 21, CX + 4, 16, 2, IRON)
  p.set(CX - 4, 15, IRON[3])
  p.set(CX + 4, 15, IRON[4])
  trim(p, 12, 22, 12, id)
}

/** A sandbagged crater with an ammunition rack dug in beside it. */
const mortarPit: BaseDraw = (p, id) => {
  // The hole first, so the bags stack in front of it.
  p.poly([[7, 19], [29, 19], [25, FOOT], [11, FOOT]], DIRT[1])
  p.poly([[9, 21], [27, 21], [24, FOOT], [12, FOOT]], DIRT[0])
  speckle(p, 7, 19, 22, 12, DIRT, stoneNoise, 0.9, 0.25)

  // A rim of bags: high at the shoulders, open across the embrasure.
  const course = (y: number, xs: readonly number[]): void => {
    for (const x of xs) bag(p, x, y, 7, SANDBAG)
  }
  course(28, [0, 7, 14, 21, 28])
  course(25, [1, 8, 21, 27])
  course(22, [1, 8, 22, 28])
  course(19, [2, 27])
  contactShadow(p, 1, 31, 34, SANDBAG)

  // Ammunition rack: two finned bombs stood on end in a timber frame.
  box(p, 1, 15, 12, 4, TIMBER)
  p.fill(1, 15, 12, 1, TIMBER[3])
  for (const x of [3, 9]) {
    p.fill(x - 1, 10, 4, 6, IRON[2])
    p.fill(x + 2, 10, 1, 6, IRON[3])
    p.fill(x - 1, 10, 1, 6, IRON[1])
    p.poly([[x - 2, 10], [x + 0.5, 5], [x + 3, 10]], IRON[2])
    p.line(x + 0.5, 5, x + 3, 10, IRON[3])
    p.fill(x - 1, 13, 4, 1, id[3])
    p.fill(x - 2, 15, 6, 1, IRON[1])
  }
  trim(p, 15, 20, 8, id)
}

/** A riveted steel pedestal fed from a belt box. */
const autocannon: BaseDraw = (p, id) => {
  // Anchor flange, dark so the pedestal above it reads as a separate mass.
  chamfer(p, 12, 27, 15, 4, DARKMETAL)
  rivetRow(p, 13, 28, 13, 4, DARKMETAL)
  contactShadow(p, 12, 31, 15, DARKMETAL)
  // Tapered pedestal: hard shadow on the left, hard highlight on the right.
  for (let y = 26; y >= 21; y -= 1) {
    const w = Math.round(12 - (26 - y) * 0.5)
    const x = CX - (w >> 1)
    p.fill(x, y, w, 1, STEEL[2])
    p.fill(x, y, 2, 1, STEEL[0])
    p.set(x + w - 1, y, STEEL[4])
    p.set(x + w - 2, y, STEEL[3])
  }
  rivet(p, CX + 3, 23, STEEL)
  // Traverse ring with gear teeth.
  box(p, 11, 18, 15, 4, id)
  for (let x = 11; x < 26; x += 2) p.set(x, 21, tone(id[0], -0.3))
  p.fill(11, 18, 15, 1, id[4])
  p.fill(12, 19, 13, 1, id[1])

  // Ammunition can and the belt climbing out of it.
  box(p, 1, 22, 11, 9, id)
  p.fill(1, 22, 11, 1, id[4])
  p.fill(1, 24, 11, 1, id[1])
  rivetRow(p, 2, 27, 9, 4, id)
  p.fill(8, 26, 3, 3, DARKMETAL[1])
  p.fill(3, 20, 6, 2, DARKMETAL[2])
  p.fill(3, 20, 6, 1, DARKMETAL[3])
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5
    const bx = Math.round(7 + t * 5)
    const by = Math.round(20 - Math.sin(t * Math.PI) * 3)
    p.fill(bx, by, 2, 2, BRASS[2])
    p.set(bx + 1, by, BRASS[4])
    p.set(bx, by + 1, BRASS[0])
  }
  // Spent-case chute on the lit side.
  p.poly([[26, 21], [30, 25], [30, 28], [27, 24]], DARKMETAL[2])
  p.line(26, 21, 30, 25, DARKMETAL[4])
}

/** A launcher skid with a search dish on a mast. */
const samBattery: BaseDraw = (p, id) => {
  chamfer(p, 3, 27, 30, 4, COMPOSITE)
  p.fill(1, 29, 5, 2, COMPOSITE[1])
  p.fill(30, 29, 5, 2, COMPOSITE[1])
  contactShadow(p, 2, 31, 32, COMPOSITE)
  // Turntable body.
  box(p, 10, 21, 17, 7, id)
  rivetRow(p, 11, 22, 15, 4, id)
  p.fill(10, 21, 17, 1, id[4])
  strap(p, 12, 25, 13, 2, id)
  // A hatch and step on the lit side.
  box(p, 22, 23, 4, 4, COMPOSITE)
  p.fill(27, 26, 3, 1, COMPOSITE[3])

  // Mast and parabolic search dish, the thing that says "anti-air".
  p.fill(6, 14, 2, 13, STEEL[2])
  p.fill(7, 14, 1, 13, STEEL[3])
  // The dish reads far better as a tilted plate than as a carved bowl: at this
  // size a crescent just turns into a goblet. A slab at 45° with a lit face and
  // a feed horn on struts says "radar" in nine pixels of width.
  const ax = 0.66
  const ay = -0.75
  const px0 = 3
  const py0 = 17
  const px1 = 14
  const py1 = 5
  member(p, px0, py0, px1, py1, 5, STEEL)
  p.line(px0 + ax * 2.4, py0 + ay * 2.4, px1 + ax * 2.4, py1 + ay * 2.4, STEEL[4])
  p.line(px0 - ax * 2.4, py0 - ay * 2.4, px1 - ax * 2.4, py1 - ay * 2.4, STEEL[0])
  // Rim lips, curled toward the mouth so the plate reads as a dish.
  p.fill(1, 15, 4, 3, STEEL[3])
  p.fill(13, 2, 4, 3, STEEL[3])
  p.fill(1, 17, 4, 1, STEEL[0])
  p.fill(13, 4, 4, 1, STEEL[0])
  // Feed horn on its struts, out at the focus.
  const fx = Math.round((px0 + px1) / 2 + ax * 6)
  const fy = Math.round((py0 + py1) / 2 + ay * 6)
  p.line(px0 + 1, py0 - 1, fx, fy + 1, STEEL[1])
  p.line(px1 + 1, py1 + 1, fx, fy + 1, STEEL[1])
  p.fill(fx - 1, fy - 1, 3, 3, STEEL[2])
  emissive(p, fx, fy, 1.2, 1.2, HOT)
}

/** A split-trail carriage: one big spoked wheel and a spade dug in. */
const howitzer: BaseDraw = (p, id) => {
  // Split trails running back to a spade dug into the parapet. Both are drawn
  // behind the wheel: bringing the near one across the rim buried the wheel,
  // and the wheel is the read.
  member(p, 18, 25, 2, 28, 3, DARKMETAL)
  member(p, 18, 26, 3, FOOT, 3, COMPOSITE)
  p.poly([[0, 25], [5, 28], [4, 31], [0, 31]], IRON[2])
  p.line(0, 25, 5, 28, IRON[4])
  for (let x = 0; x < 10; x += 2) p.fill(x, 29 + (x % 4 === 0 ? 1 : 0), 2, 1, DIRT[1])

  // The wheel: the single most recognisable shape in the whole set.
  wheel(p, 13, 24, 6.5, DARKMETAL, STEEL)

  // Cradle carrying the trunnion, riding up and to the right of the axle.
  box(p, 16, 15, 13, 7, id)
  rivetRow(p, 17, 16, 11, 4, id)
  p.fill(16, 15, 13, 1, id[4])
  p.fill(16, 21, 13, 1, id[0])
  member(p, 14, 24, 19, 21, 3, COMPOSITE)
  orb(p, CX, MOUNT_Y, 2.6, 2.6, STEEL)
  // Recoil guard on the lit side.
  p.poly([[29, 16], [33, 18], [33, 26], [29, 23]], COMPOSITE[2])
  p.line(29, 16, 33, 18, COMPOSITE[4])
  rivet(p, 31, 20, COMPOSITE)
}

/** A slim gimbal between a fin stack and a capacitor bank. */
const laserBattery: BaseDraw = (p, id) => {
  chamfer(p, 10, 27, 17, 4, COMPOSITE)
  contactShadow(p, 10, 31, 17, COMPOSITE)
  for (let i = 0; i < 3; i += 1) p.fill(12 + i * 5, 29, 3, 1, CYAN[3])
  // Column.
  box(p, 15, 21, 7, 7, id)
  p.fill(18, 21, 1, 7, CYAN[3])
  p.fill(15, 21, 7, 1, id[4])

  // Gimbal yoke: two brackets, the pivot left clear between them.
  for (const [bx, lit] of [[12, false], [22, true]] as const) {
    box(p, bx, 16, 3, 8, COMPOSITE)
    p.fill(bx + (lit ? 2 : 0), 16, 1, 8, COMPOSITE[lit ? 3 : 1])
    rivet(p, bx + 1, 18, COMPOSITE)
  }
  p.fill(13, 23, 10, 2, COMPOSITE[2])
  p.fill(13, 23, 10, 1, COMPOSITE[3])

  // Cooling fins — a comb, which is what breaks the silhouette.
  p.fill(1, 17, 3, 12, COMPOSITE[2])
  p.fill(3, 17, 1, 12, COMPOSITE[3])
  for (let i = 0; i < 5; i += 1) {
    const y = 18 + i * 2
    p.fill(4, y, 8, 1, COMPOSITE[3])
    p.fill(4, y + 1, 8, 1, COMPOSITE[0])
    p.set(11, y, CYAN[3])
  }

  // Capacitor bank: two fat cans with a gap between, so they read as cans.
  for (const x of [26, 31]) {
    p.fill(x, 20, 4, 11, id[2])
    p.fill(x + 3, 20, 1, 11, id[3])
    p.fill(x, 20, 1, 11, id[0])
    p.fill(x, 24, 4, 1, DARKMETAL[1])
    p.fill(x, 28, 4, 1, DARKMETAL[1])
    p.fill(x, 19, 4, 1, STEEL[3])
    emissive(p, x + 1.5, 18, 1.6, 1.2, CYAN)
  }
}

/** A ceramic insulator stack between two arcing ground rods. */
const teslaCoil: BaseDraw = (p, id) => {
  chamfer(p, 7, 26, 23, 5, COMPOSITE)
  contactShadow(p, 7, 31, 23, COMPOSITE)
  p.fill(9, 27, 19, 1, VIOLET[3])
  rivetRow(p, 9, 29, 19, 5, COMPOSITE)

  // Column of ceramic skirts.
  p.fill(16, 19, 5, 8, CERAMIC[2])
  p.fill(20, 19, 1, 8, CERAMIC[3])
  p.fill(16, 19, 1, 8, CERAMIC[1])
  for (let i = 0; i < 5; i += 1) {
    const y = 26 - i * 2
    const rx = 6 - i * 0.5
    p.ellipse(CX, y, rx, 1.4, CERAMIC[1])
    p.ellipse(CX + 0.4, y - 0.4, rx - 0.6, 1, CERAMIC[3])
  }
  p.fill(15, 18, 7, 1, IRON[2])
  p.fill(15, 18, 7, 1, IRON[3])
  p.fill(15, 19, 7, 1, IRON[0])

  // Ground rods with contact balls, and a live arc licking off each one.
  for (const rx of [4, 30]) {
    p.fill(rx, 10, 2, 16, IRON[2])
    p.fill(rx + 1, 10, 1, 16, IRON[3])
    p.fill(rx, 10, 1, 16, IRON[1])
    orb(p, rx + 0.5, 9, 2.6, 2.6, STEEL)
    p.fill(rx - 1, 24, 4, 2, id[2])
    p.fill(rx - 1, 24, 4, 1, id[3])
  }
  arc(p, 6, 8, 12, 13, VIOLET, 991)
  arc(p, 29, 8, 24, 13, VIOLET, 1277)
  emissive(p, 5, 8, 1.6, 1.6, VIOLET)
  emissive(p, 31, 8, 1.6, 1.6, VIOLET)
}

/** Twin rails on a heavy recoil sled, fed by an armoured charge line. */
const railTurret: BaseDraw = (p, id) => {
  // The sled: long, low, and the widest footprint of any turret here.
  p.poly([[0, 27], [4, 23], [31, 23], [35, 27], [35, 31], [0, 31]], DARKMETAL[2])
  p.line(4, 23, 31, 23, DARKMETAL[4])
  p.line(0, 27, 4, 23, DARKMETAL[3])
  p.line(31, 23, 35, 27, DARKMETAL[4])
  p.fill(0, 29, 36, 2, DARKMETAL[1])
  p.fill(0, 30, 36, 1, DARKMETAL[0])
  rivetRow(p, 2, 27, 32, 6, DARKMETAL)
  contactShadow(p, 0, 31, 36, DARKMETAL)

  // Recoil slides and their buffers.
  p.fill(4, 21, 28, 2, STEEL[2])
  p.fill(4, 21, 28, 1, STEEL[4])
  p.fill(4, 22, 28, 1, STEEL[0])
  for (const bx of [3, 30]) box(p, bx, 18, 3, 4, IRON)

  // Carriage, straddling the slides under the trunnion.
  box(p, 12, 15, 13, 7, id)
  rivetRow(p, 13, 16, 11, 4, id)
  p.fill(12, 15, 13, 1, id[4])
  p.fill(14, 19, 9, 1, CYAN[3])
  p.fill(14, 20, 9, 1, CYAN[0])

  // Charge line: an armoured cable looping in from the junction box.
  box(p, 0, 14, 7, 7, DARKMETAL)
  emissive(p, 3, 16, 1.8, 1.4, CYAN)
  for (let i = 0; i <= 9; i += 1) {
    const t = i / 9
    const x = 6 + t * 7
    const y = 16 - Math.sin(t * Math.PI) * 4 + t * 2
    p.fill(x, y, 2, 2, DARKMETAL[2])
    p.set(x + 1, y, DARKMETAL[4])
    if (i % 3 === 0) p.set(x, y + 1, CYAN[4])
  }
}

const BASE_DRAW: Record<string, BaseDraw> = {
  sling_post: slingPost,
  boulder_drop: boulderDrop,
  archer_tower: archerTower,
  ballista,
  swivel_gun: swivelGun,
  mortar_pit: mortarPit,
  autocannon,
  sam_battery: samBattery,
  howitzer,
  laser_battery: laserBattery,
  tesla_coil: teslaCoil,
  rail_turret: railTurret
}

/** Fallback emplacement, in case a new turret id lands before its art does. */
const genericBase: BaseDraw = (p, id) => {
  chamfer(p, 8, 24, 21, 7, id)
  rivetRow(p, 9, 26, 19, 4, id)
  box(p, 13, MOUNT_Y, 11, 4, STEEL)
  contactShadow(p, 8, 31, 21, id)
}

// ───────────────────────────────── Barrels ─────────────────────────────────

interface BarrelArt {
  p: Pix
  /** Trunnion, in integer pixels within `p`. */
  pivot: [number, number]
}

type BarrelDraw = (id: Ramp) => BarrelArt

/** A whipping arm with a leather sling and a stone in the pouch. */
const slingArm: BarrelDraw = id => {
  const p = new Pix(34, 32)
  const px = 6
  const py = 18
  // Tapered timber arm.
  for (let i = 0; i <= 21; i += 1) {
    const t = i / 21
    const x = px + i
    const y = Math.round(py - t * 6)
    const w = Math.max(1, Math.round(4 - t * 2.4))
    p.fill(x, y - (w >> 1), 1, w, TIMBER[2])
    p.set(x, y - (w >> 1), TIMBER[3])
    p.set(x, y - (w >> 1) + w - 1, TIMBER[1])
  }
  lashing(p, px, py - 2, 4)
  p.fill(px - 4, py - 3, 5, 6, id[2])
  p.fill(px - 4, py - 3, 5, 1, id[3])
  // Sling cords running back to the pouch.
  p.line(27, 12, 23, 22, ROPE[2])
  p.line(27, 12, 20, 21, ROPE[1])
  // Pouch and stone.
  p.poly([[19, 21], [24, 22], [23, 27], [19, 26]], ramp(0x7a5a38, { contrast: 0.9 })[2])
  orb(p, 21, 24, 3, 2.8, ROCK)
  return { p, pivot: [px, py] }
}

/** A log crane beam with a rope-slung boulder cradle at the tip. */
const craneArm: BarrelDraw = id => {
  const p = new Pix(36, 30)
  const px = 10
  const py = 11
  member(p, 2, 14, 31, 8, 5, TIMBER)
  speckle(p, 2, 6, 32, 12, TIMBER)
  lashing(p, px - 3, py - 3, 8)
  p.fill(px - 2, py - 1, 6, 4, id[2])
  p.fill(px - 2, py - 1, 6, 1, id[3])
  // Counterweight stub behind the fulcrum.
  box(p, 1, 10, 6, 8, ROCK)
  lashing(p, 1, 13, 6)
  // Rope and cradle at the working end.
  p.line(30, 10, 30, 18, ROPE[2])
  p.line(31, 10, 31, 18, ROPE[1])
  for (let i = 0; i < 4; i += 1) p.line(27 + i * 2, 19, 30, 25, ROPE[i % 2 === 0 ? 2 : 1])
  orb(p, 30, 23, 4.2, 4, ROCK)
  return { p, pivot: [px, py] }
}

/** A recurve bow with a nocked arrow — the archer, abstracted. */
const archerBow: BarrelDraw = id => {
  const p = new Pix(32, 34)
  const px = 9
  const py = 16
  // Limbs, curving forward at the tips.
  member(p, 10, 16, 6, 6, 3, OAK)
  member(p, 6, 6, 10, 2, 2, OAK)
  member(p, 10, 16, 6, 26, 3, OAK)
  member(p, 6, 26, 10, 30, 2, OAK)
  // Grip and string.
  p.fill(9, 12, 3, 9, id[2])
  p.fill(11, 12, 1, 9, id[3])
  p.line(10, 2, 10, 30, ROPE[3])
  // Arrow on the rest.
  p.fill(8, 16, 19, 1, TIMBER[2])
  p.fill(8, 15, 19, 1, TIMBER[3])
  p.poly([[27, 14], [30, 16], [27, 18]], STEEL[3])
  p.set(7, 15, CERAMIC[2])
  p.set(6, 15, CERAMIC[3])
  p.set(7, 17, CERAMIC[1])
  p.set(6, 17, CERAMIC[2])
  return { p, pivot: [px, py] }
}

/** A torsion bow: straight limbs, a heavy string and a bolt in the groove. */
const ballistaBow: BarrelDraw = id => {
  const p = new Pix(36, 32)
  const px = 8
  const py = 15
  // Stock with a groove down the middle.
  box(p, 2, 13, 28, 5, OAK)
  p.fill(4, 15, 24, 1, OAK[1])
  speckle(p, 2, 13, 28, 5, OAK)
  // Limbs, swept forward from the frame.
  member(p, 7, 14, 15, 2, 3, TIMBER)
  member(p, 7, 16, 15, 28, 3, TIMBER)
  p.fill(14, 1, 3, 3, IRON[2])
  p.fill(14, 27, 3, 3, IRON[2])
  // The string.
  p.line(15, 2, 15, 28, ROPE[3])
  p.line(16, 2, 16, 28, ROPE[1])
  // Iron collars where the limbs enter the frame.
  p.fill(6, 11, 4, 9, id[2])
  p.fill(9, 11, 1, 9, id[3])
  p.fill(6, 11, 4, 1, id[4])
  rivet(p, 8, 13, id)
  rivet(p, 8, 17, id)
  // The bolt, laid in the groove.
  p.fill(15, 15, 15, 1, TIMBER[3])
  p.poly([[30, 13], [34, 15], [30, 17]], STEEL[3])
  return { p, pivot: [px, py] }
}

/** Twin bell-mouthed swivel barrels on a breech block. */
const swivelBarrels: BarrelDraw = id => {
  const p = new Pix(32, 18)
  const px = 6
  const py = 9
  for (const y of [4, 10]) {
    p.fill(5, y, 20, 3, IRON[2])
    p.fill(5, y, 20, 1, IRON[3])
    p.fill(5, y + 2, 20, 1, IRON[1])
    // Bell muzzle.
    p.poly([[24, y - 1], [29, y - 2], [29, y + 5], [24, y + 4]], IRON[2])
    p.fill(24, y - 1, 5, 1, IRON[3])
    p.fill(28, y, 1, 4, IRON[0])
    // Reinforcing ring.
    p.fill(12, y - 1, 1, 5, IRON[3])
    p.fill(13, y - 1, 1, 5, IRON[0])
  }
  // Breech block and cascabel.
  box(p, 2, 3, 6, 12, id)
  rivet(p, 4, 6, id)
  rivet(p, 4, 11, id)
  orb(p, 2, 9, 2, 2.4, IRON)
  speckle(p, 2, 2, 28, 14, IRON)
  return { p, pivot: [px, py] }
}

/**
 * A stubby mortar tube.
 *
 * Authored already canted up: the aiming code lerps to nearly horizontal when
 * a mortar has no target, and a horizontal mortar is not a mortar. Baking ~35°
 * into the texture means it sits at a plausible elevation whatever it is doing.
 */
const mortarTube: BarrelDraw = id => {
  const p = new Pix(28, 30)
  const px = 8
  const py = 22
  const dx = 0.82
  const dy = -0.57
  const nx = -dy
  const ny = dx
  const bx = 7
  const by = 23
  const mx = bx + dx * 16
  const my = by + dy * 16
  const hw = 4.6
  p.poly(
    [
      [bx + nx * hw, by + ny * hw],
      [mx + nx * hw, my + ny * hw],
      [mx - nx * hw, my - ny * hw],
      [bx - nx * hw, by - ny * hw]
    ],
    IRON[2]
  )
  // Lit along the upper-right face, shadowed on the lower-left.
  p.line(bx + nx * hw, by + ny * hw, mx + nx * hw, my + ny * hw, IRON[1])
  p.line(bx - nx * hw, by - ny * hw, mx - nx * hw, my - ny * hw, IRON[3])
  p.line(bx - nx * (hw - 1), by - ny * (hw - 1), mx - nx * (hw - 1), my - ny * (hw - 1), IRON[4])
  // Reinforce bands.
  for (const t of [5, 10]) {
    p.line(bx + dx * t + nx * hw, by + dy * t + ny * hw, bx + dx * t - nx * hw, by + dy * t - ny * hw, IRON[1])
  }
  // Bore.
  p.ellipse(mx, my, 3.4, 2.6, IRON[1])
  p.ellipse(mx - 0.4, my + 0.4, 2.4, 1.8, tone(IRON[0], -0.5))
  // Base cap and trunnion collar.
  box(p, 3, 21, 8, 6, id)
  rivetRow(p, 4, 22, 6, 3, id)
  orb(p, px, py, 2.6, 2.6, STEEL)
  return { p, pivot: [px, py] }
}

/** Twin jacketed automatic barrels with a feed tray and case chute. */
const autoBarrels: BarrelDraw = id => {
  const p = new Pix(34, 20)
  const px = 7
  const py = 10
  // Receiver.
  box(p, 2, 4, 11, 11, id)
  rivetRow(p, 3, 5, 9, 4, id)
  p.fill(4, 2, 6, 2, IRON[2])
  p.fill(4, 2, 6, 1, IRON[3])
  p.poly([[6, 15], [10, 15], [9, 19], [7, 19]], IRON[1])
  // Perforated cooling jackets.
  for (const y of [5, 11]) {
    p.fill(13, y, 15, 3, STEEL[2])
    p.fill(13, y, 15, 1, STEEL[3])
    p.fill(13, y + 2, 15, 1, STEEL[1])
    for (let x = 14; x < 27; x += 2) p.set(x, y + 1, STEEL[0])
    // Flash hider.
    p.fill(28, y - 1, 4, 5, STEEL[2])
    p.fill(28, y - 1, 4, 1, STEEL[3])
    p.fill(30, y, 1, 3, STEEL[0])
    p.fill(28, y + 3, 4, 1, STEEL[1])
  }
  return { p, pivot: [px, py] }
}

/** An angled launcher rack with two missiles on the rails. */
const samRack: BarrelDraw = id => {
  const p = new Pix(32, 26)
  const px = 6
  const py = 17
  // Yoke.
  box(p, 3, 14, 6, 7, COMPOSITE)
  rivet(p, 5, 16, COMPOSITE)
  // Rails.
  for (const off of [0, -6]) {
    p.line(6, 19 + off, 27, 11 + off, STEEL[1])
    p.line(6, 18 + off, 27, 10 + off, STEEL[3])
  }
  p.line(6, 19, 6, 12, STEEL[2])
  p.line(21, 13, 21, 7, STEEL[2])
  // Missiles.
  for (const off of [0, -6]) {
    for (let i = 0; i <= 16; i += 1) {
      const t = i / 16
      const x = Math.round(8 + t * 16)
      const y = Math.round(16 + off - t * 6)
      p.fill(x, y - 1, 1, 3, id[2])
      p.set(x, y - 1, id[3])
      p.set(x, y + 1, id[1])
    }
    p.poly([[24, 10 + off], [28, 8 + off], [25, 12 + off]], CERAMIC[3])
    p.poly([[8, 16 + off], [5, 14 + off], [8, 14 + off]], COMPOSITE[2])
    p.poly([[8, 17 + off], [5, 20 + off], [8, 19 + off]], COMPOSITE[1])
    p.set(20, 13 + off, HOT[3])
  }
  return { p, pivot: [px, py] }
}

/** A long tube with a recoil cylinder and a slotted muzzle brake. */
const howitzerTube: BarrelDraw = id => {
  const p = new Pix(36, 18)
  const px = 6
  const py = 9
  // Breech.
  box(p, 1, 3, 8, 12, id)
  rivetRow(p, 2, 4, 6, 4, id)
  p.fill(1, 3, 8, 1, id[4])
  // Recoil cylinder riding above the tube.
  p.fill(6, 3, 17, 3, STEEL[2])
  p.fill(6, 3, 17, 1, STEEL[3])
  p.fill(6, 5, 17, 1, STEEL[1])
  p.fill(22, 2, 3, 5, STEEL[2])
  p.fill(22, 2, 3, 1, STEEL[3])
  // The tube, tapering toward the muzzle.
  for (let x = 8; x < 29; x += 1) {
    const t = (x - 8) / 20
    const h = Math.round(6 - t * 1.6)
    const y = 7 + Math.round((6 - h) / 2)
    p.fill(x, y, 1, h, IRON[2])
    p.set(x, y, IRON[3])
    p.set(x, y + h - 1, IRON[1])
  }
  // Muzzle brake.
  p.fill(29, 5, 6, 9, IRON[2])
  p.fill(29, 5, 6, 1, IRON[3])
  p.fill(29, 13, 6, 1, IRON[1])
  p.fill(31, 5, 1, 9, IRON[0])
  p.fill(33, 5, 1, 9, IRON[0])
  p.fill(34, 6, 1, 7, IRON[3])
  orb(p, px, py, 2.4, 2.4, STEEL)
  return { p, pivot: [px, py] }
}

/** A slim emitter: ribbed heat sleeve, glowing core, focusing lens. */
const laserEmitter: BarrelDraw = id => {
  const p = new Pix(34, 16)
  const px = 7
  const py = 8
  chamfer(p, 2, 3, 12, 10, id)
  for (let y = 5; y < 11; y += 2) p.fill(4, y, 7, 1, COMPOSITE[1])
  p.fill(2, 3, 12, 1, id[4])
  // Emitter sleeve.
  p.fill(13, 5, 12, 6, COMPOSITE[2])
  p.fill(13, 5, 12, 1, COMPOSITE[3])
  p.fill(13, 10, 12, 1, COMPOSITE[1])
  for (const x of [15, 18, 21]) {
    p.fill(x, 4, 1, 8, COMPOSITE[3])
    p.fill(x + 1, 4, 1, 8, COMPOSITE[0])
  }
  p.fill(13, 8, 12, 1, CYAN[3])
  // Focusing collar and lens.
  p.fill(25, 4, 3, 8, COMPOSITE[2])
  p.fill(25, 4, 3, 1, COMPOSITE[3])
  emissive(p, 29, 8, 2.4, 3, CYAN)
  halo(p, 29, 8, 3.4, CYAN)
  return { p, pivot: [px, py] }
}

/** A toroid with two horns and a live arc bridging to the discharge node. */
const teslaHead: BarrelDraw = id => {
  const p = new Pix(32, 22)
  const px = 8
  const py = 11
  // Toroid, seen edge on.
  p.ellipse(px, py, 7, 4, STEEL[1])
  p.ellipse(px + 0.6, py - 0.6, 6, 3.2, STEEL[2])
  p.ellipse(px + 1, py - 1, 4.4, 2, STEEL[3])
  p.eraseEllipse(px, py, 2.4, 1.2)
  p.fill(px - 2, py - 5, 5, 2, id[2])
  p.fill(px - 2, py - 5, 5, 1, id[3])
  // Horns.
  member(p, 12, 9, 18, 7, 2, IRON)
  member(p, 12, 13, 18, 15, 2, IRON)
  orb(p, 18, 7, 2, 2, STEEL)
  orb(p, 18, 15, 2, 2, STEEL)
  // Discharge.
  arc(p, 18, 7, 26, 11, VIOLET, 613)
  arc(p, 18, 15, 26, 11, VIOLET, 757)
  halo(p, 27, 11, 4, VIOLET)
  emissive(p, 27, 11, 2, 2, VIOLET)
  return { p, pivot: [px, py] }
}

/** Twin rails with an armature between them and a hot charge gap. */
const railFork: BarrelDraw = id => {
  const p = new Pix(36, 20)
  const px = 7
  const py = 10
  // Breech housing.
  box(p, 1, 3, 11, 14, id)
  rivetRow(p, 2, 4, 9, 4, id)
  p.fill(1, 3, 11, 1, id[4])
  p.fill(3, 9, 7, 2, CYAN[3])
  p.fill(3, 11, 7, 1, CYAN[0])
  // The rails, forking apart and then closing toward the muzzle.
  for (const side of [-1, 1] as const) {
    let tipY = py
    for (let x = 11; x < 34; x += 1) {
      const t = (x - 11) / 22
      const y = Math.round(py + side * (2.5 + t * 3.5))
      tipY = y
      p.fill(x, y - 1, 1, 3, COMPOSITE[2])
      p.set(x, y - 1, COMPOSITE[3])
      p.set(x, y + 1, COMPOSITE[1])
      // The inner face of each rail glows across the gap.
      p.set(x, y - side * 2, ditherAt(x, y, 0.7) ? CYAN[4] : CYAN[3])
    }
    p.fill(33, tipY - 2, 2, 5, STEEL[2])
    p.fill(33, tipY - 2, 2, 1, STEEL[3])
  }
  // Armature sitting in the breech end of the gap.
  p.fill(12, py - 2, 5, 5, HOT[3])
  p.fill(13, py - 1, 3, 3, HOT[4])
  halo(p, 14, py, 4, HOT)
  return { p, pivot: [px, py] }
}

const BARREL_DRAW: Record<string, BarrelDraw> = {
  sling_post: slingArm,
  boulder_drop: craneArm,
  archer_tower: archerBow,
  ballista: ballistaBow,
  swivel_gun: swivelBarrels,
  mortar_pit: mortarTube,
  autocannon: autoBarrels,
  sam_battery: samRack,
  howitzer: howitzerTube,
  laser_battery: laserEmitter,
  tesla_coil: teslaHead,
  rail_turret: railFork
}

/** Fallback barrel, matched loosely to the def's declared barrel kind. */
function genericBarrel(def: TurretDef, id: Ramp): BarrelArt {
  const p = new Pix(32, 16)
  const px = 6
  const py = 8
  const long = def.barrel === 'long'
  const len = long ? 24 : 18
  p.fill(4, 6, len, 5, id[2])
  p.fill(4, 6, len, 1, id[3])
  p.fill(4, 10, len, 1, id[1])
  p.fill(4 + len - 2, 5, 3, 7, STEEL[3])
  box(p, 1, 4, 5, 9, id)
  orb(p, px, py, 2.2, 2.2, STEEL)
  return { p, pivot: [px, py] }
}

// ───────────────────────────────── Entry point ─────────────────────────────────

/**
 * Draws one turret: its emplacement, its weapon, and the point the weapon
 * rotates about.
 *
 * The base is authored facing right and mirrored at runtime for the enemy, so
 * every emplacement can be asymmetric — the roof, the dish, the ammunition box
 * and the counterweight all sit behind the gun, which is most of what makes the
 * twelve silhouettes distinguishable.
 */
export function drawTurretHi(def: TurretDef): {
  base: Canvas2D
  barrel: Canvas2D
  barrelPivot: [number, number]
} {
  const id = ramp(def.color, { contrast: 1.15, hueShift: 0.02 })
  const outline = mix(def.color, 0x140f0a, 0.55)

  const bp = new Pix(TURRET_BASE_W, TURRET_BASE_H)
  ;(BASE_DRAW[def.id] ?? genericBase)(bp, id)

  const draw = BARREL_DRAW[def.id]
  const art = draw ? draw(id) : genericBarrel(def, id)
  const [px, py] = art.pivot

  return {
    base: sealPart(bp, outline),
    barrel: sealPart(art.p, outline),
    barrelPivot: [(px + 0.5) / art.p.w, (py + 0.5) / art.p.h]
  }
}
