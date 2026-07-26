import type { TorsoVisual, UnitVisual } from '../data/types'
import type { Canvas2D } from './painter'
import Pix, { RES, ditherAt, mix, pixelNoise, ramp, tone, type Ramp } from './pixel'
import {
  PAD,
  box,
  chamfer,
  cloth as clothMat,
  contactShadow,
  emissive,
  energy as energyMat,
  fold,
  leather as leatherMat,
  metal as metalMat,
  orb,
  partCanvas,
  rivet,
  rivetRow,
  sealPart,
  shaft,
  skin as skinMat,
  strap,
  trim,
  trunk
} from './anatomy'

/**
 * Torsos.
 *
 * A torso is ten to thirteen texture pixels tall, which is not enough room for
 * a chest. It *is* enough room for a silhouette, and that is the whole job here:
 * eight torso kinds that can be told apart from their outline alone, before a
 * single interior pixel is read. Shoulders do that work — a pauldron, a shoulder
 * pelt, a squared exo block or a narrow monastic slope changes the shape of the
 * unit; a beautifully rendered breastplate does not.
 *
 * So each kind is built as: `trunk()` for the tapered body underneath, a
 * silhouette decision at the shoulders and the hem, and only then the material
 * texture that says what it is made of — dithered rings for mail, big clean
 * facets and a hard top-edge highlight for plate, vertical folds for a robe.
 *
 * Everything obeys the house rules: light from the upper right, five tones per
 * material, and one outline applied as a post-pass by `sealPart`.
 *
 * The part is authored upright and its origin is the **waist** — the seam where
 * it meets the pelvis — so the rig can hang it off the hip bone and let skirts,
 * faulds and coat tails overhang the thighs without moving the joint.
 */

// ─────────────────────────────── Proportions ───────────────────────────────

/**
 * Per-kind silhouette parameters, as multiples of the body width and height.
 *
 * This table is the single most important thing in the file. `shoulder` is what
 * separates a robed acolyte from a plated knight at twenty pixels tall, and
 * `drop` — how far the garment hangs below the waist joint — is what separates
 * a hauberk from a jerkin.
 */
const SHAPE: Record<TorsoVisual, { shoulder: number; waist: number; drop: number }> = {
  bare: { shoulder: 1.14, waist: 0.78, drop: 0 },
  fur: { shoulder: 1.26, waist: 0.94, drop: 0.18 },
  robe: { shoulder: 0.96, waist: 0.96, drop: 0.36 },
  mail: { shoulder: 1.18, waist: 1.02, drop: 0.24 },
  plate: { shoulder: 1.32, waist: 0.92, drop: 0.16 },
  coat: { shoulder: 1.1, waist: 0.86, drop: 0.26 },
  vest: { shoulder: 1.16, waist: 0.9, drop: 0.06 },
  exo: { shoulder: 1.34, waist: 1, drop: 0.12 }
}

/** The palette a torso is built from — one ramp per material, five tones each. */
interface Palette {
  skin: Ramp
  cloth: Ramp
  cloth2: Ramp
  metal: Ramp
  accent: Ramp
  glow: Ramp
  leather: Ramp
  wood: Ramp
  dark: Ramp
}

function palette(v: UnitVisual): Palette {
  return {
    skin: skinMat(v.skin).ramp,
    cloth: clothMat(v.cloth).ramp,
    cloth2: clothMat(v.cloth2).ramp,
    metal: metalMat(v.metal).ramp,
    accent: ramp(v.accent),
    glow: energyMat(v.accent).ramp,
    leather: leatherMat(tone(v.cloth2, -0.28)).ramp,
    wood: leatherMat(0x7a5433).ramp,
    dark: ramp(0x3a3f4a, { contrast: 1.1 })
  }
}

/** Everything the per-kind painters need to know about the grid they share. */
interface Frame {
  p: Pix
  /** Centre column of the body. */
  cx: number
  /** First drawn row of the trunk. */
  top: number
  /** The waist seam: one row past the last trunk row. This is the origin. */
  bottom: number
  /** Body width, shoulder width, waist width, trunk height, hem overhang. */
  W: number
  sw: number
  ww: number
  H: number
  drop: number
  /** Half the usable canvas width, either side of `cx`. */
  half: number
}

/**
 * The trunk's width on row `i`, reproducing `trunk()`'s own arithmetic exactly
 * so that anything laid over the body lines up with its edges to the pixel.
 */
function rowW(f: Frame, i: number): number {
  const t = f.H > 1 ? i / (f.H - 1) : 0
  return Math.max(2, Math.round(f.sw + (f.ww - f.sw) * t))
}

function rowX(f: Frame, i: number): number {
  return f.cx - (rowW(f, i) >> 1)
}

/**
 * The left edge for a piece of back gear `w` wide, tucked one pixel under the
 * body so the outline pass joins it to the torso.
 *
 * Gear positioned by a flat multiple of the body width drifts free of narrow
 * units and buries itself in wide ones; anchoring to the trunk's actual edge
 * means a quiver hangs off a scout and a titan alike.
 */
function backX(f: Frame, w: number, row: number): number {
  return rowX(f, Math.max(0, Math.min(f.H - 1, Math.round(row)))) - Math.round(w) + 1
}

/**
 * Ambient occlusion under an overhang, clipped to the body it lands on.
 *
 * A pauldron's shadow that runs past the trunk hangs in mid air and reads as a
 * dark shelf, which is worse than no shadow at all.
 */
function overhangShadow(f: Frame, x: number, y: number, w: number, r: Ramp): void {
  const i = Math.round(y) - f.top
  if (i < 0 || i >= f.H) return
  const bx = rowX(f, i)
  const x0 = Math.max(Math.round(x), bx)
  const x1 = Math.min(Math.round(x + w), bx + rowW(f, i))
  if (x1 > x0) contactShadow(f.p, x0, Math.round(y), x1 - x0, r)
}

/**
 * A hem that widens as it falls: a robe's skirt, a coat's tails, a mail
 * hauberk. Lit right edge, shadowed left, same as every other vertical surface.
 */
function flare(p: Pix, cx: number, y0: number, y1: number, w0: number, w1: number, r: Ramp): void {
  const rows = Math.max(1, Math.round(y1 - y0))
  for (let i = 0; i < rows; i += 1) {
    const t = rows > 1 ? i / (rows - 1) : 1
    const w = Math.max(2, Math.round(w0 + (w1 - w0) * t))
    const x = cx - (w >> 1)
    p.fill(x, y0 + i, w, 1, r[2])
    p.set(x, y0 + i, r[1])
    if (w > 2) p.set(x + w - 1, y0 + i, r[3])
  }
}

/** A vertical accent stripe, sunk into the surface by the shadow beside it. */
function stripeDown(p: Pix, x: number, y: number, h: number, r: Ramp): void {
  const H = Math.max(1, Math.round(h))
  p.fill(Math.round(x), Math.round(y), 1, H, r[3])
  p.fill(Math.round(x) - 1, Math.round(y), 1, H, r[0])
}

// ─────────────────────────────── Back gear ───────────────────────────────

/**
 * What a unit carries on its back.
 *
 * Drawn first, so it sits behind the body, and kept to a strong silhouette: at
 * this scale a quiver is a dark bar and four pixels of fletching, and a banner
 * is a pole and a tapering rag. Anything more becomes noise the moment the
 * sprite moves.
 */
function drawBackGear(f: Frame, v: UnitVisual, pal: Palette): void {
  const { p, cx, top, H, W } = f
  const R = Math.round

  switch (v.weapon) {
    case 'bow':
    case 'sling': {
      // A quiver over the far shoulder, arrows fanning above it.
      const qw = Math.max(2, R(W * 0.32))
      const qy = top + R(H * 0.14)
      const qx = backX(f, qw, H * 0.3)
      box(p, qx, qy, qw, Math.max(3, R(H * 0.7)), pal.wood)
      rivetRow(p, qx + 1, qy + R(H * 0.24), qw - 1, 3, pal.wood)
      // Two shafts, not three, and only the fletching takes the accent colour.
      // Three full-length accent shafts side by side stop being arrows and
      // become a bright slab hanging off the shoulder.
      for (let i = 0; i < 2; i += 1) {
        const sx = qx + i
        const tipY = top - R(H * (0.2 + i * 0.06))
        p.line(sx, qy, sx, tipY, pal.wood[i === 0 ? 1 : 3])
        p.set(sx, tipY, pal.accent[3])
        p.set(sx, tipY + 1, pal.accent[1])
      }
      break
    }
    case 'musket':
    case 'rifle':
    case 'lmg': {
      // A bedroll lashed to a pack — the whole line-infantry read.
      const bw = Math.max(3, R(W * 0.4))
      const by = top + R(H * 0.2)
      const bh = Math.max(4, R(H * 0.56))
      const bx = backX(f, bw, H * 0.4)
      chamfer(p, bx, by, bw, bh, pal.cloth2)
      p.fill(bx, by + R(bh * 0.34), bw, 1, pal.dark[1])
      p.fill(bx, by + R(bh * 0.68), bw, 1, pal.dark[1])
      rivet(p, bx + bw - 2, by + R(bh * 0.34) - 1, pal.metal)
      break
    }
    case 'grenade':
    case 'spear': {
      // A satchel, small and low, so it never fights the weapon for attention.
      const bw = Math.max(2, R(W * 0.3))
      const bx = backX(f, bw, H * 0.55)
      box(p, bx, top + R(H * 0.36), bw, Math.max(3, R(H * 0.4)), pal.cloth2)
      p.fill(bx, top + R(H * 0.5), bw, 1, pal.leather[1])
      break
    }
    case 'rpg': {
      const bw = Math.max(2, R(W * 0.32))
      const bx = backX(f, bw, H * 0.35)
      box(p, bx, top + R(H * 0.08), bw, Math.max(4, R(H * 0.78)), pal.metal)
      trim(p, bx, top + R(H * 0.26), bw, pal.accent)
      break
    }
    case 'laser':
    case 'plasma':
    case 'railgun': {
      // A power cell, the accent colour reading as charge held in the cell.
      const bw = Math.max(3, R(W * 0.38))
      const by = top + R(H * 0.18)
      const bh = Math.max(4, R(H * 0.56))
      const bx = backX(f, bw, H * 0.4)
      box(p, bx, by, bw, bh, pal.metal)
      // A charge slot, one pixel wide. Filling the cell's whole face with the
      // glow made a lamp the size of the unit's chest hanging off its back.
      p.fill(bx + 1, by + 1, 1, Math.max(1, bh - 2), pal.glow[4])
      p.fill(bx + 2, by + 1, 1, Math.max(1, bh - 2), pal.glow[1])
      break
    }
    case 'sword':
    case 'saber':
    case 'axe': {
      // An empty scabbard slung across the far hip.
      shaft(p, cx - W * 0.42, top + H * 0.55, cx - W * 0.92, top + H * 1.05, 2, pal.leather)
      p.set(R(cx - W * 0.42), R(top + H * 0.55), pal.metal[3])
      break
    }
    case 'staff':
    case 'lance': {
      // A banner: pole above the shoulder, pennant tapering off the back.
      const bx = backX(f, 1, H * 0.25) - 1
      const poleTop = top - R(H * 0.52)
      shaft(p, bx, top + H * 0.95, bx, poleTop, 1, pal.wood)
      const pw = Math.max(3, R(W * 0.72))
      const ph = Math.max(4, R(H * 0.46))
      for (let i = 0; i < ph; i += 1) {
        const w = Math.max(1, pw - R((i / ph) * pw * 0.5))
        p.fill(bx - w, poleTop + 1 + i, w, 1, pal.cloth2[2])
        p.set(bx - w, poleTop + 1 + i, pal.cloth2[1])
        p.set(bx - 1, poleTop + 1 + i, pal.cloth2[3])
      }
      trim(p, bx - pw + 1, poleTop + 2, Math.max(2, pw - 2), pal.accent)
      break
    }
    default:
      break
  }

}

/**
 * The carry strap for anything slung on the back, drawn *after* the body so it
 * crosses the chest instead of hiding behind it.
 */
function drawCarryStrap(f: Frame, v: UnitVisual, pal: Palette): void {
  // Nothing rigid wears a leather bandolier. Plate, mail and a powered suit all
  // mount their kit on hardpoints, and a strap drawn across them only muddies
  // the one clean surface each of those kinds has.
  // A vest is excluded for a different reason: it *is* the carry system, and a
  // diagonal in the same leather as its pouches closes the open front, which is
  // the only thing separating it from a coat.
  if (v.torso === 'plate' || v.torso === 'mail' || v.torso === 'exo' || v.torso === 'vest') return
  switch (v.weapon) {
    case 'bow':
    case 'sling':
    case 'musket':
    case 'rifle':
    case 'lmg':
    case 'rpg':
    case 'laser':
    case 'plasma':
    case 'railgun':
      fold(f.p, f.cx + f.W * 0.3, f.top + 1, f.cx - f.W * 0.3, f.bottom - 2, pal.leather)
      break
    default:
      break
  }
}

// ─────────────────────────────── The kinds ───────────────────────────────

/** Bare flesh: a belt, and three shadow strokes that read as muscle. */
function drawBare(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H } = f
  const s = pal.skin
  const R = Math.round
  trunk(p, cx, top, sw, ww, H, s)

  // Deltoids sit proud of the trunk, which is most of what makes a bare body
  // read as heavy rather than as a mannequin.
  orb(p, cx - sw * 0.46, top + H * 0.14, W * 0.24, H * 0.16, s)
  orb(p, cx + sw * 0.46, top + H * 0.14, W * 0.24, H * 0.16, s)

  p.line(cx - W * 0.28, top + 1, cx + W * 0.3, top + 1, s[3])
  p.set(cx, top + R(H * 0.18), s[1])
  p.line(cx - W * 0.28, top + R(H * 0.32), cx + W * 0.3, top + R(H * 0.3), s[1])
  p.line(cx - W * 0.2, top + R(H * 0.52), cx + W * 0.22, top + R(H * 0.5), s[1])
  p.line(cx - W * 0.16, top + R(H * 0.68), cx + W * 0.18, top + R(H * 0.66), s[1])

  strap(p, cx - (ww >> 1), bottom - 2, ww, 2, pal.leather)
  rivet(p, cx + 1, bottom - 2, pal.accent)
}

/** Fur: a ragged silhouette and a shoulder pelt. Nothing else is needed. */
function drawFur(f: Frame, pal: Palette, peltColor: number): void {
  const { p, cx, top, bottom, sw, ww, H, drop } = f
  const c = pal.cloth
  const pelt = clothMat(peltColor).ramp
  const R = Math.round
  const n = pixelNoise(0x9e37)

  trunk(p, cx, top, sw, ww, H, c)

  // Tufts breaking both edges. Adding pixels *outside* the body is what makes
  // the outline pass itself come out ragged, which is the whole read — but they
  // have to be sparse. Fire on most rows and the result is not a ragged edge,
  // it is a body one pixel wider with a clean edge.
  for (let i = 2; i < H; i += 1) {
    const w = rowW(f, i)
    const x = cx - (w >> 1)
    if (n(i, 3) > 0.66) p.set(x - 1, top + i, c[1])
    if (n(i, 11) > 0.72) p.set(x + w, top + i, c[3])
  }

  // A hem of hanging tufts of uneven length.
  const hemW = ww + 2
  for (let i = 0; i < hemW; i += 1) {
    const gx = cx - (hemW >> 1) + i
    const len = 1 + Math.floor(n(gx, 29) * (drop + 1))
    for (let k = 0; k < len; k += 1) p.set(gx, bottom - 1 + k, k === len - 1 ? c[1] : c[2])
  }

  // The pelt, as a mantle across both shoulders rather than a blob over one.
  // Three rows a pixel proud of the trunk widens the shoulders, which is the
  // silhouette change that makes this kind identifiable at a glance.
  const mh = Math.max(2, R(H * 0.26))
  for (let i = 0; i < mh; i += 1) {
    const w = rowW(f, i) + 2
    const x = cx - (w >> 1)
    p.fill(x, top + i, w, 1, i === 0 ? pelt[3] : pelt[2])
    p.set(x, top + i, pelt[1])
    p.set(x + w - 1, top + i, pelt[3])
  }
  // The mantle's lower edge is shaggy, not hemmed.
  const mw = rowW(f, mh) + 2
  for (let k = 0; k < mw; k += 1) {
    if (n(k, 5) > 0.5) p.set(cx - (mw >> 1) + k, top + mh, pelt[1])
  }
}

/** A robe: narrow shoulders, a flaring skirt, vertical folds, a rope belt. */
function drawRobe(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H, drop } = f
  const c = pal.cloth
  const c2 = pal.cloth2
  const R = Math.round
  trunk(p, cx, top, sw, ww, H, c)

  // The skirt starts at the chest, so the garment reads as one fall of cloth
  // rather than a shirt with a hem stuck on the bottom.
  const skirtTop = top + R(H * 0.48)
  flare(p, cx, skirtTop, bottom + drop, rowW(f, R(H * 0.48)), R(ww * 1.6), c)

  fold(p, cx - W * 0.34, top + R(H * 0.26), cx - W * 0.52, bottom + drop - 1, c)
  fold(p, cx - W * 0.04, top + R(H * 0.2), cx - W * 0.06, bottom + drop - 1, c)
  fold(p, cx + W * 0.28, top + R(H * 0.26), cx + W * 0.44, bottom + drop - 1, c)

  // Collar, and the shadow it casts on the chest.
  p.fill(cx - R(W * 0.34), top, Math.max(2, R(W * 0.68)), 1, c2[1])
  overhangShadow(f, cx - R(W * 0.3), top + 1, Math.max(2, R(W * 0.6)), c2)

  // A stole running from the collar to the hem.
  stripeDown(p, cx - R(W * 0.16), top + 1, H + drop - 2, pal.accent)

  strap(p, cx - (ww >> 1), top + R(H * 0.6), ww, 2, pal.leather)
  rivet(p, cx + R(W * 0.18), top + R(H * 0.6), pal.accent)
}

/** Mail: a dithered ring lattice, short sleeves and a scalloped hauberk hem. */
function drawMail(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H, drop } = f
  const m = pal.metal
  const R = Math.round
  trunk(p, cx, top, sw, ww, H, m)

  const hemW = Math.max(3, R(ww * 1.14))
  flare(p, cx, bottom, bottom + drop, ww, hemW, m)

  // One row of woven rings.
  //
  // The obvious implementation — alternate every pixel between two tones — is a
  // chessboard, not chainmail: at 50% coverage the eye reads the pattern and
  // stops reading the material. Rings want a *sparse* stagger, roughly a
  // quarter of the pixels, over a body that is still shaded left-to-right. The
  // dither then pushes the lit side toward the highlight so the mail curves.
  const ring = (x: number, y: number, w: number): void => {
    for (let i = 0; i < w; i += 1) {
      const px = x + i
      const u = w > 1 ? i / (w - 1) : 0.5
      const lit = ditherAt(px, y, u * 0.85) ? m[3] : m[2]
      p.set(px, y, ((i + (y & 1) * 2) & 3) === 0 ? m[1] : lit)
    }
    p.set(x, y, m[1])
    if (w > 2) p.set(x + w - 1, y, m[3])
  }

  for (let i = 0; i < H; i += 1) ring(rowX(f, i), top + i, rowW(f, i))
  for (let i = 0; i < drop; i += 1) {
    const t = drop > 1 ? i / (drop - 1) : 1
    const w = Math.max(2, Math.round(ww + (hemW - ww) * t))
    ring(cx - (w >> 1), bottom + i, w)
  }
  p.fill(cx - (sw >> 1), top, sw, 1, m[3])

  // Short sleeves: three rows a pixel wider than the trunk, which is enough to
  // put a shoulder line in the silhouette.
  for (let i = 0; i < Math.min(3, H); i += 1) {
    const w = rowW(f, i)
    const x = cx - (w >> 1)
    p.set(x - 1, top + i, m[1])
    p.set(x + w, top + i, m[3])
  }

  // A scalloped hem: one pixel notched out of every four, and only when there
  // is enough hem to notch. Any more and the hauberk stops reading as a hem and
  // starts reading as battle damage.
  const hemY = bottom + drop - 1
  if (hemW >= 7) for (let i = 2; i < hemW - 1; i += 4) p.set(cx - (hemW >> 1) + i, hemY, 0, 0)

  // A raised coif collar standing above the shoulders.
  chamfer(p, cx - R(W * 0.32), top - 2, Math.max(3, R(W * 0.64)), 3, m)

  strap(p, cx - (ww >> 1), bottom - 2, ww, 2, pal.leather)
  rivet(p, cx + 1, bottom - 2, pal.accent)
}

/** Plate: overhanging pauldrons, two clean facets, a hard top-edge highlight. */
function drawPlate(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H, drop } = f
  const m = pal.metal
  const R = Math.round
  trunk(p, cx, top, sw, ww, H, m)

  // The breastplate is two large facets meeting at a ridge. Big flat areas are
  // what makes plate read as plate; the ridge is the only bright line on it.
  const ridge = cx + Math.max(1, R(W * 0.1))
  const chestRows = Math.max(2, R(H * 0.62))
  for (let i = 1; i < chestRows && i < H; i += 1) {
    const w = rowW(f, i)
    const x = cx - (w >> 1)
    for (let k = 1; k < w - 1; k += 1) {
      const px = x + k
      p.set(px, top + i, px < ridge ? m[2] : px === ridge ? m[4] : m[3])
    }
  }
  // The hard highlight along the very top edge, and the step down to the belly.
  p.fill(cx - (sw >> 1), top, sw, 1, m[4])
  contactShadow(p, rowX(f, chestRows), top + chestRows, rowW(f, chestRows), m)

  // Pauldrons. The single biggest silhouette change in the whole set.
  const prx = Math.max(2, W * 0.4)
  const pry = Math.max(2, H * 0.2)
  const py = top + H * 0.12
  for (const side of [-1, 1]) {
    const ox = cx + side * sw * 0.52
    orb(p, ox, py, prx, pry, m)
    overhangShadow(f, ox - prx, py + pry, prx * 2, m)
    rivetRow(p, ox - prx + 1, py - pry * 0.2, prx * 2 - 2, 3, m)
  }

  // A fauld of two lames hanging past the waist. Kept to two, because a third
  // band turns the lower half of the sprite into stripes.
  const lame = (y: number, w: number, h: number): void => {
    const x = cx - (w >> 1)
    p.fill(x, y, w, h, m[2])
    p.fill(x, y, w, 1, m[3])
    p.fill(x, y + h - 1, w, 1, m[1])
  }
  lame(bottom - 2, Math.max(3, R(ww * 1.1)), 2)
  lame(bottom, Math.max(3, R(ww * 1.2)), Math.max(2, drop))

  // A short heraldic tab rather than a full-width band: enough faction colour
  // to identify the unit, not enough to stripe the whole belly.
  trim(p, cx - R(W * 0.22), top + R(H * 0.72), Math.max(2, R(W * 0.44)), pal.accent)
}

/** A coat: lapels, a standing collar, a belted waist and split tails. */
function drawCoat(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H, drop } = f
  const c = pal.cloth
  const c2 = pal.cloth2
  const R = Math.round
  trunk(p, cx, top, sw, ww, H, c)

  // Tails, split up the centre so the coat moves as two pieces.
  flare(p, cx, bottom, bottom + drop, ww, Math.max(3, R(ww * 1.24)), c)
  for (let y = bottom; y < bottom + drop; y += 1) p.set(cx + 1, y, c[1])

  // Lapels: a contrasting facing running from each shoulder to the closure.
  //
  // Drawn as two two-pixel diagonals rather than as filled wedges. A wedge that
  // reads as a lapel on paper is, at nine pixels across, simply the whole chest
  // in a second colour — and then the coat has no coat left in it. The V is the
  // mark; everything else is the body it sits on.
  const lapelY = top + H * 0.5
  for (let k = 0; k < 2; k += 1) {
    p.line(cx - W * 0.44 + k, top, cx - 1 + k, lapelY, c2[1])
    p.line(cx + W * 0.44 - k, top, cx + 1 - k, lapelY, c2[3])
  }
  // The closure below the V, and the shadow the lapels cast on it.
  p.line(cx, lapelY + 1, cx, bottom - 3, c[1])
  overhangShadow(f, cx - W * 0.3, R(lapelY) + 1, W * 0.6, c2)

  // A belt with a single bright buckle. One accent mark, not a row of buttons:
  // repeated accent pixels at this size merge into a stripe.
  strap(p, cx - (ww >> 1), top + R(H * 0.68), ww, 2, pal.leather)
  rivet(p, cx + 1, top + R(H * 0.68), pal.accent)
}

/** A vest: two panels open over a shirt, with pouches and webbing. */
function drawVest(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H } = f
  const shirt = pal.cloth2
  const ve = pal.cloth
  const R = Math.round
  trunk(p, cx, top, sw, ww, H, shirt)

  // The open front is the entire read, so the gap is protected: it never closes
  // below two pixels however narrow the unit is.
  const gap = Math.max(3, R(W * 0.32))
  for (let i = 1; i < H; i += 1) {
    const w = rowW(f, i)
    const x = cx - (w >> 1)
    // Round the panels *up* and let the opening absorb the odd pixel. Halving
    // with a shift instead threw every leftover pixel into the gap, and since
    // the trunk tapers, most rows ended up two pixels of vest either side of
    // four pixels of shirt — a shirt with piping, not a vest.
    let panel = Math.max(1, Math.round((w - gap) / 2))
    if (w - panel * 2 < 2) panel = Math.max(1, (w - 2) >> 1)
    const y = top + i
    p.fill(x, y, panel, 1, i === 1 ? ve[3] : ve[2])
    p.set(x, y, ve[1])
    const rx = x + w - panel
    p.fill(rx, y, panel, 1, i === 1 ? ve[3] : ve[2])
    if (panel > 1) p.set(rx + panel - 1, y, ve[3])
    // The shirt inside the opening drops to its darkest tone under the vest's
    // turned edges. That gap is the entire silhouette read for this kind, so it
    // is the one thing here that is never allowed to close up.
    p.set(x + panel, y, shirt[0])
    p.set(rx - 1, y, shirt[0])
  }

  // Turned-out collar points at the top of the opening.
  p.set(cx - (rowW(f, 1) >> 1) + Math.max(1, (rowW(f, 1) - gap) >> 1) - 1, top + 1, ve[3])

  // One pouch, hung on the belt rather than sitting on the panel. A pouch two
  // pixels wide on a panel three pixels wide is not a pouch, it is a repaint of
  // the panel.
  const pw = Math.max(2, R(W * 0.3))
  box(p, cx - R(W * 0.4), bottom - 4, pw, 3, pal.leather)

  strap(p, cx - (ww >> 1), bottom - 2, ww, 2, pal.leather)
  rivet(p, cx + 1, bottom - 2, pal.accent)
}

/** Exo: squared shoulder blocks, panel lines and an emissive accent stripe. */
function drawExo(f: Frame, pal: Palette): void {
  const { p, cx, top, bottom, W, sw, ww, H, drop } = f
  const m = pal.metal
  const d = pal.dark
  const R = Math.round

  // The bodysuit first, in the dark neutral, then bright plates laid over it.
  //
  // Drawing the whole thing in one metal and cutting seams into it produced an
  // undifferentiated grey mass: every mark was the same material at a slightly
  // different value, so nothing separated. Plating a *dark* body means the suit
  // itself shows through as the panel line, all the way round every plate, for
  // free — and the silhouette gets a hard light-on-dark break at the shoulder.
  trunk(p, cx, top, sw, ww, H, d)

  /** One armour plate, inset from the trunk's edge so the suit shows around it. */
  const platee = (from: number, to: number, inset: number): void => {
    for (let i = from; i <= to && i < H; i += 1) {
      const w = rowW(f, i) - inset * 2
      if (w < 2) continue
      const x = cx - (w >> 1)
      p.fill(x, top + i, w, 1, m[2])
      p.set(x, top + i, m[1])
      if (w > 2) p.set(x + w - 1, top + i, m[3])
    }
    const wTop = rowW(f, from) - inset * 2
    if (wTop >= 2) p.fill(cx - (wTop >> 1), top + from, wTop, 1, m[3])
    const wEnd = rowW(f, Math.min(H - 1, to)) - inset * 2
    if (wEnd >= 2) p.fill(cx - (wEnd >> 1), top + Math.min(H - 1, to), wEnd, 1, m[1])
  }

  const seam = Math.max(2, R(H * 0.46))
  platee(1, seam, 1)
  platee(seam + 2, H - 2, 1)

  // Hard-edged shoulder blocks. Square where plate is round — that contrast is
  // what makes powered armour read as fabricated rather than forged.
  const bw = Math.max(3, R(W * 0.42))
  const bh = Math.max(3, R(H * 0.34))
  for (const side of [-1, 1]) {
    const bx = side < 0 ? cx - (sw >> 1) - bw + 2 : cx + (sw >> 1) - 2
    box(p, bx, top - 1, bw, bh, m)
    overhangShadow(f, bx, top - 1 + bh, bw, m)
    rivet(p, bx + bw - 2, top, m)
  }

  // One emissive stripe and one core. A single pixel of the brightest tone with
  // the suit's own shadow beside it — the earlier version paired the stripe with
  // the *glow* ramp's darkest tone, which put a two-pixel bar of near-black
  // olive down the chest and read as a stick rather than as a light.
  const sx = cx + R(W * 0.24)
  p.fill(sx, top + 2, 1, Math.max(1, seam - 2), pal.glow[4])
  p.fill(sx - 1, top + 2, 1, Math.max(1, seam - 2), m[0])
  emissive(p, cx - W * 0.16, top + H * 0.66, Math.max(1.2, W * 0.14), Math.max(1.2, H * 0.09), pal.glow)

  // A single articulation gap at the waist rather than a two-row belt: the suit
  // is already dark below the abdominal plate, and a dark band on top of that
  // left the whole lower third of the sprite as one unreadable mass.
  strap(p, cx - (ww >> 1), bottom - 1, ww, 1, d)
  if (drop > 0) {
    const w = Math.max(3, R(ww * 1.06))
    p.fill(cx - (w >> 1), bottom, w, drop, m[2])
    p.fill(cx - (w >> 1), bottom, w, 1, m[3])
    p.fill(cx - (w >> 1), bottom + drop - 1, w, 1, m[1])
  }
}

// ─────────────────────────────── Entry point ───────────────────────────────

/**
 * Draws one torso, upright, with its origin at the waist.
 *
 * `widthPx` and `heightPx` are **world** pixels; they are converted to art
 * pixels with `RES` here so no caller has to remember to. `bulk` widens the
 * body without lengthening it, which is how a berserker and a scout share one
 * set of proportions.
 *
 * The returned origin is the seam where the torso meets the pelvis — on the
 * drawn waist row, not on the padded canvas edge — so hems that overhang the
 * hips (a robe's skirt, a plate fauld, coat tails) do not shift the joint.
 */
export function drawTorsoHi(
  v: UnitVisual,
  opts: { widthPx: number; heightPx: number; bulk: number }
): { canvas: Canvas2D; origin: [number, number] } {
  const bulk = opts.bulk > 0 ? opts.bulk : 1
  const W = Math.max(4, Math.round(opts.widthPx * RES * bulk))
  const H = Math.max(6, Math.round(opts.heightPx * RES))
  const shape = SHAPE[v.torso] ?? SHAPE.bare

  const sw = Math.max(4, Math.round(W * shape.shoulder))
  const ww = Math.max(3, Math.round(W * shape.waist))
  const drop = Math.max(0, Math.round(H * shape.drop))

  // Room for a backpack out to the left, a pauldron out to the right, a banner
  // above the shoulders and a skirt below the waist. The body stays centred so
  // the origin's x is always the middle column.
  const half = Math.round(W * 1.6) + 3
  const headroom = Math.round(H * 0.6) + 4
  const p = partCanvas(half * 2 + 1, headroom + H + drop + 1)
  const cx = PAD + half
  const top = PAD + headroom
  const bottom = top + H

  const f: Frame = { p, cx, top, bottom, W, sw, ww, H, drop, half }
  const pal = palette(v)

  drawBackGear(f, v, pal)

  switch (v.torso) {
    case 'bare':
      drawBare(f, pal)
      break
    case 'fur':
      drawFur(f, pal, mix(v.cloth2, v.skin, 0.22))
      break
    case 'robe':
      drawRobe(f, pal)
      break
    case 'mail':
      drawMail(f, pal)
      break
    case 'plate':
      drawPlate(f, pal)
      break
    case 'coat':
      drawCoat(f, pal)
      break
    case 'vest':
      drawVest(f, pal)
      break
    case 'exo':
      drawExo(f, pal)
      break
    default:
      drawBare(f, pal)
      break
  }

  drawCarryStrap(f, v, pal)

  // The outline takes the colour of whatever the torso is mostly made of, so a
  // steel knight is edged in dark steel and a robed acolyte in dark cloth.
  const seal =
    v.torso === 'bare' ? v.skin : v.torso === 'mail' || v.torso === 'plate' || v.torso === 'exo' ? v.metal : v.cloth

  return { canvas: sealPart(p, seal), origin: [cx / p.w, bottom / p.h] }
}
