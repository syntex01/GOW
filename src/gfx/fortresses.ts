import { AGE_THEMES } from './palette'
import type { Canvas2D } from './painter'
import Pix, { RES, ditherAt, mix, pixelNoise, ramp, ridgeNoise, tone, type Ramp } from './pixel'
import {
  box,
  chamfer,
  contactShadow,
  emissive,
  energy,
  fold,
  metal as metalMaterial,
  orb,
  rivet,
  rivetRow,
  sealPart,
  shaft,
  strap,
  trim
} from './anatomy'
import { BASE_H, BASE_W } from './propArt'

/**
 * The five fortresses.
 *
 * The fortress is the one thing on screen for the whole match. It is the
 * player's home, the thing they are defending and the thing they are trying to
 * knock down — so it cannot be a coloured trapezoid with a hat. Each age gets
 * genuinely different *architecture*, not a re-tint:
 *
 *   0 Stone      banked earth rampart + lashed log palisade + timber watchtower
 *   1 Medieval   coursed masonry keep, machicolations, pitched roof, portcullis
 *   2 Gunpowder  star-fort bastion: glacis, angled salient, cordon, embrasures
 *   3 Modern     poured-concrete bunker complex, blast door, lattice mast
 *   4 Future     dark composite citadel with detached hovering plates + arc
 *
 * ## The rules this file obeys, same as every other art module
 *
 * 1. **Light from the upper right.** Lit edges top and right, shadow bottom and
 *    left, everywhere, in every age.
 * 2. **Five tones per material**, straight out of `ramp()`. The sixth tone is
 *    `pixelNoise` speckle, and it only ever lands on pixels that already exist.
 * 3. **One outline, as a post-pass**, through `sealPart`. Nothing is stroked as
 *    it is drawn.
 * 4. **Never the canvas path API.** Everything is `Pix`, on the integer grid.
 * 5. **No smooth blends.** Gradients are `ditherAt`; mottling is `pixelNoise`.
 * 6. **Faction colour is paint, not tint.** Banners, stencils, warning trim and
 *    lights carry the side. The masonry is the colour masonry actually is; the
 *    theme's structure colour is folded in at ~14% so the two sides are
 *    *distinguishable* without one of them being a blue castle.
 */

// ────────────────────────────── Canvas contract ──────────────────────────────

/**
 * Identical to `drawBase`: authored at half world scale, displayed at exactly
 * twice it, origin at centre-bottom. `partCanvas`/`PAD` are deliberately not
 * used — the consumer fixes these dimensions, so the padding has to be baked
 * into the layout instead of added around it.
 */
const BW = Math.round(BASE_W * RES)
const BH = Math.round(BASE_H * RES)

/**
 * The sprite is placed at `groundY + 6` world pixels, so the true ground line
 * sits three art pixels above the bottom edge and everything below it is
 * footing, buried and never seen.
 */
const GROUND = BH - 3

/**
 * Where the turret slots land in this canvas, derived from
 * `TURRET_SLOT_OFFSETS`: centre-top, and two shoulders. Every age puts real
 * structure under each of them — a deck, a wall walk, a roof slab.
 */
const SLOT_TOP_Y = 12
const SLOT_SIDE_Y = 40

// ───────────────────────────────── Helpers ─────────────────────────────────

/** The left and right edge of a mass at a given row, right edge exclusive. */
type Span = (y: number) => readonly [number, number]

function rectSpan(x0: number, x1: number): Span {
  return () => [x0, x1] as const
}

/** A battered wall: the span walks from `top` to `bot` between two rows. */
function taperSpan(
  y0: number,
  y1: number,
  top: readonly [number, number],
  bot: readonly [number, number]
): Span {
  return (y) => {
    const t = y1 === y0 ? 0 : Math.max(0, Math.min(1, (y - y0) / (y1 - y0)))
    return [Math.round(top[0] + (bot[0] - top[0]) * t), Math.round(top[1] + (bot[1] - top[1]) * t)] as const
  }
}

/** Solid mass with the house lighting: lit top and right, shadowed left. */
function mass(p: Pix, y0: number, y1: number, span: Span, r: Ramp): void {
  for (let y = y0; y < y1; y += 1) {
    const [x0, x1] = span(y)
    if (x1 <= x0) continue
    p.fill(x0, y, x1 - x0, 1, r[2])
    p.set(x0, y, r[1])
    if (x1 - x0 > 2) p.set(x1 - 1, y, r[3])
  }
  const [tx0, tx1] = span(y0)
  if (tx1 > tx0) p.fill(tx0, y0, tx1 - tx0, 1, r[3])
}

/**
 * Speckle, only ever on pixels that already exist. A flat fill at this size
 * reads as card; two tones of grit at ~15% turns it into a surface.
 */
function mottle(
  p: Pix,
  y0: number,
  y1: number,
  span: Span,
  r: Ramp,
  n: (x: number, y: number) => number,
  amount = 0.13
): void {
  for (let y = y0; y < y1; y += 1) {
    const [x0, x1] = span(y)
    for (let x = x0; x < x1; x += 1) {
      if ((p.get(x, y) >>> 24) === 0) continue
      const v = n(x, y)
      if (v > 1 - amount) p.set(x, y, r[3])
      else if (v < amount * 0.85) p.set(x, y, r[1])
    }
  }
}

/** Ordered-dither darkening toward the foot of a mass — damp, soot, age. */
function grimeDown(p: Pix, y0: number, y1: number, span: Span, r: Ramp, strength = 1): void {
  for (let y = y0; y < y1; y += 1) {
    const t = ((y - y0) / Math.max(1, y1 - y0)) * strength
    const [x0, x1] = span(y)
    for (let x = x0; x < x1; x += 1) {
      if ((p.get(x, y) >>> 24) === 0) continue
      if (t > 0.5 && ditherAt(x, y, (t - 0.5) * 1.8)) p.set(x, y, r[1])
      if (t > 0.8 && ditherAt(x + 2, y + 1, (t - 0.8) * 3)) p.set(x, y, r[0])
    }
  }
}

/**
 * Irregular coursed blockwork.
 *
 * The thing that killed the old walls was regularity: one block width, one
 * course height, one tone. Here every block picks its own width and its own
 * tone out of the noise field, courses breathe by a pixel, and each block gets
 * a lit top and a shadowed foot so the wall has depth per stone rather than
 * per wall.
 */
function masonry(
  p: Pix,
  y0: number,
  y1: number,
  span: Span,
  r: Ramp,
  n: (x: number, y: number) => number,
  opts: { courseH?: number; minW?: number; varW?: number; jitter?: boolean; mortar?: boolean } = {}
): void {
  const courseH = opts.courseH ?? 5
  const minW = opts.minW ?? 5
  const varW = opts.varW ?? 5
  const jitter = opts.jitter ?? true
  const mortar = opts.mortar ?? true

  let cy = y0
  let course = 0
  while (cy < y1) {
    const wobble = jitter && n(course * 31, 5) > 0.62 ? 1 : 0
    const ch = Math.min(courseH + wobble, y1 - cy)
    const [sx, ex] = span(cy + Math.floor(ch / 2))
    // Each course starts at its own offset, so vertical joints never stack.
    let bx = sx - Math.round(n(course * 17, 3) * (minW + varW))
    while (bx < ex) {
      const bw = minW + Math.round(n(bx, cy) * varW)
      const x0 = Math.max(sx, bx)
      const x1 = Math.min(ex, bx + bw - 1)
      bx += bw
      if (x1 - x0 < 1 || ch < 2) continue
      const v = n(x0 * 7 + 3, cy * 3 + 1)
      const body = v > 0.82 ? r[3] : v < 0.2 ? r[1] : r[2]
      p.fill(x0, cy, x1 - x0, ch, body)
      if (ch >= 3) {
        p.fill(x0, cy, x1 - x0, 1, body === r[3] ? r[4] : r[3])
        p.fill(x0, cy + ch - 1, x1 - x0, 1, body === r[1] ? r[0] : r[1])
      }
      p.set(x0, cy + Math.floor(ch / 2), r[1])
    }
    // The bed joint: one recessed row, which is what makes it read as coursed.
    if (mortar && ch >= 3) {
      const [mx0, mx1] = span(cy + ch - 1)
      p.fill(mx0, cy + ch - 1, Math.max(0, mx1 - mx0), 1, r[0])
    }
    cy += ch
    course += 1
  }

  // Re-assert the overall form on top of the per-stone shading, or the wall
  // stops being one object and becomes a pile.
  for (let y = y0; y < y1; y += 1) {
    const [x0, x1] = span(y)
    if (x1 <= x0) continue
    p.set(x0, y, r[1])
    if (x1 - x0 > 2) p.set(x1 - 1, y, r[3])
  }
}

/** A capsule sandbag: lit crown, dark seam under. */
function sandbag(p: Pix, x: number, y: number, w: number, r: Ramp): void {
  p.fill(x, y, w, 3, r[2])
  p.fill(x + 1, y, w - 2, 1, r[3])
  p.fill(x, y + 2, w, 1, r[1])
  p.set(x, y, 0, 0)
  p.set(x + w - 1, y, 0, 0)
  p.set(x, y + 2, 0, 0)
  p.set(x + w - 1, y + 2, 0, 0)
}

/**
 * A hanging banner in the faction colour.
 *
 * This is where the side is read from, so it gets a pole, a shadowed hoist
 * edge, a lit fly edge, a device and a swallow-tail hem.
 */
function banner(p: Pix, x: number, y: number, w: number, h: number, r: Ramp, poleR: Ramp): void {
  // Cross-staff it hangs from.
  p.fill(x - 2, y - 2, w + 4, 2, poleR[2])
  p.fill(x - 2, y - 2, w + 4, 1, poleR[3])
  p.fill(x, y, w, h, r[2])
  p.fill(x, y, w, 1, r[3])
  p.fill(x, y, 1, h, r[1])
  p.fill(x + w - 1, y + 1, 1, h - 1, r[3])
  // Two folds, so the cloth is not a rectangle of paint.
  fold(p, x + 2, y + 2, x + 2, y + h - 4, r)
  fold(p, x + w - 4, y + 3, x + w - 4, y + h - 3, r)
  // Device: a plain bar-and-pale in the light tone, legible at any size.
  p.fill(x + 2, y + Math.round(h * 0.32), w - 4, 1, r[4])
  p.fill(x + Math.floor(w / 2) - 1, y + Math.round(h * 0.32), 2, Math.round(h * 0.36), r[4])
  // Swallow-tail hem.
  for (let i = 0; i < w; i += 1) {
    const cut = Math.round(Math.max(0, 3 - Math.abs(i - (w - 1) / 2)))
    for (let k = 0; k < cut; k += 1) p.set(x + i, y + h - 1 - k, 0, 0)
  }
}

/** Diagonal hazard striping — the single most "modern" mark there is. */
function hazard(p: Pix, x: number, y: number, w: number, h: number, warm: Ramp, dark: number): void {
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const band = ((px + py * 2) % 8) < 4
      p.set(x + px, y + py, band ? (py === 0 ? warm[3] : warm[2]) : dark)
    }
  }
}

// ─────────────────────────────── Entry point ───────────────────────────────

export function drawFortress(age: number, faction: 'player' | 'enemy'): Canvas2D {
  const index = Math.max(0, Math.min(AGE_THEMES.length - 1, age))
  const theme = AGE_THEMES[index]
  const player = faction === 'player'
  const p = new Pix(BW, BH)
  const noise = pixelNoise(index * 977 + (player ? 13 : 41))

  // The faction's own colour, used as paint and light only.
  const accentBase = player ? 0x3d8bff : 0xff5646
  const accent = ramp(accentBase, { contrast: 1.15 })
  // A whisper of the theme's structure colour into the stone, so the two sides
  // are told apart at a glance without either becoming a tinted silhouette.
  const house = player ? theme.playerStructure : theme.enemyStructure
  const cast = (base: number, amount = 0.14): number => mix(base, house, amount)

  switch (index) {
    case 0:
      stockade(p, noise, accent, cast)
      break
    case 1:
      keep(p, noise, accent, cast)
      break
    case 2:
      bastion(p, noise, accent, cast)
      break
    case 3:
      bunker(p, noise, accent, cast)
      break
    default:
      citadel(p, noise, accent, cast, player)
      break
  }

  // The single outline pass. Nothing above this line strokes anything.
  return sealPart(p, cast(index === 4 ? 0x232a48 : index === 0 ? 0x4a3620 : 0x6a6a68, 0.2))
}

type Cast = (base: number, amount?: number) => number
type Noise = (x: number, y: number) => number

// ───────────────────────────── 0 · Stone stockade ─────────────────────────────

/**
 * Timber and earth. No masonry exists yet, so the whole thing is a bank of
 * spoil with sharpened trunks driven into its crest, a hide-curtained gap for a
 * gate, and a lashed tripod platform to watch from.
 */
function stockade(p: Pix, n: Noise, accent: Ramp, cast: Cast): void {
  // Earth is deliberately far darker and greyer than the timber. The old
  // stockade failed because bank and palisade were the same brown, so the
  // whole thing read as one flat wall of wood.
  const earth = ramp(cast(0x574d33, 0.06), { contrast: 0.8, hueShift: 0.09 })
  const wood = ramp(cast(0x9c7440, 0.08), { contrast: 1.12 })
  const dark = ramp(cast(0x3d2c19), { contrast: 0.9 })
  const rope = ramp(0xb59a63, { contrast: 0.75 })
  const hide = ramp(cast(0x9a7550, 0.08), { contrast: 0.75 })
  const bone = ramp(0xd8cdb2, { contrast: 0.8 })
  const scrub = ramp(0x5e6338, { contrast: 0.7 })

  const GATE_X0 = 66
  const GATE_X1 = 87
  const crest = ridgeNoise(311, 3)
  const bankTop = (x: number): number => {
    const d = Math.min(x - 1, 98 - x)
    const fall = d < 16 ? (16 - d) * 1.5 : 0
    return Math.round(70 + crest(x * 0.05) * 6 + fall)
  }

  // ── the bank ───────────────────────────────────────────────────────────
  for (let x = 1; x < 99; x += 1) {
    const top = bankTop(x)
    p.fill(x, top, 1, BH - top, earth[2])
    // The crest catches the light; the face falls away from it.
    p.set(x, top, earth[4])
    p.fill(x, top + 1, 1, 2, earth[3])
  }
  grimeDown(p, 70, BH, rectSpan(1, 99), earth, 1.05)
  mottle(p, 70, BH, rectSpan(1, 99), earth, n, 0.17)
  // Stones and scrub bedded into the slope.
  for (let i = 0; i < 34; i += 1) {
    const sx = 3 + Math.round(n(i, 71) * 93)
    const sy = bankTop(sx) + 5 + Math.round(n(i, 72) * 40)
    if (sy >= BH - 2 || (sx > GATE_X0 - 3 && sx < GATE_X1 + 3 && sy > 84)) continue
    const rr = 1 + Math.round(n(i, 73) * 1.6)
    p.ellipse(sx, sy, rr, rr * 0.8, earth[1])
    p.fill(sx - rr, sy - rr, rr * 2, 1, earth[4])
  }
  // A dark ditch shadow at the toe, so the bank sits on something.
  for (let x = 1; x < 99; x += 1) {
    if (ditherAt(x, BH - 2, 0.75)) p.set(x, BH - 2, dark[0])
    p.set(x, BH - 1, dark[0])
  }

  // ── watchtower, behind the palisade so the legs read as depth ──────────
  const legs: [number, number, number, number][] = [
    [45, 118, 47, 19],
    [55, 118, 53, 19],
    [38, 118, 42, 17],
    [62, 118, 58, 17]
  ]
  legs.forEach(([x0, y0, x1, y1], i) => {
    shaft(p, x0, y0, x1, y1, 3, i < 2 ? dark : wood)
  })
  // Cross bracing between the outer legs, in the band above the palisade.
  p.line(41, 36, 59, 22, dark[1])
  p.line(59, 36, 41, 22, dark[1])
  p.line(41, 37, 59, 23, wood[3])
  p.line(59, 37, 41, 23, wood[3])
  for (const [lx, ly] of [
    [42, 29],
    [58, 29],
    [50, 30]
  ]) {
    p.fill(lx - 1, ly - 1, 3, 3, rope[2])
    p.fill(lx - 1, ly - 1, 3, 1, rope[3])
  }
  // Deck: four lashed planks with a joist and its contact shadow.
  const deckY = SLOT_TOP_Y + 2
  for (let i = 0; i < 4; i += 1) {
    const px = 34 + i * 8
    p.fill(px, deckY, 8, 4, wood[n(i, 91) > 0.5 ? 2 : 1])
    p.fill(px, deckY, 8, 1, wood[3])
    p.set(px, deckY, wood[1])
  }
  p.fill(34, deckY + 4, 32, 1, wood[1])
  contactShadow(p, 34, deckY + 5, 32, dark)
  // Rail stubs at the deck ends only — the middle has to stay clear.
  for (const rx of [34, 37, 62, 65]) {
    p.fill(rx, deckY - 5, 2, 5, wood[2])
    p.set(rx + 1, deckY - 5, wood[3])
  }
  p.fill(34, deckY - 4, 4, 1, rope[2])
  p.fill(62, deckY - 4, 4, 1, rope[2])

  // ── skull poles ────────────────────────────────────────────────────────
  const skullPole = (x: number, headY: number, rr: number): void => {
    p.fill(x - 1, headY, 2, 96 - headY, wood[2])
    p.fill(x, headY, 1, 96 - headY, wood[3])
    for (let y = headY + 8; y < 90; y += 11) p.fill(x - 2, y, 4, 1, rope[2])
    orb(p, x, headY, rr, rr * 1.05, bone)
    // Sockets, nasal notch, teeth.
    p.fill(Math.round(x - rr * 0.62), Math.round(headY - rr * 0.2), 2, 2, tone(0xd2c7ab, -0.78))
    p.fill(Math.round(x + rr * 0.1), Math.round(headY - rr * 0.2), 2, 2, tone(0xd2c7ab, -0.78))
    p.set(Math.round(x - rr * 0.2), Math.round(headY + rr * 0.28), tone(0xd2c7ab, -0.7))
    for (let i = 0; i < 4; i += 1) {
      p.set(Math.round(x - rr * 0.6) + i * 2, Math.round(headY + rr * 0.78), bone[0])
    }
  }
  skullPole(11, 21, 4.4)
  skullPole(90, 27, 3.6)
  // Lashed cross-bones under the taller one.
  p.line(6, 30, 16, 34, bone[2])
  p.line(6, 31, 16, 35, bone[1])
  p.line(6, 34, 16, 30, bone[2])

  // ── the palisade ───────────────────────────────────────────────────────
  const lintelY = 79
  let x = 3
  let logIndex = 0
  while (x < 96) {
    const w = 4 + (n(x, 1) > 0.52 ? 1 : 0) + (n(x, 2) > 0.84 ? 1 : 0)
    // Tips are lower toward the ends, so the crest of the wall arcs instead of
    // ruling a straight line across the top of the frame.
    const d = Math.min(x - 3, 95 - x)
    const lift = d < 18 ? (18 - d) * 0.55 : 0
    const top = 33 + Math.round(n(x, 5) * 13 + lift)
    const inGate = x + w > GATE_X0 && x < GATE_X1
    const bottom = inGate ? lintelY : bankTop(x + (w >> 1)) + 7
    const shade = n(x, 7)
    const body = shade > 0.72 ? wood[3] : shade < 0.28 ? wood[1] : wood[2]

    p.fill(x, top, w, bottom - top, body)
    p.fill(x, top, 1, bottom - top, wood[1])
    if (w > 2) p.fill(x + w - 1, top, 1, bottom - top, wood[3])
    // Sharpened tip.
    const half = (w - 1) >> 1
    for (let i = 0; i <= half; i += 1) {
      const inset = half - i
      for (let k = 0; k < inset; k += 1) {
        p.set(x + k, top + i, 0, 0)
        p.set(x + w - 1 - k, top + i, 0, 0)
      }
    }
    if (w >= 4) p.set(x + half + (w % 2 === 0 ? 0 : 0), top, wood[4])
    // Bark: short horizontal splits down the trunk.
    for (let y = top + 5; y < bottom - 3; y += 5 + Math.round(n(x, y) * 6)) {
      if (n(x + 3, y) < 0.62) continue
      const tw = 1 + Math.round(n(x, y + 1) * (w - 3))
      const tx = x + 1 + Math.round(n(x, y + 2) * Math.max(0, w - 2 - tw))
      p.fill(tx, y, tw, 1, wood[shade > 0.5 ? 1 : 0])
    }
    // Knot on the odd trunk.
    if (n(x, 31) > 0.9 && bottom - top > 20) {
      const ky = top + 8 + Math.round(n(x, 32) * (bottom - top - 16))
      p.ellipse(x + w / 2, ky, 1.6, 1.4, wood[0])
      p.set(Math.round(x + w / 2), ky - 1, wood[3])
    }
    // War paint on the odd stake, in the faction colour.
    if (!inGate && n(logIndex, 23) > 0.84) {
      p.fill(x, top + 6, w, 2, accent[2])
      p.fill(x, top + 6, w, 1, accent[3])
    }
    x += w
    logIndex += 1
  }

  // ── lashing ropes binding the stakes ───────────────────────────────────
  for (const ry of [50, 61]) {
    strap(p, 3, ry, 93, 2, rope)
    for (let kx = 8; kx < 94; kx += 14) {
      p.fill(kx, ry - 1, 3, 4, rope[2])
      p.fill(kx, ry - 1, 3, 1, rope[3])
      p.set(kx, ry + 2, rope[0])
    }
  }

  // ── the gate ───────────────────────────────────────────────────────────
  // Opening cut clean through bank and palisade.
  p.fill(GATE_X0, lintelY, GATE_X1 - GATE_X0, BH - lintelY, dark[0])
  // Jamb posts.
  for (const jx of [GATE_X0 - 4, GATE_X1]) {
    p.fill(jx, lintelY - 3, 4, BH - lintelY + 3, wood[2])
    p.fill(jx, lintelY - 3, 1, BH - lintelY + 3, wood[1])
    p.fill(jx + 3, lintelY - 3, 1, BH - lintelY + 3, wood[3])
    for (let y = lintelY + 4; y < BH - 4; y += 9) p.fill(jx - 1, y, 6, 1, rope[2])
  }
  // Lintel: two stacked trunks with the end grain showing on the lit side.
  for (let i = 0; i < 2; i += 1) {
    const ly = lintelY - 9 + i * 5
    p.fill(GATE_X0 - 6, ly, GATE_X1 - GATE_X0 + 12, 5, wood[2])
    p.fill(GATE_X0 - 6, ly, GATE_X1 - GATE_X0 + 12, 1, wood[3])
    p.fill(GATE_X0 - 6, ly + 4, GATE_X1 - GATE_X0 + 12, 1, wood[0])
    p.ellipse(GATE_X1 + 4, ly + 2, 2, 2.2, wood[3])
    p.ellipse(GATE_X1 + 4, ly + 2, 1, 1.1, wood[1])
  }
  contactShadow(p, GATE_X0, lintelY, GATE_X1 - GATE_X0, dark)
  // Hide curtain, hanging from the lintel and swinging.
  const hx0 = GATE_X0 + 1
  const hw = GATE_X1 - GATE_X0 - 2
  p.fill(hx0, lintelY + 1, hw, 27, hide[2])
  p.fill(hx0, lintelY + 1, hw, 1, hide[3])
  p.fill(hx0, lintelY + 1, 1, 27, hide[1])
  p.fill(hx0 + hw - 1, lintelY + 2, 1, 26, hide[3])
  fold(p, hx0 + 4, lintelY + 3, hx0 + 3, lintelY + 24, hide)
  fold(p, hx0 + 12, lintelY + 3, hx0 + 13, lintelY + 25, hide)
  // Scalloped, weighted hem.
  for (let i = 0; i < hw; i += 1) {
    const cut = i % 6 < 3 ? 2 : 0
    for (let k = 0; k < cut; k += 1) p.set(hx0 + i, lintelY + 27 - k, 0, 0)
  }
  // Hand-print daub in the faction colour.
  p.fill(hx0 + 6, lintelY + 8, 7, 8, accent[2])
  p.fill(hx0 + 6, lintelY + 8, 7, 1, accent[3])
  p.fill(hx0 + 8, lintelY + 5, 3, 4, accent[2])
  p.set(hx0 + 9, lintelY + 5, accent[4])
  // Lashings pinning the hide to the lintel.
  for (let i = 2; i < hw; i += 5) p.fill(hx0 + i, lintelY, 2, 2, rope[3])
  // Beaten-earth threshold under the curtain, so the gap is a passage rather
  // than a hole cut in the sprite.
  p.fill(GATE_X0, lintelY + 28, GATE_X1 - GATE_X0, BH - lintelY - 28, earth[1])
  p.fill(GATE_X0, lintelY + 28, GATE_X1 - GATE_X0, 1, earth[3])
  for (let x = GATE_X0; x < GATE_X1; x += 1) {
    for (let y = lintelY + 29; y < BH; y += 1) {
      if (ditherAt(x, y, (y - lintelY - 29) / 18)) p.set(x, y, earth[0])
    }
  }

  // ── seat the palisade in the bank ──────────────────────────────────────
  // Drawn after the stakes so the earth reads as banked up *against* them:
  // a hard contact shadow, then scrub growing at their feet.
  for (let x = 1; x < 99; x += 1) {
    const top = bankTop(x)
    for (let d = 0; d < 3; d += 1) {
      if (ditherAt(x, top + d, 1 - d * 0.34)) p.set(x, top + d, earth[0])
    }
    p.set(x, top - 1, earth[4])
  }
  for (let x = 2; x < 98; x += 3) {
    if (n(x, 81) < 0.55) continue
    const top = bankTop(x)
    const tall = 2 + Math.round(n(x, 82) * 4)
    for (let i = -1; i <= 1; i += 1) {
      p.line(x, top + 1, x + i * 2, top - tall * (1 - Math.abs(i) * 0.35), scrub[i > 0 ? 3 : 1])
    }
  }

  // ── boulder kerb holding the toe of the bank ───────────────────────────
  const kerb = ramp(0x8d8371, { contrast: 0.9 })
  for (let bx = -2; bx < 100; bx += 7) {
    const by = 113 + Math.round(n(bx, 61) * 3)
    const rw = 5 + Math.round(n(bx, 62) * 3)
    if (bx + rw > GATE_X0 - 2 && bx < GATE_X1 + 2) continue
    p.ellipse(bx + rw / 2, by + 4, rw / 2, 4.5, kerb[n(bx, 63) > 0.6 ? 2 : 1])
    p.fill(bx + 1, by, rw - 2, 1, kerb[3])
    p.set(bx + rw - 2, by + 1, kerb[4])
    p.fill(bx, by + 8, rw, 1, kerb[0])
  }

  // ── cheval de frise: sharpened stakes driven into the face of the bank ──
  for (let sx = 3; sx < 98; sx += 6) {
    if (sx > GATE_X0 - 8 && sx < GATE_X1 + 3) continue
    const base = bankTop(sx) + 22 + Math.round(n(sx, 55) * 6)
    if (base > BH - 4) continue
    const len = 9 + Math.round(n(sx, 56) * 4)
    const tipX = sx + len
    const tipY = base - Math.round(len * 0.75)
    p.line(sx, base, tipX, tipY, wood[1])
    p.line(sx, base - 1, tipX, tipY - 1, wood[3])
    p.set(tipX, tipY - 1, wood[4])
    p.ellipse(sx, base + 1, 2.4, 1.4, earth[1])
  }

  // ── fire pit at the gate mouth, where the game's brazier particles sit ──
  firePit(p, 76, 115, dark, earth)

  // ── clan banner, hung clear of the turret slots ────────────────────────
  banner(p, 25, 52, 10, 24, accent, wood)
}

/** A ring of blackened stones with embers in it. */
function firePit(p: Pix, cx: number, cy: number, dark: Ramp, stone: Ramp): void {
  const ember = ramp(0xff8a2a, { contrast: 1.4 })
  p.ellipse(cx, cy, 8, 3, dark[0])
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2
    p.ellipse(cx + Math.cos(a) * 7, cy + Math.sin(a) * 2.6, 1.8, 1.4, stone[2])
    p.set(Math.round(cx + Math.cos(a) * 7), Math.round(cy + Math.sin(a) * 2.6 - 1), stone[4])
  }
  emissive(p, cx, cy, 3.4, 1.5, ember)
  p.set(cx - 2, cy - 1, ember[4])
}

// ────────────────────────────── 1 · Medieval keep ──────────────────────────────

/**
 * Coursed masonry. The curtain wall gets a machicolated wall walk carried on
 * corbels, the keep gets a pitched tiled roof, and the gate gets a proper
 * voussoired arch with a portcullis behind it.
 */
function keep(p: Pix, n: Noise, accent: Ramp, cast: Cast): void {
  // Two stone tones. The curtain sits back and reads cool and dark; the keep
  // and every dressed stone catch the light. One ramp for all of it was what
  // made the old wall read as a flat sheet of grey.
  const stone = ramp(cast(0x9ca2ab), { contrast: 1.0, hueShift: 0.035 })
  const wall = ramp(cast(0x777c85), { contrast: 1.0, hueShift: 0.045 })
  const plinth = ramp(cast(0x62666d), { contrast: 0.95 })
  const roof = ramp(cast(0x7d3a33, 0.08), { contrast: 1.05 })
  const iron = ramp(0x474d57, { contrast: 1.2 })
  const timber = ramp(cast(0x5c4029, 0.08), { contrast: 0.95 })

  const WALL_TOP = 46
  const WALK_TOP = 41
  const MERLON_TOP = 32
  const PLINTH_TOP = 104

  // ── battered plinth, then the curtain wall above it ────────────────────
  const plinthSpan = taperSpan(PLINTH_TOP, BH, [4, 96], [0, 100])
  mass(p, PLINTH_TOP, BH, plinthSpan, plinth)
  masonry(p, PLINTH_TOP, BH, plinthSpan, plinth, n, { courseH: 6, minW: 8, varW: 6 })

  const wallSpan = taperSpan(WALL_TOP, PLINTH_TOP, [6, 94], [4, 96])
  mass(p, WALL_TOP, PLINTH_TOP, wallSpan, wall)
  masonry(p, WALL_TOP, PLINTH_TOP, wallSpan, wall, n, { courseH: 5, minW: 6, varW: 6 })
  // A chamfered offset course where the plinth meets the wall.
  p.fill(4, PLINTH_TOP - 1, 92, 1, stone[4])
  p.fill(4, PLINTH_TOP, 92, 1, stone[0])
  grimeDown(p, WALL_TOP, PLINTH_TOP, wallSpan, wall, 0.9)
  mottle(p, WALL_TOP, PLINTH_TOP, wallSpan, wall, n, 0.1)

  // ── machicolation: corbels carrying a walk that projects past the wall ──
  for (let cx = 4; cx < 96; cx += 6) {
    // Each corbel is a stepped bracket, lit on its top step.
    p.fill(cx, WALL_TOP - 1, 4, 4, stone[2])
    p.fill(cx, WALL_TOP - 1, 4, 1, stone[4])
    p.fill(cx, WALL_TOP + 2, 4, 1, wall[0])
    p.fill(cx + 1, WALL_TOP + 3, 2, 2, stone[1])
    p.fill(cx + 4, WALL_TOP - 1, 2, 5, wall[0])
  }
  // The projecting walk slab, wider than the wall it sits on.
  const walkSpan = rectSpan(2, 98)
  mass(p, WALK_TOP, WALL_TOP - 1, walkSpan, stone)
  p.fill(2, WALK_TOP, 96, 1, stone[4])
  p.fill(2, WALL_TOP - 2, 96, 1, stone[1])

  // ── crenellations ──────────────────────────────────────────────────────
  for (let mx = 3; mx < 96; mx += 11) {
    const mw = Math.min(6, 96 - mx)
    if (mw < 3) break
    const top = MERLON_TOP + (n(mx, 61) > 0.7 ? 1 : 0)
    p.fill(mx, top, mw, WALK_TOP - top, stone[2])
    p.fill(mx, top, mw, 1, stone[4])
    p.fill(mx, top, 1, WALK_TOP - top, stone[1])
    p.fill(mx + mw - 1, top + 1, 1, WALK_TOP - top - 1, stone[3])
    // An arrow loop through the taller merlons.
    if (mw >= 5 && n(mx, 62) > 0.45) p.fill(mx + 2, top + 3, 1, 4, stone[0])
  }
  // Shadow the crenel floors so the gaps have depth.
  for (let gx = 3; gx < 96; gx += 11) p.fill(gx + 6, WALK_TOP, 5, 1, stone[1])

  // ── the keep, set behind the wall, with a tiled pitched roof ───────────
  const KEEP_X0 = 32
  const KEEP_X1 = 68
  const KEEP_TOP = 22
  const keepSpan = taperSpan(KEEP_TOP, WALL_TOP, [KEEP_X0 + 1, KEEP_X1 - 1], [KEEP_X0, KEEP_X1])
  mass(p, KEEP_TOP, WALL_TOP, keepSpan, stone)
  masonry(p, KEEP_TOP, WALL_TOP, keepSpan, stone, n, { courseH: 4, minW: 5, varW: 5 })
  // Quoins: a clean alternating chain of dressed stone up each corner.
  for (let qy = KEEP_TOP; qy < WALL_TOP; qy += 4) {
    const big = ((qy - KEEP_TOP) / 4) % 2 === 0
    p.fill(KEEP_X0, qy, big ? 4 : 3, 3, stone[3])
    p.fill(KEEP_X0, qy, big ? 4 : 3, 1, stone[4])
    p.fill(KEEP_X1 - (big ? 4 : 3), qy, big ? 4 : 3, 3, stone[3])
    p.fill(KEEP_X1 - 1, qy, 1, 3, stone[4])
  }
  // Cross-shaped arrow loops with splayed embrasures.
  for (const [sx, sy] of [
    [42, 30],
    [57, 30],
    [49, 38]
  ]) {
    p.fill(sx - 1, sy - 1, 3, 10, stone[1])
    p.fill(sx, sy, 1, 8, stone[0])
    p.fill(sx - 2, sy + 3, 5, 1, stone[0])
    p.fill(sx - 2, sy + 2, 5, 1, stone[3])
  }
  // String course at the eaves.
  p.fill(KEEP_X0 - 2, KEEP_TOP - 1, KEEP_X1 - KEEP_X0 + 4, 2, stone[3])
  p.fill(KEEP_X0 - 2, KEEP_TOP - 1, KEEP_X1 - KEEP_X0 + 4, 1, stone[4])
  contactShadow(p, KEEP_X0 - 2, KEEP_TOP + 1, KEEP_X1 - KEEP_X0 + 4, stone)

  // Roof: shingle courses, left slope in shadow, right slope in light.
  const EAVE = KEEP_TOP - 1
  const RIDGE = 6
  for (let i = 0; i <= EAVE - RIDGE; i += 1) {
    const y = EAVE - i
    const t = i / (EAVE - RIDGE)
    const half = Math.round((1 - t) * 19) + 3
    const x0 = 50 - half
    const x1 = 50 + half
    p.fill(x0, y, x1 - x0, 1, roof[2])
    // Tile courses every three rows, plus the vertical joints in them.
    if (i % 3 === 0) {
      p.fill(x0, y, x1 - x0, 1, roof[1])
      for (let tx = x0 + ((i / 3) % 2 === 0 ? 1 : 3); tx < x1; tx += 4) p.set(tx, y, roof[0])
    } else if (i % 3 === 1) {
      p.fill(x0 + 1, y, x1 - x0 - 2, 1, roof[3])
    }
    // Left slope falls away from the light.
    p.fill(x0, y, Math.max(1, Math.round(half * 0.5)), 1, ditherAt(x0, y, 0.6) ? roof[1] : roof[0])
    p.set(x1 - 1, y, roof[4])
    p.set(x0, y, roof[0])
  }
  p.fill(46, RIDGE - 1, 9, 2, roof[3])
  p.fill(46, RIDGE - 1, 9, 1, roof[4])

  // ── portcullis gate ────────────────────────────────────────────────────
  const GX0 = 62
  const GX1 = 86
  const ARCH = 82
  const gw = GX1 - GX0
  p.fill(GX0, ARCH, gw, BH - ARCH, iron[0])
  p.ellipse(GX0 + gw / 2, ARCH + 1, gw / 2, gw * 0.46, iron[0])
  // Voussoirs: dressed stones radiating round the arch head.
  for (let a = 0; a <= 22; a += 1) {
    const ang = Math.PI + (a / 22) * Math.PI
    const cxx = GX0 + gw / 2
    const cyy = ARCH + 1
    for (let d = 0; d < 4; d += 1) {
      const rr = gw / 2 + d
      const px = Math.round(cxx + Math.cos(ang) * rr)
      const py = Math.round(cyy + Math.sin(ang) * rr * 0.92)
      if (py > ARCH + 2) continue
      p.set(px, py, a % 3 === 0 ? stone[1] : d === 3 ? stone[3] : stone[2])
    }
  }
  // Jamb stones down both sides of the opening.
  for (let jy = ARCH; jy < BH; jy += 5) {
    p.fill(GX0 - 3, jy, 3, 4, stone[(jy / 5) % 2 === 0 ? 3 : 2])
    p.fill(GX1, jy, 3, 4, stone[(jy / 5) % 2 === 0 ? 2 : 3])
  }
  // The portcullis itself: a lattice with sharpened feet.
  for (let bx = GX0 + 2; bx < GX1 - 1; bx += 4) {
    p.fill(bx, ARCH - 4, 2, BH - ARCH + 4, iron[3])
    p.fill(bx + 1, ARCH - 4, 1, BH - ARCH + 4, iron[4])
    p.fill(bx, BH - 6, 2, 6, iron[2])
  }
  for (let by = ARCH + 2; by < BH; by += 6) {
    p.fill(GX0 + 1, by, gw - 2, 2, iron[2])
    p.fill(GX0 + 1, by, gw - 2, 1, iron[3])
  }
  // Winding chains disappearing up behind the arch.
  for (const cx of [GX0 + 4, GX1 - 5]) {
    for (let cy = ARCH - 8; cy < ARCH - 2; cy += 2) p.fill(cx, cy, 2, 1, iron[3])
  }
  contactShadow(p, GX0, ARCH - 5, gw, iron)

  // ── timber hoarding over the gate: a projecting fighting gallery ───────
  const HX0 = 58
  const HX1 = 92
  p.fill(HX0, 34, HX1 - HX0, 8, timber[2])
  p.fill(HX0, 34, HX1 - HX0, 1, timber[3])
  p.fill(HX0, 41, HX1 - HX0, 1, timber[0])
  for (let bx = HX0 + 2; bx < HX1; bx += 5) p.fill(bx, 35, 1, 6, timber[1])
  // Murder holes in its floor.
  for (let bx = HX0 + 3; bx < HX1 - 2; bx += 7) p.fill(bx, 41, 3, 1, iron[0])
  // Pent roof over it, shingled.
  for (let i = 0; i < 6; i += 1) {
    p.fill(HX0 - 1 + i, 33 - i, HX1 - HX0 + 2 - i * 2, 1, i < 2 ? roof[3] : roof[2])
    p.set(HX1 - HX0 + HX0 - i, 33 - i, roof[4])
  }
  // Support struts angling back into the wall.
  p.line(HX0, 42, HX0 - 4, 50, timber[1])
  p.line(HX0 + 1, 42, HX0 - 3, 50, timber[2])
  p.line(HX1 - 1, 42, HX1 + 3, 50, timber[1])
  contactShadow(p, HX0 - 1, 42, HX1 - HX0 + 2, stone)

  // ── banner from the wall walk, clear of the turret slots ───────────────
  banner(p, 20, 52, 11, 26, accent, timber)
  // Painted shields hung along the walk.
  for (const sx of [40, 49, 58]) {
    // Heater shields: square shoulders, tapering to a point.
    p.fill(sx, 51, 7, 4, accent[2])
    p.fill(sx, 51, 7, 1, accent[4])
    p.fill(sx, 51, 1, 4, accent[1])
    p.fill(sx + 1, 55, 5, 1, accent[2])
    p.fill(sx + 2, 56, 3, 1, accent[1])
    p.set(sx + 3, 57, accent[1])
    p.fill(sx + 3, 52, 1, 4, accent[4])
    p.fill(sx + 1, 53, 5, 1, accent[4])
    p.fill(sx - 1, 50, 9, 1, stone[3])
  }
}

// ───────────────────────────── 2 · Star-fort bastion ─────────────────────────────

/**
 * The shape gunpowder forced on fortification: nothing tall enough to be
 * knocked down, everything angled so there is no face a gun can hit square. A
 * sloped glacis, a battered brick scarp with a stone cordon, a salient jutting
 * at the enemy, and a raised cavalier carrying the heavy pieces.
 */
function bastion(p: Pix, n: Noise, accent: Ramp, cast: Cast): void {
  // Two brick tones: the curtain sits back and reads cooler, the bastion is
  // thrown forward into the light. That difference is the entire star-fort
  // read — without it the whole thing collapses into one brick box.
  const brick = ramp(cast(0x8a5140, 0.12), { contrast: 0.95, hueShift: 0.03 })
  const front = ramp(cast(0xac6a4e, 0.12), { contrast: 0.95, hueShift: 0.03 })
  const dressed = ramp(cast(0xbdb59d), { contrast: 0.95 })
  const glacis = ramp(cast(0x6d6440), { contrast: 0.75, hueShift: 0.05 })
  const iron = ramp(0x3f444c, { contrast: 1.25 })
  const slate = ramp(cast(0x5e6068), { contrast: 0.9 })
  const timber = ramp(cast(0x5f4529, 0.08), { contrast: 0.95 })
  const brickOpts = { courseH: 4, minW: 6, varW: 4, jitter: false, mortar: false } as const

  // ── the rear curtain, low and battered ─────────────────────────────────
  const CUR_PARAPET = 46
  const CUR_CORDON = 56
  const CUR_FOOT = 108
  const curtainScarp = taperSpan(CUR_CORDON + 4, CUR_FOOT, [6, 64], [2, 68])
  mass(p, CUR_CORDON + 4, CUR_FOOT, curtainScarp, brick)
  masonry(p, CUR_CORDON + 4, CUR_FOOT, curtainScarp, brick, n, brickOpts)
  grimeDown(p, CUR_CORDON + 4, CUR_FOOT, curtainScarp, brick, 1.15)

  const curtainParapet = rectSpan(4, 64)
  mass(p, CUR_PARAPET, CUR_CORDON, curtainParapet, brick)
  masonry(p, CUR_PARAPET, CUR_CORDON, curtainParapet, brick, n, brickOpts)

  // Cordon: the heavy rounded stone roll that divides the sloping scarp from
  // the vertical parapet. On a real bastion it is the boldest line there is.
  const cordon = (x0: number, x1: number, y: number, r: Ramp): void => {
    p.fill(x0, y, x1 - x0, 5, r[2])
    p.fill(x0, y, x1 - x0, 1, r[4])
    p.fill(x0, y + 1, x1 - x0, 1, r[3])
    p.fill(x0, y + 4, x1 - x0, 1, r[0])
    p.set(x0, y + 2, r[1])
    p.set(x1 - 1, y + 2, r[3])
  }
  cordon(2, 66, CUR_CORDON, dressed)
  contactShadow(p, 4, CUR_CORDON + 5, 62, brick)
  trim(p, 4, CUR_CORDON - 2, 60, accent)
  p.fill(4, CUR_PARAPET, 60, 2, dressed[3])
  p.fill(4, CUR_PARAPET, 60, 1, dressed[4])

  // ── magazine: a low bomb-proof behind the curtain ──────────────────────
  const MX0 = 5
  const MX1 = 32
  for (let i = 0; i < 10; i += 1) {
    const y = CUR_PARAPET - 1 - i
    const inset = Math.round(i * 1.3)
    if (MX1 - MX0 - inset * 2 <= 0) break
    p.fill(MX0 + inset, y, MX1 - MX0 - inset * 2, 1, i < 2 ? slate[3] : slate[2])
    p.set(MX1 - inset - 1, y, slate[4])
    p.set(MX0 + inset, y, slate[1])
    if (i % 3 === 0) p.fill(MX0 + inset + 1, y, MX1 - MX0 - inset * 2 - 2, 1, slate[1])
  }
  // Vent stack and cowl.
  p.fill(25, CUR_PARAPET - 18, 4, 9, slate[2])
  p.fill(28, CUR_PARAPET - 18, 1, 9, slate[3])
  p.fill(24, CUR_PARAPET - 19, 6, 2, slate[3])
  p.fill(24, CUR_PARAPET - 19, 6, 1, slate[4])

  // ── cavalier: the raised gun platform rising out of the middle ─────────
  const CX0 = 34
  const CX1 = 66
  const CAV_TOP = SLOT_TOP_Y + 2
  const cavSpan = taperSpan(CAV_TOP, CUR_PARAPET, [CX0 + 1, CX1 - 1], [CX0, CX1])
  mass(p, CAV_TOP, CUR_PARAPET, cavSpan, front)
  masonry(p, CAV_TOP, CUR_PARAPET, cavSpan, front, n, brickOpts)
  // Stringcourse round it.
  p.fill(CX0, 28, CX1 - CX0, 2, dressed[2])
  p.fill(CX0, 28, CX1 - CX0, 1, dressed[4])
  p.fill(CX0, 30, CX1 - CX0, 1, front[0])
  // Coping and the breastworks at each end of the platform.
  p.fill(CX0 - 1, CAV_TOP, CX1 - CX0 + 2, 2, dressed[3])
  p.fill(CX0 - 1, CAV_TOP, CX1 - CX0 + 2, 1, dressed[4])
  p.fill(CX0 - 1, CAV_TOP + 2, CX1 - CX0 + 2, 1, front[0])
  for (const bx of [CX0 - 1, CX1 - 5]) {
    p.fill(bx, CAV_TOP - 5, 6, 6, dressed[2])
    p.fill(bx, CAV_TOP - 5, 6, 1, dressed[4])
    p.fill(bx, CAV_TOP - 5, 1, 6, dressed[1])
  }
  // Blind arcade — brickwork with an idea in it.
  for (let ax = CX0 + 3; ax < CX1 - 6; ax += 8) {
    p.ellipse(ax + 3, 36, 3, 2.6, front[1])
    p.fill(ax + 1, 36, 6, 7, front[1])
    p.fill(ax + 2, 36, 4, 6, front[0])
    p.fill(ax + 5, 37, 1, 5, front[1])
  }
  // The cavalier throws a shadow down onto the curtain behind it.
  contactShadow(p, CX0, CUR_PARAPET, CX1 - CX0, brick)
  grimeDown(p, CAV_TOP, CUR_PARAPET, cavSpan, front, 0.55)

  // ── sally port through the curtain scarp ───────────────────────────────
  const SX0 = 22
  const SX1 = 42
  p.fill(SX0, 74, SX1 - SX0, 30, dressed[1])
  p.fill(SX0 + 2, 76, SX1 - SX0 - 4, 27, timber[2])
  for (let a = 0; a <= 20; a += 1) {
    const ang = Math.PI + (a / 20) * Math.PI
    const px = Math.round((SX0 + SX1) / 2 + Math.cos(ang) * ((SX1 - SX0) / 2))
    const py = Math.round(76 + Math.sin(ang) * 7)
    if (py > 76) continue
    p.set(px, py, a % 3 === 0 ? dressed[1] : dressed[3])
    p.set(px, py - 1, dressed[2])
    p.set(px, py + 1, dressed[0])
  }
  p.ellipse((SX0 + SX1) / 2, 77, (SX1 - SX0) / 2 - 2, 5, timber[2])
  p.fill((SX0 + SX1) / 2 - 1, 74, 2, 30, timber[0])
  for (let sy = 80; sy < 102; sy += 5) {
    for (let sx = SX0 + 4; sx < SX1 - 3; sx += 5) rivet(p, sx, sy, iron)
  }
  contactShadow(p, SX0, 70, SX1 - SX0, brick)

  // ── the bastion: thrown forward and stepped up, angled at its shoulder ──
  const BAS_PARAPET = 36
  const BAS_CORDON = 48
  const BAS_FOOT = 112
  // Left edge is the pan coupé — the cut-off angle joining bastion to curtain.
  const basLeft = (y: number): number => {
    if (y < BAS_CORDON) return Math.round(66 - ((y - BAS_PARAPET) / (BAS_CORDON - BAS_PARAPET)) * 6)
    return Math.round(60 - ((y - BAS_CORDON) / (BAS_FOOT - BAS_CORDON)) * 6)
  }
  const basSpan: Span = (y) => [basLeft(y), y < BAS_CORDON ? 99 : Math.min(100, 94 + Math.round(((y - BAS_CORDON) / 60) * 6))] as const
  const basScarp: Span = (y) => [basLeft(y), Math.min(100, 94 + Math.round(((y - BAS_CORDON) / 60) * 6))] as const

  mass(p, BAS_CORDON + 4, BAS_FOOT, basScarp, front)
  masonry(p, BAS_CORDON + 4, BAS_FOOT, basScarp, front, n, brickOpts)
  grimeDown(p, BAS_CORDON + 4, BAS_FOOT, basScarp, front, 1.0)

  mass(p, BAS_PARAPET, BAS_CORDON, basSpan, front)
  masonry(p, BAS_PARAPET, BAS_CORDON, basSpan, front, n, brickOpts)
  cordon(58, 100, BAS_CORDON, dressed)
  contactShadow(p, 60, BAS_CORDON + 5, 39, front)
  trim(p, 60, BAS_CORDON - 2, 39, accent)
  p.fill(60, BAS_PARAPET, 39, 2, dressed[3])
  p.fill(60, BAS_PARAPET, 39, 1, dressed[4])

  // The re-entrant angle: a hard shadow where the bastion overlaps the
  // curtain, and a lit arris on the bastion side of it. This one line is what
  // makes the fort read as two planes meeting at an angle.
  for (let y = BAS_PARAPET; y < BAS_FOOT; y += 1) {
    const x = basLeft(y)
    p.set(x - 2, y, front[0])
    p.set(x - 1, y, front[0])
    p.set(x, y, front[1])
    p.set(x + 1, y, front[3])
    p.set(x + 2, y, front[4])
  }

  // Pale stone stringcourses banding both scarps.
  for (const bandY of [72, 90]) {
    for (let y = bandY; y < bandY + 2; y += 1) {
      const [a0, a1] = curtainScarp(y)
      const [b0, b1] = basScarp(y)
      p.fill(a0, y, Math.max(0, a1 - a0), 1, y === bandY ? dressed[2] : dressed[0])
      p.fill(b0 + 3, y, Math.max(0, b1 - b0 - 3), 1, y === bandY ? dressed[4] : dressed[1])
    }
  }

  // ── embrasures, with guns run out through the front pair ───────────────
  const embrasure = (ex: number, top: number, gun: boolean): void => {
    for (let i = 0; i < 7; i += 1) {
      const spread = Math.round(i * 0.5)
      p.fill(ex - spread, top + i, 7 + spread * 2, 1, front[0])
    }
    p.fill(ex - 2, top + 6, 11, 1, dressed[1])
    p.fill(ex - 2, top + 7, 11, 1, dressed[3])
    if (!gun) return
    p.fill(ex, top + 2, 11, 4, iron[2])
    p.fill(ex, top + 2, 11, 1, iron[3])
    p.fill(ex, top + 5, 11, 1, iron[0])
    p.fill(ex + 9, top + 1, 2, 6, iron[3])
    p.fill(ex + 3, top + 1, 2, 6, iron[1])
    p.set(ex + 10, top + 3, iron[0])
    p.set(ex + 10, top + 4, iron[0])
  }
  embrasure(8, CUR_PARAPET, false)
  embrasure(24, CUR_PARAPET, false)
  embrasure(70, BAS_PARAPET, true)
  embrasure(86, BAS_PARAPET, true)

  // A casemated gun port low in the bastion face.
  p.fill(84, 76, 12, 6, front[0])
  p.fill(84, 75, 12, 1, dressed[3])
  p.fill(84, 82, 12, 1, dressed[1])
  p.fill(88, 77, 9, 3, iron[2])
  p.fill(88, 77, 9, 1, iron[3])

  // ── glacis: the earth ramp that swallows the foot of the scarps ────────
  const glacisTop = (x: number): number => 100 + (n(x >> 2, 5) > 0.55 ? 1 : 0)
  for (let x = 0; x < BW; x += 1) {
    const top = glacisTop(x)
    p.fill(x, top, 1, BH - top, glacis[2])
    p.set(x, top, glacis[4])
    p.fill(x, top + 1, 1, 2, glacis[3])
  }
  for (let y = 100; y < BH; y += 1) {
    const t = (y - 100) / (BH - 100)
    for (let x = 0; x < BW; x += 1) if (ditherAt(x, y, t * 1.1)) p.set(x, y, glacis[1])
  }
  mottle(p, 100, BH, rectSpan(0, BW), glacis, n, 0.16)
  // Gabions and stakes along the covered way.
  for (let x = 4; x < 96; x += 11) {
    if (n(x, 44) < 0.4) continue
    const top = glacisTop(x) - 4
    p.fill(x, top, 5, 5, timber[2])
    p.fill(x, top, 5, 1, timber[3])
    p.fill(x, top + 2, 5, 1, timber[1])
    p.set(x, top, timber[1])
  }

  // ── flagstaff and colours, kept clear of the turret slots ──────────────
  p.fill(69, 8, 2, 30, timber[2])
  p.fill(70, 8, 1, 30, timber[3])
  p.ellipse(70, 7, 2, 2, dressed[3])
  banner(p, 72, 10, 13, 17, accent, timber)
  // Painted regimental board on the cavalier.
  p.fill(44, 37, 13, 6, accent[2])
  p.fill(44, 37, 13, 1, accent[3])
  p.fill(46, 39, 9, 1, accent[4])
  p.fill(46, 41, 9, 1, accent[1])
}

// ────────────────────────────── 3 · Concrete bunker ──────────────────────────────

/**
 * Poured concrete: form-tie marks in a grid, board seams, rain staining running
 * out of every lip, chipped corners with the aggregate showing. Steel where it
 * has to take a hit, sandbags where there was no time to pour, and a lattice
 * mast because the modern fort's real weapon is the radio.
 */
function bunker(p: Pix, n: Noise, accent: Ramp, cast: Cast): void {
  const conc = ramp(cast(0x7c7f79), { contrast: 0.95, hueShift: 0.012 })
  const deep = ramp(cast(0x5e615c), { contrast: 0.9 })
  const steel = ramp(cast(0x5b636d, 0.1), { contrast: 1.25 })
  const bag = ramp(cast(0x8a7a55, 0.08), { contrast: 0.8 })
  const warm = ramp(0xd8b451, { contrast: 1.0 })
  const mast = metalMaterial(cast(0x6a7280, 0.1)).ramp
  const rust = ramp(0x6b4a2c, { contrast: 0.8 })

  const ROOF = SLOT_SIDE_Y
  const BLOCK_TOP = 56
  const FENCE_X1 = 13

  // ── cracked apron the whole complex stands on ──────────────────────────
  const APRON = GROUND - 6
  p.fill(0, APRON, BW, BH - APRON, deep[2])
  p.fill(0, APRON, BW, 1, deep[3])
  for (let x = 0; x < BW; x += 1) {
    if (n(x, 200) > 0.72) p.fill(x, APRON + 1, 1, 2 + Math.round(n(x, 201) * 5), deep[1])
  }
  mottle(p, APRON, BH, rectSpan(0, BW), deep, n, 0.14)

  // ── main casemate: a battered block with a deflecting front face ───────
  const blockSpan = taperSpan(BLOCK_TOP, 118, [FENCE_X1 + 1, 86], [FENCE_X1 - 3, 97])
  mass(p, BLOCK_TOP, 118, blockSpan, conc)
  // Board-form seams, then the form-tie grid, then staining. In that order:
  // ties sit in the boards, stains run over everything.
  for (let x = FENCE_X1; x < 98; x += 13) {
    for (let y = BLOCK_TOP; y < 118; y += 1) {
      const [x0, x1] = blockSpan(y)
      if (x < x0 || x >= x1) continue
      p.set(x, y, conc[1])
      if (x + 1 < x1) p.set(x + 1, y, conc[3])
    }
  }
  for (let y = BLOCK_TOP + 5; y < 116; y += 11) {
    for (let x = FENCE_X1 + 4; x < 97; x += 13) {
      const [x0, x1] = blockSpan(y)
      if (x < x0 + 1 || x >= x1 - 1) continue
      p.set(x, y, conc[0])
      p.set(x + 1, y, conc[1])
      p.set(x, y - 1, conc[3])
    }
  }
  mottle(p, BLOCK_TOP, 118, blockSpan, conc, n, 0.11)

  // ── roof slab, overhanging on both sides ───────────────────────────────
  const roofSpan = rectSpan(6, 95)
  mass(p, ROOF, BLOCK_TOP, roofSpan, conc)
  p.fill(6, ROOF, 89, 2, conc[3])
  p.fill(6, ROOF, 89, 1, conc[4])
  p.fill(6, ROOF + 5, 89, 1, conc[1])
  contactShadow(p, 8, ROOF + 6, 85, conc)
  // The drip lip: a shadow band under the slab, then stains running out of it.
  p.fill(FENCE_X1, ROOF + 6, 74, 1, conc[0])
  for (let x = 8; x < 95; x += 3) {
    if (n(x, 33) < 0.62) continue
    const len = 4 + Math.round(n(x, 34) * 22)
    for (let y = ROOF + 7; y < ROOF + 7 + len; y += 1) {
      if ((p.get(x, y) >>> 24) === 0) continue
      if (ditherAt(x, y, 1 - (y - ROOF - 7) / len)) p.set(x, y, conc[1])
    }
  }
  // Chipped corners with the aggregate showing.
  for (const [cx, cy] of [
    [6, ROOF],
    [94, ROOF],
    [95, 117]
  ]) {
    for (let i = 0; i < 5; i += 1) {
      const dx = cx < 50 ? Math.round(n(i, 51) * 3) : -Math.round(n(i, 51) * 3)
      p.set(cx + dx, cy + Math.round(n(i, 52) * 3), 0, 0)
    }
    p.set(cx, cy + 3, conc[0])
  }

  // ── hazard striping along the roof edge ────────────────────────────────
  hazard(p, 58, ROOF + 2, 32, 3, warm, tone(0x1b1c1e, 0))

  // ── command cupola ─────────────────────────────────────────────────────
  const CU0 = 36
  const CU1 = 64
  const CU_TOP = SLOT_TOP_Y + 2
  chamfer(p, CU0, CU_TOP, CU1 - CU0, ROOF - CU_TOP, conc)
  p.fill(CU0 - 2, CU_TOP, CU1 - CU0 + 4, 3, conc[2])
  p.fill(CU0 - 2, CU_TOP, CU1 - CU0 + 4, 1, conc[4])
  p.fill(CU0 - 2, CU_TOP + 2, CU1 - CU0 + 4, 1, conc[0])
  // Vision band: a deep slot with a lit lower lip.
  p.fill(CU0 + 2, CU_TOP + 8, CU1 - CU0 - 4, 4, deep[0])
  p.fill(CU0 + 2, CU_TOP + 7, CU1 - CU0 - 4, 1, conc[1])
  p.fill(CU0 + 2, CU_TOP + 12, CU1 - CU0 - 4, 1, conc[4])
  // Periscope and hatch.
  p.fill(CU1 - 8, CU_TOP - 5, 3, 6, steel[2])
  p.fill(CU1 - 6, CU_TOP - 5, 1, 6, steel[3])
  p.fill(CU1 - 9, CU_TOP - 6, 5, 2, steel[3])
  p.fill(CU0 + 3, ROOF - 8, 8, 7, steel[1])
  rivetRow(p, CU0 + 3, ROOF - 8, 8, 3, steel)
  mottle(p, CU_TOP, ROOF, rectSpan(CU0, CU1), conc, n, 0.1)
  // Stencilled insignia in the faction colour.
  p.fill(CU0 + 15, CU_TOP + 16, 10, 7, accent[2])
  p.fill(CU0 + 15, CU_TOP + 16, 10, 1, accent[3])
  p.line(CU0 + 16, CU_TOP + 21, CU0 + 20, CU_TOP + 17, accent[4])
  p.line(CU0 + 20, CU_TOP + 17, CU0 + 23, CU_TOP + 21, accent[4])

  // ── lattice radio mast ─────────────────────────────────────────────────
  const MX = 25
  p.fill(MX - 2, 4, 2, ROOF - 4, mast[2])
  p.fill(MX + 2, 4, 2, ROOF - 4, mast[2])
  p.fill(MX - 1, 4, 1, ROOF - 4, mast[3])
  p.fill(MX + 3, 4, 1, ROOF - 4, mast[3])
  for (let y = 6; y < ROOF - 3; y += 6) {
    p.line(MX - 1, y, MX + 3, y + 6, mast[1])
    p.line(MX + 3, y, MX - 1, y + 6, mast[1])
    p.fill(MX - 2, y, 6, 1, mast[3])
  }
  // Guys, anchored to the roof slab.
  p.line(MX, 8, 9, ROOF, mast[1])
  p.line(MX + 2, 8, 44, ROOF, mast[1])
  // Whip and the beacon, in the faction colour.
  p.fill(MX, 0, 1, 5, mast[3])
  emissive(p, MX, 3, 2, 2, accent)
  p.fill(MX - 4, 12, 3, 1, mast[3])
  p.fill(MX + 4, 18, 3, 1, mast[3])

  // ── armoured firing embrasure ──────────────────────────────────────────
  const EX0 = 32
  const EX1 = 70
  p.fill(EX0, 64, EX1 - EX0, 3, conc[1])
  p.fill(EX0, 67, EX1 - EX0, 5, deep[0])
  p.fill(EX0, 72, EX1 - EX0, 2, conc[4])
  p.fill(EX0, 74, EX1 - EX0, 1, conc[1])
  // Sloped cheeks either side of the slot.
  for (let i = 0; i < 4; i += 1) {
    p.fill(EX0 - 1 - i, 66 + i, 2, 8 - i * 2, conc[1])
    p.fill(EX1 - 1 + i, 66 + i, 2, 8 - i * 2, conc[3])
  }
  // The gun inside it.
  p.fill(EX1 - 12, 68, 16, 3, steel[1])
  p.fill(EX1 - 4, 68, 12, 2, steel[2])
  p.fill(EX1 - 4, 68, 12, 1, steel[3])
  p.fill(EX1 + 6, 67, 2, 4, steel[3])

  // ── forward annexe: a lower block stepped out in front of the casemate ──
  const AN_TOP = 78
  const anSpan = taperSpan(AN_TOP + 5, 118, [3, 38], [0, 41])
  mass(p, AN_TOP + 5, 118, anSpan, conc)
  p.fill(0, AN_TOP, 42, 5, conc[2])
  p.fill(0, AN_TOP, 42, 1, conc[4])
  p.fill(0, AN_TOP + 1, 42, 1, conc[3])
  p.fill(0, AN_TOP + 4, 42, 1, conc[0])
  contactShadow(p, 3, AN_TOP + 5, 35, conc)
  for (let x = 4; x < 40; x += 13) {
    p.fill(x, AN_TOP + 5, 1, 113 - AN_TOP, conc[1])
    p.fill(x + 1, AN_TOP + 5, 1, 113 - AN_TOP, conc[3])
  }
  for (let y = AN_TOP + 12; y < 116; y += 11) {
    for (let x = 9; x < 38; x += 13) {
      p.set(x, y, conc[0])
      p.set(x + 1, y, conc[1])
      p.set(x, y - 1, conc[3])
    }
  }
  mottle(p, AN_TOP + 5, 118, anSpan, conc, n, 0.11)
  for (let x = 1; x < 41; x += 3) {
    if (n(x, 133) < 0.6) continue
    const len = 4 + Math.round(n(x, 134) * 16)
    for (let y = AN_TOP + 5; y < AN_TOP + 5 + len; y += 1) {
      if ((p.get(x, y) >>> 24) === 0) continue
      if (ditherAt(x, y, 1 - (y - AN_TOP - 5) / len)) p.set(x, y, conc[1])
    }
  }
  // Louvred plant-room vent.
  p.fill(23, 88, 14, 12, deep[1])
  p.fill(23, 88, 14, 1, conc[4])
  for (let i = 0; i < 5; i += 1) {
    p.fill(24, 90 + i * 2, 12, 1, deep[0])
    p.fill(24, 91 + i * 2, 12, 1, deep[3])
  }
  p.fill(22, 87, 16, 1, conc[3])
  // Personnel door, recessed.
  p.fill(6, 96, 13, 22, deep[0])
  box(p, 7, 98, 11, 20, steel)
  p.fill(16, 106, 2, 3, steel[4])
  rivetRow(p, 8, 100, 9, 4, steel)
  hazard(p, 7, 110, 11, 3, warm, tone(0x191a1c, 0))
  // Cable conduit dropping down the face into the ground.
  p.fill(40, AN_TOP + 5, 2, 34, steel[1])
  p.fill(41, AN_TOP + 5, 1, 34, steel[3])
  for (let y = AN_TOP + 9; y < 116; y += 8) p.fill(39, y, 4, 2, steel[2])

  // ── steel blast door ───────────────────────────────────────────────────
  const DX0 = 62
  const DX1 = 88
  p.fill(DX0 - 3, 80, DX1 - DX0 + 6, 40, conc[3])
  p.fill(DX0 - 3, 80, DX1 - DX0 + 6, 1, conc[4])
  p.fill(DX0 - 3, 81, 1, 39, conc[1])
  p.fill(DX0 - 1, 82, DX1 - DX0 + 2, 1, conc[0])
  box(p, DX0, 84, DX1 - DX0, 34, steel)
  p.fill(DX0 + Math.floor((DX1 - DX0) / 2) - 1, 84, 2, 34, steel[0])
  p.fill(DX0 + Math.floor((DX1 - DX0) / 2) + 1, 85, 1, 33, steel[3])
  rivetRow(p, DX0 + 1, 86, DX1 - DX0 - 2, 4, steel)
  rivetRow(p, DX0 + 1, 115, DX1 - DX0 - 2, 4, steel)
  for (let hy = 88; hy < 116; hy += 12) {
    p.fill(DX0 + 1, hy, 4, 5, steel[3])
    p.fill(DX0 + 1, hy + 4, 4, 1, steel[0])
    p.fill(DX1 - 5, hy, 4, 5, steel[1])
  }
  hazard(p, DX0 + 2, 96, DX1 - DX0 - 4, 4, warm, tone(0x191a1c, 0))
  // Vision port and its cover.
  p.fill(DX0 + 6, 89, 6, 3, deep[0])
  p.fill(DX0 + 6, 88, 6, 1, steel[3])
  // Rust weeping from the hinges.
  for (let hy = 92; hy < 118; hy += 3) {
    if (n(hy, 77) < 0.5) continue
    p.set(DX0 + 5, hy, rust[1])
    p.set(DX0 + 5, hy + 1, rust[2])
  }

  // ── sandbag emplacements ───────────────────────────────────────────────
  for (let row = 0; row < 5; row += 1) {
    const by = 118 - row * 3
    for (let bx = 60 + (row % 2) * 4 - row; bx < 99; bx += 8) {
      if (bx + 7 > 99) break
      sandbag(p, bx, by, 7, bag)
    }
  }
  for (let row = 0; row < 2; row += 1) {
    const by = ROOF - 3 - row * 3
    for (let bx = 66 + (row % 2) * 4; bx < 93; bx += 8) sandbag(p, bx, by, 7, bag)
  }
  mottle(p, ROOF - 6, ROOF, rectSpan(66, 93), bag, n, 0.16)

  // ── caged ladder up the casemate face ──────────────────────────────────
  const LX = 52
  for (let y = ROOF + 8; y < 116; y += 1) {
    p.set(LX, y, mast[1])
    p.set(LX + 5, y, mast[2])
    if (y % 3 === 0) {
      p.fill(LX, y, 6, 1, mast[3])
      p.fill(LX, y + 1, 6, 1, mast[0])
    }
  }
  for (let y = ROOF + 10; y < 112; y += 6) {
    p.fill(LX - 2, y, 1, 4, mast[1])
    p.fill(LX + 7, y, 1, 4, mast[2])
    p.fill(LX - 2, y, 10, 1, mast[3])
  }

  // ── painted service band, the one bit of colour on all that concrete ───
  p.fill(46, 102, 26, 9, conc[1])
  p.fill(46, 102, 26, 1, conc[3])
  p.fill(46, 110, 26, 1, conc[0])
  p.fill(48, 104, 22, 5, accent[1])
  p.fill(48, 104, 22, 1, accent[2])
  p.line(50, 108, 55, 105, accent[3])
  p.line(55, 105, 60, 108, accent[3])
  p.fill(62, 105, 6, 3, accent[3])
  // Chipped and faded, so it reads as paint on concrete rather than a light.
  for (let x = 46; x < 72; x += 1) {
    for (let y = 102; y < 111; y += 1) {
      if (n(x, y) > 0.78 && ditherAt(x, y, 0.6)) p.set(x, y, conc[2])
    }
  }

  // ── stencilled designation, sprayed straight onto the concrete ─────────
  for (let i = 0; i < 3; i += 1) {
    const sx = 76 + i * 6
    // Outline-only glyphs: sprayed through a stencil, not a lit window.
    p.frame(sx, 62, 4, 8, conc[0])
    if (i === 0) p.fill(sx + 1, 65, 2, 1, conc[0])
    if (i === 1) p.fill(sx + 1, 62, 2, 4, conc[2])
    if (i === 2) {
      p.fill(sx + 1, 65, 2, 1, conc[0])
      p.fill(sx + 1, 66, 2, 3, conc[2])
    }
    for (let y = 62; y < 70; y += 1) if (n(sx, y) > 0.7) p.set(sx + 2, y, conc[2])
  }

  // ── chain-link, standing on the annexe roof ────────────────────────────
  const FY0 = 62
  for (let y = FY0 + 1; y < AN_TOP; y += 1) {
    for (let x = 1; x < 29; x += 1) {
      // Two crossing diagonal families make the mesh; dithering keeps it airy
      // instead of turning into a solid grey panel.
      const mesh = (x + y) % 4 === 0 || (x - y + 80) % 4 === 0
      if (mesh && ditherAt(x, y, 0.5)) p.set(x, y, deep[1])
    }
  }
  for (const px of [2, 13, 25]) {
    p.fill(px, FY0 - 1, 2, AN_TOP - FY0 + 1, mast[2])
    p.fill(px + 1, FY0 - 1, 1, AN_TOP - FY0 + 1, mast[3])
    p.line(px + 1, FY0, px + 4, FY0 - 4, mast[2])
  }
  p.fill(1, FY0, 28, 1, mast[3])
  p.fill(1, FY0 + 1, 28, 1, mast[1])
  p.fill(1, AN_TOP - 1, 28, 1, mast[1])
  // Razor coil along the top.
  for (let x = 2; x < 29; x += 4) p.ellipseFrame(x + 2, FY0 - 5, 2.4, 1.8, mast[3])
}

// ────────────────────────────── 4 · Energy citadel ──────────────────────────────

/**
 * Not a building. The hull is a dark composite waist that pinches in around a
 * containment core and flares out again, capped by a shoulder, and the two
 * heaviest plates are not attached to it at all — they hang off each side with
 * clear air between, which is the whole point of the silhouette. A broken
 * emitter arc springs from plate to plate over the top.
 */
function citadel(p: Pix, n: Noise, accent: Ramp, cast: Cast, player: boolean): void {
  const hull = ramp(cast(0x2c3252, 0.16), { contrast: 1.4, hueShift: 0.02 })
  const plate = ramp(cast(0x3a4166, 0.16), { contrast: 1.3, hueShift: 0.02 })
  const glowBase = player ? 0x4fd8ff : 0xff5a6e
  const glow = energy(glowBase).ramp
  const hot = mix(glowBase, 0xffffff, 0.65)

  // ── landing struts, planted in the ground ──────────────────────────────
  for (const [sx0, sx1] of [
    [40, 27],
    [50, 50],
    [60, 73]
  ]) {
    shaft(p, sx0, 108, sx1, 123, 5, hull)
    p.fill(sx1 - 4, 121, 9, 3, hull[1])
    p.fill(sx1 - 4, 121, 9, 1, hull[3])
  }

  // ── hull: an hourglass, wide at the shoulder, pinched at the core ──────
  const halfAt = (y: number): number => {
    if (y < 60) return 26 - ((y - 44) / 16) * 4
    if (y < 86) return 22 - ((y - 60) / 26) * 8
    if (y < 102) return 14 + ((y - 86) / 16) * 4
    return 18 + ((y - 102) / 16) * 3
  }
  const hullSpan: Span = (y) => {
    const h = Math.round(halfAt(y))
    return [50 - h, 50 + h] as const
  }
  mass(p, 44, 120, hullSpan, hull)
  // Panel seams: a shadowed groove with the light catching the row below it.
  for (const sy of [56, 70, 92, 106]) {
    const [x0, x1] = hullSpan(sy)
    p.fill(x0 + 1, sy, x1 - x0 - 2, 1, hull[0])
    p.fill(x0 + 1, sy + 1, x1 - x0 - 2, 1, hull[3])
  }
  // Vertical facet lines, so the hull reads as folded plate not a tube.
  for (const fx of [-11, 11]) {
    for (let y = 46; y < 118; y += 1) {
      const h = Math.round(halfAt(y))
      const x = 50 + Math.round(fx * (h / 22))
      if ((p.get(x, y) >>> 24) === 0) continue
      p.set(x, y, hull[fx < 0 ? 1 : 3])
    }
  }
  mottle(p, 44, 120, hullSpan, hull, n, 0.07)
  // Two glowing channels running the height of the hull.
  for (const gx of [-6, 6]) {
    for (let y = 50; y < 112; y += 1) {
      const h = Math.round(halfAt(y))
      const x = 50 + Math.round(gx * (h / 22))
      if ((p.get(x, y) >>> 24) === 0) continue
      p.set(x, y - 1, hull[0])
      p.set(x, y, ditherAt(x, y, 0.72) ? glow[4] : glow[3])
    }
  }

  // ── containment core at the waist ──────────────────────────────────────
  const CY = 84
  for (let y = -13; y <= 13; y += 1) {
    for (let x = -13; x <= 13; x += 1) {
      const d = Math.hypot(x, y * 1.05) / 13
      if (d > 1) continue
      const px = 50 + x
      const py = CY + y
      if ((p.get(px, py) >>> 24) === 0) continue
      if (ditherAt(px, py, (1 - d) * 1.05)) p.set(px, py, d < 0.42 ? glow[4] : glow[3])
    }
  }
  p.ellipse(50, CY, 5, 5, glow[4])
  p.ellipse(50, CY - 1, 2.6, 2.6, hot)
  // Containment ribs holding it, in hull material so it reads as caged.
  p.ellipseFrame(50, CY, 9, 9, hull[3])
  p.ellipseFrame(50, CY, 10, 10, hull[1])
  for (const a of [0.5, 1.6, 2.7, 3.8, 4.9]) {
    p.line(50 + Math.cos(a) * 6, CY + Math.sin(a) * 6, 50 + Math.cos(a) * 11, CY + Math.sin(a) * 11, hull[2])
  }

  // ── heat vents ─────────────────────────────────────────────────────────
  for (const vx of [-17, 8]) {
    for (let i = 0; i < 3; i += 1) {
      const y = 62 + i * 4
      const x = 50 + vx
      p.fill(x, y, 9, 1, hull[0])
      p.fill(x, y + 1, 9, 1, ditherAt(x, y, 0.5) ? glow[3] : glow[2])
      p.fill(x, y + 2, 9, 1, hull[3])
    }
  }

  // ── shoulder cap ───────────────────────────────────────────────────────
  chamfer(p, 30, 30, 40, 17, plate)
  p.fill(28, 30, 44, 3, plate[2])
  p.fill(28, 30, 44, 1, plate[4])
  p.fill(28, 32, 44, 1, plate[0])
  contactShadow(p, 30, 47, 40, hull)
  rivetRow(p, 32, 43, 36, 6, plate)
  // Faction chevron, painted on.
  p.fill(40, 36, 20, 5, accent[2])
  p.fill(40, 36, 20, 1, accent[3])
  p.line(43, 40, 50, 37, accent[4])
  p.line(50, 37, 57, 40, accent[4])

  // ── spire and emitter hardpoint ────────────────────────────────────────
  for (let y = 18; y < 32; y += 1) {
    const t = (y - 18) / 14
    const h = Math.round(3 + t * 3)
    p.fill(50 - h, y, h * 2, 1, plate[2])
    p.set(50 - h, y, plate[1])
    p.set(50 + h - 1, y, plate[3])
  }
  const HP_TOP = SLOT_TOP_Y - 1
  chamfer(p, 35, HP_TOP, 30, 8, plate)
  p.fill(35, HP_TOP, 30, 1, plate[4])
  p.fill(36, HP_TOP + 7, 28, 1, hull[0])
  // Emitter vents under the hardpoint.
  for (let i = 0; i < 5; i += 1) {
    const x = 38 + i * 6
    p.fill(x, HP_TOP + 5, 4, 1, glow[4])
    p.fill(x, HP_TOP + 6, 4, 1, glow[2])
  }

  // ── detached hovering plates ───────────────────────────────────────────
  const hoverPlate = (dir: 1 | -1): void => {
    const near = 50 + dir * 24
    const far = 50 + dir * 46
    for (let i = 0; i <= Math.abs(far - near); i += 1) {
      const x = near + dir * i
      const t = i / Math.abs(far - near)
      const top = Math.round(36 + t * 10)
      const bot = top + 9 - Math.round(t * 2)
      p.fill(x, top, 1, bot - top, plate[2])
      p.set(x, top, plate[4])
      p.set(x, top + 1, plate[3])
      p.set(x, bot - 1, plate[0])
      // Underside glow, the anti-grav field seen edge on.
      if (ditherAt(x, bot, 0.55)) p.set(x, bot - 2, glow[3])
    }
    // Leading edge, into the light on the right-hand plate.
    p.fill(far - (dir > 0 ? 1 : 0), 46, 1, 7, plate[dir > 0 ? 4 : 1])
    // A stack rib across the plate.
    for (let i = 6; i < 20; i += 6) {
      const x = near + dir * i
      const t = i / Math.abs(far - near)
      p.fill(x, Math.round(36 + t * 10) + 2, 1, 5, plate[1])
      p.fill(x + 1, Math.round(36 + t * 10) + 2, 1, 5, plate[3])
    }
  }
  hoverPlate(1)
  hoverPlate(-1)

  // ── shield emitter arc, springing from plate to plate ──────────────────
  const arc = (a0: number, a1: number): void => {
    for (let a = a0; a <= a1; a += 0.012) {
      const x = 50 + Math.cos(a) * 43
      const y = 56 + Math.sin(a) * 38
      for (let d = 0; d < 3; d += 1) {
        p.set(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), d === 2 ? hull[3] : hull[2])
      }
      // Inner face is the emitting one.
      p.set(Math.round(x - Math.cos(a)), Math.round(y - Math.sin(a)), ditherAt(Math.round(x), Math.round(y), 0.8) ? glow[4] : glow[3])
    }
  }
  arc(Math.PI * 1.02, Math.PI * 1.28)
  arc(Math.PI * 1.36, Math.PI * 1.64)
  arc(Math.PI * 1.72, Math.PI * 1.98)
  // Emitter nodes where the arc breaks.
  for (const a of [Math.PI * 1.32, Math.PI * 1.68]) {
    const x = 50 + Math.cos(a) * 43
    const y = 56 + Math.sin(a) * 38
    orb(p, x, y, 3, 3, plate)
    emissive(p, x, y, 1.6, 1.6, glow)
  }

  // ── base plinth and its exhaust ────────────────────────────────────────
  const [b0, b1] = hullSpan(118)
  p.fill(b0 - 3, 112, b1 - b0 + 6, 4, plate[2])
  p.fill(b0 - 3, 112, b1 - b0 + 6, 1, plate[4])
  p.fill(b0 - 3, 115, b1 - b0 + 6, 1, plate[0])
  for (let i = 0; i < 4; i += 1) {
    p.fill(b0 + 2 + i * 5, 117, 3, 4, glow[3])
    p.fill(b0 + 2 + i * 5, 117, 3, 1, hull[0])
  }
  grimeDown(p, 100, 120, hullSpan, hull, 0.8)
}
