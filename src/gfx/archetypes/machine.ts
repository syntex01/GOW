import type { UnitVisual } from '../../data/types'
import {
  PAD,
  box,
  chamfer,
  contactShadow,
  emissive,
  leather,
  metal as metalMat,
  orb,
  partCanvas,
  rivet,
  rivetRow,
  sealPart,
  trim,
  type Material
} from '../anatomy'
import type { Canvas2D } from '../painter'
import Pix, { RES, ramp, tone, type Ramp } from '../pixel'
import { bone, validateSkeleton, type Clip, type Keyframe, type Pose, type Skeleton } from '../rig'
import type { Archetype, ArchetypeBuild, ClipName, PartArt } from './types'

/**
 * The machines: walkers, vehicles and flyers.
 *
 * Three body plans in one file because they are the same animal underneath — a
 * chassis, a running gear that carries it, and a weapon that recoils. Sharing
 * the drawing vocabulary between them is what keeps a Field Cannon and a Battle
 * Tank looking like they were built by the same civilisation two ages apart.
 *
 * ## What was wrong before
 *
 * Every machine on the roster rendered from three parts or fewer. A Catapult
 * was a body, a wheel and a second copy of the same wheel; a Gunship was a
 * fuselage and one rotor bar that scaled on the Y axis to fake a spin. At that
 * part count there is nothing to animate, so the machines sat on the field as
 * flat slabs while the infantry around them walked.
 *
 * So: a walker with reverse-jointed legs and a hull that settles onto each
 * footfall, a vehicle with individually sprung road wheels, a barrel that
 * recoils along its own axis, and a flyer whose rotors are drawn as motion
 * blur rather than as a bar that spins.
 *
 * ## Authoring conventions (the same ones footman.ts sets out)
 *
 * - Offsets and lengths are **fractions of unit height**, never pixels.
 * - Angles are screen-space radians: 0 right, positive clockwise, because y
 *   grows downward. So a **negative** local angle on a downward-hanging limb
 *   swings its tip forward and a positive one swings it back.
 * - Pivots carry an angle so a limb at local zero hangs straight down; every
 *   number in the clips is then "how far from the stance", not an absolute.
 * - `orient` is declared per bone: `'down'` for legs and arms, `'up'` for
 *   hulls, turrets and bodies drawn upright, `'right'` for barrels, guns and
 *   throwing arms drawn along their line of fire.
 * - An upright part's origin sits on the **drawn** bottom edge, not on the
 *   padded canvas edge — otherwise the whole machine floats PAD pixels above
 *   its own running gear.
 */

// ─────────────────────────── The shared machine kit ───────────────────────────

/**
 * Every material a machine is made of, derived once from the unit's palette.
 *
 * Machines get harder ramps than cloth or skin: a narrow, bright specular on
 * the top edge and a deep shadow underneath is most of what separates painted
 * steel from painted card at this size.
 */
interface Kit {
  /** Main armour. */
  hull: Material
  /** The same armour turned away from the light — far-side limbs, undersides. */
  shade: Material
  /** Gun metal, rubber and track link: dark, desaturated, nearly neutral. */
  iron: Material
  /** Seasoned oak, for carriages and throwing arms. */
  timber: Material
  glass: Ramp
  accent: Ramp
}

function kitFor(v: UnitVisual): Kit {
  return {
    hull: metalMat(v.metal),
    shade: metalMat(tone(v.metal, -0.32)),
    iron: metalMat(0x2f343d),
    timber: leather(0x7a5433),
    glass: ramp(0x69b6d8, { contrast: 1.45, hueShift: 0.02 }),
    accent: ramp(v.accent, { contrast: 1.35 })
  }
}

const TAU = Math.PI * 2

/** The origin a rig should use for a point drawn at `x, y` on this canvas. */
function originAt(p: Pix, x: number, y: number): [number, number] {
  return [x / p.w, y / p.h]
}

/** Hands a canvas back without an outline pass — for blurs and glows. */
function raw(p: Pix): Canvas2D {
  return p.toCanvas() as Canvas2D
}

/**
 * A horizontal panel seam: a shadow groove with the lit lip of the next plate
 * below it. Two pixels, and the single cheapest way to turn a slab of hull into
 * a fabricated assembly.
 */
function seamH(p: Pix, x: number, y: number, w: number, r: Ramp): void {
  p.fill(x, y, Math.max(1, Math.round(w)), 1, r[1])
  p.fill(x, y + 1, Math.max(1, Math.round(w)), 1, r[3])
}

/** The vertical seam. The lit lip goes on the right, because the light does. */
function seamV(p: Pix, x: number, y: number, h: number, r: Ramp): void {
  p.fill(x, y, 1, Math.max(1, Math.round(h)), r[1])
  p.fill(x + 1, y, 1, Math.max(1, Math.round(h)), r[3])
}

/** Louvred engine grille: stacked dark slots, each with a lit lip beneath. */
function louvres(p: Pix, x: number, y: number, w: number, h: number, r: Ramp): void {
  const W = Math.max(2, Math.round(w))
  for (let i = 0; i < Math.round(h); i += 2) {
    p.fill(x, y + i, W, 1, r[0])
    p.fill(x, y + i + 1, W, 1, r[3])
  }
}

/** A ring of bolts around a hub or a hatch. */
function boltRing(p: Pix, cx: number, cy: number, radius: number, count: number, r: Ramp): void {
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU
    rivet(p, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, r)
  }
}

/**
 * A hydraulic ram: a dark cylinder with a bright chromed rod sliding out of it.
 * Machines read as powered rather than carved the moment one of these is
 * visible on a limb.
 */
function ram(p: Pix, x0: number, y0: number, x1: number, y1: number, r: Ramp): void {
  const mx = x0 + (x1 - x0) * 0.45
  const my = y0 + (y1 - y0) * 0.45
  p.thickLine(x0, y0, mx, my, 2, r[1])
  p.line(mx, my, x1, y1, r[4])
}

// ══════════════════════════════════════════════════════════════════════════
//                                THE WALKER
// ══════════════════════════════════════════════════════════════════════════

/**
 * Proportions of a bipedal walker, as fractions of unit height.
 *
 * The leg is **reverse jointed**: the femur rakes back to a knee behind the
 * hip, the shin sweeps forward again to an ankle under the machine's centre of
 * mass, and a broad foot plate carries the load. That geometry is the whole
 * reason a walker reads as a machine and not as a tall man — it is a leg no
 * animal with a spine could have, and the eye knows it immediately.
 *
 * Checked against the ground plane: hip −0.52, thigh 0.2 raked back 0.55 rad
 * drops 0.170, shin 0.23 swept forward drops 0.196, foot 0.15 hangs straight
 * down. −0.52 + 0.366 + 0.15 ≈ 0. The machine stands on the floor.
 */
const W = {
  hipY: -0.52,
  hullLen: 0.32,
  hullW: 0.28,
  cockpit: 0.13,
  packLen: 0.17,
  shoulderDrop: 0.06,
  shoulderSpread: 0.07,
  upperArm: 0.19,
  gunLen: 0.44,
  thigh: 0.2,
  shin: 0.23,
  footLen: 0.15,
  footPlate: 0.26,
  hipSpread: 0.06,
  strutThick: 0.095,
  /** Rest angles of the reverse joint, measured from hanging straight down. */
  thighRest: 0.55,
  shinRest: -1.1,
  footRest: 0.55
}

/**
 * The walker skeleton — 16 bones.
 *
 * The hull is a bone rather than a fixed body, because the pitch of the hull
 * against the legs is what carries the weight of the thing: a heavy machine
 * noses down as it takes a step and rocks back as it pushes off.
 */
function buildWalkerSkeleton(): Skeleton {
  const s: Skeleton = [
    // Root at the hip line, world-aligned, so the legs never inherit the
    // hull's pitch. Everything that settles moves this bone.
    bone('root', null, { y: W.hipY, depth: 30 }),

    // ── hull ─────────────────────────────────────────────────────────────
    bone('hull', 'root', {
      angle: -Math.PI / 2,
      length: W.hullLen,
      part: 'hull',
      orient: 'up',
      depth: 30,
      weights: { lean: 1, breathe: 0.5, flinch: 0.8 }
    }),
    // Children of an up-pointing bone are offset in its own frame: x runs down
    // the hull, y runs forward. Counter-intuitive once, then never again.
    bone('cockpit', 'hull', {
      y: W.hullW * 0.22,
      length: W.cockpit,
      part: 'cockpit',
      orient: 'up',
      depth: 33,
      weights: { aim: 0.1, flinch: 1 }
    }),
    // Heat sinks and a missile rack, hung off the back of the chest and drawn
    // behind it.
    bone('pack', 'hull', {
      x: -W.hullLen * 0.42,
      y: -W.hullW * 0.34,
      length: W.packLen,
      part: 'pack',
      orient: 'up',
      depth: 22
    }),

    // ── weapon arm ───────────────────────────────────────────────────────
    // The pivot carries PI so that, against an up-pointing hull, the arm at
    // local zero hangs straight down.
    bone('shoulder', 'hull', {
      x: -W.shoulderDrop,
      y: W.shoulderSpread,
      angle: Math.PI,
      depth: 44
    }),
    bone('armUpper', 'shoulder', {
      length: W.upperArm,
      part: 'armUpper',
      orient: 'down',
      depth: 44,
      // The gun's world angle is exactly this bone's local angle (see below),
      // so the aim layer lands here in full and nowhere else.
      weights: { aim: 1, recoil: 0.25 }
    }),
    // A pure pivot that turns the hanging arm into a level line of fire:
    // world angle = (PI/2 + armLocal) + (-PI/2) = armLocal. Its only job is to
    // give the gun a parent frame whose x axis runs *down the barrel*, so the
    // recoil layer shoves the gun backward along itself instead of sideways.
    bone('gunMount', 'armUpper', { angle: -Math.PI / 2, depth: 45 }),
    bone('gun', 'gunMount', {
      part: 'gun',
      orient: 'right',
      depth: 45,
      weights: { recoil: 1 }
    }),

    // ── legs ─────────────────────────────────────────────────────────────
    // Reverse jointed, and authored at rest in that stance so every clip value
    // below is a deviation from a standing machine.
    bone('hipB', 'root', { x: -W.hipSpread * 0.5, y: -0.01, angle: Math.PI / 2, depth: 10 }),
    bone('thighB', 'hipB', { angle: W.thighRest, length: W.thigh, part: 'thighB', depth: 10 }),
    bone('shinB', 'thighB', { angle: W.shinRest, length: W.shin, part: 'shinB', depth: 11 }),
    bone('footB', 'shinB', { angle: W.footRest, part: 'footB', depth: 12 }),

    bone('hipF', 'root', { x: W.hipSpread * 0.5, y: 0.01, angle: Math.PI / 2, depth: 40 }),
    bone('thighF', 'hipF', { angle: W.thighRest, length: W.thigh, part: 'thighF', depth: 40 }),
    bone('shinF', 'thighF', { angle: W.shinRest, length: W.shin, part: 'shinF', depth: 41 }),
    bone('footF', 'shinF', { angle: W.footRest, part: 'footF', depth: 42 })
  ]
  validateSkeleton(s, 'walker')
  return s
}

/**
 * The walker's walk.
 *
 * Six keys instead of four, and the two extra ones are the whole point. A
 * heavy machine does not glide between contacts: the foot lands, and *then*
 * the mass arrives — the hull drops, the standing knee folds to absorb it, and
 * the whole thing pushes back up over the next quarter cycle. Those settle
 * keys sit just after each contact, which is what turns a stride into weight.
 */
const WALKER_WALK: Clip = {
  name: 'walk',
  duration: 900,
  loop: true,
  ease: 'sine',
  keys: [
    {
      // Contact: the back leg has just planted forward, the front leg trails.
      t: 0,
      pose: {
        root: { y: -0.006 },
        hull: { angle: -0.05 },
        thighB: { angle: -0.3 },
        shinB: { angle: 0.24 },
        footB: { angle: 0.06 },
        thighF: { angle: 0.26 },
        shinF: { angle: -0.16 },
        footF: { angle: -0.1 },
        armUpper: { angle: 0.06 }
      }
    },
    {
      // Settle. The tonnage lands on the leading leg: hull down and pitched
      // forward, knee folded, the trailing foot rolling off its toe.
      t: 0.12,
      pose: {
        root: { y: 0.014 },
        hull: { angle: 0.07 },
        cockpit: { angle: -0.05 },
        thighB: { angle: -0.2 },
        shinB: { angle: 0.4 },
        footB: { angle: -0.02 },
        thighF: { angle: 0.3 },
        shinF: { angle: -0.1 },
        footF: { angle: -0.24 },
        armUpper: { angle: 0.1 }
      },
      ease: 'quad'
    },
    {
      // Passing: pushed back up, the free leg tucked through with the knee
      // folded hard so the foot plate clears the ground.
      t: 0.3,
      pose: {
        root: { y: -0.012 },
        hull: { angle: -0.02 },
        thighB: { angle: 0.04 },
        shinB: { angle: 0.06 },
        footB: { angle: 0.04 },
        thighF: { angle: -0.06 },
        shinF: { angle: 0.5 },
        footF: { angle: -0.34 },
        armUpper: { angle: -0.02 }
      }
    },
    { t: 0.5, pose: mirrorWalkerKey(0) },
    { t: 0.62, pose: mirrorWalkerKey(1), ease: 'quad' },
    { t: 0.8, pose: mirrorWalkerKey(2) }
  ]
}

/**
 * Mirrors one of the first three keys onto the other leg.
 *
 * Written out rather than hand-authored twice: the second half of a walk is
 * the first half with the legs exchanged, and typing that by hand is how the
 * two halves quietly drift apart.
 */
function mirrorWalkerKey(index: number): Pose {
  const source: Pose[] = [
    {
      root: { y: -0.006 },
      hull: { angle: -0.05 },
      thighB: { angle: 0.26 },
      shinB: { angle: -0.16 },
      footB: { angle: -0.1 },
      thighF: { angle: -0.3 },
      shinF: { angle: 0.24 },
      footF: { angle: 0.06 },
      armUpper: { angle: -0.06 }
    },
    {
      root: { y: 0.014 },
      hull: { angle: 0.07 },
      cockpit: { angle: -0.05 },
      thighB: { angle: 0.3 },
      shinB: { angle: -0.1 },
      footB: { angle: -0.24 },
      thighF: { angle: -0.2 },
      shinF: { angle: 0.4 },
      footF: { angle: -0.02 },
      armUpper: { angle: -0.1 }
    },
    {
      root: { y: -0.012 },
      hull: { angle: -0.02 },
      thighB: { angle: -0.06 },
      shinB: { angle: 0.5 },
      footB: { angle: -0.34 },
      thighF: { angle: 0.04 },
      shinF: { angle: 0.06 },
      footF: { angle: 0.04 },
      armUpper: { angle: 0.02 }
    }
  ]
  return source[index]
}

/**
 * The walker's idle: a machine holding station under its own weight.
 *
 * Almost nothing moves, but the little that does is mechanical rather than
 * organic — a slow hydraulic creep in the knees and a hull that sinks a
 * fraction and is pushed back up, like a suspension bleeding off pressure.
 */
const WALKER_IDLE: Clip = {
  name: 'idle',
  duration: 3200,
  loop: true,
  ease: 'sine',
  keys: [
    { t: 0, pose: { root: { y: 0.002 }, hull: { angle: 0.008 }, armUpper: { angle: 0.02 } } },
    {
      t: 0.5,
      pose: {
        root: { y: -0.004 },
        hull: { angle: -0.012 },
        cockpit: { angle: 0.02 },
        thighB: { angle: -0.02 },
        shinB: { angle: 0.03 },
        armUpper: { angle: -0.02 }
      }
    }
  ]
}

/**
 * The walker's attack.
 *
 * A leg-mounted weapons platform cannot wind up the way a swordsman does, so
 * the anticipation is in the *legs*: the machine squats and braces before the
 * shot, the gun slams back along its own axis at the moment of firing, and the
 * hull absorbs the impulse and rocks forward again. `back` easing on the
 * recovery gives the recoil somewhere to overshoot to.
 */
const WALKER_ATTACK: Clip = {
  name: 'attack',
  duration: 620,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: {} },
    {
      // Brace: squat into the ground, gun creeping forward on its rails.
      t: 0.3,
      pose: {
        root: { y: 0.01 },
        hull: { angle: -0.06 },
        thighB: { angle: 0.1 },
        shinB: { angle: -0.12 },
        thighF: { angle: 0.1 },
        shinF: { angle: -0.12 },
        gun: { x: 0.008 }
      },
      ease: 'cubic'
    },
    {
      // Discharge. The gun is thrown back along the barrel axis, the arm lifts
      // with the muzzle climb and the hull takes the rest of it.
      t: 0.4,
      pose: {
        root: { y: 0.004, x: -0.014 },
        hull: { angle: 0.14 },
        cockpit: { angle: -0.06 },
        armUpper: { angle: -0.18 },
        gun: { x: -0.055 },
        thighB: { angle: 0.16 },
        shinB: { angle: -0.2 },
        thighF: { angle: 0.14 },
        shinF: { angle: -0.16 }
      },
      ease: 'hold'
    },
    {
      // The gun runs back out, the machine settles forward off its heels.
      t: 0.68,
      pose: {
        root: { y: 0.006, x: -0.004 },
        hull: { angle: 0.04 },
        armUpper: { angle: -0.06 },
        gun: { x: -0.016 }
      },
      ease: 'back'
    },
    { t: 1, pose: {}, ease: 'sine' }
  ]
}

// ────────────────────────────── Walker parts ──────────────────────────────

/**
 * The hull: a deep armoured chest overhanging a narrow hip yoke.
 *
 * Drawn upright, origin on the drawn bottom edge, which is the hip line. The
 * overhang is deliberate — a walker's mass has to sit high and forward of its
 * knees or the machine reads as standing on stilts.
 */
function drawWalkerHull(v: UnitVisual, kit: Kit, lenPx: number, widPx: number): PartArt {
  const L = Math.max(8, Math.round(lenPx * RES))
  const Wd = Math.max(8, Math.round(widPx * RES))
  const p = partCanvas(Wd + 6, L + 4)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - L
  const r = kit.hull.ramp
  const d = kit.shade.ramp
  const a = kit.accent

  // Silhouette first: chest wide and raked forward, waist pinched.
  p.poly(
    [
      [cx - Wd * 0.3, bot],
      [cx + Wd * 0.26, bot],
      [cx + Wd * 0.52, bot - L * 0.34],
      [cx + Wd * 0.46, top + L * 0.18],
      [cx + Wd * 0.14, top],
      [cx - Wd * 0.36, top + L * 0.08],
      [cx - Wd * 0.52, bot - L * 0.28]
    ],
    r[2]
  )

  // The hard highlight along the top deck, and the shadow down the back edge.
  p.line(cx - Wd * 0.36, top + L * 0.08, cx + Wd * 0.14, top, r[4])
  p.line(cx + Wd * 0.14, top, cx + Wd * 0.46, top + L * 0.18, r[3])
  p.line(cx - Wd * 0.36, top + L * 0.08, cx - Wd * 0.52, bot - L * 0.28, r[1])
  p.line(cx - Wd * 0.52, bot - L * 0.28, cx - Wd * 0.3, bot, r[1])
  // Front armour catches the light down its whole face.
  p.line(cx + Wd * 0.46, top + L * 0.2, cx + Wd * 0.52, bot - L * 0.34, r[3])

  // Plate breaks across the chest, and the belt line the two halves meet on.
  seamH(p, cx - Wd * 0.42, top + Math.round(L * 0.42), Wd * 0.9, r)
  seamV(p, cx + Math.round(Wd * 0.14), top + Math.round(L * 0.12), L * 0.28, r)
  rivetRow(p, cx - Wd * 0.34, top + Math.round(L * 0.16), Wd * 0.7, 4, r)

  // Engine grille in the shadowed back quarter, where a vent belongs.
  louvres(p, cx - Math.round(Wd * 0.44), top + Math.round(L * 0.5), Wd * 0.24, L * 0.3, d)

  // A faction stripe, low on the chest so the hull does not go dead.
  trim(p, cx - Wd * 0.06, top + Math.round(L * 0.62), Wd * 0.34, a)

  // Shoulder shroud on the near side, with contact shadow beneath so it sits
  // on the hull instead of floating over it.
  const shroudW = Math.max(3, Math.round(Wd * 0.34))
  const shroudH = Math.max(3, Math.round(L * 0.26))
  chamfer(p, cx + Wd * 0.16, top + L * 0.06, shroudW, shroudH, r)
  contactShadow(p, cx + Wd * 0.16, top + L * 0.06 + shroudH, shroudW, r)
  rivetRow(p, cx + Wd * 0.2, top + L * 0.1, shroudW * 0.7, 3, r)
  // And the far shoulder, darkened, poking past the other side.
  box(p, cx - Wd * 0.48, top + L * 0.1, Math.max(2, Wd * 0.18), Math.max(3, L * 0.2), d)

  // Hip yoke: a heavy dark block with a rotator dome on each side, so the legs
  // have something visibly load-bearing to hang from.
  const yokeW = Math.max(4, Math.round(Wd * 0.62))
  const yokeH = Math.max(3, Math.round(L * 0.2))
  box(p, cx - yokeW / 2, bot - yokeH, yokeW, yokeH, d)
  orb(p, cx - yokeW * 0.42, bot - yokeH * 0.4, yokeW * 0.2, yokeH * 0.5, d)
  orb(p, cx + yokeW * 0.42, bot - yokeH * 0.4, yokeW * 0.2, yokeH * 0.5, r)
  rivetRow(p, cx - yokeW * 0.36, bot - yokeH, yokeW * 0.72, 3, d)

  return { canvas: sealPart(p, v.metal), origin: originAt(p, cx, bot) }
}

/** The sensor head: a visor band, an armoured brow and a whip antenna. */
function drawWalkerCockpit(v: UnitVisual, kit: Kit, sizePx: number): PartArt {
  const S = Math.max(4, Math.round(sizePx * RES))
  const p = partCanvas(S * 2 + 4, S + 4)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - S
  const r = kit.hull.ramp
  const a = kit.accent

  chamfer(p, cx - S * 0.8, top, Math.round(S * 1.6), S, r)
  // Brow plate, thrown forward over the optics.
  p.fill(cx - Math.round(S * 0.8), top, Math.round(S * 1.6), 1, r[4])
  p.fill(cx + Math.round(S * 0.2), top + 1, Math.round(S * 0.6), 1, r[3])
  contactShadow(p, cx - S * 0.2, top + Math.round(S * 0.34), S * 0.9, r)
  // The visor itself, set into the face rather than painted on it.
  emissive(p, cx + S * 0.34, top + S * 0.52, S * 0.42, S * 0.16, a)
  rivet(p, cx - S * 0.6, top + S * 0.5, r)
  // Antenna, one pixel wide, because two would read as a mast.
  p.line(cx - S * 0.7, top, cx - S * 0.85, top - S * 0.7, r[1])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, cx, bot) }
}

/** Dorsal pack: heat sink fins over a boxed missile rack. */
function drawWalkerPack(v: UnitVisual, kit: Kit, lenPx: number, widPx: number): PartArt {
  const L = Math.max(5, Math.round(lenPx * RES))
  const Wd = Math.max(4, Math.round(widPx * RES))
  const p = partCanvas(Wd + 4, L + 4)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - L
  const d = kit.shade.ramp
  const a = kit.accent

  box(p, cx - Wd / 2, top, Wd, L, d)
  // Cooling fins across the top half — horizontal, so they read against the
  // vertical panel lines on the hull in front of them.
  for (let i = 0; i < Math.round(L * 0.5); i += 2) {
    p.fill(cx - Wd / 2, top + i, Wd, 1, d[0])
    p.fill(cx - Wd / 2, top + i + 1, Wd, 1, d[3])
  }
  // Missile cells: a two-by-two block of dark mouths with lit rims.
  const cell = Math.max(1, Math.round(Wd * 0.3))
  for (let ix = 0; ix < 2; ix += 1) {
    for (let iy = 0; iy < 2; iy += 1) {
      const x = cx - Wd * 0.36 + ix * (cell + 1)
      const y = bot - L * 0.42 + iy * (cell + 1)
      p.fill(x, y, cell, cell, d[0])
      p.set(Math.round(x + cell - 1), Math.round(y), a[3])
    }
  }
  p.fill(cx - Wd / 2, top, Wd, 1, d[4])

  return { canvas: sealPart(p, tone(v.metal, -0.32)), origin: originAt(p, cx, bot) }
}

/**
 * One armoured limb segment, authored pointing **down** with its origin at the
 * joint it rotates about.
 *
 * Not a tapered tube like a soldier's thigh: a machine limb is a stack of
 * plates over a visible actuator, so it gets a hard shoulder at the top, a
 * plate break down its length and a hydraulic ram running along the back where
 * the light does not reach.
 */
function drawStrut(
  lengthPx: number,
  thickPx: number,
  material: Material,
  accent: Ramp,
  opts: { cap?: boolean; knee?: boolean; ram?: boolean; taper?: number } = {}
): PartArt {
  const L = Math.max(4, Math.round(lengthPx * RES))
  const T = Math.max(2, Math.round(thickPx * RES))
  const taper = opts.taper ?? 0.84
  const p = partCanvas(T + 6, L + T + 2)
  const cx = Math.round(p.w / 2)
  const top = PAD + Math.round(opts.cap ? T * 0.3 : 0)
  const r = material.ramp

  // The load-bearing spar.
  for (let i = 0; i < L; i += 1) {
    const t = L > 1 ? i / (L - 1) : 0
    const rowW = Math.max(2, Math.round(T * (1 - (1 - taper) * t)))
    const x = cx - (rowW >> 1)
    p.fill(x, top + i, rowW, 1, r[2])
    p.set(x, top + i, r[1])
    if (rowW > 2) p.set(x + rowW - 1, top + i, r[3])
  }

  // An armour plate laid over the outer two thirds, offset toward the light so
  // it reads as a separate piece bolted on rather than as a stripe.
  const plateW = Math.max(2, Math.round(T * 0.62))
  const plateY = top + Math.round(L * 0.18)
  const plateH = Math.max(2, Math.round(L * 0.5))
  box(p, cx - (plateW >> 1) + 1, plateY, plateW, plateH, r)
  contactShadow(p, cx - (plateW >> 1) + 1, plateY + plateH, plateW, r)
  if (plateH >= 5) rivetRow(p, cx - (plateW >> 1) + 1, plateY + 1, plateW, 3, r)

  // The actuator, down the shadow side.
  if (opts.ram && T >= 3) ram(p, cx - T * 0.42, top + L * 0.1, cx - T * 0.3, top + L * 0.82, r)

  if (opts.cap) orb(p, cx, top, T * 0.6, T * 0.42, r)
  if (opts.knee) {
    // The knee is the busiest joint on the machine, so it gets the accent.
    orb(p, cx, top + L - 1, T * 0.5, T * 0.44, r)
    p.set(cx + Math.max(1, T >> 2), top + L - 1, accent[4])
  }

  return { canvas: sealPart(p, material.base), origin: originAt(p, cx, top) }
}

/**
 * The foot: an ankle strut over a broad plate with a raised toe and a heel
 * spur. Authored pointing down from the ankle, which is its origin.
 *
 * The plate is deliberately longer than it looks like it needs to be. A walker
 * with small feet reads as unstable no matter how the legs move, and this is
 * the part that has to sell "this thing weighs forty tonnes".
 */
function drawMechFoot(lengthPx: number, plateLenPx: number, material: Material): PartArt {
  const L = Math.max(4, Math.round(lengthPx * RES))
  const PL = Math.max(5, Math.round(plateLenPx * RES))
  const p = partCanvas(PL + 4, L + 4)
  const ankleX = PAD + Math.round(PL * 0.42)
  const top = PAD
  const r = material.ramp
  const plateH = Math.max(2, Math.round(L * 0.36))
  const plateY = top + L - plateH

  // Ankle strut.
  const strutW = Math.max(2, Math.round(PL * 0.24))
  box(p, ankleX - (strutW >> 1), top, strutW, L - plateH + 1, r)
  // Foot plate, longer forward than back.
  box(p, ankleX - PL * 0.42, plateY, PL, plateH, r)
  p.fill(ankleX - Math.round(PL * 0.42), plateY, PL, 1, r[3])
  // Raised toe and heel spur, so the plate is not a brick.
  p.set(Math.round(ankleX + PL * 0.56), Math.round(plateY + plateH - 1), 0, 0)
  p.set(Math.round(ankleX - PL * 0.42), Math.round(plateY + plateH - 1), 0, 0)
  if (PL >= 8) {
    p.fill(ankleX + PL * 0.42, plateY - 1, Math.max(1, Math.round(PL * 0.14)), 1, r[4])
    rivetRow(p, ankleX - PL * 0.34, plateY + 1, PL * 0.8, 3, r)
  }
  // Sole in shadow. One row, and the foot is on the ground rather than near it.
  p.fill(ankleX - Math.round(PL * 0.42), plateY + plateH - 1, PL, 1, r[0])

  return { canvas: sealPart(p, material.base), origin: originAt(p, ankleX, top) }
}

/**
 * The arm gun, authored pointing **right** with its origin at the elbow.
 *
 * Three flavours off the same silhouette, because the mechs that carry these
 * differ by what comes out of the muzzle: a plasma projector glows along its
 * whole length, a railgun runs two hard parallel rails with a charged gap
 * between them, and anything else is an honest autocannon with a shroud.
 */
function drawMechGun(v: UnitVisual, kit: Kit, lengthPx: number, thickPx: number): PartArt {
  const L = Math.max(8, Math.round(lengthPx * RES))
  const T = Math.max(3, Math.round(thickPx * RES))
  const p = partCanvas(L + 4, T * 2.4 + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD
  const r = kit.hull.ramp
  const d = kit.iron.ramp
  const a = kit.accent

  // Receiver: the heavy block the barrel comes out of.
  const recW = Math.round(L * 0.4)
  box(p, x0, cy - T * 0.9, recW, Math.round(T * 1.8), r)
  p.fill(x0, Math.round(cy - T * 0.9), recW, 1, r[4])
  rivetRow(p, x0 + 1, Math.round(cy - T * 0.9) + 1, recW - 2, 4, r)
  louvres(p, x0 + Math.round(recW * 0.12), Math.round(cy + T * 0.1), recW * 0.3, T * 0.6, d)

  // Barrel.
  const barY = cy - Math.round(T * 0.4)
  const barH = Math.max(2, Math.round(T * 0.8))
  box(p, x0 + recW, barY, L - recW, barH, d)
  p.fill(x0 + recW, barY, L - recW, 1, d[3])

  if (v.weapon === 'railgun') {
    // Twin rails with the charge line between them.
    p.fill(x0 + recW, barY - 1, L - recW, 1, r[3])
    p.fill(x0 + recW, barY + barH, L - recW, 1, r[1])
    for (let x = x0 + recW + 2; x < x0 + L - 2; x += 3) p.set(x, cy, a[4])
  } else if (v.weapon === 'plasma') {
    // Containment coils and a hot line down the bore.
    for (let x = x0 + recW + 1; x < x0 + L - 2; x += 3) {
      p.fill(x, barY - 1, 1, barH + 2, r[3])
    }
    p.fill(x0 + recW, cy, L - recW - 2, 1, a[4])
    emissive(p, x0 + recW * 0.7, cy, T * 0.4, T * 0.4, a)
  } else {
    // Cooling shroud: slots along the top of the barrel.
    for (let x = x0 + recW + 2; x < x0 + L - 3; x += 3) p.set(x, barY, d[0])
  }

  // Muzzle device. A wider block with a slot in it reads as a brake at any size.
  const mz = x0 + L - Math.max(2, Math.round(T * 0.7))
  box(p, mz, cy - T * 0.7, Math.max(2, Math.round(T * 0.7)), Math.round(T * 1.4), r)
  p.fill(mz, cy, Math.max(2, Math.round(T * 0.7)), 1, d[0])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, x0, cy) }
}

function buildWalkerParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const kit = kitFor(v)
  const bulk = v.bulk ?? 1
  const px = (f: number) => f * height
  const strutT = px(W.strutThick) * Math.min(1.35, bulk)
  // The far leg is the same limb turned away from the light. Cheapest depth
  // cue there is, and it costs one extra material.
  const far = kit.shade

  return {
    hull: drawWalkerHull(v, kit, px(W.hullLen), px(W.hullW) * bulk),
    cockpit: drawWalkerCockpit(v, kit, px(W.cockpit)),
    pack: drawWalkerPack(v, kit, px(W.packLen), px(W.hullW) * bulk * 0.42),
    armUpper: drawStrut(px(W.upperArm), strutT * 0.92, kit.hull, kit.accent, {
      cap: true,
      knee: true,
      ram: true
    }),
    gun: drawMechGun(v, kit, px(W.gunLen), strutT),
    thighF: drawStrut(px(W.thigh), strutT * 1.3, kit.hull, kit.accent, { cap: true, knee: true, ram: true }),
    shinF: drawStrut(px(W.shin), strutT * 1.05, kit.hull, kit.accent, { knee: true, ram: true, taper: 0.7 }),
    footF: drawMechFoot(px(W.footLen), px(W.footPlate) * bulk, kit.hull),
    thighB: drawStrut(px(W.thigh), strutT * 1.3, far, kit.accent, { cap: true, knee: true, ram: true }),
    shinB: drawStrut(px(W.shin), strutT * 1.05, far, kit.accent, { knee: true, ram: true, taper: 0.7 }),
    footB: drawMechFoot(px(W.footLen), px(W.footPlate) * bulk, far)
  }
}

export const walkerArchetype: Archetype = {
  id: 'walker',
  claims: v => v.kind === 'mech',
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const clips: Record<ClipName, Clip> = {
      idle: WALKER_IDLE,
      walk: WALKER_WALK,
      attack: WALKER_ATTACK
    }
    // The gun hangs off the elbow and fires level, so the muzzle is an arm's
    // drop below the shoulder and a gun's length in front of it.
    const shoulderY = W.hipY - W.hullLen + W.shoulderDrop
    return {
      skeleton: buildWalkerSkeleton(),
      parts: buildWalkerParts(v, height),
      clips,
      height,
      muzzle: [W.shoulderSpread + W.gunLen, shoulderY + W.upperArm]
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
//                                THE VEHICLE
// ══════════════════════════════════════════════════════════════════════════

/**
 * A wheel, a road wheel, a drive sprocket or a cartwheel — the running gear
 * resolves to a list of these, and the skeleton and the walk clip are both
 * generated from it. That is what lets one body plan cover a five-wheel tracked
 * tank and a two-wheel gun carriage without either of them being a special case.
 */
interface Roller {
  name: string
  /** Centre, as height fractions from the rig root. */
  x: number
  y: number
  radius: number
  kind: 'road' | 'sprocket' | 'spoke'
  /** Turns per walk cycle. Small wheels spin faster, as small wheels do. */
  turns: number
  depth: number
  /** How far this wheel travels on its suspension, as a height fraction. */
  travel: number
  /** Phase offset into the walk cycle, so the wheels do not bounce in unison. */
  phase: number
  /** Far-side wheels are drawn darker and behind everything. */
  shaded: boolean
}

interface VehicleLayout {
  machine: UnitVisual['machine'] | null
  tracked: boolean
  /** Hull length and depth, as height fractions. */
  hullLen: number
  hullH: number
  /** World y of the hull's bottom edge. */
  hullY: number
  turret: boolean
  turretH: number
  /** Forward offset of the turret ring from the hull's centre. */
  turretX: number
  barrelLen: number
  barrelThick: number
  /** Rest angle of the barrel or throwing arm, screen radians. */
  barrelRest: number
  /** Where the barrel pivots, relative to the turret ring or the hull. */
  barrelUp: number
  barrelFwd: number
  rollers: Roller[]
  trackH: number
}

function layoutFor(v: UnitVisual): VehicleLayout {
  const bulk = v.bulk ?? 1
  const machine = v.machine ?? null
  const tracked = v.chassis === 'tracks'

  if (machine) {
    // A gun carriage: two tall spoked wheels on one axle, a timber trail, and
    // whatever the crew is shooting mounted between them.
    const wheelR = 0.19
    const rollers: Roller[] = [
      {
        name: 'wheelFar',
        x: -0.02,
        y: -wheelR,
        radius: wheelR * 0.92,
        kind: 'spoke',
        turns: 1,
        depth: 6,
        travel: 0,
        phase: 0.5,
        shaded: true
      },
      {
        name: 'wheelNear',
        x: 0.06,
        y: -wheelR,
        radius: wheelR,
        kind: 'spoke',
        turns: 1,
        depth: 46,
        travel: 0,
        phase: 0,
        shaded: false
      }
    ]
    const rest = machine === 'mortar' ? -1.02 : machine === 'catapult' ? -2.35 : -0.16
    return {
      machine,
      tracked: false,
      hullLen: 0.62 * bulk,
      hullH: 0.16,
      hullY: -wheelR * 0.85,
      turret: false,
      turretH: 0,
      turretX: 0,
      barrelLen: machine === 'catapult' ? 0.46 : machine === 'mortar' ? 0.3 : 0.52,
      barrelThick: machine === 'mortar' ? 0.11 : 0.085,
      barrelRest: rest,
      barrelUp: machine === 'catapult' ? 0.2 : 0.13,
      barrelFwd: machine === 'catapult' ? -0.12 : -0.08,
      rollers,
      trackH: 0
    }
  }

  // A powered hull. Tracked machines get a belt over road wheels and a sprocket
  // at each end; wheeled ones get three fat road wheels.
  const hullLen = 0.56 * bulk
  const rollers: Roller[] = []
  if (tracked) {
    const roadR = 0.078
    const count = 4
    for (let i = 0; i < count; i += 1) {
      const t = count > 1 ? i / (count - 1) : 0.5
      rollers.push({
        name: `road${i}`,
        x: (-0.3 + t * 0.6) * hullLen,
        y: -roadR - 0.008,
        radius: roadR,
        kind: 'road',
        turns: 2,
        depth: 10,
        travel: 0.012,
        phase: i * 0.17,
        shaded: false
      })
    }
    const sprocketR = roadR * 1.15
    rollers.push({
      name: 'sprocketB',
      x: -hullLen * 0.46,
      y: -sprocketR - 0.03,
      radius: sprocketR,
      kind: 'sprocket',
      turns: 2,
      depth: 11,
      travel: 0,
      phase: 0,
      shaded: false
    })
    rollers.push({
      name: 'sprocketF',
      x: hullLen * 0.46,
      y: -sprocketR - 0.03,
      radius: sprocketR,
      kind: 'sprocket',
      turns: 2,
      depth: 11,
      travel: 0,
      phase: 0,
      shaded: false
    })
  } else {
    const roadR = 0.115
    for (let i = 0; i < 3; i += 1) {
      rollers.push({
        name: `road${i}`,
        x: (-0.36 + (i / 2) * 0.72) * hullLen,
        y: -roadR,
        radius: roadR,
        kind: 'road',
        turns: 1.5,
        depth: 10,
        travel: 0.014,
        phase: i * 0.22,
        shaded: false
      })
    }
  }

  const trackH = tracked ? 0.2 : 0
  return {
    machine: null,
    tracked,
    hullLen,
    hullH: 0.22,
    hullY: tracked ? -0.155 : -0.185,
    turret: true,
    turretH: 0.13,
    turretX: -hullLen * 0.06,
    barrelLen: 0.5,
    barrelThick: 0.075,
    barrelRest: -0.06,
    barrelUp: 0.06,
    barrelFwd: hullLen * 0.16,
    rollers,
    trackH
  }
}

/**
 * The vehicle skeleton — 6 bones for a gun carriage, 11 for a wheeled hull,
 * 13 for a tracked one.
 *
 * The chain that matters is turret → barrelMount → barrel. `barrelMount` is a
 * pure pivot rotated so its own x axis runs down the bore; a child's offset is
 * expressed in its parent's frame, so putting the barrel on that mount is what
 * makes the recoil layer drive the gun **backward along itself** rather than
 * backward along the world, whatever elevation it is holding.
 */
function buildVehicleSkeleton(L: VehicleLayout): Skeleton {
  const s: Skeleton = [
    bone('root', null, { depth: 20 }),
    bone('hull', 'root', {
      y: L.hullY,
      angle: -Math.PI / 2,
      length: L.hullH,
      part: 'hull',
      orient: 'up',
      depth: 20,
      weights: { lean: 0.5, flinch: 0.5 }
    })
  ]

  if (L.tracked) {
    // The belt is hung off the root rather than the hull, so it stays flat on
    // the ground while the hull pitches on its suspension.
    s.push(
      bone('track', 'root', {
        y: -L.trackH * 0.5,
        angle: -Math.PI / 2,
        part: 'track',
        orient: 'up',
        depth: 12
      })
    )
  }

  // Running gear. A wheel's part origin is its own centre, so one bone both
  // spins it (angle) and rides it up and down on its suspension (y).
  for (const w of L.rollers) {
    s.push(
      bone(w.name, 'root', {
        x: w.x,
        y: w.y,
        part: w.name,
        orient: 'right',
        depth: w.depth
      })
    )
  }

  if (L.turret) {
    s.push(
      bone('turret', 'hull', {
        x: -L.hullH * 0.06,
        y: L.turretX,
        length: L.turretH,
        part: 'turret',
        orient: 'up',
        depth: 30,
        weights: { aim: 0.12, flinch: 0.4 }
      })
    )
    s.push(
      bone('barrelMount', 'turret', {
        x: -L.turretH + L.barrelUp,
        y: L.barrelFwd,
        angle: Math.PI / 2 + L.barrelRest,
        depth: 32,
        weights: { aim: 1 }
      })
    )
  } else {
    // No turret ring on a carriage: the trunnions are bolted to the frame.
    s.push(
      bone('barrelMount', 'hull', {
        x: -L.hullH + L.barrelUp,
        y: L.barrelFwd,
        angle: Math.PI / 2 + L.barrelRest,
        depth: 32,
        weights: { aim: 0.7 }
      })
    )
  }
  s.push(
    bone('barrel', 'barrelMount', {
      part: 'barrel',
      orient: 'right',
      depth: 32,
      weights: { recoil: 1 }
    })
  )

  validateSkeleton(s, 'vehicle')
  return s
}

// ───────────────────────────── Vehicle clips ─────────────────────────────

/**
 * The drive cycle.
 *
 * Generated rather than hand-authored, because the wheel count varies and
 * because the one thing a rolling wheel must not do is change speed. Two
 * details make it work:
 *
 * 1. **The last key sits at t = 1.** `samplePose` only wraps the final key back
 *    to the first when there is no key at 1, and that wrap would run the wheels
 *    backward across the seam. With a key at exactly 1 holding a whole number
 *    of turns, the loop point is invisible.
 * 2. **Linear easing.** Eased keys would make every wheel stutter twice per
 *    cycle, which is exactly what a wheel never does.
 */
function vehicleWalk(L: VehicleLayout): Clip {
  const steps = 8
  const keys: Keyframe[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const pose: Pose = {}
    for (const w of L.rollers) {
      // Suspension: each wheel rides its own bump, offset in phase from its
      // neighbours so the hull is never lifted by all of them at once.
      const bump = Math.sin((t + w.phase) * TAU * 2) * w.travel
      pose[w.name] = { angle: TAU * w.turns * t, y: w.travel > 0 ? bump : 0 }
    }
    // The hull rides the average of the running gear and pitches against it.
    const heave = Math.sin(t * TAU * 2) * 0.006
    const pitch = Math.cos(t * TAU * 2) * 0.03
    pose.root = { y: heave }
    pose.hull = { angle: pitch }
    if (L.turret) pose.turret = { angle: -pitch * 0.4 }
    keys.push({ t, pose, ease: 'linear' })
  }
  return { name: 'walk', duration: 900, loop: true, ease: 'linear', keys }
}

/** Engine idle: the hull trembles on its springs and nothing else moves. */
function vehicleIdle(L: VehicleLayout): Clip {
  return {
    name: 'idle',
    duration: 2400,
    loop: true,
    ease: 'sine',
    keys: [
      { t: 0, pose: { root: { y: 0.001 }, hull: { angle: 0.006 } } },
      { t: 0.5, pose: { root: { y: -0.002 }, hull: { angle: -0.008 }, ...(L.turret ? { turret: { angle: 0.01 } } : {}) } }
    ]
  }
}

/**
 * Firing.
 *
 * A gun and a catapult are the same clip run in opposite directions: one
 * throws its mass backward along the barrel and rides the recoil into the
 * ground, the other throws its mass forward over the frame and is pulled down
 * onto its trail. Both are authored as anticipation → release → settle, and
 * both push the whole vehicle around, because a machine that fires without
 * moving reads as a picture of a machine.
 */
function vehicleAttack(L: VehicleLayout): Clip {
  if (L.machine === 'catapult') {
    return {
      name: 'attack',
      duration: 900,
      loop: false,
      ease: 'quad',
      keys: [
        { t: 0, pose: {} },
        // Winched down that last inch, the frame straining against the rope.
        { t: 0.34, pose: { barrel: { angle: -0.22 }, hull: { angle: -0.04 }, root: { y: 0.004 } }, ease: 'cubic' },
        // Release: the arm whips over the top and slams into its stop.
        {
          t: 0.46,
          pose: { barrel: { angle: 1.85 }, hull: { angle: 0.09 }, root: { y: -0.008, x: -0.01 } },
          ease: 'back'
        },
        // The frame rocks back down onto its wheels and the arm is re-cocked.
        { t: 0.66, pose: { barrel: { angle: 1.7 }, hull: { angle: -0.03 }, root: { y: 0.004 } }, ease: 'sine' },
        { t: 1, pose: {}, ease: 'sine' }
      ]
    }
  }

  const kick = L.machine ? 0.075 : 0.055
  return {
    name: 'attack',
    duration: 560,
    loop: false,
    ease: 'quad',
    keys: [
      { t: 0, pose: {} },
      // The gun runs forward a hair as the breech closes.
      { t: 0.32, pose: { barrel: { x: 0.006 }, hull: { angle: -0.02 } }, ease: 'cubic' },
      {
        // Discharge. The barrel is thrown straight back along its own axis and
        // the whole vehicle squats on its springs.
        t: 0.42,
        pose: {
          barrel: { x: -kick, angle: -0.06 },
          hull: { angle: 0.08 },
          root: { x: -0.014, y: 0.006 },
          ...(L.turret ? { turret: { angle: 0.04 } } : {})
        },
        ease: 'hold'
      },
      // Counter-recoil: the gun runs back out to battery.
      { t: 0.72, pose: { barrel: { x: -kick * 0.28 }, hull: { angle: 0.02 }, root: { x: -0.004 } }, ease: 'back' },
      { t: 1, pose: {}, ease: 'sine' }
    ]
  }
}

// ────────────────────────────── Vehicle parts ──────────────────────────────

/**
 * A road wheel: rubber tyre, dished hub, bolt circle and lightening holes.
 *
 * The holes are the reason this spins visibly. A plain disc rotating is
 * invisible however fast it turns, so the wheel needs asymmetric detail at the
 * radius the eye tracks.
 */
function drawRoadWheel(radiusPx: number, kit: Kit, shaded: boolean): PartArt {
  const R = Math.max(2, Math.round(radiusPx * RES))
  const p = partCanvas(R * 2 + 2, R * 2 + 2)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const rubber = shaded ? ramp(0x20242b) : kit.iron.ramp
  const hub = shaded ? kit.shade.ramp : kit.hull.ramp

  orb(p, cx, cy, R, R, rubber)
  // Tyre shoulder, so the rubber is not a flat disc.
  p.ellipseFrame(cx, cy, R * 0.82, R * 0.82, rubber[1])
  p.ellipse(cx, cy, R * 0.6, R * 0.6, hub[2])
  p.ellipse(cx - R * 0.12, cy + R * 0.12, R * 0.5, R * 0.5, hub[1])
  p.ellipse(cx + R * 0.14, cy - R * 0.16, R * 0.4, R * 0.4, hub[3])
  if (R >= 4) {
    // Lightening holes at three o'clock spacing, plus the hub nut.
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + 0.4
      p.set(Math.round(cx + Math.cos(a) * R * 0.4), Math.round(cy + Math.sin(a) * R * 0.4), rubber[0])
    }
  }
  p.set(cx, cy, hub[4])

  return { canvas: sealPart(p, shaded ? 0x20242b : 0x2f343d), origin: originAt(p, cx, cy) }
}

/** A drive sprocket. The teeth are what read as rotation at ten pixels across. */
function drawSprocket(radiusPx: number, kit: Kit): PartArt {
  const R = Math.max(3, Math.round(radiusPx * RES))
  const p = partCanvas(R * 2 + 4, R * 2 + 4)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const r = kit.hull.ramp
  const d = kit.iron.ramp

  orb(p, cx, cy, R * 0.82, R * 0.82, r)
  const teeth = Math.max(6, Math.round(R * 1.6))
  for (let i = 0; i < teeth; i += 1) {
    const a = (i / teeth) * TAU
    const x = cx + Math.cos(a) * R * 0.95
    const y = cy + Math.sin(a) * R * 0.95
    p.set(Math.round(x), Math.round(y), Math.sin(a) < 0 ? d[3] : d[1])
  }
  p.ellipse(cx, cy, R * 0.34, R * 0.34, d[1])
  if (R >= 4) boltRing(p, cx, cy, R * 0.55, 5, r)
  p.set(cx, cy, r[4])

  return { canvas: sealPart(p, kit.hull.base), origin: originAt(p, cx, cy) }
}

/**
 * A cartwheel: iron tyre, timber felloe, eight spokes and a bound hub.
 *
 * Every siege engine on the roster rides on two of these, and they are half the
 * silhouette of a Catapult. They were previously drawn as a six-spoke circle
 * with no hub band, which at this scale came out as a grey smudge.
 */
function drawSpokedWheel(radiusPx: number, kit: Kit, shaded: boolean): PartArt {
  const R = Math.max(4, Math.round(radiusPx * RES))
  const p = partCanvas(R * 2 + 3, R * 2 + 3)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const wood = shaded ? ramp(tone(0x7a5433, -0.32), { contrast: 0.9 }) : kit.timber.ramp
  const iron = shaded ? ramp(0x20242b) : kit.iron.ramp

  // Iron tyre over the felloe, then the whole middle punched out so the spokes
  // are read as spokes rather than as a pie chart.
  p.ellipse(cx, cy, R, R, iron[1])
  p.ellipse(cx + R * 0.1, cy - R * 0.1, R * 0.94, R * 0.94, iron[3])
  p.ellipse(cx, cy, R * 0.86, R * 0.86, wood[2])
  p.ellipseFrame(cx, cy, R * 0.86, R * 0.86, wood[3])
  p.eraseEllipse(cx, cy, R * 0.72, R * 0.72)

  const spokes = R >= 6 ? 8 : 6
  for (let i = 0; i < spokes; i += 1) {
    const a = (i / spokes) * TAU + 0.2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    // Spokes on the lit side of the hub catch the light; the rest do not.
    p.line(cx + cos * R * 0.22, cy + sin * R * 0.22, cx + cos * R * 0.8, cy + sin * R * 0.8, sin < 0 ? wood[3] : wood[1])
  }
  orb(p, cx, cy, R * 0.28, R * 0.28, iron)
  if (R >= 6) boltRing(p, cx, cy, R * 0.2, 4, iron)

  return { canvas: sealPart(p, shaded ? 0x3d2a19 : 0x7a5433), origin: originAt(p, cx, cy) }
}

/**
 * The track belt.
 *
 * Drawn as a closed band — a bottom run flat on the ground, a top run over the
 * return rollers, and a rounded end at each drive sprocket — with the middle
 * punched out so the road wheels are visible inside it. The links are notched
 * along both runs; the wheels turning inside the band are what carry the
 * motion, so the belt itself can afford to hold still.
 */
function drawTrackBelt(widthPx: number, heightPx: number, kit: Kit): PartArt {
  const Wd = Math.max(10, Math.round(widthPx * RES))
  const H = Math.max(5, Math.round(heightPx * RES))
  const p = partCanvas(Wd + 4, H + 4)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - H
  const cy = Math.round((top + bot) / 2)
  const r = kit.iron.ramp
  const band = Math.max(2, Math.round(H * 0.26))
  const endR = H * 0.5

  // Outer shape, then the interior removed to leave a belt of constant width.
  p.fill(cx - Wd / 2 + endR * 0.5, top, Wd - endR, H, r[2])
  p.ellipse(cx - Wd / 2 + endR, cy, endR, endR, r[2])
  p.ellipse(cx + Wd / 2 - endR, cy, endR, endR, r[2])
  p.fill(cx - Wd / 2 + endR * 0.4, top + band, Wd - endR * 0.8, H - band * 2, 0, 0)
  p.eraseEllipse(cx - Wd / 2 + endR, cy, endR - band, endR - band)
  p.eraseEllipse(cx + Wd / 2 - endR, cy, endR - band, endR - band)

  // Lit top run, shadowed ground run.
  p.fill(cx - Wd / 2 + endR * 0.4, top, Wd - endR * 0.8, 1, r[3])
  p.fill(cx - Wd / 2 + endR * 0.4, bot - 1, Wd - endR * 0.8, 1, r[0])
  // Link pitch, marked on both runs.
  for (let x = 2; x < Wd - 2; x += 3) {
    p.set(cx - Wd / 2 + x, top + 1, r[1])
    p.set(cx - Wd / 2 + x, bot - 2, r[1])
  }

  return { canvas: sealPart(p, 0x2f343d), origin: originAt(p, cx, bot) }
}

/**
 * The tank hull: sloped glacis forward, engine deck aft, fenders over the
 * running gear. Drawn upright with its origin on the drawn bottom edge.
 */
function drawTankHull(v: UnitVisual, kit: Kit, L: VehicleLayout, height: number): PartArt {
  const Wd = Math.max(12, Math.round(L.hullLen * height * RES))
  const H = Math.max(5, Math.round(L.hullH * height * RES))
  const p = partCanvas(Wd + 4, H + 4)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - H
  const r = kit.hull.ramp
  const d = kit.shade.ramp
  const a = kit.accent

  // Silhouette: the glacis is the whole read of a tank from the side, so it
  // gets a long slope and the back gets a short one.
  p.poly(
    [
      [cx - Wd * 0.5, bot],
      [cx - Wd * 0.5, top + H * 0.42],
      [cx - Wd * 0.4, top],
      [cx + Wd * 0.2, top],
      [cx + Wd * 0.5, top + H * 0.52],
      [cx + Wd * 0.5, bot]
    ],
    r[2]
  )
  // Hard highlight along the deck, shadow under the belly, lit glacis face.
  p.fill(cx - Math.round(Wd * 0.4), top, Math.round(Wd * 0.6), 1, r[4])
  p.line(cx + Wd * 0.2, top, cx + Wd * 0.5, top + H * 0.52, r[3])
  p.line(cx - Wd * 0.5, top + H * 0.42, cx - Wd * 0.4, top, r[1])
  p.fill(cx - Math.round(Wd * 0.5), bot - 1, Wd, 1, r[0])

  // Engine deck: louvres aft, where the exhaust is.
  louvres(p, cx - Math.round(Wd * 0.44), top + 1, Wd * 0.2, Math.max(2, H * 0.36), d)
  // Driver's hatch on the glacis, and a vision block.
  chamfer(p, cx + Wd * 0.22, top + 1, Math.max(2, Wd * 0.1), Math.max(2, H * 0.3), r)
  p.set(Math.round(cx + Wd * 0.3), Math.round(top + 2), kit.glass[3])
  // Plate seams and rivets along the sponson.
  seamV(p, cx + Math.round(Wd * 0.04), top + 1, H * 0.7, r)
  rivetRow(p, cx - Wd * 0.34, top + Math.round(H * 0.48), Wd * 0.62, 5, r)
  // Stowage box and a tow shackle at the back.
  box(p, cx - Wd * 0.48, top + H * 0.44, Math.max(3, Wd * 0.14), Math.max(2, H * 0.3), d)
  p.set(Math.round(cx + Wd * 0.46), Math.round(top + H * 0.72), d[1])
  // Fender lip over the running gear, with its own contact shadow.
  p.fill(cx - Math.round(Wd * 0.5), bot - Math.round(H * 0.2), Wd, 1, r[3])
  contactShadow(p, cx - Wd * 0.5, bot - Math.round(H * 0.2) + 1, Wd, r)
  // Faction stripe, on the flank where a number would go.
  trim(p, cx - Wd * 0.16, top + Math.round(H * 0.62), Wd * 0.18, a)
  if (v.chassis === 'hover') {
    // No running gear at all: a lit skirt and the ground glow under it.
    p.fill(cx - Wd * 0.46, bot - 1, Math.round(Wd * 0.92), 1, a[4])
    for (let x = 0; x < Wd * 0.9; x += 3) p.set(Math.round(cx - Wd * 0.45 + x), bot, a[2])
  }

  return { canvas: sealPart(p, v.metal), origin: originAt(p, cx, bot) }
}

/** The turret: mantlet forward, cupola on top, stowage basket at the back. */
function drawTurret(v: UnitVisual, kit: Kit, L: VehicleLayout, height: number): PartArt {
  const Wd = Math.max(8, Math.round(L.hullLen * 0.46 * height * RES))
  const H = Math.max(4, Math.round(L.turretH * height * RES))
  const p = partCanvas(Wd + 6, H + 5)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - H
  const r = kit.hull.ramp
  const d = kit.shade.ramp
  const a = kit.accent

  // A wedge, front-heavy, with the mantlet as the leading face.
  p.poly(
    [
      [cx - Wd * 0.5, bot],
      [cx - Wd * 0.42, top + H * 0.3],
      [cx - Wd * 0.1, top],
      [cx + Wd * 0.3, top],
      [cx + Wd * 0.5, top + H * 0.46],
      [cx + Wd * 0.5, bot]
    ],
    r[2]
  )
  p.fill(cx - Math.round(Wd * 0.1), top, Math.round(Wd * 0.4), 1, r[4])
  p.line(cx - Wd * 0.42, top + H * 0.3, cx - Wd * 0.1, top, r[3])
  p.line(cx - Wd * 0.5, bot, cx - Wd * 0.42, top + H * 0.3, r[1])
  p.fill(cx - Math.round(Wd * 0.5), bot - 1, Wd, 1, r[1])

  // Mantlet: a raised block around the trunnion, so the barrel comes out of
  // something instead of out of a flat wall.
  box(p, cx + Wd * 0.3, top + H * 0.34, Math.max(2, Wd * 0.2), Math.max(3, H * 0.5), r)
  contactShadow(p, cx + Wd * 0.3, top + H * 0.34 + Math.max(3, H * 0.5), Wd * 0.2, r)
  // Commander's cupola with a periscope.
  const cupW = Math.max(2, Math.round(Wd * 0.16))
  box(p, cx - Wd * 0.06, top - Math.max(1, H * 0.24), cupW, Math.max(1, Math.round(H * 0.26)), r)
  p.set(Math.round(cx - Wd * 0.06 + cupW - 1), Math.round(top - H * 0.24), kit.glass[4])
  // Smoke dischargers, stowage basket, faction chevron.
  p.fill(cx + Wd * 0.06, top + 1, 1, Math.max(1, Math.round(H * 0.2)), d[1])
  p.fill(cx + Wd * 0.12, top + 1, 1, Math.max(1, Math.round(H * 0.2)), d[1])
  box(p, cx - Wd * 0.48, top + H * 0.44, Math.max(2, Wd * 0.16), Math.max(2, H * 0.36), d)
  rivetRow(p, cx - Wd * 0.3, top + Math.round(H * 0.42), Wd * 0.5, 4, r)
  trim(p, cx - Wd * 0.34, top + Math.round(H * 0.66), Wd * 0.2, a)

  return { canvas: sealPart(p, v.metal), origin: originAt(p, cx, bot) }
}

/**
 * A gun barrel, authored pointing **right** with its origin at the trunnion,
 * which is the point it elevates about and the point the recoil slides along.
 */
function drawGunBarrel(v: UnitVisual, kit: Kit, lengthPx: number, thickPx: number): PartArt {
  const L = Math.max(8, Math.round(lengthPx * RES))
  const T = Math.max(2, Math.round(thickPx * RES))
  const p = partCanvas(L + 4, T * 2 + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD
  const r = kit.hull.ramp
  const d = kit.iron.ramp

  // A tapering tube: thick at the breech, thin at the muzzle.
  for (let i = 0; i < L; i += 1) {
    const t = i / L
    const th = Math.max(2, Math.round(T * (1.5 - t * 0.55)))
    const y = cy - (th >> 1)
    p.fill(x0 + i, y, 1, th, d[2])
    p.set(x0 + i, y, d[3])
    p.set(x0 + i, y + th - 1, d[1])
  }
  // Breech block and trunnion collar.
  box(p, x0, cy - T, Math.max(2, Math.round(L * 0.14)), T * 2, r)
  // Fume extractor: the bulge that says "this is a tank gun".
  const fx = x0 + Math.round(L * 0.46)
  box(p, fx, cy - T * 0.95, Math.max(2, Math.round(L * 0.1)), Math.round(T * 1.9), r)
  // Muzzle brake.
  const mx = x0 + L - Math.max(2, Math.round(T * 1.2))
  box(p, mx, cy - T, Math.max(2, Math.round(T * 1.2)), T * 2, r)
  p.fill(mx, cy - 1, Math.max(2, Math.round(T * 1.2)), 1, d[0])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, x0, cy) }
}

/**
 * The timber carriage every wheeled war machine sits on: a trail that runs back
 * to a spade, a cross brace, iron strapping and the axle boss.
 *
 * Drawn upright with the origin on the drawn bottom edge, at axle height, so
 * the wheels sit through it rather than under it.
 */
function drawCarriage(kit: Kit, L: VehicleLayout, height: number): PartArt {
  const Wd = Math.max(12, Math.round(L.hullLen * height * RES))
  const H = Math.max(5, Math.round(L.hullH * height * RES))
  const p = partCanvas(Wd + 4, H + 6)
  const cx = Math.round(p.w / 2)
  const bot = p.h - PAD
  const top = bot - H
  const wood = kit.timber.ramp
  const iron = kit.iron.ramp
  const a = kit.accent

  // The trail: a long beam that rises toward the axle and tapers to a spade.
  p.poly(
    [
      [cx - Wd * 0.5, bot],
      [cx - Wd * 0.46, bot - H * 0.3],
      [cx + Wd * 0.24, top + H * 0.1],
      [cx + Wd * 0.46, top + H * 0.1],
      [cx + Wd * 0.46, top + H * 0.6],
      [cx - Wd * 0.36, bot]
    ],
    wood[2]
  )
  // Lit upper edge of the beam, shadow beneath it.
  p.line(cx - Wd * 0.46, bot - H * 0.3, cx + Wd * 0.24, top + H * 0.1, wood[3])
  p.line(cx - Wd * 0.5, bot, cx - Wd * 0.36, bot, wood[0])
  // Cheeks: the upright timbers the trunnions bolt through.
  const cheekW = Math.max(2, Math.round(Wd * 0.1))
  box(p, cx + Wd * 0.06, top, cheekW, Math.max(3, Math.round(H * 0.8)), wood)
  box(p, cx - Wd * 0.14, top + H * 0.2, cheekW, Math.max(3, Math.round(H * 0.6)), wood)
  // Iron strapping across both, and the bolts through it.
  p.fill(cx - Math.round(Wd * 0.16), top + Math.round(H * 0.5), Math.round(Wd * 0.32), 1, iron[1])
  rivetRow(p, cx - Wd * 0.14, top + Math.round(H * 0.5), Wd * 0.28, 3, iron)
  // Axle boss, dead centre, where the wheels hang.
  orb(p, cx + Wd * 0.04, bot - H * 0.34, Math.max(2, Wd * 0.06), Math.max(2, H * 0.18), iron)
  // Spade at the back of the trail, dug in.
  box(p, cx - Wd * 0.52, bot - Math.max(2, H * 0.26), Math.max(2, Wd * 0.08), Math.max(2, H * 0.26), iron)

  if (L.machine === 'catapult') {
    // Torsion bundle and the windlass the arm is winched down with.
    orb(p, cx - Wd * 0.02, top + H * 0.34, Math.max(2, Wd * 0.09), Math.max(2, H * 0.26), ramp(0xb9a37a))
    orb(p, cx - Wd * 0.3, bot - H * 0.42, Math.max(2, Wd * 0.06), Math.max(2, H * 0.2), iron)
    p.line(cx - Wd * 0.3, bot - H * 0.5, cx + Wd * 0.02, top + H * 0.2, iron[3])
  } else if (L.machine === 'mortar') {
    // A baseplate, because a mortar drives its recoil into the ground.
    box(p, cx - Wd * 0.24, bot - Math.max(2, H * 0.22), Math.max(4, Wd * 0.4), Math.max(2, H * 0.22), iron)
  } else {
    // A ready round and its rack.
    box(p, cx - Wd * 0.3, top + H * 0.44, Math.max(3, Wd * 0.12), Math.max(2, H * 0.24), iron)
    p.set(Math.round(cx - Wd * 0.26), Math.round(top + H * 0.46), a[3])
  }
  trim(p, cx - Wd * 0.44, bot - Math.round(H * 0.16), Wd * 0.12, a)

  return { canvas: sealPart(p, 0x7a5433), origin: originAt(p, cx, bot) }
}

/**
 * The catapult's throwing arm: a tapering beam with a sling bucket at the tip,
 * authored pointing right from its pivot so the attack clip can simply rotate
 * it over the top.
 */
function drawThrowArm(kit: Kit, lengthPx: number, thickPx: number): PartArt {
  const L = Math.max(8, Math.round(lengthPx * RES))
  const T = Math.max(2, Math.round(thickPx * RES))
  const p = partCanvas(L + T * 2 + 4, T * 3 + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD
  const wood = kit.timber.ramp
  const iron = kit.iron.ramp

  // The beam, tapering toward the throwing end.
  for (let i = 0; i < L; i += 1) {
    const t = i / L
    const th = Math.max(2, Math.round(T * (1.2 - t * 0.45)))
    const y = cy - (th >> 1)
    p.fill(x0 + i, y, 1, th, wood[2])
    p.set(x0 + i, y, wood[3])
    p.set(x0 + i, y + th - 1, wood[1])
  }
  // Iron bands where the beam is under most strain.
  p.fill(x0 + Math.round(L * 0.2), cy - T * 0.7, 1, Math.max(2, Math.round(T * 1.4)), iron[1])
  p.fill(x0 + Math.round(L * 0.55), cy - T * 0.6, 1, Math.max(2, Math.round(T * 1.2)), iron[1])
  // The pivot boss.
  orb(p, x0 + 1, cy, T * 0.9, T * 0.9, iron)
  // The bucket, and the stone in it.
  const bx = x0 + L
  p.poly(
    [
      [bx - T, cy - T * 1.6],
      [bx + T * 1.4, cy - T * 1.4],
      [bx + T * 1.1, cy + T * 0.4],
      [bx - T * 0.6, cy + T * 0.2]
    ],
    wood[1]
  )
  orb(p, bx + T * 0.3, cy - T * 0.5, T * 0.8, T * 0.8, ramp(0x8d8d92, { contrast: 0.9 }))

  return { canvas: sealPart(p, 0x7a5433), origin: originAt(p, x0, cy) }
}

/**
 * The mortar tube: short, fat and reinforced, with a heavy breech at the pivot
 * so the mass sits where the recoil is taken.
 */
function drawMortarTube(v: UnitVisual, kit: Kit, lengthPx: number, thickPx: number): PartArt {
  const L = Math.max(6, Math.round(lengthPx * RES))
  const T = Math.max(3, Math.round(thickPx * RES))
  const p = partCanvas(L + 4, T * 2 + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD
  const r = kit.hull.ramp
  const d = kit.iron.ramp

  box(p, x0, cy - T * 0.8, L, Math.round(T * 1.6), d)
  p.fill(x0, Math.round(cy - T * 0.8), L, 1, d[3])
  p.fill(x0, Math.round(cy + T * 0.8) - 1, L, 1, d[0])
  // Reinforcing bands.
  for (let i = 1; i < 4; i += 1) {
    const x = x0 + Math.round((L * i) / 4)
    p.fill(x, cy - T * 0.95, 1, Math.round(T * 1.9), r[1])
    p.set(x + 1, Math.round(cy - T * 0.95), r[3])
  }
  // Breech ball at the pivot, muzzle flare at the tip.
  orb(p, x0 + 1, cy, T * 1.05, T * 1.05, r)
  box(p, x0 + L - 2, cy - T, 2, T * 2, r)
  p.fill(x0 + L - 2, cy - 1, 2, 2, d[0])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, x0, cy) }
}

/** A muzzle-loading cannon barrel: cast, banded, with a cascabel at the breech. */
function drawCannonBarrel(v: UnitVisual, kit: Kit, lengthPx: number, thickPx: number): PartArt {
  const L = Math.max(8, Math.round(lengthPx * RES))
  const T = Math.max(2, Math.round(thickPx * RES))
  const p = partCanvas(L + 5, T * 2.6 + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD + 1
  const bronze = ramp(tone(v.metal, 0.06), { contrast: 1.3, hueShift: 0.05 })
  const iron = kit.iron.ramp

  // The taper from breech to muzzle is the whole character of a cannon.
  for (let i = 0; i < L; i += 1) {
    const t = i / L
    const th = Math.max(2, Math.round(T * (1.8 - t * 0.7)))
    const y = cy - (th >> 1)
    p.fill(x0 + i, y, 1, th, bronze[2])
    p.set(x0 + i, y, bronze[4])
    p.set(x0 + i, y + th - 1, bronze[1])
  }
  // Reinforcing rings at breech, chase and muzzle.
  for (const at of [0.08, 0.46, 0.94]) {
    const x = x0 + Math.round(L * at)
    const th = Math.max(3, Math.round(T * (2 - at * 0.6)))
    p.fill(x, cy - (th >> 1), 1, th, bronze[1])
    p.fill(x + 1, cy - (th >> 1), 1, th, bronze[3])
  }
  // Cascabel knob behind the breech, and the trunnion under the chase.
  orb(p, x0 - 1, cy, T * 0.7, T * 0.7, bronze)
  orb(p, x0 + Math.round(L * 0.34), cy + T * 0.9, T * 0.5, T * 0.5, iron)
  // Bore.
  p.fill(x0 + L - 1, cy - Math.max(1, T * 0.4), 1, Math.max(1, Math.round(T * 0.8)), iron[0])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, x0 + Math.round(L * 0.34), cy) }
}

function buildVehicleParts(v: UnitVisual, height: number, L: VehicleLayout): Record<string, PartArt> {
  const kit = kitFor(v)
  const px = (f: number) => f * height
  const parts: Record<string, PartArt> = {}

  parts.hull = L.machine ? drawCarriage(kit, L, height) : drawTankHull(v, kit, L, height)
  if (L.tracked) parts.track = drawTrackBelt(px(L.hullLen * 1.02), px(L.trackH), kit)
  if (L.turret) parts.turret = drawTurret(v, kit, L, height)

  parts.barrel =
    L.machine === 'catapult'
      ? drawThrowArm(kit, px(L.barrelLen), px(L.barrelThick))
      : L.machine === 'mortar'
        ? drawMortarTube(v, kit, px(L.barrelLen), px(L.barrelThick))
        : L.machine === 'cannon'
          ? drawCannonBarrel(v, kit, px(L.barrelLen), px(L.barrelThick))
          : drawGunBarrel(v, kit, px(L.barrelLen), px(L.barrelThick))

  // Every wheel is its own part, because every wheel is its own bone: they
  // spin together but they do not bounce together.
  for (const w of L.rollers) {
    parts[w.name] =
      w.kind === 'spoke'
        ? drawSpokedWheel(px(w.radius), kit, w.shaded)
        : w.kind === 'sprocket'
          ? drawSprocket(px(w.radius), kit)
          : drawRoadWheel(px(w.radius), kit, w.shaded)
  }

  return parts
}

export const vehicleArchetype: Archetype = {
  id: 'vehicle',
  claims: v => v.kind === 'vehicle',
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const L = layoutFor(v)
    const clips: Record<ClipName, Clip> = {
      idle: vehicleIdle(L),
      walk: vehicleWalk(L),
      attack: vehicleAttack(L)
    }
    // Muzzle: out from the trunnion along the barrel's rest angle.
    const pivotY = (L.turret ? L.hullY - L.hullH - L.turretH : L.hullY - L.hullH) + L.barrelUp
    const pivotX = L.barrelFwd + (L.turret ? L.turretX : 0)
    return {
      skeleton: buildVehicleSkeleton(L),
      parts: buildVehicleParts(v, height, L),
      clips,
      height,
      muzzle: [
        pivotX + Math.cos(L.barrelRest) * L.barrelLen,
        pivotY + Math.sin(L.barrelRest) * L.barrelLen
      ]
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
//                                 THE FLYER
// ══════════════════════════════════════════════════════════════════════════

/**
 * Proportions of an aircraft, as fractions of unit height.
 *
 * An air unit's rig origin is its centre of mass rather than the ground, since
 * the battlefield places flyers at altitude — so these numbers straddle zero.
 */
const F = {
  bodyLen: 0.62,
  bodyH: 0.3,
  rotorSpan: 0.72,
  rotorUp: -0.3,
  rotorFwd: 0.02,
  tailFwd: -0.56,
  tailUp: -0.1,
  gunFwd: 0.3,
  gunDown: 0.1,
  gunLen: 0.22
}

/**
 * The flyer skeleton — 6 bones.
 *
 * The fuselage is authored pointing **right**, so its bone angle *is* the bank
 * angle: everything else hangs off it and inherits the attitude for free. The
 * `lean` additive is fed a constant while a unit is moving, which on a
 * helicopter is exactly right — a helicopter goes forward by pitching down.
 */
function buildFlyerSkeleton(chassis: UnitVisual['chassis']): Skeleton {
  const rotary = chassis === 'rotor'
  const quad = chassis === 'quad'
  const s: Skeleton = [
    bone('root', null, { y: -0.02, depth: 30 }),
    bone('body', 'root', {
      part: 'body',
      orient: 'right',
      depth: 30,
      weights: { lean: 1, flinch: 1, breathe: 0.4 }
    })
  ]

  if (rotary) {
    // The main rotor is a blur disc seen edge-on: it must *not* be rotated, or
    // the disc plane tips over with it. What it does instead is cone and flap,
    // which is what a loaded rotor actually does.
    s.push(bone('rotor', 'body', { x: F.rotorFwd, y: F.rotorUp, part: 'rotor', orient: 'right', depth: 60 }))
    // The tail rotor, though, is seen face-on — so that one really does spin.
    s.push(bone('tailRotor', 'body', { x: F.tailFwd, y: F.tailUp, part: 'tailRotor', orient: 'right', depth: 12 }))
  } else if (quad) {
    s.push(bone('rotorF', 'body', { x: 0.34, y: -0.16, part: 'rotorF', orient: 'right', depth: 60 }))
    s.push(bone('rotorB', 'body', { x: -0.34, y: -0.16, part: 'rotorB', orient: 'right', depth: 12 }))
  } else {
    // Hover: lift comes out of two gimballed thrusters, which tilt to translate.
    s.push(bone('thrusterF', 'body', { x: 0.26, y: 0.12, part: 'thrusterF', orient: 'right', depth: 34 }))
    s.push(bone('thrusterB', 'body', { x: -0.3, y: 0.12, part: 'thrusterB', orient: 'right', depth: 14 }))
  }

  s.push(bone('gunMount', 'body', { x: F.gunFwd, y: F.gunDown, weights: { aim: 1 }, depth: 55 }))
  s.push(bone('gun', 'gunMount', { part: 'gun', orient: 'right', depth: 55, weights: { recoil: 1 } }))

  validateSkeleton(s, 'flyer')
  return s
}

/**
 * Hover: the machine holds station badly, which is the only way to hold it.
 *
 * A helicopter at the hover is never still — it rises and sinks a few feet on
 * its own downwash and the nose wanders. Linear easing throughout with six
 * keys, so the tail rotor spins at a constant rate; an eased spin stutters
 * twice a cycle and gives the whole trick away.
 */
const FLYER_IDLE: Clip = {
  name: 'idle',
  duration: 2000,
  loop: true,
  ease: 'linear',
  keys: [
    { t: 0, pose: { root: { y: 0 }, body: { angle: 0 }, tailRotor: { angle: 0 }, rotor: { y: 0 } } },
    { t: 0.25, pose: { root: { y: -0.024 }, body: { angle: -0.02 }, tailRotor: { angle: TAU }, rotor: { y: -0.004 } } },
    { t: 0.5, pose: { root: { y: -0.03 }, body: { angle: 0.01 }, tailRotor: { angle: TAU * 2 }, rotor: { y: 0.003 } } },
    { t: 0.75, pose: { root: { y: -0.012 }, body: { angle: 0.02 }, tailRotor: { angle: TAU * 3 }, rotor: { y: -0.002 } } },
    { t: 1, pose: { root: { y: 0 }, body: { angle: 0 }, tailRotor: { angle: TAU * 4 }, rotor: { y: 0 } } }
  ]
}

/**
 * Forward flight.
 *
 * The bank is the whole thing: the nose drops, the tail comes up, and the
 * airframe holds that attitude while riding the gust cycle. The rotor flaps
 * harder than at the hover because it is working harder.
 *
 * As in the idle, the last key sits at exactly t = 1 holding a whole number of
 * tail-rotor turns, so the loop seam is invisible.
 */
const FLYER_WALK: Clip = {
  name: 'walk',
  duration: 800,
  loop: true,
  ease: 'linear',
  keys: [
    { t: 0, pose: { root: { y: 0 }, body: { angle: 0.08 }, tailRotor: { angle: 0 }, rotor: { y: -0.006 } } },
    { t: 0.25, pose: { root: { y: -0.016 }, body: { angle: 0.1 }, tailRotor: { angle: TAU * 1.5 }, rotor: { y: -0.01 } } },
    { t: 0.5, pose: { root: { y: -0.02 }, body: { angle: 0.07 }, tailRotor: { angle: TAU * 3 }, rotor: { y: -0.004 } } },
    { t: 0.75, pose: { root: { y: -0.008 }, body: { angle: 0.09 }, tailRotor: { angle: TAU * 4.5 }, rotor: { y: -0.009 } } },
    { t: 1, pose: { root: { y: 0 }, body: { angle: 0.08 }, tailRotor: { angle: TAU * 6 }, rotor: { y: -0.006 } } }
  ]
}

/**
 * A gun run: nose down onto the target, fire, and pull up off it.
 *
 * The recoil goes into the airframe rather than into the ground, so the whole
 * machine is pushed back and up — which on an aircraft reads far more strongly
 * than any amount of muzzle flash.
 */
const FLYER_ATTACK: Clip = {
  name: 'attack',
  duration: 520,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: {} },
    // Roll in.
    { t: 0.32, pose: { body: { angle: 0.16 }, root: { y: 0.01 } }, ease: 'cubic' },
    {
      // Firing: the gun runs back along its mount and the nose is kicked up.
      t: 0.44,
      pose: { body: { angle: 0.04 }, root: { y: -0.014, x: -0.012 }, gun: { x: -0.03 } },
      ease: 'hold'
    },
    { t: 0.66, pose: { body: { angle: -0.06 }, root: { y: -0.02 }, gun: { x: -0.008 } }, ease: 'back' },
    { t: 1, pose: {}, ease: 'sine' }
  ]
}

// ─────────────────────────────── Flyer parts ───────────────────────────────

/**
 * The airframe: a flat-bottomed fuselage with a chined spine, a canopy set into
 * it, a tail boom and a fin. Authored pointing right, origin at the centre of
 * mass, so the bone angle reads directly as pitch.
 *
 * The straight bottom line is doing most of the work. It is the single mark
 * that makes an aircraft look engineered rather than organic, so nothing is
 * allowed to break it except the skids and the gun.
 */
function drawFuselage(v: UnitVisual, kit: Kit, height: number): PartArt {
  const bulk = v.bulk ?? 1
  const Wd = Math.max(12, Math.round(F.bodyLen * bulk * height * RES))
  const H = Math.max(6, Math.round(F.bodyH * height * RES))
  const rotary = v.chassis === 'rotor'
  const p = partCanvas(Wd * 2.1, H * 3)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const nose = cx + Wd
  const tail = cx - Wd
  const belly = cy + Math.round(H * 0.5)
  const r = kit.hull.ramp
  const d = kit.shade.ramp
  const a = kit.accent

  // Fuselage.
  p.poly(
    [
      [tail + Wd * 0.2, cy - H * 0.1],
      [tail + Wd * 0.44, cy - H * 0.62],
      [cx + Wd * 0.2, cy - H * 0.72],
      [nose - Wd * 0.08, cy - H * 0.3],
      [nose, cy + H * 0.05],
      [nose - Wd * 0.18, belly],
      [tail + Wd * 0.26, belly],
      [tail + Wd * 0.16, cy + H * 0.2]
    ],
    r[2]
  )
  // Tail boom, thin, running back to the fin.
  p.fill(tail + Wd * 0.05, cy - H * 0.22, Math.round(Wd * 0.4), Math.max(2, Math.round(H * 0.28)), r[2])
  p.fill(tail + Wd * 0.05, Math.round(cy - H * 0.22), Math.round(Wd * 0.4), 1, r[3])
  p.fill(tail + Wd * 0.05, Math.round(cy + H * 0.06), Math.round(Wd * 0.4), 1, r[1])

  // Lit spine and shadowed belly — the two lines that give it volume.
  p.line(tail + Wd * 0.44, cy - H * 0.62, cx + Wd * 0.2, cy - H * 0.72, r[4])
  p.line(cx + Wd * 0.2, cy - H * 0.72, nose - Wd * 0.08, cy - H * 0.3, r[3])
  p.fill(tail + Math.round(Wd * 0.26), belly - 1, Math.round(Wd * 1.5), 1, r[0])
  // Panel seam along the flank, and rivets down it.
  seamH(p, tail + Wd * 0.5, cy + Math.round(H * 0.06), Wd * 1.2, r)
  rivetRow(p, tail + Wd * 0.6, cy - Math.round(H * 0.3), Wd * 0.9, 5, r)

  // Canopy, set into the spine.
  p.poly(
    [
      [cx + Wd * 0.16, cy - H * 0.7],
      [cx + Wd * 0.66, cy - H * 0.52],
      [cx + Wd * 0.72, cy - H * 0.1],
      [cx + Wd * 0.14, cy - H * 0.24]
    ],
    kit.glass[2]
  )
  p.line(cx + Wd * 0.16, cy - H * 0.7, cx + Wd * 0.66, cy - H * 0.52, kit.glass[4])
  p.line(cx + Wd * 0.4, cy - H * 0.61, cx + Wd * 0.44, cy - H * 0.17, kit.glass[1])
  p.set(Math.round(cx + Wd * 0.6), Math.round(cy - H * 0.4), kit.glass[4])

  // Fin and stabiliser.
  p.poly(
    [
      [tail + Wd * 0.08, cy - H * 0.2],
      [tail + Wd * 0.02, cy - H * 1.1],
      [tail + Wd * 0.3, cy - H * 1.0],
      [tail + Wd * 0.34, cy - H * 0.16]
    ],
    r[2]
  )
  p.line(tail + Wd * 0.02, cy - H * 1.1, tail + Wd * 0.3, cy - H * 1.0, r[4])
  p.fill(tail, Math.round(cy - H * 0.66), Math.max(3, Math.round(Wd * 0.24)), Math.max(1, Math.round(H * 0.1)), r[1])
  trim(p, tail + Wd * 0.08, Math.round(cy - H * 0.9), Wd * 0.18, a)

  if (rotary) {
    // Rotor mast and gearbox fairing, so the disc has something to sit on.
    box(p, cx + Wd * 0.02, cy - H * 1.0, Math.max(2, Math.round(Wd * 0.12)), Math.max(3, Math.round(H * 0.34)), d)
    orb(p, cx + Wd * 0.08, cy - H * 0.78, Wd * 0.12, H * 0.16, r)
    // Stub wing with a rocket pod under it.
    p.poly(
      [
        [cx - Wd * 0.3, cy + H * 0.12],
        [cx + Wd * 0.24, cy + H * 0.16],
        [cx + Wd * 0.1, belly - 1],
        [cx - Wd * 0.42, belly - 1]
      ],
      d[2]
    )
    const podW = Math.max(4, Math.round(Wd * 0.34))
    box(p, cx - Wd * 0.34, belly, podW, Math.max(3, Math.round(H * 0.22)), d)
    p.fill(cx - Math.round(Wd * 0.34), belly, podW, 1, d[3])
    for (let i = 0; i < 3; i += 1) {
      p.set(Math.round(cx - Wd * 0.34 + podW - 1), Math.round(belly + 1 + i), a[3])
    }
    // Skids: two struts and a rail, which is what keeps the belly line honest.
    const skidY = belly + Math.round(H * 0.42)
    p.fill(cx - Math.round(Wd * 0.5), skidY, Math.round(Wd * 1.1), 1, d[1])
    p.fill(cx - Math.round(Wd * 0.32), belly, 1, skidY - belly, d[1])
    p.fill(cx + Math.round(Wd * 0.4), belly, 1, skidY - belly, d[1])
    p.set(Math.round(cx + Wd * 0.6), skidY, 0, 0)
  } else {
    // Fixed-wing or lifter: a swept wing seen edge-on and a stores pylon.
    p.poly(
      [
        [cx - Wd * 0.44, cy + H * 0.1],
        [cx + Wd * 0.3, cy + H * 0.14],
        [cx + Wd * 0.1, cy + H * 0.36],
        [cx - Wd * 0.62, cy + H * 0.32]
      ],
      d[2]
    )
    p.line(cx - Wd * 0.44, cy + H * 0.1, cx + Wd * 0.3, cy + H * 0.14, r[3])
    box(p, cx - Wd * 0.3, belly, Math.max(4, Math.round(Wd * 0.4)), Math.max(2, Math.round(H * 0.2)), d)
  }

  // Exhaust glow aft and a nav light forward.
  emissive(p, tail + Wd * 0.36, cy - H * 0.06, Wd * 0.08, H * 0.1, a)
  p.set(Math.round(nose - Wd * 0.12), Math.round(cy - H * 0.12), a[4])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, cx, cy) }
}

/**
 * The main rotor, drawn as motion blur.
 *
 * The old art was a single dark bar that got squashed on its Y axis to fake a
 * spin, which strobes and reads as a windscreen wiper. What a rotor actually
 * looks like is a translucent disc with the blade nearest the eye dark and its
 * predecessors fading behind it — so that is what is drawn: a swept fan of
 * ghosted blades at falling alpha around a shallow ellipse, plus the two
 * blades currently caught by the light.
 *
 * Deliberately **not** sealed with an outline. An outline around a motion blur
 * turns it straight back into a solid object.
 */
function drawRotorDisc(kit: Kit, spanPx: number, blades: number): PartArt {
  const S = Math.max(8, Math.round(spanPx * RES))
  const tilt = Math.max(2, Math.round(S * 0.11))
  const p = new Pix(S * 2 + 6, tilt * 2 + 8)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const d = kit.iron.ramp

  // The disc itself: the faintest wash, so the sweep has a volume.
  p.ellipse(cx, cy, S, tilt, d[2], 26)
  p.ellipse(cx, cy - 1, S * 0.96, tilt * 0.7, d[3], 18)

  // Ghost blades. Each is a chord of the disc at its own azimuth; the alpha
  // falls away behind the leading blade, which is what makes the sweep read as
  // a direction rather than as a smear.
  for (let i = 0; i < blades; i += 1) {
    const t = i / blades
    const az = -0.9 - t * 2.1
    const alpha = Math.round(210 * Math.pow(1 - t, 1.6)) + 18
    const x0 = cx + Math.cos(az) * S
    const y0 = cy + Math.sin(az) * tilt
    const x1 = cx - Math.cos(az) * S
    const y1 = cy - Math.sin(az) * tilt
    p.line(x0, y0, x1, y1, i === 0 ? d[1] : d[2], alpha)
  }
  // The leading blade, solid, with a lit upper edge.
  p.line(cx - S, cy + tilt * 0.2, cx + S, cy - tilt * 0.2, d[1])
  p.line(cx - S, cy + tilt * 0.2 - 1, cx + S, cy - tilt * 0.2 - 1, d[3], 150)
  // Blade tip markers, the way real rotors are painted so the crew can see them.
  p.set(cx - S + 1, Math.round(cy + tilt * 0.2), kit.accent[4])
  p.set(cx + S - 1, Math.round(cy - tilt * 0.2), kit.accent[4])
  // Hub and swashplate.
  orb(p, cx, cy, Math.max(1.5, S * 0.06), Math.max(1.5, S * 0.06), kit.hull.ramp)

  return { canvas: raw(p), origin: originAt(p, cx, cy) }
}

/**
 * The tail rotor: the same blur trick, but seen face-on, so it is a full disc
 * and it genuinely does rotate — the clips spin this one.
 */
function drawTailRotor(kit: Kit, radiusPx: number): PartArt {
  const R = Math.max(3, Math.round(radiusPx * RES))
  const p = new Pix(R * 2 + 4, R * 2 + 4)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const d = kit.iron.ramp

  p.ellipse(cx, cy, R, R, d[2], 30)
  for (let i = 0; i < 5; i += 1) {
    const az = -0.4 - i * 0.5
    const alpha = Math.round(190 * Math.pow(1 - i / 5, 1.5)) + 20
    p.line(cx, cy, cx + Math.cos(az) * R, cy + Math.sin(az) * R, d[1], alpha)
    p.line(cx, cy, cx - Math.cos(az) * R, cy - Math.sin(az) * R, d[1], alpha)
  }
  orb(p, cx, cy, Math.max(1, R * 0.2), Math.max(1, R * 0.2), kit.hull.ramp)

  return { canvas: raw(p), origin: originAt(p, cx, cy) }
}

/** A lift thruster for a hover chassis: a shrouded fan over a glowing cone. */
function drawThruster(kit: Kit, sizePx: number, shaded: boolean): PartArt {
  const S = Math.max(4, Math.round(sizePx * RES))
  const p = partCanvas(S * 2 + 3, S * 2 + 3)
  const cx = Math.round(p.w / 2)
  const cy = Math.round(p.h / 2)
  const r = shaded ? kit.shade.ramp : kit.hull.ramp
  const a = kit.accent

  // Housing.
  chamfer(p, cx - S, cy - S * 0.6, S * 2, Math.round(S * 1.1), r)
  p.fill(cx - S, Math.round(cy - S * 0.6), S * 2, 1, r[4])
  rivetRow(p, cx - S * 0.8, Math.round(cy - S * 0.5), S * 1.6, 3, r)
  // Intake shadow and the efflux beneath it, fading down.
  contactShadow(p, cx - S * 0.8, cy + S * 0.5, S * 1.6, r)
  for (let i = 0; i < Math.round(S * 0.9); i += 1) {
    const w = Math.max(1, Math.round(S * 1.5 - i * 0.9))
    p.fill(cx - (w >> 1), cy + S * 0.5 + i, w, 1, i < 2 ? a[4] : a[3], 200 - i * 40)
  }

  return { canvas: raw(p), origin: originAt(p, cx, cy) }
}

/** The nose gun: a short chin turret, authored pointing right from its mount. */
function drawNoseGun(v: UnitVisual, kit: Kit, lengthPx: number): PartArt {
  const L = Math.max(4, Math.round(lengthPx * RES))
  const T = Math.max(2, Math.round(L * 0.34))
  const p = partCanvas(L + 4, T * 2 + 4)
  const cy = Math.round(p.h / 2)
  const x0 = PAD
  const r = kit.hull.ramp
  const d = kit.iron.ramp

  // Turret cheek, then twin barrels — two thin lines read as a cannon far
  // better than one fat one at this size.
  orb(p, x0 + T * 0.6, cy, T * 0.9, T * 0.9, r)
  p.fill(x0 + T, cy - Math.max(1, Math.round(T * 0.5)), L - T, 1, d[3])
  p.fill(x0 + T, cy + Math.max(1, Math.round(T * 0.2)), L - T, 1, d[1])
  p.set(x0 + L - 1, cy - Math.max(1, Math.round(T * 0.5)), d[0])
  p.set(x0 + L - 1, cy + Math.max(1, Math.round(T * 0.2)), d[0])

  return { canvas: sealPart(p, v.metal), origin: originAt(p, x0, cy) }
}

function buildFlyerParts(v: UnitVisual, height: number): Record<string, PartArt> {
  const kit = kitFor(v)
  const bulk = v.bulk ?? 1
  const px = (f: number) => f * height
  const parts: Record<string, PartArt> = {
    body: drawFuselage(v, kit, height),
    gun: drawNoseGun(v, kit, px(F.gunLen))
  }

  if (v.chassis === 'rotor') {
    parts.rotor = drawRotorDisc(kit, px(F.rotorSpan) * bulk, 7)
    parts.tailRotor = drawTailRotor(kit, px(0.11))
  } else if (v.chassis === 'quad') {
    // A quadcopter in side view shows two of its four discs, the far pair
    // darkened into the near pair's shadow.
    parts.rotorF = drawRotorDisc(kit, px(0.3) * bulk, 6)
    parts.rotorB = drawRotorDisc(kit, px(0.3) * bulk, 6)
  } else {
    parts.thrusterF = drawThruster(kit, px(0.12), false)
    parts.thrusterB = drawThruster(kit, px(0.12), true)
  }

  return parts
}

export const flyerArchetype: Archetype = {
  id: 'flyer',
  claims: v => v.kind === 'aircraft',
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const clips: Record<ClipName, Clip> = {
      idle: FLYER_IDLE,
      walk: FLYER_WALK,
      attack: FLYER_ATTACK
    }
    return {
      skeleton: buildFlyerSkeleton(v.chassis),
      parts: buildFlyerParts(v, height),
      clips,
      height,
      muzzle: [F.gunFwd + F.gunLen, F.gunDown - 0.02]
    }
  }
}
