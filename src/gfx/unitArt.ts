import type { UnitVisual, WeaponVisual } from '../data/types'
import { Canvas2D, contactShadow, css, ellipse, glow, grain, makeCanvas, plate, polygon, roundRect, shade } from './painter'

/** Supersampling factor: art is drawn at 2x and displayed at 0.5 scale. */
export const RES = 2

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
  /** Normalised origin used when the sprite is created. */
  originX: number
  originY: number
}

const PAD = 6 * RES

function newPart(w: number, h: number): Canvas2D {
  return makeCanvas(w + PAD * 2, h + PAD * 2)
}

// ─────────────────────────────── Body parts ───────────────────────────────

function drawHead(v: UnitVisual, m: RigMetrics): PartSpec['canvas'] {
  const r = m.headR * RES
  const c = newPart(r * 3.2, r * 3.4)
  const { ctx } = c
  const cx = c.w / 2
  const cy = c.h - PAD - r * 1.5

  // Skull.
  ellipse(ctx, cx, cy, r * 1.02, r * 1.16, v.skin, { outline: shade(v.skin, -0.55), outlineWidth: 1.6 })
  // Jaw shading and a hint of a face facing right.
  ctx.save()
  ctx.globalAlpha = 0.35
  ellipse(ctx, cx - r * 0.35, cy + r * 0.25, r * 0.72, r * 0.7, shade(v.skin, -0.32), { shaded: false })
  ctx.restore()
  // Eye, brow and a hint of a mouth, all facing right.
  ctx.fillStyle = css(shade(v.skin, -0.78), 0.9)
  ctx.beginPath()
  ctx.ellipse(cx + r * 0.34, cy - r * 0.1, r * 0.14, r * 0.18, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = css(shade(v.skin, -0.65), 0.75)
  ctx.lineWidth = Math.max(1.2, r * 0.11)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx + r * 0.16, cy - r * 0.36)
  ctx.lineTo(cx + r * 0.56, cy - r * 0.3)
  ctx.stroke()
  ctx.lineWidth = Math.max(1, r * 0.08)
  ctx.beginPath()
  ctx.moveTo(cx + r * 0.3, cy + r * 0.42)
  ctx.lineTo(cx + r * 0.58, cy + r * 0.4)
  ctx.stroke()

  switch (v.helmet) {
    case 'band': {
      ctx.fillStyle = css(v.cloth2)
      roundRect(ctx, cx - r * 1.05, cy - r * 0.58, r * 2.1, r * 0.4, r * 0.16)
      ctx.fill()
      break
    }
    case 'horns': {
      ctx.fillStyle = css(v.cloth2)
      roundRect(ctx, cx - r * 1.05, cy - r * 0.66, r * 2.1, r * 0.44, r * 0.18)
      ctx.fill()
      polygon(ctx, [
        [cx - r * 0.85, cy - r * 0.55],
        [cx - r * 1.55, cy - r * 1.5],
        [cx - r * 0.5, cy - r * 0.85]
      ], v.accent, { outline: shade(v.accent, -0.5), outlineWidth: 1.2 })
      polygon(ctx, [
        [cx + r * 0.85, cy - r * 0.55],
        [cx + r * 1.55, cy - r * 1.5],
        [cx + r * 0.5, cy - r * 0.85]
      ], v.accent, { outline: shade(v.accent, -0.5), outlineWidth: 1.2 })
      break
    }
    case 'hood': {
      polygon(ctx, [
        [cx - r * 1.2, cy + r * 0.9],
        [cx - r * 1.1, cy - r * 0.7],
        [cx - r * 0.2, cy - r * 1.45],
        [cx + r * 0.9, cy - r * 1.0],
        [cx + r * 1.05, cy + r * 0.1],
        [cx + r * 0.35, cy + r * 0.35],
        [cx + r * 0.1, cy - r * 0.3],
        [cx - r * 0.6, cy + r * 0.95]
      ], v.cloth, { outline: shade(v.cloth, -0.5), outlineWidth: 1.4 })
      break
    }
    case 'kettle': {
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(cx, cy - r * 0.28, r * 1.18, r * 0.98, 0, Math.PI, 0)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, cy - r * 1.3, 0, cy)
      g.addColorStop(0, css(shade(v.metal, 0.42)))
      g.addColorStop(1, css(shade(v.metal, -0.25)))
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = css(shade(v.metal, -0.55))
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = css(shade(v.metal, -0.1))
      roundRect(ctx, cx - r * 1.4, cy - r * 0.42, r * 2.8, r * 0.3, r * 0.12)
      ctx.fill()
      break
    }
    case 'great': {
      plate(ctx, cx - r * 1.05, cy - r * 1.25, r * 2.1, r * 2.3, r * 0.5, v.metal, {
        outline: shade(v.metal, -0.6),
        outlineWidth: 1.6
      })
      ctx.fillStyle = css(0x0b1020)
      roundRect(ctx, cx - r * 0.2, cy - r * 0.42, r * 1.25, r * 0.24, r * 0.1)
      ctx.fill()
      ctx.fillStyle = css(v.accent, 0.9)
      roundRect(ctx, cx - r * 0.1, cy - r * 1.35, r * 0.22, r * 0.6, r * 0.1)
      ctx.fill()
      break
    }
    case 'tricorn': {
      polygon(ctx, [
        [cx - r * 1.6, cy - r * 0.45],
        [cx - r * 0.3, cy - r * 1.5],
        [cx + r * 1.4, cy - r * 0.9],
        [cx + r * 1.1, cy - r * 0.25],
        [cx - r * 0.9, cy - r * 0.1]
      ], v.cloth2, { outline: shade(v.cloth2, -0.55), outlineWidth: 1.4 })
      ctx.fillStyle = css(v.accent)
      ctx.beginPath()
      ctx.arc(cx + r * 0.55, cy - r * 0.85, r * 0.2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'kepi': {
      plate(ctx, cx - r * 1.0, cy - r * 1.15, r * 2.0, r * 0.8, r * 0.22, v.cloth2, {
        outline: shade(v.cloth2, -0.5)
      })
      ctx.fillStyle = css(shade(v.cloth2, -0.35))
      roundRect(ctx, cx + r * 0.4, cy - r * 0.48, r * 1.35, r * 0.22, r * 0.1)
      ctx.fill()
      break
    }
    case 'combat': {
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(cx, cy - r * 0.12, r * 1.16, r * 1.06, 0, Math.PI * 1.02, Math.PI * 2.02)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, cy - r * 1.2, 0, cy + r * 0.2)
      g.addColorStop(0, css(shade(v.cloth, 0.34)))
      g.addColorStop(1, css(shade(v.cloth, -0.32)))
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = css(shade(v.cloth, -0.6))
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = css(shade(v.cloth, -0.45))
      roundRect(ctx, cx - r * 0.6, cy + r * 0.05, r * 1.5, r * 0.22, r * 0.08)
      ctx.fill()
      break
    }
    case 'visor': {
      plate(ctx, cx - r * 1.08, cy - r * 1.2, r * 2.16, r * 2.1, r * 0.62, v.metal, {
        outline: shade(v.metal, -0.6),
        outlineWidth: 1.6
      })
      const vg = ctx.createLinearGradient(cx - r, cy - r * 0.4, cx + r, cy + r * 0.2)
      vg.addColorStop(0, css(shade(v.accent, 0.5)))
      vg.addColorStop(1, css(shade(v.accent, -0.35)))
      ctx.fillStyle = vg
      roundRect(ctx, cx - r * 0.35, cy - r * 0.55, r * 1.4, r * 0.5, r * 0.2)
      ctx.fill()
      glow(ctx, cx + r * 0.4, cy - r * 0.3, r * 1.1, v.accent, 0.5)
      break
    }
    case 'halo': {
      ctx.strokeStyle = css(v.accent, 0.9)
      ctx.lineWidth = r * 0.16
      ctx.beginPath()
      ctx.ellipse(cx, cy - r * 1.5, r * 1.05, r * 0.3, 0, 0, Math.PI * 2)
      ctx.stroke()
      glow(ctx, cx, cy - r * 1.5, r * 1.5, v.accent, 0.4)
      break
    }
    case 'none':
    default: {
      // Simple hair mass so bare heads still read.
      ctx.fillStyle = css(shade(v.cloth2, -0.2))
      ctx.beginPath()
      ctx.ellipse(cx - r * 0.15, cy - r * 0.55, r * 1.0, r * 0.62, 0, Math.PI, 0)
      ctx.fill()
      break
    }
  }

  grain(c, 0.05)
  return c
}

function drawTorso(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = m.bodyW * RES
  const h = m.torsoH * RES
  const c = newPart(w * 1.5, h * 1.15)
  const { ctx } = c
  const cx = c.w / 2
  const top = c.h - PAD - h

  const shoulderW = w * (v.torso === 'plate' || v.torso === 'exo' ? 1.28 : 1.1)
  const waistW = w * 0.86

  const shape: [number, number][] = [
    [cx - shoulderW / 2, top + h * 0.06],
    [cx - shoulderW * 0.42, top],
    [cx + shoulderW * 0.42, top],
    [cx + shoulderW / 2, top + h * 0.06],
    [cx + waistW / 2, top + h],
    [cx - waistW / 2, top + h]
  ]

  const bodyColor = v.torso === 'bare' ? v.skin : v.cloth
  polygon(ctx, shape, bodyColor, { outline: shade(bodyColor, -0.55), outlineWidth: 1.6 })

  switch (v.torso) {
    case 'fur': {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(shape[0][0], shape[0][1])
      shape.slice(1).forEach(p => ctx.lineTo(p[0], p[1]))
      ctx.closePath()
      ctx.clip()
      ctx.fillStyle = css(v.cloth2, 0.85)
      for (let i = 0; i < 7; i += 1) {
        const y = top + h * (0.2 + i * 0.11)
        ctx.beginPath()
        ctx.ellipse(cx + (i % 2 ? -1 : 1) * w * 0.16, y, w * 0.34, h * 0.07, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      break
    }
    case 'mail': {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(shape[0][0], shape[0][1])
      shape.slice(1).forEach(p => ctx.lineTo(p[0], p[1]))
      ctx.closePath()
      ctx.clip()
      ctx.strokeStyle = css(shade(v.metal, -0.15), 0.55)
      ctx.lineWidth = 1
      const step = Math.max(3, w * 0.13)
      for (let y = top; y < top + h; y += step) {
        for (let x = cx - shoulderW / 2; x < cx + shoulderW / 2; x += step) {
          ctx.beginPath()
          ctx.arc(x + ((Math.round(y / step) % 2) * step) / 2, y, step * 0.32, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.restore()
      // Tabard.
      ctx.fillStyle = css(v.cloth2, 0.9)
      roundRect(ctx, cx - w * 0.2, top + h * 0.22, w * 0.4, h * 0.76, 2)
      ctx.fill()
      break
    }
    case 'plate':
    case 'exo': {
      plate(ctx, cx - shoulderW * 0.5, top, shoulderW, h * 0.52, h * 0.16, v.metal, {
        outline: shade(v.metal, -0.6),
        outlineWidth: 1.4
      })
      plate(ctx, cx - waistW * 0.5, top + h * 0.5, waistW, h * 0.5, h * 0.1, shade(v.metal, -0.12), {
        outline: shade(v.metal, -0.6),
        outlineWidth: 1.4
      })
      // Pauldrons.
      ellipse(ctx, cx - shoulderW * 0.48, top + h * 0.12, w * 0.28, h * 0.19, v.metal, {
        outline: shade(v.metal, -0.6),
        outlineWidth: 1.4
      })
      ellipse(ctx, cx + shoulderW * 0.48, top + h * 0.12, w * 0.28, h * 0.19, v.metal, {
        outline: shade(v.metal, -0.6),
        outlineWidth: 1.4
      })
      if (v.torso === 'exo') {
        ctx.fillStyle = css(v.accent, 0.95)
        roundRect(ctx, cx - w * 0.12, top + h * 0.2, w * 0.24, h * 0.2, w * 0.1)
        ctx.fill()
        glow(ctx, cx, top + h * 0.3, w * 0.6, v.accent, 0.7)
      } else {
        ctx.fillStyle = css(v.accent, 0.9)
        roundRect(ctx, cx - w * 0.1, top + h * 0.22, w * 0.2, h * 0.18, 2)
        ctx.fill()
      }
      break
    }
    case 'robe': {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(shape[0][0], shape[0][1])
      shape.slice(1).forEach(p => ctx.lineTo(p[0], p[1]))
      ctx.closePath()
      ctx.clip()
      ctx.strokeStyle = css(shade(v.cloth, -0.3), 0.6)
      ctx.lineWidth = 1.4
      for (let i = 1; i < 4; i += 1) {
        ctx.beginPath()
        ctx.moveTo(cx - shoulderW * 0.4 + (i * shoulderW * 0.8) / 4, top)
        ctx.lineTo(cx - waistW * 0.4 + (i * waistW * 0.8) / 4, top + h)
        ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = css(v.cloth2, 0.95)
      roundRect(ctx, cx - w * 0.16, top + h * 0.04, w * 0.32, h * 0.94, 2)
      ctx.fill()
      break
    }
    case 'coat': {
      ctx.fillStyle = css(shade(v.cloth, -0.25))
      roundRect(ctx, cx - w * 0.06, top + h * 0.04, w * 0.12, h * 0.92, 2)
      ctx.fill()
      // Cross-belts.
      ctx.strokeStyle = css(v.cloth2)
      ctx.lineWidth = Math.max(2, w * 0.11)
      ctx.beginPath()
      ctx.moveTo(cx - shoulderW * 0.34, top + h * 0.08)
      ctx.lineTo(cx + waistW * 0.34, top + h * 0.72)
      ctx.stroke()
      ctx.fillStyle = css(v.metal)
      roundRect(ctx, cx - waistW * 0.5, top + h * 0.7, waistW, h * 0.14, 2)
      ctx.fill()
      break
    }
    case 'vest': {
      plate(ctx, cx - shoulderW * 0.46, top + h * 0.08, shoulderW * 0.92, h * 0.62, h * 0.08, shade(v.cloth, -0.3), {
        outline: shade(v.cloth, -0.65),
        outlineWidth: 1.3
      })
      ctx.fillStyle = css(shade(v.cloth2, -0.1))
      for (let i = 0; i < 3; i += 1) {
        roundRect(ctx, cx - shoulderW * 0.3 + i * shoulderW * 0.24, top + h * 0.24, shoulderW * 0.17, h * 0.2, 2)
        ctx.fill()
      }
      break
    }
    case 'bare':
    default:
      break
  }

  drawBackGear(ctx, v, cx, top, h, shoulderW)
  grain(c, 0.045)
  return c
}

/**
 * Kit slung on a soldier's back. Units face right, so this all hangs off the
 * left edge of the torso where it stays visible without hiding the weapon.
 */
function drawBackGear(
  ctx: CanvasRenderingContext2D,
  v: UnitVisual,
  cx: number,
  top: number,
  h: number,
  shoulderW: number
): void {
  const backX = cx - shoulderW * 0.52

  switch (v.weapon) {
    case 'bow': {
      // Quiver with fletched arrows poking over the shoulder.
      plate(ctx, backX - h * 0.09, top + h * 0.08, h * 0.17, h * 0.6, h * 0.05, 0x6b4a2b, {
        outline: 0x2c2118,
        outlineWidth: 1.4,
        specular: 0.15
      })
      ctx.strokeStyle = css(0xe4e0d0)
      ctx.lineWidth = 2
      for (let i = -1; i <= 1; i += 1) {
        const x = backX + i * h * 0.05
        ctx.beginPath()
        ctx.moveTo(x, top + h * 0.1)
        ctx.lineTo(x - h * 0.03, top - h * 0.12)
        ctx.stroke()
      }
      break
    }
    case 'rifle':
    case 'lmg':
    case 'rpg': {
      // Webbing pack with a bedroll.
      plate(ctx, backX - h * 0.11, top + h * 0.14, h * 0.24, h * 0.46, h * 0.06, shade(v.cloth, -0.28), {
        outline: shade(v.cloth, -0.7),
        outlineWidth: 1.5,
        specular: 0.1
      })
      plate(ctx, backX - h * 0.13, top + h * 0.1, h * 0.28, h * 0.1, h * 0.05, shade(v.cloth2, -0.1), {
        outline: shade(v.cloth, -0.7),
        outlineWidth: 1.3,
        specular: 0.12
      })
      break
    }
    case 'laser':
    case 'railgun':
    case 'plasma': {
      // Power cell with an emissive strip and a feed line to the weapon.
      plate(ctx, backX - h * 0.1, top + h * 0.12, h * 0.22, h * 0.44, h * 0.07, shade(v.metal, -0.3), {
        outline: shade(v.metal, -0.75),
        outlineWidth: 1.5,
        specular: 0.6
      })
      ctx.fillStyle = css(v.accent, 0.95)
      roundRect(ctx, backX - h * 0.05, top + h * 0.18, h * 0.12, h * 0.06, h * 0.03)
      ctx.fill()
      glow(ctx, backX + h * 0.01, top + h * 0.21, h * 0.22, v.accent, 0.7)
      ctx.strokeStyle = css(shade(v.metal, -0.45))
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(backX + h * 0.06, top + h * 0.3)
      ctx.quadraticCurveTo(cx, top + h * 0.52, cx + shoulderW * 0.4, top + h * 0.34)
      ctx.stroke()
      break
    }
    case 'musket':
    case 'saber':
    case 'grenade': {
      // Powder horn and a haversack.
      ellipse(ctx, backX, top + h * 0.34, h * 0.09, h * 0.13, 0x8a6b3f, {
        outline: 0x2c2118,
        outlineWidth: 1.4
      })
      break
    }
    case 'sword':
    case 'axe': {
      // Scabbard belted across the back.
      ctx.save()
      ctx.translate(backX, top + h * 0.55)
      ctx.rotate(-0.5)
      plate(ctx, -h * 0.06, -h * 0.3, h * 0.12, h * 0.6, h * 0.05, 0x4a3524, {
        outline: 0x241a10,
        outlineWidth: 1.4,
        specular: 0.15
      })
      ctx.restore()
      break
    }
    default:
      break
  }
}

function drawLimb(
  length: number,
  thickness: number,
  color: number,
  endColor: number,
  accent: number | null,
  isLeg: boolean
): Canvas2D {
  const L = length * RES
  const T = thickness * RES
  const c = newPart(T * 2.2, L * 1.12)
  const { ctx } = c
  const cx = c.w / 2
  const top = PAD

  plate(ctx, cx - T / 2, top, T, L * 0.98, T * 0.45, color, {
    outline: shade(color, -0.6),
    outlineWidth: 1.4
  })
  // Joint highlight.
  ellipse(ctx, cx, top + L * 0.48, T * 0.42, T * 0.34, shade(color, -0.18), { shaded: false })

  if (isLeg) {
    // Boot.
    polygon(ctx, [
      [cx - T * 0.55, top + L * 0.86],
      [cx + T * 0.55, top + L * 0.86],
      [cx + T * 1.0, top + L * 1.02],
      [cx + T * 1.0, top + L * 1.12],
      [cx - T * 0.6, top + L * 1.12]
    ], endColor, { outline: shade(endColor, -0.6), outlineWidth: 1.4 })
  } else {
    ellipse(ctx, cx, top + L * 1.0, T * 0.56, T * 0.5, endColor, {
      outline: shade(endColor, -0.6),
      outlineWidth: 1.4
    })
  }

  if (accent !== null) {
    ctx.fillStyle = css(accent, 0.9)
    roundRect(ctx, cx - T * 0.18, top + L * 0.16, T * 0.36, L * 0.12, T * 0.16)
    ctx.fill()
  }

  grain(c, 0.04)
  return c
}

// ─────────────────────────────── Weapons ───────────────────────────────

export interface WeaponArt {
  canvas: Canvas2D
  /** Grip point in canvas pixels — where the hand holds the weapon. */
  grip: [number, number]
}

/**
 * Weapons are drawn pointing right. Each one reports the exact pixel its user
 * grips it by, so the sprite pins to the hand no matter how it is shaped.
 */
function drawWeapon(kind: WeaponVisual, v: UnitVisual, m: RigMetrics): WeaponArt | null {
  if (kind === 'none' || kind === 'fist') return null
  const s = m.height * RES
  const wood = 0x6b4a2b
  const dark = 0x2c2118

  switch (kind) {
    case 'club': {
      const c = newPart(s * 0.62, s * 0.24)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.03, s * 0.34, s * 0.06, s * 0.03, wood, { outline: dark })
      polygon(ctx, [
        [PAD + s * 0.3, y - s * 0.1],
        [PAD + s * 0.56, y - s * 0.12],
        [PAD + s * 0.62, y],
        [PAD + s * 0.56, y + s * 0.12],
        [PAD + s * 0.3, y + s * 0.1]
      ], shade(wood, 0.12), { outline: dark, outlineWidth: 1.5 })
      ctx.fillStyle = css(v.metal)
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath()
        ctx.arc(PAD + s * (0.4 + i * 0.05), y + (i % 2 ? -s * 0.05 : s * 0.05), s * 0.018, 0, Math.PI * 2)
        ctx.fill()
      }
      return { canvas: c, grip: [PAD, c.h / 2] }
    }
    case 'spear': {
      const c = newPart(s * 0.95, s * 0.14)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.018, s * 0.82, s * 0.036, s * 0.018, wood, { outline: dark })
      polygon(ctx, [
        [PAD + s * 0.78, y - s * 0.05],
        [PAD + s * 0.95, y],
        [PAD + s * 0.78, y + s * 0.05],
        [PAD + s * 0.82, y]
      ], v.metal, { outline: shade(v.metal, -0.6), outlineWidth: 1.4 })
      return { canvas: c, grip: [PAD + s * 0.22, c.h / 2] }
    }
    case 'sling': {
      const c = newPart(s * 0.3, s * 0.3)
      const { ctx } = c
      ctx.strokeStyle = css(0x6b5a40)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(PAD, c.h / 2)
      ctx.quadraticCurveTo(PAD + s * 0.16, c.h / 2 + s * 0.18, PAD + s * 0.26, c.h / 2 + s * 0.04)
      ctx.stroke()
      ellipse(ctx, PAD + s * 0.2, c.h / 2 + s * 0.13, s * 0.05, s * 0.04, 0x8a8378)
      return { canvas: c, grip: [PAD, c.h / 2] }
    }
    case 'bow': {
      const c = newPart(s * 0.28, s * 0.62)
      const { ctx } = c
      const cx = PAD + s * 0.1
      ctx.strokeStyle = css(shade(wood, 0.15))
      ctx.lineWidth = Math.max(2, s * 0.025)
      ctx.beginPath()
      ctx.arc(cx - s * 0.12, c.h / 2, s * 0.28, -Math.PI * 0.42, Math.PI * 0.42)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(240,238,228,0.85)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(cx + s * 0.0, c.h / 2 - s * 0.25)
      ctx.lineTo(cx + s * 0.02, c.h / 2)
      ctx.lineTo(cx + s * 0.0, c.h / 2 + s * 0.25)
      ctx.stroke()
      return { canvas: c, grip: [PAD + s * 0.1, c.h / 2] }
    }
    case 'sword': {
      const c = newPart(s * 0.58, s * 0.2)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.022, s * 0.1, s * 0.044, s * 0.02, dark, {})
      ctx.fillStyle = css(v.metal)
      roundRect(ctx, PAD + s * 0.08, y - s * 0.075, s * 0.035, s * 0.15, 2)
      ctx.fill()
      polygon(ctx, [
        [PAD + s * 0.11, y - s * 0.035],
        [PAD + s * 0.5, y - s * 0.028],
        [PAD + s * 0.58, y],
        [PAD + s * 0.5, y + s * 0.028],
        [PAD + s * 0.11, y + s * 0.035]
      ], v.metal, { outline: shade(v.metal, -0.6), outlineWidth: 1.3 })
      ctx.strokeStyle = css(shade(v.metal, 0.55), 0.7)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(PAD + s * 0.13, y)
      ctx.lineTo(PAD + s * 0.5, y)
      ctx.stroke()
      return { canvas: c, grip: [PAD + s * 0.05, c.h / 2] }
    }
    case 'saber': {
      const c = newPart(s * 0.56, s * 0.26)
      const { ctx } = c
      const y = c.h / 2 + s * 0.05
      plate(ctx, PAD, y - s * 0.02, s * 0.09, s * 0.04, s * 0.018, dark, {})
      ctx.strokeStyle = css(v.metal)
      ctx.lineWidth = Math.max(2, s * 0.035)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(PAD + s * 0.1, y)
      ctx.quadraticCurveTo(PAD + s * 0.34, y - s * 0.12, PAD + s * 0.55, y - s * 0.16)
      ctx.stroke()
      ctx.strokeStyle = css(shade(v.metal, 0.5), 0.8)
      ctx.lineWidth = 1
      ctx.stroke()
      return { canvas: c, grip: [PAD + s * 0.05, c.h / 2 + s * 0.05] }
    }
    case 'axe': {
      const c = newPart(s * 0.5, s * 0.3)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.02, s * 0.44, s * 0.04, s * 0.02, wood, { outline: dark })
      polygon(ctx, [
        [PAD + s * 0.3, y - s * 0.02],
        [PAD + s * 0.5, y - s * 0.14],
        [PAD + s * 0.5, y + s * 0.14],
        [PAD + s * 0.3, y + s * 0.02]
      ], v.metal, { outline: shade(v.metal, -0.6), outlineWidth: 1.4 })
      return { canvas: c, grip: [PAD + s * 0.04, c.h / 2] }
    }
    case 'lance': {
      const c = newPart(s * 1.15, s * 0.16)
      const { ctx } = c
      const y = c.h / 2
      polygon(ctx, [
        [PAD, y - s * 0.05],
        [PAD + s * 1.06, y - s * 0.012],
        [PAD + s * 1.15, y],
        [PAD + s * 1.06, y + s * 0.012],
        [PAD, y + s * 0.05]
      ], shade(wood, 0.2), { outline: dark, outlineWidth: 1.4 })
      ctx.fillStyle = css(v.accent)
      roundRect(ctx, PAD + s * 0.12, y - s * 0.055, s * 0.05, s * 0.11, 1)
      ctx.fill()
      return { canvas: c, grip: [PAD + s * 0.22, c.h / 2] }
    }
    case 'staff': {
      const c = newPart(s * 0.24, s * 0.7)
      const { ctx } = c
      const cx = PAD + s * 0.08
      plate(ctx, cx - s * 0.016, PAD, s * 0.032, s * 0.66, s * 0.016, wood, { outline: dark })
      ellipse(ctx, cx, PAD + s * 0.04, s * 0.06, s * 0.06, v.accent, { outline: shade(v.accent, -0.5) })
      glow(ctx, cx, PAD + s * 0.04, s * 0.16, v.accent, 0.85)
      return { canvas: c, grip: [PAD + s * 0.08, PAD + s * 0.32] }
    }
    case 'musket': {
      const c = newPart(s * 0.85, s * 0.22)
      const { ctx } = c
      const y = c.h / 2
      polygon(ctx, [
        [PAD, y + s * 0.02],
        [PAD + s * 0.02, y - s * 0.045],
        [PAD + s * 0.24, y - s * 0.035],
        [PAD + s * 0.24, y + s * 0.05]
      ], wood, { outline: dark, outlineWidth: 1.3 })
      plate(ctx, PAD + s * 0.2, y - s * 0.028, s * 0.65, s * 0.05, s * 0.014, shade(wood, -0.1), { outline: dark })
      plate(ctx, PAD + s * 0.42, y - s * 0.022, s * 0.43, s * 0.03, s * 0.012, 0x50565e, { outline: 0x20242a })
      ctx.fillStyle = css(0x3a3f46)
      roundRect(ctx, PAD + s * 0.28, y + s * 0.012, s * 0.05, s * 0.06, 1)
      ctx.fill()
      return { canvas: c, grip: [PAD + s * 0.14, c.h / 2] }
    }
    case 'grenade': {
      const c = newPart(s * 0.26, s * 0.26)
      const { ctx } = c
      ellipse(ctx, PAD + s * 0.1, c.h / 2, s * 0.075, s * 0.085, 0x3d4a35, { outline: 0x1c2418, outlineWidth: 1.4 })
      ctx.strokeStyle = css(0x2a3226)
      ctx.lineWidth = 1.2
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath()
        ctx.moveTo(PAD + s * 0.1 - s * 0.07, c.h / 2 + i * s * 0.035)
        ctx.lineTo(PAD + s * 0.1 + s * 0.07, c.h / 2 + i * s * 0.035)
        ctx.stroke()
      }
      ctx.fillStyle = css(0x8a8070)
      roundRect(ctx, PAD + s * 0.08, c.h / 2 - s * 0.12, s * 0.04, s * 0.05, 1)
      ctx.fill()
      return { canvas: c, grip: [PAD + s * 0.1, c.h / 2] }
    }
    case 'rifle': {
      const c = newPart(s * 0.72, s * 0.24)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.04, s * 0.2, s * 0.075, s * 0.02, 0x33372f, { outline: 0x14170f })
      plate(ctx, PAD + s * 0.16, y - s * 0.03, s * 0.34, s * 0.06, s * 0.015, 0x3b4038, { outline: 0x14170f })
      plate(ctx, PAD + s * 0.45, y - s * 0.017, s * 0.27, s * 0.026, s * 0.01, 0x484e44, { outline: 0x14170f })
      ctx.fillStyle = css(0x22261f)
      roundRect(ctx, PAD + s * 0.22, y + s * 0.03, s * 0.06, s * 0.09, 1)
      ctx.fill()
      roundRect(ctx, PAD + s * 0.3, y - s * 0.09, s * 0.14, s * 0.055, 1)
      ctx.fill()
      return { canvas: c, grip: [PAD + s * 0.16, c.h / 2] }
    }
    case 'lmg': {
      const c = newPart(s * 0.8, s * 0.3)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.045, s * 0.22, s * 0.085, s * 0.02, 0x2f332c, { outline: 0x12150f })
      plate(ctx, PAD + s * 0.18, y - s * 0.038, s * 0.4, s * 0.075, s * 0.016, 0x383d34, { outline: 0x12150f })
      plate(ctx, PAD + s * 0.52, y - s * 0.02, s * 0.28, s * 0.036, s * 0.01, 0x4a5046, { outline: 0x12150f })
      ellipse(ctx, PAD + s * 0.32, y + s * 0.06, s * 0.075, s * 0.06, 0x545b4c, { outline: 0x12150f, outlineWidth: 1.3 })
      // Barrel shroud vents.
      ctx.fillStyle = css(0x1a1e16)
      for (let i = 0; i < 5; i += 1) {
        roundRect(ctx, PAD + s * (0.56 + i * 0.045), y - s * 0.014, s * 0.018, s * 0.028, 1)
        ctx.fill()
      }
      return { canvas: c, grip: [PAD + s * 0.18, c.h / 2] }
    }
    case 'rpg': {
      const c = newPart(s * 0.86, s * 0.3)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.03, s * 0.62, s * 0.06, s * 0.03, 0x4a4a3e, { outline: 0x191a13 })
      polygon(ctx, [
        [PAD, y - s * 0.03],
        [PAD - 0, y + s * 0.03],
        [PAD - s * 0.0, y + s * 0.03]
      ], 0x333, {})
      // Warhead.
      polygon(ctx, [
        [PAD + s * 0.58, y - s * 0.055],
        [PAD + s * 0.78, y - s * 0.03],
        [PAD + s * 0.86, y],
        [PAD + s * 0.78, y + s * 0.03],
        [PAD + s * 0.58, y + s * 0.055]
      ], v.accent, { outline: shade(v.accent, -0.55), outlineWidth: 1.4 })
      ctx.fillStyle = css(0x2b2b22)
      roundRect(ctx, PAD + s * 0.22, y + s * 0.03, s * 0.06, s * 0.09, 1)
      ctx.fill()
      return { canvas: c, grip: [PAD + s * 0.22, c.h / 2] }
    }
    case 'laser': {
      const c = newPart(s * 0.74, s * 0.26)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.04, s * 0.26, s * 0.08, s * 0.03, 0x3a4468, { outline: 0x161c34 })
      plate(ctx, PAD + s * 0.22, y - s * 0.03, s * 0.36, s * 0.06, s * 0.02, 0x54619a, { outline: 0x161c34 })
      plate(ctx, PAD + s * 0.52, y - s * 0.018, s * 0.22, s * 0.036, s * 0.014, 0x8f9fd8, { outline: 0x161c34 })
      ctx.fillStyle = css(v.accent, 0.95)
      roundRect(ctx, PAD + s * 0.26, y - s * 0.012, s * 0.28, s * 0.024, s * 0.012)
      ctx.fill()
      glow(ctx, PAD + s * 0.72, y, s * 0.12, v.accent, 0.9)
      return { canvas: c, grip: [PAD + s * 0.16, c.h / 2] }
    }
    case 'plasma': {
      const c = newPart(s * 0.78, s * 0.34)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.055, s * 0.34, s * 0.11, s * 0.04, 0x3c4478, { outline: 0x171d3c })
      ellipse(ctx, PAD + s * 0.42, y, s * 0.13, s * 0.11, 0x5a68b0, { outline: 0x171d3c, outlineWidth: 1.6 })
      plate(ctx, PAD + s * 0.5, y - s * 0.045, s * 0.28, s * 0.09, s * 0.03, 0x8b9ade, { outline: 0x171d3c })
      ctx.fillStyle = css(v.accent, 0.95)
      ctx.beginPath()
      ctx.arc(PAD + s * 0.42, y, s * 0.06, 0, Math.PI * 2)
      ctx.fill()
      glow(ctx, PAD + s * 0.42, y, s * 0.22, v.accent, 1)
      glow(ctx, PAD + s * 0.78, y, s * 0.13, v.accent, 0.8)
      return { canvas: c, grip: [PAD + s * 0.2, c.h / 2] }
    }
    case 'railgun': {
      const c = newPart(s * 1.0, s * 0.3)
      const { ctx } = c
      const y = c.h / 2
      plate(ctx, PAD, y - s * 0.05, s * 0.3, s * 0.1, s * 0.03, 0x333c60, { outline: 0x141a30 })
      plate(ctx, PAD + s * 0.24, y - s * 0.062, s * 0.76, s * 0.028, s * 0.012, 0x9fb0dc, { outline: 0x141a30 })
      plate(ctx, PAD + s * 0.24, y + s * 0.034, s * 0.76, s * 0.028, s * 0.012, 0x9fb0dc, { outline: 0x141a30 })
      ctx.fillStyle = css(v.accent, 0.8)
      roundRect(ctx, PAD + s * 0.3, y - s * 0.016, s * 0.66, s * 0.032, s * 0.016)
      ctx.fill()
      glow(ctx, PAD + s * 0.98, y, s * 0.16, v.accent, 0.9)
      return { canvas: c, grip: [PAD + s * 0.18, c.h / 2] }
    }
    default:
      return null
  }
}

function drawShield(kind: NonNullable<UnitVisual['shield']>, v: UnitVisual, m: RigMetrics): Canvas2D | null {
  if (kind === 'none') return null
  const s = m.height * RES
  const c = newPart(s * 0.3, s * 0.44)
  const { ctx } = c
  const cx = c.w / 2
  const cy = c.h / 2

  if (kind === 'wood') {
    ellipse(ctx, cx, cy, s * 0.13, s * 0.16, 0x7a5a34, { outline: 0x33230f, outlineWidth: 2 })
    ctx.strokeStyle = css(0x5a4126, 0.8)
    ctx.lineWidth = 1.4
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath()
      ctx.moveTo(cx + i * s * 0.045, cy - s * 0.15)
      ctx.lineTo(cx + i * s * 0.045, cy + s * 0.15)
      ctx.stroke()
    }
    ellipse(ctx, cx, cy, s * 0.035, s * 0.035, 0x9c8f78, { outline: 0x33230f })
  } else if (kind === 'kite') {
    polygon(ctx, [
      [cx - s * 0.11, cy - s * 0.19],
      [cx + s * 0.11, cy - s * 0.19],
      [cx + s * 0.11, cy + s * 0.06],
      [cx, cy + s * 0.21],
      [cx - s * 0.11, cy + s * 0.06]
    ], v.cloth, { outline: shade(v.cloth, -0.6), outlineWidth: 2 })
    ctx.fillStyle = css(v.accent, 0.9)
    roundRect(ctx, cx - s * 0.022, cy - s * 0.15, s * 0.044, s * 0.28, 1)
    ctx.fill()
    roundRect(ctx, cx - s * 0.085, cy - s * 0.09, s * 0.17, s * 0.04, 1)
    ctx.fill()
  } else if (kind === 'tower') {
    plate(ctx, cx - s * 0.12, cy - s * 0.21, s * 0.24, s * 0.42, s * 0.03, v.metal, {
      outline: shade(v.metal, -0.6),
      outlineWidth: 2
    })
  } else {
    // Energy barrier.
    ctx.save()
    const g = ctx.createLinearGradient(cx - s * 0.14, 0, cx + s * 0.14, 0)
    g.addColorStop(0, css(v.accent, 0.15))
    g.addColorStop(0.5, css(v.accent, 0.5))
    g.addColorStop(1, css(v.accent, 0.15))
    ctx.fillStyle = g
    roundRect(ctx, cx - s * 0.13, cy - s * 0.22, s * 0.26, s * 0.44, s * 0.1)
    ctx.fill()
    ctx.strokeStyle = css(v.accent, 0.95)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
    glow(ctx, cx, cy, s * 0.26, v.accent, 0.55)
  }
  return c
}

function drawCape(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = m.bodyW * RES * 1.1
  const h = m.torsoH * RES * 1.5
  const c = newPart(w * 1.6, h * 1.1)
  const { ctx } = c
  const cx = c.w / 2
  polygon(ctx, [
    [cx - w * 0.42, PAD],
    [cx + w * 0.42, PAD],
    [cx + w * 0.62, PAD + h * 0.96],
    [cx, PAD + h * 0.82],
    [cx - w * 0.62, PAD + h * 0.96]
  ], v.cloth2, { outline: shade(v.cloth2, -0.6), outlineWidth: 1.5 })
  grain(c, 0.05)
  return c
}

// ─────────────────────────── Vehicles & machines ───────────────────────────

function drawVehicleBody(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = m.height * 1.9 * (v.bulk ?? 1) * RES
  const h = m.height * 0.72 * RES
  const c = newPart(w, h * 1.1)
  const { ctx } = c
  const left = PAD
  const top = PAD

  if (v.chassis === 'tracks') {
    // Hull.
    polygon(ctx, [
      [left + w * 0.06, top + h * 0.5],
      [left + w * 0.2, top + h * 0.24],
      [left + w * 0.62, top + h * 0.2],
      [left + w * 0.66, top + h * 0.44],
      [left + w * 0.96, top + h * 0.5],
      [left + w * 0.96, top + h * 0.66],
      [left + w * 0.04, top + h * 0.66]
    ], v.metal, { outline: shade(v.metal, -0.65), outlineWidth: 2 })
    // Turret.
    plate(ctx, left + w * 0.26, top + h * 0.06, w * 0.34, h * 0.24, h * 0.07, shade(v.metal, 0.08), {
      outline: shade(v.metal, -0.65),
      outlineWidth: 2
    })
    // Hatch + details.
    ellipse(ctx, left + w * 0.36, top + h * 0.08, w * 0.05, h * 0.04, shade(v.metal, -0.2), { shaded: false })
    ctx.fillStyle = css(v.accent, 0.8)
    roundRect(ctx, left + w * 0.3, top + h * 0.5, w * 0.12, h * 0.05, 2)
    ctx.fill()
  } else if (v.chassis === 'wheels') {
    // Timber carriage shared by every wheeled war machine.
    polygon(ctx, [
      [left + w * 0.14, top + h * 0.5],
      [left + w * 0.86, top + h * 0.44],
      [left + w * 0.88, top + h * 0.6],
      [left + w * 0.16, top + h * 0.68]
    ], v.metal, { outline: shade(v.metal, -0.6), outlineWidth: 2 })

    if (v.machine === 'cannon') {
      // Trunnion mount plus a long iron barrel.
      polygon(ctx, [
        [left + w * 0.2, top + h * 0.46],
        [left + w * 0.34, top + h * 0.2],
        [left + w * 0.44, top + h * 0.22],
        [left + w * 0.32, top + h * 0.5]
      ], shade(v.metal, -0.25), { outline: shade(v.metal, -0.65), outlineWidth: 1.6 })
      plate(ctx, left + w * 0.3, top + h * 0.2, w * 0.62, h * 0.13, h * 0.06, 0x4a4a44, {
        outline: 0x16160f,
        outlineWidth: 2
      })
      plate(ctx, left + w * 0.28, top + h * 0.17, w * 0.14, h * 0.19, h * 0.07, 0x3c3c36, {
        outline: 0x16160f,
        outlineWidth: 2
      })
      ellipse(ctx, left + w * 0.36, top + h * 0.265, w * 0.05, h * 0.06, 0x5c5c52, {
        outline: 0x16160f,
        outlineWidth: 1.6
      })
    } else if (v.machine === 'mortar') {
      // Short tube angled steeply upward on a base plate.
      polygon(ctx, [
        [left + w * 0.3, top + h * 0.5],
        [left + w * 0.44, top + h * 0.08],
        [left + w * 0.58, top + h * 0.12],
        [left + w * 0.46, top + h * 0.52]
      ], 0x4e5346, { outline: 0x191c15, outlineWidth: 2 })
      plate(ctx, left + w * 0.24, top + h * 0.5, w * 0.34, h * 0.1, 3, 0x3c4038, {
        outline: 0x191c15,
        outlineWidth: 1.8
      })
      polygon(ctx, [
        [left + w * 0.56, top + h * 0.52],
        [left + w * 0.78, top + h * 0.34],
        [left + w * 0.82, top + h * 0.42],
        [left + w * 0.6, top + h * 0.6]
      ], shade(v.metal, -0.3), { outline: 0x191c15, outlineWidth: 1.6 })
    } else {
      // Catapult: A-frame, torsion bundle and a loaded throwing arm.
      polygon(ctx, [
        [left + w * 0.26, top + h * 0.62],
        [left + w * 0.4, top + h * 0.16],
        [left + w * 0.48, top + h * 0.18],
        [left + w * 0.36, top + h * 0.64]
      ], shade(v.metal, -0.15), { outline: shade(v.metal, -0.65), outlineWidth: 1.8 })
      polygon(ctx, [
        [left + w * 0.5, top + h * 0.62],
        [left + w * 0.42, top + h * 0.18],
        [left + w * 0.5, top + h * 0.16],
        [left + w * 0.6, top + h * 0.6]
      ], shade(v.metal, -0.28), { outline: shade(v.metal, -0.65), outlineWidth: 1.8 })
      ellipse(ctx, left + w * 0.44, top + h * 0.19, w * 0.05, h * 0.06, 0x6b5a3f, {
        outline: 0x2c2118,
        outlineWidth: 1.6
      })
      // Throwing arm reaching back over the frame, with a stone in the sling.
      polygon(ctx, [
        [left + w * 0.44, top + h * 0.22],
        [left + w * 0.1, top + h * 0.02],
        [left + w * 0.14, top + h * 0.12],
        [left + w * 0.46, top + h * 0.3]
      ], shade(0x6b4a2b, 0.16), { outline: 0x2c2118, outlineWidth: 1.8 })
      ellipse(ctx, left + w * 0.11, top + h * 0.09, w * 0.06, h * 0.09, 0x8a8378, {
        outline: 0x3d382f,
        outlineWidth: 1.6
      })
      // Winch rope.
      ctx.strokeStyle = css(0xd8cbae, 0.75)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(left + w * 0.13, top + h * 0.12)
      ctx.lineTo(left + w * 0.7, top + h * 0.5)
      ctx.stroke()
    }
  } else if (v.chassis === 'legs') {
    plate(ctx, left + w * 0.24, top + h * 0.12, w * 0.5, h * 0.4, h * 0.12, v.metal, {
      outline: shade(v.metal, -0.65),
      outlineWidth: 2
    })
    ctx.fillStyle = css(v.accent, 0.85)
    roundRect(ctx, left + w * 0.34, top + h * 0.22, w * 0.18, h * 0.08, 3)
    ctx.fill()
  }

  grain(c, 0.05)
  return c
}

function drawWheel(v: UnitVisual, m: RigMetrics, kind: 'wheel' | 'road'): Canvas2D {
  const r = m.height * (kind === 'wheel' ? 0.28 : 0.14) * RES
  const c = newPart(r * 2.2, r * 2.2)
  const { ctx } = c
  const cx = c.w / 2
  const cy = c.h / 2
  if (kind === 'wheel') {
    ellipse(ctx, cx, cy, r, r, 0x6b4a2b, { outline: 0x2c2118, outlineWidth: 2.4 })
    ellipse(ctx, cx, cy, r * 0.74, r * 0.74, 0x8a6b3f, { outline: 0x2c2118, outlineWidth: 1.6 })
    ctx.strokeStyle = css(0x4a3220)
    ctx.lineWidth = Math.max(2, r * 0.12)
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72)
      ctx.stroke()
    }
    ellipse(ctx, cx, cy, r * 0.16, r * 0.16, 0x3a2a1a, { shaded: false })
  } else {
    ellipse(ctx, cx, cy, r, r, shade(v.metal, -0.3), { outline: 0x14170f, outlineWidth: 2 })
    ellipse(ctx, cx, cy, r * 0.5, r * 0.5, shade(v.metal, 0.1), { outline: 0x14170f, outlineWidth: 1.4 })
  }
  return c
}

function drawTrackBelt(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = m.height * 1.7 * (v.bulk ?? 1) * RES
  const h = m.height * 0.3 * RES
  const c = newPart(w, h)
  const { ctx } = c
  plate(ctx, PAD, PAD, w, h, h * 0.45, shade(v.metal, -0.45), {
    outline: 0x101208,
    outlineWidth: 2
  })
  ctx.fillStyle = css(0x14170f, 0.8)
  const links = 14
  for (let i = 0; i < links; i += 1) {
    roundRect(ctx, PAD + (i + 0.2) * (w / links), PAD + h * 0.12, (w / links) * 0.55, h * 0.76, 2)
    ctx.fill()
  }
  return c
}

function drawMechLeg(v: UnitVisual, m: RigMetrics): Canvas2D {
  // Matches the humanoid hip height so the foot lands exactly on the ground.
  const L = m.legLen * 1.06 * RES
  // Bulk only partly widens the legs, or a heavy mech reads as a single slab.
  const T = m.height * 0.105 * (1 + ((v.bulk ?? 1) - 1) * 0.45) * RES
  const c = newPart(T * 2.6, L * 1.2)
  const { ctx } = c
  const cx = c.w / 2
  plate(ctx, cx - T * 0.5, PAD, T, L * 0.52, T * 0.3, v.metal, {
    outline: shade(v.metal, -0.65),
    outlineWidth: 1.8
  })
  plate(ctx, cx - T * 0.38, PAD + L * 0.46, T * 0.76, L * 0.4, T * 0.24, shade(v.metal, -0.15), {
    outline: shade(v.metal, -0.65),
    outlineWidth: 1.8
  })
  polygon(ctx, [
    [cx - T * 0.7, PAD + L * 0.84],
    [cx + T * 0.9, PAD + L * 0.84],
    [cx + T * 1.05, PAD + L * 1.02],
    [cx - T * 0.85, PAD + L * 1.02]
  ], shade(v.metal, -0.3), { outline: shade(v.metal, -0.7), outlineWidth: 1.8 })
  ellipse(ctx, cx, PAD + L * 0.46, T * 0.3, T * 0.3, v.accent, { outline: shade(v.metal, -0.6) })
  grain(c, 0.04)
  return c
}

function drawAircraftBody(v: UnitVisual, m: RigMetrics): Canvas2D {
  const w = m.height * 2.2 * (v.bulk ?? 1) * RES
  const h = m.height * 0.8 * RES
  const c = newPart(w, h)
  const { ctx } = c
  const left = PAD
  const top = PAD

  if (v.chassis === 'rotor') {
    // Fuselage.
    polygon(ctx, [
      [left + w * 0.08, top + h * 0.5],
      [left + w * 0.22, top + h * 0.3],
      [left + w * 0.56, top + h * 0.28],
      [left + w * 0.72, top + h * 0.4],
      [left + w * 0.98, top + h * 0.46],
      [left + w * 0.98, top + h * 0.54],
      [left + w * 0.66, top + h * 0.62],
      [left + w * 0.2, top + h * 0.66]
    ], v.metal, { outline: shade(v.metal, -0.65), outlineWidth: 2 })
    // Canopy.
    polygon(ctx, [
      [left + w * 0.1, top + h * 0.48],
      [left + w * 0.2, top + h * 0.33],
      [left + w * 0.34, top + h * 0.33],
      [left + w * 0.34, top + h * 0.55]
    ], v.accent, { outline: shade(v.metal, -0.6), outlineWidth: 1.6 })
    // Tail fin.
    polygon(ctx, [
      [left + w * 0.9, top + h * 0.46],
      [left + w * 0.99, top + h * 0.12],
      [left + w * 1.0, top + h * 0.44]
    ], shade(v.metal, -0.15), { outline: shade(v.metal, -0.65), outlineWidth: 1.6 })
    // Weapon pylons.
    plate(ctx, left + w * 0.3, top + h * 0.64, w * 0.26, h * 0.08, 3, shade(v.metal, -0.3), {
      outline: shade(v.metal, -0.7)
    })
    // Rotor mast.
    plate(ctx, left + w * 0.4, top + h * 0.18, w * 0.04, h * 0.14, 2, shade(v.metal, -0.2), {})
  } else {
    // Quad drone frame.
    plate(ctx, left + w * 0.34, top + h * 0.4, w * 0.32, h * 0.2, h * 0.09, v.metal, {
      outline: shade(v.metal, -0.65),
      outlineWidth: 2
    })
    ctx.strokeStyle = css(shade(v.metal, -0.3))
    ctx.lineWidth = Math.max(2, h * 0.05)
    ctx.beginPath()
    ctx.moveTo(left + w * 0.36, top + h * 0.46)
    ctx.lineTo(left + w * 0.14, top + h * 0.3)
    ctx.moveTo(left + w * 0.64, top + h * 0.46)
    ctx.lineTo(left + w * 0.86, top + h * 0.3)
    ctx.moveTo(left + w * 0.36, top + h * 0.54)
    ctx.lineTo(left + w * 0.16, top + h * 0.66)
    ctx.moveTo(left + w * 0.64, top + h * 0.54)
    ctx.lineTo(left + w * 0.84, top + h * 0.66)
    ctx.stroke()
    ellipse(ctx, left + w * 0.5, top + h * 0.5, w * 0.05, h * 0.07, v.accent, { outline: shade(v.metal, -0.6) })
    glow(ctx, left + w * 0.5, top + h * 0.5, w * 0.12, v.accent, 0.7)
  }
  grain(c, 0.045)
  return c
}

function drawRotor(v: UnitVisual, m: RigMetrics, span: number): Canvas2D {
  const w = m.height * span * RES
  const h = m.height * 0.1 * RES
  const c = newPart(w, h)
  const { ctx } = c
  plate(ctx, PAD, PAD + h * 0.34, w, h * 0.32, h * 0.16, shade(v.metal, -0.35), {
    outline: 0x0d1018,
    outlineWidth: 1.4
  })
  ctx.fillStyle = css(shade(v.metal, 0.3), 0.5)
  roundRect(ctx, PAD + w * 0.44, PAD + h * 0.2, w * 0.12, h * 0.6, h * 0.2)
  ctx.fill()
  return c
}

function drawMount(v: UnitVisual, m: RigMetrics): { body: Canvas2D; leg: Canvas2D } {
  const w = m.height * 1.15 * RES
  const h = m.height * 0.52 * RES
  const c = newPart(w, h)
  const { ctx } = c
  const left = PAD
  const top = PAD
  const isBeast = v.chassis === 'beast'
  const hide = isBeast ? mixHide(v) : 0x6b4a2b

  // Body mass.
  ellipse(ctx, left + w * 0.48, top + h * 0.5, w * 0.34, h * 0.28, hide, {
    outline: shade(hide, -0.6),
    outlineWidth: 2
  })
  // Neck + head reaching forward-right.
  polygon(ctx, [
    [left + w * 0.7, top + h * 0.42],
    [left + w * 0.9, top + h * 0.18],
    [left + w * 1.0, top + h * 0.24],
    [left + w * 0.84, top + h * 0.52]
  ], hide, { outline: shade(hide, -0.6), outlineWidth: 1.8 })
  ellipse(ctx, left + w * 0.95, top + h * 0.22, w * 0.09, h * 0.1, shade(hide, 0.08), {
    outline: shade(hide, -0.6),
    outlineWidth: 1.6
  })
  ctx.fillStyle = css(0x120d08)
  ctx.beginPath()
  ctx.arc(left + w * 0.99, top + h * 0.2, w * 0.014, 0, Math.PI * 2)
  ctx.fill()
  // Tail.
  ctx.strokeStyle = css(shade(hide, -0.15))
  ctx.lineWidth = Math.max(3, h * 0.1)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(left + w * 0.16, top + h * 0.44)
  ctx.quadraticCurveTo(left + w * 0.02, top + h * (isBeast ? 0.3 : 0.62), left + w * 0.0, top + h * (isBeast ? 0.5 : 0.78))
  ctx.stroke()

  if (isBeast) {
    // Dorsal crest.
    ctx.fillStyle = css(v.accent)
    for (let i = 0; i < 5; i += 1) {
      const x = left + w * (0.34 + i * 0.09)
      polygon(ctx, [
        [x, top + h * 0.26],
        [x + w * 0.03, top + h * 0.12],
        [x + w * 0.06, top + h * 0.26]
      ], v.accent, { gradient: false })
    }
  } else {
    // Barding.
    ctx.fillStyle = css(v.cloth, 0.9)
    roundRect(ctx, left + w * 0.3, top + h * 0.46, w * 0.32, h * 0.3, 3)
    ctx.fill()
  }

  grain(c, 0.05)

  const legLen = m.height * 0.3
  const leg = drawLimb(legLen, m.height * 0.075, shade(hide, -0.08), shade(hide, -0.35), null, true)
  return { body: c, leg }
}

function mixHide(v: UnitVisual): number {
  return shade(v.accent, -0.35)
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
  const bootColor = v.torso === 'exo' || v.torso === 'plate' ? v.metal : shade(v.cloth2, -0.3)
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
  put('armB', drawLimb(m.armLen, limbThickness, shade(sleeve, -0.28), shade(handColor, -0.2), accentStripe, false), 0.5, 0.09)
  put('armF', drawLimb(m.armLen, limbThickness, sleeve, handColor, accentStripe, false), 0.5, 0.09)

  if (v.kind === 'humanoid') {
    put('legB', drawLimb(m.legLen, limbThickness * 1.1, shade(legColor, -0.3), shade(bootColor, -0.25), null, true), 0.5, 0.07)
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

/** A ground shadow blob shared by all units, scaled per unit at runtime. */
export function buildShadowCanvas(): Canvas2D {
  const c = makeCanvas(96, 32)
  contactShadow(c.ctx, 48, 16, 46, 15)
  return c
}
