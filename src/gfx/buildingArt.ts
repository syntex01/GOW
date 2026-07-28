import Pix, { mix, pixelNoise, ramp, type Ramp } from './pixel'
import { sealPart } from './anatomy'
import type { Canvas2D } from './painter'

import type { BuildingDef } from '../data/buildings'

/**
 * The outworks, drawn.
 *
 * Every plot is one small building in a 56×56 cell, and it has three jobs at
 * gameplay distance, in this order:
 *
 *  1. READ AS A BUILDING, not a unit. Flat bases, hard vertical edges, and a
 *     roofline — anything with legs reads as a soldier and gets shot at by the
 *     player's attention instead of the enemy's.
 *  2. SAY WHAT IT DOES from its silhouette alone. A silo is a fat cylinder, a
 *     spire is thin and tall, a palisade is a row of stakes. You should be able
 *     to tell which plot to burn without reading a label.
 *  3. SAY WHOSE IT IS. The creed tints the timber and owns the trim, the same
 *     way `creedPalette` places soldiers inside their army's colour family.
 *
 * Tier is drawn as accretion rather than as a new building: a tier-3 granary is
 * the tier-1 granary with more of it. That way an upgrade reads as the thing
 * you already own getting heavier, which is what an upgrade is.
 */

export const CELL = 56

/** The creed a commander leans, as the colour their buildings are made of. */
export const CREED_TIMBER: Record<string, number> = {
  none: 0x8a7f6a,
  carnage: 0x7d7365,
  ordnance: 0x6f5a48,
  engineering: 0x66707e,
  occult: 0x554a63,
  blight: 0x6a7350
}

type Noise = (x: number, y: number) => number

/** Grain, so a flat wall is not a flat rectangle of one colour. */
function grain(p: Pix, x: number, y: number, w: number, h: number, r: Ramp, n: Noise, amount = 0.5): void {
  for (let i = 0; i < w; i += 1) {
    for (let j = 0; j < h; j += 1) {
      const v = n(x + i, y + j)
      if (v > 1 - amount * 0.4) p.set(x + i, y + j, r[3])
      else if (v < amount * 0.3) p.set(x + i, y + j, r[1])
    }
  }
}

/** A plank roof with a lit top edge, the thing that says "building". */
function roof(p: Pix, x: number, w: number, y: number, h: number, r: Ramp): void {
  for (let j = 0; j < h; j += 1) {
    const inset = Math.round((j * w) / (h * 3.4))
    p.fill(x + inset, y + j, Math.max(1, w - inset * 2), 1, j === 0 ? r[4] : j < h / 2 ? r[3] : r[2])
  }
}

/** Boards, so timber reads as timber rather than as a colour. */
function boards(p: Pix, x: number, y: number, w: number, h: number, r: Ramp, step = 5): void {
  for (let i = step; i < w; i += step) p.fill(x + i, y, 1, h, r[1])
}

/**
 * One building, at one tier, in one creed's materials.
 *
 * `growth` runs 0–1 across the tiers and drives every "more of it" decision, so
 * a new tier never needs new art — it needs the same art, taller and heavier.
 */
/**
 * What is left on a plot after somebody has burned what stood there.
 *
 * A razed plot used to render as nothing at all, which meant the most
 * significant thing that can happen to a commander's economy left no mark on
 * the board — you could not tell a plot that had never been built on from one
 * that had just cost its owner four thousand gold. Rubble is drawn in the
 * building's OWN materials, so at a glance you can still tell what it was.
 */
export function drawRubble(def: BuildingDef, creed = 'none'): Canvas2D {
  const p = new Pix(CELL, CELL)
  const n = pixelNoise(def.id.length * 977 + 31)
  const timberBase = CREED_TIMBER[creed] ?? CREED_TIMBER.none
  const stone = ramp(mix(0x6e6a63, timberBase, 0.35), { contrast: 0.95 })
  const dark = ramp(mix(timberBase, 0x14161c, 0.6), { contrast: 0.85 })
  const trim = ramp(def.color, { contrast: 1.2 })
  const ground = CELL - 3

  // A low, uneven heap. Nothing stands more than a third of the height the
  // building did, so a ruin never reads as a smaller building.
  const w = 34
  const x0 = Math.round((CELL - w) / 2)
  for (let i = 0; i < w; i += 1) {
    const t = i / w
    const h = Math.round(3 + Math.sin(t * Math.PI) * 7 + n(i, 2) * 4)
    for (let j = 0; j < h; j += 1) {
      const y = ground - j
      const v = n(i * 3, j * 5)
      p.set(x0 + i, y, v > 0.72 ? stone[3] : v < 0.24 ? dark[2] : stone[2])
    }
    p.set(x0 + i, ground - h, n(i, 9) > 0.5 ? stone[3] : dark[3])
  }
  // Broken uprights still standing out of it, which is what says a BUILDING
  // fell here rather than a cart tipping over.
  for (const [dx, h] of [[-11, 11], [5, 8], [13, 6]] as [number, number][]) {
    const x = Math.round(CELL / 2) + dx
    for (let j = 0; j < h; j += 1) p.set(x, ground - 4 - j, dark[j > h - 3 ? 1 : 2])
    p.set(x, ground - 4 - h, dark[1])
  }
  // A few pieces of whatever it was, still recognisable in the heap.
  for (let i = 0; i < 5; i += 1) {
    const x = x0 + 4 + Math.round(n(i, 4) * (w - 8))
    const y = ground - 2 - Math.round(n(i, 6) * 6)
    p.fill(x, y, 2, 1, trim[2])
    p.set(x, y - 1, trim[3])
  }
  // Char, because most of these come down burning.
  for (let i = 0; i < w; i += 2) {
    if (n(i, 13) > 0.62) p.set(x0 + i, ground - 1, dark[0])
  }
  return sealPart(p, mix(timberBase, 0x0a0c12, 0.62))
}

export function drawBuilding(def: BuildingDef, tier: number, creed = 'none'): Canvas2D {
  const p = new Pix(CELL, CELL)
  const n = pixelNoise(def.id.length * 131 + tier * 17)
  const timberBase = CREED_TIMBER[creed] ?? CREED_TIMBER.none
  const tiers = Math.max(1, def.tiers.length)
  // A doctrine building has exactly one tier, which left `growth` sitting at a
  // middling value and made the creed-locked endgame buildings read SMALLER
  // than the tier-3 granary anybody can raise. They are the heaviest things in
  // a yard and they should look it.
  const growth = tiers > 1 ? tier / (tiers - 1) : 0.92

  // The creed owns the material; the building owns the trim.
  const timber = ramp(mix(timberBase, def.color, 0.16), { contrast: 1.05 })
  const stone = ramp(mix(0x6e6a63, timberBase, 0.35), { contrast: 0.95 })
  const trim = ramp(def.color, { contrast: 1.2 })
  const dark = ramp(mix(timberBase, 0x14161c, 0.6), { contrast: 0.85 })

  const ground = CELL - 3
  // Everything sits on a footing, which is what stops these floating.
  const footW = Math.round(26 + growth * 18)
  const footX = Math.round((CELL - footW) / 2)
  p.fill(footX - 2, ground - 2, footW + 4, 3, stone[1])
  p.fill(footX - 1, ground - 3, footW + 2, 1, stone[2])

  const body = (w: number, h: number, r: Ramp = timber): { x: number; y: number; w: number; h: number } => {
    const x = Math.round((CELL - w) / 2)
    const y = ground - 3 - h
    p.fill(x, y, w, h, r[2])
    p.fill(x, y, 1, h, r[1])
    p.fill(x + w - 1, y, 1, h, r[3])
    grain(p, x, y, w, h, r, n, 0.5)
    return { x, y, w, h }
  }

  switch (def.shape) {
    // ── economy: a fat cylinder that is obviously full of something ──
    case 'silo': {
      const w = Math.round(20 + growth * 12)
      const h = Math.round(24 + growth * 16)
      const b = body(w, h)
      // Hoops, which is what makes a rectangle read as a barrel.
      for (let j = 3; j < h; j += 6) p.fill(b.x, b.y + j, w, 1, dark[2])
      roof(p, b.x - 2, w + 4, b.y - 5, 5, trim)
      // A chute, because grain has to come out somewhere.
      p.fill(b.x + w - 2, b.y + h - 9, 5, 3, dark[3])
      break
    }
    // ── production: low, wide, open-fronted, full of racks ──
    case 'yard': {
      const w = Math.round(30 + growth * 14)
      const h = Math.round(14 + growth * 8)
      const b = body(w, h)
      boards(p, b.x, b.y, w, h, timber, 6)
      roof(p, b.x - 3, w + 6, b.y - 4, 4, trim)
      // Spear racks along the front. More of them as the yard grows.
      const racks = 3 + Math.round(growth * 4)
      for (let i = 0; i < racks; i += 1) {
        const rx = b.x + 3 + Math.round((i * (w - 6)) / Math.max(1, racks - 1))
        p.fill(rx, b.y - 9, 1, 9, dark[3])
        p.set(rx, b.y - 10, trim[4])
      }
      break
    }
    // ── research: thin, tall, and lit from inside ──
    case 'spire': {
      const w = Math.round(12 + growth * 6)
      const h = Math.round(30 + growth * 18)
      const b = body(w, h, stone)
      for (let j = 6; j < h - 4; j += 9) {
        p.fill(b.x + Math.round(w / 2) - 1, b.y + j, 2, 3, trim[4])
      }
      // A crown rather than a roof: this is a building that is showing off.
      for (let i = 0; i < w + 4; i += 2) p.fill(b.x - 2 + i, b.y - 4, 1, 4, trim[3])
      p.fill(b.x - 2, b.y - 1, w + 4, 1, trim[2])
      break
    }
    // ── military: squat, chimneyed, and clearly hot inside ──
    case 'forge': {
      const w = Math.round(24 + growth * 12)
      const h = Math.round(16 + growth * 8)
      const b = body(w, h, stone)
      roof(p, b.x - 2, w + 4, b.y - 4, 4, dark)
      // The mouth of the furnace, which is the only bright thing on it.
      p.fill(b.x + 4, b.y + h - 8, 7, 6, trim[4])
      p.fill(b.x + 5, b.y + h - 7, 5, 4, trim[3])
      // Chimneys, one more per tier.
      for (let i = 0; i <= tier; i += 1) {
        const cx = b.x + w - 8 - i * 6
        p.fill(cx, b.y - 10 - i * 2, 4, 12 + i * 2, stone[1])
        p.fill(cx, b.y - 11 - i * 2, 4, 1, stone[3])
      }
      break
    }
    // ── defence: a gun in a revetment ──
    case 'redoubt': {
      const w = Math.round(26 + growth * 12)
      const h = Math.round(12 + growth * 6)
      const b = body(w, h, stone)
      // Sandbag courses.
      for (let j = 0; j < h; j += 4) {
        for (let i = (j % 8 === 0 ? 0 : 2); i < w; i += 5) p.fill(b.x + i, b.y + j, 4, 3, stone[j % 8 === 0 ? 3 : 2])
      }
      // The barrel. It gets longer and it points at the enemy.
      const gunY = b.y - 4
      p.fill(b.x + Math.round(w / 2) - 3, gunY - 4, 7, 6, dark[3])
      p.fill(b.x + Math.round(w / 2), gunY - 2, Math.round(10 + growth * 8), 2, dark[4])
      p.fill(b.x + Math.round(w / 2) - 4, gunY - 5, 9, 1, trim[3])
      break
    }
    // ── defence: stakes, and nothing else at all ──
    case 'palisade': {
      const w = Math.round(34 + growth * 14)
      const x0 = Math.round((CELL - w) / 2)
      const h = Math.round(22 + growth * 12)
      for (let i = 0; i < w; i += 3) {
        const jitter = n(i, 3) > 0.5 ? 1 : 0
        const top = ground - 3 - h + jitter
        p.fill(x0 + i, top, 2, h - jitter, timber[2])
        p.fill(x0 + i, top, 1, h - jitter, timber[1])
        // Sharpened.
        p.set(x0 + i, top - 1, timber[3])
        p.set(x0 + i + 1, top - 1, timber[4])
      }
      // Lashing rails, one more per tier.
      for (let i = 0; i <= tier; i += 1) p.fill(x0, ground - 10 - i * 8, w, 2, dark[2])
      break
    }
    // ── the doctrine buildings ──
    // ── carnage: a bottle kiln. A tapering brick cone, and nothing else in
    //    the set is a cone, so it reads from across the board. ──
    case 'kiln': {
      const baseW = Math.round(24 + growth * 8)
      const h = Math.round(30 + growth * 8)
      const cx = Math.round(CELL / 2)
      for (let j = 0; j < h; j += 1) {
        const t = j / h
        // Narrows fast at first and then holds, which is the bottle profile —
        // a straight taper reads as a tent.
        const w = Math.max(6, Math.round(baseW * (1 - Math.pow(t, 0.62) * 0.72)))
        const y = ground - 3 - j
        const x = cx - Math.round(w / 2)
        p.fill(x, y, w, 1, stone[2])
        p.set(x, y, stone[1])
        p.set(x + w - 1, y, stone[3])
        // Brick courses banding round the cone.
        if (j % 4 === 0) p.fill(x + 1, y, w - 2, 1, stone[1])
      }
      grain(p, cx - 6, ground - h, 12, h - 6, stone, n, 0.35)
      // Iron hoops, because a kiln that is worked hard is a kiln that is tied
      // together.
      for (const j of [Math.round(h * 0.35), Math.round(h * 0.62)]) {
        const t = j / h
        const w = Math.max(6, Math.round(baseW * (1 - Math.pow(t, 0.62) * 0.72)))
        p.fill(cx - Math.round(w / 2) - 1, ground - 3 - j, w + 2, 1, dark[3])
      }
      // The crown, open, with the heat coming off it.
      const crownW = Math.max(5, Math.round(baseW * 0.3))
      p.fill(cx - Math.round(crownW / 2) - 1, ground - 4 - h, crownW + 2, 2, dark[3])
      p.fill(cx - Math.round(crownW / 2), ground - 5 - h, crownW, 1, trim[4])
      // The stoke hole at the foot: the one genuinely bright thing on it.
      p.fill(cx - 4, ground - 10, 8, 7, dark[0])
      p.fill(cx - 3, ground - 8, 6, 5, trim[3])
      p.fill(cx - 2, ground - 7, 4, 4, trim[4])
      // The material, stacked against the side where it is fed in from.
      for (let i = 0; i < 7; i += 1) {
        const bx = cx + Math.round(baseW / 2) - 1
        p.fill(bx, ground - 4 - i * 2, 6 - Math.round(i / 2), 1, trim[3])
        p.set(bx + 6 - Math.round(i / 2), ground - 4 - i * 2, trim[4])
      }
      break
    }
    case 'vat': {
      const w = Math.round(20 + growth * 8)
      const h = Math.round(24 + growth * 8)
      const b = body(w, h, stone)
      // A riveted tank with ONE window in it. Filling the whole body with the
      // fluid made every vat a bright green box and threw away the creed.
      for (let j = 2; j < h; j += 5) p.fill(b.x, b.y + j, w, 1, dark[2])
      for (let j = 3; j < h; j += 5) { p.set(b.x + 1, b.y + j, stone[3]); p.set(b.x + w - 2, b.y + j, stone[3]) }
      const gx = b.x + 4
      const gy = b.y + 6
      const gw = w - 8
      const gh = Math.round(h * 0.45)
      p.fill(gx, gy, gw, gh, trim[1])
      p.fill(gx, gy, gw, 1, trim[3])
      p.fill(gx - 1, gy - 1, gw + 2, 1, dark[3])
      p.fill(gx - 1, gy + gh, gw + 2, 1, dark[3])
      // Something suspended in it, and the bubbles coming off it.
      p.fill(gx + Math.round(gw / 2) - 2, gy + 3, 4, Math.max(2, gh - 6), trim[4])
      for (let i = 0; i < 4; i += 1) p.set(gx + 2 + i * 3, gy + 2 + ((i * 3) % Math.max(1, gh - 3)), trim[4])
      // A lid, and the pipe feeding it.
      p.fill(b.x - 1, b.y - 2, w + 2, 3, dark[3])
      p.fill(b.x + w - 4, b.y - 8, 3, 7, stone[1])
      break
    }
    // ── ordnance: a bermed bunker with a blast door. Wide, low, and marked. ──
    case 'magazine': {
      // Half-BURIED, which is the point of a magazine and also what separates
      // its outline from the palisade's — that was a wide wall of the same
      // height and the two masked as the same object.
      const w = Math.round(32 + growth * 10)
      const h = Math.round(10 + growth * 3)
      const b = body(w, h, stone)
      // Earth heaped over and around it, because everybody knows what is
      // inside and nobody wants it above ground.
      for (let i = 0; i < w + 14; i += 1) {
        const d = Math.abs(i - (w + 14) / 2) / ((w + 14) / 2)
        const lift = Math.round((1 - d * d) * (7 + growth * 2))
        p.fill(b.x - 7 + i, b.y - lift, 1, lift + 1, dark[2])
        p.set(b.x - 7 + i, b.y - lift, dark[3])
        if (n(i, 7) > 0.82) p.set(b.x - 7 + i, b.y - lift + 1, timber[2])
      }
      // The blast door: recessed, heavy, and striped so the warning is the
      // first thing you read off it.
      const dw = 12
      const dx = b.x + Math.round((w - dw) / 2)
      const dy = b.y + h - 10
      p.fill(dx - 2, dy - 2, dw + 4, 12, dark[3])
      p.fill(dx, dy, dw, 10, stone[1])
      for (let j = 0; j < 10; j += 1) {
        for (let i = 0; i < dw; i += 1) {
          if ((i + j) % 6 < 3) p.set(dx + i, dy + j, trim[3])
        }
      }
      p.fill(dx, dy, dw, 1, trim[4])
      p.fill(dx + Math.round(dw / 2) - 1, dy + 4, 3, 2, dark[4])
      // A tall vent stack — the one thing that stands up off a buried bunker,
      // and therefore the thing that names it from a distance.
      const vx = b.x + 4
      const vh = Math.round(20 + growth * 6)
      p.fill(vx, b.y - vh, 4, vh + 4, stone[2])
      p.fill(vx, b.y - vh, 1, vh + 4, stone[1])
      p.fill(vx - 1, b.y - vh - 3, 6, 3, stone[3])
      p.fill(vx, b.y - vh - 5, 4, 2, dark[3])
      for (let i = 0; i < 3; i += 1) {
        const kx = b.x + w + 1 + (i % 2) * 5
        const ky = ground - 6 - Math.floor(i / 2) * 5
        p.fill(kx, ky, 4, 5, trim[2])
        p.fill(kx, ky, 4, 1, trim[3])
        p.fill(kx, ky + 2, 4, 1, dark[3])
      }
      break
    }
    case 'mast': {
      const h = Math.round(32 + growth * 12)
      const cx = Math.round(CELL / 2)
      // A lattice tower: two splayed legs cross-braced, which reads as steel
      // from any distance. A single-pixel pole read as nothing at all.
      const spread = (j: number): number => Math.round(2 + (1 - j / h) * 7)
      for (let j = 0; j < h; j += 1) {
        const sp = spread(j)
        p.set(cx - sp, ground - 3 - j, stone[1])
        p.set(cx + sp, ground - 3 - j, stone[3])
      }
      for (let j = 2; j < h; j += 5) {
        const sp = spread(j)
        const spn = spread(Math.min(h - 1, j + 5))
        for (let i = -sp; i <= sp; i += 1) p.set(cx + i, ground - 3 - j, stone[2])
        // The diagonal that makes it a lattice rather than a ladder.
        for (let k = 0; k < 5; k += 1) {
          p.set(cx - sp + Math.round(((sp + spn) * k) / 5), ground - 4 - j - k, stone[1])
        }
      }
      // A dish and a lamp at the head.
      p.fill(cx - 6, ground - 5 - h, 13, 2, stone[3])
      for (let i = 0; i < 7; i += 1) p.set(cx - 3 + i, ground - 7 - h + Math.abs(i - 3), trim[3])
      p.fill(cx - 1, ground - 10 - h, 3, 3, trim[4])
      break
    }
    case 'pit': {
      const w = Math.round(30 + growth * 12)
      const x0 = Math.round((CELL - w) / 2)
      const cx = x0 + Math.round(w / 2)
      // Spoil heaped either side, so the thing has a shape from a distance —
      // a hole drawn only as a hole is a hole in the picture too.
      for (const side of [-1, 1]) {
        const hw = Math.round(9 + growth * 4)
        for (let i = 0; i < hw; i += 1) {
          const t = i / hw
          const hh = Math.round((1 - t) * (11 + growth * 5))
          p.fill(cx + side * (Math.round(w / 2) - 2 + i), ground - 3 - hh, 1, hh + 3, dark[2])
          p.set(cx + side * (Math.round(w / 2) - 2 + i), ground - 3 - hh, dark[3])
        }
      }
      // The shaft: black, and clearly going down.
      const mouth = Math.round(w * 0.42)
      p.fill(cx - Math.round(mouth / 2), ground - 6, mouth, 6, dark[0])
      p.fill(cx - Math.round(mouth / 2), ground - 7, mouth, 1, stone[1])
      // A headframe over it — four legs and a wheel, which is what says MINE.
      const hgt = Math.round(24 + growth * 8)
      for (const side of [-1, 1]) {
        for (let j = 0; j < hgt; j += 1) {
          p.set(cx + side * Math.round(3 + (j / hgt) * 7), ground - 8 - j, timber[2])
        }
      }
      p.fill(cx - 8, ground - 8 - hgt, 17, 2, timber[3])
      for (let a = 0; a < 10; a += 1) {
        const ang = (a / 10) * Math.PI * 2
        p.set(cx + Math.round(Math.cos(ang) * 4), ground - 12 - hgt + Math.round(Math.sin(ang) * 4), trim[3])
      }
      p.fill(cx - 1, ground - 8 - hgt, 2, Math.round(hgt * 0.6), trim[2])
      break
    }
    case 'bed': {
      const w = Math.round(30 + growth * 12)
      const x0 = Math.round((CELL - w) / 2)
      p.fill(x0, ground - 8, w, 8, dark[1])
      p.fill(x0, ground - 8, w, 1, dark[2])
      // Fruiting bodies, more and taller with each tier.
      const caps = 4 + Math.round(growth * 5)
      for (let i = 0; i < caps; i += 1) {
        const cx = x0 + 3 + Math.round((i * (w - 6)) / Math.max(1, caps - 1))
        const ch = 6 + Math.round(n(i, 1) * 10 + growth * 6)
        p.fill(cx, ground - 8 - ch, 2, ch, timber[2])
        p.fill(cx - 3, ground - 10 - ch, 8, 3, trim[3])
        p.fill(cx - 2, ground - 11 - ch, 6, 1, trim[4])
      }
      break
    }
    // ── engineering: the factory roofline, which nothing else here has ──
    case 'line': {
      // Narrower and taller than the Muster Yard it used to mask identically
      // to — both were wide low sheds and only their decoration differed.
      const w = Math.round(28 + growth * 9)
      const h = Math.round(19 + growth * 7)
      const bx = Math.round((CELL - w) / 2)
      const by = ground - 3 - h
      p.fill(bx, by, w, h, stone[2])
      p.fill(bx, by, 1, h, stone[1])
      p.fill(bx + w - 1, by, 1, h, stone[3])
      grain(p, bx, by, w, h, stone, n, 0.4)
      // A sawtooth roof — vertical glazing facing one way, slope the other.
      // This is THE factory silhouette and no other building in the set has it.
      const teeth = 4
      const tw = Math.round(w / teeth)
      for (let t = 0; t < teeth; t += 1) {
        const tx = bx + t * tw
        for (let i = 0; i < tw; i += 1) {
          const rise = Math.round(9 * (1 - i / tw))
          p.fill(tx + i, by - rise, 1, rise + 1, i < 2 ? dark[3] : stone[1])
        }
        // The north light: a strip of glass down the vertical face.
        p.fill(tx, by - 9, 1, 8, trim[3])
        p.set(tx, by - 9, trim[4])
      }
      // The conveyor running out of the near end, with product on it.
      const cy = by + h - 6
      p.fill(bx + w - 2, cy, 9, 2, dark[3])
      for (let i = 0; i < 3; i += 1) p.fill(bx + w + 1 + i * 3, cy - 2, 2, 2, trim[2])
      // A gantry arm over the middle, because something has to be doing the work.
      const gx = bx + Math.round(w * 0.4)
      p.fill(gx, by - 16, 2, 8, dark[2])
      p.fill(gx - 4, by - 17, 10, 2, dark[3])
      p.fill(gx + 4, by - 15, 2, 5, trim[2])
      // The extraction stack: a tall, thin vertical off one end. This is the
      // element that breaks the outline out of the low-shed family entirely.
      const sx = bx - 5
      const sh = Math.round(26 + growth * 8)
      p.fill(sx, by - sh, 5, sh + h, stone[2])
      p.fill(sx, by - sh, 1, sh + h, stone[1])
      p.fill(sx + 4, by - sh, 1, sh + h, stone[3])
      for (let j = 4; j < sh; j += 7) p.fill(sx, by - sh + j, 5, 1, dark[2])
      p.fill(sx - 1, by - sh - 2, 7, 3, stone[3])
      p.fill(sx + 1, by - sh - 4, 3, 2, trim[3])
      break
    }
    // ── occult: a stepped mass with a lit doorway. Wide, not tall. ──
    case 'chapel': {
      const steps = 4
      const baseW = Math.round(32 + growth * 10)
      let sy = ground - 3
      for (let t = 0; t < steps; t += 1) {
        const sw = Math.round(baseW * (1 - t * 0.19))
        const sh = Math.round(6 + growth * 2)
        const sx = Math.round((CELL - sw) / 2)
        p.fill(sx, sy - sh, sw, sh, stone[2])
        p.fill(sx, sy - sh, sw, 1, stone[3])
        p.fill(sx, sy - sh, 1, sh, stone[1])
        p.fill(sx + sw - 1, sy - sh, 1, sh, stone[1])
        grain(p, sx + 1, sy - sh + 1, sw - 2, sh - 1, stone, n, 0.35)
        sy -= sh
      }
      // The doorway, cut up through the bottom two steps and lit from inside.
      const dw = 8
      const dx = Math.round((CELL - dw) / 2)
      const dh = Math.round(11 + growth * 3)
      p.fill(dx, ground - 3 - dh, dw, dh, dark[0])
      for (let i = 0; i < dw; i += 1) {
        const arch = Math.round(Math.sqrt(Math.max(0, 16 - (i - dw / 2) * (i - dw / 2))))
        p.fill(dx + i, ground - 3 - dh - arch, 1, arch, dark[0])
      }
      p.fill(dx + 1, ground - 6, dw - 2, 3, trim[3])
      p.fill(dx + 2, ground - 5, dw - 4, 2, trim[4])
      // The thing hanging over the door, which is the whole point of a chapel
      // to this creed: an eye, open, unblinking.
      const ex = Math.round(CELL / 2)
      const ey = sy - 6
      p.fill(ex - 5, ey, 11, 5, dark[2])
      p.fill(ex - 4, ey + 1, 9, 3, trim[2])
      p.fill(ex - 2, ey + 1, 4, 3, trim[4])
      p.set(ex, ey + 2, dark[0])
      break
    }
    // ── occult: a hole with a lid on it, and almost no mass at all ──
    case 'thrall': {
      const w = Math.round(30 + growth * 10)
      const x0 = Math.round((CELL - w) / 2)
      const cx = x0 + Math.round(w / 2)
      // A low kerb of dressed stone. Everything about this reads FLAT — the
      // quarry next to it is a headframe thirty pixels tall, and the two must
      // never be confused at gameplay distance.
      p.fill(x0, ground - 7, w, 7, stone[2])
      p.fill(x0, ground - 7, w, 1, stone[3])
      for (let i = 0; i < w; i += 6) p.fill(x0 + i, ground - 7, 1, 7, stone[1])
      // The shaft, and the grate bolted over it.
      const mw = w - 12
      p.fill(cx - Math.round(mw / 2), ground - 12, mw, 6, dark[0])
      for (let i = 0; i < mw; i += 3) p.fill(cx - Math.round(mw / 2) + i, ground - 12, 1, 6, dark[3])
      p.fill(cx - Math.round(mw / 2), ground - 13, mw, 1, dark[3])
      // What is down there, showing through the bars.
      for (let i = 2; i < mw - 2; i += 5) p.set(cx - Math.round(mw / 2) + i + 1, ground - 10, trim[4])
      // Four posts and the chains slung between them.
      for (const side of [-1, 1]) {
        const px = cx + side * Math.round(w / 2 - 2)
        p.fill(px, ground - 20, 2, 14, timber[2])
        p.set(px, ground - 21, timber[3])
        for (let i = 1; i < 6; i += 1) {
          p.set(px - side * i * 2, ground - 19 + Math.round(Math.sin(i) * 1), dark[3])
        }
      }
      break
    }
    // ── blight: a thing that GREW. Nothing here is a rectangle. ──
    case 'root': {
      const cx = Math.round(CELL / 2)
      // Roots first, low and wide and hugging the ground, so the footprint is
      // a splay rather than a footing.
      for (let i = 0; i < 7; i += 1) {
        const dir = i % 2 === 0 ? 1 : -1
        const len = 11 + Math.round(n(i, 2) * 9 + growth * 6)
        const rise = 4 + (i % 3) * 3
        for (let j = 0; j < len; j += 1) {
          const t = j / len
          const thick = Math.max(1, Math.round((1 - t) * 4))
          const y = ground - 3 - Math.round((1 - t) * rise)
          p.fill(cx + dir * (2 + j), y - thick, 1, thick + 1, timber[dir > 0 ? 3 : 1])
          if (j % 4 === 0) p.set(cx + dir * (2 + j), y - thick - 1, dark[2])
        }
      }
      // The bole: a tapering, leaning, knotted column drawn row by row. The
      // rectangle this used to be masked identically to the Black Chapel's
      // stepped mass — at gameplay distance they were the same building.
      const h = Math.round(30 + growth * 10)
      const baseW = Math.round(17 + growth * 6)
      const spine: number[] = []
      for (let j = 0; j < h; j += 1) {
        const t = j / h
        // Narrows toward the crown, leans a little, and bulges where the knots
        // are — an outline no piece of masonry in the set can produce.
        const lean = Math.round(Math.sin(t * 2.1) * 3)
        const knot = n(3, j) > 0.72 ? 2 : n(5, j) < 0.2 ? -1 : 0
        const w = Math.max(5, Math.round(baseW * (1 - t * 0.55)) + knot)
        const x = cx + lean - Math.round(w / 2)
        const y = ground - 3 - j
        spine.push(cx + lean)
        p.fill(x, y, w, 1, timber[2])
        p.set(x, y, timber[1])
        p.set(x + w - 1, y, timber[3])
        if (j % 3 === 0) p.set(x + 1 + ((j * 5) % Math.max(1, w - 2)), y, dark[2])
      }
      // The heart, showing through a split about a third of the way up.
      const hy = ground - 3 - Math.round(h * 0.42)
      const hx = spine[Math.round(h * 0.42)] - 3
      p.fill(hx - 1, hy - 5, 8, 11, dark[1])
      p.fill(hx, hy - 4, 6, 9, trim[2])
      p.fill(hx + 1, hy - 3, 4, 7, trim[3])
      p.fill(hx + 2, hy - 2, 2, 5, trim[4])
      // Boughs reaching out of the crown, which is where the mass goes instead
      // of into a roofline.
      const top = spine[h - 1] ?? cx
      for (let i = 0; i < 5; i += 1) {
        const dir = i % 2 === 0 ? 1 : -1
        const len = 7 + Math.round(n(i, 9) * 7 + growth * 4)
        for (let j = 0; j < len; j += 1) {
          const bx = top + dir * Math.round(j * 0.85)
          const by = ground - 4 - h - Math.round(j * (0.5 + (i % 3) * 0.22))
          p.set(bx, by, timber[dir > 0 ? 3 : 1])
          if (j > len - 3) p.set(bx, by - 1, trim[3])
        }
      }
      break
    }
    default: {
      const b = body(Math.round(22 + growth * 10), Math.round(20 + growth * 10))
      roof(p, b.x - 2, b.w + 4, b.y - 5, 5, trim)
      break
    }
  }

  return sealPart(p, mix(timberBase, 0x0a0c12, 0.62))
}
