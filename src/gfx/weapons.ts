import type { UnitVisual, WeaponVisual } from '../data/types'
import type { Canvas2D } from './painter'
import Pix, { RES, ramp, type Ramp } from './pixel'
import {
  PAD,
  box,
  chamfer,
  cloth as clothMat,
  contactShadow,
  emissive,
  energy as energyMat,
  leather as leatherMat,
  metal as metalMat,
  orb,
  partCanvas,
  rivet,
  rivetRow,
  sealPart,
  shaft,
  strap,
  trim
} from './anatomy'

/**
 * Every weapon in the game, drawn one pixel at a time.
 *
 * ## What a weapon has to do at this size
 *
 * A foot soldier is about thirty-three texture pixels tall, so the sword in his
 * hand is twenty pixels long and four pixels wide. Nobody will ever see the
 * fuller. What they *will* see is the outline — so the whole job here is
 * silhouette first: a spear, a lance and a staff must be three different shapes
 * before they are three different colours, or the roster reads as one stick
 * repainted nineteen times.
 *
 * The order of work for every weapon in this file is therefore:
 *
 * 1. **Silhouette.** Get the shape that names the weapon. A lance has a
 *    vamplate, an axe has a crescent, an LMG has a bipod and a magazine on top.
 * 2. **Two or three material zones.** Wood haft, leather grip, steel head. That
 *    is what tells the eye where the hand goes and where the damage comes from.
 * 3. **A handful of accent pixels.** A ferrule, a rivet, a glowing core. Never
 *    more; past this point extra detail turns to noise the moment the sprite
 *    rotates.
 *
 * ## The conventions
 *
 * - Weapons are authored **pointing right**, along +x. The rig aims them along
 *   that axis, so a bow is authored with the *arrow* pointing right, which puts
 *   its limbs vertical and its riser on the right — exactly how it is held.
 * - **Light comes from the upper right.** For a weapon lying along +x that
 *   means the top row of any bar is lit and the bottom row is in shadow, and
 *   the far (muzzle, tip, edge) end catches the highlight.
 * - Five tones per material, from `ramp()`, and **one outline post-pass** via
 *   `sealPart`. Nothing is ever stroked as it is drawn.
 */

export interface WeaponArtHi {
  canvas: Canvas2D
  /** The pixel the hand closes on, in canvas pixels. */
  grip: [number, number]
  /** Radians the weapon rides at when carried. Negative lifts the tip. */
  restAngle: number
  /** Whether the off hand should be pulled onto the haft. */
  twoHanded: boolean
}

// ─────────────────────────────── Materials ───────────────────────────────

/** Shared stock colours, so every haft in the army is cut from one tree. */
const WOOD = 0x76512f
const HIDE = 0x4a3120
const IRON = 0x555b64
const GUN = 0x34383f
const BRASS = 0x9c7c33
const STONE = 0x8b8271

/**
 * The palette a single weapon is drawn from.
 *
 * Built once per weapon and passed down, so a musket's brass furniture and a
 * sword's pommel are provably the same brass.
 */
interface Kit {
  /** Nominal length in texture pixels — every dimension is a fraction of it. */
  L: number
  steel: Ramp
  steelBase: number
  iron: Ramp
  gun: Ramp
  wood: Ramp
  hide: Ramp
  brass: Ramp
  glow: Ramp
  glowBase: number
  banner: Ramp
  stone: Ramp
}

function buildKit(v: UnitVisual, L: number): Kit {
  const steel = metalMat(v.metal)
  const glow = energyMat(v.accent)
  return {
    L,
    steel: steel.ramp,
    steelBase: steel.base,
    iron: metalMat(IRON).ramp,
    gun: metalMat(GUN).ramp,
    // Wood is treated as a soft material: low contrast, warm hue swing.
    wood: leatherMat(WOOD).ramp,
    hide: leatherMat(HIDE).ramp,
    brass: metalMat(BRASS).ramp,
    glow: glow.ramp,
    glowBase: glow.base,
    banner: clothMat(v.cloth).ramp,
    stone: ramp(STONE, { contrast: 0.8, hueShift: 0.03 })
  }
}

// ─────────────────────────────── Primitives ───────────────────────────────

interface BeamOpts {
  /** Ramp index for the lit top row. */
  lit?: number
  /** Ramp index for the body. */
  core?: number
  /** Ramp index for the shadowed bottom row. */
  shade?: number
  /** Vertical offset of the centreline along the run — for curved parts. */
  bendAt?: (t: number) => number
}

/**
 * A bar running along +x whose height varies with position: hafts, barrels,
 * stocks, tubes. Top row lit, bottom row shadowed, which is the light rule
 * expressed for a horizontal object.
 */
function beam(
  p: Pix,
  x0: number,
  x1: number,
  cy: number,
  hAt: (t: number) => number,
  r: Ramp,
  opts: BeamOpts = {}
): void {
  const X0 = Math.round(x0)
  const X1 = Math.max(X0, Math.round(x1))
  const span = Math.max(1, X1 - X0)
  const lit = opts.lit ?? 3
  const core = opts.core ?? 2
  const shade = opts.shade ?? 1
  for (let i = 0; i <= X1 - X0; i += 1) {
    const t = i / span
    const h = Math.max(1, Math.round(hAt(t)))
    const centre = cy + (opts.bendAt ? opts.bendAt(t) : 0)
    const top = Math.round(centre - h / 2)
    p.fill(X0 + i, top, 1, h, r[core])
    p.set(X0 + i, top, r[lit])
    if (h > 2) p.set(X0 + i, top + h - 1, r[shade])
  }
}

/**
 * The tone stack for one column of a blade, top row first.
 *
 * A blade is not a flat bar: it has a bevel that catches the light at the top,
 * a fuller ground down the middle that stays dark, and a shadowed lower edge.
 * Three ideas in four pixels is the most this scale will carry.
 */
function bladeRows(h: number): number[] {
  if (h <= 1) return [3]
  if (h === 2) return [4, 1]
  if (h === 3) return [4, 2, 1]
  if (h === 4) return [4, 1, 2, 0]
  const rows = [4, 3, 1]
  while (rows.length < h - 1) rows.push(2)
  rows.push(0)
  return rows
}

/** A blade running along +x, bevelled and fullered, tapering to its point. */
function edged(
  p: Pix,
  x0: number,
  x1: number,
  cy: number,
  hAt: (t: number) => number,
  r: Ramp,
  bendAt?: (t: number) => number
): void {
  const X0 = Math.round(x0)
  const X1 = Math.max(X0, Math.round(x1))
  const span = Math.max(1, X1 - X0)
  for (let i = 0; i <= X1 - X0; i += 1) {
    const t = i / span
    const h = Math.max(1, Math.round(hAt(t)))
    const rows = bladeRows(h)
    const top = Math.round(cy + (bendAt ? bendAt(t) : 0) - h / 2)
    for (let row = 0; row < h; row += 1) p.set(X0 + i, top + row, r[rows[row]])
  }
}

/**
 * A wrapped grip: cord or leather bound round a haft.
 *
 * Drawn as alternating ridges, each with its top face relit. Two pixels of
 * rhythm, and the single clearest signal of *where the hand goes* — which at
 * this size matters more than any amount of shading on the blade.
 */
function gripWrap(p: Pix, x0: number, x1: number, cy: number, h: number, r: Ramp): void {
  const H = Math.max(2, Math.round(h))
  const X0 = Math.round(x0)
  const X1 = Math.max(X0 + 1, Math.round(x1))
  const top = Math.round(cy - H / 2)
  const w = X1 - X0 + 1
  p.fill(X0, top, w, H, r[2])
  p.fill(X0, top, w, 1, r[3])
  if (H > 2) p.fill(X0, top + H - 1, w, 1, r[1])
  for (let x = X0 + 1; x < X1; x += 2) {
    p.fill(x, top + 1, 1, Math.max(1, H - 1), r[1])
    p.set(x, top, r[4])
  }
}

/** A metal band round a haft or barrel: ferrule, barrel band, reinforcing ring. */
function band(p: Pix, x: number, cy: number, w: number, h: number, r: Ramp): void {
  const W = Math.max(1, Math.round(w))
  const H = Math.max(2, Math.round(h))
  const X = Math.round(x)
  const top = Math.round(cy - H / 2)
  p.fill(X, top, W, H, r[2])
  p.fill(X, top, W, 1, r[4])
  p.fill(X, top + H - 1, W, 1, r[0])
}

/** A pistol grip, raked back as it drops — the modern-firearm tell. */
function pistolGrip(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
  const W = Math.max(2, Math.round(w))
  const H = Math.max(2, Math.round(h))
  const X = Math.round(x)
  const Y = Math.round(y)
  const lower = Math.max(1, Math.floor(H / 2))
  box(p, X, Y, W, H - lower, r)
  box(p, X - 1, Y + H - lower, W, lower, r)
}

/** A trigger guard: a thin loop, open at the top where it meets the receiver. */
function triggerGuard(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
  const W = Math.max(2, Math.round(w))
  const H = Math.max(2, Math.round(h))
  const X = Math.round(x)
  const Y = Math.round(y)
  p.fill(X, Y + H - 1, W, 1, r[1])
  p.fill(X + W - 1, Y, 1, H, r[3])
  p.set(X, Y + H - 2, r[1])
}

/** A sight post standing above a barrel. Tiny, and it reads as *aimable*. */
function sightPost(p: Pix, x: number, y: number, h: number, r: Ramp): void {
  const H = Math.max(1, Math.round(h))
  const X = Math.round(x)
  const Y = Math.round(y)
  p.fill(X, Y - H, 1, H, r[2])
  p.set(X, Y - H, r[4])
}

// ─────────────────────────────── Melee ───────────────────────────────

function drawClub(k: Kit): WeaponArtHi {
  const L = k.L
  const headH = Math.max(4, Math.round(L * 0.34))
  const haftH = Math.max(2, Math.round(L * 0.12))
  const buttR = Math.max(1.2, L * 0.07)
  const p = partCanvas(L + 2, headH + 3)
  const cy = Math.round(p.h / 2)
  const x0 = PAD + Math.round(buttR)
  const x1 = PAD + L - 1

  // The head grows out of the haft rather than being stuck onto it — a club is
  // one piece of wood, and the swelling is the whole silhouette.
  beam(p, x0, x1, cy, (t) => haftH + (headH - haftH) * Math.pow(t, 1.7), k.wood)
  // Knock the leading corners so the head reads as turned, not sawn.
  const headTop = Math.round(cy - headH / 2)
  p.set(x1, headTop, 0, 0)
  p.set(x1, headTop + headH - 1, 0, 0)
  p.set(x1 - 1, headTop, 0, 0)

  // Iron studs across the striking face, on the lit upper half.
  const studX = PAD + Math.round(L * 0.78)
  rivet(p, studX, cy - Math.round(headH * 0.26), k.iron)
  rivet(p, studX + Math.max(2, Math.round(L * 0.09)), cy - Math.round(headH * 0.1), k.iron)
  rivet(p, studX + 1, cy + Math.round(headH * 0.2), k.iron)

  gripWrap(p, x0 + 1, PAD + Math.round(L * 0.34), cy, haftH, k.hide)
  orb(p, x0, cy, buttR, Math.max(1.2, haftH * 0.62), k.wood)

  return {
    canvas: sealPart(p, WOOD),
    grip: [PAD + Math.round(L * 0.18), cy],
    restAngle: -0.55,
    twoHanded: false
  }
}

function drawSword(k: Kit): WeaponArtHi {
  const L = k.L
  const bladeH = Math.max(4, Math.round(L * 0.19))
  const guardH = Math.max(5, Math.round(L * 0.36))
  const guardW = Math.max(2, Math.round(L * 0.06))
  const gripL = Math.max(3, Math.round(L * 0.15))
  const pomR = Math.max(1.5, L * 0.075)

  const p = partCanvas(L + 2, guardH + 4)
  const cy = Math.round(p.h / 2)
  // Laid out from the point backwards, so the blade always gets its share.
  const bladeX1 = PAD + L - 1
  const bladeX0 = bladeX1 - Math.max(4, Math.round(L * 0.6))
  const guardX = Math.max(PAD + 2, bladeX0 - guardW)
  const gripX1 = guardX - 1
  const gripX0 = Math.max(PAD + 2, gripX1 - gripL)
  const pomX = Math.max(PAD + 1, gripX0 - 1)

  edged(
    p,
    bladeX0,
    bladeX1,
    cy,
    (t) => {
      const body = bladeH * (1 - 0.2 * t)
      return t < 0.82 ? body : body * (1 - ((t - 0.82) / 0.18) * 0.88)
    },
    k.steel
  )

  // Cruciform guard, quillons tipped in brass.
  chamfer(p, guardX, cy - Math.round(guardH / 2), guardW, guardH, k.steel)
  p.set(guardX + guardW - 1, cy - Math.round(guardH / 2) + 1, k.brass[3])
  p.set(guardX + guardW - 1, cy + Math.round(guardH / 2) - 2, k.brass[1])

  gripWrap(p, gripX0, gripX1, cy, Math.max(2, Math.round(L * 0.09)), k.hide)
  orb(p, pomX, cy, pomR, pomR * 1.05, k.steel)
  if (pomR >= 2) emissive(p, pomX, cy, 0.9, 0.9, k.glow)

  return {
    canvas: sealPart(p, k.steelBase),
    grip: [Math.round((gripX0 + gripX1) / 2), cy],
    // A long blade rides up and back over the shoulder; a short one sits closer
    // to level. Both read as *carried* rather than as held out.
    restAngle: L >= 22 ? -0.72 : -0.5,
    twoHanded: L >= 24
  }
}

function drawSaber(k: Kit): WeaponArtHi {
  const L = k.L
  const bladeH = Math.max(3, Math.round(L * 0.15))
  const gripL = Math.max(3, Math.round(L * 0.15))
  const curve = Math.max(2, L * 0.13)
  const p = partCanvas(L + 2, Math.max(9, Math.round(L * 0.5)))
  const cy = Math.round(p.h / 2 + curve * 0.35)

  const bladeX1 = PAD + L - 1
  const bladeX0 = bladeX1 - Math.max(5, Math.round(L * 0.66))
  const gripX1 = bladeX0 - 1
  const gripX0 = Math.max(PAD + 1, gripX1 - gripL)

  // The blade sweeps upward toward the point — a single curve is the whole
  // difference between this and the straight sword above.
  const bend = (t: number) => -curve * t * t
  edged(
    p,
    bladeX0,
    bladeX1,
    cy,
    (t) => {
      const body = bladeH * (1 - 0.15 * t)
      return t < 0.78 ? body : body * (1 - ((t - 0.78) / 0.22) * 0.85)
    },
    k.steel,
    bend
  )

  // Knuckle bow: a bar sweeping from the guard back under the grip to the
  // pommel. It closes the silhouette into a loop nothing else in the roster has.
  const bowSpan = Math.max(2, gripX1 - gripX0)
  const bowDrop = Math.max(2, Math.round(L * 0.13))
  for (let i = 0; i <= bowSpan; i += 1) {
    const t = i / bowSpan
    const x = gripX1 - i
    const y = cy + 1 + Math.round(Math.sin(Math.PI * t) * bowDrop)
    p.set(x, y, k.brass[2])
    p.set(x, y - 1, k.brass[3])
  }
  band(p, gripX1, cy, 1, bladeH + 2, k.brass)

  gripWrap(p, gripX0, gripX1 - 1, cy, Math.max(2, Math.round(L * 0.085)), k.hide)
  orb(p, gripX0, cy, Math.max(1.2, L * 0.055), Math.max(1.2, L * 0.06), k.brass)

  return {
    canvas: sealPart(p, k.steelBase),
    grip: [Math.round((gripX0 + gripX1) / 2), cy],
    restAngle: -0.48,
    twoHanded: false
  }
}

function drawAxe(k: Kit): WeaponArtHi {
  const L = k.L
  const haftH = Math.max(2, Math.round(L * 0.1))
  const up = Math.max(3, L * 0.26)
  const down = Math.max(3, L * 0.21)
  const p = partCanvas(L + 2, Math.round(up + down) + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD
  const x1 = PAD + L - 1
  const bx = PAD + Math.round(L * 0.62)

  beam(p, x0, x1 - 1, cy, () => haftH, k.wood)

  // A bearded bit: convex cutting edge facing the way the weapon points,
  // hollow behind it, with a spike over the eye.
  const outer: [number, number][] = [
    [bx, cy - up],
    [x1 - 1, cy - up * 0.52],
    [x1, cy - up * 0.06],
    [x1, cy + down * 0.12],
    [x1 - 1, cy + down * 0.62],
    [bx, cy + down],
    [bx + (x1 - bx) * 0.42, cy]
  ]
  p.poly(outer, k.steel[1])
  p.poly(
    [
      [bx + 1, cy - up + 1.2],
      [x1 - 2, cy - up * 0.5 + 1],
      [x1 - 1, cy - up * 0.06],
      [x1 - 1, cy + down * 0.12],
      [x1 - 2, cy + down * 0.6 - 1],
      [bx + 1, cy + down - 1.2],
      [bx + 1 + (x1 - bx) * 0.42, cy]
    ],
    k.steel[2]
  )
  // The cutting edge takes the light; the underside of the beard loses it.
  p.line(x1 - 1, cy - up * 0.52, x1, cy - up * 0.06, k.steel[4])
  p.line(x1, cy - up * 0.06, x1, cy + down * 0.12, k.steel[4])
  p.line(x1, cy + down * 0.12, x1 - 1, cy + down * 0.62, k.steel[3])
  p.line(bx, cy - up, x1 - 1, cy - up * 0.52, k.steel[3])
  p.line(bx, cy + down, x1 - 1, cy + down * 0.62, k.steel[0])

  // Eye and langets: the wedge that holds the head on the haft.
  band(p, bx - 1, cy, 2, haftH + 2, k.iron)
  p.line(bx - Math.round(L * 0.1), cy - haftH * 0.5, bx - 1, cy - haftH * 0.5, k.iron[3])
  p.line(bx - Math.round(L * 0.1), cy + haftH * 0.5, bx - 1, cy + haftH * 0.5, k.iron[1])

  gripWrap(p, x0 + 1, PAD + Math.round(L * 0.3), cy, haftH, k.hide)
  band(p, x0, cy, 1, haftH + 1, k.iron)

  return {
    canvas: sealPart(p, k.steelBase),
    grip: [PAD + Math.round(L * 0.17), cy],
    restAngle: -0.5,
    twoHanded: L >= 24
  }
}

function drawSpear(k: Kit): WeaponArtHi {
  const L = k.L
  const haftH = Math.max(2, Math.round(L * 0.06))
  const headH = Math.max(3, Math.round(L * 0.14))
  const p = partCanvas(L + 2, Math.max(7, headH + 4))
  const cy = Math.round(p.h / 2)
  const x1 = PAD + L - 1
  const headX0 = PAD + Math.round(L * 0.74)

  // Butt spike: a small wedge, so the far end is not a blunt sawn-off stick.
  edged(p, PAD, PAD + Math.round(L * 0.05), cy, (t) => 1 + (haftH - 1) * t, k.iron)
  beam(p, PAD + Math.round(L * 0.05), headX0, cy, () => haftH, k.wood)

  // Socket, then a narrow leaf head. Long, thin and pointed — nothing on it
  // that could be mistaken for the axe's mass or the lance's cone.
  band(p, headX0 - 1, cy, 2, haftH + 2, k.iron)
  edged(
    p,
    headX0,
    x1,
    cy,
    (t) => (t < 0.3 ? haftH + (headH - haftH) * (t / 0.3) : headH * (1 - ((t - 0.3) / 0.7) * 0.9)),
    k.steel
  )

  // Two bindings: the spear's own signature, and they show where both hands go.
  strap(p, PAD + Math.round(L * 0.3), cy - Math.round(haftH / 2), Math.max(2, Math.round(L * 0.06)), haftH, k.hide)
  gripWrap(p, PAD + Math.round(L * 0.46), PAD + Math.round(L * 0.62), cy, haftH, k.hide)

  return {
    canvas: sealPart(p, WOOD),
    grip: [PAD + Math.round(L * 0.54), cy],
    restAngle: -0.3,
    twoHanded: true
  }
}

function drawLance(k: Kit): WeaponArtHi {
  const L = k.L
  const buttH = Math.max(3, Math.round(L * 0.13))
  const gripH = Math.max(2, Math.round(L * 0.08))
  const bodyH = Math.max(3, Math.round(L * 0.12))
  const vampH = Math.max(6, Math.round(L * 0.4))
  const p = partCanvas(L + 2, Math.max(13, Math.round(L * 0.6)))
  const cy = Math.round(p.h / 2 + L * 0.08)
  const x1 = PAD + L - 1

  // One continuous cone from a fat butt to a needle point, waisted where the
  // hand closes. Nothing else in the roster tapers over its whole length.
  beam(
    p,
    PAD,
    x1,
    cy,
    (t) => {
      if (t < 0.08) return buttH
      if (t < 0.3) return gripH
      return bodyH * (1 - Math.max(0, (t - 0.34) / 0.66) * 0.94)
    },
    k.wood
  )
  band(p, PAD, cy, 1, buttH + 1, k.iron)

  // Vamplate: the steel cone that guards the hand. This is the lance.
  const vampX = PAD + Math.round(L * 0.31)
  const vampW = Math.max(2, Math.round(L * 0.08))
  for (let i = 0; i < vampW; i += 1) {
    const h = Math.round(vampH * (0.42 + 0.58 * (i / Math.max(1, vampW - 1))))
    const top = Math.round(cy - h / 2)
    p.fill(vampX + i, top, 1, h, k.steel[2])
    p.set(vampX + i, top, k.steel[3])
    p.set(vampX + i, top + h - 1, k.steel[1])
  }
  p.fill(vampX + vampW - 1, Math.round(cy - vampH / 2), 1, 1, k.steel[4])
  rivetRow(p, vampX, Math.round(cy - vampH * 0.3), vampW, 2, k.steel)

  gripWrap(p, PAD + Math.round(L * 0.12), vampX - 2, cy, gripH, k.hide)

  // Pennon, flown from the shaft behind the point.
  const penX = PAD + Math.round(L * 0.72)
  const penH = Math.max(3, Math.round(L * 0.18))
  p.poly(
    [
      [penX, cy - 1],
      [penX - penH * 0.9, cy - penH],
      [penX + penH * 0.5, cy - penH * 0.86]
    ],
    k.banner[2]
  )
  p.line(penX - penH * 0.9, cy - penH, penX + penH * 0.5, cy - penH * 0.86, k.banner[3])
  p.line(penX, cy - 1, penX - penH * 0.9, cy - penH, k.banner[1])

  return {
    canvas: sealPart(p, WOOD),
    grip: [PAD + Math.round(L * 0.2), cy],
    restAngle: -0.12,
    twoHanded: true
  }
}

function drawStaff(k: Kit): WeaponArtHi {
  const L = k.L
  const staffH = Math.max(2, Math.round(L * 0.08))
  const ringR = Math.max(3, L * 0.15)
  const p = partCanvas(L + 2, Math.max(9, Math.round(ringR * 2 + 4)))
  const cy = Math.round(p.h / 2)
  const x1 = PAD + L - 1
  const ringCx = x1 - Math.round(ringR)

  // A knotted stave: the height wobbles by a pixel, deterministically, so it
  // reads as grown wood rather than as dowel.
  beam(p, PAD, ringCx, cy, (t) => staffH + (Math.sin(t * 13) > 0.72 ? 1 : 0), k.wood)
  band(p, PAD, cy, 1, staffH + 1, k.iron)

  // Crown: an open ring holding a stone. The hole in the silhouette is what
  // separates a staff from every other pole in the game.
  p.ellipse(ringCx, cy, ringR, ringR, k.wood[1])
  p.ellipse(ringCx + ringR * 0.13, cy - ringR * 0.13, ringR * 0.96, ringR * 0.96, k.wood[2])
  p.eraseEllipse(ringCx, cy, ringR - 1.15, ringR - 1.15)
  p.set(Math.round(ringCx + ringR * 0.6), Math.round(cy - ringR * 0.66), k.wood[3])
  p.set(Math.round(ringCx + ringR * 0.92), Math.round(cy - ringR * 0.18), k.wood[3])
  band(p, ringCx - Math.round(ringR) - 1, cy, 2, staffH + 2, k.iron)
  emissive(p, ringCx, cy, Math.max(0.9, ringR * 0.34), Math.max(0.9, ringR * 0.34), k.glow)

  gripWrap(p, PAD + Math.round(L * 0.4), PAD + Math.round(L * 0.58), cy, staffH, k.hide)

  return {
    canvas: sealPart(p, WOOD),
    grip: [PAD + Math.round(L * 0.5), cy],
    restAngle: -1.05,
    twoHanded: true
  }
}

// ─────────────────────────────── Thrown & strung ───────────────────────────────

function drawSling(k: Kit): WeaponArtHi {
  const L = k.L
  const p = partCanvas(L + 2, Math.max(9, Math.round(L * 0.62)))
  const cy = Math.round(p.h / 2)
  const gx = PAD
  const spread = Math.max(2, Math.round(L * 0.22))
  const pouchX = PAD + Math.round(L * 0.74)

  // Two cords running out to a leather pouch. The V is the whole read.
  shaft(p, gx, cy, pouchX, cy - spread, 1, k.hide)
  shaft(p, gx, cy, pouchX, cy + spread * 0.9, 1, k.hide)
  p.line(gx, cy - 1, pouchX, cy - spread - 1, k.hide[3])

  // Pouch, cradling a stone. Drawn as a shallow cup so it is not just a blob.
  p.poly(
    [
      [pouchX, cy - spread],
      [pouchX + Math.round(L * 0.2), cy - spread * 0.45],
      [pouchX + Math.round(L * 0.2), cy + spread * 0.4],
      [pouchX, cy + spread * 0.9]
    ],
    k.hide[2]
  )
  p.line(pouchX, cy - spread, pouchX + Math.round(L * 0.2), cy - spread * 0.45, k.hide[3])
  orb(p, pouchX + Math.round(L * 0.13), cy, Math.max(1.4, L * 0.09), Math.max(1.4, L * 0.09), k.stone)

  return {
    canvas: sealPart(p, HIDE),
    grip: [gx, cy],
    restAngle: 0.5,
    twoHanded: false
  }
}

function drawBow(k: Kit): WeaponArtHi {
  const L = k.L
  // Authored with the *arrow* pointing right: limbs vertical, riser forward,
  // string behind. That is how it is held, and it aims correctly on the rig.
  const depth = Math.max(4, Math.round(L * 0.26))
  const p = partCanvas(depth + 3, L)
  const cy = Math.round(p.h / 2)
  const stringX = PAD
  const top = PAD
  const H = Math.max(4, L)
  const limbAt = (t: number) => stringX + Math.pow(Math.sin(t * Math.PI), 0.62) * depth

  for (let i = 0; i < H; i += 1) {
    const t = i / (H - 1)
    const near = Math.abs(t - 0.5)
    const th = near < 0.12 ? 3 : near < 0.32 ? 2 : 1
    const y = top + i
    const x = Math.round(limbAt(t)) - (th - 1)
    p.fill(x, y, th, 1, k.wood[2])
    // The outward face is the one turned toward the light.
    p.set(x + th - 1, y, k.wood[3])
    if (th > 1) p.set(x, y, k.wood[1])
    if (t < 0.05 || t > 0.95) p.set(x + th - 1, y, k.wood[1])
  }

  // String: one straight line between the nocks, in pale cord.
  p.line(stringX, top, stringX, top + H - 1, k.stone[3])
  p.set(stringX, top + Math.round(H * 0.5), k.stone[4])

  // Leather-bound riser, with a brass arrow rest above it.
  const gripR = Math.max(2, Math.round(H * 0.1))
  for (let i = -gripR; i <= gripR; i += 1) {
    const y = cy + i
    const t = (y - top) / (H - 1)
    const x = Math.round(limbAt(t)) - 2
    p.fill(x, y, 3, 1, ((i + gripR) & 1) === 0 ? k.hide[1] : k.hide[2])
    p.set(x + 2, y, k.hide[3])
  }
  const restY = cy - gripR - 1
  p.set(Math.round(limbAt((restY - top) / (H - 1))), restY, k.brass[3])

  return {
    canvas: sealPart(p, WOOD),
    grip: [Math.round(stringX + depth), cy],
    restAngle: 0,
    twoHanded: true
  }
}

function drawGrenade(k: Kit): WeaponArtHi {
  const L = k.L
  const r = Math.max(2.5, L * 0.34)
  // Sized from the ring and spoon rather than from the body, so the fuse
  // furniture never runs off the top of the texture at large scales.
  const p = partCanvas(Math.round(r * 3), Math.round(r * 3))
  const cx = Math.round(PAD + r) + 1
  const cy = Math.round(PAD + r * 1.55)

  orb(p, cx, cy + 1, r, r * 1.1, k.wood)
  // Fragmentation grooves: one band round the waist, two down the body.
  p.line(cx - r, cy + 1, cx + r, cy + 1, k.wood[1])
  p.line(cx - r * 0.3, cy - r * 0.9, cx - r * 0.3, cy + r * 1.1, k.wood[1])
  p.line(cx + r * 0.45, cy - r * 0.85, cx + r * 0.45, cy + r * 1.05, k.wood[1])

  // Fuse cap, spoon and pull ring — the parts that name the object.
  band(p, cx - 1, cy - r * 1.15, 3, 2, k.iron)
  p.line(cx + 1, cy - r * 1.35, cx + r * 1.5, cy - r * 0.5, k.iron[3])
  p.set(Math.round(cx + r * 1.5), Math.round(cy - r * 0.5), k.iron[4])
  p.ellipseFrame(cx - r * 0.75, cy - r * 1.4, 1.4, 1.2, k.iron[3])

  return {
    canvas: sealPart(p, WOOD),
    grip: [cx, cy + 1],
    restAngle: -0.2,
    twoHanded: false
  }
}

// ─────────────────────────────── Firearms ───────────────────────────────

function drawMusket(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const p = partCanvas(L + 2, Math.max(11, Math.round(L * 0.46)))
  const cy = Math.round(p.h / 2)
  const barrelY = cy - Math.max(1, Math.round(L * 0.055))
  const stockY = cy + 2
  const barrelH = Math.max(2, Math.round(L * 0.08))
  const foreH = Math.max(2, Math.round(L * 0.1))
  const buttH = Math.max(4, Math.round(L * 0.2))

  // Butt with a pronounced drop, wrist, then a full-length wooden fore-end:
  // the profile that says black powder before any part of it is identifiable.
  beam(p, fx(0), fx(0.1), stockY + 1, (t) => buttH - (buttH - foreH) * t * 0.35, k.wood)
  beam(p, fx(0.1), fx(0.34), stockY, (t) => foreH + (buttH - foreH) * (1 - t) * 0.55, k.wood)
  beam(p, fx(0.34), fx(0.88), stockY, () => foreH, k.wood)
  band(p, fx(0), stockY + 1, 1, buttH, k.brass)

  // Barrel above the wood, tapering to a slightly flared muzzle.
  beam(p, fx(0.3), fx(1), barrelY, (t) => barrelH * (1 - 0.16 * t), k.gun)
  band(p, fx(0.97), barrelY, 2, barrelH + 2, k.iron)

  // Barrel bands wrapping wood and steel together.
  const bandTop = barrelY - barrelH / 2
  const bandBot = stockY + foreH / 2
  for (const f of [0.5, 0.68, 0.84]) {
    band(p, fx(f), (bandTop + bandBot) / 2, 1, bandBot - bandTop, k.iron)
  }
  // Ramrod, seated in its channel under the fore-end.
  p.fill(fx(0.4), Math.round(stockY + foreH / 2) - 1, fx(0.9) - fx(0.4), 1, k.brass[1])

  // Lock: plate, and a hammer standing above the breech. The action, visible.
  box(p, fx(0.31), stockY - Math.floor(foreH / 2) - 1, Math.max(3, Math.round(L * 0.11)), 3, k.iron)
  const hamX = fx(0.28)
  p.fill(hamX, barrelY - barrelH, 2, Math.max(2, Math.round(L * 0.1)), k.iron[2])
  p.set(hamX + 1, barrelY - barrelH, k.iron[4])
  p.set(hamX, barrelY - barrelH, k.iron[1])
  p.set(hamX + 2, barrelY - barrelH + 1, k.brass[3])

  triggerGuard(p, fx(0.3), Math.round(stockY + foreH / 2), Math.max(3, Math.round(L * 0.1)), 3, k.brass)
  sightPost(p, fx(0.94), Math.round(barrelY - barrelH / 2), 1, k.iron)

  return {
    canvas: sealPart(p, WOOD),
    grip: [fx(0.32), stockY],
    restAngle: -0.05,
    twoHanded: true
  }
}

function drawRifle(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const p = partCanvas(L + 2, Math.max(13, Math.round(L * 0.54)))
  // One bore line runs the whole weapon; the receiver is the only thing that
  // hangs below it. That single alignment is what makes a firearm read as
  // engineered rather than as a stack of boxes.
  const bore = Math.round(p.h / 2) - 1
  const recH = Math.max(4, Math.round(L * 0.2))
  const recTop = Math.round(bore - recH * 0.42)
  const recBot = recTop + recH
  const stockH = Math.max(3, Math.round(L * 0.14))
  const barrelH = Math.max(2, Math.round(L * 0.075))
  const portW = Math.max(2, Math.round(L * 0.09))

  // Straight-line stock, boxy receiver, slim barrel: three lengths at three
  // thicknesses, which is the whole modern-rifle read.
  beam(p, fx(0), fx(0.3), bore, (t) => stockH + (t < 0.14 ? 2 : 0), k.gun)
  p.fill(fx(0), bore - Math.round(stockH / 2) - 1, 1, stockH + 2, k.gun[0])
  chamfer(p, fx(0.28), recTop, fx(0.58) - fx(0.28), recH, k.gun)

  // Ejection port and charging handle — the action, on the lit upper flank.
  p.fill(fx(0.4), recTop + 1, portW, 1, k.gun[0])
  p.fill(fx(0.4), recTop, portW, 1, k.gun[4])
  p.fill(fx(0.32), recTop - 1, 2, 1, k.iron[3])

  // Handguard with vent slots, then the barrel.
  beam(p, fx(0.58), fx(0.82), bore, () => Math.max(3, Math.round(L * 0.12)), k.gun)
  for (const f of [0.63, 0.69, 0.75]) {
    p.fill(fx(f), bore, 1, Math.max(1, Math.round(L * 0.05)), k.gun[0])
  }
  beam(p, fx(0.82), fx(1), bore, () => barrelH, k.gun)
  band(p, fx(0.98), bore, 1, barrelH + 1, k.iron)

  // Magazine, raked forward, and the grip below the receiver.
  const magH = Math.max(3, Math.round(L * 0.2))
  const magW = Math.max(2, Math.round(L * 0.09))
  box(p, fx(0.46), recBot, magW, Math.ceil(magH / 2), k.gun)
  box(p, fx(0.46) - 1, recBot + Math.ceil(magH / 2), magW, Math.floor(magH / 2), k.gun)
  p.fill(fx(0.46) - 1, recBot + magH - 1, magW, 1, k.gun[0])
  pistolGrip(p, fx(0.3), recBot, Math.max(2, Math.round(L * 0.08)), Math.max(3, Math.round(L * 0.16)), k.gun)
  triggerGuard(p, fx(0.36), recBot, Math.max(3, Math.round(L * 0.08)), 3, k.gun)

  // Sights: a rear leaf over the receiver and a post over the muzzle, far
  // enough apart to read as a sight line rather than as two bumps.
  sightPost(p, fx(0.54), recTop, 2, k.iron)
  sightPost(p, fx(0.92), bore - Math.round(barrelH / 2), 2, k.iron)

  return {
    canvas: sealPart(p, GUN),
    grip: [fx(0.33), recBot + 1],
    restAngle: 0,
    twoHanded: true
  }
}

function drawLmg(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const recH = Math.max(5, Math.round(L * 0.22))
  const barrelH = Math.max(3, Math.round(L * 0.11))
  const magH = Math.max(4, Math.round(L * 0.24))
  const gripH = Math.max(3, Math.round(L * 0.16))
  const legLen = Math.max(3, Math.round(L * 0.2))
  // The magazine stands well above the receiver and the bipod reaches well
  // below it, so the canvas is measured from those rather than guessed at.
  const above = Math.round(recH / 2 + magH + 2)
  const below = Math.round(Math.max(recH / 2 + gripH, barrelH / 2 + legLen) + 2)
  const p = partCanvas(L + 2, above + below)
  const cy = PAD + above

  // Shoulder stock, heavy receiver, thick ribbed barrel.
  beam(p, fx(0), fx(0.26), cy, (t) => Math.max(3, Math.round(L * 0.15)) + (t < 0.1 ? 2 : 0), k.gun)
  box(p, fx(0.24), Math.round(cy - recH / 2), fx(0.56) - fx(0.24), recH, k.gun)
  rivet(p, fx(0.3), Math.round(cy - recH / 2) + 2, k.gun)
  rivet(p, fx(0.5), Math.round(cy - recH / 2) + 2, k.gun)
  beam(p, fx(0.56), fx(1), cy - 1, (t) => barrelH * (1 - 0.12 * t), k.gun)
  for (const f of [0.62, 0.7, 0.78, 0.86]) band(p, fx(f), cy - 1, 1, barrelH + 2, k.iron)
  band(p, fx(0.99), cy - 1, 1, barrelH + 2, k.iron)

  // Box magazine standing on top of the receiver, and a carry handle beyond
  // it. Both break the top line, which is what tells an LMG from a rifle.
  const magW = Math.max(3, Math.round(L * 0.11))
  const magTop = Math.round(cy - recH / 2) - magH
  box(p, fx(0.38), magTop, magW, magH, k.gun)
  p.fill(fx(0.38), magTop, magW, 1, k.gun[4])
  contactShadow(p, fx(0.38), Math.round(cy - recH / 2), magW, k.gun)
  const handX = fx(0.6)
  const handW = Math.max(3, Math.round(L * 0.12))
  p.fill(handX, cy - 1 - barrelH, handW, 1, k.iron[3])
  p.fill(handX, cy - barrelH, 1, 1, k.iron[1])
  p.fill(handX + handW - 1, cy - barrelH, 1, 1, k.iron[1])

  // Bipod: two splayed legs under the muzzle end. Unmistakable in outline.
  const bipodY = Math.round(cy - 1 + barrelH / 2)
  shaft(p, fx(0.84), bipodY, fx(0.84) - legLen * 0.5, bipodY + legLen, 1, k.iron)
  shaft(p, fx(0.84), bipodY, fx(0.84) + legLen * 0.45, bipodY + legLen, 1, k.iron)

  const gripTop = Math.round(cy + recH / 2)
  pistolGrip(p, fx(0.28), gripTop, Math.max(2, Math.round(L * 0.08)), gripH, k.gun)
  triggerGuard(p, fx(0.34), gripTop, Math.max(3, Math.round(L * 0.08)), 3, k.gun)

  return {
    canvas: sealPart(p, GUN),
    grip: [fx(0.31), gripTop + 1],
    restAngle: 0.02,
    twoHanded: true
  }
}

function drawRpg(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const p = partCanvas(L + 2, Math.max(13, Math.round(L * 0.56)))
  const cy = Math.round(p.h / 2)
  const tubeH = Math.max(4, Math.round(L * 0.16))
  const headH = Math.max(5, Math.round(L * 0.22))

  // Venturi flare at the back, straight tube, bulbous warhead at the front —
  // fat at both ends and thin in the middle, which nothing else here is.
  beam(p, fx(0), fx(0.1), cy, (t) => headH * (1 - t * 0.45), k.gun)
  beam(p, fx(0.1), fx(0.84), cy, () => tubeH, k.gun)
  band(p, fx(0.8), cy, 1, tubeH + 2, k.iron)
  beam(
    p,
    fx(0.84),
    fx(1),
    cy,
    (t) => (t < 0.45 ? tubeH + (headH - tubeH) * (t / 0.45) : headH * (1 - ((t - 0.45) / 0.55) * 0.92)),
    k.steel
  )
  // Fins, just behind the warhead.
  p.fill(fx(0.82), Math.round(cy - tubeH / 2) - 2, 1, 2, k.iron[3])
  p.fill(fx(0.82), Math.round(cy + tubeH / 2), 1, 2, k.iron[1])

  // Wooden heat shield over the middle of the tube, banded at both ends.
  strap(p, fx(0.32), Math.round(cy - tubeH / 2), fx(0.6) - fx(0.32), tubeH, k.wood)
  rivetRow(p, fx(0.32), Math.round(cy - tubeH / 2) + 1, fx(0.6) - fx(0.32), 4, k.wood)

  // Optic, with an occlusion row where it meets the tube.
  const optX = fx(0.42)
  const optW = Math.max(3, Math.round(L * 0.12))
  box(p, optX, Math.round(cy - tubeH / 2) - 3, optW, 3, k.gun)
  contactShadow(p, optX, Math.round(cy - tubeH / 2), optW, k.gun)
  p.set(optX + optW - 1, Math.round(cy - tubeH / 2) - 2, k.glow[4])

  const gripTop = Math.round(cy + tubeH / 2)
  pistolGrip(p, fx(0.34), gripTop, Math.max(2, Math.round(L * 0.07)), Math.max(3, Math.round(L * 0.15)), k.gun)
  triggerGuard(p, fx(0.4), gripTop, Math.max(3, Math.round(L * 0.07)), 3, k.gun)

  return {
    canvas: sealPart(p, GUN),
    grip: [fx(0.37), gripTop + 1],
    restAngle: -0.06,
    twoHanded: true
  }
}

// ─────────────────────────────── Energy ───────────────────────────────

function drawLaser(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const p = partCanvas(L + 2, Math.max(12, Math.round(L * 0.5)))
  const cy = Math.round(p.h / 2)
  const housH = Math.max(4, Math.round(L * 0.2))
  const barH = Math.max(2, Math.round(L * 0.09))

  // Skeleton stock: an open frame, so the back end reads as a hole rather than
  // as a slab. Cheapest possible way to look like it was machined, not cast.
  const stH = Math.max(4, Math.round(L * 0.16))
  p.frame(fx(0), Math.round(cy - stH / 2), fx(0.24) - fx(0), stH, k.gun[2])
  p.fill(fx(0), Math.round(cy - stH / 2), fx(0.24) - fx(0), 1, k.gun[3])
  p.fill(fx(0), Math.round(cy + stH / 2) - 1, fx(0.24) - fx(0), 1, k.gun[1])

  // Dark housing with an emissive strip down its spine.
  chamfer(p, fx(0.22), Math.round(cy - housH / 2), fx(0.64) - fx(0.22), housH, k.gun)
  trim(p, fx(0.28), Math.round(cy - housH / 2) + 1, fx(0.6) - fx(0.28), k.glow)

  // Barrel with focusing rings, and a lens at the emitter.
  beam(p, fx(0.64), fx(0.92), cy - 1, () => barH, k.gun)
  band(p, fx(0.72), cy - 1, 1, barH + 2, k.steel)
  band(p, fx(0.82), cy - 1, 1, barH + 2, k.steel)
  p.fill(fx(0.92), Math.round(cy - 1 - barH / 2) - 1, 2, 1, k.steel[3])
  p.fill(fx(0.92), Math.round(cy - 1 + barH / 2), 2, 1, k.steel[1])
  emissive(p, fx(0.97), cy - 1, Math.max(1, L * 0.045), Math.max(1, barH * 0.5), k.glow)

  // Charge cell, slotted in under the housing and lit from within.
  const cellTop = Math.round(cy + housH / 2)
  const cellW = Math.max(3, Math.round(L * 0.1))
  box(p, fx(0.44), cellTop, cellW, Math.max(3, Math.round(L * 0.13)), k.gun)
  p.fill(fx(0.44) + 1, cellTop + 1, Math.max(1, cellW - 2), 1, k.glow[4])

  pistolGrip(p, fx(0.3), cellTop, Math.max(2, Math.round(L * 0.08)), Math.max(3, Math.round(L * 0.15)), k.gun)
  triggerGuard(p, fx(0.36), cellTop, Math.max(3, Math.round(L * 0.08)), 3, k.gun)

  return {
    canvas: sealPart(p, GUN),
    grip: [fx(0.33), cellTop + 1],
    restAngle: 0,
    twoHanded: true
  }
}

function drawRailgun(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const p = partCanvas(L + 2, Math.max(13, Math.round(L * 0.52)))
  const cy = Math.round(p.h / 2)
  const breechH = Math.max(6, Math.round(L * 0.26))
  const railH = Math.max(1, Math.round(L * 0.05))
  const gap = Math.max(2, Math.round(L * 0.07))

  // Shoulder brace and spine at the back.
  const braceH = Math.max(5, Math.round(L * 0.24))
  box(p, fx(0), Math.round(cy - braceH / 2), Math.max(2, Math.round(L * 0.05)), braceH, k.steel)
  beam(p, fx(0.04), fx(0.26), cy, () => Math.max(2, Math.round(L * 0.07)), k.steel)

  // Breech block, with charge coils reading as banded accent.
  chamfer(p, fx(0.24), Math.round(cy - breechH / 2), fx(0.5) - fx(0.24), breechH, k.steel)
  for (const f of [0.3, 0.37, 0.44]) {
    band(p, fx(f), cy, 1, breechH - 2, k.gun)
    p.set(fx(f) + 1, Math.round(cy - breechH / 2) + 2, k.glow[4])
  }
  trim(p, fx(0.28), Math.round(cy - breechH / 2) + 1, fx(0.48) - fx(0.28), k.glow)

  // Twin rails with the accelerator running between them. The fork is the
  // silhouette; nothing else in the game has a split muzzle.
  beam(p, fx(0.48), fx(1), cy - gap, () => railH, k.steel)
  beam(p, fx(0.48), fx(1), cy + gap, () => railH, k.steel)
  // One line of charge, dashed, with clear air on both sides of it — the gap
  // between the rails has to stay open or the fork reads as a solid slab.
  for (let x = fx(0.5); x <= fx(0.98); x += 1) {
    p.set(x, cy, (x & 1) === 0 ? k.glow[4] : k.glow[3])
  }
  p.set(fx(1), Math.round(cy - gap), k.steel[4])
  p.set(fx(1), Math.round(cy + gap), k.steel[3])

  const gripTop = Math.round(cy + breechH / 2)
  pistolGrip(p, fx(0.3), gripTop, Math.max(2, Math.round(L * 0.07)), Math.max(3, Math.round(L * 0.14)), k.steel)
  triggerGuard(p, fx(0.36), gripTop, Math.max(3, Math.round(L * 0.07)), 3, k.steel)

  return {
    canvas: sealPart(p, k.steelBase),
    grip: [fx(0.33), gripTop + 1],
    restAngle: 0,
    twoHanded: true
  }
}

function drawPlasma(k: Kit): WeaponArtHi {
  const L = k.L
  const fx = (f: number) => PAD + Math.round(L * f)
  const p = partCanvas(L + 2, Math.max(15, Math.round(L * 0.66)))
  const cy = Math.round(p.h / 2 - L * 0.06)
  const recH = Math.max(5, Math.round(L * 0.2))
  const barH = Math.max(3, Math.round(L * 0.13))

  // Stock and receiver.
  beam(p, fx(0.02), fx(0.3), cy, (t) => Math.max(3, Math.round(L * 0.12)) + (t < 0.12 ? 2 : 0), k.gun)
  chamfer(p, fx(0.28), Math.round(cy - recH / 2), fx(0.62) - fx(0.28), recH, k.gun)
  // Heat vents along the top of the receiver.
  for (const f of [0.36, 0.42, 0.48]) p.fill(fx(f), Math.round(cy - recH / 2) + 1, 1, 2, k.gun[0])

  // Short heavy barrel ending in a three-pronged containment cage.
  beam(p, fx(0.62), fx(0.86), cy - 1, () => barH, k.gun)
  band(p, fx(0.84), cy - 1, 2, barH + 2, k.steel)
  const cageX = fx(0.86)
  const cageR = Math.max(2, Math.round(L * 0.09))
  p.line(cageX, cy - 1 - cageR * 0.5, cageX + cageR * 1.4, cy - 1 - cageR, k.steel[3])
  p.line(cageX, cy - 1 + cageR * 0.5, cageX + cageR * 1.4, cy - 1 + cageR, k.steel[1])
  p.line(cageX, cy - 1, cageX + cageR * 1.5, cy - 1, k.steel[2])
  emissive(p, cageX + cageR * 0.8, cy - 1, cageR * 0.7, cageR * 0.7, k.glow)

  // Fuel canister slung under the receiver: the mass that names the weapon.
  const tankR = Math.max(3, L * 0.13)
  orb(p, fx(0.46), Math.round(cy + recH / 2 + tankR * 0.75), tankR * 1.15, tankR, k.steel)
  p.line(
    fx(0.46) - tankR,
    Math.round(cy + recH / 2 + tankR * 0.75),
    fx(0.46) + tankR,
    Math.round(cy + recH / 2 + tankR * 0.75),
    k.glow[4]
  )
  band(p, fx(0.46) - Math.round(tankR * 1.2), Math.round(cy + recH / 2 + tankR * 0.75), 1, tankR, k.gun)

  const gripTop = Math.round(cy + recH / 2)
  pistolGrip(p, fx(0.3), gripTop, Math.max(2, Math.round(L * 0.08)), Math.max(3, Math.round(L * 0.15)), k.gun)
  triggerGuard(p, fx(0.36), gripTop, Math.max(3, Math.round(L * 0.08)), 3, k.gun)

  return {
    canvas: sealPart(p, GUN),
    grip: [fx(0.33), gripTop + 1],
    restAngle: 0,
    twoHanded: true
  }
}

// ─────────────────────────────── Entry point ───────────────────────────────

/**
 * Draws one weapon, pointing right, ready for the rig to aim.
 *
 * `lengthPx` is the weapon's nominal length in *world* pixels; everything
 * inside is worked in texture pixels, so the art keeps its proportions at any
 * unit scale instead of being hand-tuned per size.
 *
 * Returns `null` for the two kinds that have no object to draw: an empty hand
 * and no weapon at all.
 */
/**
 * A STABBING TENTACLE. The Shrike's whole argument.
 *
 * Not a weapon somebody is holding — a limb that ends in a beak. It has to read
 * as flesh at a glance against a roster of steel, so: no grip wrap, no guard, a
 * boneless taper that kinks rather than curves, and a wet highlight running
 * along the top rather than a polished edge. The tip is the only hard thing on
 * it, which is the part that goes in.
 */
function drawTentacle(k: Kit): WeaponArtHi {
  const L = k.L
  const thick = Math.max(3, Math.round(L * 0.17))
  const p = partCanvas(L + 2, Math.max(9, thick * 3))
  const cy = Math.round(p.h / 2)
  const flesh = k.hide
  const beak = k.iron

  // Two kinks rather than one smooth arc: a boneless thing does not bend on a
  // radius, it folds where the muscle gives.
  const bend = (t: number) => {
    const a = Math.sin(t * 3.4) * thick * 0.55
    const b = Math.sin(t * 7.1) * thick * 0.22
    return -(a + b)
  }
  edged(
    p,
    PAD + 1,
    PAD + L - Math.round(L * 0.16),
    cy,
    t => thick * (1 - 0.42 * t),
    flesh,
    bend
  )

  // Suckers along the underside — the read that says this is not a whip.
  const span = Math.max(4, L - Math.round(L * 0.2))
  for (let i = 3; i < span; i += Math.max(3, Math.round(thick * 1.1))) {
    const t = i / span
    const h = thick * (1 - 0.42 * t)
    const y = Math.round(cy + bend(t) + h / 2 - 1)
    p.set(PAD + 1 + i, y, flesh[1])
    p.set(PAD + 1 + i, y - 1, flesh[3])
  }

  // The beak: a short hard spike, the one part of it that is not soft.
  const tipT = 1
  const tipX = PAD + L - Math.round(L * 0.16)
  const tipY = Math.round(cy + bend(tipT))
  const spike = Math.max(3, Math.round(L * 0.18))
  for (let i = 0; i < spike; i += 1) {
    const h = Math.max(1, Math.round(thick * 0.62 * (1 - i / spike)))
    const top = tipY - Math.round(h / 2)
    for (let row = 0; row < h; row += 1) p.set(tipX + i, top + row, beak[row === 0 ? 3 : 2])
  }

  return {
    canvas: p.toCanvas() as Canvas2D,
    grip: [PAD + 1, cy],
    // Carried low and forward, like something that is already reaching.
    restAngle: 0.18,
    twoHanded: false
  }
}

export function drawWeaponHi(kind: WeaponVisual, v: UnitVisual, lengthPx: number): WeaponArtHi | null {
  if (kind === 'none' || kind === 'fist') return null
  const L = Math.max(8, Math.round(lengthPx * RES))
  const k = buildKit(v, L)

  switch (kind) {
    case 'club':
      return drawClub(k)
    case 'spear':
      return drawSpear(k)
    case 'sling':
      return drawSling(k)
    case 'bow':
      return drawBow(k)
    case 'sword':
      return drawSword(k)
    case 'axe':
      return drawAxe(k)
    case 'lance':
      return drawLance(k)
    case 'staff':
      return drawStaff(k)
    case 'musket':
      return drawMusket(k)
    case 'saber':
      return drawSaber(k)
    case 'grenade':
      return drawGrenade(k)
    case 'rifle':
      return drawRifle(k)
    case 'lmg':
      return drawLmg(k)
    case 'rpg':
      return drawRpg(k)
    case 'laser':
      return drawLaser(k)
    case 'railgun':
      return drawRailgun(k)
    case 'plasma':
      return drawPlasma(k)
    case 'tentacle':
      return drawTentacle(k)
    default:
      return null
  }
}
