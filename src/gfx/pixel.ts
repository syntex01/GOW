/**
 * The pixel-art foundation.
 *
 * Every world sprite in the game is authored here, on an integer grid, one
 * pixel at a time. Nothing goes through the canvas path API: `fill()` and
 * `stroke()` antialias, and a single row of half-transparent edge pixels is
 * the difference between pixel art and a small blurry drawing.
 *
 * Art is drawn at 1/PIXEL of world scale and displayed at PIXEL times that, so
 * a 64-pixel-tall soldier is authored as 32 real pixels and shown chunky.
 */

/** Screen pixels per art pixel. */
export const PIXEL = 2

/**
 * Art pixels per world pixel — the factor every art module multiplies by.
 * Sprites are then scaled by `1 / RES` on screen.
 */
export const RES = 1 / PIXEL

// ─────────────────────────────── Colour ───────────────────────────────

export type RGBA = number

/** Packs to the little-endian ABGR word a Uint32 view of ImageData expects. */
export function rgba(hex: number, alpha = 255): RGBA {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  return ((alpha & 0xff) << 24) | (b << 16) | (g << 8) | r
}

export function unpack(value: RGBA): [number, number, number, number] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

function toHsl(hex: number): [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function fromHsl(h: number, s: number, l: number): number {
  h = ((h % 1) + 1) % 1
  s = Math.min(1, Math.max(0, s))
  l = Math.min(1, Math.max(0, l))
  if (s === 0) {
    const v = clamp8(l * 255)
    return (v << 16) | (v << 8) | v
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return (clamp8(channel(h + 1 / 3) * 255) << 16) | (clamp8(channel(h) * 255) << 8) | clamp8(channel(h - 1 / 3) * 255)
}

/**
 * A material's tones, darkest first. Five steps is the sweet spot: enough to
 * describe a curved surface, few enough that the eye reads deliberate shapes
 * rather than a gradient.
 */
export type Ramp = readonly [number, number, number, number, number]

export interface RampOptions {
  /**
   * How far the shadows swing toward cool and the highlights toward warm.
   * Hue shifting is the single biggest difference between pixel art that looks
   * painted and pixel art that looks like a lighten/darken filter.
   */
  hueShift?: number
  /** Overall contrast between the darkest and lightest step. */
  contrast?: number
  /** Extra saturation in the shadows, which stops them going muddy grey. */
  shadowSat?: number
}

const rampCache = new Map<string, Ramp>()

/** Builds a five-tone ramp from a base colour, with hue-shifted ends. */
export function ramp(base: number, options: RampOptions = {}): Ramp {
  const hueShift = options.hueShift ?? 0.045
  const contrast = options.contrast ?? 1
  const shadowSat = options.shadowSat ?? 0.16
  const key = `${base}|${hueShift}|${contrast}|${shadowSat}`
  const cached = rampCache.get(key)
  if (cached) return cached

  const [h, s, l] = toHsl(base)
  // Shadows rotate toward blue, highlights toward yellow — the direction the
  // eye already expects from a warm key light against a cool sky.
  const steps: number[] = []
  const offsets: [number, number, number][] = [
    [-0.34 * contrast, -hueShift * 1.6, shadowSat],
    [-0.17 * contrast, -hueShift * 0.8, shadowSat * 0.5],
    [0, 0, 0],
    [0.15 * contrast, hueShift * 0.7, -shadowSat * 0.35],
    [0.3 * contrast, hueShift * 1.3, -shadowSat * 0.6]
  ]
  for (const [dl, dh, ds] of offsets) {
    steps.push(fromHsl(h + dh, Math.min(1, Math.max(0, s + ds)), l + dl * (dl < 0 ? l : 1 - l) * 1.35))
  }
  const built = steps as unknown as Ramp
  rampCache.set(key, built)
  return built
}

/** The outline tone for a material: darker than its shadow, never flat black. */
export function outlineTone(base: number): number {
  const [h, s, l] = toHsl(base)
  return fromHsl(h - 0.03, Math.min(1, s + 0.1), Math.max(0.04, l * 0.32))
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  return (
    (clamp8(ar + (br - ar) * t) << 16) | (clamp8(ag + (bg - ag) * t) << 8) | clamp8(ab + (bb - ab) * t)
  )
}

/** Lightens (`t` > 0) or darkens (`t` < 0) while keeping the hue shift honest. */
export function tone(base: number, t: number): number {
  const [h, s, l] = toHsl(base)
  const dh = t >= 0 ? 0.03 * t : 0.05 * t
  const ds = t >= 0 ? -0.08 * t : 0.12 * -t
  return fromHsl(h + dh, s + ds, l + t * (t < 0 ? l : 1 - l) * 1.3)
}

// ─────────────────────────────── Dithering ───────────────────────────────

/** Ordered 4x4 Bayer matrix, normalised to 0..15. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

/** True when this pixel should take the *second* colour at blend level `t`. */
export function ditherAt(x: number, y: number, t: number): boolean {
  const threshold = (BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16
  return t > threshold
}

// ─────────────────────────────── The buffer ───────────────────────────────

export interface PixelCanvas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

/**
 * An integer pixel grid. Every drawing operation writes whole pixels; there is
 * no antialiasing anywhere, by construction.
 */
export default class Pix {
  readonly w: number
  readonly h: number
  readonly data: Uint32Array

  constructor(w: number, h: number) {
    this.w = Math.max(1, Math.round(w))
    this.h = Math.max(1, Math.round(h))
    this.data = new Uint32Array(this.w * this.h)
  }

  index(x: number, y: number): number {
    return y * this.w + x
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  get(x: number, y: number): RGBA {
    return this.inside(x, y) ? this.data[this.index(x, y)] : 0
  }

  /** Writes an opaque pixel, replacing whatever was there. */
  set(x: number, y: number, color: number, alpha = 255): void {
    x |= 0
    y |= 0
    if (!this.inside(x, y)) return
    this.data[this.index(x, y)] = rgba(color, alpha)
  }

  /**
   * Composites a pixel over what is already there. Used sparingly: stacked
   * translucency is how pixel art loses its crispness, so this is for glass,
   * energy and shadow passes only.
   */
  blend(x: number, y: number, color: number, alpha: number): void {
    x |= 0
    y |= 0
    if (!this.inside(x, y) || alpha <= 0) return
    if (alpha >= 1) {
      this.set(x, y, color)
      return
    }
    const i = this.index(x, y)
    const dst = this.data[i]
    const da = (dst >>> 24) & 0xff
    const [dr, dg, db] = [dst & 0xff, (dst >> 8) & 0xff, (dst >> 16) & 0xff]
    const sr = (color >> 16) & 0xff
    const sg = (color >> 8) & 0xff
    const sb = color & 0xff
    const outA = alpha + (da / 255) * (1 - alpha)
    if (outA <= 0) return
    const blendChannel = (s: number, d: number) => (s * alpha + d * (da / 255) * (1 - alpha)) / outA
    this.data[i] =
      (clamp8(outA * 255) << 24) |
      (clamp8(blendChannel(sb, db)) << 16) |
      (clamp8(blendChannel(sg, dg)) << 8) |
      clamp8(blendChannel(sr, dr))
  }

  clear(): void {
    this.data.fill(0)
  }

  /** Solid axis-aligned rectangle. */
  fill(x: number, y: number, w: number, h: number, color: number, alpha = 255): void {
    const x0 = Math.max(0, Math.round(x))
    const y0 = Math.max(0, Math.round(y))
    const x1 = Math.min(this.w, Math.round(x + w))
    const y1 = Math.min(this.h, Math.round(y + h))
    const packed = rgba(color, alpha)
    for (let py = y0; py < y1; py += 1) {
      const row = py * this.w
      for (let px = x0; px < x1; px += 1) this.data[row + px] = packed
    }
  }

  /** One-pixel rectangular border. */
  frame(x: number, y: number, w: number, h: number, color: number): void {
    this.fill(x, y, w, 1, color)
    this.fill(x, y + h - 1, w, 1, color)
    this.fill(x, y, 1, h, color)
    this.fill(x + w - 1, y, 1, h, color)
  }

  /**
   * Fills a rectangle with two tones mixed by ordered dithering. This is how
   * large surfaces get a gradient without ever leaving the palette.
   */
  ditherFill(
    x: number,
    y: number,
    w: number,
    h: number,
    from: number,
    to: number,
    tAt: (px: number, py: number) => number
  ): void {
    const x0 = Math.max(0, Math.round(x))
    const y0 = Math.max(0, Math.round(y))
    const x1 = Math.min(this.w, Math.round(x + w))
    const y1 = Math.min(this.h, Math.round(y + h))
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        this.set(px, py, ditherAt(px, py, tAt(px, py)) ? to : from)
      }
    }
  }

  /** Bresenham line, one pixel wide, no gaps and no diagonal doubling. */
  line(x0: number, y0: number, x1: number, y1: number, color: number, alpha = 255): void {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const ex = Math.round(x1)
    const ey = Math.round(y1)
    const dx = Math.abs(ex - x)
    const dy = -Math.abs(ey - y)
    const sx = x < ex ? 1 : -1
    const sy = y < ey ? 1 : -1
    let err = dx + dy
    for (;;) {
      if (alpha >= 255) this.set(x, y, color)
      else this.blend(x, y, color, alpha / 255)
      if (x === ex && y === ey) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** A line with square caps, `width` pixels thick. Used for limbs and hafts. */
  thickLine(x0: number, y0: number, x1: number, y1: number, width: number, color: number): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * 0.5
    const ny = (dx / len) * 0.5
    const half = (width - 1) / 2
    for (let i = -half; i <= half; i += 1) {
      this.line(x0 + nx * 2 * i, y0 + ny * 2 * i, x1 + nx * 2 * i, y1 + ny * 2 * i, color)
    }
  }

  /** Filled midpoint ellipse — round without a single soft edge. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: number, alpha = 255): void {
    const rX = Math.max(0.5, rx)
    const rY = Math.max(0.5, ry)
    const y0 = Math.max(0, Math.floor(cy - rY))
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rY))
    for (let py = y0; py <= y1; py += 1) {
      const dy = (py + 0.5 - cy) / rY
      if (Math.abs(dy) > 1) continue
      const span = Math.sqrt(Math.max(0, 1 - dy * dy)) * rX
      const x0 = Math.round(cx - span)
      const x1 = Math.round(cx + span)
      for (let px = x0; px < x1; px += 1) {
        if (alpha >= 255) this.set(px, py, color)
        else this.blend(px, py, color, alpha / 255)
      }
    }
  }

  /** Punches an elliptical hole — spoke gaps, windows, hollow rings. */
  eraseEllipse(cx: number, cy: number, rx: number, ry: number): void {
    const rX = Math.max(0.5, rx)
    const rY = Math.max(0.5, ry)
    const y0 = Math.max(0, Math.floor(cy - rY))
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rY))
    for (let py = y0; py <= y1; py += 1) {
      const dy = (py + 0.5 - cy) / rY
      if (Math.abs(dy) > 1) continue
      const span = Math.sqrt(Math.max(0, 1 - dy * dy)) * rX
      for (let px = Math.round(cx - span); px < Math.round(cx + span); px += 1) {
        if (this.inside(px, py)) this.data[this.index(px, py)] = 0
      }
    }
  }

  /** One-pixel ellipse outline. */
  ellipseFrame(cx: number, cy: number, rx: number, ry: number, color: number): void {
    const steps = Math.max(12, Math.round((rx + ry) * 4))
    let prevX = 0
    let prevY = 0
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2
      const px = Math.round(cx + Math.cos(a) * rx)
      const py = Math.round(cy + Math.sin(a) * ry)
      if (i > 0) this.line(prevX, prevY, px, py, color)
      prevX = px
      prevY = py
    }
  }

  /** Scanline-filled polygon. Vertices may be fractional; edges land on pixels. */
  poly(points: readonly (readonly [number, number])[], color: number, alpha = 255): void {
    if (points.length < 3) return
    let minY = Infinity
    let maxY = -Infinity
    for (const [, py] of points) {
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    const y0 = Math.max(0, Math.floor(minY))
    const y1 = Math.min(this.h - 1, Math.ceil(maxY))
    const crossings: number[] = []
    for (let py = y0; py <= y1; py += 1) {
      const scanY = py + 0.5
      crossings.length = 0
      for (let i = 0; i < points.length; i += 1) {
        const [ax, ay] = points[i]
        const [bx, by] = points[(i + 1) % points.length]
        if (ay === by) continue
        if (scanY >= Math.min(ay, by) && scanY < Math.max(ay, by)) {
          crossings.push(ax + ((scanY - ay) / (by - ay)) * (bx - ax))
        }
      }
      crossings.sort((a, b) => a - b)
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const sx = Math.round(crossings[i])
        const ex = Math.round(crossings[i + 1])
        for (let px = sx; px < ex; px += 1) {
          if (alpha >= 255) this.set(px, py, color)
          else this.blend(px, py, color, alpha / 255)
        }
      }
    }
  }

  /**
   * Wraps every opaque cluster in a one-pixel border. Doing this as a pass over
   * the finished sprite — rather than stroking each shape — is what gives pixel
   * art a single clean silhouette instead of a tangle of internal outlines.
   */
  outline(color: number, opts: { diagonals?: boolean; alpha?: number } = {}): void {
    const diagonals = opts.diagonals ?? true
    const alpha = opts.alpha ?? 255
    const source = Uint32Array.from(this.data)
    const packed = rgba(color, alpha)
    const solid = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < this.w && y < this.h && (source[y * this.w + x] >>> 24) > 24
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        if (solid(x, y)) continue
        const touching =
          solid(x - 1, y) ||
          solid(x + 1, y) ||
          solid(x, y - 1) ||
          solid(x, y + 1) ||
          (diagonals &&
            (solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1)))
        if (touching) this.data[this.index(x, y)] = packed
      }
    }
  }

  /**
   * Darkens the outline where it already exists, tinting it toward each
   * neighbour's own colour. Flat black outlines make sprites look like
   * stickers; a tinted one keeps them in the scene.
   */
  tintOutline(strength = 0.55): void {
    const source = Uint32Array.from(this.data)
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const i = this.index(x, y)
        if ((source[i] >>> 24) === 0) continue
        // Only touch pixels that sit on the boundary.
        const edge =
          (x > 0 && (source[i - 1] >>> 24) === 0) ||
          (x < this.w - 1 && (source[i + 1] >>> 24) === 0) ||
          (y > 0 && (source[i - this.w] >>> 24) === 0) ||
          (y < this.h - 1 && (source[i + this.w] >>> 24) === 0)
        if (!edge) continue
        const [r, g, b, a] = unpack(source[i])
        const hex = (r << 16) | (g << 8) | b
        const darkened = tone(hex, -strength)
        this.data[i] = rgba(darkened, a)
      }
    }
  }

  /** Copies another buffer in at an offset, skipping transparent pixels. */
  stamp(other: Pix, dx: number, dy: number): void {
    for (let y = 0; y < other.h; y += 1) {
      const ty = dy + y
      if (ty < 0 || ty >= this.h) continue
      for (let x = 0; x < other.w; x += 1) {
        const value = other.data[y * other.w + x]
        if ((value >>> 24) === 0) continue
        const tx = dx + x
        if (tx < 0 || tx >= this.w) continue
        this.data[ty * this.w + tx] = value
      }
    }
  }

  /** Mirrors the buffer horizontally, in place. */
  flipX(): void {
    for (let y = 0; y < this.h; y += 1) {
      const row = y * this.w
      for (let x = 0; x < this.w >> 1; x += 1) {
        const a = row + x
        const b = row + this.w - 1 - x
        const t = this.data[a]
        this.data[a] = this.data[b]
        this.data[b] = t
      }
    }
  }

  /** True if any pixel in the column is opaque — used to trim empty margins. */
  columnUsed(x: number): boolean {
    for (let y = 0; y < this.h; y += 1) if ((this.data[y * this.w + x] >>> 24) > 0) return true
    return false
  }

  /**
   * Hands the grid over at an integer magnification, each art pixel becoming
   * an n×n block. Used where a texture's dimensions are fixed by its consumer
   * but its pixels still have to match the rest of the world.
   */
  toCanvasScaled(scale: number): PixelCanvas {
    const n = Math.max(1, Math.round(scale))
    if (n === 1) return this.toCanvas()
    const big = new Pix(this.w * n, this.h * n)
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const value = this.data[y * this.w + x]
        if ((value >>> 24) === 0) continue
        for (let dy = 0; dy < n; dy += 1) {
          const row = (y * n + dy) * big.w + x * n
          for (let dx = 0; dx < n; dx += 1) big.data[row + dx] = value
        }
      }
    }
    return big.toCanvas()
  }

  /** Hands the finished grid to a real canvas for the texture manager. */
  toCanvas(): PixelCanvas {
    const canvas = document.createElement('canvas')
    canvas.width = this.w
    canvas.height = this.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.imageSmoothingEnabled = false
    const image = ctx.createImageData(this.w, this.h)
    new Uint32Array(image.data.buffer).set(this.data)
    ctx.putImageData(image, 0, 0)
    return { canvas, ctx, w: this.w, h: this.h }
  }
}

/** Convenience: build, draw, hand back a canvas. */
export function pixCanvas(w: number, h: number, draw: (p: Pix) => void): PixelCanvas {
  const p = new Pix(w, h)
  draw(p)
  return p.toCanvas()
}

// ─────────────────────────────── Noise ───────────────────────────────

/** Deterministic hash noise on the integer grid, for speckle and terrain. */
export function pixelNoise(seed: number) {
  return (x: number, y: number): number => {
    let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)
    n = (n ^ (n >>> 13)) | 0
    n = Math.imul(n, 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
}

/** Smooth 1D value noise, for ridgelines and ground contours. */
export function ridgeNoise(seed: number, octaves = 4) {
  const hash = (n: number): number => {
    let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const layer = (x: number): number => {
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f)
    return hash(i) * (1 - u) + hash(i + 1) * u
  }
  return (x: number): number => {
    let sum = 0
    let amp = 0.5
    let freq = 1
    let norm = 0
    for (let i = 0; i < octaves; i += 1) {
      sum += layer(x * freq + i * 53.7) * amp
      norm += amp
      amp *= 0.5
      freq *= 2.03
    }
    return sum / norm
  }
}
