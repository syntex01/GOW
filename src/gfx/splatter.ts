import type Phaser from 'phaser'
import { save } from '../core/save'
import Pix, { mix, pixelNoise, ramp, tone, type Ramp } from './pixel'

/**
 * The permanent mess.
 *
 * Everything that lands wetly, burns, or breaks leaves a mark here, and the
 * marks stay for the rest of the match. A battlefield that remembers where the
 * fighting happened does more for the feel of a long game than any amount of
 * transient particle work: by the fifth minute the ground in front of a
 * contested fortress is black with it, and you can read the history of the
 * match off the floor.
 *
 * The marks themselves are not blobs. Real spatter has a grammar — a pool
 * spreads and dries from its rim inward, a hit thrown sideways casts a
 * teardrop with a tail of shrinking droplets, a severed artery paints an arc
 * rather than a circle, a shot at contact range leaves fine mist. Each of
 * those is a separate *shape* here, baked into its own brush, so the caller
 * picks the mark that matches the death rather than scaling one blob up.
 *
 * This layer is *purely cosmetic*. Gameplay reads the gore map the simulation
 * keeps instead, because stains have to be identical on both peers in a
 * networked match and a texture is not something you can hash cheaply. For the
 * same reason nothing in here touches `Math.random` or the shared `rng`: every
 * choice a brush makes is hashed out of the position it was stamped at, so two
 * peers painting the same battle paint the same floor without ever having to
 * agree about it.
 */

/** How far above the ground line the layer reaches, for wall splatter. */
const ABOVE_GROUND = 260
/** How far below, so stains sit under the units' feet. */
const BELOW_GROUND = 60

export type SplatKind = 'blood' | 'scorch' | 'oil' | 'dust'

/**
 * What kind of mark to leave.
 *
 * - `pool`   spreading puddle with a crusted rim — something bled out here.
 * - `burst`  radial impact spatter with fingers and satellites — a solid hit.
 * - `cast`   directional teardrop with a tail of shrinking droplets, thrown
 *            along the impulse that made it — a swing, a slash, a hard landing.
 * - `mist`   fine aerosol speckle — a shot taken at contact range.
 * - `arc`    a curved chain of marks — arterial, i.e. decapitation-scale.
 * - `trail`  a striated drag streak — something skidded or was hauled.
 */
export type SplatShape = 'pool' | 'burst' | 'cast' | 'mist' | 'arc' | 'trail'

export interface StampOptions {
  /** Overall size multiplier, 1 = the brush's authored footprint. */
  scale?: number
  /** Radians. The direction the impulse was travelling. */
  angle?: number
  alpha?: number
  /** Impact speed in px/s. Stretches the mark and reaches the satellites out. */
  speed?: number
  /**
   * Deterministic variant selector. Left out, it is hashed from the position,
   * which is what every simulation-driven call should do.
   */
  seed?: number
  /**
   * Dryness, 0 fresh .. 1 crusted. Left out, the mark starts fresh and dries
   * on its own; pass it to paint something that has been there a while.
   */
  dry?: number
}

/** A canvas handed to the texture manager — structurally `painter.Canvas2D`. */
export interface BrushCanvas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

// ─────────────────────────────── Palette ───────────────────────────────

/**
 * Blood is not red. Fresh, it is a dark crimson whose shadows fall toward
 * violet; a minute later it has gone brown and lost most of its saturation,
 * and the rim has crusted almost black. Those two ends are what the whole
 * ageing pass interpolates between.
 */
const BLOOD_FRESH = 0x7d1022
const BLOOD_DRIED = 0x40211a

/** How many dryness levels are baked. Fresh, setting, crusted. */
const DRY_STAGES = 3
/** Baked variants of every (kind, shape, dryness) so marks do not repeat. */
const VARIANTS = 3

interface GoreTones {
  /** Five tones, darkest first, exactly as the rest of the art uses them. */
  tone: Ramp
  /** The rim: darker and browner than the darkest body tone. */
  crust: number
  /** Specular pinprick where a wet surface catches the key light. */
  sheen: number
  /** Whether this stage is still wet enough to catch a highlight at all. */
  wet: boolean
}

function tonesFor(kind: SplatKind, dry: number): GoreTones {
  const t = DRY_STAGES > 1 ? Math.min(1, Math.max(0, dry / (DRY_STAGES - 1))) : 0
  switch (kind) {
    case 'blood': {
      const base = mix(BLOOD_FRESH, BLOOD_DRIED, t)
      return {
        // The base is already off red toward crimson, so the ramp's shadow
        // step lands in violet and its highlight step comes back to red
        // instead of running off into orange. Contrast is deliberately low:
        // blood on dirt is a dark mark with a lit edge, not a bright one.
        tone: ramp(base, { hueShift: 0.022, contrast: 1.05 + t * 0.05, shadowSat: 0.12 - t * 0.07 }),
        crust: mix(tone(base, -0.5), 0x1c0714, 0.45 - t * 0.3),
        sheen: tone(base, 0.35),
        wet: t < 0.5
      }
    }
    case 'scorch': {
      const base = mix(0x241f1b, 0x1a1614, t)
      return {
        tone: ramp(base, { hueShift: 0.03, contrast: 0.85, shadowSat: 0.08 }),
        crust: 0x090807,
        sheen: 0x4a4038,
        wet: false
      }
    }
    case 'oil': {
      const base = 0x191c24
      return {
        tone: ramp(base, { hueShift: 0.06, contrast: 0.9, shadowSat: 0.14 }),
        crust: 0x05060b,
        // Oil films go iridescent where the light catches them.
        sheen: 0x6d7f9c,
        wet: true
      }
    }
    default: {
      const base = mix(0x7d6f5a, 0x6a5d4c, t)
      return {
        tone: ramp(base, { hueShift: 0.04, contrast: 0.7, shadowSat: 0.1 }),
        crust: 0x3d362c,
        sheen: tone(base, 0.3),
        wet: false
      }
    }
  }
}

// ─────────────────────────────── Brushes ───────────────────────────────

/**
 * Authored size of each shape, in art pixels. Everything is emitted at double
 * size so a stamped mark stays as chunky as the sprites standing on it.
 */
const SHAPE_SIZE: Record<SplatShape, [number, number]> = {
  pool: [20, 20],
  burst: [26, 26],
  cast: [40, 20],
  mist: [30, 30],
  arc: [52, 30],
  trail: [30, 12]
}

/**
 * How much of the authored footprint a caller's `scale` of 1 should cover.
 * The shapes are drawn at whatever size reads best; this brings them back to
 * the size the rest of the game was tuned against.
 */
const SHAPE_GAIN: Record<SplatShape, number> = {
  pool: 0.78,
  burst: 0.72,
  cast: 0.85,
  mist: 0.8,
  arc: 1,
  trail: 0.9
}

/** Lit-ness of a rim pixel, with the key light in the upper right. */
function keyLight(nx: number, ny: number): number {
  return nx * 0.62 - ny * 0.78
}

/**
 * One lump of fluid: a disc whose radius wobbles with angle, pooled dark in
 * the middle, with a rim that crusts in the shade and catches light up and to
 * the right. Every wet shape in this file is built out of these.
 */
function lump(
  p: Pix,
  cx: number,
  cy: number,
  r: number,
  g: GoreTones,
  noise: (x: number, y: number) => number,
  opts: { ragged?: number; rim?: number; dry?: number; sheen?: boolean } = {}
): void {
  const ragged = opts.ragged ?? 0.4
  const rim = opts.rim ?? 1
  const dry = opts.dry ?? 0
  const x0 = Math.floor(cx - r - 2)
  const x1 = Math.ceil(cx + r + 2)
  const y0 = Math.floor(cy - r - 2)
  const y1 = Math.ceil(cy + r + 2)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)
      if (d > r * 1.6) continue
      const a = Math.atan2(dy, dx)
      // The edge wobbles with angle rather than with position, so the outline
      // stays a closed lumpy curve instead of dissolving into noise.
      const wobble = 1 + (noise(Math.round(Math.cos(a) * 9), Math.round(Math.sin(a) * 9)) - 0.5) * ragged
      const edge = Math.max(0.8, r * wobble)
      if (d > edge) continue
      const t = d / edge
      const nx = dx / edge
      const ny = dy / edge
      // Grit: the outer band loses pixels, so no edge is ever a clean curve.
      const erode = (t - 0.74) / 0.26
      if (erode > 0 && noise(x * 3 + 1, y * 3 - 1) < erode * 0.55) continue
      let color: number
      if (r < 2.4) {
        // Too small to have a rim at all — a bead of fluid is just dark.
        color = g.tone[dry > 0.55 ? 2 : 1]
      } else if (t > 1 - rim / Math.max(1.5, edge)) {
        // The rim. Wet, it is a thin film that the key light catches up and to
        // the right; dried, the whole edge has crusted almost black — which is
        // most of what tells the two apart at a glance.
        color = dry > 0.4 ? g.crust : keyLight(nx, ny) > 0.52 ? g.tone[3] : g.tone[1]
      } else if (dry > 0.55) {
        // Dried through: the middle lightens and goes blotchy as it flakes.
        const mottle = noise(x * 2, y * 2)
        color = mottle > 0.88 ? g.tone[3] : mottle > 0.5 ? g.tone[2] : g.tone[1]
      } else {
        // Thick in the middle, thin at the edge. Blood is dark where it pools.
        const clot = noise(x * 5, y * 5) > 0.93
        color = clot ? g.crust : t < 0.62 ? g.tone[0] : t < 0.88 ? g.tone[1] : g.tone[2]
      }
      p.set(x, y, color)
    }
  }
  // A wet surface is a mirror: one small hard highlight, up and to the right,
  // and never a soft gradient.
  if (g.wet && (opts.sheen ?? true) && r > 3.5) {
    const hx = Math.round(cx + r * 0.34)
    const hy = Math.round(cy - r * 0.42)
    p.set(hx, hy, g.sheen)
    if (r > 6.5 && noise(hx, hy) > 0.5) p.set(hx + 1, hy, g.tone[3])
  }
}

/** A single flying droplet: one to three pixels, dark, with no rim. */
function droplet(p: Pix, x: number, y: number, size: number, g: GoreTones): void {
  const c = size > 1.6 ? g.tone[1] : g.tone[0]
  p.set(x, y, c)
  if (size > 1.2) p.set(x + 1, y, g.tone[1])
  if (size > 1.8) {
    p.set(x, y + 1, g.tone[1])
    p.set(x + 1, y + 1, g.crust)
  }
  if (size > 2.6) p.set(x - 1, y, g.tone[1])
}

/**
 * Satellites: the droplets that outrun the main mark and land ahead of it.
 * They are the cheapest possible tell that a stain arrived at speed, and the
 * single biggest reason a stamped mark stops looking like a decal.
 */
function satellites(
  p: Pix,
  cx: number,
  cy: number,
  dirX: number,
  dirY: number,
  reach: number,
  spread: number,
  count: number,
  g: GoreTones,
  noise: (x: number, y: number) => number,
  seed: number
): void {
  for (let i = 0; i < count; i += 1) {
    const n1 = noise(seed + i * 7, 31)
    const n2 = noise(seed + i * 13, 57)
    const along = (0.25 + n1 * 0.75) * reach
    const across = (n2 - 0.5) * spread * (0.35 + along / reach)
    const x = Math.round(cx + dirX * along - dirY * across)
    const y = Math.round(cy + dirY * along + dirX * across)
    // Droplets shrink the further they fly — the fine ones went fastest.
    droplet(p, x, y, 2.8 * (1 - along / (reach * 1.15)) + 0.4, g)
  }
}

function drawPool(p: Pix, g: GoreTones, dry: number, noise: (x: number, y: number) => number, seed: number): void {
  const cx = (p.w - 1) / 2
  const cy = (p.h - 1) / 2
  const r = p.w * 0.33
  // A pool is not one disc: it is a broad body with a lobe or two where it ran
  // downhill, which is what gives it an outline worth looking at.
  lump(p, cx, cy, r, g, noise, { ragged: 0.26, rim: 1 + dry * 1.6, dry })
  const lobes = 1 + Math.round(noise(seed, 5) * 2)
  for (let i = 0; i < lobes; i += 1) {
    const a = noise(i + seed, 11) * Math.PI * 2
    const d = r * (0.6 + noise(i + seed, 17) * 0.35)
    lump(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.34 + noise(i + seed, 23) * 0.26), g, noise, {
      ragged: 0.4,
      rim: 1 + dry,
      dry,
      sheen: false
    })
  }
  // Where a pool has soaked in and dried it leaves an outer stain ring that is
  // wider than the pool ever was.
  if (dry > 0.55) {
    for (let i = 0; i < 26; i += 1) {
      const a = noise(seed + i * 3, 41) * Math.PI * 2
      const d = r * (1.05 + noise(seed + i * 3, 43) * 0.35)
      p.set(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), g.crust)
    }
  }
  satellites(p, cx, cy, 1, 0, r * 1.5, r * 2.4, 5, g, noise, seed + 3)
  satellites(p, cx, cy, -1, 0, r * 1.3, r * 2.4, 4, g, noise, seed + 9)
}

function drawBurst(p: Pix, g: GoreTones, dry: number, noise: (x: number, y: number) => number, seed: number): void {
  const cx = (p.w - 1) / 2
  const cy = (p.h - 1) / 2
  const core = p.w * 0.19
  lump(p, cx, cy, core, g, noise, { ragged: 0.55, rim: 1 + dry, dry })

  // Fingers: fluid that kept going after the body of the mark stopped. Each
  // one tapers, and most of them end in a detached drop.
  const arms = 6 + Math.round(noise(seed, 3) * 5)
  for (let i = 0; i < arms; i += 1) {
    const a = noise(i * 5 + seed, 7) * Math.PI * 2
    const reach = core * (1.2 + noise(i * 5 + seed, 13) * 2.6)
    const sx = Math.cos(a)
    const sy = Math.sin(a)
    for (let step = 1; step < reach; step += 1) {
      const taper = 1 - step / reach
      const px = cx + sx * step
      const py = cy + sy * step
      const width = taper * 1.9
      for (let w = -width; w <= width; w += 1) {
        p.set(
          Math.round(px + sy * w),
          Math.round(py - sx * w),
          taper > 0.6 ? g.tone[0] : taper > 0.3 ? g.tone[1] : g.tone[2]
        )
      }
    }
    if (noise(i + seed, 19) > 0.3) {
      const gap = 1.5 + noise(i + seed, 23) * 3.5
      droplet(p, Math.round(cx + sx * (reach + gap)), Math.round(cy + sy * (reach + gap)), 1.6, g)
    }
  }
  satellites(p, cx, cy, 1, 0, p.w * 0.44, p.h * 0.8, 7, g, noise, seed + 31)
}

/**
 * Cast-off. The fluid leaves whatever flung it as a sheet, so the mark has a
 * fat rounded leading edge, a body that narrows behind it, and a tail that
 * finally breaks up into separate drops. Baked pointing along +X and rotated
 * to the impulse at stamp time.
 */
function drawCast(p: Pix, g: GoreTones, dry: number, noise: (x: number, y: number) => number, seed: number): void {
  const cx = (p.w - 1) / 2
  const cy = (p.h - 1) / 2
  const head = p.h * 0.26
  const len = p.w * 0.44
  /** Where the sheet has thinned enough to stop being continuous. */
  const breakAt = len * 0.62

  lump(p, cx, cy, head, g, noise, { ragged: 0.28, rim: 1 + dry, dry })

  // The body: a comma narrowing back from the head, still one connected mark.
  for (let s = 1; s < breakAt; s += 1) {
    const t = s / len
    const half = Math.max(0.5, head * Math.pow(1 - t, 1.05))
    const x = cx - s
    const jitter = (noise(x + seed, 61) - 0.5) * (0.6 + t * 1.8)
    for (let dy = -half; dy <= half; dy += 1) {
      const y = Math.round(cy + dy + jitter)
      const edge = Math.abs(dy) > half - 1.05
      // Lit along the top edge, crusted underneath: the same key light the
      // lumps use, applied to a shape that has a length instead of a radius.
      const lit = dy < 0 && g.wet && half > 1.6 && noise(x * 2, seed) > 0.42
      p.set(x, y, edge ? (lit ? g.tone[3] : g.crust) : t < 0.45 ? g.tone[0] : g.tone[1])
    }
  }
  // Past the break the tail is a string of beads with a widening gap between
  // them, each smaller than the last. This is the part the eye reads as speed.
  let d = breakAt + 1.5
  let step = 2
  for (let i = 0; i < 7; i += 1) {
    if (d > p.w * 0.5 - 2) break
    const t = Math.min(1, d / len)
    const r = Math.max(0.6, head * (1 - t) * 0.85)
    lump(p, cx - d, cy + (noise(seed + i, 73) - 0.5) * (1.5 + i * 0.9), r, g, noise, {
      ragged: 0.5,
      dry,
      sheen: false
    })
    d += step
    step *= 1.35
  }
  // And ahead of the head, the fine stuff that got there first.
  satellites(p, cx + head, cy, 1, 0, p.w * 0.42, p.h * 0.7, 8, g, noise, seed + 17)
}

/**
 * Mist. Contact-range shots aerosolise, and the result is a cloud of pinpricks
 * that is dense at the muzzle and thins out fast — no body to it at all.
 */
function drawMist(p: Pix, g: GoreTones, dry: number, noise: (x: number, y: number) => number, seed: number): void {
  const cx = (p.w - 1) / 2
  const cy = (p.h - 1) / 2
  const r = p.w * 0.48
  for (let y = 0; y < p.h; y += 1) {
    for (let x = 0; x < p.w; x += 1) {
      // Biased forward along +X: the muzzle end is denser than the far edge.
      const dx = (x - cx) / r
      const dy = (y - cy) / r
      const d = Math.hypot(dx * (dx > 0 ? 0.85 : 1.25), dy * 1.15)
      if (d > 1) continue
      const density = (1 - d) * (1 - d) * 0.85
      const n = noise(x + seed, y - seed)
      if (n > density) continue
      p.set(x, y, n < density * 0.32 ? g.tone[0] : n < density * 0.7 ? g.tone[1] : g.tone[2])
    }
  }
  // A handful of drops heavy enough to have survived as drops.
  for (let i = 0; i < 7; i += 1) {
    const a = noise(seed + i * 11, 5) * Math.PI * 2
    const d = noise(seed + i * 11, 9) * r * 0.5
    lump(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + noise(seed + i, 3) * 1.4, g, noise, {
      ragged: 0.6,
      dry,
      sheen: false
    })
  }
  satellites(p, cx, cy, 1, 0, r * 1.1, r * 1.2, 6, g, noise, seed + 5)
}

/**
 * The arterial arc. A severed artery paints while the heart is still pumping,
 * so what lands is a curved chain of marks with the beat visible in it —
 * heavier where the pressure peaked, sparse between. Nothing else on a
 * battlefield looks like this, which is exactly why a decapitation gets it.
 */
function drawArc(p: Pix, g: GoreTones, dry: number, noise: (x: number, y: number) => number, seed: number): void {
  const cx = (p.w - 1) / 2
  const cy = (p.h - 1) / 2
  const radius = p.w * 0.62
  const sweep = 1.15 + noise(seed, 2) * 0.5
  // Centre of curvature below the brush, so the chain bows upward.
  const ox = cx
  const oy = cy + radius * 0.72
  const beats = 5 + Math.round(noise(seed, 4) * 2)
  for (let i = 0; i < beats; i += 1) {
    const t = i / (beats - 1)
    const a = -Math.PI / 2 + (t - 0.5) * sweep
    const px = ox + Math.cos(a) * radius
    const py = oy + Math.sin(a) * radius * 0.62
    // The pump: fat at the peak of the beat, thinning toward both ends, and
    // never fat enough to touch its neighbour — the gaps are the whole point.
    const pulse = Math.sin(t * Math.PI) * (0.4 + noise(seed + i * 3, 6) * 0.6)
    const r = 0.8 + pulse * p.h * 0.1
    lump(p, px, py, r, g, noise, { ragged: 0.5, rim: 1 + dry, dry, sheen: r > 3 })
    // Tangent, so each mark is dragged along the direction of travel.
    const tx = -Math.sin(a)
    const ty = Math.cos(a) * 0.62
    const tl = Math.hypot(tx, ty) || 1
    const dragLen = r * (0.8 + noise(seed + i, 8) * 1.4)
    for (let s = 0; s < dragLen; s += 1) {
      const q = 1 - s / dragLen
      const dx = px - (tx / tl) * s
      const dy = py - (ty / tl) * s
      const half = Math.max(0, r * q * 0.6)
      for (let w = -half; w <= half; w += 1) {
        p.set(Math.round(dx), Math.round(dy + w), q > 0.5 ? g.tone[1] : g.tone[2])
      }
    }
    if (i < beats - 1) {
      // Fine spray in the gap between beats, so the chain still reads as one
      // continuous event rather than as separate stamps.
      satellites(p, px, py, tx / tl, ty / tl, radius * (sweep / beats) * 0.9, r * 2.4, 3, g, noise, seed + i * 29)
    }
  }
}

/** A drag streak: striated along its length, heavier at the leading end. */
function drawTrail(p: Pix, g: GoreTones, dry: number, noise: (x: number, y: number) => number, seed: number): void {
  const cx = (p.w - 1) / 2
  const cy = (p.h - 1) / 2
  const half = p.w * 0.46
  const thick = p.h * 0.3
  for (let s = -half; s <= half; s += 1) {
    const t = (s + half) / (half * 2)
    const width = thick * (0.25 + t * 0.75) * (1 - Math.max(0, t - 0.86) * 5)
    if (width <= 0) continue
    const x = Math.round(cx + s)
    const drift = (noise(x + seed, 3) - 0.5) * 1.6
    for (let dy = -width; dy <= width; dy += 1) {
      const y = Math.round(cy + dy + drift)
      const edgeT = Math.abs(dy) / Math.max(0.6, width)
      // Striations: a dragged smear is scraped into lines, not painted flat.
      const stripe = noise(0, Math.round(cy + dy) * 3 + seed)
      const c =
        edgeT > 0.82
          ? g.crust
          : stripe > 0.7
            ? g.tone[2]
            : stripe > 0.34
              ? g.tone[1]
              : g.tone[0]
      p.set(x, y, dry > 0.55 && stripe > 0.86 ? g.tone[2] : c)
    }
  }
  lump(p, cx + half * 0.82, cy, thick * 0.85, g, noise, { ragged: 0.35, rim: 1 + dry, dry })
  satellites(p, cx + half * 0.9, cy, 1, 0, p.w * 0.16, p.h * 0.8, 4, g, noise, seed + 43)
}

/**
 * Bakes one brush.
 *
 * Colour is baked in rather than tinted on at stamp time, because a dynamic
 * texture's stamp does not apply a tint — and because a flat silhouette in one
 * colour reads as a sticker, where a mark with a pooled centre, a crusted rim
 * and a lit meniscus reads as something wet.
 */
export function buildSplatBrush(kind: SplatKind, shape: SplatShape, dry: number, variant: number): BrushCanvas {
  const [w, h] = SHAPE_SIZE[shape]
  const p = new Pix(w, h)
  const seed = 977 * variant + 313 * dry + shape.length * 71 + kind.length * 29
  const noise = pixelNoise(seed)
  const g = tonesFor(kind, dry)
  const dryT = DRY_STAGES > 1 ? dry / (DRY_STAGES - 1) : 0
  switch (shape) {
    case 'pool':
      drawPool(p, g, dryT, noise, seed)
      break
    case 'burst':
      drawBurst(p, g, dryT, noise, seed)
      break
    case 'cast':
      drawCast(p, g, dryT, noise, seed)
      break
    case 'mist':
      drawMist(p, g, dryT, noise, seed)
      break
    case 'arc':
      drawArc(p, g, dryT, noise, seed)
      break
    default:
      drawTrail(p, g, dryT, noise, seed)
      break
  }
  return p.toCanvasScaled(2) as BrushCanvas
}

/** Texture key for a baked brush. Shared across scenes, built once. */
export function splatBrushKey(kind: SplatKind, shape: SplatShape, dry: number, variant: number): string {
  return `gore:${kind}:${shape}:${dry}:${variant}`
}

// ─────────────────────────── Deterministic choice ───────────────────────────

/**
 * Every variant choice comes out of here. Hashing the position means two peers
 * paint identical floors without exchanging a byte, and means the cosmetic
 * layer never touches the simulation's random stream.
 */
function pick(x: number, y: number, seed: number, salt: number): number {
  let n = Math.imul(Math.round(x) | 0, 374761393) + Math.imul(Math.round(y) | 0, 668265263)
  n = (n + Math.imul(seed | 0, 1442695041) + Math.imul(salt | 0, 2246822519)) | 0
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/** A mark waiting to dry. */
interface AgeingMark {
  x: number
  y: number
  kind: SplatKind
  shape: SplatShape
  scale: number
  angle: number
  alpha: number
  speed: number
  seed: number
  /** Which dryness stage is applied next. */
  stage: number
  /** Milliseconds of layer time until that stage is painted. */
  due: number
}

/** How long each drying stage takes, in milliseconds of layer time. */
const DRY_DELAYS = [9000, 24000]
/** Cap on marks tracked for drying, so a massacre cannot grow the list. */
const MAX_AGEING = 220

let splatterInstance = 0

export default class Splatter {
  private scene: Phaser.Scene
  private texture: Phaser.Textures.DynamicTexture | null = null
  private image?: Phaser.GameObjects.Image
  private readonly key: string
  private readonly originY: number
  private enabled: boolean
  private destroyed = false
  /** Stamps applied this frame, so a massacre cannot stall the renderer. */
  private budget = 0
  private stampsThisFrame = 0
  /** Drying restamps get their own small budget so they never starve fresh blood. */
  private dryBudget = 4
  private ageing: AgeingMark[] = []
  /** Whether marks dry at all — off on low quality, where every stamp counts. */
  private ageingEnabled = true

  constructor(scene: Phaser.Scene, worldWidth: number, groundY: number, depth = 70) {
    this.scene = scene
    splatterInstance += 1
    this.key = `splatter:${splatterInstance}`
    this.originY = groundY - ABOVE_GROUND
    this.enabled = save.settings.particleQuality !== 'low'
    const high = save.settings.particleQuality === 'high'
    this.budget = high ? 26 : 12
    this.dryBudget = high ? 5 : 2
    this.ageingEnabled = high || save.settings.particleQuality === 'medium'

    if (!this.enabled) return
    const height = ABOVE_GROUND + BELOW_GROUND
    this.texture = scene.textures.addDynamicTexture(this.key, worldWidth, height)
    if (!this.texture) {
      this.enabled = false
      return
    }
    // Stains accumulate, so the texture is never cleared after this point.
    this.texture.clear()
    this.image = scene.add.image(0, this.originY, this.key).setOrigin(0, 0).setDepth(depth)
    // The marks a battle opens with are the ones it will use most; bake those
    // now rather than mid-fight.
    this.warm('blood', 'pool')
    this.warm('blood', 'burst')
    this.warm('blood', 'cast')
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  private warm(kind: SplatKind, shape: SplatShape): void {
    for (let v = 0; v < VARIANTS; v += 1) this.brush(kind, shape, 0, v)
  }

  /**
   * Makes sure a brush exists in the texture manager, baking it on first use.
   * Brushes are shared by key across every scene, so a restarted match pays
   * nothing.
   */
  private brush(kind: SplatKind, shape: SplatShape, dry: number, variant: number): string {
    const key = splatBrushKey(kind, shape, dry, variant)
    if (!this.scene.textures.exists(key)) {
      this.scene.textures.addCanvas(key, buildSplatBrush(kind, shape, dry, variant).canvas)
    }
    return key
  }

  /**
   * Call once per frame so the per-frame stamp budget refills and wet marks
   * get older. The delta is optional so the old call site keeps working.
   */
  beginFrame(dtMs = 16.7): void {
    this.stampsThisFrame = 0
    if (!this.texture || this.destroyed) return
    let dried = 0
    for (let i = 0; i < this.ageing.length; i += 1) {
      const m = this.ageing[i]
      // Every mark's clock runs every frame; only the repainting is rationed,
      // so a busy frame delays the drying rather than stopping it.
      m.due -= dtMs
      if (m.due > 0 || dried >= this.dryBudget) continue
      // Repaint the same mark, same variant, same place, one stage drier. The
      // dried brush is drawn a hair wider so it covers what it replaces.
      // Same speed too: a mark stretched by a fast impact has to be repainted
      // stretched, or the fresh one shows around the edge of the dry one.
      this.paint(
        m.x,
        m.y,
        m.kind,
        m.shape,
        m.scale * (1 + m.stage * 0.05),
        m.angle,
        m.alpha,
        m.seed,
        m.stage,
        m.speed
      )
      dried += 1
      m.stage += 1
      if (m.stage >= DRY_STAGES) {
        this.ageing.splice(i, 1)
        i -= 1
      } else {
        m.due = DRY_DELAYS[Math.min(DRY_DELAYS.length - 1, m.stage - 1)]
      }
    }
  }

  /**
   * Marks the ground or a wall.
   *
   * `speed` decides the character of the mark: a body that arrives slowly
   * leaves a compact pool, one that arrives fast throws a cast-off teardrop in
   * its direction of travel. That single rule is most of what makes the floor
   * look like something happened on it rather than like a texture.
   */
  stamp(
    x: number,
    y: number,
    kind: SplatKind,
    scale: number,
    speed = 0,
    angle = 0,
    alpha = 1
  ): void {
    const shape: SplatShape = speed > 620 ? 'cast' : speed > 240 ? 'burst' : 'pool'
    this.mark(x, y, kind, shape, { scale, speed, angle, alpha })
  }

  /**
   * The full entry point: leave a specific kind of mark. The battlefield picks
   * the shape that matches the death — `mist` for a shot at contact range,
   * `arc` for a decapitation, `cast` for anything thrown hard sideways.
   */
  mark(x: number, y: number, kind: SplatKind, shape: SplatShape, options: StampOptions = {}): void {
    const texture = this.texture
    if (!texture || this.destroyed) return
    if (this.stampsThisFrame >= this.budget) return

    const scale = options.scale ?? 1
    const angle = options.angle ?? 0
    const alpha = options.alpha ?? 1
    const speed = options.speed ?? 0
    const seed = options.seed ?? 0
    // Fresh unless the caller says otherwise; anything fresh then dries.
    const explicitDry = options.dry
    const stage =
      explicitDry === undefined ? 0 : Math.min(DRY_STAGES - 1, Math.round(explicitDry * (DRY_STAGES - 1)))

    this.stampsThisFrame += 1
    if (!this.paint(x, y, kind, shape, scale, angle, alpha, seed, stage, speed)) return

    if (explicitDry === undefined && this.ageingEnabled && kind === 'blood') {
      if (this.ageing.length >= MAX_AGEING) this.ageing.shift()
      this.ageing.push({ x, y, kind, shape, scale, angle, alpha, speed, seed, stage: 1, due: DRY_DELAYS[0] })
    }
  }

  /** Does the actual stamping. Returns false if the mark fell off the layer. */
  private paint(
    x: number,
    y: number,
    kind: SplatKind,
    shape: SplatShape,
    scale: number,
    angle: number,
    alpha: number,
    seed: number,
    stage: number,
    speed = 0
  ): boolean {
    const texture = this.texture
    if (!texture) return false
    const localY = y - this.originY
    if (localY < -20 || localY > texture.height + 20) return false

    const variant = Math.min(VARIANTS - 1, Math.floor(pick(x, y, seed, 1) * VARIANTS))
    // A mark stretches along its direction of travel with speed, but a cast
    // brush is already a streak so it needs far less help than a pool does.
    const stretchGain = shape === 'cast' || shape === 'trail' || shape === 'arc' ? 900 : 420
    const stretch = 1 + Math.min(2.2, speed / stretchGain)
    // Flip half the marks vertically so a rotated brush does not betray that
    // there are only three of them.
    const flip = pick(x, y, seed, 2) < 0.5 ? 1 : -1
    const gain = SHAPE_GAIN[shape] * (0.86 + pick(x, y, seed, 3) * 0.28)

    texture.stamp(this.brush(kind, shape, stage, variant), '__BASE', x, localY, {
      alpha,
      scaleX: scale * gain * stretch,
      scaleY: ((scale * gain) / Math.sqrt(stretch)) * flip,
      rotation: angle,
      erase: false
    })
    return true
  }

  /**
   * Directional cast-off from a hit: the teardrop plus its satellites, thrown
   * along `angle`. `power` is roughly the impulse that made it, in px/s.
   */
  castOff(x: number, y: number, angle: number, power: number, kind: SplatKind = 'blood', scale = 1): void {
    this.mark(x, y, kind, 'cast', { scale, angle, speed: power, alpha: 1 })
  }

  /**
   * An arterial arc — the decapitation-scale mark. Long ones are painted as
   * two overlapping chains so the sweep can be longer than one brush.
   */
  arterial(x: number, y: number, angle: number, scale = 1, kind: SplatKind = 'blood'): void {
    this.mark(x, y, kind, 'arc', { scale, angle, alpha: 1 })
    if (scale > 1.3) {
      // The second half of the sweep, further along and turned a little more.
      const reach = 40 * scale
      this.mark(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, kind, 'arc', {
        scale: scale * 0.8,
        angle: angle + 0.5,
        alpha: 0.9,
        seed: 7
      })
    }
  }

  /** Fine aerosol, for a shot taken at contact range. */
  mistBurst(x: number, y: number, angle: number, scale = 1, kind: SplatKind = 'blood'): void {
    this.mark(x, y, kind, 'mist', { scale, angle, alpha: 0.85 })
  }

  /** A long smear, used where something skidded rather than landed. */
  smear(x0: number, y0: number, x1: number, y1: number, kind: SplatKind, scale: number): void {
    const steps = Math.min(8, Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 12)))
    const angle = Math.atan2(y1 - y0, x1 - x0)
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      this.mark(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, kind, 'trail', {
        scale: scale * (1 - t * 0.5),
        angle,
        alpha: 0.75,
        seed: i
      })
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.ageing.length = 0
    this.image?.destroy()
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key)
    this.texture = null
  }
}
