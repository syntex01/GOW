import Pix, { mix, pixelNoise, ramp, tone, type Ramp } from './pixel'

/**
 * THE FLESH VOCABULARY.
 *
 * Every other body plan in the game is built out of the same idea: a person, or
 * a machine shaped like one, made of cloth and plate and steel. Carnage is not
 * that. Its soldiers are not wearing anything and are not made of anything you
 * could forge — they are meat, opened up, and the interesting surfaces are the
 * ones that should be on the inside.
 *
 * So this file is a second anatomy kit, parallel to `anatomy.ts` rather than
 * built on it, with a completely different set of primitives:
 *
 *   MATERIAL   wet flesh, exposed bone, gristle, membrane, curdled fat
 *   STRUCTURE  ribcages, sutures, spurs, vertebrae
 *   ORGAN      maws with real teeth, eye clusters, pustules, viscera
 *   LIMB       tentacles, claws, boneless taper
 *
 * The single most important thing here is that flesh is drawn WET. Plate reads
 * as metal because of one hard specular line; meat reads as meat because of a
 * broad soft sheen with a bright core, sitting off-centre from the form light,
 * plus a dark rim where the surface turns away. Everything below shares that
 * treatment, which is what will make eleven different silhouettes still read as
 * one army.
 */

// ─────────────────────────────── Materials ───────────────────────────────

export interface FleshKit {
  /**
   * THE OUTER SURFACE: dead skin, pale and grey-green.
   *
   * This is what most of a Carnage body is covered in, and it is PALE on
   * purpose. The first pass made the whole faction out of dark red muscle and
   * they disappeared into the dirt — the battlefield's ground is a mid brown,
   * so a mid-dark red-brown creature standing on it has no silhouette at all.
   * A corpse's skin is lighter than the ground it is lying on, which is both
   * true and the only value that reads.
   */
  hide: Ramp
  /**
   * Raw muscle: dark, saturated, red. Used where the skin is GONE — torn
   * patches, the inside of a ribcage, a stump, a mouth. Against the pale hide
   * it is the darkest thing on the model, so every wound reads as a hole.
   */
  meat: Ramp
  /** Curdled fat and swollen tissue — paler, yellower, for bulk and bellies. */
  fat: Ramp
  /** Old blood and necrotic edges, for creases and where the skin has gone. */
  necrotic: Ramp
  /** Exposed skeleton. */
  bone: Ramp
  /** Tendon, cartilage, the pale stringy stuff. */
  gristle: Ramp
  /** Stretched translucent skin — wings, sacs, membranes. */
  membrane: Ramp
  /** The dark inside of a body: cavities, throats, sockets. */
  cavity: Ramp
  /** Whatever iron this thing has been nailed together with. */
  iron: Ramp
  /** The creed's accent, for glow and infection. */
  accent: Ramp
}

/**
 * Builds the whole palette off a unit's own three colours, so a Husk and a
 * Monstrum are visibly the same species without being the same colour.
 */
export function fleshKit(skin: number, cloth: number, accent: number): FleshKit {
  // MEAT IS NOT SKIN.
  //
  // Feeding the faction's own skin colour in produced pale grey-pink limbs that
  // read as raw poultry — because the Nekrotics' authored skin is a corpse
  // GREY, which is right for a face and wrong for the inside of one. Muscle is
  // dark, saturated and red-brown, so the faction colour is pulled most of the
  // way toward that before anything is drawn with it. The faction still shows:
  // it decides which red.
  const muscle = mix(skin, 0x6e1f22, 0.78)
  return {
    // Dead skin, lifted well clear of the ground's value so the silhouette
    // holds, and pushed slightly green so it never reads as a healthy person.
    hide: ramp(mix(skin, 0xcfd2bc, 0.42), { contrast: 1.1, hueShift: 0.015 }),
    // High contrast and a hue swing toward red at the shadow end: meat gets
    // *redder* as it gets darker, which is the whole difference between flesh
    // and painted plastic.
    meat: ramp(muscle, { contrast: 1.35, hueShift: -0.05 }),
    fat: ramp(mix(muscle, 0xb08a5e, 0.62), { contrast: 0.9, hueShift: 0.02 }),
    necrotic: ramp(mix(cloth, 0x3d0d14, 0.66), { contrast: 1.15, hueShift: -0.03 }),
    bone: ramp(0xc4b894, { contrast: 1.05, hueShift: 0.01 }),
    gristle: ramp(0xa89478, { contrast: 0.8 }),
    membrane: ramp(mix(muscle, 0x8a4a52, 0.55), { contrast: 0.75 }),
    cavity: ramp(0x2a0d12, { contrast: 0.6 }),
    iron: ramp(0x6f6a5c, { contrast: 1.15 }),
    accent: ramp(accent, { contrast: 1.2 })
  }
}

/**
 * THE WET PASS — the single most load-bearing function in this file.
 *
 * Run over a finished mass, it finds the lit shoulder of the form and lays a
 * soft broad sheen along it with a bright core, then darkens the turning edge.
 * Plate would get one crisp line here; flesh gets a smear, because flesh is
 * covered in fluid and fluid does not hold an edge.
 *
 * Works on whatever is already in the buffer rather than needing to know the
 * shape, so every primitive below can just draw its silhouette and call this.
 */
export function wet(p: Pix, seed = 7, strength = 1): void {
  const noise = pixelNoise(seed * 131 + 17)
  const w = p.w
  const h = p.h
  // Top surface of the form, per column: where the sheen goes.
  for (let x = 0; x < w; x += 1) {
    let top = -1
    for (let y = 0; y < h; y += 1) {
      const [, , , a] = unpackAt(p, x, y)
      if (a > 40) {
        top = y
        break
      }
    }
    if (top < 0) continue
    // The sheen sits a couple of pixels IN from the silhouette, not on it —
    // on it reads as an outline, in from it reads as a curved wet surface.
    const inset = 1 + Math.round(noise(x, 3) * 1.6)
    for (let k = 0; k < 3; k += 1) {
      const y = top + inset + k
      const [r, g, b, a] = unpackAt(p, x, y)
      if (a < 40) continue
      // Bright core in the middle band, softer either side, and broken up by
      // noise so it never reads as a drawn line.
      // Restrained on purpose. At the old strength every surface ended up the
      // same pale pink and the forms stopped reading — a wet highlight is a
      // NARROW event on a dark body, not a coat of paint. Tinted toward warm
      // bone rather than white, so it looks like fluid over meat.
      const lift = (k === 1 ? 0.2 : 0.09) * strength * (0.5 + noise(x, 11 + k) * 0.8)
      p.set(x, y, mix((r << 16) | (g << 8) | b, 0xffd9b4, Math.min(0.3, lift)))
    }
  }
  // The turning edge: the bottom of the form goes dark and slightly purple,
  // which is what stops a lit blob from looking like a balloon.
  for (let x = 0; x < w; x += 1) {
    let bottom = -1
    for (let y = h - 1; y >= 0; y -= 1) {
      const [, , , a] = unpackAt(p, x, y)
      if (a > 40) {
        bottom = y
        break
      }
    }
    if (bottom < 0) continue
    for (let k = 0; k < 2; k += 1) {
      const y = bottom - k
      const [r, g, b, a] = unpackAt(p, x, y)
      if (a < 40) continue
      p.set(x, y, mix((r << 16) | (g << 8) | b, 0x1a0710, k === 0 ? 0.34 * strength : 0.16 * strength))
    }
  }
}

function unpackAt(p: Pix, x: number, y: number): [number, number, number, number] {
  if (!p.inside(x, y)) return [0, 0, 0, 0]
  const v = p.get(x, y)
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}

// ─────────────────────────────── Structure ───────────────────────────────

/**
 * A lumpy organic mass, drawn as a stack of overlapping bulges rather than an
 * ellipse. An ellipse is the one shape flesh never makes.
 */
export function fleshMass(
  p: Pix,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: Ramp,
  seed = 1,
  lumps = 5
): void {
  const noise = pixelNoise(seed * 7919 + 3)
  for (let i = 0; i < lumps; i += 1) {
    const t = lumps === 1 ? 0.5 : i / (lumps - 1)
    const a = -0.6 + t * 1.9
    const dx = Math.cos(a) * rx * 0.42 * (0.6 + noise(i, 5))
    const dy = Math.sin(a) * ry * 0.34 * (0.6 + noise(i, 9))
    const lr = rx * (0.5 + noise(i, 13) * 0.45)
    const lry = ry * (0.5 + noise(i, 17) * 0.45)
    p.ellipse(cx + dx, cy + dy, lr, lry, r[2])
  }
  p.ellipse(cx, cy, rx * 0.86, ry * 0.86, r[2])
  // Interior form: a second, smaller, brighter mass offset up-forward.
  p.ellipse(cx + rx * 0.16, cy - ry * 0.2, rx * 0.55, ry * 0.5, r[3])
}

/**
 * An open ribcage: bars of bone over a dark cavity, with the cavity showing
 * between them. Two pixels of gap is enough to read as "you can see inside".
 */
export function ribCage(
  p: Pix,
  x0: number,
  y0: number,
  w: number,
  h: number,
  k: FleshKit,
  ribs = 4,
  facing = 1
): void {
  // The hole first, so the ribs can sit over it.
  p.ellipse(x0 + w / 2, y0 + h / 2, w * 0.46, h * 0.48, k.cavity[1])
  p.ellipse(x0 + w / 2 + facing, y0 + h / 2 + 1, w * 0.3, h * 0.34, k.cavity[0])
  // A rim of torn skin round the opening, so it reads as a hole in something
  // rather than a dark panel painted on.
  p.ellipseFrame(x0 + w / 2, y0 + h / 2, w * 0.47, h * 0.49, k.meat[1])
  // TWO PIXELS PER RIB, with a lit top edge.
  //
  // One-pixel ribs over a dark cavity read as noise at this scale — the whole
  // cage collapsed into a dark rectangle. A rib needs a body and a highlight to
  // be a rib, which means two rows minimum, and that in turn means fewer of
  // them: three or four bars you can count beats seven you cannot.
  const step = Math.max(3, Math.round(h / ribs))
  for (let i = 0; i < ribs; i += 1) {
    const y = y0 + 1 + i * step
    // Ribs curve: longer in the middle of the cage, tucked at both ends.
    const t = ribs === 1 ? 0.5 : i / (ribs - 1)
    const span = w * (0.6 + Math.sin(t * Math.PI) * 0.4)
    const sag = Math.round(Math.sin(t * Math.PI) * 1.6)
    const x1 = x0 + w * 0.5 - (span / 2) * facing
    const x2 = x0 + w * 0.5 + (span / 2) * facing
    p.thickLine(x1, y + 1, x2, y + sag + 1, 2, k.bone[1])
    p.thickLine(x1, y, x2, y + sag, 1, k.bone[4])
  }
  // Sternum: one vertical bar tying them together.
  p.thickLine(x0 + w * 0.5 - facing * w * 0.34, y0, x0 + w * 0.5 - facing * w * 0.34, y0 + h, 1, k.bone[3])
}

/** A run of vertebrae poking through the back. */
export function spine(p: Pix, x0: number, y0: number, x1: number, y1: number, k: FleshKit, n = 6): void {
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const r = 1 + (i % 2 === 0 ? 0.6 : 0)
    p.ellipse(x, y, r, r * 0.9, k.bone[2])
    p.set(Math.round(x), Math.round(y - 1), k.bone[4])
  }
}

/** Jagged bone breaking out through the surface. */
export function boneSpur(p: Pix, x: number, y: number, len: number, angle: number, k: FleshKit): void {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  for (let i = 0; i < len; i += 1) {
    const t = i / Math.max(1, len - 1)
    const wid = Math.max(1, Math.round((1 - t) * 2.4))
    const px = x + dx * i
    const py = y + dy * i
    for (let o = 0; o < wid; o += 1) p.set(Math.round(px), Math.round(py + o - wid / 2), k.bone[o === 0 ? 4 : 2])
  }
  // A collar of torn tissue where it comes through.
  p.ellipse(x, y, 2.2, 1.8, k.necrotic[1])
}

/** A stitched seam: two bodies that were joined by someone in a hurry. */
export function suture(p: Pix, x0: number, y0: number, x1: number, y1: number, k: FleshKit): void {
  p.line(x0, y0, x1, y1, k.necrotic[0])
  const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3))
  const nx = -(y1 - y0) / Math.max(1, Math.hypot(x1 - x0, y1 - y0))
  const ny = (x1 - x0) / Math.max(1, Math.hypot(x1 - x0, y1 - y0))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const s = i % 2 === 0 ? 1 : -1
    p.line(x - nx * 1.6 * s, y - ny * 1.6 * s, x + nx * 1.6 * s, y + ny * 1.6 * s, k.gristle[3])
  }
}

// ───────────────────────────────── Organs ─────────────────────────────────

/**
 * A MAW. Not a mouth on a face — a ring of irregular teeth around a hole,
 * which is the shape that makes a thing read as a predator with no head.
 */
export function maw(
  p: Pix,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  k: FleshKit,
  teeth = 9,
  seed = 3
): void {
  const noise = pixelNoise(seed * 3571 + 11)
  // Throat: two nested darks so it has depth rather than being a black hole.
  p.ellipse(cx, cy, rx, ry, k.cavity[1])
  p.ellipse(cx, cy + ry * 0.12, rx * 0.66, ry * 0.66, k.cavity[0])
  // Gum ring, slightly proud of the hole.
  p.ellipseFrame(cx, cy, rx + 1, ry + 1, k.necrotic[2])
  for (let i = 0; i < teeth; i += 1) {
    const a = (i / teeth) * Math.PI * 2
    const jitter = noise(i, 7)
    const len = ry * (0.32 + jitter * 0.45)
    const bx = cx + Math.cos(a) * rx * 0.94
    const by = cy + Math.sin(a) * ry * 0.94
    // Teeth point INWARD, toward the throat. That is what says "in", not "out".
    const tx = bx - Math.cos(a) * len
    const ty = by - Math.sin(a) * len
    p.thickLine(bx, by, tx, ty, jitter > 0.6 ? 2 : 1, k.bone[3])
    p.set(Math.round(tx), Math.round(ty), k.bone[4])
  }
}

/** A cluster of mismatched eyes, no two the same size. */
export function eyeCluster(p: Pix, cx: number, cy: number, spread: number, k: FleshKit, n = 4, seed = 5): void {
  const noise = pixelNoise(seed * 6151 + 29)
  for (let i = 0; i < n; i += 1) {
    const a = noise(i, 3) * Math.PI * 2
    const d = spread * (0.2 + noise(i, 7) * 0.8)
    const r = 1 + noise(i, 11) * 1.8
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d * 0.7
    p.ellipse(x, y, r + 0.6, r + 0.6, k.necrotic[0])
    p.ellipse(x, y, r, r, 0xf2e6c8)
    p.set(Math.round(x), Math.round(y), 0x1a0a0a)
    p.set(Math.round(x - r * 0.5), Math.round(y - r * 0.5), 0xffffff)
  }
}

/** A swollen blister, ready to burst. */
export function pustule(p: Pix, cx: number, cy: number, r: number, k: FleshKit): void {
  p.ellipse(cx, cy, r, r * 0.86, k.fat[2])
  p.ellipse(cx - r * 0.24, cy - r * 0.3, r * 0.5, r * 0.42, k.fat[4])
  p.ellipseFrame(cx, cy, r, r * 0.86, k.necrotic[1])
}

/** Loose viscera, hanging or trailing. */
export function viscera(p: Pix, x: number, y: number, len: number, k: FleshKit, seed = 2, sway = 0): void {
  const noise = pixelNoise(seed * 8191 + 5)
  const strands = 3
  for (let s = 0; s < strands; s += 1) {
    let px = x + (s - 1) * 1.6
    let py = y
    const drift = (noise(s, 3) - 0.5) * 2.2 + sway
    for (let i = 0; i < len; i += 1) {
      const t = i / len
      px += drift * 0.28 + Math.sin(t * 6 + s) * 0.5
      py += 1
      const wid = i < len * 0.7 ? 2 : 1
      for (let o = 0; o < wid; o += 1) {
        p.set(Math.round(px + o), Math.round(py), i % 5 === 0 ? k.necrotic[2] : k.necrotic[1])
      }
      if (i % 4 === 1) p.set(Math.round(px), Math.round(py), k.meat[3])
    }
    p.ellipse(px, py, 1.6, 1.4, k.necrotic[2])
  }
}

// ────────────────────────────────── Limbs ──────────────────────────────────

/**
 * A boneless limb: tapers, kinks rather than curving, and carries suckers on
 * the underside. Authored pointing DOWN so it can hang on a rig bone.
 */
export function tentacleLimb(p: Pix, cx: number, y0: number, len: number, thick: number, k: FleshKit, seed = 1): void {
  const noise = pixelNoise(seed * 4451 + 13)
  for (let i = 0; i < len; i += 1) {
    const t = i / Math.max(1, len - 1)
    const wid = Math.max(1, Math.round(thick * (1 - 0.62 * t)))
    // Two frequencies of kink: a boneless thing folds where the muscle gives.
    const kink = Math.sin(t * 4.1 + noise(0, 3) * 3) * thick * 0.34 + Math.sin(t * 9.3) * thick * 0.14
    const x = cx + kink
    for (let o = 0; o < wid; o += 1) {
      const px = Math.round(x - wid / 2 + o)
      p.set(px, y0 + i, o === 0 ? k.meat[1] : o === wid - 1 ? k.meat[3] : k.meat[2])
    }
    if (i % 3 === 0 && wid > 1) {
      p.set(Math.round(x + wid / 2 - 1), y0 + i, k.gristle[3])
    }
  }
  // The beak at the tip — the only hard thing on it.
  const tipT = 1
  const tx = cx + Math.sin(tipT * 4.1 + noise(0, 3) * 3) * thick * 0.34 + Math.sin(tipT * 9.3) * thick * 0.14
  for (let i = 0; i < 3; i += 1) {
    p.set(Math.round(tx), y0 + len + i, k.bone[i === 0 ? 4 : 2])
  }
}

/** A hooked claw, three talons, authored pointing down. */
export function claw(p: Pix, cx: number, y0: number, len: number, k: FleshKit): void {
  for (let f = -1; f <= 1; f += 1) {
    const bend = f * 0.5
    for (let i = 0; i < len; i += 1) {
      const t = i / Math.max(1, len - 1)
      const x = cx + f * 1.8 + bend * t * t * 3
      p.set(Math.round(x), y0 + i, i > len * 0.6 ? k.bone[3] : k.gristle[2])
    }
  }
  p.ellipse(cx, y0, 2.4, 2, k.hide[2])
}

/** A hoof or splayed pad, for something that walks on the ends of its bones. */
export function hoof(p: Pix, cx: number, y0: number, k: FleshKit): void {
  p.fill(cx - 2, y0, 5, 2, k.bone[2])
  p.fill(cx - 2, y0, 5, 1, k.bone[3])
  p.fill(cx - 1, y0 + 2, 3, 1, k.cavity[1])
}

/** Membranous wing skin stretched over spars. Authored spread to the right. */
export function wingMembrane(p: Pix, x0: number, y0: number, span: number, drop: number, k: FleshKit, seed = 4): void {
  const noise = pixelNoise(seed * 2971 + 7)
  const spars = 4
  // The web first.
  for (let i = 0; i <= span; i += 1) {
    const t = i / span
    const edge = drop * (0.35 + Math.sin(t * Math.PI * 0.85) * 0.85)
    for (let y = 0; y < edge; y += 1) {
      const shade = y / Math.max(1, edge)
      p.set(x0 + i, Math.round(y0 + y), k.membrane[shade > 0.72 ? 1 : shade > 0.34 ? 2 : 3])
    }
    // A ragged trailing edge — nothing on this thing is intact.
    if (noise(i, 5) > 0.72) p.set(x0 + i, Math.round(y0 + edge), 0)
  }
  // Spars over it.
  for (let s = 0; s <= spars; s += 1) {
    const t = s / spars
    const x = x0 + Math.round(span * t)
    const edge = drop * (0.35 + Math.sin(t * Math.PI * 0.85) * 0.85)
    p.thickLine(x0, y0, x, y0 + edge, 1, k.bone[2])
  }
}

// ─────────────────────────────── Composition ───────────────────────────────

/**
 * Speckles a finished surface with pores, bruising and torn patches. Applied
 * last, at low density, purely so no two pixels of the army are identical.
 */
export function blemish(p: Pix, k: FleshKit, seed = 1, density = 0.035): void {
  const noise = pixelNoise(seed * 5077 + 19)
  for (let y = 0; y < p.h; y += 1) {
    for (let x = 0; x < p.w; x += 1) {
      const [, , , a] = unpackAt(p, x, y)
      if (a < 40) continue
      const n = noise(x, y)
      if (n > 1 - density) p.set(x, y, k.necrotic[1])
      else if (n < density * 0.6) p.set(x, y, k.fat[3])
    }
  }
}

/** The dark rim every flesh part gets, so it holds together against the field. */
export function rimFlesh(p: Pix, k: FleshKit): void {
  // Dark enough to hold the shape against a bright field, light enough not to
  // read as ink. The old value plus the wet pass's turning edge stacked into a
  // two-pixel black border on every part.
  p.outline(tone(k.necrotic[0], -0.12), { diagonals: false })
}
