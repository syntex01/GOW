import type { ProjectileId } from '../data/types'
import type { Faction } from '../sim/types'
import { AGE_THEMES } from './palette'
import type { Canvas2D } from './painter'
import Pix, { RES, ditherAt, mix, pixelNoise, ramp, ridgeNoise, tone, type Ramp } from './pixel'

/**
 * Everything in the world that is not a soldier: fortresses, turrets,
 * ammunition, particles and the terrain itself.
 *
 * The fortresses carry most of the weight. They are the only thing on screen
 * for the whole match, they are what the player is trying to knock down, and
 * they have to say which age you are in from across the battlefield — so each
 * one is built around a different silhouette rather than a re-skin.
 */

export const BASE_W = 200
export const BASE_H = 250

/** Where turrets mount on the base, in base-local coordinates (origin = centre bottom). */
export const TURRET_SLOT_OFFSETS: [number, number][] = [
  [0, -BASE_H * 0.92],
  [-BASE_W * 0.3, -BASE_H * 0.66],
  [BASE_W * 0.3, -BASE_H * 0.66]
]

/** The fortress is authored at half size and displayed at exactly twice it. */
const BW = Math.round(BASE_W * RES)
const BH = Math.round(BASE_H * RES)

function done(p: Pix): Canvas2D {
  return p.toCanvas() as Canvas2D
}

/**
 * Emits a texture at double size, each art pixel becoming a 2×2 block. The
 * effect sprites are sized by the emitters that spawn them, so rather than
 * retune every scale in the game they keep their old dimensions and get their
 * chunk from here.
 */
function doneChunky(p: Pix): Canvas2D {
  return p.toCanvasScaled(2) as Canvas2D
}

// ─────────────────────────────── Fortresses ───────────────────────────────

/**
 * A fortress per age, drawn facing right for the player and mirrored at
 * runtime for the enemy.
 */
export function drawBase(age: number, faction: Faction): Canvas2D {
  const index = Math.max(0, Math.min(AGE_THEMES.length - 1, age))
  const theme = AGE_THEMES[index]
  const body = faction === 'player' ? theme.playerStructure : theme.enemyStructure
  const trimColor = faction === 'player' ? 0x3d8bff : 0xff5646
  const p = new Pix(BW, BH)
  const stone = ramp(body, { contrast: 1.05 })
  const trim = ramp(trimColor)
  const dark = ramp(tone(body, -0.4))
  const ground = BH - 1
  const cx = Math.round(BW / 2)
  const noise = pixelNoise(index * 977 + (faction === 'player' ? 1 : 2))

  /** Block masonry: offset courses, with a few blocks catching the light. */
  const masonry = (x: number, y: number, w: number, h: number, r: Ramp, brickH = 5): void => {
    p.fill(x, y, w, h, r[2])
    for (let by = 0; by < h; by += brickH) {
      p.fill(x, y + by, w, 1, r[1])
      const offset = (by / brickH) % 2 === 0 ? 0 : Math.round(brickH * 1.2)
      for (let bx = offset; bx < w; bx += Math.round(brickH * 2.4)) {
        p.fill(x + bx, y + by, 1, Math.min(brickH, h - by), r[1])
      }
      for (let bx = offset; bx < w; bx += Math.round(brickH * 2.4)) {
        const n = noise(x + bx, y + by)
        const runW = Math.min(Math.round(brickH * 2.4) - 1, w - bx - 1)
        if (runW <= 0) continue
        if (n > 0.74) p.fill(x + bx + 1, y + by + 1, runW, 1, r[3])
        else if (n < 0.16) p.fill(x + bx + 1, y + by + 1, runW, 1, r[1])
      }
    }
    p.fill(x, y, w, 1, r[3])
  }

  /** Crenellations along a wall top. */
  const battlements = (x: number, y: number, w: number, r: Ramp, step = 6): void => {
    for (let bx = 0; bx < w; bx += step * 2) {
      const bw = Math.min(step, w - bx)
      if (bw <= 0) break
      p.fill(x + bx, y - 3, bw, 3, r[2])
      p.fill(x + bx, y - 3, bw, 1, r[3])
      p.fill(x + bx, y - 3, 1, 3, r[1])
    }
  }

  /** A hanging banner in the faction colour, so sides read instantly. */
  const banner = (x: number, y: number, w: number, h: number): void => {
    p.fill(x, y, w, h, trim[2])
    p.fill(x, y, w, 1, trim[3])
    p.fill(x, y, 1, h, trim[1])
    // Swallow-tail hem.
    for (let i = 0; i < w; i += 1) {
      const cut = Math.abs(i - (w - 1) / 2) < w * 0.25 ? 2 : 0
      for (let k = 0; k < cut; k += 1) p.set(x + i, y + h - 1 - k, 0, 0)
    }
    p.fill(x + Math.floor(w / 2), y + 2, 1, Math.max(1, h - 5), trim[4])
  }

  switch (index) {
    case 0: {
      // Stone Age: a timber palisade behind an earth berm, topped with a totem.
      const wood = ramp(0x6f4c2c, { contrast: 1.05 })
      const bone = ramp(0xcfc4a8)
      const wallY = Math.round(BH * 0.34)
      const wallH = ground - wallY
      for (let x = 0; x < BW; x += 1) {
        const hgt = Math.round(BH * 0.08 + Math.sin(x * 0.13) * 2 + noise(x, 3) * 3)
        p.fill(x, ground - hgt, 1, hgt, dark[noise(x, 7) > 0.6 ? 2 : 1])
      }
      // Individual stakes, each with its own tone and sharpened top.
      for (let x = 1; x < BW - 2; x += 4) {
        const jitter = Math.round(noise(x, 11) * 3)
        const top = wallY + jitter
        const n = noise(x, 13)
        p.fill(x, top, 3, wallH - jitter + 4, wood[n > 0.66 ? 3 : n > 0.33 ? 2 : 1])
        p.fill(x, top, 1, wallH - jitter + 4, wood[1])
        p.fill(x + 2, top, 1, wallH - jitter + 4, wood[3])
        p.set(x, top, 0, 0)
        p.set(x + 2, top, 0, 0)
        p.set(x + 1, top - 1, wood[3])
      }
      // Lashing ropes binding the stakes.
      p.fill(1, wallY + 9, BW - 2, 1, tone(0x6f4c2c, -0.5))
      p.fill(1, Math.round(BH * 0.66), BW - 2, 1, tone(0x6f4c2c, -0.5))
      // A skull on a pole: the age's read at a glance.
      const px = Math.round(BW * 0.74)
      p.fill(px, Math.round(BH * 0.12), 2, Math.round(BH * 0.24), wood[1])
      p.ellipse(px + 1, Math.round(BH * 0.11), 5, 5, bone[2])
      p.ellipse(px + 2, Math.round(BH * 0.1), 3.2, 3.2, bone[3])
      p.set(px, Math.round(BH * 0.11), tone(0xcfc4a8, -0.8))
      p.set(px + 3, Math.round(BH * 0.11), tone(0xcfc4a8, -0.8))
      p.fill(px, Math.round(BH * 0.14), 4, 1, tone(0xcfc4a8, -0.7))
      banner(Math.round(BW * 0.2), Math.round(BH * 0.4), 8, 20)
      break
    }
    case 1: {
      // Medieval: a curtain wall, a keep set back, and a portcullis gate.
      const wallY = Math.round(BH * 0.44)
      masonry(0, wallY, BW, ground - wallY, stone, 5)
      battlements(0, wallY, BW, stone, 6)
      const tw = Math.round(BW * 0.34)
      const tx = Math.round(BW * 0.08)
      const ty = Math.round(BH * 0.18)
      masonry(tx, ty, tw, wallY - ty + 2, stone, 5)
      battlements(tx, ty, tw, stone, 5)
      // Conical roof over the keep.
      const roof = ramp(0x7a3b34)
      for (let i = 0; i < 10; i += 1) {
        const rw = tw - i * 2
        if (rw <= 0) break
        p.fill(tx + i, ty - 10 + i, rw, 1, roof[i < 3 ? 3 : 2])
      }
      // Gate: an arch with a portcullis grid.
      const gw = Math.round(BW * 0.2)
      const gx = Math.round(BW * 0.62)
      const gy = Math.round(BH * 0.7)
      p.fill(gx, gy, gw, ground - gy, dark[0])
      p.ellipse(gx + gw / 2, gy, gw / 2, gw * 0.42, dark[0])
      for (let i = 2; i < gw; i += 3) p.fill(gx + i, gy - 2, 1, ground - gy + 2, dark[2])
      for (let i = 2; i < ground - gy; i += 4) p.fill(gx, gy + i, gw, 1, dark[2])
      for (const sx of [Math.round(BW * 0.16), Math.round(BW * 0.3)]) {
        p.fill(sx, Math.round(BH * 0.28), 1, 6, dark[0])
      }
      banner(Math.round(BW * 0.46), wallY + 4, 9, 24)
      break
    }
    case 2: {
      // Renaissance: a low bastion fort — sloped stone, gun embrasures.
      const wallY = Math.round(BH * 0.52)
      // The batter is the defining shape of the period.
      for (let y = wallY; y < ground; y += 1) {
        const t = (y - wallY) / (ground - wallY)
        const inset = Math.round((1 - t) * BW * 0.08)
        masonry(inset, y, BW - inset * 2, 1, stone, 5)
      }
      p.fill(Math.round(BW * 0.08), wallY, Math.round(BW * 0.84), 1, stone[3])
      p.fill(0, ground - Math.round(BH * 0.09), BW, 1, stone[3])
      // Angled bastion jutting toward the enemy.
      p.poly(
        [
          [BW * 0.72, wallY],
          [BW - 1, wallY + BH * 0.05],
          [BW - 1, ground],
          [BW * 0.72, ground]
        ],
        stone[2]
      )
      p.line(BW * 0.72, wallY, BW - 1, wallY + BH * 0.05, stone[3])
      // Embrasures with cannon muzzles run out.
      for (let i = 0; i < 3; i += 1) {
        const ex = Math.round(BW * (0.16 + i * 0.2))
        p.fill(ex, wallY - 5, 9, 5, stone[2])
        p.fill(ex, wallY - 5, 9, 1, stone[3])
        p.fill(ex + 2, wallY - 4, 5, 3, dark[0])
        p.fill(ex + 3, wallY - 4, 3, 2, ramp(0x4a4f58)[2])
      }
      // Powder store roof behind the wall.
      const rx = Math.round(BW * 0.28)
      const rw = Math.round(BW * 0.32)
      const shingle = ramp(0x6b5340)
      for (let i = 0; i < 8; i += 1) {
        const width = rw - i * 2
        if (width <= 0) break
        p.fill(rx + i, wallY - 13 + i, width, 1, shingle[i < 2 ? 3 : 2])
      }
      banner(Math.round(BW * 0.56), wallY - 22, 8, 18)
      break
    }
    case 3: {
      // Modern: a concrete bunker — sandbags, a firing slit, an antenna.
      const wallY = Math.round(BH * 0.54)
      const concrete = ramp(body, { contrast: 0.85, hueShift: 0.015 })
      p.fill(0, wallY, BW, ground - wallY, concrete[2])
      p.fill(0, wallY, BW, 1, concrete[3])
      p.fill(0, ground - 1, BW, 1, concrete[1])
      for (let x = 0; x < BW; x += 13) p.fill(x, wallY, 1, ground - wallY, concrete[1])
      // Weathering streaks below the lip.
      for (let x = 3; x < BW; x += 7) {
        if (noise(x, 21) > 0.6) p.fill(x, wallY + 1, 1, Math.round(4 + noise(x, 22) * 10), concrete[1])
      }
      p.fill(Math.round(BW * 0.1), Math.round(BH * 0.64), Math.round(BW * 0.8), 4, dark[0])
      p.fill(Math.round(BW * 0.1), Math.round(BH * 0.64), Math.round(BW * 0.8), 1, concrete[1])
      // Sandbag berm: staggered rows of stubby capsules.
      const bag = ramp(0x8a7a55)
      for (let row = 0; row < 3; row += 1) {
        const by = ground - 4 - row * 3
        for (let bx = (row % 2) * 4; bx < BW; bx += 8) {
          p.fill(bx, by, 7, 3, bag[2])
          p.fill(bx, by, 7, 1, bag[3])
          p.set(bx, by + 2, bag[1])
          p.set(bx + 6, by + 2, bag[1])
        }
      }
      const dx = Math.round(BW * 0.66)
      const dy = Math.round(BH * 0.76)
      p.fill(dx, dy, Math.round(BW * 0.16), ground - dy - 6, concrete[1])
      p.fill(dx + 1, dy + 2, Math.round(BW * 0.14), 1, concrete[3])
      const mast = ramp(0x6a7280)
      const mx = Math.round(BW * 0.22)
      p.fill(mx, Math.round(BH * 0.22), 1, Math.round(BH * 0.32), mast[2])
      p.fill(mx - 3, Math.round(BH * 0.26), 7, 1, mast[3])
      p.fill(mx - 2, Math.round(BH * 0.32), 5, 1, mast[3])
      p.set(mx, Math.round(BH * 0.21), trim[4])
      banner(Math.round(BW * 0.42), wallY + 6, 8, 16)
      break
    }
    default: {
      // Future: an alloy monolith around a containment core.
      const alloy = ramp(body, { contrast: 1.25, hueShift: 0.03 })
      const glowRamp = ramp(theme.fog, { contrast: 1.3 })
      const wallY = Math.round(BH * 0.48)
      for (let y = wallY; y < ground; y += 1) {
        const t = (y - wallY) / (ground - wallY)
        const inset = Math.round((1 - t) * BW * 0.14)
        p.fill(inset, y, BW - inset * 2, 1, alloy[2])
        p.set(inset, y, alloy[1])
        p.set(BW - inset - 1, y, alloy[3])
      }
      p.fill(Math.round(BW * 0.14), wallY, Math.round(BW * 0.72), 1, alloy[4])
      // Vertical light channels.
      for (const lx of [0.28, 0.5, 0.72]) {
        const x = Math.round(BW * lx)
        for (let y = wallY + 4; y < ground - 4; y += 1) {
          p.set(x, y, ditherAt(x, y, 0.7) ? glowRamp[4] : glowRamp[3])
        }
      }
      // Containment core: a bright ring inside a dithered halo.
      const coreY = Math.round(BH * 0.7)
      for (let y = -12; y <= 12; y += 1) {
        for (let x = -12; x <= 12; x += 1) {
          const d = Math.hypot(x, y) / 12
          if (d > 1) continue
          if (ditherAt(cx + x, coreY + y, (1 - d) * 0.85)) p.set(cx + x, coreY + y, glowRamp[d < 0.45 ? 4 : 3])
        }
      }
      p.ellipse(cx, coreY, 5, 5, glowRamp[4])
      p.ellipseFrame(cx, coreY, 8, 8, alloy[3])
      // Spire carrying the ion emitter.
      const sx = Math.round(BW * 0.68)
      p.poly(
        [
          [sx - 5, wallY],
          [sx, Math.round(BH * 0.1)],
          [sx + 5, wallY]
        ],
        alloy[2]
      )
      p.line(sx, Math.round(BH * 0.1), sx + 5, wallY, alloy[3])
      p.set(sx, Math.round(BH * 0.09), glowRamp[4])
      p.set(sx, Math.round(BH * 0.11), glowRamp[3])
      banner(Math.round(BW * 0.22), wallY + 8, 8, 16)
      break
    }
  }

  p.outline(tone(body, -0.85), { diagonals: false })
  return done(p)
}

// ─────────────────────────────── Turrets ───────────────────────────────

/** Authored size of a turret mount, in art pixels. */
const TURRET_S = 30

export function drawTurret(color: number, barrel: string, age: number): { base: Canvas2D; barrel: Canvas2D } {
  const S = TURRET_S
  const metal = ramp(color, { contrast: 1.15, hueShift: 0.02 })
  const dark = ramp(tone(color, -0.45))
  const energy = ramp(0x74f0ff)

  const bp = new Pix(S, Math.round(S * 0.72))
  const cx = Math.round(S / 2)
  const deckY = Math.round(S * 0.32)
  // A splayed mount: wider at the foot than at the ring, so it looks planted.
  for (let y = deckY; y < bp.h - 1; y += 1) {
    const t = (y - deckY) / (bp.h - 1 - deckY)
    const w = Math.round(S * (0.5 + t * 0.34))
    bp.fill(cx - (w >> 1), y, w, 1, metal[2])
    bp.set(cx - (w >> 1), y, metal[1])
    bp.set(cx - (w >> 1) + w - 1, y, metal[3])
  }
  // Traversing ring the barrel pivots on.
  bp.ellipse(cx, deckY, S * 0.24, S * 0.11, metal[3])
  bp.ellipse(cx, deckY - 1, S * 0.18, S * 0.08, metal[4])
  bp.fill(cx - Math.round(S * 0.25), deckY + 2, Math.round(S * 0.5), 1, metal[1])
  for (let i = 0; i < 4; i += 1) bp.set(Math.round(S * (0.22 + i * 0.19)), bp.h - 3, dark[1])
  if (age >= 4) bp.fill(cx - Math.round(S * 0.16), deckY + 4, Math.round(S * 0.32), 1, energy[4])
  bp.outline(tone(color, -0.85), { diagonals: false })

  const len = Math.round(barrel === 'long' ? S * 0.95 : barrel === 'sling' ? S * 0.5 : S * 0.7)
  const rp = new Pix(len + 5, Math.round(S * 0.36))
  const cy = Math.round(rp.h / 2)

  /** One barrel tube: lit along the top, shadowed underneath. */
  const tube = (y: number, thickness: number, length: number, r: Ramp): void => {
    rp.fill(2, y, length, thickness, r[2])
    rp.fill(2, y, length, 1, r[3])
    rp.fill(2, y + thickness - 1, length, 1, r[1])
  }

  switch (barrel) {
    case 'twin':
      tube(cy - 4, 2, len, metal)
      tube(cy + 1, 2, len, metal)
      rp.fill(2, cy - 5, 4, 8, metal[1])
      break
    case 'long':
      tube(cy - 1, 3, len, metal)
      rp.fill(len, cy - 2, 3, 5, metal[3])
      rp.fill(6, cy - 2, 2, 5, metal[1])
      break
    case 'sling':
      // A throwing arm rather than a barrel.
      rp.thickLine(3, cy + 3, len, cy - 4, 3, metal[2])
      rp.line(3, cy + 2, len, cy - 5, metal[3])
      rp.ellipse(len, cy - 4, 3, 3, ramp(0x6f4c2c)[2])
      break
    case 'beam':
      tube(cy - 1, 3, len, metal)
      rp.fill(3, cy, len - 4, 1, energy[4])
      rp.fill(len, cy - 3, 3, 7, metal[3])
      break
    case 'multi':
      tube(cy - 5, 2, len, metal)
      tube(cy - 1, 2, len, metal)
      tube(cy + 3, 2, len, metal)
      rp.fill(2, cy - 6, 4, 11, metal[1])
      break
    default:
      tube(cy - 2, 4, len, metal)
      rp.fill(len - 2, cy - 3, 3, 6, metal[3])
      break
  }
  rp.outline(tone(color, -0.85), { diagonals: false })

  return { base: done(bp), barrel: done(rp) }
}

// ─────────────────────────────── Projectiles ───────────────────────────────

export function drawProjectile(id: ProjectileId): Canvas2D {
  switch (id) {
    case 'stone': {
      const p = new Pix(9, 8)
      const r = ramp(0x8a8378)
      p.poly([[1, 4], [3, 1], [7, 1], [8, 5], [5, 7], [2, 6]], r[2])
      p.set(3, 2, r[3])
      p.set(4, 2, r[3])
      p.set(3, 6, r[1])
      p.outline(0x2f2b23, { diagonals: false })
      return done(p)
    }
    case 'boulder': {
      const p = new Pix(17, 16)
      const r = ramp(0x76705f)
      p.poly([[1, 8], [5, 2], [12, 1], [16, 7], [14, 13], [6, 15]], r[2])
      p.ellipse(6, 6, 2.4, 2.2, r[3])
      p.ellipse(11, 11, 2, 1.8, r[1])
      p.set(9, 4, r[1])
      p.outline(0x2f2b23, { diagonals: false })
      return done(p)
    }
    case 'arrow':
    case 'bolt': {
      const p = new Pix(id === 'arrow' ? 16 : 12, 5)
      const shaftR = ramp(0x8a6a44)
      const head = ramp(0xb9c2cf)
      const fletch = ramp(0xd8d2c2)
      p.fill(2, 2, p.w - 4, 1, shaftR[2])
      p.fill(2, 1, p.w - 4, 1, shaftR[3])
      p.poly([[p.w - 4, 0], [p.w - 1, 2], [p.w - 4, 4]], head[3])
      p.set(0, 1, fletch[2])
      p.set(1, 1, fletch[3])
      p.set(0, 3, fletch[1])
      p.set(1, 3, fletch[2])
      p.outline(0x241a10, { diagonals: false })
      return done(p)
    }
    case 'musketball':
    case 'cannonball': {
      const r = id === 'cannonball' ? 5 : 3
      const p = new Pix(r * 2 + 2, r * 2 + 2)
      const iron = ramp(0x4a4f58)
      p.ellipse(r + 1, r + 1, r, r, iron[1])
      p.ellipse(r + 1.3, r + 0.7, r * 0.85, r * 0.85, iron[2])
      p.ellipse(r + 1.6, r + 0.4, r * 0.42, r * 0.42, iron[3])
      p.outline(0x14161a, { diagonals: false })
      return done(p)
    }
    case 'bullet': {
      const p = new Pix(8, 4)
      const brass = ramp(0xd8b451)
      p.fill(0, 1, 5, 2, brass[2])
      p.fill(0, 1, 5, 1, brass[3])
      p.poly([[5, 0], [8, 2], [5, 3]], brass[3])
      p.outline(0x3a2c0e, { diagonals: false })
      return done(p)
    }
    case 'grenade': {
      const p = new Pix(9, 10)
      const shell = ramp(0x4b5a3a)
      p.ellipse(4.5, 5.5, 3.6, 4, shell[2])
      p.ellipse(5, 5, 2.6, 2.8, shell[3])
      p.fill(1, 4, 7, 1, shell[1])
      p.fill(1, 7, 7, 1, shell[1])
      p.fill(3, 0, 3, 2, ramp(0x8d8371)[2])
      p.outline(0x161d12, { diagonals: false })
      return done(p)
    }
    case 'rocket': {
      const p = new Pix(14, 7)
      const body = ramp(0x8d949f)
      const head = ramp(0xc0503c)
      p.fill(2, 2, 9, 3, body[2])
      p.fill(2, 2, 9, 1, body[3])
      p.poly([[11, 1], [14, 3], [11, 5]], head[3])
      p.poly([[0, 0], [3, 2], [0, 3]], body[1])
      p.poly([[0, 3], [3, 4], [0, 6]], body[1])
      p.outline(0x1d2026, { diagonals: false })
      return done(p)
    }
    case 'shell':
    case 'mortar': {
      const tall = id === 'mortar'
      const p = new Pix(tall ? 8 : 11, tall ? 12 : 6)
      const body = ramp(0x6f7a86)
      if (tall) {
        p.fill(2, 3, 4, 8, body[2])
        p.fill(2, 3, 1, 8, body[1])
        p.fill(5, 3, 1, 8, body[3])
        p.poly([[2, 3], [4, 0], [6, 3]], body[3])
        p.fill(1, 10, 6, 1, ramp(0xd8b451)[2])
      } else {
        p.fill(1, 2, 7, 3, body[2])
        p.fill(1, 2, 7, 1, body[3])
        p.poly([[8, 1], [11, 3], [8, 4]], body[3])
        p.fill(0, 2, 2, 3, ramp(0xd8b451)[2])
      }
      p.outline(0x1a1e24, { diagonals: false })
      return done(p)
    }
    case 'bomb': {
      const p = new Pix(9, 13)
      const body = ramp(0x5a616b)
      p.ellipse(4.5, 6, 3.4, 5, body[2])
      p.ellipse(5, 5, 2.4, 3.4, body[3])
      p.poly([[2, 10], [4, 13], [4, 10]], body[1])
      p.poly([[7, 10], [5, 13], [5, 10]], body[1])
      p.outline(0x14171c, { diagonals: false })
      return done(p)
    }
    case 'laserbolt': {
      // Energy gets no outline: a hot white core inside a coloured envelope.
      const p = new Pix(14, 5)
      const glow = 0x74f0ff
      p.fill(0, 2, 14, 1, glow)
      p.fill(2, 1, 10, 3, mix(glow, 0xffffff, 0.35))
      p.fill(4, 2, 7, 1, 0xffffff)
      for (let x = 0; x < 14; x += 1) {
        if (ditherAt(x, 0, 0.5)) p.set(x, 0, glow)
        if (ditherAt(x, 4, 0.5)) p.set(x, 4, glow)
      }
      return done(p)
    }
    case 'plasmaball': {
      const p = new Pix(11, 11)
      const core = 0xb46bff
      p.ellipse(5.5, 5.5, 5, 5, core)
      p.ellipse(5.5, 5.5, 3.4, 3.4, mix(core, 0xffffff, 0.45))
      p.ellipse(5.5, 5.5, 1.8, 1.8, 0xffffff)
      // A dithered corona, so the edge crackles instead of ending flat.
      for (let y = 0; y < 11; y += 1) {
        for (let x = 0; x < 11; x += 1) {
          const d = Math.hypot(x - 5, y - 5) / 5.5
          if (d > 1 && d < 1.35 && ditherAt(x, y, 0.5)) p.set(x, y, core)
        }
      }
      return done(p)
    }
    case 'railslug': {
      const p = new Pix(18, 4)
      const hot = 0xffe9a8
      p.fill(0, 1, 18, 2, mix(hot, 0xff8c3a, 0.5))
      p.fill(4, 1, 14, 1, hot)
      p.fill(12, 1, 6, 2, 0xffffff)
      return done(p)
    }
    default: {
      const p = new Pix(7, 7)
      const r = ramp(0x9aa3b5)
      p.ellipse(3.5, 3.5, 3, 3, r[2])
      p.ellipse(3.8, 3.2, 1.6, 1.6, r[3])
      p.outline(0x1d2026, { diagonals: false })
      return done(p)
    }
  }
}

// ─────────────────────────────── Particles ───────────────────────────────

/**
 * The effect sprites. Light is the one place a hard pixel edge would hurt —
 * a glow with a crisp rim reads as a solid disc — so the falloff is dithered
 * rather than blurred, which keeps it in the same visual language.
 */
export function drawParticles(): Record<string, Canvas2D> {
  const softP = new Pix(32, 32)
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const d = Math.hypot(x - 15.5, y - 15.5) / 15.5
      if (d > 1) continue
      const strength = (1 - d) * (1 - d)
      if (strength > 0.55 || ditherAt(x, y, strength * 1.7)) softP.set(x, y, 0xffffff)
    }
  }

  const sparkP = new Pix(12, 4)
  sparkP.fill(0, 2, 12, 1, 0xffffff)
  sparkP.fill(7, 1, 5, 2, 0xffffff)

  const smokeP = new Pix(36, 36)
  const puff = pixelNoise(4211)
  for (let y = 0; y < 36; y += 1) {
    for (let x = 0; x < 36; x += 1) {
      const d = Math.hypot(x - 17.5, y - 17.5) / 17.5
      // Lumpy rather than round: smoke that is a clean circle reads as a ball.
      const wobble = 0.78 + puff(x >> 2, y >> 2) * 0.4
      if (d <= wobble && ditherAt(x, y, (1 - d / wobble) * 1.5)) smokeP.set(x, y, 0xffffff)
    }
  }

  const debrisP = new Pix(7, 7)
  debrisP.poly([[0, 3], [3, 0], [6, 3], [5, 6], [1, 6]], 0xffffff)

  const bloodP = new Pix(8, 8)
  bloodP.ellipse(4, 4, 3.4, 3.4, 0xffffff)

  const ringP = new Pix(64, 64)
  ringP.ellipseFrame(31.5, 31.5, 30, 30, 0xffffff)
  ringP.ellipseFrame(31.5, 31.5, 28, 28, 0xffffff)

  const flashP = new Pix(48, 48)
  for (let y = 0; y < 48; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      const dx = (x - 23.5) / 23.5
      const dy = (y - 23.5) / 23.5
      // A four-pointed star — the shape a muzzle flash actually makes.
      const d = Math.hypot(dx, dy)
      const star = Math.max(Math.abs(dx), Math.abs(dy)) * 0.45 + Math.abs(dx * dy) * 2.6
      if (d < 0.28 || star < 0.34) flashP.set(x, y, 0xffffff)
      else if (d < 1 && ditherAt(x, y, (1 - d) * 1.2 - star * 0.5)) flashP.set(x, y, 0xffffff)
    }
  }

  const shardP = new Pix(5, 13)
  shardP.poly([[2, 0], [5, 8], [2, 13], [0, 8]], 0xffffff)

  const rainP = new Pix(2, 11)
  rainP.fill(0, 0, 1, 11, 0xffffff)
  rainP.fill(1, 2, 1, 9, 0xffffff)

  return {
    soft: doneChunky(softP),
    spark: doneChunky(sparkP),
    smoke: doneChunky(smokeP),
    debris: doneChunky(debrisP),
    blood: doneChunky(bloodP),
    ring: doneChunky(ringP),
    flash: doneChunky(flashP),
    shard: doneChunky(shardP),
    rain: doneChunky(rainP)
  }
}

// ─────────────────────────────── Splatter ───────────────────────────────

/**
 * The brushes stamped into the ground wherever something lands wetly.
 *
 * A splat has to read as a splat at a glance and never as a circle, so each
 * one is a lumpy core with a few satellite droplets thrown off in one
 * direction — the direction the thing was travelling. Several variants per
 * kind, because a battlefield tiled with one repeated mark looks printed.
 */
export function drawSplatBrushes(): Record<string, Canvas2D> {
  const out: Record<string, Canvas2D> = {}

  /**
   * Colour is baked into the brush rather than tinted on at stamp time. A flat
   * silhouette in one colour reads as a sticker; a splat with a dark pooled
   * centre, a mid body and a lighter rim reads as something wet.
   */
  const build = (seed: number, size: number, spatter: number, ragged: number, tones: Ramp): Canvas2D => {
    const s = size
    const p = new Pix(s, s)
    const noise = pixelNoise(seed)
    const cx = (s - 1) / 2
    const cy = (s - 1) / 2
    const coreR = s * 0.26

    // Lumpy core: a radius that wobbles with angle rather than a clean disc.
    for (let y = 0; y < s; y += 1) {
      for (let x = 0; x < s; x += 1) {
        const dx = x - cx
        const dy = y - cy
        const d = Math.hypot(dx, dy)
        const a = Math.atan2(dy, dx)
        const wobble = 1 + (noise(Math.round(Math.cos(a) * 8), Math.round(Math.sin(a) * 8)) - 0.5) * ragged
        const edge = coreR * wobble
        if (d > edge) continue
        // Pooled in the middle, thinner toward the rim.
        p.set(x, y, d < edge * 0.45 ? tones[0] : d < edge * 0.8 ? tones[1] : tones[2])
      }
    }

    // Fingers reaching out of the core, then droplets past their tips.
    const arms = 3 + Math.round(noise(seed, 3) * 4)
    for (let i = 0; i < arms; i += 1) {
      const a = noise(i, seed) * Math.PI * 2
      const reach = coreR + noise(i, seed + 7) * s * 0.42 * spatter
      let px = cx
      let py = cy
      const stepX = Math.cos(a)
      const stepY = Math.sin(a)
      for (let step = 0; step < reach; step += 1) {
        px += stepX
        py += stepY
        const taper = 1 - step / reach
        const width = Math.max(0, Math.round(taper * 2.2))
        for (let w = -width; w <= width; w += 1) {
          p.set(Math.round(px + stepY * w), Math.round(py - stepX * w), taper > 0.55 ? tones[1] : tones[2])
        }
      }
      // A detached droplet where the finger ran out of momentum.
      if (noise(i, seed + 11) > 0.35) {
        const gap = 1 + noise(i, seed + 13) * 3
        const dx = Math.round(px + stepX * gap)
        const dy = Math.round(py + stepY * gap)
        p.set(dx, dy, tones[2])
        if (noise(i, seed + 17) > 0.6) p.set(dx + 1, dy, tones[3])
      }
    }
    return p.toCanvasScaled(2) as Canvas2D
  }

  // Darkest first: pooled centre, body, thin rim, stray droplet.
  const blood: Ramp = [0x3f070b, 0x6d1014, 0x8f181d, 0xa8262a, 0xa8262a]
  const scorch: Ramp = [0x0b0a09, 0x191614, 0x2a2521, 0x3a332c, 0x3a332c]
  const oil: Ramp = [0x07080c, 0x121419, 0x1e2129, 0x2b2f3a, 0x2b2f3a]
  const dust: Ramp = [0x453d33, 0x5d5347, 0x746757, 0x8a7c68, 0x8a7c68]

  for (let i = 0; i < 6; i += 1) out[`splat:blood:${i}`] = build(101 + i * 37, 14, 1, 0.55, blood)
  for (let i = 0; i < 4; i += 1) out[`splat:scorch:${i}`] = build(701 + i * 53, 20, 0.35, 0.9, scorch)
  for (let i = 0; i < 3; i += 1) out[`splat:oil:${i}`] = build(311 + i * 29, 12, 0.7, 0.4, oil)
  for (let i = 0; i < 3; i += 1) out[`splat:dust:${i}`] = build(907 + i * 41, 16, 0.5, 0.8, dust)
  return out
}

// ─────────────────────────────── Terrain ───────────────────────────────

/**
 * The sky for one age. A smooth gradient is the one thing that would give the
 * whole pixel-art scene away, so the three sky tones are stepped and the joins
 * between them dithered — the horizon glow builds out of ordered pixels rather
 * than a blend.
 */
export function drawSky(age: number, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
  const w = Math.round(width * RES)
  const h = Math.round(height * RES)
  const p = new Pix(w, h)
  const [top, mid, low] = theme.sky
  const stars = pixelNoise(age * 313 + 91)

  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1)
    // Two segments: zenith to mid-sky, then mid-sky down to the horizon glow.
    const local = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45
    const from = t < 0.55 ? top : mid
    const to = t < 0.55 ? mid : low
    // Quantise to a handful of steps, then dither across each step boundary.
    const steps = 14
    const scaled = local * steps
    const step = Math.floor(scaled)
    const a = mix(from, to, Math.min(1, step / steps))
    const b = mix(from, to, Math.min(1, (step + 1) / steps))
    for (let x = 0; x < w; x += 1) {
      p.set(x, y, ditherAt(x, y, scaled % 1) ? b : a)
    }
  }

  // A scatter of stars in the upper sky, brightest for the darkest ages.
  for (let y = 0; y < h * 0.45; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (stars(x, y) > 0.9985) {
        p.set(x, y, mix(p.get(x, y) & 0xffffff, 0xffffff, 0.75 * (1 - y / (h * 0.45))))
      }
    }
  }
  return done(p)
}

/**
 * The falloff stamp the lighting layer uses for every light in the scene.
 *
 * This cannot be the generic soft particle: a light's radius runs to several
 * hundred pixels, so a 32-pixel stamp gets magnified tenfold and its dither
 * pattern turns into a checkerboard the size of a fortress. Authored large and
 * banded instead, it stays a glow at any radius the game asks for.
 */
export function drawLightFalloff(): Canvas2D {
  const size = 192
  const p = new Pix(size, size)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c) / c
      if (d > 1) continue
      // Squared falloff, quantised into steps with dithered joins — the same
      // language as the sky, at the scale a light is actually drawn.
      const strength = (1 - d) * (1 - d)
      const scaled = strength * 9
      const level = Math.floor(scaled) + (ditherAt(x, y, scaled % 1) ? 1 : 0)
      if (level > 0) p.set(x, y, 0xffffff, Math.min(255, level * 28))
    }
  }
  return done(p)
}

/** The sun or moon: a hard disc with a dithered corona around it. */
export function drawSunDisc(): Canvas2D {
  const r = 14
  const size = r * 2 + 18
  const p = new Pix(size, size)
  const c = size / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c)
      if (d <= r) {
        p.set(x, y, 0xffffff)
      } else {
        const falloff = Math.max(0, 1 - (d - r) / (size / 2 - r))
        if (ditherAt(x, y, falloff * falloff * 1.1)) p.set(x, y, 0xffffff)
      }
    }
  }
  return doneChunky(p)
}

/** The battlefield floor, tiled horizontally under the fighting. */
export function drawGround(age: number, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
  const w = Math.round(width * RES)
  const h = Math.round(height * RES)
  const p = new Pix(w, h)
  const soil = ramp(theme.ground, { contrast: 0.9 })
  const deep = ramp(theme.groundDark, { contrast: 0.9 })
  const accent = ramp(theme.groundAccent)
  const noise = pixelNoise(age * 131 + 7)
  const surface = ridgeNoise(age * 17 + 3, 3)

  // The floor darkens with depth, dithered so it never bands into stripes.
  // It has to stay clearly darker than the hills behind it, or the units lose
  // the ground under their feet.
  for (let y = 0; y < h; y += 1) {
    const t = Math.min(1, y / (h * 0.55))
    for (let x = 0; x < w; x += 1) {
      p.set(x, y, ditherAt(x, y, t) ? deep[1] : soil[1])
    }
  }

  // A lit crust along the top, following a gently uneven surface line. This
  // band is the horizon the soldiers stand on, so it gets the brightest tone
  // in the texture and a hard shadow directly beneath it.
  for (let x = 0; x < w; x += 1) {
    const top = Math.round(surface(x * 0.08) * 2)
    p.fill(x, top, 1, 1, accent[4])
    p.fill(x, top + 1, 1, 1, accent[3])
    p.fill(x, top + 2, 1, 2, soil[2])
    p.fill(x, top + 4, 1, 1, deep[0])
  }

  // Scattered grit, thinning out with depth.
  for (let y = 3; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const n = noise(x, y)
      const density = 1 - y / h
      if (n > 0.985 - density * 0.02) p.set(x, y, accent[2])
      else if (n < 0.012 + density * 0.012) p.set(x, y, deep[1])
    }
  }
  // A handful of larger stones bedded into the surface.
  for (let i = 0; i < w / 26; i += 1) {
    const rx = Math.round(noise(i, 91) * w)
    const ry = Math.round(4 + noise(i, 92) * (h * 0.5))
    const rr = 1 + Math.round(noise(i, 93) * 2)
    p.ellipse(rx, ry, rr, rr * 0.8, deep[1])
    p.set(rx, ry - Math.round(rr * 0.5), soil[3])
  }
  return done(p)
}

/**
 * One parallax band of hills. The far band is flattest and lowest in contrast;
 * distance is carried by tone, not by detail.
 */
export function drawRidge(age: number, depth: 0 | 1 | 2, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
  const w = Math.round(width * RES)
  const h = Math.round(height * RES)
  const p = new Pix(w, h)
  // Aerial perspective: distance is carried almost entirely by how far each
  // band's colour has been washed toward the haze at the horizon. Without it
  // three bands of hills read as three stripes of paint.
  const haze = [0.55, 0.3, 0.08][depth]
  const base = mix(theme.ridges[depth], theme.sky[2], haze)
  const r = ramp(base, { contrast: 0.55 + depth * 0.35 })
  const shape = ridgeNoise(age * 53 + depth * 19, depth === 0 ? 3 : 4)
  const amplitude = h * (depth === 0 ? 0.3 : depth === 1 ? 0.42 : 0.52)
  const baseline = h * (depth === 0 ? 0.52 : depth === 1 ? 0.4 : 0.3)

  const tops: number[] = []
  for (let x = 0; x < w; x += 1) {
    tops.push(Math.round(h - baseline - shape(x * (0.012 + depth * 0.008)) * amplitude))
  }

  for (let x = 0; x < w; x += 1) {
    const top = Math.max(0, tops[x])
    // Sunlit where the slope falls away to the right, shadowed where it rises.
    const slope = tops[Math.min(w - 1, x + 2)] - tops[x]
    p.fill(x, top, 1, h - top, r[2])
    p.fill(x, top, 1, 1, slope > 0 ? r[4] : r[1])
    if (slope > 0) p.fill(x, top + 1, 1, 2, r[3])
    // The foot of each band sinks into shadow, which seats the band in front
    // of it and stops the hills reading as flat cut-outs.
    for (let y = top; y < h; y += 1) {
      const t = (y - top) / Math.max(1, h - top)
      // Both steps are dithered in. A hard cut here draws a straight line
      // across the whole screen, which no landscape has.
      if (t > 0.5 && ditherAt(x, y, (t - 0.5) * 1.9)) p.set(x, y, r[1])
      if (t > 0.74 && ditherAt(x + 2, y + 1, (t - 0.74) * 2.6)) p.set(x, y, r[0])
    }
  }

  // Silhouetted props along the crest, only on the two nearer bands.
  if (depth > 0) {
    const noise = pixelNoise(age * 71 + depth)
    const step = depth === 1 ? 17 : 13
    for (let x = 2; x < w - 2; x += step) {
      if (noise(x, depth) < 0.42) continue
      drawProp(p, theme.props, x, Math.max(0, tops[x]) + 1, (0.5 + noise(x, depth + 5)) * (depth === 1 ? 5 : 8), r[1])
    }
  }
  return done(p)
}

/** A single silhouette prop: whatever grows or stands in this age. */
function drawProp(p: Pix, kind: string, x: number, groundY: number, size: number, color: number): void {
  const s = Math.max(3, Math.round(size))
  switch (kind) {
    case 'ferns':
      for (let i = -2; i <= 2; i += 1) {
        p.line(x, groundY, x + i * s * 0.4, groundY - s * (1 - Math.abs(i) * 0.16), color)
      }
      break
    case 'pines':
      p.fill(x, groundY - Math.round(s * 0.2), 1, Math.round(s * 0.2), color)
      for (let i = 0; i < s; i += 1) {
        const half = Math.round((1 - i / s) * s * 0.42)
        p.fill(x - half, groundY - Math.round(s * 0.2) - i, half * 2 + 1, 1, color)
      }
      break
    case 'oaks':
      p.fill(x, groundY - Math.round(s * 0.35), 1, Math.round(s * 0.35), color)
      p.ellipse(x, groundY - Math.round(s * 0.62), s * 0.46, s * 0.36, color)
      break
    case 'ruins': {
      const wdt = Math.max(3, Math.round(s * 0.8))
      p.fill(x, groundY - Math.round(s * 0.5), wdt, Math.round(s * 0.5), color)
      p.fill(x + wdt - 2, groundY - s, 2, Math.round(s * 0.5), color)
      break
    }
    default:
      p.fill(x, groundY - s, 1, s, color)
      p.fill(x - 1, groundY - s, 3, 1, color)
      p.fill(x - 2, groundY - Math.round(s * 0.6), 5, 1, color)
      break
  }
}

/** The near silhouette strip that scrolls fastest, framing the battlefield. */
export function drawForeground(age: number, width: number, height: number): Canvas2D {
  const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
  const w = Math.round(width * RES)
  const h = Math.round(height * RES)
  const p = new Pix(w, h)
  const color = tone(theme.groundDark, -0.55)
  const edge = tone(theme.groundDark, -0.35)
  const noise = pixelNoise(age * 311 + 13)
  const surface = ridgeNoise(age * 29 + 5, 3)
  // The bank sits low in its strip: it frames the battlefield from below and
  // must not climb over the feet of the units fighting on it.
  const topAt = (x: number) => Math.round(h * 0.68 - surface(x * 0.02) * h * 0.16)

  for (let x = 0; x < w; x += 1) {
    const top = Math.max(0, topAt(x))
    p.fill(x, top, 1, h - top, color)
    p.fill(x, top, 1, 1, edge)
  }
  // Grass tufts breaking the top edge.
  for (let x = 0; x < w; x += 3) {
    if (noise(x, 3) < 0.55) continue
    const top = Math.max(0, topAt(x))
    const tall = 2 + Math.round(noise(x, 4) * 4)
    for (let i = -1; i <= 1; i += 1) {
      p.line(x + i, top, x + i * 2, top - tall * (1 - Math.abs(i) * 0.4), color)
    }
  }
  return done(p)
}

/** A drifting cloud bank, dithered so it has no soft edge to blur. */
export function drawCloud(tint: number): Canvas2D {
  const w = 64
  const h = 24
  const p = new Pix(w, h)
  const lumps: [number, number, number, number][] = [
    [18, 15, 12, 7],
    [30, 12, 15, 9],
    [44, 15, 11, 6],
    [24, 17, 9, 5],
    [38, 17, 10, 5]
  ]
  for (const [lx, ly, rx, ry] of lumps) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const d = Math.hypot((x - lx) / rx, (y - ly) / ry)
          if (d > 1) continue
        if (d < 0.55 || ditherAt(x, y, (1 - d) * 2.1)) p.set(x, y, tint)
      }
    }
  }
  return doneChunky(p)
}

/** Corner darkening, banded rather than smooth. */
export function drawVignette(w: number, h: number): Canvas2D {
  const pw = Math.round(w * RES)
  const ph = Math.round(h * RES)
  const p = new Pix(pw, ph)
  const cx = pw / 2
  const cy = ph / 2
  const maxD = Math.hypot(cx, cy)
  for (let y = 0; y < ph; y += 1) {
    for (let x = 0; x < pw; x += 1) {
      const d = Math.hypot(x - cx, y - cy) / maxD
      const strength = Math.max(0, (d - 0.52) / 0.48)
      if (strength <= 0) continue
      // Three bands with dithered joins, so the corners darken without a gradient.
      const scaled = strength * 3.4
      const level = Math.min(3, Math.floor(scaled) + (ditherAt(x, y, scaled % 1) ? 1 : 0))
      if (level > 0) p.set(x, y, 0x000000, level * 52)
    }
  }
  return done(p)
}
