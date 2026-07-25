import type { UnitVisual, WeaponVisual } from '../data/types'
import type { Canvas2D } from './painter'
import Pix, { RES, ramp, tone, type Ramp } from './pixel'

export { RES }

/**
 * Every soldier, machine and mount in the game, drawn one pixel at a time.
 *
 * A unit is a set of separately drawn parts that the battle scene assembles
 * into an animated rig, so each part has to read on its own and still fit the
 * silhouette when stacked. At this scale — a foot soldier is about 33 pixels
 * tall — that means committing to a few strong tones per material and letting
 * the outline carry the shape. Detail added past that point turns to noise the
 * moment the sprite moves.
 *
 * Light comes from the upper right throughout, so the face and weapon of a
 * right-facing unit are lit and the back edge falls into shadow.
 */

export interface RigMetrics {
  height: number
  legLen: number
  torsoH: number
  bodyW: number
  armLen: number
  headR: number
  hipY: number
  shoulderY: number
  neckY: number
}

/** Derives consistent body proportions from a unit's world-space height. */
export function rigMetrics(height: number, bulk = 1): RigMetrics {
  const legLen = height * 0.36
  const torsoH = height * 0.34
  const headR = height * 0.115
  const bodyW = height * 0.25 * bulk
  const armLen = height * 0.32
  const hipY = -legLen
  const shoulderY = hipY - torsoH * 0.8
  const neckY = hipY - torsoH
  return { height, legLen, torsoH, bodyW, armLen, headR, hipY, shoulderY, neckY }
}

export interface PartSpec {
  key: string
  canvas: Canvas2D
  originX: number
  originY: number
}

/** Breathing room so outlines and overhangs are never clipped. */
const PAD = 3

function part(w: number, h: number): Pix {
  return new Pix(Math.ceil(w) + PAD * 2, Math.ceil(h) + PAD * 2)
}

/**
 * Wraps the finished part in its silhouette outline. Running this once over
 * the whole part — rather than outlining each shape as it is drawn — is what
 * keeps a unit reading as one object instead of a pile of pieces.
 */
function finish(p: Pix, base: number): Canvas2D {
  // One pixel, on the outside only. Darkening the sprite's own edge as well
  // would look richer on a large sprite and eat a third of a three-pixel arm
  // on this one.
  p.outline(tone(base, -0.82), { diagonals: true })
  return p.toCanvas() as Canvas2D
}

// ─────────────────────────────── Shape helpers ───────────────────────────────

/**
 * A shaded box: lit top row, base body, shadow along the bottom and the left
 * (away-from-light) edge. This is the workhorse for armour, crates and hulls.
 */
function box(p: Pix, x: number, y: number, w: number, h: number, r: Ramp, opts: { flat?: boolean } = {}): void {
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

/** A box with its four corner pixels knocked out, so it reads as rounded. */
function chamfer(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
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

/** A shaded blob: lit crescent up-right, core, shadow crescent down-left. */
function orb(p: Pix, cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
  p.ellipse(cx, cy, rx, ry, r[1])
  p.ellipse(cx + rx * 0.12, cy - ry * 0.12, rx * 0.88, ry * 0.88, r[2])
  if (rx >= 2.2 && ry >= 2.2) p.ellipse(cx + rx * 0.3, cy - ry * 0.32, rx * 0.5, ry * 0.5, r[3])
  if (rx >= 3.6 && ry >= 3.6) p.set(Math.round(cx + rx * 0.42), Math.round(cy - ry * 0.5), r[4])
}

/** A limb or haft drawn along a vector, with a lit edge on the upper side. */
function shaft(p: Pix, x0: number, y0: number, x1: number, y1: number, width: number, r: Ramp): void {
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

// ─────────────────────────────── Head ───────────────────────────────

function drawHead(v: UnitVisual, m: RigMetrics): Canvas2D {
  const r = Math.max(2, m.headR * RES)
  const skin = ramp(v.skin)
  const cloth = ramp(v.cloth)
  const cloth2 = ramp(v.cloth2)
  const metal = ramp(v.metal, { contrast: 1.15, hueShift: 0.02 })
  const accent = ramp(v.accent)

  const p = part(r * 3.4, r * 3.6)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h - PAD - r * 1.5)

  // Skull: a touch taller than wide so it never reads as a ball.
  orb(p, cx, cy, r * 1.02, r * 1.14, skin)
  // Jaw and neck shadow on the away side.
  p.ellipse(cx - r * 0.5, cy + r * 0.45, r * 0.55, r * 0.45, skin[1])

  // A face at this size is three pixels: brow, eye, mouth line.
  const eyeX = Math.round(cx + r * 0.42)
  const eyeY = Math.round(cy - r * 0.1)
  p.set(eyeX, eyeY, tone(v.skin, -0.75))
  p.set(eyeX - 1, eyeY - 1, skin[1])
  if (r >= 3) p.line(cx + r * 0.15, cy + r * 0.5, cx + r * 0.6, cy + r * 0.5, skin[1])

  switch (v.helmet) {
    case 'band':
      p.fill(cx - r * 1.05, cy - r * 0.62, r * 2.1, Math.max(1, r * 0.34), cloth2[2])
      p.fill(cx - r * 1.05, cy - r * 0.62, r * 2.1, 1, cloth2[3])
      break
    case 'horns':
      p.fill(cx - r * 1.05, cy - r * 0.7, r * 2.1, Math.max(1, r * 0.38), cloth2[2])
      // Horns sweep up and out; drawn as tapering wedges so they stay sharp.
      for (const side of [-1, 1]) {
        p.poly(
          [
            [cx + side * r * 0.8, cy - r * 0.5],
            [cx + side * r * 1.6, cy - r * 1.55],
            [cx + side * r * 1.05, cy - r * 0.5]
          ],
          accent[side > 0 ? 3 : 1]
        )
      }
      break
    case 'hood':
      p.poly(
        [
          [cx - r * 1.2, cy + r * 0.95],
          [cx - r * 1.15, cy - r * 0.75],
          [cx - r * 0.2, cy - r * 1.5],
          [cx + r * 0.95, cy - r * 1.0],
          [cx + r * 1.1, cy + r * 0.15],
          [cx + r * 0.35, cy + r * 0.3]
        ],
        cloth[2]
      )
      // Lit crown and shadowed inner fold, so the hood has depth.
      p.line(cx - r * 0.2, cy - r * 1.5, cx + r * 0.95, cy - r * 1.0, cloth[3])
      p.line(cx + r * 0.3, cy + r * 0.28, cx + r * 1.05, cy + r * 0.1, cloth[1])
      break
    case 'kettle': {
      const brim = r * 1.45
      p.ellipse(cx, cy - r * 0.5, brim, r * 0.72, metal[2])
      p.ellipse(cx + r * 0.15, cy - r * 0.62, brim * 0.85, r * 0.58, metal[3])
      p.fill(cx - brim, cy - r * 0.42, brim * 2, 1, metal[1])
      break
    }
    case 'great': {
      chamfer(p, cx - r * 1.05, cy - r * 1.25, r * 2.1, r * 2.15, metal)
      // Vision slit and breath holes: the whole read of a great helm.
      p.fill(cx - r * 0.7, cy - r * 0.35, r * 1.5, Math.max(1, r * 0.22), tone(v.metal, -0.8))
      p.set(Math.round(cx + r * 0.2), Math.round(cy + r * 0.35), tone(v.metal, -0.7))
      p.set(Math.round(cx + r * 0.55), Math.round(cy + r * 0.35), tone(v.metal, -0.7))
      if (r >= 3) p.fill(cx - r * 0.1, cy - r * 1.35, Math.max(1, r * 0.3), r * 0.5, accent[3])
      break
    }
    case 'tricorn':
      p.poly(
        [
          [cx - r * 1.6, cy - r * 0.5],
          [cx, cy - r * 1.45],
          [cx + r * 1.6, cy - r * 0.5],
          [cx + r * 0.9, cy - r * 0.2],
          [cx - r * 0.9, cy - r * 0.2]
        ],
        cloth[2]
      )
      p.line(cx - r * 1.6, cy - r * 0.5, cx, cy - r * 1.45, cloth[3])
      p.line(cx, cy - r * 1.45, cx + r * 1.6, cy - r * 0.5, cloth[1])
      break
    case 'kepi':
      box(p, cx - r * 0.95, cy - r * 1.15, r * 1.9, r * 0.85, cloth)
      // Forward peak.
      p.fill(cx + r * 0.5, cy - r * 0.42, r * 1.15, 1, cloth[1])
      p.fill(cx - r * 0.95, cy - r * 0.42, r * 1.9, 1, cloth2[2])
      break
    case 'combat':
      p.ellipse(cx, cy - r * 0.42, r * 1.18, r * 0.95, cloth2[2])
      p.ellipse(cx + r * 0.16, cy - r * 0.55, r * 0.95, r * 0.72, cloth2[3])
      p.fill(cx - r * 1.18, cy - r * 0.3, r * 2.36, 1, cloth2[1])
      // Chin strap.
      p.line(cx - r * 0.95, cy - r * 0.1, cx - r * 0.7, cy + r * 0.55, cloth2[1])
      break
    case 'visor':
      chamfer(p, cx - r * 1.1, cy - r * 1.15, r * 2.2, r * 1.9, metal)
      p.fill(cx - r * 0.55, cy - r * 0.5, r * 1.7, Math.max(1, r * 0.5), accent[3])
      p.fill(cx - r * 0.55, cy - r * 0.5, r * 1.7, 1, accent[4])
      break
    case 'halo': {
      p.ellipse(cx, cy - r * 0.35, r * 1.08, r * 1.0, metal[2])
      p.ellipse(cx + r * 0.18, cy - r * 0.5, r * 0.8, r * 0.7, metal[3])
      // A floating ring above the head, broken at the back so it reads as 3D.
      const ringY = Math.round(cy - r * 1.9)
      p.line(cx - r * 1.0, ringY, cx + r * 1.0, ringY, accent[4])
      p.set(Math.round(cx - r * 1.0), ringY + 1, accent[2])
      p.set(Math.round(cx + r * 1.0), ringY + 1, accent[2])
      break
    }
    default:
      break
  }

  return finish(p, v.skin)
}

// ─────────────────────────────── Torso ───────────────────────────────

function drawTorso(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = Math.max(4, m.bodyW * RES)
  const h = Math.max(5, m.torsoH * RES)
  const p = part(w * 2.4, h * 1.5)
  const cx = Math.round(p.w / 2)
  const bottom = p.h - PAD
  const top = bottom - Math.round(h)

  const cloth = ramp(v.cloth)
  const cloth2 = ramp(v.cloth2)
  const metal = ramp(v.metal, { contrast: 1.15, hueShift: 0.02 })
  const skin = ramp(v.skin)
  const accent = ramp(v.accent)

  drawBackGear(p, v, m, cx, top, Math.round(h))

  const shoulderW = Math.round(w * 1.15)
  const waistW = Math.round(w * 0.86)

  // The trunk is a slight taper: wide at the shoulders, narrow at the waist.
  const trunk = (r: Ramp) => {
    for (let i = 0; i < Math.round(h); i += 1) {
      const t = i / Math.max(1, Math.round(h) - 1)
      const rowW = Math.round(shoulderW + (waistW - shoulderW) * t)
      const x = cx - (rowW >> 1)
      p.fill(x, top + i, rowW, 1, r[2])
      p.set(x, top + i, r[1])
      p.set(x + rowW - 1, top + i, r[3])
    }
    p.fill(cx - (shoulderW >> 1), top, shoulderW, 1, r[3])
  }

  switch (v.torso) {
    case 'bare':
      trunk(skin)
      // Chest and stomach definition, two shadow strokes only.
      p.line(cx - w * 0.2, top + h * 0.34, cx + w * 0.28, top + h * 0.3, skin[1])
      p.line(cx - w * 0.1, top + h * 0.58, cx + w * 0.2, top + h * 0.56, skin[1])
      break
    case 'fur':
      trunk(cloth)
      // Ragged hem and a shoulder pelt.
      for (let i = 0; i < shoulderW; i += 2) {
        p.set(cx - (shoulderW >> 1) + i, bottom, cloth[1])
      }
      p.ellipse(cx - w * 0.15, top + h * 0.2, w * 0.62, h * 0.24, cloth2[2])
      p.ellipse(cx - w * 0.05, top + h * 0.14, w * 0.5, h * 0.16, cloth2[3])
      break
    case 'robe':
      trunk(cloth)
      // Robes flare rather than taper, so widen the hem back out.
      for (let i = 0; i < Math.round(h * 0.35); i += 1) {
        const rowW = Math.round(waistW + i * 0.9)
        p.fill(cx - (rowW >> 1), bottom - Math.round(h * 0.35) + i, rowW, 1, cloth[2])
        p.set(cx - (rowW >> 1), bottom - Math.round(h * 0.35) + i, cloth[1])
      }
      p.line(cx + w * 0.05, top + h * 0.15, cx + w * 0.05, bottom - 1, cloth[1])
      p.fill(cx - w * 0.5, top + h * 0.62, w, 1, accent[3])
      break
    case 'mail': {
      trunk(metal)
      // Mail is read as texture, not as rings: a broken speckle over the base.
      for (let y = 1; y < Math.round(h) - 1; y += 2) {
        for (let x = -Math.round(w * 0.42); x < Math.round(w * 0.42); x += 2) {
          p.set(cx + x + (y % 4 === 1 ? 0 : 1), top + y, metal[1])
        }
      }
      p.fill(cx - waistW / 2, bottom - Math.max(1, h * 0.16), waistW, Math.max(1, h * 0.16), cloth2[2])
      break
    }
    case 'plate': {
      trunk(metal)
      // Pauldrons and a breastplate ridge give plate its unmistakable outline.
      p.ellipse(cx - shoulderW * 0.52, top + h * 0.14, w * 0.36, h * 0.18, metal[2])
      p.ellipse(cx + shoulderW * 0.52, top + h * 0.14, w * 0.36, h * 0.18, metal[3])
      p.line(cx + w * 0.08, top + 1, cx + w * 0.08, top + h * 0.72, metal[4])
      p.fill(cx - waistW / 2, top + h * 0.68, waistW, Math.max(1, h * 0.14), cloth2[2])
      p.fill(cx - w * 0.16, top + h * 0.3, Math.max(1, w * 0.3), Math.max(1, h * 0.16), accent[3])
      break
    }
    case 'coat':
      trunk(cloth)
      // Lapels and a centre seam.
      p.line(cx - w * 0.4, top + 1, cx + w * 0.02, top + h * 0.44, cloth[3])
      p.line(cx + w * 0.42, top + 1, cx + w * 0.04, top + h * 0.44, cloth[1])
      p.line(cx + w * 0.03, top + h * 0.44, cx + w * 0.03, bottom - 1, cloth[1])
      p.fill(cx - waistW / 2, top + h * 0.6, waistW, Math.max(1, h * 0.12), cloth2[1])
      p.set(Math.round(cx + w * 0.12), Math.round(top + h * 0.62), accent[4])
      break
    case 'vest':
      trunk(cloth)
      // Webbing: two pouches and a strap, the whole modern-infantry read.
      p.fill(cx - w * 0.46, top + h * 0.34, Math.round(w * 0.92), Math.max(2, h * 0.28), cloth2[2])
      p.fill(cx - w * 0.46, top + h * 0.34, Math.round(w * 0.92), 1, cloth2[3])
      p.fill(cx - w * 0.3, top + h * 0.4, Math.max(1, w * 0.22), Math.max(1, h * 0.18), cloth2[1])
      p.fill(cx + w * 0.08, top + h * 0.4, Math.max(1, w * 0.22), Math.max(1, h * 0.18), cloth2[1])
      p.line(cx - w * 0.2, top + 1, cx - w * 0.2, top + h * 0.34, cloth2[1])
      break
    case 'exo': {
      trunk(metal)
      // Hard-surface panelling with a glowing core.
      p.fill(cx - shoulderW / 2, top + h * 0.3, shoulderW, 1, metal[1])
      p.fill(cx - shoulderW / 2, top + h * 0.62, shoulderW, 1, metal[1])
      p.ellipse(cx + w * 0.05, top + h * 0.46, Math.max(1.2, w * 0.2), Math.max(1.2, h * 0.12), accent[4])
      p.ellipse(cx - shoulderW * 0.55, top + h * 0.12, w * 0.34, h * 0.2, metal[1])
      p.ellipse(cx + shoulderW * 0.55, top + h * 0.12, w * 0.34, h * 0.2, metal[3])
      break
    }
  }

  return finish(p, v.cloth)
}

/**
 * What a unit carries on its back. Drawn before the torso so it sits behind,
 * and kept to a strong silhouette — at this size a quiver is four pixels of
 * fletching and nothing more.
 */
function drawBackGear(p: Pix, v: UnitVisual, m: RigMetrics, cx: number, top: number, h: number): void {
  const w = Math.max(3, m.bodyW * RES)
  const cloth2 = ramp(v.cloth2)
  const metal = ramp(v.metal, { contrast: 1.15 })
  const accent = ramp(v.accent)
  const wood = ramp(0x7a5433)

  switch (v.weapon) {
    case 'bow':
    case 'sling': {
      // Quiver over the far shoulder, arrows showing above it.
      const qx = Math.round(cx - w * 0.85)
      box(p, qx, top + h * 0.18, Math.max(2, w * 0.3), h * 0.6, wood)
      for (let i = 0; i < 3; i += 1) {
        p.line(qx + i, top + h * 0.18, qx + i - 1, top - h * 0.12, i === 1 ? accent[3] : accent[2])
      }
      break
    }
    case 'musket':
    case 'rifle':
    case 'lmg': {
      const bx = Math.round(cx - w * 0.9)
      box(p, bx, top + h * 0.24, Math.max(2, w * 0.34), h * 0.46, cloth2)
      p.fill(bx, top + h * 0.42, Math.max(2, w * 0.34), 1, cloth2[1])
      break
    }
    case 'rpg': {
      const bx = Math.round(cx - w * 0.95)
      box(p, bx, top + h * 0.12, Math.max(2, w * 0.32), h * 0.7, metal)
      p.fill(bx, top + h * 0.3, Math.max(2, w * 0.32), 1, accent[3])
      break
    }
    case 'laser':
    case 'plasma':
    case 'railgun': {
      // Power cells, with the accent colour reading as charge.
      const bx = Math.round(cx - w * 0.9)
      box(p, bx, top + h * 0.2, Math.max(2, w * 0.36), h * 0.5, metal)
      p.fill(bx + 1, top + h * 0.28, Math.max(1, w * 0.2), Math.max(1, h * 0.32), accent[4])
      break
    }
    case 'sword':
    case 'saber':
    case 'axe': {
      // An empty scabbard hanging on the far hip.
      p.thickLine(cx - w * 0.55, top + h * 0.6, cx - w * 0.95, top + h * 1.05, 2, cloth2[1])
      break
    }
    case 'grenade': {
      const bx = Math.round(cx - w * 0.85)
      box(p, bx, top + h * 0.3, Math.max(2, w * 0.3), h * 0.38, cloth2)
      break
    }
    default:
      break
  }

  if (v.torso === 'exo') {
    // Backpack thrusters for powered armour.
    box(p, cx - w * 0.95, top + h * 0.16, Math.max(2, w * 0.34), h * 0.5, metal)
    p.fill(cx - w * 0.95, top + h * 0.6, Math.max(2, w * 0.34), 1, accent[4])
  }
}

// ─────────────────────────────── Limbs ───────────────────────────────

/**
 * An arm or leg, drawn hanging straight down from a pivot at the top. The
 * battle scene rotates these around that point, so the art is authored in one
 * neutral pose and the animation does the rest.
 */
function drawLimb(
  length: number,
  thickness: number,
  clothColor: number,
  endColor: number,
  stripe: number | null,
  boot: boolean
): Canvas2D {
  const L = Math.max(3, Math.round(length * RES))
  const T = Math.max(2, Math.round(thickness * RES))
  const p = part(T + 4, L + 3)
  const cx = Math.round(p.w / 2)
  const top = PAD

  const cloth = ramp(clothColor)
  const end = ramp(endColor)

  // Upper limb, tapering by a pixel toward the joint.
  for (let i = 0; i < L; i += 1) {
    const t = i / Math.max(1, L - 1)
    const rowW = Math.max(1, Math.round(T - (t > 0.55 ? 1 : 0)))
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, cloth[2])
    p.set(x + rowW - 1, top + i, cloth[3])
    p.set(x, top + i, cloth[1])
  }
  p.fill(cx - (T >> 1), top, T, 1, cloth[3])

  // Hand or boot at the far end.
  if (boot) {
    const bw = T + 2
    box(p, cx - (bw >> 1), top + L - Math.max(2, T * 0.7), bw, Math.max(2, T * 0.7), end)
    // Toe pointing the way the unit faces.
    p.fill(cx + (bw >> 1), top + L - 1, 2, 1, end[2])
  } else {
    orb(p, cx, top + L - T * 0.4, T * 0.6, T * 0.6, end)
  }

  if (stripe !== null) {
    const s = ramp(stripe)
    p.fill(cx - (T >> 1), top + Math.round(L * 0.45), T, 1, s[4])
  }

  return finish(p, clothColor)
}

// ─────────────────────────────── Weapons ───────────────────────────────

export interface WeaponArt {
  canvas: Canvas2D
  /** Where the hand grips the weapon, in canvas pixels. */
  grip: [number, number]
}

function drawWeapon(kind: WeaponVisual, v: UnitVisual, m: RigMetrics): WeaponArt | null {
  if (kind === 'none' || kind === 'fist') return null

  const s = m.height * RES
  const metal = ramp(v.metal, { contrast: 1.2, hueShift: 0.02 })
  const wood = ramp(0x7a5433)
  const dark = ramp(0x3a3f4a)
  const accent = ramp(v.accent)
  const cloth = ramp(v.cloth)

  switch (kind) {
    case 'club': {
      const L = Math.round(s * 0.5)
      const p = part(s * 0.3, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L, cx, PAD + L * 0.35, Math.max(2, s * 0.06), wood)
      // Heavy head, wider than the haft so the weight reads.
      orb(p, cx, PAD + L * 0.2, s * 0.11, s * 0.15, wood)
      for (let i = 0; i < 3; i += 1) {
        p.set(Math.round(cx - s * 0.09 + i * s * 0.09), Math.round(PAD + L * 0.14), dark[1])
      }
      return { canvas: finish(p, 0x7a5433), grip: [cx, PAD + L - 1] }
    }
    case 'spear':
    case 'lance': {
      const L = Math.round(s * (kind === 'lance' ? 0.95 : 0.85))
      const p = part(s * 0.22, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L, cx, PAD, Math.max(1, s * 0.045), wood)
      // Leaf-shaped head.
      p.poly(
        [
          [cx, PAD - 1],
          [cx + s * 0.055, PAD + L * 0.14],
          [cx, PAD + L * 0.2],
          [cx - s * 0.055, PAD + L * 0.14]
        ],
        metal[2]
      )
      p.line(cx, PAD - 1, cx + s * 0.055, PAD + L * 0.14, metal[3])
      if (kind === 'lance') p.fill(cx - s * 0.06, PAD + L * 0.24, Math.max(1, s * 0.12), Math.max(1, s * 0.05), cloth[2])
      return { canvas: finish(p, 0x7a5433), grip: [cx, PAD + L * 0.82] }
    }
    case 'sling': {
      const L = Math.round(s * 0.3)
      const p = part(s * 0.24, L)
      const cx = Math.round(p.w / 2)
      p.line(cx, PAD, cx - s * 0.06, PAD + L * 0.8, cloth[2])
      p.line(cx, PAD, cx + s * 0.06, PAD + L * 0.8, cloth[1])
      orb(p, cx, PAD + L * 0.88, s * 0.05, s * 0.045, ramp(0x8d8371))
      return { canvas: finish(p, v.cloth), grip: [cx, PAD] }
    }
    case 'bow': {
      const L = Math.round(s * 0.62)
      const p = part(s * 0.24, L)
      const cx = Math.round(p.w / 2 + s * 0.05)
      // The limbs curve forward; the string is a straight line behind them.
      for (let i = 0; i <= L; i += 1) {
        const t = i / L
        const bend = Math.sin(t * Math.PI) * s * 0.1
        p.set(Math.round(cx + bend), PAD + i, t < 0.12 || t > 0.88 ? wood[1] : wood[2])
        if (bend > 1) p.set(Math.round(cx + bend - 1), PAD + i, wood[3])
      }
      p.line(cx, PAD, cx, PAD + L, dark[3])
      return { canvas: finish(p, 0x7a5433), grip: [cx + Math.round(s * 0.1), PAD + L * 0.5] }
    }
    case 'sword':
    case 'saber': {
      const L = Math.round(s * 0.52)
      const p = part(s * 0.2, L)
      const cx = Math.round(p.w / 2)
      const curve = kind === 'saber' ? s * 0.06 : 0
      // Blade: a lit edge on the right, body, dark spine on the left.
      for (let i = 0; i < L * 0.78; i += 1) {
        const t = i / (L * 0.78)
        const off = Math.round(Math.sin(t * 1.5) * curve)
        p.set(cx + off, PAD + i, metal[2])
        p.set(cx + off + 1, PAD + i, metal[4])
        p.set(cx + off - 1, PAD + i, metal[1])
      }
      // Crossguard and grip.
      p.fill(cx - s * 0.075, PAD + L * 0.78, Math.max(2, s * 0.16), 1, metal[3])
      shaft(p, cx, PAD + L * 0.8, cx, PAD + L, Math.max(1, s * 0.035), dark)
      p.set(cx, Math.round(PAD + L), accent[3])
      return { canvas: finish(p, v.metal), grip: [cx, PAD + L * 0.9] }
    }
    case 'axe': {
      const L = Math.round(s * 0.55)
      const p = part(s * 0.3, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L, cx, PAD + L * 0.1, Math.max(1, s * 0.045), wood)
      // A crescent bit, hollow on the inside edge.
      p.poly(
        [
          [cx, PAD + L * 0.06],
          [cx + s * 0.14, PAD + L * 0.12],
          [cx + s * 0.15, PAD + L * 0.3],
          [cx, PAD + L * 0.32],
          [cx + s * 0.05, PAD + L * 0.2]
        ],
        metal[2]
      )
      p.line(cx + s * 0.14, PAD + L * 0.12, cx + s * 0.15, PAD + L * 0.3, metal[4])
      return { canvas: finish(p, v.metal), grip: [cx, PAD + L * 0.9] }
    }
    case 'staff': {
      const L = Math.round(s * 0.8)
      const p = part(s * 0.24, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L, cx, PAD + L * 0.14, Math.max(1, s * 0.045), wood)
      orb(p, cx, PAD + L * 0.1, s * 0.075, s * 0.075, accent)
      p.set(cx, Math.round(PAD + L * 0.1), accent[4])
      return { canvas: finish(p, 0x7a5433), grip: [cx, PAD + L * 0.85] }
    }
    case 'musket': {
      const L = Math.round(s * 0.72)
      const p = part(s * 0.22, L)
      const cx = Math.round(p.w / 2)
      // Barrel above the grip, stock below — long and thin.
      shaft(p, cx, PAD + L * 0.55, cx, PAD, Math.max(1, s * 0.045), dark)
      shaft(p, cx, PAD + L * 0.5, cx - s * 0.02, PAD + L, Math.max(2, s * 0.07), wood)
      p.fill(cx - s * 0.05, PAD + L * 0.5, Math.max(1, s * 0.1), 1, metal[3])
      return { canvas: finish(p, 0x3a3f4a), grip: [cx, PAD + L * 0.62] }
    }
    case 'rifle': {
      const L = Math.round(s * 0.66)
      const p = part(s * 0.26, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L * 0.5, cx, PAD, Math.max(1, s * 0.05), dark)
      box(p, cx - s * 0.06, PAD + L * 0.42, Math.max(2, s * 0.12), Math.max(3, L * 0.3), dark)
      // Magazine and stock.
      box(p, cx - s * 0.03, PAD + L * 0.7, Math.max(1, s * 0.06), Math.max(2, L * 0.16), dark)
      shaft(p, cx, PAD + L * 0.72, cx - s * 0.03, PAD + L, Math.max(2, s * 0.06), dark)
      p.set(cx, PAD + 1, metal[3])
      return { canvas: finish(p, 0x3a3f4a), grip: [cx, PAD + L * 0.6] }
    }
    case 'lmg': {
      const L = Math.round(s * 0.7)
      const p = part(s * 0.34, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L * 0.55, cx, PAD, Math.max(2, s * 0.07), dark)
      box(p, cx - s * 0.09, PAD + L * 0.45, Math.max(3, s * 0.18), Math.max(3, L * 0.3), dark)
      // Drum magazine — the shape that says machine gun at a glance.
      orb(p, cx - s * 0.1, PAD + L * 0.62, s * 0.09, s * 0.09, metal)
      p.fill(cx - s * 0.03, PAD + L * 0.08, Math.max(1, s * 0.06), 1, metal[1])
      return { canvas: finish(p, 0x3a3f4a), grip: [cx, PAD + L * 0.62] }
    }
    case 'grenade': {
      const p = part(s * 0.16, s * 0.2)
      const cx = Math.round(p.w / 2)
      const cy = Math.round(p.h / 2)
      orb(p, cx, cy, s * 0.06, s * 0.07, ramp(0x4b5a3a))
      p.fill(cx - 1, cy - s * 0.09, 2, Math.max(1, s * 0.03), metal[3])
      return { canvas: finish(p, 0x4b5a3a), grip: [cx, cy] }
    }
    case 'rpg': {
      const L = Math.round(s * 0.8)
      const p = part(s * 0.3, L)
      const cx = Math.round(p.w / 2)
      shaft(p, cx, PAD + L, cx, PAD + L * 0.22, Math.max(3, s * 0.09), dark)
      // Warhead: a cone at the muzzle end.
      p.poly(
        [
          [cx, PAD],
          [cx + s * 0.07, PAD + L * 0.22],
          [cx - s * 0.07, PAD + L * 0.22]
        ],
        accent[2]
      )
      p.line(cx, PAD, cx + s * 0.07, PAD + L * 0.22, accent[3])
      p.fill(cx - s * 0.09, PAD + L * 0.66, Math.max(2, s * 0.18), 1, dark[1])
      return { canvas: finish(p, 0x3a3f4a), grip: [cx, PAD + L * 0.74] }
    }
    case 'laser': {
      const L = Math.round(s * 0.6)
      const p = part(s * 0.26, L)
      const cx = Math.round(p.w / 2)
      box(p, cx - s * 0.06, PAD + L * 0.3, Math.max(2, s * 0.12), Math.max(3, L * 0.5), metal)
      shaft(p, cx, PAD + L * 0.34, cx, PAD, Math.max(2, s * 0.055), metal)
      // Emitter and charge strip.
      p.fill(cx - s * 0.03, PAD, Math.max(1, s * 0.06), Math.max(1, s * 0.04), accent[4])
      p.fill(cx - s * 0.05, PAD + L * 0.44, Math.max(1, s * 0.1), 1, accent[4])
      return { canvas: finish(p, v.metal), grip: [cx, PAD + L * 0.66] }
    }
    case 'plasma': {
      const L = Math.round(s * 0.62)
      const p = part(s * 0.34, L)
      const cx = Math.round(p.w / 2)
      box(p, cx - s * 0.08, PAD + L * 0.32, Math.max(3, s * 0.16), Math.max(3, L * 0.46), metal)
      shaft(p, cx, PAD + L * 0.36, cx, PAD + L * 0.08, Math.max(3, s * 0.08), metal)
      // A glowing containment sphere at the muzzle.
      orb(p, cx, PAD + L * 0.06, s * 0.08, s * 0.08, accent)
      p.set(cx, Math.round(PAD + L * 0.06), accent[4])
      return { canvas: finish(p, v.metal), grip: [cx, PAD + L * 0.68] }
    }
    case 'railgun': {
      const L = Math.round(s * 0.95)
      const p = part(s * 0.3, L)
      const cx = Math.round(p.w / 2)
      // Twin rails with the charge running between them.
      shaft(p, cx - s * 0.045, PAD + L * 0.55, cx - s * 0.045, PAD, Math.max(1, s * 0.035), metal)
      shaft(p, cx + s * 0.045, PAD + L * 0.55, cx + s * 0.045, PAD, Math.max(1, s * 0.035), metal)
      p.line(cx, PAD + L * 0.5, cx, PAD + L * 0.06, accent[4])
      box(p, cx - s * 0.08, PAD + L * 0.5, Math.max(3, s * 0.16), Math.max(3, L * 0.34), metal)
      shaft(p, cx, PAD + L * 0.78, cx - s * 0.03, PAD + L, Math.max(2, s * 0.06), metal)
      return { canvas: finish(p, v.metal), grip: [cx, PAD + L * 0.66] }
    }
    default:
      return null
  }
}

// ─────────────────────────────── Shields & capes ───────────────────────────────

function drawShield(kind: NonNullable<UnitVisual['shield']>, v: UnitVisual, m: RigMetrics): Canvas2D | null {
  if (kind === 'none') return null
  const s = m.height * RES
  const wood = ramp(0x8a6237)
  const metal = ramp(v.metal, { contrast: 1.2 })
  const accent = ramp(v.accent)

  switch (kind) {
    case 'wood': {
      const r = s * 0.15
      const p = part(r * 2.4, r * 2.4)
      const cx = Math.round(p.w / 2)
      const cy = Math.round(p.h / 2)
      orb(p, cx, cy, r, r, wood)
      // Planking and a metal boss.
      p.line(cx - r * 0.7, cy - r * 0.5, cx + r * 0.7, cy - r * 0.5, wood[1])
      p.line(cx - r * 0.7, cy + r * 0.5, cx + r * 0.7, cy + r * 0.5, wood[1])
      orb(p, cx, cy, r * 0.28, r * 0.28, metal)
      return finish(p, 0x8a6237)
    }
    case 'kite': {
      const w = s * 0.22
      const h = s * 0.34
      const p = part(w * 1.3, h * 1.2)
      const cx = Math.round(p.w / 2)
      const top = PAD
      p.poly(
        [
          [cx - w / 2, top],
          [cx + w / 2, top],
          [cx + w / 2, top + h * 0.55],
          [cx, top + h],
          [cx - w / 2, top + h * 0.55]
        ],
        metal[2]
      )
      p.line(cx + w / 2, top, cx + w / 2, top + h * 0.55, metal[3])
      p.line(cx - w / 2, top, cx - w / 2, top + h * 0.55, metal[1])
      // A heraldic bar so the shield is not a blank slab.
      p.fill(cx - w / 2, top + h * 0.28, w, Math.max(1, h * 0.12), accent[2])
      return finish(p, v.metal)
    }
    case 'tower': {
      const w = s * 0.26
      const h = s * 0.46
      const p = part(w * 1.3, h * 1.2)
      const cx = Math.round(p.w / 2)
      chamfer(p, cx - w / 2, PAD, w, h, metal)
      p.fill(cx - w / 2, PAD + h * 0.44, w, Math.max(1, h * 0.1), accent[2])
      p.line(cx, PAD + 1, cx, PAD + h - 2, metal[3])
      return finish(p, v.metal)
    }
    case 'energy': {
      const r = s * 0.2
      const p = part(r * 2.4, r * 2.6)
      const cx = Math.round(p.w / 2)
      const cy = Math.round(p.h / 2)
      // A hexagonal field: bright edge, sparse interior so it reads as see-through.
      const pts: [number, number][] = []
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.1])
      }
      for (let i = 0; i < 6; i += 1) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[(i + 1) % 6]
        p.line(ax, ay, bx, by, accent[4])
      }
      for (let y = -Math.round(r); y <= r; y += 2) {
        for (let x = -Math.round(r); x <= r; x += 2) {
          if ((x * x) / (r * r) + (y * y) / (r * r * 1.2) < 0.8) p.blend(cx + x, cy + y, v.accent, 0.4)
        }
      }
      return finish(p, v.accent)
    }
    default:
      return null
  }
}

function drawCape(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = Math.max(3, m.bodyW * RES * 0.95)
  const h = Math.max(5, m.torsoH * RES * 1.5)
  const p = part(w * 1.6, h * 1.15)
  const cx = Math.round(p.w / 2)
  const cloth = ramp(v.cloth2, { contrast: 1.1 })

  // Cloth widens as it falls and ends in a torn hem.
  for (let i = 0; i < h; i += 1) {
    const t = i / h
    const rowW = Math.max(2, Math.round(w * (0.62 + t * 0.75)))
    const x = cx - (rowW >> 1)
    p.fill(x, PAD + i, rowW, 1, cloth[2])
    p.set(x, PAD + i, cloth[1])
    p.set(x + rowW - 1, PAD + i, cloth[3])
    // A vertical fold, offset as the cloth falls.
    p.set(Math.round(cx + Math.sin(t * 2.2) * w * 0.28), PAD + i, cloth[1])
  }
  const hemW = Math.max(2, Math.round(w * 1.37))
  for (let i = 0; i < hemW; i += 3) p.set(cx - (hemW >> 1) + i, PAD + Math.round(h), cloth[1])

  return finish(p, v.cloth2)
}

// ─────────────────────────── Vehicles & machines ───────────────────────────

function drawVehicleBody(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = Math.max(8, m.height * 1.9 * (v.bulk ?? 1) * RES)
  const h = Math.max(5, m.height * 0.72 * RES)
  const p = part(w * 1.12, h * 1.5)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const metal = ramp(v.metal, { contrast: 1.2, hueShift: 0.02 })
  const wood = ramp(0x7a5433)
  const accent = ramp(v.accent)
  const dark = ramp(0x353b46)

  if (v.machine) {
    // A timber carriage shared by every wheeled war machine.
    const bw = Math.round(w * 0.78)
    const bh = Math.max(3, Math.round(h * 0.3))
    box(p, cx - bw / 2, cy + h * 0.12, bw, bh, wood)
    // Diagonal bracing.
    p.line(cx - bw * 0.4, cy + h * 0.12 + bh, cx + bw * 0.1, cy + h * 0.12, wood[1])
    p.line(cx + bw * 0.4, cy + h * 0.12 + bh, cx - bw * 0.1, cy + h * 0.12, wood[1])

    if (v.machine === 'cannon') {
      // A tapering barrel with a reinforcing band and a muzzle ring.
      const bl = Math.round(w * 0.72)
      const by = Math.round(cy - h * 0.12)
      for (let i = 0; i < bl; i += 1) {
        const t = i / bl
        const th = Math.max(2, Math.round(h * (0.3 - t * 0.1)))
        p.fill(cx - bl * 0.38 + i, by - (th >> 1), 1, th, metal[2])
        p.set(cx - bl * 0.38 + i, by - (th >> 1), metal[3])
        p.set(cx - bl * 0.38 + i, by + (th >> 1) - 1, metal[1])
      }
      p.fill(cx - bl * 0.05, by - h * 0.18, 1, Math.max(3, h * 0.36), metal[1])
      p.fill(cx + bl * 0.6, by - h * 0.13, 1, Math.max(3, h * 0.26), metal[4])
    } else if (v.machine === 'mortar') {
      // A short, fat tube angled up.
      const bl = Math.round(w * 0.4)
      for (let i = 0; i < bl; i += 1) {
        const t = i / bl
        const th = Math.max(3, Math.round(h * 0.42))
        const x = Math.round(cx - bl * 0.2 + i * 0.85)
        const y = Math.round(cy - h * 0.08 - i * 0.55)
        p.fill(x, y - (th >> 1), 1, th, t > 0.9 ? metal[4] : metal[2])
        p.set(x, y - (th >> 1), metal[3])
      }
      box(p, cx - w * 0.3, cy - h * 0.1, Math.max(3, w * 0.16), Math.max(3, h * 0.3), metal)
    } else {
      // Catapult: a throwing arm, a bucket and a taut rope.
      const armX = Math.round(cx - w * 0.1)
      p.thickLine(armX, cy + h * 0.12, armX - w * 0.3, cy - h * 0.55, Math.max(2, h * 0.1), wood[2])
      p.line(armX - 1, cy + h * 0.1, armX - w * 0.3 - 1, cy - h * 0.55, wood[3])
      orb(p, cx - w * 0.34, cy - h * 0.62, w * 0.08, h * 0.16, wood)
      p.line(cx + w * 0.3, cy + h * 0.12, cx - w * 0.28, cy - h * 0.5, dark[3])
      // Counterweight box at the back.
      box(p, cx + w * 0.16, cy - h * 0.16, Math.max(3, w * 0.16), Math.max(3, h * 0.3), wood)
    }
    return finish(p, v.metal)
  }

  // A powered hull: sloped glacis at the front, engine deck at the back.
  const hullH = Math.round(h * 0.62)
  const hullY = Math.round(cy - hullH * 0.35)
  p.poly(
    [
      [cx - w / 2, hullY + hullH],
      [cx - w / 2, hullY + hullH * 0.35],
      [cx - w * 0.28, hullY],
      [cx + w * 0.42, hullY],
      [cx + w / 2, hullY + hullH * 0.45],
      [cx + w / 2, hullY + hullH]
    ],
    metal[2]
  )
  p.line(cx - w * 0.28, hullY, cx + w * 0.42, hullY, metal[3])
  p.line(cx - w / 2, hullY + hullH * 0.35, cx - w * 0.28, hullY, metal[3])
  p.fill(cx - w / 2, hullY + hullH - 1, w, 1, metal[1])

  if (v.chassis === 'hover') {
    // A glowing skirt instead of a running gear.
    p.fill(cx - w * 0.44, hullY + hullH, Math.round(w * 0.88), 1, accent[4])
    for (let x = 0; x < w * 0.88; x += 3) p.set(Math.round(cx - w * 0.44 + x), hullY + hullH + 1, accent[2])
  }

  // Turret and gun for anything that is not a hauler.
  const tw = Math.round(w * 0.34)
  const th = Math.max(3, Math.round(h * 0.3))
  chamfer(p, cx - tw * 0.35, hullY - th, tw, th, metal)
  const barrelY = Math.round(hullY - th * 0.45)
  p.fill(cx + tw * 0.6, barrelY, Math.round(w * 0.32), Math.max(2, Math.round(h * 0.1)), metal[2])
  p.fill(cx + tw * 0.6, barrelY, Math.round(w * 0.32), 1, metal[3])
  p.fill(cx + tw * 0.6 + w * 0.3, barrelY - 1, 2, Math.max(3, h * 0.14), metal[1])

  // Panel lines and a faction stripe keep a large flat hull from going dead.
  p.line(cx - w * 0.1, hullY + 2, cx - w * 0.1, hullY + hullH - 2, metal[1])
  p.fill(cx + w * 0.16, hullY + hullH * 0.5, Math.max(2, w * 0.1), 1, accent[3])

  return finish(p, v.metal)
}

function drawWheel(v: UnitVisual, m: RigMetrics, kind: 'wheel' | 'road'): Canvas2D {
  const r = Math.max(2, m.height * (kind === 'wheel' ? 0.28 : 0.14) * RES)
  const p = part(r * 2.4, r * 2.4)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const wood = ramp(0x7a5433)
  const rubber = ramp(0x2c3038)
  const metal = ramp(v.metal, { contrast: 1.2 })

  if (kind === 'wheel') {
    // Spoked cartwheel: rim, hub, and spokes that survive at this size.
    p.ellipse(cx, cy, r, r, wood[2])
    p.ellipseFrame(cx, cy, r, r, wood[3])
    p.eraseEllipse(cx, cy, r * 0.72, r * 0.72)
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      p.line(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3, cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82, wood[2])
    }
    orb(p, cx, cy, r * 0.3, r * 0.3, metal)
  } else {
    orb(p, cx, cy, r, r, rubber)
    p.ellipse(cx, cy, r * 0.45, r * 0.45, metal[2])
  }
  return finish(p, kind === 'wheel' ? 0x7a5433 : 0x2c3038)
}

function drawTrackBelt(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = Math.max(8, m.height * 1.7 * (v.bulk ?? 1) * RES)
  const h = Math.max(3, m.height * 0.3 * RES)
  const p = part(w * 1.1, h * 1.6)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const rubber = ramp(0x2c3038)

  // A rounded belt with visible links.
  box(p, cx - w / 2, cy - h / 2, w, h, rubber)
  p.set(Math.round(cx - w / 2), Math.round(cy - h / 2), 0, 0)
  p.set(Math.round(cx + w / 2 - 1), Math.round(cy - h / 2), 0, 0)
  for (let x = 1; x < w - 1; x += 3) {
    p.fill(cx - w / 2 + x, cy - h / 2 + 1, 1, Math.max(1, h - 2), rubber[1])
  }
  return finish(p, 0x2c3038)
}

function drawMechLeg(v: UnitVisual, m: RigMetrics): Canvas2D {
  const L = Math.max(5, m.legLen * 1.06 * RES)
  const p = part(L * 0.7, L * 1.2)
  const cx = Math.round(p.w / 2)
  const metal = ramp(v.metal, { contrast: 1.2 })
  const accent = ramp(v.accent)

  // A digitigrade leg: heavy thigh forward, shin raked back, foot forward
  // again. The mass has to sit high or the machine looks like it is on stilts.
  const kneeY = PAD + L * 0.45
  const ankleY = PAD + L * 0.8
  shaft(p, cx, PAD, cx + L * 0.18, kneeY, Math.max(4, L * 0.3), metal)
  // Hip actuator.
  box(p, cx - L * 0.16, PAD, Math.max(3, L * 0.32), Math.max(3, L * 0.16), metal)
  shaft(p, cx + L * 0.18, kneeY, cx - L * 0.12, ankleY, Math.max(3, L * 0.2), metal)
  // Knee joint, and a piston running down the front of the shin.
  orb(p, cx + L * 0.18, kneeY, L * 0.16, L * 0.16, metal)
  p.line(cx + L * 0.3, kneeY + L * 0.04, cx + L * 0.02, ankleY - L * 0.06, metal[1])
  p.set(Math.round(cx + L * 0.18), Math.round(kneeY), accent[4])
  // A broad foot with a raised toe, so it plants instead of hovering.
  box(p, cx - L * 0.26, ankleY, Math.max(4, L * 0.54), Math.max(3, L * 0.16), metal)
  p.fill(cx + L * 0.24, ankleY - L * 0.06, Math.max(2, L * 0.1), Math.max(2, L * 0.1), metal[3])
  return finish(p, v.metal)
}

function drawAircraftBody(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = Math.max(10, m.height * 1.8 * RES)
  const h = Math.max(4, m.height * 0.5 * RES)
  const p = part(w * 1.15, h * 2)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const metal = ramp(v.metal, { contrast: 1.2, hueShift: 0.02 })
  const accent = ramp(v.accent)
  const glass = ramp(0x69b6d8)

  // Fuselage: a flat-bottomed hull with a chined spine and a blunt nose, so it
  // reads as a machine rather than as a fish. The bottom line stays straight —
  // that single horizontal is what makes an aircraft look engineered.
  const noseX = Math.round(cx + w * 0.5)
  const tailX = Math.round(cx - w * 0.5)
  const belly = Math.round(cy + h * 0.3)
  p.poly(
    [
      [tailX, belly - h * 0.12],
      [tailX + w * 0.1, cy - h * 0.42],
      [cx + w * 0.16, cy - h * 0.5],
      [noseX - w * 0.04, cy - h * 0.22],
      [noseX, cy + h * 0.06],
      [noseX - w * 0.1, belly],
      [tailX + w * 0.06, belly]
    ],
    metal[2]
  )
  // Lit spine and shadowed belly.
  p.line(tailX + w * 0.1, cy - h * 0.42, cx + w * 0.16, cy - h * 0.5, metal[3])
  p.line(cx + w * 0.16, cy - h * 0.5, noseX - w * 0.04, cy - h * 0.22, metal[4])
  p.fill(tailX + w * 0.06, belly - 1, Math.round(w * 0.84), 1, metal[1])
  // A panel seam breaks up the flank.
  p.line(tailX + w * 0.12, cy + h * 0.02, noseX - w * 0.12, cy + h * 0.02, metal[1])

  // Canopy, set into the spine rather than floating on it.
  p.poly(
    [
      [cx + w * 0.12, cy - h * 0.48],
      [cx + w * 0.34, cy - h * 0.42],
      [cx + w * 0.34, cy - h * 0.16],
      [cx + w * 0.1, cy - h * 0.2]
    ],
    glass[2]
  )
  p.line(cx + w * 0.12, cy - h * 0.48, cx + w * 0.34, cy - h * 0.42, glass[4])
  p.set(Math.round(cx + w * 0.3), Math.round(cy - h * 0.34), glass[4])

  // Tail fin and horizontal stabiliser.
  p.poly(
    [
      [tailX + w * 0.04, cy - h * 0.35],
      [tailX + w * 0.02, cy - h * 1.05],
      [tailX + w * 0.16, cy - h * 1.0],
      [tailX + w * 0.2, cy - h * 0.32]
    ],
    metal[2]
  )
  p.line(tailX + w * 0.02, cy - h * 1.05, tailX + w * 0.16, cy - h * 1.0, metal[3])
  p.fill(tailX, cy - h * 0.62, Math.max(3, w * 0.14), Math.max(1, h * 0.12), metal[1])

  if (v.chassis !== 'rotor') {
    // A swept wing seen edge-on, with a pylon and a stores pod beneath it.
    p.poly(
      [
        [cx - w * 0.24, cy + h * 0.16],
        [cx + w * 0.14, cy + h * 0.16],
        [cx + w * 0.02, cy + h * 0.34],
        [cx - w * 0.34, cy + h * 0.34]
      ],
      metal[1]
    )
    p.fill(cx - w * 0.12, belly, Math.max(2, w * 0.06), Math.max(2, h * 0.16), metal[1])
    p.fill(cx - w * 0.2, belly + h * 0.16, Math.max(3, w * 0.2), Math.max(2, h * 0.14), accent[2])
    p.fill(cx - w * 0.2, belly + h * 0.16, Math.max(3, w * 0.2), 1, accent[3])
  } else {
    // A rotor mast for the helicopter, so the blade has something to sit on.
    p.fill(cx - w * 0.02, cy - h * 0.72, Math.max(2, w * 0.05), Math.max(2, h * 0.26), metal[1])
    // Skids.
    p.fill(cx - w * 0.26, belly + h * 0.22, Math.round(w * 0.5), 1, metal[1])
    p.fill(cx - w * 0.18, belly, 1, Math.max(2, h * 0.22), metal[1])
    p.fill(cx + w * 0.16, belly, 1, Math.max(2, h * 0.22), metal[1])
  }

  // Engine exhaust glow at the tail, and a faction flash on the nose.
  p.fill(tailX + w * 0.02, cy - h * 0.16, Math.max(2, w * 0.05), Math.max(2, h * 0.2), accent[4])
  p.fill(noseX - w * 0.16, cy - h * 0.1, Math.max(2, w * 0.08), 1, accent[3])
  return finish(p, v.metal)
}

function drawRotor(v: UnitVisual, m: RigMetrics, span: number): Canvas2D {
  const L = Math.max(6, m.height * span * RES)
  const p = part(L, Math.max(3, L * 0.1))
  const cy = Math.round(p.h / 2)
  const dark = ramp(0x30353f)
  p.fill(PAD, cy, Math.round(L), 1, dark[2])
  p.fill(PAD, cy - 1, Math.round(L), 1, dark[3])
  // A hub so the blade does not read as a floating line.
  orb(p, Math.round(p.w / 2), cy, Math.max(1.5, L * 0.04), Math.max(1.5, L * 0.04), ramp(v.metal))
  return finish(p, 0x30353f)
}

function drawMount(v: UnitVisual, m: RigMetrics): { body: Canvas2D; leg: Canvas2D } {
  // Roughly 1.7 long to 1 deep. Any longer and the animal reads as a dachshund.
  const bodyW = Math.max(8, m.height * 0.78 * RES)
  const bodyH = Math.max(5, m.height * 0.42 * RES)
  const p = part(bodyW * 1.25, bodyH * 2.4)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h * 0.58)
  const hide = ramp(0x6a4a32, { contrast: 1.05 })
  const mane = ramp(0x3b2a1c)
  const cloth = ramp(v.cloth2)

  // Barrel of the body: deep at the chest, tucked at the flank, with the
  // withers rising toward the neck. An even ellipse reads as a sausage.
  for (let i = 0; i < bodyW; i += 1) {
    const t = i / bodyW
    const depth = 0.62 + Math.sin(Math.min(1, t * 1.12) * Math.PI) * 0.3 + t * 0.34
    const th = Math.max(3, Math.round(bodyH * depth))
    const lift = Math.round(bodyH * 0.14 * t)
    const x = Math.round(cx - bodyW / 2 + i)
    p.fill(x, cy - (th >> 1) - lift, 1, th, hide[2])
    p.set(x, cy - (th >> 1) - lift, hide[3])
    p.set(x, cy + th - (th >> 1) - 1 - lift, hide[1])
  }
  // Neck rising forward, then a long wedge head with a muzzle and ears.
  const neckX = Math.round(cx + bodyW * 0.32)
  const headY = Math.round(cy - bodyH * 1.05)
  shaft(p, neckX, cy - bodyH * 0.3, neckX + bodyW * 0.14, headY + bodyH * 0.1, Math.max(3, bodyH * 0.46), hide)
  const muzzleX = neckX + bodyW * 0.2
  p.poly(
    [
      [muzzleX - bodyW * 0.06, headY + bodyH * 0.22],
      [muzzleX + bodyW * 0.13, headY - bodyH * 0.02],
      [muzzleX + bodyW * 0.13, headY - bodyH * 0.24],
      [muzzleX - bodyW * 0.05, headY - bodyH * 0.3]
    ],
    hide[2]
  )
  p.line(muzzleX - bodyW * 0.05, headY - bodyH * 0.3, muzzleX + bodyW * 0.13, headY - bodyH * 0.24, hide[3])
  p.set(Math.round(muzzleX + bodyW * 0.11), Math.round(headY - bodyH * 0.06), mane[0])
  p.set(Math.round(muzzleX + bodyW * 0.03), Math.round(headY - bodyH * 0.16), mane[0])
  // Ears.
  p.line(muzzleX - bodyW * 0.04, headY - bodyH * 0.3, muzzleX - bodyW * 0.05, headY - bodyH * 0.5, hide[2])
  p.line(muzzleX + bodyW * 0.01, headY - bodyH * 0.3, muzzleX + bodyW * 0.02, headY - bodyH * 0.48, hide[3])
  // Mane down the neck, and a tail that falls and flicks.
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5
    p.line(
      neckX - bodyW * 0.04 + t * bodyW * 0.16,
      cy - bodyH * 0.42 - t * bodyH * 0.5,
      neckX - bodyW * 0.12 + t * bodyW * 0.16,
      cy - bodyH * 0.2 - t * bodyH * 0.42,
      i % 2 ? mane[1] : mane[2]
    )
  }
  for (let i = 0; i < 4; i += 1) {
    p.line(cx - bodyW * 0.5, cy - bodyH * 0.15 + i, cx - bodyW * 0.7, cy + bodyH * 0.45 + i * 1.2, i % 2 ? mane[1] : mane[2])
  }
  // Saddle blanket in the rider's colours.
  p.fill(cx - bodyW * 0.14, cy - bodyH * 0.66, Math.round(bodyW * 0.32), Math.max(2, bodyH * 0.24), cloth[2])
  p.fill(cx - bodyW * 0.14, cy - bodyH * 0.66, Math.round(bodyW * 0.32), 1, cloth[3])

  const legLen = Math.max(4, m.height * 0.3 * RES)
  const legPix = part(Math.max(3, legLen * 0.4), legLen * 1.15)
  const lcx = Math.round(legPix.w / 2)
  shaft(legPix, lcx, PAD, lcx - legLen * 0.1, PAD + legLen * 0.62, Math.max(2, legLen * 0.22), hide)
  shaft(legPix, lcx - legLen * 0.1, PAD + legLen * 0.62, lcx - legLen * 0.04, PAD + legLen, Math.max(1, legLen * 0.14), hide)
  legPix.fill(lcx - legLen * 0.12, PAD + legLen, Math.max(2, legLen * 0.2), 1, mane[1])

  return { body: finish(p, 0x6a4a32), leg: finish(legPix, 0x6a4a32) }
}

// ─────────────────────────────── Assembly ───────────────────────────────

export interface UnitPartSet {
  parts: Record<string, Canvas2D>
  metrics: RigMetrics
  /** Origins keyed by part name. */
  origins: Record<string, [number, number]>
}

/**
 * Produces every canvas a unit needs. The battle scene turns these into Phaser
 * textures once and then instances lightweight sprites per soldier.
 */
export function buildUnitArt(v: UnitVisual, height: number): UnitPartSet {
  const m = rigMetrics(height, v.bulk ?? 1)
  const parts: Record<string, Canvas2D> = {}
  const origins: Record<string, [number, number]> = {}

  const put = (name: string, canvas: Canvas2D | null, ox: number, oy: number) => {
    if (!canvas) return
    parts[name] = canvas
    origins[name] = [ox, oy]
  }

  // Weapons carry their own grip point, converted here to a sprite origin.
  const putWeapon = (art: WeaponArt | null) => {
    if (!art) return
    parts.weapon = art.canvas
    origins.weapon = [art.grip[0] / art.canvas.w, art.grip[1] / art.canvas.h]
  }

  const limbThickness = m.bodyW * 0.34
  const handColor = v.torso === 'exo' || v.torso === 'plate' ? v.metal : v.skin
  const sleeve = v.torso === 'bare' ? v.skin : v.cloth
  const legColor = v.torso === 'bare' || v.torso === 'fur' ? v.skin : v.cloth2
  const bootColor = v.torso === 'exo' || v.torso === 'plate' ? v.metal : tone(v.cloth2, -0.3)
  const accentStripe = v.torso === 'exo' ? v.accent : null

  if (v.kind === 'vehicle') {
    put('body', drawVehicleBody(v, m), 0.5, 0.5)
    if (v.chassis === 'wheels') put('wheel', drawWheel(v, m, 'wheel'), 0.5, 0.5)
    if (v.chassis === 'tracks') {
      put('wheel', drawWheel(v, m, 'road'), 0.5, 0.5)
      put('track', drawTrackBelt(v, m), 0.5, 0.5)
    }
    if (v.chassis === 'legs') put('leg', drawMechLeg(v, m), 0.5, 0.06)
    return { parts, metrics: m, origins }
  }

  if (v.kind === 'aircraft') {
    put('body', drawAircraftBody(v, m), 0.5, 0.5)
    put('rotor', drawRotor(v, m, v.chassis === 'rotor' ? 2.1 : 0.5), 0.5, 0.5)
    return { parts, metrics: m, origins }
  }

  if (v.kind === 'mech') {
    put('torso', drawTorso(v, m), 0.5, 1)
    put('head', drawHead(v, m), 0.5, 0.82)
    put('leg', drawMechLeg(v, m), 0.5, 0.06)
    put('arm', drawLimb(m.armLen * 1.1, limbThickness * 1.5, v.metal, v.metal, v.accent, false), 0.5, 0.08)
    putWeapon(drawWeapon(v.weapon, v, m))
    return { parts, metrics: m, origins }
  }

  // Humanoid and rider share the upper-body rig.
  put('torso', drawTorso(v, m), 0.5, 1)
  put('head', drawHead(v, m), 0.5, 0.82)
  put('armB', drawLimb(m.armLen, limbThickness, tone(sleeve, -0.28), tone(handColor, -0.2), accentStripe, false), 0.5, 0.09)
  put('armF', drawLimb(m.armLen, limbThickness, sleeve, handColor, accentStripe, false), 0.5, 0.09)

  if (v.kind === 'humanoid') {
    put('legB', drawLimb(m.legLen, limbThickness * 1.1, tone(legColor, -0.3), tone(bootColor, -0.25), null, true), 0.5, 0.07)
    put('legF', drawLimb(m.legLen, limbThickness * 1.1, legColor, bootColor, null, true), 0.5, 0.07)
  } else {
    const mount = drawMount(v, m)
    put('mount', mount.body, 0.5, 0.5)
    put('mountLeg', mount.leg, 0.5, 0.08)
  }

  putWeapon(drawWeapon(v.weapon, v, m))
  if (v.shield && v.shield !== 'none') put('shield', drawShield(v.shield, v, m), 0.5, 0.5)
  if (v.cape) put('cape', drawCape(v, m), 0.5, 0.06)

  return { parts, metrics: m, origins }
}

/**
 * The ground shadow every unit stands on, scaled per unit at runtime. Banded
 * rather than blurred, so it belongs to the same world as the sprites.
 */
export function buildShadowCanvas(): Canvas2D {
  const w = 48
  const h = 16
  const p = new Pix(w, h)
  const cx = w / 2
  const cy = h / 2
  p.ellipse(cx, cy, cx - 1, cy - 1, 0x000000, 70)
  p.ellipse(cx, cy, (cx - 1) * 0.68, (cy - 1) * 0.68, 0x000000, 60)
  p.ellipse(cx, cy, (cx - 1) * 0.36, (cy - 1) * 0.36, 0x000000, 55)
  return p.toCanvas() as Canvas2D
}
