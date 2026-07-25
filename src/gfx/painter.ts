/**
 * Thin drawing helpers over a 2D canvas context. Everything the game renders is
 * generated through these at boot, which keeps the download tiny and lets art
 * be re-tinted or re-shaped from data instead of from a sprite sheet.
 */

export type RGB = [number, number, number]

export function rgb(hex: number): RGB {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]
}

export function css(hex: number, alpha = 1): string {
  const [r, g, b] = rgb(hex)
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}

/** Multiplies a colour toward black (`t` < 0) or white (`t` > 0). */
export function shade(hex: number, t: number): number {
  const [r, g, b] = rgb(hex)
  const mix = (c: number) => {
    const target = t >= 0 ? 255 : 0
    const amount = Math.abs(t)
    return Math.round(c + (target - c) * amount)
  }
  return (mix(r) << 16) | (mix(g) << 8) | mix(b)
}

export function mixColor(a: number, b: number, t: number): number {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * t)
  return (m(ar, br) << 16) | (m(ag, bg) << 8) | m(ab, bb)
}

export interface Canvas2D {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

export function makeCanvas(w: number, h: number): Canvas2D {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(w))
  canvas.height = Math.max(1, Math.ceil(h))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.imageSmoothingEnabled = true
  return { canvas, ctx, w: canvas.width, h: canvas.height }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * Fills a rounded shape with a vertical light-to-dark gradient, a rim
 * highlight and an angled specular streak — the workhorse look for armour
 * plates and limbs. The specular is what makes metal read as metal rather
 * than as flat colour.
 */
export function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: number,
  opts: {
    lightFrom?: number
    darkTo?: number
    outline?: number
    outlineWidth?: number
    rim?: boolean
    /** 0 = matte, 1 = polished steel. */
    specular?: number
  } = {}
): void {
  const lightFrom = opts.lightFrom ?? 0.3
  const darkTo = opts.darkTo ?? -0.38
  const grad = ctx.createLinearGradient(x, y, x + w * 0.25, y + h)
  grad.addColorStop(0, css(shade(color, lightFrom)))
  grad.addColorStop(0.42, css(color))
  grad.addColorStop(1, css(shade(color, darkTo)))

  roundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = grad
  ctx.fill()

  const specular = opts.specular ?? 0.35
  if (specular > 0) {
    ctx.save()
    roundRect(ctx, x, y, w, h, r)
    ctx.clip()
    const streak = ctx.createLinearGradient(x, y, x + w * 0.9, y + h * 0.9)
    streak.addColorStop(0, css(0xffffff, 0))
    streak.addColorStop(0.34, css(0xffffff, 0.28 * specular))
    streak.addColorStop(0.46, css(0xffffff, 0.06 * specular))
    streak.addColorStop(1, css(0xffffff, 0))
    ctx.fillStyle = streak
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  if (opts.outline !== undefined) {
    roundRect(ctx, x, y, w, h, r)
    ctx.lineWidth = opts.outlineWidth ?? 2
    ctx.strokeStyle = css(opts.outline)
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  if (opts.rim !== false) {
    ctx.save()
    roundRect(ctx, x, y, w, h, r)
    ctx.clip()
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = css(shade(color, 0.6))
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x + r * 0.6, y + 1.2)
    ctx.lineTo(x + w - r * 0.6, y + 1.2)
    ctx.stroke()
    ctx.restore()
    ctx.globalAlpha = 1
  }
}

export function ellipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
  opts: { outline?: number; outlineWidth?: number; shaded?: boolean } = {}
): void {
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  if (opts.shaded !== false) {
    const grad = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.4, rx * 0.1, cx, cy, Math.max(rx, ry))
    grad.addColorStop(0, css(shade(color, 0.38)))
    grad.addColorStop(0.6, css(color))
    grad.addColorStop(1, css(shade(color, -0.35)))
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = css(color)
  }
  ctx.fill()
  if (opts.shaded !== false) {
    // A small offset highlight reads as a curved, lit surface.
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.clip()
    const hl = ctx.createRadialGradient(
      cx - rx * 0.38,
      cy - ry * 0.44,
      0,
      cx - rx * 0.38,
      cy - ry * 0.44,
      Math.max(rx, ry) * 0.85
    )
    hl.addColorStop(0, css(0xffffff, 0.3))
    hl.addColorStop(1, css(0xffffff, 0))
    ctx.fillStyle = hl
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2)
    ctx.restore()
  }
  if (opts.outline !== undefined) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.lineWidth = opts.outlineWidth ?? 2
    ctx.strokeStyle = css(opts.outline)
    ctx.stroke()
  }
}

export function polygon(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  color: number,
  opts: { outline?: number; outlineWidth?: number; gradient?: boolean } = {}
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()

  if (opts.gradient !== false) {
    let minY = Infinity
    let maxY = -Infinity
    for (const [, py] of points) {
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }
    const grad = ctx.createLinearGradient(0, minY, 0, maxY || minY + 1)
    grad.addColorStop(0, css(shade(color, 0.26)))
    grad.addColorStop(1, css(shade(color, -0.3)))
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = css(color)
  }
  ctx.fill()

  if (opts.outline !== undefined) {
    ctx.lineWidth = opts.outlineWidth ?? 2
    ctx.strokeStyle = css(opts.outline)
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
}

/** Soft radial glow, used for muzzle flashes, energy cores and lights. */
export function glow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: number,
  intensity = 1
): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  grad.addColorStop(0, css(shade(color, 0.7), 0.95 * intensity))
  grad.addColorStop(0.35, css(color, 0.6 * intensity))
  grad.addColorStop(1, css(color, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
}

let noiseTile: HTMLCanvasElement | null = null

/**
 * A reusable speckle tile: half-transparent black and white pixels. Painting
 * it with `source-atop` adds texture only where art already exists, which is
 * two orders of magnitude faster than per-pixel `getImageData` work.
 */
function getNoiseTile(): HTMLCanvasElement {
  if (noiseTile) return noiseTile
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(size, size)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const light = Math.random() > 0.5
    const value = light ? 255 : 0
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = Math.random() * 190
  }
  ctx.putImageData(image, 0, 0)
  noiseTile = canvas
  return canvas
}

/** Sprinkles subtle speckle so flat fills do not look like plastic. */
export function grain(c: Canvas2D, amount = 0.06): void {
  const { ctx, w, h } = c
  const pattern = ctx.createPattern(getNoiseTile(), 'repeat')
  if (!pattern) return
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.globalAlpha = amount
  ctx.fillStyle = pattern
  ctx.translate(-Math.floor(Math.random() * 64), -Math.floor(Math.random() * 64))
  ctx.fillRect(0, 0, w + 64, h + 64)
  ctx.restore()
}

/** Draws a dark contact shadow under a shape so units sit on the ground. */
export function contactShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx)
  grad.addColorStop(0, 'rgba(0,0,0,0.5)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1, ry / rx)
  ctx.translate(-cx, -cy)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Deterministic 1D value noise for terrain silhouettes. */
export function valueNoise(seed: number) {
  const hash = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  return (x: number): number => {
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f)
    return hash(i) * (1 - u) + hash(i + 1) * u
  }
}

/** Fractal sum of `valueNoise`, handy for mountain ridgelines. */
export function fbm(seed: number, octaves = 4) {
  const noises = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 37))
  return (x: number): number => {
    let sum = 0
    let amp = 0.5
    let freq = 1
    let norm = 0
    for (let i = 0; i < octaves; i += 1) {
      sum += noises[i](x * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2.05
    }
    return sum / norm
  }
}
