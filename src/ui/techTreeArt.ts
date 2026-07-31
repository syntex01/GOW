import { box, chamfer, emissive, orb, rivet, sealPart, trim } from '../gfx/anatomy'
import { BRANCH_ACCENT, type StatKey, type TechBranch, type TechNode } from '../data/tech'
import type { Canvas2D } from '../gfx/painter'
import { UI } from '../gfx/palette'
import Pix, { ditherAt, mix, pixelNoise, ramp, tone, type Ramp } from '../gfx/pixel'

/**
 * The furniture of the research screen.
 *
 * The old screen was a hundred identical rectangles joined by elbow lines: a
 * spreadsheet with a colour key. A research web is the one screen a player
 * stares at while deciding what their army *is*, and it should look like a
 * relic — an engraved bronze plate with sockets cut into it, gems set in the
 * sockets, and chain running between them.
 *
 * So there are four grades of node, and the grade is the first thing the eye
 * reads, before any text:
 *
 * - `minor`      a plain socket with a thin rim. Twenty-six of them, so they
 *                are deliberately quiet — a ring, a stone, a mark, nothing more.
 * - `notable`    a decorated ring with cardinal flanges, a stepped bezel and
 *                four cabochons. Behaviours and new units.
 * - `keystone`   heavy, filigreed, with a corona of ornament cut to the creed's
 *                own character — blades, fins, cog teeth, horns, fronds.
 * - `ascendancy` the rim of the web. A crown above, a halo behind, wings at the
 *                sides and pendants below. Five of them and they should stop you.
 *
 * ## The rules this file obeys, without exception
 *
 * 1. **Light from the upper right.** Every torus, dome, socket, spoke and boss
 *    here is shaded from one direction vector, `LIGHT`, so a rim highlight on a
 *    keystone lands in the same place as on the smallest stat socket.
 * 2. **Five tones per material**, from `ramp()`. The banding function is
 *    `bandOf`; nothing in this file picks a colour any other way, and where a
 *    band boundary would show as a hard step across a big surface it is broken
 *    with `ditherAt` rather than with a sixth tone.
 * 3. **One outline pass**, through `sealPart`, applied to the finished part.
 *    Frames compose a glow *underneath* the sealed grid so the halo never gets
 *    traced by the outline.
 * 4. **Nothing touches the canvas path API.** Every mark is `Pix` on integers.
 *
 * These are UI, drawn a good deal larger than a 30px soldier, so there is room
 * for detail the world art cannot afford — but the grid is still the grid, and
 * there is not one smooth gradient anywhere in here.
 */

// ───────────────────────────── Sizes and states ─────────────────────────────

export type NodeSize = 'minor' | 'notable' | 'keystone' | 'ascendancy'
export type NodeState = 'locked' | 'available' | 'owned'

/**
 * Every frame is a square canvas of this side, in art pixels. The consumer is
 * expected to display them at the house `PIXEL` magnification (or any integer
 * multiple), which is why the numbers look small: a keystone is 60 art pixels
 * and 120 screen pixels.
 *
 * The icon for a node comes back on a canvas of the *same* size, centred, so
 * wiring is a single stamp at the same coordinates as the frame.
 */
export const NODE_SIZE_PX: Record<NodeSize, number> = {
  minor: 26,
  notable: 42,
  keystone: 64,
  ascendancy: 92
}

/** Half-extent an emblem is drawn to inside each grade of frame. */
const ICON_S: Record<NodeSize, number> = {
  minor: 4.4,
  notable: 8,
  keystone: 11,
  ascendancy: 13.5
}

/** Thickness of a connector run, across the link. */
export const CONNECTOR_H = 9

/**
 * Behaviour nodes this deep into the web get keystone treatment; everything
 * else falls out of `kind`. A rule rather than a hand-written list, so adding a
 * node to `data/tech.ts` never silently gives it the wrong grade.
 */
const KEYSTONE_RING = 5

export function nodeSizeFor(node: TechNode): NodeSize {
  if (node.kind === 'ascension') return 'ascendancy'
  if (node.prominence) return node.prominence
  if (node.kind === 'stat') return 'minor'
  if (node.kind === 'unit') return 'notable'
  if (node.id === 'collapse') return 'keystone'
  return node.ring >= KEYSTONE_RING ? 'keystone' : 'notable'
}

// ─────────────────────────────── The light ───────────────────────────────

/**
 * The one light vector. Upper right, tilted toward the viewer so a surface
 * facing straight out still catches something.
 */
const LX = 0.62
const LY = -0.62
const LZ = 0.48

/** Band edges: four thresholds cutting the lambert term into five tones. */
const BANDS = [-0.5, -0.02, 0.42, 0.78]

function bandOf(v: number): number {
  let i = 0
  while (i < 4 && v > BANDS[i]) i += 1
  return i
}

/**
 * The same banding, with the boundary between two tones broken by the ordered
 * matrix. On a 60px keystone rim a hard band edge reads as a contour line;
 * three pixels of dither along it reads as metal.
 */
function bandDitherOf(v: number, x: number, y: number): number {
  const i = bandOf(v)
  if (i >= 4) return 4
  const lo = i === 0 ? -1.4 : BANDS[i - 1]
  const f = (v - lo) / Math.max(0.001, BANDS[i] - lo)
  return f > 0.55 && ditherAt(x, y, (f - 0.55) * 2.2) ? i + 1 : i
}

// ───────────────────────────── Shaded solids ─────────────────────────────

interface SurfaceOpts {
  /** Reverse the cross-section so the form reads as a groove, not a bead. */
  concave?: boolean
  /** Break band edges with the ordered matrix. */
  dither?: boolean
  /** Push the whole surface up or down the ramp. */
  bias?: number
}

/**
 * A ring of raised metal — the workhorse of every frame here.
 *
 * Shaded as a torus: the cross-section rolls from facing inward at the inner
 * edge, through facing the viewer at the crown, to facing outward at the rim,
 * and the lambert term against `LIGHT` is banded into the material's five tones.
 * That single piece of maths is what makes a flat annulus read as a cast rim.
 */
function torus(p: Pix, cx: number, cy: number, rOut: number, rIn: number, r: Ramp, opts: SurfaceOpts = {}): void {
  const bias = opts.bias ?? 0
  const span = Math.max(0.001, rOut - rIn)
  const y0 = Math.floor(cy - rOut)
  const y1 = Math.ceil(cy + rOut)
  const x0 = Math.floor(cx - rOut)
  const x1 = Math.ceil(cx + rOut)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d >= rOut || d < rIn) continue
      const t = (d - rIn) / span
      const phi = (t - 0.5) * Math.PI
      const nx = dx / (d || 1)
      const ny = dy / (d || 1)
      let v = Math.sin(phi) * (nx * LX + ny * LY) + Math.cos(phi) * LZ
      if (opts.concave) v = -v + 0.22
      v += bias
      p.set(x, y, r[opts.dither ? bandDitherOf(v, x, y) : bandOf(v)])
    }
  }
}

/**
 * A dish cut into the plate. The wall away from the light catches it, which is
 * the whole reason a socket reads as a hole and a boss reads as a lump: the
 * highlight is on the *opposite* side from a raised form.
 */
function socket(p: Pix, cx: number, cy: number, r: number, m: Ramp, opts: SurfaceOpts = {}): void {
  const bias = opts.bias ?? 0
  const y0 = Math.floor(cy - r)
  const y1 = Math.ceil(cy + r)
  const x0 = Math.floor(cx - r)
  const x1 = Math.ceil(cx + r)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d >= r) continue
      const t = d / r
      const wall = t * t
      const nx = dx / (d || 1)
      const ny = dy / (d || 1)
      const v = -(nx * LX + ny * LY) * wall + LZ * (1 - wall) - 0.78 + bias
      p.set(x, y, m[opts.dither ? bandDitherOf(v, x, y) : bandOf(v)])
    }
  }
}

/** A raised dome — bosses, rivet heads, cabochons too big for `orb`. */
function dome(p: Pix, cx: number, cy: number, r: number, m: Ramp, opts: SurfaceOpts = {}): void {
  const bias = opts.bias ?? 0
  const y0 = Math.floor(cy - r)
  const y1 = Math.ceil(cy + r)
  const x0 = Math.floor(cx - r)
  const x1 = Math.ceil(cx + r)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - cx) / r
      const dy = (y + 0.5 - cy) / r
      const q = dx * dx + dy * dy
      if (q >= 1) continue
      const nz = Math.sqrt(1 - q)
      const v = dx * LX + dy * LY + nz * LZ + bias
      p.set(x, y, m[opts.dither ? bandDitherOf(v, x, y) : bandOf(v)])
    }
  }
}

/** One-pixel engraved arc, for filigree and etched guide lines. */
function arc(p: Pix, cx: number, cy: number, r: number, a0: number, a1: number, color: number): void {
  const steps = Math.max(4, Math.round(Math.abs(a1 - a0) * r * 1.6))
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps
    p.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), color)
  }
}

/**
 * A tapered spoke: blade, fin, tooth, ray, crown point. Filled in the base
 * tone with the edge facing the light picked out and the far edge dropped,
 * which is all the shading a three-pixel-wide ornament can carry.
 */
function spoke(
  p: Pix,
  cx: number,
  cy: number,
  ang: number,
  r0: number,
  r1: number,
  hw0: number,
  hw1: number,
  m: Ramp
): void {
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  const px = -sa
  const py = ca
  const ax = cx + ca * r0
  const ay = cy + sa * r0
  const bx = cx + ca * r1
  const by = cy + sa * r1
  p.poly(
    [
      [ax + px * hw0, ay + py * hw0],
      [bx + px * hw1, by + py * hw1],
      [bx - px * hw1, by - py * hw1],
      [ax - px * hw0, ay - py * hw0]
    ],
    m[2]
  )
  const s = px * LX + py * LY >= 0 ? 1 : -1
  p.line(ax + px * hw0 * s, ay + py * hw0 * s, bx + px * hw1 * s, by + py * hw1 * s, m[3])
  p.line(ax - px * hw0 * s, ay - py * hw0 * s, bx - px * hw1 * s, by - py * hw1 * s, m[1])
}

/**
 * A curved horn, claw or hook — a spoke swept along an arc and tapered to a
 * point. Built as one closed polygon rather than a run of thick lines, because
 * a stack of thick lines leaves a ragged silhouette that the outline pass then
 * traces into a scribble.
 */
function horn(
  p: Pix,
  cx: number,
  cy: number,
  ang: number,
  r0: number,
  r1: number,
  bend: number,
  hw: number,
  m: Ramp
): void {
  const steps = 10
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const a = ang + bend * t * t
    const rr = r0 + (r1 - r0) * t
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    const w = hw * (1 - t) ** 0.62 + 0.45
    const nx = -Math.sin(a)
    const ny = Math.cos(a)
    left.push([x + nx * w, y + ny * w])
    right.push([x - nx * w, y - ny * w])
  }
  const back = right.slice().reverse()
  p.poly(left.concat(back), m[2])
  // Whichever flank faces the light gets the highlight; the other drops a tone.
  const mid = ang + bend * 0.25
  const lit = -Math.sin(mid) * LX + Math.cos(mid) * LY >= 0
  for (let i = 1; i < left.length; i += 1) {
    p.line(left[i - 1][0], left[i - 1][1], left[i][0], left[i][1], lit ? m[3] : m[1])
    p.line(right[i - 1][0], right[i - 1][1], right[i][0], right[i][1], lit ? m[1] : m[3])
  }
}

/**
 * The glow behind a lit node. Blended rather than banded — this is the one
 * place in the file where translucency is right, because it is light in the
 * air rather than a surface, and it lives on its own grid *under* the sealed
 * frame so the outline pass never sees it.
 */
function halo(p: Pix, cx: number, cy: number, rIn: number, rOut: number, color: number, peak: number): void {
  const span = Math.max(0.001, rOut - rIn)
  for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y += 1) {
    for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d >= rOut || d < rIn) continue
      const f = 1 - (d - rIn) / span
      const a = peak * f * f
      p.blend(x, y, color, ditherAt(x, y, f) ? a : a * 0.35)
    }
  }
}

/** Runs the single outline post-pass and hands the grid back for compositing. */
function seal(p: Pix, base: number): Pix {
  sealPart(p, base)
  return p
}

// ───────────────────────────── Frame materials ─────────────────────────────

interface FrameMats {
  /** The cast body of the frame. */
  metal: Ramp
  /** Trim, filigree and the bezel — the creed's colour in the plate. */
  accent: Ramp
  /** The recess the emblem sits in. */
  well: Ramp
  /** Set stones. */
  gem: Ramp
  /** Silhouette colour for the outline pass. */
  outline: number
  /** Halo colour and strength, or null when the node is dead. */
  glow: { color: number; peak: number } | null
  /** Whether stones are lit from within. */
  alight: boolean
}

function frameMats(accentHex: number, state: NodeState): FrameMats {
  if (state === 'locked') {
    // Dead cold iron with barely any of the creed left in it. Lower contrast
    // as well as lower value: an unlit node should not have a specular at all.
    const body = mix(mix(accentHex, 0x4d5563, 0.82), 0x0a0e16, 0.28)
    const dull = mix(accentHex, 0x555c6b, 0.72)
    return {
      metal: ramp(body, { contrast: 0.7, hueShift: 0.015, shadowSat: 0.05 }),
      accent: ramp(mix(dull, 0x2c323e, 0.35), { contrast: 0.7, hueShift: 0.02 }),
      well: ramp(mix(0x0b111c, accentHex, 0.06), { contrast: 0.8 }),
      gem: ramp(mix(accentHex, 0x3a4150, 0.7), { contrast: 0.8 }),
      outline: 0x05070d,
      glow: null,
      alight: false
    }
  }
  if (state === 'available') {
    // Cleaned metal, the rim carrying the creed. Lit, but not yet claimed.
    const body = mix(0x767f92, accentHex, 0.3)
    return {
      metal: ramp(body, { contrast: 1.25, hueShift: 0.03 }),
      accent: ramp(mix(accentHex, 0xffe4b0, 0.12), { contrast: 1.3, hueShift: 0.02 }),
      well: ramp(mix(0x121a29, accentHex, 0.16), { contrast: 0.95 }),
      gem: ramp(mix(accentHex, 0x1a1020, 0.3), { contrast: 1.4, hueShift: 0 }),
      outline: 0x06090f,
      glow: { color: accentHex, peak: 0.3 },
      alight: false
    }
  }
  // Owned: gilded, the stones burning, the plate itself carrying light.
  const body = mix(0x9aa5bb, accentHex, 0.55)
  return {
    metal: ramp(mix(body, UI.gold, 0.22), { contrast: 1.35, hueShift: 0.035 }),
    accent: ramp(mix(accentHex, 0xfff0c8, 0.3), { contrast: 1.45, hueShift: 0.02 }),
    well: ramp(mix(0x1a2233, accentHex, 0.3), { contrast: 1.05 }),
    gem: ramp(mix(accentHex, 0xffffff, 0.22), { contrast: 1.5, hueShift: 0 }),
    outline: 0x07090f,
    glow: { color: mix(accentHex, 0xffffff, 0.25), peak: 0.5 },
    alight: true
  }
}

// ───────────────────────────── Frame ornament ─────────────────────────────

/** A stone set into the rim: bezel collar, cabochon, and a spark when alight. */
function cabochon(p: Pix, cx: number, cy: number, r: number, m: FrameMats): void {
  torus(p, cx, cy, r + 1.35, r - 0.2, m.metal, { bias: -0.1 })
  dome(p, cx, cy, r, m.gem, { bias: m.alight ? 0.22 : -0.16 })
  if (m.alight && r >= 2) emissive(p, cx + r * 0.18, cy - r * 0.2, r * 0.45, r * 0.45, m.gem)
}

/** A row of studs around a circle — the cheapest way to say "cast and bolted". */
function studRing(p: Pix, cx: number, cy: number, r: number, n: number, m: Ramp, phase = 0): void {
  for (let i = 0; i < n; i += 1) {
    const a = phase + (i / n) * Math.PI * 2
    rivet(p, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), m)
  }
}

/**
 * Engraved filigree inside a rim: four broken arcs with a scroll curl at each
 * break. Broken rather than continuous, because a complete circle of etching
 * reads as a manufacturing line and four arcs read as decoration.
 */
function filigree(p: Pix, cx: number, cy: number, r: number, m: Ramp, arcs = 4): void {
  const gap = 0.34
  for (let i = 0; i < arcs; i += 1) {
    const a0 = (i / arcs) * Math.PI * 2 + gap
    const a1 = ((i + 1) / arcs) * Math.PI * 2 - gap
    arc(p, cx, cy, r - 1, a0, a1, m[0])
    arc(p, cx, cy, r, a0, a1, m[4])
    arc(p, cx, cy, r + 1, a0 + 0.12, a1 - 0.12, m[3])
    arc(p, cx, cy, r + 2, a0 + 0.3, a1 - 0.3, m[1])
    // Curls at each end, turning inward.
    arc(p, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 2, a0 - 2.4, a0 + 0.5, m[4])
    arc(p, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 2, a1 - 0.5, a1 + 2.4, m[4])
  }
}

/** Speckled patina, so a large cast surface is not a flat field of one tone. */
function patina(p: Pix, cx: number, cy: number, rOut: number, rIn: number, m: Ramp, seed: number): void {
  const n = pixelNoise(seed)
  for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y += 1) {
    for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d >= rOut || d < rIn) continue
      if ((p.get(x, y) >>> 24) === 0) continue
      const v = n(x, y)
      if (v > 0.965) p.set(x, y, m[1])
      else if (v < 0.03) p.set(x, y, m[0])
    }
  }
}

/**
 * The corona of a keystone, cut to the creed's own character.
 *
 * This is where the five directions have to be legible as pure silhouette:
 * carnage throws hooked blades, ordnance bolts on fins and vents, engineering
 * is a cog, the occult grows horns, blight puts out fronds, and core — which
 * belongs to nobody — gets a plain compass rose.
 */
function keystoneCorona(p: Pix, cx: number, cy: number, r: number, branch: TechBranch, m: FrameMats): void {
  const met = m.metal
  const acc = m.accent
  switch (branch) {
    case 'carnage': {
      // Six hooked flensing blades, each with a barb swept back off its root.
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        horn(p, cx, cy, a, r * 0.82, r * 1.28, 0.46, 3.6, met)
        horn(p, cx, cy, a + 0.16, r * 0.86, r * 1.02, -0.5, 2.0, acc)
      }
      break
    }
    case 'ordnance': {
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        spoke(p, cx, cy, a, r * 0.82, r * 1.3, 4.4, 2.6, met)
        // Vent slots cut into each fin.
        for (let k = -1; k <= 1; k += 1) {
          const rr = r * 1.02 + k * 3
          p.set(Math.round(cx + Math.cos(a) * rr - Math.sin(a) * 1.6), Math.round(cy + Math.sin(a) * rr + Math.cos(a) * 1.6), acc[0])
          p.set(Math.round(cx + Math.cos(a) * rr + Math.sin(a) * 1.6), Math.round(cy + Math.sin(a) * rr - Math.cos(a) * 1.6), acc[0])
        }
      }
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2
        spoke(p, cx, cy, a, r * 0.9, r * 1.2, 1.6, 2.4, acc)
      }
      break
    }
    case 'engineering': {
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2
        spoke(p, cx, cy, a, r * 0.9, r * 1.2, 2.5, 2.0, met)
      }
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        spoke(p, cx, cy, a, r * 0.98, r * 1.32, 3.6, 3.0, acc)
        rivet(p, Math.round(cx + Math.cos(a) * r * 1.18), Math.round(cy + Math.sin(a) * r * 1.18), met)
      }
      break
    }
    case 'occult': {
      // Four pairs of horns curling away from each other, and a broken orbit.
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 - Math.PI / 2
        horn(p, cx, cy, a - 0.2, r * 0.8, r * 1.34, -0.62, 3.4, met)
        horn(p, cx, cy, a + 0.2, r * 0.8, r * 1.34, 0.62, 3.4, met)
      }
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        arc(p, cx, cy, r * 1.12, a - 0.42, a + 0.42, acc[3])
        arc(p, cx, cy, r * 1.12 + 1, a - 0.34, a + 0.34, acc[1])
        dome(p, cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12, 2, acc)
      }
      break
    }
    case 'blight': {
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 - Math.PI / 2
        const tipX = cx + Math.cos(a) * r * 1.3
        const tipY = cy + Math.sin(a) * r * 1.3
        const baseX = cx + Math.cos(a) * r * 0.86
        const baseY = cy + Math.sin(a) * r * 0.86
        p.poly(leafPoly(baseX, baseY, tipX, tipY, r * 0.22), acc[2])
        p.line(baseX, baseY, tipX, tipY, acc[4])
        p.line(baseX + 1, baseY + 1, tipX, tipY, acc[0])
      }
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 - Math.PI / 2 + Math.PI / 7
        horn(p, cx, cy, a, r * 0.88, r * 1.14, 0.5, 2.0, met)
      }
      break
    }
    default: {
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2
        const long = i % 2 === 0
        spoke(p, cx, cy, a, r * 0.86, r * (long ? 1.3 : 1.12), long ? 3.2 : 2.2, 0.8, long ? met : acc)
      }
      break
    }
  }
}

/** The crown point of an ascendancy frame, shaped to the creed. */
function crownPoint(p: Pix, cx: number, cy: number, a: number, r0: number, r1: number, branch: TechBranch, m: FrameMats): void {
  switch (branch) {
    case 'carnage':
      spoke(p, cx, cy, a, r0, r1, 3.4, 0.7, m.metal)
      spoke(p, cx, cy, a, r0, r0 + (r1 - r0) * 0.42, 4.6, 3.2, m.metal)
      break
    case 'ordnance':
      // Mirrored about the crown's centre, so the five tips lick outward.
      horn(p, cx, cy, a, r0, r1, (a + Math.PI / 2) * 0.5, 3.8, m.metal)
      break
    case 'engineering':
      spoke(p, cx, cy, a, r0, r1 - 2, 3.0, 2.0, m.metal)
      dome(p, cx + Math.cos(a) * (r1 - 1.5), cy + Math.sin(a) * (r1 - 1.5), 2.2, m.accent)
      break
    case 'occult':
      horn(p, cx, cy, a, r0, r1, a < -Math.PI / 2 ? -0.55 : 0.55, 3.4, m.metal)
      break
    case 'blight': {
      const tipX = cx + Math.cos(a) * r1
      const tipY = cy + Math.sin(a) * r1
      const bX = cx + Math.cos(a) * r0
      const bY = cy + Math.sin(a) * r0
      p.poly(leafPoly(bX, bY, tipX, tipY, (r1 - r0) * 0.42), m.metal[2])
      p.line(bX, bY, tipX, tipY, m.metal[3])
      break
    }
    default:
      spoke(p, cx, cy, a, r0, r1, 3.4, 0.9, m.metal)
      break
  }
}

/** A pointed-oval outline, the basis of every leaf, frond and eye in here. */
function leafPoly(x0: number, y0: number, x1: number, y1: number, wid: number): [number, number][] {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const left: [number, number][] = []
  const right: [number, number][] = []
  const steps = 7
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const w = Math.sin(Math.PI * t) ** 0.75 * wid
    const px = x0 + ux * len * t
    const py = y0 + uy * len * t
    left.push([px + nx * w, py + ny * w])
    right.push([px - nx * w, py - ny * w])
  }
  right.reverse()
  return left.concat(right)
}

// ──────────────────────────────── The frames ────────────────────────────────

interface FrameSpec {
  /** Outer and inner radius of the main rim. */
  rim: [number, number]
  /** A thinner bead ring just inside the rim, if the frame has one. */
  bead?: [number, number]
  /** The recess the emblem sits in. */
  wellR: number
  /** The stepped seat around the well. */
  bezel?: [number, number]
  /** Stones set into the rim: how many, how big, at what radius. */
  gems: { n: number; r: number; at: number; phase: number }
  /** Rivets around the rim. */
  studs?: { n: number; at: number; phase: number }
  /** Engraved arcs inside the rim. */
  fil?: { r: number; arcs: number }
}

const FRAME_SPEC: Record<NodeSize, FrameSpec> = {
  minor: {
    rim: [10, 7],
    wellR: 7,
    gems: { n: 1, r: 1.9, at: 8.5, phase: -Math.PI / 2 }
  },
  notable: {
    rim: [15.5, 11],
    bead: [11, 9.5],
    wellR: 9.5,
    bezel: [11, 9.2],
    gems: { n: 4, r: 2.3, at: 13.2, phase: Math.PI / 4 },
    studs: { n: 8, at: 13.2, phase: 0 },
    fil: { r: 12.8, arcs: 4 }
  },
  keystone: {
    rim: [22.5, 16.5],
    bead: [16.5, 14.5],
    wellR: 14,
    bezel: [15.5, 12.5],
    gems: { n: 4, r: 2.8, at: 19.4, phase: -Math.PI / 2 },
    studs: { n: 12, at: 19.4, phase: Math.PI / 12 },
    fil: { r: 18.4, arcs: 4 }
  },
  ascendancy: {
    rim: [28.5, 21.5],
    bead: [21.5, 19],
    wellR: 18,
    bezel: [20, 16.5],
    gems: { n: 6, r: 3.1, at: 25, phase: -Math.PI / 2 },
    studs: { n: 18, at: 25, phase: Math.PI / 18 },
    fil: { r: 23.6, arcs: 6 }
  }
}

/**
 * Everything behind the rim: the creed's corona on a keystone, the crown, halo,
 * wings and pendants on an ascendancy frame. Drawn first so the rim overlaps it.
 */
function frameBacking(p: Pix, cx: number, cy: number, size: NodeSize, branch: TechBranch, m: FrameMats): void {
  const spec = FRAME_SPEC[size]
  const rOut = spec.rim[0]
  if (size === 'notable') {
    // Four cardinal flanges — the smallest amount of ornament that reads as a
    // decorated ring rather than a washer.
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2
      spoke(p, cx, cy, a, rOut - 2, rOut + 3.4, 3.4, 2.2, m.metal)
      spoke(p, cx, cy, a, rOut + 0.5, rOut + 3.6, 1.4, 0.7, m.accent)
    }
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      spoke(p, cx, cy, a, rOut - 1, rOut + 1.8, 2.2, 1.2, m.metal)
    }
    return
  }
  if (size === 'keystone') {
    keystoneCorona(p, cx, cy, rOut, branch, m)
    return
  }
  if (size === 'ascendancy') {
    // A halo of fine alternating rays behind everything — thin, so the crown
    // and the wings still read as separate objects in front of it.
    for (let i = 0; i < 28; i += 1) {
      const a = (i / 28) * Math.PI * 2
      const long = i % 2 === 0
      spoke(p, cx, cy, a, rOut - 1, rOut + (long ? 9 : 5), long ? 1.4 : 0.9, 0.5, long ? m.metal : m.accent)
    }
    // Wings at the flanks: three swept feathers a side, longest in the middle.
    for (const side of [-1, 1]) {
      for (let k = -1; k <= 1; k += 1) {
        const a = (side < 0 ? Math.PI : 0) - side * k * 0.4
        horn(p, cx, cy, a, rOut - 3, rOut + 10.5 - Math.abs(k) * 3.5, side * k * 0.3, 3.2, m.metal)
      }
      horn(p, cx, cy, side < 0 ? Math.PI : 0, rOut - 3, rOut + 6, 0, 1.6, m.accent)
    }
    // A crown of five points across the top arc, heavy enough to sit in front.
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i - 2) * 0.46
      const h = i === 2 ? 15 : i % 2 === 0 ? 9 : 12
      crownPoint(p, cx, cy, a, rOut - 3, rOut + h, branch, m)
    }
    // Pendants below, on short chains.
    for (let i = 0; i < 3; i += 1) {
      const a = Math.PI / 2 + (i - 1) * 0.5
      const x0 = cx + Math.cos(a) * (rOut - 1)
      const y0 = cy + Math.sin(a) * (rOut - 1)
      const drop = i === 1 ? 9 : 6
      p.line(x0, y0, x0 + Math.cos(a) * drop, y0 + Math.sin(a) * drop, m.metal[1])
      p.line(x0 + 1, y0, x0 + Math.cos(a) * drop + 1, y0 + Math.sin(a) * drop, m.metal[3])
      dome(p, x0 + Math.cos(a) * (drop + 2), y0 + Math.sin(a) * (drop + 2), i === 1 ? 2.6 : 2, m.gem, {
        bias: m.alight ? 0.2 : -0.15
      })
    }
    return
  }
}

/**
 * A node frame: rim, recess, bezel, stones, ornament and — for a lit node — a
 * halo composited underneath the sealed grid.
 */
export function drawNodeFrame(
  size: NodeSize,
  branch: TechBranch,
  state: NodeState,
  accentOverride?: number
): Canvas2D {
  const accent = accentOverride ?? BRANCH_ACCENT[branch]
  const m = frameMats(accent, state)
  const spec = FRAME_SPEC[size]
  const n = NODE_SIZE_PX[size]
  const cx = n / 2
  const cy = n / 2

  const p = new Pix(n, n)
  frameBacking(p, cx, cy, size, branch, m)

  // The rim itself, then the bead inside it.
  torus(p, cx, cy, spec.rim[0], spec.rim[1], m.metal, { dither: size !== 'minor' })
  if (size !== 'minor') patina(p, cx, cy, spec.rim[0], spec.rim[1], m.metal, size === 'keystone' ? 71 : 33)
  if (spec.bead) torus(p, cx, cy, spec.bead[0], spec.bead[1], m.accent, { bias: -0.05 })
  if (spec.fil) filigree(p, cx, cy, spec.fil.r, m.accent, spec.fil.arcs)

  // The recess, and the seat around it. One engraved ring on the floor gives
  // the hole a bottom; without it a big well reads as a punched-out hole.
  socket(p, cx, cy, spec.wellR, m.well, { dither: size !== 'minor', bias: 0.16 })
  if (size !== 'minor') {
    arc(p, cx, cy, spec.wellR - 2, 0, Math.PI * 2, m.well[0])
    arc(p, cx, cy, spec.wellR - 3, Math.PI * 0.25, Math.PI * 0.95, m.well[3])
  }
  if (m.glow) halo(p, cx, cy, 0, spec.wellR, m.glow.color, m.glow.peak * 0.34)
  if (spec.bezel) torus(p, cx, cy, spec.bezel[0], spec.bezel[1], m.accent, { concave: true })

  if (spec.studs) studRing(p, cx, cy, spec.studs.at, spec.studs.n, m.metal, spec.studs.phase)
  for (let i = 0; i < spec.gems.n; i += 1) {
    const a = spec.gems.phase + (i / spec.gems.n) * Math.PI * 2
    cabochon(p, cx + Math.cos(a) * spec.gems.at, cy + Math.sin(a) * spec.gems.at, spec.gems.r, m)
  }
  // A larger stone crowning the rim of the two biggest grades.
  if (size === 'keystone' || size === 'ascendancy') {
    cabochon(p, cx, cy - spec.rim[0] - (size === 'ascendancy' ? 2 : 1), size === 'ascendancy' ? 3.6 : 3, m)
  }

  seal(p, m.outline)

  if (!m.glow) return p.toCanvas() as Canvas2D
  const out = new Pix(n, n)
  halo(out, cx, cy, spec.rim[0] - 1, n / 2, m.glow.color, m.glow.peak)
  out.stamp(p, 0, 0)
  return out.toCanvas() as Canvas2D
}

// ─────────────────────────────── Icon palette ───────────────────────────────

interface IconPal {
  bone: Ramp
  iron: Ramp
  gold: Ramp
  ember: Ramp
  flesh: Ramp
  verdant: Ramp
  murk: Ramp
  accent: Ramp
  wood: Ramp
  outline: number
}

/** Pushes a base colour toward the state's mood before it is ramped. */
function stateTint(c: number, state: NodeState): number {
  if (state === 'locked') return mix(tone(c, -0.4), 0x5a6070, 0.55)
  if (state === 'available') return tone(c, -0.06)
  return c
}

function iconPalette(accentHex: number, state: NodeState): IconPal {
  const t = (c: number): number => stateTint(c, state)
  const k = state === 'locked' ? 0.62 : 1
  return {
    bone: ramp(t(0xd8cfb4), { contrast: 0.9 * k }),
    iron: ramp(t(0x77808f), { contrast: 1.3 * k, hueShift: 0.02 }),
    gold: ramp(t(0xd8a63e), { contrast: 1.25 * k }),
    ember: ramp(t(0xe8642a), { contrast: 1.4 * k, hueShift: 0.06 }),
    flesh: ramp(t(0xa8302c), { contrast: 1.15 * k, hueShift: 0.05 }),
    verdant: ramp(t(0x6faa5c), { contrast: 1.05 * k, hueShift: 0.05 }),
    murk: ramp(t(0x2c2740), { contrast: 1.1 * k, hueShift: 0.04 }),
    accent: ramp(t(accentHex), { contrast: 1.35 * k }),
    wood: ramp(t(0x7a5230), { contrast: 1.0 * k }),
    outline: state === 'locked' ? 0x0a0d14 : 0x07090f
  }
}

// ──────────────────────────── Emblem vocabulary ────────────────────────────

type Emblem = (p: Pix, cx: number, cy: number, s: number, q: IconPal) => void

function blade(p: Pix, x0: number, y0: number, x1: number, y1: number, wid: number, m: Ramp): void {
  p.poly(leafPoly(x0, y0, x1, y1, wid), m[2])
  p.line(x0, y0, x1, y1, m[3])
  p.line(x0 - 1, y0 + 1, x1 - 1, y1 + 1, m[1])
}

function bone(p: Pix, x0: number, y0: number, x1: number, y1: number, w: number, m: Ramp): void {
  p.thickLine(x0, y0, x1, y1, Math.max(1, Math.round(w)), m[2])
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  p.line(x0 + nx, y0 + ny, x1 + nx, y1 + ny, m[3])
  for (const [ex, ey, sx, sy] of [
    [x0, y0, -dx / len, -dy / len],
    [x1, y1, dx / len, dy / len]
  ]) {
    orb(p, ex + nx * w * 0.6 + sx, ey + ny * w * 0.6 + sy, w * 0.62, w * 0.62, m)
    orb(p, ex - nx * w * 0.6 + sx, ey - ny * w * 0.6 + sy, w * 0.62, w * 0.62, m)
  }
}

function skull(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  const m = q.bone
  dome(p, cx, cy - s * 0.18, s * 0.66, m, { bias: 0.1 })
  p.poly(
    [
      [cx - s * 0.4, cy + s * 0.24],
      [cx + s * 0.4, cy + s * 0.24],
      [cx + s * 0.3, cy + s * 0.68],
      [cx - s * 0.3, cy + s * 0.68]
    ],
    m[2]
  )
  p.line(cx - s * 0.4, cy + s * 0.24, cx + s * 0.4, cy + s * 0.24, m[3])
  const er = Math.max(1, s * 0.2)
  p.ellipse(cx - s * 0.3, cy - s * 0.16, er, er * 1.1, q.murk[0])
  p.ellipse(cx + s * 0.3, cy - s * 0.16, er, er * 1.1, q.murk[0])
  p.set(Math.round(cx), Math.round(cy + s * 0.14), q.murk[0])
  for (let i = -1; i <= 1; i += 1) {
    p.line(cx + i * s * 0.22, cy + s * 0.3, cx + i * s * 0.22, cy + s * 0.62, q.murk[1])
  }
}

function drop(p: Pix, cx: number, cy: number, s: number, m: Ramp): void {
  p.poly(
    [
      [cx, cy - s],
      [cx + s * 0.62, cy + s * 0.25],
      [cx + s * 0.34, cy + s * 0.9],
      [cx - s * 0.34, cy + s * 0.9],
      [cx - s * 0.62, cy + s * 0.25]
    ],
    m[2]
  )
  orb(p, cx, cy + s * 0.22, s * 0.5, s * 0.55, m)
  p.line(cx - s * 0.5, cy + s * 0.1, cx - s * 0.2, cy - s * 0.6, m[1])
}

function flame(p: Pix, cx: number, cy: number, s: number, m: Ramp): void {
  p.poly(
    [
      [cx, cy - s * 1.05],
      [cx + s * 0.66, cy - s * 0.05],
      [cx + s * 0.72, cy + s * 0.55],
      [cx, cy + s * 0.95],
      [cx - s * 0.72, cy + s * 0.5],
      [cx - s * 0.6, cy - s * 0.15]
    ],
    m[1]
  )
  p.poly(
    [
      [cx + s * 0.06, cy - s * 0.55],
      [cx + s * 0.46, cy + s * 0.15],
      [cx + s * 0.2, cy + s * 0.72],
      [cx - s * 0.3, cy + s * 0.6],
      [cx - s * 0.36, cy + s * 0.02]
    ],
    m[3]
  )
  p.ellipse(cx + s * 0.04, cy + s * 0.3, s * 0.22, s * 0.3, m[4])
}

function shell(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  const m = q.iron
  p.poly(
    [
      [cx, cy - s],
      [cx + s * 0.36, cy - s * 0.4],
      [cx + s * 0.36, cy + s * 0.5],
      [cx - s * 0.36, cy + s * 0.5],
      [cx - s * 0.36, cy - s * 0.4]
    ],
    m[2]
  )
  p.line(cx + s * 0.34, cy - s * 0.36, cx + s * 0.34, cy + s * 0.46, m[3])
  p.line(cx - s * 0.34, cy - s * 0.36, cx - s * 0.34, cy + s * 0.46, m[1])
  trim(p, cx - s * 0.36, cy - s * 0.06, s * 0.72, q.gold)
  box(p, cx - s * 0.44, cy + s * 0.5, s * 0.88, s * 0.3, q.wood)
  // Fins.
  p.poly([[cx - s * 0.44, cy + s * 0.5], [cx - s * 0.8, cy + s * 0.95], [cx - s * 0.44, cy + s * 0.8]], m[1])
  p.poly([[cx + s * 0.44, cy + s * 0.5], [cx + s * 0.8, cy + s * 0.95], [cx + s * 0.44, cy + s * 0.8]], m[3])
}

function burst(p: Pix, cx: number, cy: number, s: number, m: Ramp, n = 8, r0 = 0.35): void {
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    spoke(p, cx, cy, a, s * r0, s * (i % 2 === 0 ? 1.05 : 0.75), 1.6, 0.5, m)
  }
  orb(p, cx, cy, s * 0.36, s * 0.36, m)
}

function gear(p: Pix, cx: number, cy: number, s: number, q: IconPal, n = 8): void {
  const m = q.iron
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2
    spoke(p, cx, cy, a, s * 0.7, s * 1.02, s * 0.2, s * 0.16, m)
  }
  torus(p, cx, cy, s * 0.82, s * 0.36, m)
  socket(p, cx, cy, s * 0.36, q.murk)
  orb(p, cx, cy, s * 0.2, s * 0.2, q.gold)
}

function bolt(p: Pix, cx: number, cy: number, s: number, m: Ramp): void {
  p.poly(
    [
      [cx + s * 0.4, cy - s],
      [cx - s * 0.55, cy + s * 0.12],
      [cx - s * 0.06, cy + s * 0.12],
      [cx - s * 0.4, cy + s],
      [cx + s * 0.6, cy - s * 0.16],
      [cx + s * 0.08, cy - s * 0.16]
    ],
    m[2]
  )
  p.line(cx + s * 0.4, cy - s, cx - s * 0.55, cy + s * 0.12, m[3])
  p.line(cx - s * 0.4, cy + s, cx + s * 0.6, cy - s * 0.16, m[1])
}

function shieldMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  const m = q.iron
  const pts: [number, number][] = [
    [cx - s * 0.72, cy - s * 0.8],
    [cx + s * 0.72, cy - s * 0.8],
    [cx + s * 0.66, cy + s * 0.25],
    [cx, cy + s],
    [cx - s * 0.66, cy + s * 0.25]
  ]
  p.poly(pts, m[2])
  p.line(cx - s * 0.72, cy - s * 0.8, cx + s * 0.72, cy - s * 0.8, m[3])
  p.line(cx + s * 0.7, cy - s * 0.78, cx + s * 0.64, cy + s * 0.25, m[3])
  p.line(cx - s * 0.7, cy - s * 0.78, cx - s * 0.64, cy + s * 0.25, m[1])
  p.line(cx - s * 0.64, cy + s * 0.25, cx, cy + s, m[1])
  orb(p, cx, cy - s * 0.1, s * 0.26, s * 0.26, q.gold)
}

function eyeMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  p.ellipse(cx, cy, s * 0.98, s * 0.62, q.bone[2])
  p.eraseEllipse(cx, cy - s * 1.05, s * 1.3, s * 0.78)
  p.eraseEllipse(cx, cy + s * 1.05, s * 1.3, s * 0.78)
  p.ellipse(cx, cy - s * 0.06, s * 0.9, s * 0.46, q.bone[3])
  orb(p, cx, cy, s * 0.4, s * 0.4, q.accent)
  p.ellipse(cx, cy, s * 0.17, s * 0.2, q.murk[0])
  p.set(Math.round(cx + s * 0.22), Math.round(cy - s * 0.2), q.bone[4])
  for (let i = -2; i <= 2; i += 1) {
    const a = -Math.PI / 2 + i * 0.34
    p.line(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.6, cx + Math.cos(a) * s * 1.35, cy + Math.sin(a) * s * 1.05, q.murk[1])
  }
}

function crescentMark(p: Pix, cx: number, cy: number, s: number, m: Ramp): void {
  p.ellipse(cx, cy, s * 0.95, s * 0.95, m[2])
  p.ellipse(cx - s * 0.1, cy - s * 0.1, s * 0.8, s * 0.8, m[3])
  p.eraseEllipse(cx + s * 0.42, cy - s * 0.22, s * 0.85, s * 0.85)
}

function starMark(p: Pix, cx: number, cy: number, s: number, m: Ramp, n = 5): void {
  const pts: [number, number][] = []
  for (let i = 0; i < n * 2; i += 1) {
    const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? s : s * 0.42
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  p.poly(pts, m[2])
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    const lit = Math.cos(a) * LX + Math.sin(a) * LY > 0
    p.line(cx, cy, cx + Math.cos(a) * s, cy + Math.sin(a) * s, lit ? m[3] : m[1])
  }
}

function sigil(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  const m = q.accent
  torus(p, cx, cy, s * 0.98, s * 0.78, m)
  for (let i = 0; i < 3; i += 1) {
    const a0 = -Math.PI / 2 + (i / 3) * Math.PI * 2
    const a1 = -Math.PI / 2 + ((i + 1) / 3) * Math.PI * 2
    p.line(cx + Math.cos(a0) * s * 0.72, cy + Math.sin(a0) * s * 0.72, cx + Math.cos(a1) * s * 0.72, cy + Math.sin(a1) * s * 0.72, m[3])
  }
  orb(p, cx, cy, s * 0.24, s * 0.24, q.gold)
  for (let i = 0; i < 3; i += 1) {
    const a = -Math.PI / 2 + (i / 3) * Math.PI * 2
    p.set(Math.round(cx + Math.cos(a) * s * 0.72), Math.round(cy + Math.sin(a) * s * 0.72), q.gold[4])
  }
}

function mushroom(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  box(p, cx - s * 0.22, cy - s * 0.05, s * 0.44, s * 0.85, q.bone)
  p.ellipse(cx, cy - s * 0.05, s * 0.92, s * 0.66, q.verdant[2])
  p.fill(cx - s, cy, s * 2, s * 1.2, 0, 0)
  p.ellipse(cx + s * 0.16, cy - s * 0.2, s * 0.62, s * 0.44, q.verdant[3])
  p.fill(cx - s, cy - s * 0.06, s * 2, s * 1.2, 0, 0)
  p.line(cx - s * 0.9, cy - s * 0.04, cx + s * 0.9, cy - s * 0.04, q.verdant[0])
  box(p, cx - s * 0.22, cy - s * 0.02, s * 0.44, s * 0.85, q.bone)
  p.set(Math.round(cx - s * 0.36), Math.round(cy - s * 0.42), q.verdant[4])
  p.set(Math.round(cx + s * 0.42), Math.round(cy - s * 0.3), q.verdant[4])
}

function leafMark(p: Pix, cx: number, cy: number, s: number, ang: number, m: Ramp): void {
  const x0 = cx - Math.cos(ang) * s * 0.9
  const y0 = cy - Math.sin(ang) * s * 0.9
  const x1 = cx + Math.cos(ang) * s * 0.9
  const y1 = cy + Math.sin(ang) * s * 0.9
  p.poly(leafPoly(x0, y0, x1, y1, s * 0.42), m[2])
  p.line(x0, y0, x1, y1, m[3])
  for (let i = 1; i < 4; i += 1) {
    const t = i / 4
    const mx = x0 + (x1 - x0) * t
    const my = y0 + (y1 - y0) * t
    const w = Math.sin(Math.PI * t) * s * 0.34
    p.line(mx, my, mx - Math.sin(ang) * w, my + Math.cos(ang) * w, m[1])
    p.line(mx, my, mx + Math.sin(ang) * w, my - Math.cos(ang) * w, m[1])
  }
}

/** Recursive branching, for roots and mycelium. */
function fork(p: Pix, x: number, y: number, ang: number, len: number, depth: number, w: number, m: Ramp): void {
  const x1 = x + Math.cos(ang) * len
  const y1 = y + Math.sin(ang) * len
  p.thickLine(x, y, x1, y1, Math.max(1, Math.round(w)), m[2])
  if (w >= 2) p.line(x, y - 1, x1, y1 - 1, m[3])
  if (depth <= 0) return
  fork(p, x1, y1, ang - 0.62, len * 0.68, depth - 1, w * 0.62, m)
  fork(p, x1, y1, ang + 0.55, len * 0.62, depth - 1, w * 0.62, m)
}

function coin(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  dome(p, cx, cy, s * 0.92, q.gold, { bias: 0.05 })
  torus(p, cx, cy, s * 0.94, s * 0.7, q.gold, { bias: -0.15 })
  socket(p, cx, cy, s * 0.42, q.gold, { bias: 0.35 })
  p.line(cx - s * 0.22, cy - s * 0.22, cx + s * 0.22, cy + s * 0.22, q.gold[4])
}

function hammerMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  p.thickLine(cx - s * 0.5, cy + s * 0.9, cx + s * 0.42, cy - s * 0.35, Math.max(1, Math.round(s * 0.28)), q.wood[2])
  p.line(cx - s * 0.5 + 1, cy + s * 0.9 - 1, cx + s * 0.42 + 1, cy - s * 0.35 - 1, q.wood[3])
  const hx = cx + s * 0.42
  const hy = cy - s * 0.5
  p.poly(
    [
      [hx - s * 0.7, hy - s * 0.34],
      [hx + s * 0.6, hy - s * 0.5],
      [hx + s * 0.6, hy + s * 0.36],
      [hx - s * 0.7, hy + s * 0.2]
    ],
    q.iron[2]
  )
  p.line(hx - s * 0.7, hy - s * 0.34, hx + s * 0.6, hy - s * 0.5, q.iron[3])
  p.line(hx - s * 0.7, hy + s * 0.2, hx + s * 0.6, hy + s * 0.36, q.iron[1])
}

function towerMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  box(p, cx - s * 0.68, cy - s * 0.5, s * 1.36, s * 1.45, q.iron)
  // Crenellations along the top.
  for (let i = -1; i <= 1; i += 1) {
    box(p, cx + i * s * 0.44 - s * 0.16, cy - s * 0.92, s * 0.34, s * 0.46, q.iron)
  }
  // A gate: arched head over a dark opening.
  p.ellipse(cx, cy + s * 0.34, s * 0.26, s * 0.26, q.murk[0])
  p.fill(cx - s * 0.26, cy + s * 0.34, s * 0.52, s * 0.62, q.murk[0])
  arc(p, cx, cy + s * 0.34, s * 0.3, -Math.PI, 0, q.iron[4])
  // Courses of masonry, staggered so it is a wall and not a grille.
  for (let row = 0; row < 3; row += 1) {
    const y = cy - s * 0.24 + row * s * 0.42
    p.line(cx - s * 0.68, y, cx + s * 0.68, y, q.iron[1])
    const off = row % 2 === 0 ? s * 0.34 : 0
    for (const d of [-1, 1]) p.line(cx + d * (s * 0.34 + off), y, cx + d * (s * 0.34 + off), y + s * 0.4, q.iron[1])
  }
}

function chevrons(p: Pix, cx: number, cy: number, s: number, m: Ramp, n = 2): void {
  const t = Math.max(2, Math.round(s * 0.34))
  for (let i = 0; i < n; i += 1) {
    const x = cx - s * 0.5 + i * s * 0.78
    p.poly(
      [
        [x, cy - s * 0.95],
        [x + s * 0.62, cy],
        [x, cy + s * 0.95],
        [x - t, cy + s * 0.95],
        [x + s * 0.62 - t, cy],
        [x - t, cy - s * 0.95]
      ],
      m[2]
    )
    p.line(x, cy - s * 0.95, x + s * 0.62, cy, m[4])
    p.line(x - t, cy - s * 0.95, x + s * 0.62 - t, cy, m[3])
    p.line(x, cy + s * 0.95, x + s * 0.62, cy, m[0])
  }
}

/** A drawn bow with the arrow nocked — reach, not damage. */
function arrowMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  arc(p, cx - s * 0.45, cy, s * 0.98, -1.15, 1.15, q.wood[2])
  arc(p, cx - s * 0.45, cy, s * 0.98 - 1, -1.05, 1.05, q.wood[3])
  const ty = Math.sin(1.15) * s * 0.98
  p.line(cx - s * 0.45 + Math.cos(1.15) * s * 0.98, cy - ty, cx - s * 0.45 + Math.cos(1.15) * s * 0.98, cy + ty, q.bone[3])
  // Shaft and head, pointing into the light.
  p.fill(cx - s * 0.85, cy - 1, s * 1.5, Math.max(1, Math.round(s * 0.16)), q.wood[2])
  p.poly(
    [
      [cx + s * 1.0, cy],
      [cx + s * 0.5, cy - s * 0.34],
      [cx + s * 0.5, cy + s * 0.34]
    ],
    q.iron[3]
  )
  for (let i = 0; i < 2; i += 1) {
    const x = cx - s * 0.8 + i * s * 0.24
    p.line(x, cy, x - s * 0.24, cy - s * 0.34, q.bone[3])
    p.line(x, cy, x - s * 0.24, cy + s * 0.34, q.bone[1])
  }
}

function plusMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  p.poly(
    [
      [cx, cy - s],
      [cx + s * 0.85, cy],
      [cx, cy + s],
      [cx - s * 0.85, cy]
    ],
    q.flesh[1]
  )
  const t = Math.max(1, Math.round(s * 0.3))
  p.fill(cx - t / 2, cy - s * 0.6, t, s * 1.2, q.bone[3])
  p.fill(cx - s * 0.55, cy - t / 2, s * 1.1, t, q.bone[3])
  p.fill(cx - t / 2, cy - s * 0.6, t, 1, q.bone[4])
}

function hourglassMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  p.poly(
    [
      [cx - s * 0.7, cy - s * 0.85],
      [cx + s * 0.7, cy - s * 0.85],
      [cx + s * 0.12, cy],
      [cx + s * 0.7, cy + s * 0.85],
      [cx - s * 0.7, cy + s * 0.85],
      [cx - s * 0.12, cy]
    ],
    q.gold[2]
  )
  p.line(cx - s * 0.7, cy - s * 0.85, cx + s * 0.7, cy - s * 0.85, q.gold[4])
  p.line(cx - s * 0.7, cy + s * 0.85, cx + s * 0.7, cy + s * 0.85, q.gold[1])
  p.poly([[cx - s * 0.44, cy - s * 0.6], [cx + s * 0.44, cy - s * 0.6], [cx, cy - s * 0.06]], q.ember[3])
  p.poly([[cx - s * 0.3, cy + s * 0.68], [cx + s * 0.3, cy + s * 0.68], [cx, cy + s * 0.2]], q.ember[2])
}

function gemMark(p: Pix, cx: number, cy: number, s: number, m: Ramp): void {
  p.poly(
    [
      [cx, cy - s],
      [cx + s * 0.8, cy - s * 0.25],
      [cx + s * 0.45, cy + s * 0.9],
      [cx - s * 0.45, cy + s * 0.9],
      [cx - s * 0.8, cy - s * 0.25]
    ],
    m[2]
  )
  p.poly([[cx, cy - s], [cx + s * 0.8, cy - s * 0.25], [cx, cy - s * 0.1], [cx - s * 0.8, cy - s * 0.25]], m[3])
  p.poly([[cx, cy - s * 0.1], [cx + s * 0.8, cy - s * 0.25], [cx + s * 0.45, cy + s * 0.9]], m[1])
  p.set(Math.round(cx + s * 0.28), Math.round(cy - s * 0.44), m[4])
}

function chalice(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  const m = q.gold
  p.poly(
    [
      [cx - s * 0.72, cy - s * 0.62],
      [cx + s * 0.72, cy - s * 0.62],
      [cx + s * 0.44, cy + s * 0.2],
      [cx - s * 0.44, cy + s * 0.2]
    ],
    m[2]
  )
  p.line(cx - s * 0.72, cy - s * 0.62, cx + s * 0.72, cy - s * 0.62, m[4])
  p.line(cx + s * 0.7, cy - s * 0.58, cx + s * 0.44, cy + s * 0.2, m[3])
  p.line(cx - s * 0.7, cy - s * 0.58, cx - s * 0.44, cy + s * 0.2, m[1])
  p.fill(cx - s * 0.62, cy - s * 0.56, s * 1.24, Math.max(1, s * 0.22), q.flesh[3])
  p.thickLine(cx, cy + s * 0.2, cx, cy + s * 0.7, Math.max(1, Math.round(s * 0.24)), m[2])
  p.fill(cx - s * 0.6, cy + s * 0.7, s * 1.2, Math.max(1, s * 0.24), m[2])
  p.fill(cx - s * 0.6, cy + s * 0.7, s * 1.2, 1, m[4])
}

function hexPlate(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  const pts: [number, number][] = []
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2
    pts.push([cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9])
  }
  p.poly(pts, q.iron[2])
  for (let i = 0; i < 6; i += 1) {
    const a0 = -Math.PI / 2 + (i / 6) * Math.PI * 2
    const a1 = -Math.PI / 2 + ((i + 1) / 6) * Math.PI * 2
    const mid = (a0 + a1) / 2
    const lit = Math.cos(mid) * LX + Math.sin(mid) * LY > 0
    p.line(
      cx + Math.cos(a0) * s * 0.9,
      cy + Math.sin(a0) * s * 0.9,
      cx + Math.cos(a1) * s * 0.9,
      cy + Math.sin(a1) * s * 0.9,
      lit ? q.iron[4] : q.iron[0]
    )
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2
    p.line(cx, cy, cx + Math.cos(a) * s * 0.72, cy + Math.sin(a) * s * 0.72, q.accent[3])
  }
  orb(p, cx, cy, s * 0.26, s * 0.26, q.accent)
}

function wallMark(p: Pix, cx: number, cy: number, s: number, q: IconPal): void {
  for (let row = 0; row < 3; row += 1) {
    const y = cy + s * 0.72 - (row + 1) * s * 0.5
    const off = row % 2 === 0 ? 0 : s * 0.3
    for (let c = -1; c <= 1; c += 1) {
      chamfer(p, cx + c * s * 0.62 + off - s * 0.3, y, s * 0.6, s * 0.46, q.bone)
      p.fill(cx + c * s * 0.62 + off - s * 0.3, y + s * 0.46 - 1, s * 0.6, 1, q.murk[0])
    }
  }
}

// ─────────────────────────── The emblems, by node ───────────────────────────

const EMBLEMS: Record<string, Emblem> = {
  // ── core ───────────────────────────────────────────────────────────────
  collapse: (p, cx, cy, s, q) => {
    // A world split. The disc is whole and a fissure runs through it.
    dome(p, cx, cy, s * 0.92, q.iron, { dither: true })
    torus(p, cx, cy, s * 0.95, s * 0.72, q.accent, { bias: -0.1 })
    let x = cx - s * 0.9
    let y = cy - s * 0.5
    for (let i = 0; i < 5; i += 1) {
      const nx = x + s * 0.4
      const ny = cy - s * 0.5 + (i % 2 === 0 ? s * 0.5 : -s * 0.12) + i * s * 0.22
      p.thickLine(x, y, nx, ny, 2, q.murk[0])
      x = nx
      y = ny
    }
    p.set(Math.round(cx), Math.round(cy - s * 0.2), q.ember[4])
  },
  field_stripping: (p, cx, cy, s, q) => {
    // A skinning knife over a full purse.
    horn(p, cx - s * 0.15, cy + s * 0.2, -Math.PI * 0.72, s * 0.3, s * 1.25, 0.55, s * 0.24, q.iron)
    p.thickLine(cx - s * 0.2, cy + s * 0.25, cx - s * 0.62, cy + s * 0.85, Math.max(2, Math.round(s * 0.26)), q.wood[2])
    p.line(cx - s * 0.12, cy + s * 0.25, cx - s * 0.54, cy + s * 0.85, q.wood[3])
    dome(p, cx + s * 0.42, cy + s * 0.48, s * 0.5, q.wood, { bias: 0.05 })
    p.fill(cx + s * 0.08, cy + s * 0.02, s * 0.7, Math.max(1, s * 0.2), q.iron[2])
    coin(p, cx + s * 0.62, cy - s * 0.05, s * 0.3, q)
  },
  powder_discipline: (p, cx, cy, s, q) => {
    box(p, cx - s * 0.55, cy - s * 0.28, s * 1.1, s * 1.22, q.wood)
    for (let i = 0; i < 2; i += 1) {
      p.fill(cx - s * 0.58, cy - s * 0.06 + i * s * 0.62, s * 1.16, Math.max(1, s * 0.16), q.iron[2])
      p.fill(cx - s * 0.58, cy - s * 0.06 + i * s * 0.62, s * 1.16, 1, q.iron[4])
    }
    p.fill(cx - s * 0.24, cy - s * 0.44, s * 0.48, s * 0.2, q.iron[2])
    horn(p, cx, cy - s * 0.4, -Math.PI * 0.62, s * 0.1, s * 0.75, 0.9, s * 0.14, q.bone)
    emissive(p, cx + s * 0.6, cy - s * 0.85, s * 0.34, s * 0.34, q.ember)
  },
  old_rites: (p, cx, cy, s, q) => {
    // The sigil, worked under an old moon.
    crescentMark(p, cx + s * 0.62, cy - s * 0.66, s * 0.38, q.bone)
    sigil(p, cx, cy + s * 0.12, s * 0.88, q)
    for (let i = 0; i < 3; i += 1) {
      const a = Math.PI / 2 + (i / 3) * Math.PI * 2
      p.set(Math.round(cx + Math.cos(a) * s * 0.46), Math.round(cy + s * 0.12 + Math.sin(a) * s * 0.46), q.accent[4])
    }
  },

  // ── carnage ────────────────────────────────────────────────────────────
  butchery: (p, cx, cy, s, q) => {
    // A cleaver, held haft-down-right: heavy blade, notched spine, bright edge.
    const bx0 = cx - s * 0.95
    const bx1 = cx + s * 0.28
    const top = cy - s * 0.85
    const bot = cy + s * 0.18
    // Haft first, so the blade overlaps its root.
    p.thickLine(cx + s * 0.3, cy + s * 0.05, cx + s * 0.92, cy + s * 0.92, Math.max(3, Math.round(s * 0.34)), q.wood[2])
    p.line(cx + s * 0.38, cy, cx + s * 1.0, cy + s * 0.87, q.wood[4])
    p.line(cx + s * 0.22, cy + s * 0.12, cx + s * 0.84, cy + s * 0.99, q.wood[0])
    orb(p, cx + s * 0.95, cy + s * 0.96, s * 0.24, s * 0.24, q.iron)
    // Blade: a true rectangle, because at this size any taper reads as a wedge.
    p.fill(bx0, top, bx1 - bx0, bot - top, q.iron[2])
    p.fill(bx0, top, bx1 - bx0, 1, q.iron[4])
    p.fill(bx0, bot - Math.max(1, s * 0.16), bx1 - bx0, Math.max(1, s * 0.16), q.iron[4])
    p.fill(bx0, bot - Math.max(1, s * 0.16) - 1, bx1 - bx0, 1, q.iron[0])
    p.fill(bx0, top + 1, 1, bot - top - 2, q.iron[1])
    // The hanging hole and the notch out of the spine.
    p.fill(cx - s * 0.02, top, Math.max(2, s * 0.26), Math.max(2, s * 0.3), 0, 0)
    p.ellipse(bx0 + s * 0.28, top + s * 0.3, Math.max(1, s * 0.14), Math.max(1, s * 0.14), q.murk[0])
    // Bolster where blade meets haft.
    p.fill(bx1 - 1, top + s * 0.16, Math.max(2, s * 0.28), bot - top - s * 0.3, q.iron[3])
    p.set(Math.round(cx - s * 0.5), Math.round(cy + s * 0.55), q.flesh[2])
    p.set(Math.round(cx - s * 0.15), Math.round(cy + s * 0.72), q.flesh[1])
  },
  bonepickers: (p, cx, cy, s, q) => {
    skull(p, cx, cy - s * 0.2, s * 0.78, q)
    bone(p, cx - s * 0.95, cy + s * 0.85, cx + s * 0.95, cy + s * 0.7, 2, q.bone)
  },
  death_throes: (p, cx, cy, s, q) => {
    // Still up, and already coming apart: a skull with both arms thrown clear
    // of it and the blood following them out.
    burst(p, cx, cy, s * 0.95, q.flesh, 8, 0.34)
    skull(p, cx, cy - s * 0.12, s * 0.7, q)
    bone(p, cx - s * 1.1, cy + s * 0.2, cx - s * 0.5, cy + s * 0.95, 2, q.bone)
    bone(p, cx + s * 1.1, cy + s * 0.15, cx + s * 0.5, cy + s * 0.95, 2, q.bone)
    drop(p, cx - s * 0.8, cy + s * 0.6, s * 0.26, q.flesh)
    drop(p, cx + s * 0.8, cy + s * 0.55, s * 0.26, q.flesh)
  },
  bone_harvest: (p, cx, cy, s, q) => {
    bone(p, cx - s * 0.9, cy + s * 0.85, cx + s * 0.85, cy - s * 0.75, 2, q.bone)
    bone(p, cx + s * 0.85, cy + s * 0.85, cx - s * 0.9, cy - s * 0.75, 2, q.bone)
    coin(p, cx, cy, s * 0.5, q)
  },
  bloodlust: (p, cx, cy, s, q) => {
    burst(p, cx, cy, s * 1.05, q.flesh, 10, 0.42)
    drop(p, cx, cy - s * 0.1, s * 0.5, q.flesh)
  },
  flenser_rite: (p, cx, cy, s, q) => {
    horn(p, cx, cy + s * 0.4, -Math.PI * 0.78, s * 0.25, s * 1.3, 0.9, 2.6, q.iron)
    horn(p, cx, cy + s * 0.4, -Math.PI * 0.22, s * 0.25, s * 1.3, -0.9, 2.6, q.iron)
    orb(p, cx, cy + s * 0.45, s * 0.3, s * 0.3, q.flesh)
    p.set(Math.round(cx), Math.round(cy + s * 0.4), q.gold[4])
  },
  plague_wind: (p, cx, cy, s, q) => {
    // A skull dragging a contagion trail behind it.
    for (let i = 0; i < 3; i += 1) {
      const r = s * (0.72 + i * 0.2)
      arc(p, cx - s * 0.1, cy, r, -2.7 + i * 0.18, 0.7 - i * 0.14, q.verdant[i === 1 ? 4 : 2])
      arc(p, cx - s * 0.1, cy, r + 1, -2.5 + i * 0.18, 0.5 - i * 0.14, q.verdant[0])
    }
    skull(p, cx + s * 0.05, cy, s * 0.62, q)
    for (const [dx, dy] of [[-1.0, -0.55], [-0.85, 0.65], [0.95, -0.75], [0.9, 0.8]]) {
      orb(p, cx + dx * s, cy + dy * s, s * 0.15, s * 0.15, q.verdant)
    }
  },
  corpse_wall: (p, cx, cy, s, q) => {
    wallMark(p, cx, cy + s * 0.2, s * 0.95, q)
    skull(p, cx, cy - s * 0.48, s * 0.58, q)
    bone(p, cx - s * 0.95, cy + s * 0.95, cx + s * 0.95, cy + s * 0.95, 2, q.bone)
  },
  necropolis: (p, cx, cy, s, q) => {
    for (let i = 0; i < 3; i += 1) {
      const w = s * (1.7 - i * 0.42)
      box(p, cx - w / 2, cy + s * 0.85 - (i + 1) * s * 0.42, w, s * 0.42, q.bone)
    }
    skull(p, cx, cy - s * 0.42, s * 0.5, q)
    for (const d of [-1, 1]) bone(p, cx + d * s * 0.85, cy + s * 0.9, cx + d * s * 1.0, cy - s * 0.2, 2, q.bone)
  },
  ascend_nekrotics: (p, cx, cy, s, q) => {
    skull(p, cx, cy + s * 0.24, s * 0.86, q)
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i - 2) * 0.46
      spoke(p, cx, cy + s * 0.3, a, s * 0.8, s * (i === 2 ? 1.5 : 1.2), 2.2, 0.6, q.gold)
    }
  },

  // ── ordnance ───────────────────────────────────────────────────────────
  ricochet: (p, cx, cy, s, q) => {
    // A shot skipping off a plate: armour plate along the foot, a fat zigzag
    // above it, and the round still travelling at the far end.
    p.fill(cx - s, cy + s * 0.72, s * 2, Math.max(2, s * 0.24), q.iron[1])
    p.fill(cx - s, cy + s * 0.72, s * 2, 1, q.iron[3])
    let x = cx - s * 0.95
    let y = cy + s * 0.6
    for (let i = 0; i < 3; i += 1) {
      const nx = x + s * 0.6
      const ny = i % 2 === 0 ? cy - s * 0.7 : cy + s * 0.6
      p.thickLine(x, y, nx, ny, 2, q.gold[3])
      p.line(x + 1, y + 1, nx + 1, ny + 1, q.gold[0])
      if (i % 2 === 1) emissive(p, nx, ny - s * 0.16, s * 0.2, s * 0.16, q.ember)
      x = nx
      y = ny
    }
    shell(p, cx + s * 0.7, cy - s * 0.5, s * 0.42, q)
  },
  shrapnel: (p, cx, cy, s, q) => {
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + 0.2
      const r = s * (0.55 + ((i * 7) % 5) * 0.11)
      spoke(p, cx, cy, a, r * 0.55, r * 1.6, 1.5, 0.5, q.iron)
    }
    emissive(p, cx, cy, s * 0.32, s * 0.32, q.ember)
  },
  incendiary: (p, cx, cy, s, q) => {
    shell(p, cx, cy + s * 0.32, s * 0.72, q)
    flame(p, cx + s * 0.05, cy - s * 0.55, s * 0.48, q.ember)
  },
  overpressure: (p, cx, cy, s, q) => {
    // A blast front, and a soldier leaving the ground over it.
    for (let i = 0; i < 3; i += 1) {
      const r = s * (0.46 + i * 0.3)
      arc(p, cx, cy + s * 0.72, r, -Math.PI + 0.15, -0.15, q.ember[i === 0 ? 4 : 3])
      arc(p, cx, cy + s * 0.72, r + 1, -Math.PI + 0.3, -0.3, q.ember[0])
    }
    p.fill(cx - s, cy + s * 0.78, s * 2, Math.max(1, s * 0.18), q.murk[1])
    emissive(p, cx, cy + s * 0.72, s * 0.3, s * 0.24, q.ember)
    // Tumbling figure, up and to the right where the light is.
    const fx = cx + s * 0.62
    const fy = cy - s * 0.6
    orb(p, fx + s * 0.3, fy - s * 0.24, s * 0.22, s * 0.22, q.bone)
    p.thickLine(fx - s * 0.34, fy + s * 0.2, fx + s * 0.24, fy - s * 0.12, Math.max(2, Math.round(s * 0.22)), q.bone[2])
    p.line(fx - s * 0.3, fy + s * 0.16, fx - s * 0.6, fy - s * 0.2, q.bone[1])
    p.line(fx - s * 0.34, fy + s * 0.24, fx - s * 0.5, fy + s * 0.66, q.bone[1])
  },
  cluster: (p, cx, cy, s, q) => {
    shell(p, cx, cy - s * 0.52, s * 0.5, q)
    for (const d of [-1, 0, 1]) {
      for (let k = 1; k <= 3; k += 1) {
        p.set(Math.round(cx + d * s * 0.24 * k), Math.round(cy + s * 0.06 + k * s * 0.16), q.gold[3])
      }
      shell(p, cx + d * s * 0.72, cy + s * 0.7, s * 0.3, q)
    }
  },
  torchbearer_doctrine: (p, cx, cy, s, q) => {
    for (const d of [-1, 1]) {
      box(p, cx + d * s * 0.42 - s * 0.24, cy - s * 0.25, s * 0.48, s * 1.15, q.iron)
      trim(p, cx + d * s * 0.42 - s * 0.24, cy + s * 0.35, s * 0.48, q.gold)
      flame(p, cx + d * s * 0.42, cy - s * 0.62, s * 0.38, q.ember)
    }
    box(p, cx - s * 0.75, cy + s * 0.55, s * 1.5, s * 0.34, q.wood)
  },
  penetrator: (p, cx, cy, s, q) => {
    for (const d of [-1, 1]) {
      box(p, cx + d * s * 0.62 - s * 0.14, cy - s * 0.85, s * 0.28, s * 1.7, q.iron)
    }
    p.poly(
      [
        [cx + s * 1.05, cy],
        [cx + s * 0.2, cy - s * 0.28],
        [cx - s * 1.0, cy - s * 0.2],
        [cx - s * 1.0, cy + s * 0.2],
        [cx + s * 0.2, cy + s * 0.28]
      ],
      q.gold[2]
    )
    p.line(cx - s, cy - s * 0.2, cx + s * 0.2, cy - s * 0.28, q.gold[4])
    p.line(cx - s, cy + s * 0.2, cx + s * 0.2, cy + s * 0.28, q.gold[0])
  },
  ashfall: (p, cx, cy, s, q) => {
    for (let i = 0; i < 7; i += 1) {
      const x = cx - s * 0.95 + (i * s * 0.32)
      const y = cy - s * 0.95 + ((i * 5) % 4) * s * 0.3
      p.set(Math.round(x), Math.round(y), q.ember[i % 2 === 0 ? 4 : 2])
      p.set(Math.round(x), Math.round(y) + 1, q.murk[1])
    }
    flame(p, cx - s * 0.5, cy + s * 0.45, s * 0.42, q.ember)
    flame(p, cx + s * 0.5, cy + s * 0.45, s * 0.36, q.ember)
    p.fill(cx - s, cy + s * 0.92, s * 2, 1, q.murk[0])
  },
  ascend_cinder: (p, cx, cy, s, q) => {
    burst(p, cx, cy, s * 1.15, q.ember, 12, 0.5)
    flame(p, cx, cy, s * 0.7, q.ember)
    torus(p, cx, cy, s * 0.62, s * 0.5, q.gold)
  },

  // ── engineering ────────────────────────────────────────────────────────
  salvage: (p, cx, cy, s, q) => {
    gear(p, cx - s * 0.28, cy - s * 0.2, s * 0.72, q, 8)
    p.thickLine(cx + s * 0.1, cy + s * 0.15, cx + s * 0.85, cy + s * 0.9, 3, q.iron[2])
    p.line(cx + s * 0.15, cy + s * 0.1, cx + s * 0.9, cy + s * 0.85, q.iron[3])
    p.poly(
      [
        [cx + s * 0.75, cy + s * 0.6],
        [cx + s * 1.05, cy + s * 0.68],
        [cx + s * 1.0, cy + s * 1.0],
        [cx + s * 0.68, cy + s * 0.92]
      ],
      q.iron[3]
    )
  },
  sappers: (p, cx, cy, s, q) => {
    // A tunnel mouth under crossed picks.
    p.ellipse(cx, cy + s * 0.9, s * 0.76, s * 0.68, q.murk[0])
    p.fill(cx - s * 0.78, cy + s * 0.9, s * 1.56, s * 0.5, q.murk[0])
    arc(p, cx, cy + s * 0.9, s * 0.88, -Math.PI, 0, q.wood[2])
    arc(p, cx, cy + s * 0.9, s * 0.8, -Math.PI, 0, q.wood[3])
    p.thickLine(cx - s * 0.8, cy - s * 0.85, cx + s * 0.6, cy + s * 0.35, 2, q.wood[2])
    p.thickLine(cx + s * 0.8, cy - s * 0.85, cx - s * 0.6, cy + s * 0.35, 2, q.wood[2])
    p.poly([[cx - s * 0.95, cy - s * 1.0], [cx - s * 0.5, cy - s * 0.95], [cx - s * 0.72, cy - s * 0.6]], q.iron[3])
    p.poly([[cx + s * 0.95, cy - s * 1.0], [cx + s * 0.5, cy - s * 0.95], [cx + s * 0.72, cy - s * 0.6]], q.iron[3])
  },
  nanite_field: (p, cx, cy, s, q) => {
    for (const [dx, dy, k] of [[0, 0, 1], [-0.9, -0.6, 0.5], [0.9, -0.55, 0.5], [-0.7, 0.85, 0.45], [0.75, 0.8, 0.45]]) {
      hexPlate(p, cx + dx * s, cy + dy * s, s * 0.42 * (k as number) * 2, q)
    }
    for (const [dx, dy] of [[-0.9, -0.6], [0.9, -0.55], [-0.7, 0.85], [0.75, 0.8]]) {
      p.line(cx, cy, cx + dx * s * 0.7, cy + dy * s * 0.7, q.accent[1])
    }
  },
  demolition: (p, cx, cy, s, q) => {
    dome(p, cx, cy + s * 0.2, s * 0.78, q.murk, { dither: true })
    box(p, cx - s * 0.2, cy - s * 0.72, s * 0.4, s * 0.34, q.iron)
    p.thickLine(cx + s * 0.05, cy - s * 0.7, cx + s * 0.55, cy - s * 1.0, 2, q.bone[2])
    emissive(p, cx + s * 0.65, cy - s * 1.05, s * 0.3, s * 0.3, q.ember)
    p.set(Math.round(cx - s * 0.3), Math.round(cy - s * 0.05), q.iron[4])
  },
  drone_forge: (p, cx, cy, s, q) => {
    // A drone: hex hull, two rotor booms, a print beam under it.
    for (const d of [-1, 1]) {
      p.thickLine(cx + d * s * 0.28, cy - s * 0.12, cx + d * s * 0.82, cy - s * 0.52, 2, q.iron[2])
      p.fill(cx + d * s * 0.82 - s * 0.5, cy - s * 0.62, s * 1.0, Math.max(2, s * 0.18), q.iron[3])
      p.fill(cx + d * s * 0.82 - s * 0.5, cy - s * 0.62 + Math.max(2, s * 0.18), s * 1.0, 1, q.iron[0])
      orb(p, cx + d * s * 0.82, cy - s * 0.56, s * 0.18, s * 0.18, q.iron)
    }
    hexPlate(p, cx, cy + s * 0.14, s * 0.6, q)
    for (let i = 1; i <= 3; i += 1) {
      const w = s * 0.14 * i
      p.fill(cx - w, cy + s * (0.62 + i * 0.12), w * 2, 1, q.accent[4 - Math.min(2, i)])
    }
  },
  emp: (p, cx, cy, s, q) => {
    torus(p, cx, cy, s * 1.0, s * 0.84, q.accent, { bias: 0.1 })
    arc(p, cx, cy, s * 0.68, -2.2, -0.6, q.accent[3])
    arc(p, cx, cy, s * 0.68, Math.PI - 2.2, Math.PI - 0.6, q.accent[3])
    bolt(p, cx, cy, s * 0.7, q.gold)
  },
  autoforge: (p, cx, cy, s, q) => {
    gear(p, cx, cy, s * 0.86, q, 10)
    for (let i = 0; i < 2; i += 1) {
      const base = i * Math.PI
      arc(p, cx, cy, s * 1.18, base + 0.35, base + Math.PI - 0.55, q.accent[3])
      const a = base + Math.PI - 0.55
      spoke(p, cx + Math.cos(a) * s * 1.18, cy + Math.sin(a) * s * 1.18, a + Math.PI / 2, 0, s * 0.4, 2.2, 0.4, q.accent)
    }
  },
  aegis: (p, cx, cy, s, q) => {
    shieldMark(p, cx, cy, s * 0.9, q)
    for (let i = 0; i < 3; i += 1) {
      const y = cy - s * 0.45 + i * s * 0.42
      torus(p, cx - s * 0.32, y, s * 0.2, s * 0.1, q.accent)
      torus(p, cx + s * 0.32, y, s * 0.2, s * 0.1, q.accent)
    }
  },
  ascend_cyborgs: (p, cx, cy, s, q) => {
    gear(p, cx, cy, s * 1.05, q, 12)
    skull(p, cx, cy, s * 0.56, q)
    p.fill(cx - s * 0.05, cy - s * 0.55, s * 0.55, Math.max(1, s * 0.22), q.accent[3])
    p.set(Math.round(cx + s * 0.17), Math.round(cy - s * 0.1), q.accent[4])
  },

  // ── occult ─────────────────────────────────────────────────────────────
  blood_pact: (p, cx, cy, s, q) => {
    chalice(p, cx, cy + s * 0.1, s * 0.88, q)
    drop(p, cx, cy - s * 0.75, s * 0.3, q.flesh)
  },
  soul_tithe: (p, cx, cy, s, q) => {
    coin(p, cx, cy + s * 0.35, s * 0.62, q)
    flame(p, cx, cy - s * 0.45, s * 0.42, q.accent)
    for (const d of [-1, 1]) p.set(Math.round(cx + d * s * 0.7), Math.round(cy - s * 0.5), q.accent[4])
  },
  evil_eye: (p, cx, cy, s, q) => eyeMark(p, cx, cy, s * 0.92, q),
  sacrament: (p, cx, cy, s, q) => {
    torus(p, cx, cy - s * 0.42, s * 0.46, s * 0.28, q.gold)
    p.fill(cx - s * 0.14, cy - s * 0.05, s * 0.28, s * 0.95, q.gold[2])
    p.fill(cx - s * 0.55, cy + s * 0.2, s * 1.1, Math.max(1, s * 0.24), q.gold[2])
    p.fill(cx - s * 0.55, cy + s * 0.2, s * 1.1, 1, q.gold[4])
    p.fill(cx - s * 0.14, cy - s * 0.05, 1, s * 0.95, q.gold[1])
    drop(p, cx, cy + s * 0.72, s * 0.26, q.flesh)
  },
  hexer_pact: (p, cx, cy, s, q) => {
    // A hexer's rod: a forked head holding a stone, and the certainty of what
    // it is pointed at coming apart in cracks below it.
    p.thickLine(cx, cy - s * 0.1, cx, cy + s * 0.98, Math.max(2, Math.round(s * 0.24)), q.wood[2])
    p.line(cx + 1, cy - s * 0.1, cx + 1, cy + s * 0.98, q.wood[4])
    horn(p, cx, cy - s * 0.16, -Math.PI * 0.82, s * 0.12, s * 0.78, 0.5, s * 0.16, q.bone)
    horn(p, cx, cy - s * 0.16, -Math.PI * 0.18, s * 0.12, s * 0.78, -0.5, s * 0.16, q.bone)
    dome(p, cx, cy - s * 0.62, s * 0.34, q.accent, { bias: 0.3 })
    emissive(p, cx + s * 0.06, cy - s * 0.7, s * 0.16, s * 0.16, q.accent)
    for (let i = -1; i <= 1; i += 1) {
      const x = cx + i * s * 0.62
      p.line(x, cy + s * 0.5, x + i * s * 0.34, cy + s * 1.0, q.accent[3])
      p.line(x, cy + s * 0.5, x + i * s * 0.5, cy + s * 0.7, q.accent[1])
    }
  },
  mind_thrall: (p, cx, cy, s, q) => {
    for (const d of [-1, 0, 1]) p.line(cx + d * s * 0.5, cy - s, cx + d * s * 0.3, cy - s * 0.25, q.bone[1])
    skull(p, cx, cy + s * 0.2, s * 0.66, q)
    orb(p, cx, cy - s * 0.95, s * 0.22, s * 0.22, q.accent)
    p.set(Math.round(cx - s * 0.3), Math.round(cy + s * 0.05), q.accent[4])
    p.set(Math.round(cx + s * 0.3), Math.round(cy + s * 0.05), q.accent[4])
  },
  black_sun: (p, cx, cy, s, q) => {
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      spoke(p, cx, cy, a, s * 0.7, s * (i % 2 === 0 ? 1.15 : 0.92), 1.4, 0.4, q.accent)
    }
    dome(p, cx, cy, s * 0.72, q.murk, { bias: -0.35, dither: true })
    torus(p, cx, cy, s * 0.74, s * 0.66, q.accent, { bias: 0.2 })
  },
  ninth_seal: (p, cx, cy, s, q) => {
    torus(p, cx, cy, s * 1.0, s * 0.86, q.accent)
    torus(p, cx, cy, s * 0.78, s * 0.7, q.accent, { bias: -0.15 })
    starMark(p, cx, cy, s * 0.62, q.gold, 5)
    for (let i = 0; i < 9; i += 1) {
      const a = -Math.PI / 2 + (i / 9) * Math.PI * 2
      p.set(Math.round(cx + Math.cos(a) * s * 0.93), Math.round(cy + Math.sin(a) * s * 0.93), q.gold[4])
    }
  },
  ascend_circle: (p, cx, cy, s, q) => {
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      spoke(p, cx, cy + s * 0.1, a, s * 0.62, s * (i % 2 === 0 ? 1.05 : 0.85), 1.3, 0.4, q.accent)
    }
    dome(p, cx, cy + s * 0.1, s * 0.64, q.murk, { bias: -0.35 })
    for (const d of [-1, 1]) horn(p, cx, cy + s * 0.1, d > 0 ? -0.85 : Math.PI + 0.85, s * 0.6, s * 1.35, d * 0.9, 2.4, q.gold)
    eyeMark(p, cx, cy + s * 0.1, s * 0.4, q)
  },

  // ── blight ─────────────────────────────────────────────────────────────
  spore_cloud: (p, cx, cy, s, q) => {
    mushroom(p, cx, cy + s * 0.2, s * 0.8, q)
    for (const [dx, dy] of [[-0.95, -0.55], [-0.5, -0.9], [0.55, -0.85], [0.98, -0.45], [0.85, 0.6], [-0.9, 0.55]]) {
      orb(p, cx + dx * s, cy + dy * s, s * 0.16, s * 0.16, q.verdant)
    }
  },
  mycelium: (p, cx, cy, s, q) => {
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2
      fork(p, cx, cy, a, s * 0.55, 2, 2, q.verdant)
    }
    orb(p, cx, cy, s * 0.28, s * 0.28, q.verdant)
  },
  rooted: (p, cx, cy, s, q) => {
    box(p, cx - s * 0.3, cy - s * 0.95, s * 0.6, s * 1.1, q.wood)
    dome(p, cx, cy - s * 0.95, s * 0.34, q.wood, { bias: 0.15 })
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI * 0.15 + (i / 3) * Math.PI * 0.7
      fork(p, cx, cy + s * 0.1, a, s * 0.55, 1, 2, q.wood)
    }
    p.fill(cx - s, cy + s * 0.1, s * 2, 1, q.verdant[1])
  },
  sporeling_bloom: (p, cx, cy, s, q) => {
    mushroom(p, cx, cy - s * 0.1, s * 0.72, q)
    for (const d of [-1, 1]) p.thickLine(cx + d * s * 0.2, cy + s * 0.4, cx + d * s * 0.72, cy + s * 0.2, 2, q.bone[2])
    p.set(Math.round(cx - s * 0.18), Math.round(cy + s * 0.35), q.murk[0])
    p.set(Math.round(cx + s * 0.18), Math.round(cy + s * 0.35), q.murk[0])
  },
  verdant_tide: (p, cx, cy, s, q) => {
    leafMark(p, cx, cy - s * 0.25, s * 0.92, -0.5, q.verdant)
    for (let i = 0; i < 2; i += 1) {
      arc(p, cx, cy + s * 1.5 + i * 0.5, s * (1.55 + i * 0.35), -2.3, -0.85, q.verdant[i === 0 ? 3 : 1])
    }
  },
  contagion: (p, cx, cy, s, q) => {
    burst(p, cx, cy, s * 1.1, q.verdant, 10, 0.45)
    skull(p, cx, cy, s * 0.52, q)
    for (const [dx, dy] of [[-0.85, -0.75], [0.9, -0.6], [0.75, 0.85]]) {
      orb(p, cx + dx * s, cy + dy * s, s * 0.15, s * 0.15, q.verdant)
    }
  },
  deep_roots: (p, cx, cy, s, q) => {
    p.thickLine(cx, cy + s * 0.15, cx, cy - s * 0.45, Math.max(2, Math.round(s * 0.28)), q.wood[2])
    for (let i = 0; i < 3; i += 1) {
      const a = -Math.PI / 2 + (i - 1) * 0.62
      fork(p, cx, cy - s * 0.4, a, s * 0.45, 1, 2, q.verdant)
    }
    p.ellipse(cx, cy - s * 0.62, s * 0.78, s * 0.42, q.verdant[2])
    p.ellipse(cx + s * 0.14, cy - s * 0.72, s * 0.5, s * 0.26, q.verdant[3])
    p.fill(cx - s, cy + s * 0.15, s * 2, 1, q.murk[1])
    for (let i = 0; i < 3; i += 1) {
      const a = Math.PI * 0.28 + (i / 2) * Math.PI * 0.44
      fork(p, cx, cy + s * 0.18, a, s * 0.5, 1, 2, q.wood)
    }
  },
  titan_seed: (p, cx, cy, s, q) => {
    p.poly(
      [
        [cx, cy - s * 1.0],
        [cx + s * 0.72, cy - s * 0.1],
        [cx + s * 0.42, cy + s * 0.92],
        [cx - s * 0.42, cy + s * 0.92],
        [cx - s * 0.72, cy - s * 0.1]
      ],
      q.wood[2]
    )
    p.line(cx, cy - s, cx + s * 0.72, cy - s * 0.1, q.wood[3])
    p.line(cx, cy - s, cx - s * 0.72, cy - s * 0.1, q.wood[1])
    for (let i = 0; i < 3; i += 1) {
      p.line(cx - s * 0.4 + i * s * 0.4, cy - s * 0.5, cx - s * 0.3 + i * s * 0.36, cy + s * 0.8, q.wood[0])
    }
    emissive(p, cx, cy + s * 0.25, s * 0.24, s * 0.4, q.verdant)
    leafMark(p, cx + s * 0.15, cy - s * 1.15, s * 0.4, -0.9, q.verdant)
  },
  ascend_bloom: (p, cx, cy, s, q) => {
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2
      const x1 = cx + Math.cos(a) * s * 1.15
      const y1 = cy + Math.sin(a) * s * 1.15
      p.poly(leafPoly(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3, x1, y1, s * 0.3), q.verdant[2])
      p.line(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3, x1, y1, q.verdant[3])
    }
    dome(p, cx, cy, s * 0.42, q.gold, { bias: 0.1 })
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2
      p.set(Math.round(cx + Math.cos(a) * s * 0.24), Math.round(cy + Math.sin(a) * s * 0.24), q.ember[4])
    }
  }
}

/** Marks for the plain multiplier nodes, one per army modifier. */
const STAT_EMBLEMS: Record<StatKey, Emblem> = {
  income: (p, cx, cy, s, q) => coin(p, cx, cy, s * 0.95, q),
  bounty: (p, cx, cy, s, q) => {
    coin(p, cx - s * 0.3, cy + s * 0.3, s * 0.6, q)
    gemMark(p, cx + s * 0.28, cy - s * 0.25, s * 0.62, q.accent)
  },
  buildSpeed: (p, cx, cy, s, q) => hammerMark(p, cx, cy, s * 0.95, q),
  unitHp: (p, cx, cy, s, q) => plusMark(p, cx, cy, s * 0.92, q),
  unitDamage: (p, cx, cy, s, q) => {
    blade(p, cx - s * 0.15, cy + s * 0.95, cx + s * 0.15, cy - s * 0.95, s * 0.3, q.iron)
    p.fill(cx - s * 0.5, cy + s * 0.5, s * 0.95, Math.max(1, s * 0.2), q.gold[2])
    p.fill(cx - s * 0.5, cy + s * 0.5, s * 0.95, 1, q.gold[4])
  },
  baseHp: (p, cx, cy, s, q) => towerMark(p, cx, cy, s * 0.92, q),
  abilityRate: (p, cx, cy, s, q) => hourglassMark(p, cx, cy, s * 0.92, q),
  unitSpeed: (p, cx, cy, s, q) => chevrons(p, cx, cy, s * 0.95, q.accent, 3),
  unitRange: (p, cx, cy, s, q) => arrowMark(p, cx, cy, s * 0.92, q),
  toughness: (p, cx, cy, s, q) => shieldMark(p, cx, cy, s * 0.92, q)
}

/** When a node has no mark of its own, its kind supplies one. */
function fallbackEmblem(node: TechNode): Emblem {
  if (node.kind === 'ascension') {
    return (p, cx, cy, s, q) => {
      for (let i = 0; i < 5; i += 1) {
        const a = -Math.PI / 2 + (i - 2) * 0.5
        spoke(p, cx, cy + s * 0.5, a, s * 0.5, s * (i === 2 ? 1.35 : 1.05), 2.2, 0.6, q.gold)
      }
      p.fill(cx - s * 0.8, cy + s * 0.4, s * 1.6, Math.max(1, s * 0.3), q.gold[2])
      p.fill(cx - s * 0.8, cy + s * 0.4, s * 1.6, 1, q.gold[4])
    }
  }
  if (node.kind === 'unit') return (p, cx, cy, s, q) => shieldMark(p, cx, cy, s * 0.92, q)
  if (node.kind === 'stat') return (p, cx, cy, s, q) => gemMark(p, cx, cy, s * 0.9, q.accent)
  return (p, cx, cy, s, q) => sigil(p, cx, cy, s * 0.92, q)
}

/**
 * The emblem for a node, on a canvas the same size as its frame so the two
 * stamp at the same coordinates.
 *
 * Every behaviour, unit and ascension node has a mark of its own — a cleaver
 * for butchery, a shell for ordnance, a spore for blight — because those are
 * the nodes a player learns by shape. The twenty-six stat nodes share ten marks
 * keyed to the modifier they move, which is the correct amount of information:
 * they *are* interchangeable, and pretending otherwise would be noise.
 */
export function drawNodeIcon(node: TechNode, state: NodeState = 'owned', accentOverride?: number): Canvas2D {
  const size = nodeSizeFor(node)
  const n = NODE_SIZE_PX[size]
  const s = ICON_S[size]
  const accent = accentOverride ?? BRANCH_ACCENT[node.branch]
  const q = iconPalette(accent, state)

  const draw: Emblem =
    EMBLEMS[node.id] ?? (node.stat ? STAT_EMBLEMS[node.stat.key] : undefined) ?? fallbackEmblem(node)

  const p = new Pix(n, n)
  draw(p, n / 2, n / 2, s, q)
  return seal(p, q.outline).toCanvas() as Canvas2D
}

// ──────────────────────────────── Connectors ────────────────────────────────

interface LinkMats {
  metal: Ramp
  rune: Ramp
  outline: number
  glow: { color: number; peak: number } | null
}

function linkMats(accentHex: number, state: NodeState): LinkMats {
  if (state === 'locked') {
    return {
      metal: ramp(mix(0x4a505d, accentHex, 0.08), { contrast: 0.72, hueShift: 0.015 }),
      rune: ramp(0x39404d, { contrast: 0.7 }),
      outline: 0x05070d,
      glow: null
    }
  }
  if (state === 'available') {
    return {
      metal: ramp(mix(0x8d7a4a, accentHex, 0.25), { contrast: 1.1, hueShift: 0.03 }),
      rune: ramp(mix(UI.gold, accentHex, 0.35), { contrast: 1.3 }),
      outline: 0x06090f,
      glow: { color: mix(UI.gold, accentHex, 0.4), peak: 0.22 }
    }
  }
  return {
    metal: ramp(mix(UI.gold, accentHex, 0.3), { contrast: 1.35, hueShift: 0.04 }),
    rune: ramp(mix(0xfff0c0, accentHex, 0.25), { contrast: 1.4 }),
    outline: 0x07090f,
    glow: { color: mix(0xffe8a8, accentHex, 0.3), peak: 0.42 }
  }
}

/** Turns a horizontal run into a vertical one, keeping the light upper-right. */
function transposeLit(src: Pix): Pix {
  const out = new Pix(src.h, src.w)
  for (let y = 0; y < src.h; y += 1) {
    for (let x = 0; x < src.w; x += 1) {
      out.data[x * out.w + (src.h - 1 - y)] = src.data[y * src.w + x]
    }
  }
  return out
}

/**
 * An ornate link between two nodes, generated at exactly the length asked for.
 *
 * Not a line. Locked runs are a dead iron chain with the links slack and one of
 * them broken; an available run is a braided bronze cable with collars; an
 * owned run is a gilded bar with runes cut into it and alight.
 *
 * The motif has a period of eight pixels and the ends carry ferrules, so any
 * length from a stub upward tiles without a seam and terminates cleanly.
 */
export function drawConnector(
  lengthPx: number,
  state: NodeState,
  branch: TechBranch = 'core',
  vertical = false
): Canvas2D {
  const accent = BRANCH_ACCENT[branch]
  const m = linkMats(accent, state)
  const L = Math.max(6, Math.round(lengthPx))
  const H = CONNECTOR_H
  const cy = (H - 1) / 2
  const p = new Pix(L, H)

  if (state === 'locked') {
    // Chain: alternating upright and flat links, one of them parted.
    const gapAt = Math.floor(L / 2 / 8) * 8 + 4
    for (let x = 2; x < L - 2; x += 8) {
      if (Math.abs(x - gapAt) < 4) continue
      torus(p, x + 2, cy, 3.4, 1.6, m.metal)
      if (x + 8 < L - 2 && Math.abs(x + 6 - gapAt) >= 4) {
        p.fill(x + 5, cy - 1, 4, 3, m.metal[1])
        p.fill(x + 5, cy - 1, 4, 1, m.metal[2])
      }
    }
  } else if (state === 'available') {
    // Braided cable: three strands, lit on top, with collars every 16.
    p.fill(0, cy - 2, L, 5, m.metal[1])
    p.fill(0, cy - 2, L, 1, m.metal[3])
    p.fill(0, cy + 2, L, 1, m.metal[0])
    for (let x = 0; x < L; x += 1) {
      const phase = (x % 6) / 6
      const y = cy + Math.round(Math.sin(phase * Math.PI * 2) * 1.4)
      p.set(x, y, m.metal[3])
      p.set(x, y + 1, m.metal[2])
      p.set(x, cy - 2, m.metal[x % 6 < 3 ? 4 : 3])
    }
    for (let x = 8; x < L - 4; x += 16) {
      box(p, x, cy - 3, 3, 7, m.metal)
      rivet(p, x + 1, cy - 1, m.metal)
    }
  } else {
    // Gilded rune bar.
    p.fill(0, cy - 3, L, 7, m.metal[2])
    p.fill(0, cy - 3, L, 1, m.metal[4])
    p.fill(0, cy - 2, L, 1, m.metal[3])
    p.fill(0, cy + 3, L, 1, m.metal[0])
    p.fill(0, cy + 2, L, 1, m.metal[1])
    for (let x = 4; x < L - 3; x += 8) {
      // A cut rune: three strokes, always the same three, alight.
      p.fill(x, cy - 1, 1, 3, m.rune[4])
      p.set(x + 2, cy - 1, m.rune[4])
      p.set(x + 2, cy + 1, m.rune[4])
      p.set(x + 1, cy, m.rune[3])
      p.set(x + 3, cy - 2, m.rune[2])
    }
    for (let x = 0; x < L; x += 1) p.set(x, cy - 3, m.metal[x % 4 === 0 ? 4 : 3])
  }

  // Ferrules, so a run terminates into a node instead of just stopping.
  for (const x of [0, L - 3]) {
    box(p, x, cy - 4, 3, 9, m.metal)
    p.set(x + 1, cy - 3, m.metal[4])
    p.set(x + 1, cy + 3, m.metal[0])
  }

  seal(p, m.outline)

  let grid = p
  if (m.glow) {
    const out = new Pix(L, H)
    for (let x = 0; x < L; x += 1) {
      for (let d = -4; d <= 4; d += 1) {
        const f = 1 - Math.abs(d) / 5
        out.blend(x, Math.round(cy) + d, m.glow.color, ditherAt(x, Math.round(cy) + d, f) ? m.glow.peak * f : 0)
      }
    }
    out.stamp(p, 0, 0)
    grid = out
  }
  return (vertical ? transposeLit(grid) : grid).toCanvas() as Canvas2D
}

/**
 * A rosette to cap the corner of an elbow run, so the two legs meet in a boss
 * rather than in a mitre the eye reads as a mistake.
 */
export function drawLinkBoss(state: NodeState, branch: TechBranch = 'core'): Canvas2D {
  const accent = BRANCH_ACCENT[branch]
  const m = linkMats(accent, state)
  const n = 13
  const c = n / 2
  const p = new Pix(n, n)
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2
    spoke(p, c, c, a, 2.5, 5.6, 1.6, 0.6, m.metal)
  }
  torus(p, c, c, 4.2, 2.2, m.metal, { bias: 0.05 })
  dome(p, c, c, 2.2, m.rune, { bias: state === 'owned' ? 0.3 : -0.1 })
  seal(p, m.outline)
  if (!m.glow) return p.toCanvas() as Canvas2D
  const out = new Pix(n, n)
  halo(out, c, c, 3, 6.5, m.glow.color, m.glow.peak)
  out.stamp(p, 0, 0)
  return out.toCanvas() as Canvas2D
}

// ───────────────────────────────── Backdrop ─────────────────────────────────

/** The backdrop is authored at half scale and doubled, so its grain is chunky. */
const BACKDROP_SCALE = 2

/**
 * The plate the whole web is engraved on.
 *
 * Old etched bronze gone dark: a cold slate ground mottled with warm tarnish,
 * scored with hairlines, ruled with faint concentric arcs radiating from the
 * root at the left edge, cornered with engraved brackets and vignetted so the
 * middle of the viewport is the darkest part of the screen. Everything in it is
 * quiet on purpose — the backdrop's only job is to make a lit node pop, and it
 * fails the moment it has a shape you can name.
 */
export function drawTreeBackdrop(width: number, height: number): Canvas2D {
  const w = Math.max(4, Math.ceil(width / BACKDROP_SCALE))
  const h = Math.max(4, Math.ceil(height / BACKDROP_SCALE))
  const p = new Pix(w, h)

  const plate = ramp(0x2b3040, { contrast: 0.85, hueShift: 0.03 })
  const tarnish = ramp(0x3a3529, { contrast: 0.8, hueShift: 0.04 })
  const etch = ramp(0x4a5468, { contrast: 0.9 })

  const grain = pixelNoise(1319)
  const blotch = pixelNoise(7717)

  // Ground: a dithered wash brightening toward the upper right, as everything
  // else in the game is lit.
  p.ditherFill(0, 0, w, h, plate[1], plate[2], (x, y) => {
    const t = 0.5 + (x / w) * 0.3 - (y / h) * 0.35
    return Math.max(0, Math.min(1, t))
  })

  // Tarnish: slow blobs of warm corrosion over the cold plate.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const b =
        blotch(x >> 4, y >> 4) * 0.55 + blotch(x >> 3, y >> 3) * 0.3 + blotch(x >> 1, y >> 1) * 0.15
      if (b > 0.62 && ditherAt(x, y, (b - 0.62) * 3)) p.set(x, y, tarnish[b > 0.78 ? 2 : 1])
      const g = grain(x, y)
      if (g > 0.978) p.set(x, y, plate[3])
      else if (g < 0.022) p.set(x, y, plate[0])
    }
  }

  // Ruled hairlines: an engraved grid, every fourth row and eighth column.
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 1) if ((x + y) % 3 !== 0) p.blend(x, y, plate[0], 0.16)
  }
  for (let x = 0; x < w; x += 8) {
    for (let y = 0; y < h; y += 1) if ((x + y) % 3 !== 0) p.blend(x, y, plate[0], 0.1)
  }

  // Concentric arcs from the root, at the left edge, mid height.
  const ox = -w * 0.18
  const oy = h * 0.5
  for (let r = 40; r < w * 2.4; r += 34) {
    for (let a = -1.35; a <= 1.35; a += 0.6 / r) {
      const x = Math.round(ox + Math.cos(a) * r)
      const y = Math.round(oy + Math.sin(a) * r)
      if (!p.inside(x, y)) continue
      if (((x * 3 + y * 5) & 7) === 0) continue
      p.blend(x, y, etch[3], 0.14)
      p.blend(x, y + 1, plate[0], 0.12)
    }
  }

  // Engraved corner brackets: two nested rules and a small scroll.
  const bracket = (bx: number, by: number, sx: number, sy: number): void => {
    for (const inset of [6, 10]) {
      const len = inset === 6 ? 52 : 34
      const a = inset === 6 ? 0.6 : 0.34
      for (let i = 0; i < len; i += 1) {
        p.blend(bx + sx * (inset + i), by + sy * inset, etch[4], a)
        p.blend(bx + sx * (inset + i), by + sy * (inset + 1), plate[0], a * 0.7)
        p.blend(bx + sx * inset, by + sy * (inset + i), etch[4], a)
        p.blend(bx + sx * (inset + 1), by + sy * (inset + i), plate[0], a * 0.7)
      }
    }
    for (let a = 0; a < Math.PI * 1.8; a += 0.12) {
      const r = 3 + a * 1.8
      p.blend(
        Math.round(bx + sx * (16 + Math.cos(a + (sx < 0 ? Math.PI : 0)) * r)),
        Math.round(by + sy * (16 + Math.sin(a + (sy < 0 ? Math.PI : 0)) * r)),
        etch[4],
        0.5
      )
    }
  }
  bracket(0, 0, 1, 1)
  bracket(w - 1, 0, -1, 1)
  bracket(0, h - 1, 1, -1)
  bracket(w - 1, h - 1, -1, -1)

  // Vignette. Dithered, because a smooth one would be the only soft edge in the
  // entire game.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (x / w - 0.5) * 2
      const dy = (y / h - 0.5) * 2
      const d = Math.min(1, Math.hypot(dx * 0.85, dy))
      const t = Math.max(0, d - 0.35) / 0.65
      if (t <= 0) continue
      p.blend(x, y, UI.ink, ditherAt(x, y, t) ? t * 0.55 : t * 0.2)
    }
  }

  return p.toCanvasScaled(BACKDROP_SCALE) as Canvas2D
}
