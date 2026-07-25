import type { ProjectileId } from '../data/types'
import type { Faction } from '../sim/types'
import { AGE_THEMES } from './palette'
import { Canvas2D, css, ellipse, fbm, glow, grain, makeCanvas, plate, polygon, roundRect, shade } from './painter'

export const BASE_W = 200
export const BASE_H = 250

/** Where turrets mount on the base, in base-local coordinates (origin = centre bottom). */
export const TURRET_SLOT_OFFSETS: [number, number][] = [
  [0, -BASE_H * 0.92],
  [-BASE_W * 0.3, -BASE_H * 0.66],
  [BASE_W * 0.3, -BASE_H * 0.66]
]

/**
 * A fortress per age. Drawn facing right for the player and mirrored at
 * runtime for the enemy, so both silhouettes read as "my side / their side".
 */
export function drawBase(age: number, faction: Faction): Canvas2D {
  const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
  const body = faction === 'player' ? theme.playerStructure : theme.enemyStructure
  const trim = faction === 'player' ? 0x3d8bff : 0xff5646
  const c = makeCanvas(BASE_W * 1.5, BASE_H * 1.5)
  const { ctx } = c
  const W = c.w
  const H = c.h
  const dark = shade(body, -0.55)

  const ground = H - 6

  switch (age) {
    case 0: {
      // Palisade + hide-covered longhouse.
      for (let i = 0; i < 9; i += 1) {
        const x = W * 0.08 + i * W * 0.1
        const h = H * (0.3 + (i % 3) * 0.035)
        polygon(ctx, [
          [x, ground],
          [x, ground - h],
          [x + W * 0.045, ground - h - H * 0.03],
          [x + W * 0.09, ground - h],
          [x + W * 0.09, ground]
        ], shade(0x6b4a2b, i % 2 ? 0.08 : -0.08), { outline: 0x2c1e12, outlineWidth: 2 })
      }
      polygon(ctx, [
        [W * 0.16, ground - H * 0.3],
        [W * 0.5, ground - H * 0.78],
        [W * 0.86, ground - H * 0.3]
      ], body, { outline: dark, outlineWidth: 3 })
      plate(ctx, W * 0.2, ground - H * 0.34, W * 0.6, H * 0.34, 6, shade(body, -0.15), {
        outline: dark,
        outlineWidth: 3
      })
      // Doorway.
      ctx.fillStyle = css(0x150f08)
      roundRect(ctx, W * 0.42, ground - H * 0.24, W * 0.16, H * 0.24, 4)
      ctx.fill()
      // Totem with faction banner.
      plate(ctx, W * 0.46, ground - H * 0.98, W * 0.06, H * 0.26, 3, 0x5c4126, { outline: 0x241a0e })
      polygon(ctx, [
        [W * 0.52, ground - H * 0.96],
        [W * 0.74, ground - H * 0.9],
        [W * 0.52, ground - H * 0.8]
      ], trim, { outline: shade(trim, -0.5), outlineWidth: 2 })
      // Bone trophies.
      ctx.strokeStyle = css(0xe8ddc0)
      ctx.lineWidth = 4
      for (let i = 0; i < 4; i += 1) {
        const x = W * (0.28 + i * 0.16)
        ctx.beginPath()
        ctx.moveTo(x, ground - H * 0.36)
        ctx.lineTo(x + 6, ground - H * 0.46)
        ctx.stroke()
      }
      break
    }
    case 1: {
      // Stone keep with battlements and a gatehouse.
      plate(ctx, W * 0.1, ground - H * 0.62, W * 0.8, H * 0.62, 4, body, { outline: dark, outlineWidth: 3 })
      // Crenellations.
      for (let i = 0; i < 7; i += 1) {
        plate(ctx, W * (0.1 + i * 0.117), ground - H * 0.72, W * 0.072, H * 0.1, 2, shade(body, 0.06), {
          outline: dark,
          outlineWidth: 2
        })
      }
      // Towers.
      for (const tx of [W * 0.06, W * 0.78]) {
        plate(ctx, tx, ground - H * 0.86, W * 0.16, H * 0.86, 3, shade(body, -0.1), {
          outline: dark,
          outlineWidth: 3
        })
        polygon(ctx, [
          [tx - W * 0.02, ground - H * 0.86],
          [tx + W * 0.08, ground - H * 1.0],
          [tx + W * 0.18, ground - H * 0.86]
        ], trim, { outline: dark, outlineWidth: 2 })
      }
      // Gate.
      ctx.fillStyle = css(0x2a1c10)
      ctx.beginPath()
      ctx.moveTo(W * 0.4, ground)
      ctx.lineTo(W * 0.4, ground - H * 0.24)
      ctx.quadraticCurveTo(W * 0.5, ground - H * 0.36, W * 0.6, ground - H * 0.24)
      ctx.lineTo(W * 0.6, ground)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = css(0x6b4a2b)
      ctx.lineWidth = 3
      ctx.stroke()
      // Banner.
      polygon(ctx, [
        [W * 0.44, ground - H * 0.62],
        [W * 0.56, ground - H * 0.62],
        [W * 0.56, ground - H * 0.4],
        [W * 0.5, ground - H * 0.45],
        [W * 0.44, ground - H * 0.4]
      ], trim, { outline: shade(trim, -0.5), outlineWidth: 2 })
      // Stone courses.
      ctx.strokeStyle = css(dark, 0.35)
      ctx.lineWidth = 1.5
      for (let y = ground - H * 0.6; y < ground; y += H * 0.07) {
        ctx.beginPath()
        ctx.moveTo(W * 0.1, y)
        ctx.lineTo(W * 0.9, y)
        ctx.stroke()
      }
      break
    }
    case 2: {
      // Star fort: angled bastion with embrasures.
      polygon(ctx, [
        [W * 0.02, ground],
        [W * 0.14, ground - H * 0.52],
        [W * 0.36, ground - H * 0.6],
        [W * 0.5, ground - H * 0.74],
        [W * 0.64, ground - H * 0.6],
        [W * 0.86, ground - H * 0.52],
        [W * 0.98, ground]
      ], body, { outline: dark, outlineWidth: 3 })
      plate(ctx, W * 0.34, ground - H * 0.98, W * 0.32, H * 0.34, 4, shade(body, 0.05), {
        outline: dark,
        outlineWidth: 3
      })
      // Cupola.
      ctx.beginPath()
      ctx.ellipse(W * 0.5, ground - H * 0.98, W * 0.17, H * 0.12, 0, Math.PI, 0)
      ctx.closePath()
      ctx.fillStyle = css(trim)
      ctx.fill()
      ctx.strokeStyle = css(dark)
      ctx.lineWidth = 2.5
      ctx.stroke()
      // Embrasures.
      ctx.fillStyle = css(0x14100a)
      for (let i = 0; i < 5; i += 1) {
        roundRect(ctx, W * (0.16 + i * 0.15), ground - H * 0.42, W * 0.08, H * 0.1, 3)
        ctx.fill()
      }
      // Earthworks.
      polygon(ctx, [
        [0, ground],
        [W * 0.1, ground - H * 0.16],
        [W * 0.9, ground - H * 0.16],
        [W, ground]
      ], shade(body, -0.3), { outline: dark, outlineWidth: 2 })
      break
    }
    case 3: {
      // Reinforced concrete bunker complex.
      plate(ctx, W * 0.04, ground - H * 0.44, W * 0.92, H * 0.44, 6, body, { outline: dark, outlineWidth: 3 })
      plate(ctx, W * 0.16, ground - H * 0.74, W * 0.68, H * 0.32, 6, shade(body, 0.06), {
        outline: dark,
        outlineWidth: 3
      })
      plate(ctx, W * 0.34, ground - H * 0.98, W * 0.32, H * 0.26, 5, shade(body, -0.08), {
        outline: dark,
        outlineWidth: 3
      })
      // Viewing slits with a warm glow.
      ctx.fillStyle = css(0x0a0d10)
      for (let i = 0; i < 6; i += 1) {
        roundRect(ctx, W * (0.1 + i * 0.14), ground - H * 0.3, W * 0.1, H * 0.05, 2)
        ctx.fill()
      }
      glow(ctx, W * 0.5, ground - H * 0.28, W * 0.5, 0xffb347, 0.22)
      // Sandbags.
      for (let i = 0; i < 8; i += 1) {
        ellipse(ctx, W * (0.08 + i * 0.12), ground - H * 0.05, W * 0.06, H * 0.035, 0x8a7f5e, {
          outline: 0x453f2c,
          outlineWidth: 1.6
        })
      }
      // Antenna + faction light.
      plate(ctx, W * 0.48, ground - H * 1.16, W * 0.02, H * 0.2, 1, 0x8a9096, {})
      ellipse(ctx, W * 0.49, ground - H * 1.17, W * 0.022, W * 0.022, trim, { shaded: false })
      glow(ctx, W * 0.49, ground - H * 1.17, W * 0.1, trim, 0.8)
      // Camo mottling.
      ctx.globalAlpha = 0.16
      for (let i = 0; i < 22; i += 1) {
        ellipse(
          ctx,
          Math.random() * W,
          ground - Math.random() * H * 0.7,
          W * (0.03 + Math.random() * 0.05),
          H * (0.012 + Math.random() * 0.02),
          shade(body, Math.random() > 0.5 ? -0.3 : 0.2),
          { shaded: false }
        )
      }
      ctx.globalAlpha = 1
      break
    }
    default: {
      // Arcology spire with a shield emitter.
      polygon(ctx, [
        [W * 0.08, ground],
        [W * 0.2, ground - H * 0.5],
        [W * 0.8, ground - H * 0.5],
        [W * 0.92, ground]
      ], body, { outline: dark, outlineWidth: 3 })
      polygon(ctx, [
        [W * 0.28, ground - H * 0.5],
        [W * 0.36, ground - H * 1.05],
        [W * 0.64, ground - H * 1.05],
        [W * 0.72, ground - H * 0.5]
      ], shade(body, 0.1), { outline: dark, outlineWidth: 3 })
      // Energy core.
      ellipse(ctx, W * 0.5, ground - H * 0.74, W * 0.11, H * 0.14, trim, { outline: dark, outlineWidth: 2.5 })
      glow(ctx, W * 0.5, ground - H * 0.74, W * 0.42, trim, 0.75)
      // Window strips.
      ctx.fillStyle = css(0x9fe8ff, 0.8)
      for (let i = 0; i < 7; i += 1) {
        roundRect(ctx, W * 0.34, ground - H * (0.98 - i * 0.07), W * 0.32, H * 0.022, 2)
        ctx.fill()
      }
      // Shield dome.
      ctx.save()
      const g = ctx.createRadialGradient(W * 0.5, ground - H * 0.3, W * 0.1, W * 0.5, ground - H * 0.3, W * 0.55)
      g.addColorStop(0, css(trim, 0))
      g.addColorStop(0.82, css(trim, 0.05))
      g.addColorStop(1, css(trim, 0.28))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(W * 0.5, ground - H * 0.3, W * 0.55, Math.PI, 0)
      ctx.fill()
      ctx.restore()
      // Landing pads.
      plate(ctx, W * 0.02, ground - H * 0.58, W * 0.18, H * 0.05, 3, shade(body, -0.2), { outline: dark })
      plate(ctx, W * 0.8, ground - H * 0.58, W * 0.18, H * 0.05, 3, shade(body, -0.2), { outline: dark })
      break
    }
  }

  grain(c, 0.05)
  return c
}

/** Turret mount plus a separately-rotating barrel. */
export function drawTurret(color: number, barrel: string, age: number): { base: Canvas2D; barrel: Canvas2D } {
  const S = 96
  const baseC = makeCanvas(S, S * 0.75)
  const bctx = baseC.ctx
  const dark = shade(color, -0.6)

  plate(bctx, S * 0.14, S * 0.34, S * 0.72, S * 0.34, 6, color, { outline: dark, outlineWidth: 2.5 })
  ellipse(bctx, S * 0.5, S * 0.34, S * 0.24, S * 0.16, shade(color, 0.12), { outline: dark, outlineWidth: 2.5 })
  if (age >= 4) {
    glow(bctx, S * 0.5, S * 0.34, S * 0.36, 0x74f0ff, 0.4)
  }
  // Bolts.
  bctx.fillStyle = css(shade(color, -0.35))
  for (let i = 0; i < 4; i += 1) {
    bctx.beginPath()
    bctx.arc(S * (0.2 + i * 0.2), S * 0.6, 2.4, 0, Math.PI * 2)
    bctx.fill()
  }
  grain(baseC, 0.05)

  const bw = barrel === 'long' ? S * 0.92 : barrel === 'sling' ? S * 0.45 : S * 0.66
  const barrelC = makeCanvas(bw + 16, S * 0.34)
  const rctx = barrelC.ctx
  const cy = barrelC.h / 2

  switch (barrel) {
    case 'twin':
      plate(rctx, 8, cy - S * 0.09, bw, S * 0.07, 4, shade(color, -0.15), { outline: dark, outlineWidth: 2 })
      plate(rctx, 8, cy + S * 0.02, bw, S * 0.07, 4, shade(color, -0.15), { outline: dark, outlineWidth: 2 })
      break
    case 'coil':
      plate(rctx, 8, cy - S * 0.045, bw, S * 0.09, 4, shade(color, -0.15), { outline: dark, outlineWidth: 2 })
      rctx.fillStyle = css(0x74f0ff, 0.85)
      for (let i = 0; i < 5; i += 1) {
        roundRect(rctx, 8 + bw * (0.2 + i * 0.15), cy - S * 0.06, bw * 0.05, S * 0.12, 2)
        rctx.fill()
      }
      break
    case 'dish':
      ellipse(rctx, 8 + bw * 0.55, cy, bw * 0.28, S * 0.15, shade(color, 0.1), { outline: dark, outlineWidth: 2 })
      plate(rctx, 8, cy - S * 0.035, bw * 0.6, S * 0.07, 3, shade(color, -0.2), { outline: dark, outlineWidth: 2 })
      glow(rctx, 8 + bw * 0.6, cy, bw * 0.3, 0x9d7bff, 0.7)
      break
    case 'sling':
      rctx.strokeStyle = css(0x6b5a40)
      rctx.lineWidth = 3
      rctx.beginPath()
      rctx.moveTo(8, cy)
      rctx.quadraticCurveTo(8 + bw * 0.6, cy - S * 0.1, 8 + bw, cy - S * 0.02)
      rctx.stroke()
      ellipse(rctx, 8 + bw * 0.55, cy - S * 0.06, 6, 5, 0x8a8378)
      break
    case 'short':
      plate(rctx, 8, cy - S * 0.07, bw * 0.8, S * 0.14, 5, shade(color, -0.1), { outline: dark, outlineWidth: 2.5 })
      break
    case 'long':
    default:
      plate(rctx, 8, cy - S * 0.05, bw, S * 0.1, 4, shade(color, -0.1), { outline: dark, outlineWidth: 2.5 })
      plate(rctx, 8, cy - S * 0.075, bw * 0.24, S * 0.15, 4, shade(color, -0.25), { outline: dark, outlineWidth: 2 })
      break
  }
  return { base: baseC, barrel: barrelC }
}

// ───────────────────────────── Projectiles ─────────────────────────────

export function drawProjectile(id: ProjectileId): Canvas2D {
  switch (id) {
    case 'stone': {
      const c = makeCanvas(18, 16)
      polygon(c.ctx, [[2, 8], [6, 2], [14, 3], [16, 10], [9, 14], [3, 12]], 0x8a8378, {
        outline: 0x3d382f,
        outlineWidth: 1.6
      })
      return c
    }
    case 'boulder': {
      const c = makeCanvas(34, 32)
      polygon(c.ctx, [[3, 16], [10, 3], [24, 2], [32, 13], [28, 27], [13, 30]], 0x76705f, {
        outline: 0x2f2b23,
        outlineWidth: 2
      })
      c.ctx.fillStyle = css(0x5c574a, 0.7)
      c.ctx.beginPath()
      c.ctx.arc(13, 14, 4, 0, Math.PI * 2)
      c.ctx.arc(23, 21, 3, 0, Math.PI * 2)
      c.ctx.fill()
      return c
    }
    case 'arrow': {
      const c = makeCanvas(40, 10)
      plate(c.ctx, 2, 4, 30, 2.6, 1.3, 0x8a6b3f, { outline: 0x2c2118, outlineWidth: 1 })
      polygon(c.ctx, [[28, 2], [40, 5], [28, 8]], 0xd0d6de, { outline: 0x4a5058, outlineWidth: 1.2 })
      polygon(c.ctx, [[2, 1], [10, 5], [2, 9]], 0xe4e0d0, { outline: 0x7a766a, outlineWidth: 1 })
      return c
    }
    case 'bolt': {
      const c = makeCanvas(46, 12)
      plate(c.ctx, 2, 4.5, 34, 3.4, 1.6, 0x6b5a3f, { outline: 0x2c2118, outlineWidth: 1.2 })
      polygon(c.ctx, [[32, 2], [46, 6], [32, 10]], 0xb9c2ce, { outline: 0x3f464e, outlineWidth: 1.4 })
      return c
    }
    case 'musketball':
    case 'bullet': {
      const c = makeCanvas(16, 7)
      plate(c.ctx, 1, 1.6, 12, 3.6, 1.8, 0xd9c07a, { outline: 0x6b5a2c, outlineWidth: 1 })
      polygon(c.ctx, [[11, 1.6], [16, 3.4], [11, 5.2]], 0xf0dfa0, { outline: 0x6b5a2c, outlineWidth: 1 })
      return c
    }
    case 'cannonball': {
      const c = makeCanvas(24, 24)
      ellipse(c.ctx, 12, 12, 10, 10, 0x2e3238, { outline: 0x0e1013, outlineWidth: 2 })
      glow(c.ctx, 8, 8, 7, 0x8a929c, 0.4)
      return c
    }
    case 'grenade': {
      const c = makeCanvas(20, 22)
      ellipse(c.ctx, 10, 12, 7, 8, 0x3d4a35, { outline: 0x161c12, outlineWidth: 1.8 })
      c.ctx.fillStyle = css(0x8a8070)
      roundRect(c.ctx, 8, 1, 4, 5, 1)
      c.ctx.fill()
      return c
    }
    case 'shell': {
      const c = makeCanvas(30, 12)
      plate(c.ctx, 1, 3, 22, 6, 3, 0x5c634e, { outline: 0x1c1f16, outlineWidth: 1.4 })
      polygon(c.ctx, [[21, 2], [30, 6], [21, 10]], 0x8a9470, { outline: 0x1c1f16, outlineWidth: 1.4 })
      return c
    }
    case 'mortar': {
      const c = makeCanvas(22, 26)
      plate(c.ctx, 5, 6, 12, 16, 5, 0x4e5346, { outline: 0x191c15, outlineWidth: 1.6 })
      polygon(c.ctx, [[5, 8], [11, 0], [17, 8]], 0x6b7360, { outline: 0x191c15, outlineWidth: 1.6 })
      polygon(c.ctx, [[7, 22], [11, 26], [15, 22]], 0x39402f, { outline: 0x191c15, outlineWidth: 1.2 })
      return c
    }
    case 'rocket': {
      const c = makeCanvas(34, 14)
      plate(c.ctx, 2, 4.5, 22, 5, 2.5, 0x59604e, { outline: 0x1a1e16, outlineWidth: 1.4 })
      polygon(c.ctx, [[22, 2.5], [34, 7], [22, 11.5]], 0xd2452f, { outline: 0x5c1c12, outlineWidth: 1.4 })
      polygon(c.ctx, [[2, 1], [8, 5], [2, 6]], 0x39402f, { gradient: false })
      polygon(c.ctx, [[2, 13], [8, 9], [2, 8]], 0x39402f, { gradient: false })
      return c
    }
    case 'bomb': {
      const c = makeCanvas(20, 30)
      ellipse(c.ctx, 10, 14, 7, 11, 0x3a4038, { outline: 0x14170f, outlineWidth: 1.6 })
      polygon(c.ctx, [[6, 24], [10, 30], [14, 24]], 0x585f4e, { gradient: false })
      return c
    }
    case 'laserbolt': {
      const c = makeCanvas(34, 12)
      const g = c.ctx.createLinearGradient(0, 0, 34, 0)
      g.addColorStop(0, 'rgba(92,225,255,0)')
      g.addColorStop(0.55, 'rgba(160,245,255,0.95)')
      g.addColorStop(1, 'rgba(255,255,255,1)')
      c.ctx.fillStyle = g
      roundRect(c.ctx, 0, 4, 34, 4, 2)
      c.ctx.fill()
      glow(c.ctx, 28, 6, 9, 0x5ce1ff, 1)
      return c
    }
    case 'plasmaball': {
      const c = makeCanvas(30, 30)
      glow(c.ctx, 15, 15, 15, 0x7affe0, 1)
      ellipse(c.ctx, 15, 15, 7, 7, 0xe6fff8, { shaded: false })
      return c
    }
    case 'railslug': {
      const c = makeCanvas(46, 10)
      const g = c.ctx.createLinearGradient(0, 0, 46, 0)
      g.addColorStop(0, 'rgba(255,208,106,0)')
      g.addColorStop(0.7, 'rgba(255,226,150,0.9)')
      g.addColorStop(1, 'rgba(255,255,240,1)')
      c.ctx.fillStyle = g
      roundRect(c.ctx, 0, 3.4, 46, 3.2, 1.6)
      c.ctx.fill()
      glow(c.ctx, 40, 5, 8, 0xffd06a, 1)
      return c
    }
    default: {
      const c = makeCanvas(12, 12)
      ellipse(c.ctx, 6, 6, 5, 5, 0xdddddd)
      return c
    }
  }
}

// ────────────────────────────── Particles ──────────────────────────────

export function drawParticles(): Record<string, Canvas2D> {
  const soft = makeCanvas(64, 64)
  glow(soft.ctx, 32, 32, 32, 0xffffff, 1)

  const spark = makeCanvas(24, 8)
  const sg = spark.ctx.createLinearGradient(0, 0, 24, 0)
  sg.addColorStop(0, 'rgba(255,255,255,0)')
  sg.addColorStop(0.6, 'rgba(255,240,200,0.95)')
  sg.addColorStop(1, 'rgba(255,255,255,1)')
  spark.ctx.fillStyle = sg
  roundRect(spark.ctx, 0, 2.6, 24, 2.8, 1.4)
  spark.ctx.fill()

  const smoke = makeCanvas(72, 72)
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2
    glow(smoke.ctx, 36 + Math.cos(a) * 11, 36 + Math.sin(a) * 11, 22, 0xffffff, 0.5)
  }
  glow(smoke.ctx, 36, 36, 30, 0xffffff, 0.7)

  const debris = makeCanvas(14, 14)
  polygon(debris.ctx, [[1, 7], [5, 1], [12, 3], [13, 10], [6, 13]], 0xffffff, { gradient: false })

  const blood = makeCanvas(16, 16)
  ellipse(blood.ctx, 8, 8, 6, 5.4, 0xffffff, { shaded: false })

  const ring = makeCanvas(128, 128)
  ring.ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ring.ctx.lineWidth = 7
  ring.ctx.beginPath()
  ring.ctx.arc(64, 64, 54, 0, Math.PI * 2)
  ring.ctx.stroke()
  ring.ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ring.ctx.lineWidth = 16
  ring.ctx.stroke()

  const flash = makeCanvas(96, 96)
  glow(flash.ctx, 48, 48, 46, 0xffffff, 1)
  flash.ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2
    flash.ctx.save()
    flash.ctx.translate(48, 48)
    flash.ctx.rotate(a)
    flash.ctx.beginPath()
    flash.ctx.moveTo(0, -4)
    flash.ctx.lineTo(46, 0)
    flash.ctx.lineTo(0, 4)
    flash.ctx.closePath()
    flash.ctx.fill()
    flash.ctx.restore()
  }

  const shard = makeCanvas(10, 26)
  polygon(shard.ctx, [[5, 0], [10, 20], [5, 26], [0, 20]], 0xffffff, { gradient: false })

  const rain = makeCanvas(4, 22)
  const rg = rain.ctx.createLinearGradient(0, 0, 0, 22)
  rg.addColorStop(0, 'rgba(255,255,255,0)')
  rg.addColorStop(1, 'rgba(255,255,255,0.9)')
  rain.ctx.fillStyle = rg
  rain.ctx.fillRect(0, 0, 4, 22)

  return { soft, spark, smoke, debris, blood, ring, flash, shard, rain }
}

// ─────────────────────────── Terrain & scenery ───────────────────────────

/** A wide, tileable ground strip themed for the given age. */
export function drawGround(age: number, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[age]
  const c = makeCanvas(width, height)
  const { ctx } = c

  const g = ctx.createLinearGradient(0, 0, 0, height)
  g.addColorStop(0, css(theme.groundAccent))
  g.addColorStop(0.14, css(theme.ground))
  g.addColorStop(1, css(theme.groundDark))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)

  // Packed surface line.
  ctx.fillStyle = css(shade(theme.groundAccent, 0.2), 0.5)
  ctx.fillRect(0, 0, width, 3)

  // Scattered pebbles and clumps.
  for (let i = 0; i < width / 8; i += 1) {
    const x = Math.random() * width
    const y = 6 + Math.random() * (height - 10)
    const r = 1.5 + Math.random() * 4
    ctx.fillStyle = css(shade(theme.ground, Math.random() > 0.5 ? -0.28 : 0.18), 0.55)
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // Ruts running along the lane.
  ctx.strokeStyle = css(theme.groundDark, 0.35)
  ctx.lineWidth = 2
  for (let i = 0; i < 4; i += 1) {
    const y = height * (0.2 + i * 0.2)
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= width; x += 40) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3)
    }
    ctx.stroke()
  }
  grain(c, 0.07)
  return c
}

/** One parallax ridge silhouette. `depth` 0 = furthest. */
export function drawRidge(age: number, depth: 0 | 1 | 2, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[age]
  const color = theme.ridges[depth]
  const c = makeCanvas(width, height)
  const { ctx } = c
  const noise = fbm(age * 13 + depth * 7 + 1, 4)
  const amplitude = height * (depth === 0 ? 0.42 : depth === 1 ? 0.5 : 0.58)
  const baseline = height * (depth === 0 ? 0.6 : depth === 1 ? 0.72 : 0.86)
  const freq = depth === 0 ? 0.0022 : depth === 1 ? 0.004 : 0.0068

  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let x = 0; x <= width; x += 3) {
    const y = baseline - noise(x * freq) * amplitude
    ctx.lineTo(x, y)
  }
  ctx.lineTo(width, height)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, height - amplitude - baseline * 0.2, 0, height)
  g.addColorStop(0, css(shade(color, 0.14)))
  g.addColorStop(1, css(shade(color, -0.24)))
  ctx.fillStyle = g
  ctx.fill()

  // Snow caps / neon caps on the far ridge.
  if (depth === 0) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = age === 4 ? css(theme.fog, 0.28) : css(shade(color, 0.5), 0.35)
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let x = 0; x <= width; x += 3) {
      const y = baseline - noise(x * freq) * amplitude
      ctx.lineTo(x, y + 14)
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Scenery props sitting on the near ridges.
  if (depth === 2) {
    const propColor = shade(color, -0.4)
    for (let i = 0; i < width / 150; i += 1) {
      const x = Math.random() * width
      const y = baseline - noise(x * freq) * amplitude + 6
      drawProp(ctx, theme.props, x, y, 26 + Math.random() * 26, propColor)
    }
  }
  return c
}

function drawProp(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  h: number,
  color: number
): void {
  switch (kind) {
    case 'ferns':
      ctx.strokeStyle = css(color)
      ctx.lineWidth = 2.5
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + i * h * 0.2, y - h * 0.7, x + i * h * 0.42, y - h * 0.5)
        ctx.stroke()
      }
      break
    case 'pines':
      polygon(ctx, [[x - h * 0.28, y], [x, y - h], [x + h * 0.28, y]], color, { gradient: false })
      ctx.fillStyle = css(shade(color, -0.3))
      ctx.fillRect(x - h * 0.04, y - h * 0.1, h * 0.08, h * 0.14)
      break
    case 'oaks':
      ctx.fillStyle = css(shade(color, -0.3))
      ctx.fillRect(x - h * 0.05, y - h * 0.45, h * 0.1, h * 0.45)
      ctx.fillStyle = css(color)
      ctx.beginPath()
      ctx.arc(x, y - h * 0.62, h * 0.34, 0, Math.PI * 2)
      ctx.arc(x - h * 0.24, y - h * 0.48, h * 0.24, 0, Math.PI * 2)
      ctx.arc(x + h * 0.24, y - h * 0.48, h * 0.24, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'ruins':
      ctx.fillStyle = css(color)
      ctx.fillRect(x - h * 0.24, y - h * 0.8, h * 0.2, h * 0.8)
      ctx.fillRect(x + h * 0.02, y - h * 0.55, h * 0.22, h * 0.55)
      ctx.fillRect(x - h * 0.3, y - h * 0.2, h * 0.62, h * 0.2)
      break
    case 'towers':
    default:
      ctx.fillStyle = css(color)
      ctx.fillRect(x - h * 0.1, y - h * 1.3, h * 0.2, h * 1.3)
      ctx.fillStyle = css(0x8affd0, 0.5)
      for (let i = 0; i < 5; i += 1) ctx.fillRect(x - h * 0.1, y - h * (1.15 - i * 0.2), h * 0.2, h * 0.04)
      break
  }
}

/**
 * A near-camera silhouette strip: grass, rubble and debris that sits *in front*
 * of the battle. Nothing sells depth in a side-view faster than something
 * passing between the camera and the action.
 */
export function drawForeground(age: number, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[age]
  const c = makeCanvas(width, height)
  const { ctx } = c
  const silhouette = shade(theme.groundDark, -0.55)
  const base = height * 0.94

  // A low, uneven bank of earth along the very bottom.
  const bank = fbm(age * 5 + 91, 3)
  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let x = 0; x <= width; x += 4) {
    ctx.lineTo(x, base - bank(x * 0.012) * height * 0.22)
  }
  ctx.lineTo(width, height)
  ctx.closePath()
  ctx.fillStyle = css(silhouette)
  ctx.fill()

  const clump = (x: number, y: number, scale: number) => {
    switch (theme.props) {
      case 'ferns':
      case 'pines':
      case 'oaks': {
        // Grass blades fanning out.
        ctx.strokeStyle = css(silhouette)
        ctx.lineCap = 'round'
        for (let i = -4; i <= 4; i += 1) {
          ctx.lineWidth = 2 + Math.random() * 2.4
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.quadraticCurveTo(
            x + i * scale * 0.16,
            y - scale * (0.5 + Math.random() * 0.3),
            x + i * scale * 0.34,
            y - scale * (0.55 + Math.random() * 0.5)
          )
          ctx.stroke()
        }
        break
      }
      case 'ruins': {
        // Broken concrete and rebar.
        polygon(ctx, [
          [x - scale * 0.3, y],
          [x - scale * 0.22, y - scale * 0.75],
          [x + scale * 0.1, y - scale * 0.62],
          [x + scale * 0.32, y]
        ], silhouette, { gradient: false })
        ctx.strokeStyle = css(silhouette)
        ctx.lineWidth = 2.4
        for (let i = -1; i <= 1; i += 1) {
          ctx.beginPath()
          ctx.moveTo(x + i * scale * 0.14, y - scale * 0.6)
          ctx.lineTo(x + i * scale * 0.2, y - scale * 1.0)
          ctx.stroke()
        }
        break
      }
      default: {
        // Angular alloy shards with a faint emissive edge.
        polygon(ctx, [
          [x - scale * 0.26, y],
          [x - scale * 0.06, y - scale * 0.95],
          [x + scale * 0.16, y - scale * 0.6],
          [x + scale * 0.34, y]
        ], silhouette, { gradient: false })
        ctx.strokeStyle = css(0x6affe0, 0.22)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x - scale * 0.06, y - scale * 0.95)
        ctx.lineTo(x + scale * 0.16, y - scale * 0.6)
        ctx.stroke()
        break
      }
    }
  }

  const count = Math.round(width / 90)
  for (let i = 0; i < count; i += 1) {
    const x = (i + 0.5) * (width / count) + (Math.random() - 0.5) * 60
    const y = base - bank(x * 0.012) * height * 0.22 + 6
    clump(x, y, height * (0.34 + Math.random() * 0.34))
  }
  return c
}

/** A soft cloud sprite for the sky layer. */
export function drawCloud(tint: number): Canvas2D {
  const w = 260
  const h = 110
  const c = makeCanvas(w, h)
  const { ctx } = c
  ctx.globalAlpha = 0.55
  const blobs = 7
  for (let i = 0; i < blobs; i += 1) {
    const bx = w * (0.15 + (i / blobs) * 0.7) + (Math.random() - 0.5) * 26
    const by = h * (0.55 + Math.sin(i) * 0.14)
    const r = h * (0.24 + Math.random() * 0.2)
    glow(ctx, bx, by, r * 2.1, tint, 0.75)
  }
  ctx.globalAlpha = 1
  return c
}

/** Vertical vignette overlay drawn on top of the battlefield. */
export function drawVignette(w: number, h: number): Canvas2D {
  const c = makeCanvas(w, h)
  const { ctx } = c
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return c
}
