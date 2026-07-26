import type { UnitVisual } from '../../data/types'
import {
  PAD,
  cloth as clothMat,
  foot as drawBoot,
  hand as drawHand,
  leather,
  limbSegment,
  metal as metalMat,
  orb,
  partCanvas,
  sealPart,
  skin as skinMat,
  type Material
} from '../anatomy'
import { RES, mix, ramp, tone } from '../pixel'
import { bone, validateSkeleton, type Clip, type Pose, type Skeleton } from '../rig'
import { drawCape, drawHead, drawShield, drawTorso, drawWeapon, type RigMetrics } from '../unitArt'
import type { Archetype, ArchetypeBuild, ClipName, PartArt } from './types'

/**
 * The quadrupeds: a mount with a rider on it, and a beast with nothing on it.
 *
 * Both are the same body plan — a barrel, a neck, a head, a tail and four legs
 * that each have a thigh, a shin and a foot — parameterised into two animals.
 * The mount is tall, short-backed and carries a footman-style upper body on its
 * spine. The beast is lower, longer and moves with its head down.
 *
 * ## What changed from the old rig
 *
 * The old cavalry rig was one static body canvas with four identical sticks
 * swinging from fixed points on it, all four on the same sine wave with a phase
 * offset. That is not a gait, it is a metronome: no knee, no hock, no push-off,
 * and a body that never left the ground. A horse at a gallop is almost entirely
 * *body* motion — it rises and falls through the stride, arches on the gather
 * and stretches on the extension, and its neck pumps in time with the forehand.
 * The legs are the last thing the eye reads, not the first.
 *
 * So here: four articulated legs, a barrel that pitches, a neck and head on
 * their own chain, and a real four-beat gallop with two moments of suspension.
 * The rider is hung on a `seat` pivot rather than welded to the spine, which is
 * what lets him post — absorbing the mount's bob a beat late instead of riding
 * it exactly, which is the difference between a rider and a hood ornament.
 *
 * ## Authoring convention
 *
 * Identical to `footman.ts`, and for the same reason. Every pivot — the four
 * hips, the withers, the poll, the tail dock, the rider's shoulders and hips —
 * carries the rest rotation, so that **the bone below it at local angle zero is
 * in its resting direction**. A leg at zero hangs straight down, so every leg
 * angle in the clips reads as "how far from hanging"; positive swings the limb
 * *backward*, because positive is clockwise and forward is screen-right. The
 * neck at zero points along its resting reach, so a positive neck angle lowers
 * it and a negative one tucks it up.
 */

// ─────────────────────────── Proportions ───────────────────────────

/**
 * A quadruped's measurements, all as fractions of the unit's height.
 *
 * Authored once per animal so that the same code draws a destrier and a
 * prowling beast without either of them being hand-tuned into a third species.
 * y is negative upward and the animal faces screen-right, so `foreHipX` is
 * positive and `tailX` is not.
 */
interface Quad {
  /** The barrel's centre. Everything on the animal hangs off this point. */
  coreY: number
  /** Croup to point-of-shoulder, and the girth. */
  bodyLen: number
  bodyDepth: number
  /** Where the legs leave the barrel, below its centre. */
  hipY: number
  hindHipX: number
  foreHipX: number
  /**
   * Thigh and shin. The foot has no bone length of its own — it is drawn
   * hanging off the shin's tip — so a leg reaches `thigh + shin + hoofH`, and
   * that has to equal the drop from the hip to the ground *in the standing
   * pose*, not with the leg straight. A hock at rest is bent, which shortens
   * the chain by a little under one percent, and a leg authored as though it
   * were straight leaves the animal hovering a couple of pixels off the floor.
   */
  hindThigh: number
  hindShin: number
  foreThigh: number
  foreShin: number
  /** The neck's root on the barrel, and the direction it rests in. */
  witherX: number
  witherY: number
  neckRest: number
  neckLen: number
  /** The poll: how far the head breaks from the line of the neck. */
  pollRest: number
  headLen: number
  tailX: number
  tailY: number
  tailRest: number
  tailLen: number
  // Drawn thicknesses. A horse's leg goes from a hand's breadth of haunch to a
  // cannon bone two pixels wide, and that violent taper is most of what makes
  // it read as a horse rather than a table.
  hindTopW: number
  hindMidW: number
  foreTopW: number
  foreMidW: number
  legBotW: number
  hoofLen: number
  hoofH: number
  neckBaseW: number
  neckTipW: number
  headW: number
  tailW: number
}

/** The mount: tall, short-coupled, with the withers high enough to sit behind. */
const MOUNT: Quad = {
  coreY: -0.52,
  bodyLen: 0.66,
  bodyDepth: 0.3,
  hipY: 0.1,
  hindHipX: -0.24,
  foreHipX: 0.22,
  // The hip sits 0.42 above the ground. The forelegs stand almost straight, so
  // 0.20 + 0.17 + 0.05 lands them on it exactly; the hind pair carries its
  // resting zigzag and is lengthened to 0.20 + 0.175 to pay for it.
  hindThigh: 0.2,
  hindShin: 0.175,
  foreThigh: 0.2,
  foreShin: 0.17,
  witherX: 0.23,
  witherY: -0.1,
  neckRest: -0.95,
  neckLen: 0.22,
  pollRest: 1.05,
  headLen: 0.2,
  tailX: -0.32,
  tailY: -0.085,
  tailRest: 0.4,
  tailLen: 0.22,
  hindTopW: 0.13,
  hindMidW: 0.07,
  foreTopW: 0.105,
  foreMidW: 0.058,
  legBotW: 0.038,
  hoofLen: 0.062,
  hoofH: 0.05,
  neckBaseW: 0.115,
  neckTipW: 0.072,
  headW: 0.098,
  tailW: 0.078
}

/** The beast: lower, longer, shoulders above the croup, and it carries nothing. */
const BEAST: Quad = {
  coreY: -0.6,
  bodyLen: 0.76,
  bodyDepth: 0.26,
  hipY: 0.09,
  hindHipX: -0.28,
  foreHipX: 0.28,
  // The hip sits 0.51 above the ground and the leg only has to *reach* 0.45 of
  // that, so both pairs are deliberately a fifth longer than they need to be.
  // A leg that exactly spans its own hip height can only stand: the moment it
  // swings forward it lifts off, which caps the stride at nothing. The surplus
  // is spent on a folded, crouched stance — which is also the pose a stalking
  // animal actually holds, so the geometry and the character want the same thing.
  hindThigh: 0.3,
  hindShin: 0.27,
  foreThigh: 0.29,
  foreShin: 0.26,
  witherX: 0.31,
  witherY: -0.11,
  // Down and forward, not up: the head belongs below the shoulder line on a
  // stalking animal, and that single angle does more for the read than any
  // amount of drawing on the head itself.
  neckRest: 0.22,
  neckLen: 0.22,
  pollRest: -0.08,
  headLen: 0.21,
  tailX: -0.36,
  tailY: -0.05,
  tailRest: 0.85,
  tailLen: 0.22,
  hindTopW: 0.155,
  hindMidW: 0.09,
  foreTopW: 0.135,
  foreMidW: 0.08,
  legBotW: 0.052,
  hoofLen: 0.075,
  hoofH: 0.06,
  neckBaseW: 0.165,
  neckTipW: 0.11,
  headW: 0.115,
  tailW: 0.065
}

/** The rider's upper body. Smaller than a footman's — he is sitting down. */
const R = {
  /** The seat, relative to the barrel's centre — on the saddle, not in it. */
  seatX: -0.02,
  seatY: -0.13,
  torsoLen: 0.2,
  neckLen: 0.03,
  headR: 0.078,
  shoulderDrop: 0.032,
  shoulderSpread: 0.044,
  upperArm: 0.115,
  foreArm: 0.108,
  handSize: 0.046,
  hipSpread: 0.03,
  thigh: 0.145,
  shin: 0.135,
  footLen: 0.078,
  footH: 0.038,
  limbThick: 0.05,
  // Seated rest: the thigh forward across the saddle flap, the knee bent back,
  // the heel down. Put on the skeleton rather than repeated in every clip,
  // because unlike the mount's legs these barely move.
  thighRest: -0.62,
  shinRest: 0.92,
  bootRest: -0.24
}

/** Weapons that are aimed rather than swung, same set the footman uses. */
const RANGED_WEAPONS = new Set<UnitVisual['weapon']>([
  'sling', 'bow', 'musket', 'rifle', 'lmg', 'rpg', 'laser', 'railgun', 'plasma', 'grenade'
])

/** Weapons a rider couches level along the line of the charge. */
const COUCHED_WEAPONS = new Set<UnitVisual['weapon']>(['lance', 'spear'])

/** The muzzle of the animal itself, solved from the rig rather than guessed. */
function jawTip(P: Quad): [number, number] {
  const nx = P.witherX + Math.cos(P.neckRest) * P.neckLen
  const ny = P.coreY + P.witherY + Math.sin(P.neckRest) * P.neckLen
  const a = P.neckRest + P.pollRest
  return [nx + Math.cos(a) * P.headLen, ny + Math.sin(a) * P.headLen]
}

// ──────────────────────────── Skeletons ────────────────────────────

/**
 * The four-legged half, shared by both archetypes.
 *
 * Everything hangs off `barrel`, including the legs — unlike the footman, where
 * the hips deliberately sit on a world-aligned root so the legs never inherit
 * the torso's lean. On a quadruped the opposite is true: the shoulders and hips
 * *are* the body, and it is the barrel pitching that throws the legs through
 * the stride. Hanging them anywhere else gives you a horse whose body rocks
 * while its legs stay bolted to the horizon.
 *
 * Depths interleave the two sides around the body: far legs behind it, near
 * legs in front, with room left between for a rider's own limbs to slot in.
 */
function quadBones(P: Quad): Skeleton {
  return [
    // World-aligned. Carries the whole animal's rise and fall through a stride.
    bone('root', null, { y: P.coreY, depth: 20 }),
    // The barrel is drawn pointing right and has no length, so its children
    // attach at its own pivot — the core — and rotate about it when it pitches.
    bone('barrel', 'root', {
      part: 'barrel',
      orient: 'right',
      depth: 20,
      weights: { breathe: 0.5, lean: 0.5, flinch: 0.3 }
    }),

    // ── tail ─────────────────────────────────────────────────────────────
    bone('tailBase', 'barrel', { x: P.tailX, y: P.tailY, angle: Math.PI / 2 + P.tailRest, depth: 4 }),
    bone('tail', 'tailBase', { length: P.tailLen, part: 'tail', depth: 4, weights: { breathe: 0.8 } }),

    // ── neck and head ────────────────────────────────────────────────────
    // The withers pivot holds the neck's resting reach, so a clip angle here
    // means "how far the neck has dropped from where it lives".
    bone('withers', 'barrel', { x: P.witherX, y: P.witherY, angle: P.neckRest, depth: 24 }),
    bone('neck', 'withers', {
      length: P.neckLen,
      part: 'neck',
      depth: 24,
      weights: { breathe: 0.6, aim: 0.25, flinch: 0.5 }
    }),
    bone('poll', 'neck', { angle: P.pollRest, depth: 26 }),
    bone('beastHead', 'poll', {
      length: P.headLen,
      part: 'beastHead',
      depth: 26,
      weights: { aim: 0.4, breathe: 0.3, flinch: 1 }
    }),

    // ── far-side legs ────────────────────────────────────────────────────
    // Each hip carries PI/2 against a barrel pointing right, so the leg below
    // it hangs straight down at local zero.
    bone('hindHipB', 'barrel', { x: P.hindHipX, y: P.hipY, angle: Math.PI / 2, depth: 6 }),
    bone('hindThighB', 'hindHipB', { length: P.hindThigh, part: 'hindThighB', depth: 6 }),
    bone('hindShinB', 'hindThighB', { length: P.hindShin, part: 'hindShinB', depth: 7 }),
    bone('hindHoofB', 'hindShinB', { part: 'hindHoofB', depth: 8 }),

    bone('foreHipB', 'barrel', { x: P.foreHipX, y: P.hipY, angle: Math.PI / 2, depth: 9 }),
    bone('foreThighB', 'foreHipB', { length: P.foreThigh, part: 'foreThighB', depth: 9 }),
    bone('foreShinB', 'foreThighB', { length: P.foreShin, part: 'foreShinB', depth: 10 }),
    bone('foreHoofB', 'foreShinB', { part: 'foreHoofB', depth: 11 }),

    // ── near-side legs ───────────────────────────────────────────────────
    bone('hindHipF', 'barrel', { x: P.hindHipX, y: P.hipY, angle: Math.PI / 2, depth: 44 }),
    bone('hindThighF', 'hindHipF', { length: P.hindThigh, part: 'hindThighF', depth: 44 }),
    bone('hindShinF', 'hindThighF', { length: P.hindShin, part: 'hindShinF', depth: 45 }),
    bone('hindHoofF', 'hindShinF', { part: 'hindHoofF', depth: 46 }),

    bone('foreHipF', 'barrel', { x: P.foreHipX, y: P.hipY, angle: Math.PI / 2, depth: 47 }),
    bone('foreThighF', 'foreHipF', { length: P.foreThigh, part: 'foreThighF', depth: 47 }),
    bone('foreShinF', 'foreThighF', { length: P.foreShin, part: 'foreShinF', depth: 48 }),
    bone('foreHoofF', 'foreShinF', { part: 'foreHoofF', depth: 49 })
  ]
}

/**
 * The rider, seated on the mount's spine.
 *
 * The `seat` pivot is the whole point: it is a pure pivot on the barrel that
 * the clips drive independently, so the rider can rise as the mount falls and
 * lean forward a beat after the mount stretches. Hanging the torso straight off
 * the barrel instead makes a rider that is part of the horse.
 *
 * The far leg is deliberately deeper than the barrel — a rider straddles, so
 * the off-side leg belongs *behind* the animal, and drawing it in front is the
 * single most obvious way to make cavalry look wrong.
 *
 * @param weaponRest  local angle of the weapon against a downward-pointing hand
 * @param ranged      raises the weapon arm to firing height, so the aim layer
 *                    tilts around level rather than around hanging down
 */
function riderBones(weaponRest: number, ranged: boolean): Skeleton {
  const armRest = ranged ? -1.28 : 0
  const foreRest = ranged ? 0.42 : 0
  return [
    bone('seat', 'barrel', { x: R.seatX, y: R.seatY, depth: 34 }),

    // Points up out of the saddle. Everything worn on the upper body rides it.
    bone('rTorso', 'seat', {
      angle: -Math.PI / 2,
      length: R.torsoLen,
      part: 'chest',
      orient: 'up',
      depth: 34,
      weights: { breathe: 1, lean: 1, flinch: 0.6 }
    }),
    bone('rNeck', 'rTorso', { length: R.neckLen, depth: 35 }),
    bone('rHead', 'rNeck', {
      length: R.headR,
      part: 'head',
      orient: 'up',
      depth: 36,
      weights: { breathe: 0.4, aim: 0.12, flinch: 1 }
    }),

    // Arms. The shoulder pivots carry PI so a limb at local zero hangs down
    // against a torso that points up.
    bone('rShoulderB', 'rTorso', { x: -R.shoulderDrop, y: -R.shoulderSpread, angle: Math.PI, depth: 28 }),
    bone('rUpperArmB', 'rShoulderB', {
      angle: ranged ? -0.95 : 0,
      length: R.upperArm,
      part: 'rUpperArmB',
      depth: 28,
      weights: { aim: 0.42, recoil: 0.4 }
    }),
    bone('rForeArmB', 'rUpperArmB', {
      angle: ranged ? 0.72 : 0,
      length: R.foreArm,
      part: 'rForeArmB',
      depth: 29,
      weights: { aim: 0.34, recoil: 0.6 }
    }),
    bone('rHandB', 'rForeArmB', { part: 'rHandB', depth: 30 }),

    bone('rShoulderF', 'rTorso', { x: -R.shoulderDrop, y: R.shoulderSpread, angle: Math.PI, depth: 54 }),
    bone('rUpperArmF', 'rShoulderF', {
      angle: armRest,
      length: R.upperArm,
      part: 'rUpperArmF',
      depth: 54,
      weights: { aim: 0.6, recoil: 0.7 }
    }),
    bone('rForeArmF', 'rUpperArmF', {
      angle: foreRest,
      length: R.foreArm,
      part: 'rForeArmF',
      depth: 55,
      weights: { aim: 0.4, recoil: 1 }
    }),
    bone('rHandF', 'rForeArmF', { part: 'rHandF', depth: 56 }),
    // The weapon hangs off the hand, so it inherits every bit of arm motion for
    // free — including recoil, which is the whole point. Weapon art is authored
    // pointing *up* from the grip, and `orient: 'right'` maps a bone angle
    // straight through to the sprite's rotation, so a world angle of PI/2 lays
    // it flat along the line of the charge and anything less than that tips it
    // back over the shoulder.
    bone('weapon', 'rHandF', { angle: weaponRest, part: 'weapon', orient: 'right', depth: 58, weights: { aim: 0.1 } }),

    // Legs. Seated, so the rest angles live on the bones and the clips only
    // nudge them — a rider's knee angle is set by the saddle, not by the gait.
    bone('rHipB', 'seat', { x: -R.hipSpread * 0.5, angle: Math.PI / 2, depth: 14 }),
    bone('rThighB', 'rHipB', { angle: R.thighRest, length: R.thigh, part: 'rThighB', depth: 14 }),
    bone('rShinB', 'rThighB', { angle: R.shinRest, length: R.shin, part: 'rShinB', depth: 15 }),
    bone('rBootB', 'rShinB', { angle: R.bootRest, part: 'rBootB', depth: 16 }),

    bone('rHipF', 'seat', { x: R.hipSpread * 0.5, angle: Math.PI / 2, depth: 50 }),
    bone('rThighF', 'rHipF', { angle: R.thighRest, length: R.thigh, part: 'rThighF', depth: 50 }),
    bone('rShinF', 'rThighF', { angle: R.shinRest, length: R.shin, part: 'rShinF', depth: 51 }),
    bone('rBootF', 'rShinF', { angle: R.bootRest, part: 'rBootF', depth: 52 }),

    // Worn kit. Both sit just above the barrel so they fall across the animal's
    // rump and flank rather than disappearing inside it.
    bone('cape', 'rTorso', { y: -0.02, part: 'cape', orient: 'up', depth: 22 }),
    bone('shield', 'rTorso', {
      x: -R.torsoLen * 0.4,
      y: -R.shoulderSpread * 1.5,
      part: 'shield',
      orient: 'up',
      depth: 38,
      weights: { lean: 0.4 }
    })
  ]
}

function buildRiderSkeleton(weaponRest: number, ranged: boolean): Skeleton {
  const s = [...quadBones(MOUNT), ...riderBones(weaponRest, ranged)]
  validateSkeleton(s, 'rider')
  return s
}

function buildBeastSkeleton(): Skeleton {
  const s = quadBones(BEAST)
  validateSkeleton(s, 'beast')
  return s
}

// ────────────────────────────── Clips ──────────────────────────────

/** thigh, shin, hoof — one leg, in the order the chain runs. */
type Leg = readonly [number, number, number]

/**
 * All four legs in one line, in footfall order for a transverse gallop:
 * far hind, near hind, far fore, near fore.
 *
 * Written this way because a gait is a *relationship* between the four legs,
 * and a pose spelled out as twelve separate bone entries hides that completely.
 */
function legs(hindB: Leg, hindF: Leg, foreB: Leg, foreF: Leg): Pose {
  return {
    hindThighB: { angle: hindB[0] },
    hindShinB: { angle: hindB[1] },
    hindHoofB: { angle: hindB[2] },
    hindThighF: { angle: hindF[0] },
    hindShinF: { angle: hindF[1] },
    hindHoofF: { angle: hindF[2] },
    foreThighB: { angle: foreB[0] },
    foreShinB: { angle: foreB[1] },
    foreHoofB: { angle: foreB[2] },
    foreThighF: { angle: foreF[0] },
    foreShinF: { angle: foreF[1] },
    foreHoofF: { angle: foreF[2] }
  }
}

/**
 * The standing pose, used as the base for both idles and as the rest the attack
 * clips return to. The hind legs keep their zigzag — femur back, cannon forward
 * — because a horse standing with straight hind legs is a sawhorse.
 */
const STAND = legs([0.2, -0.3, 0.12], [0.16, -0.26, 0.1], [-0.03, 0.04, 0.0], [0.02, 0.03, -0.02])

/**
 * The gallop.
 *
 * Five keys and two suspensions, which is what separates a gallop from a fast
 * walk. The cycle reads: **gather** — all four feet off the ground with the
 * legs folded under a body that has arched and shortened, neck tucked; then the
 * hind pair strikes one after the other and drives; then the fore pair catches
 * the fall, the near fore last as the lead leg; then **extension**, the second
 * suspension, with the body stretched flat out and the hinds swinging through
 * underneath it.
 *
 * The two things doing the real work are not in the legs at all. `root.y` lifts
 * the whole animal off the ground through both suspensions and slams it down
 * over the loaded diagonal, and `barrel` pitches nose-up on the gather and
 * nose-down as the forehand takes the weight. The neck pumps against that: it
 * tucks when the body gathers and reaches out over the lead foreleg, which is
 * the motion everyone recognises even if nobody can name it.
 *
 * The rider is on the opposite phase. `seat.y` rises while the mount drops, so
 * he floats over the worst of it, and `seat.angle` folds him forward through
 * the extension and lets him come up on the gather — a beat behind the mount
 * each time, because a rider who moves exactly with the horse is welded to it.
 */
const RIDE_WALK: Clip = {
  name: 'walk',
  duration: 620,
  loop: true,
  ease: 'sine',
  keys: [
    {
      // Gather. Airborne, coiled, everything folded in under the body.
      t: 0,
      pose: {
        ...legs([-0.72, -0.62, 0.34], [-0.52, -0.78, 0.4], [-0.1, 1.05, 0.45], [-0.32, 1.25, 0.55]),
        root: { y: -0.028 },
        barrel: { angle: -0.07 },
        neck: { angle: -0.18 },
        beastHead: { angle: 0.22 },
        tail: { angle: -0.24 },
        seat: { y: 0.016, angle: 0.06 },
        rTorso: { angle: -0.04 },
        rUpperArmF: { angle: -0.12 },
        rForeArmF: { angle: 0.24 },
        rUpperArmB: { angle: -0.16 },
        rForeArmB: { angle: 0.3 },
        rThighF: { angle: 0.05 },
        rThighB: { angle: 0.05 }
      }
    },
    {
      // First beat: the off hind strikes and starts to take the weight.
      t: 0.2,
      pose: {
        ...legs([-0.34, -0.14, 0.1], [-0.6, -0.4, 0.26], [-0.55, 0.55, 0.3], [-0.62, 0.85, 0.42]),
        root: { y: 0.006 },
        barrel: { angle: -0.02 },
        neck: { angle: -0.04 },
        beastHead: { angle: 0.06 },
        tail: { angle: -0.1 },
        seat: { y: -0.004, angle: 0.12 },
        rTorso: { angle: 0.02 },
        rUpperArmF: { angle: -0.06 },
        rForeArmF: { angle: 0.3 },
        rUpperArmB: { angle: -0.1 },
        rForeArmB: { angle: 0.34 },
        rThighF: { angle: 0.0 },
        rThighB: { angle: 0.0 }
      }
    },
    {
      // Second and third beats overlap: near hind planted, off hind driving
      // back, off fore reaching for the ground. This is the lowest the body
      // gets — the whole animal is hanging off one loaded diagonal.
      t: 0.4,
      pose: {
        ...legs([0.42, 0.1, -0.12], [-0.18, -0.16, 0.06], [-0.46, 0.14, 0.06], [-0.6, 0.42, 0.26]),
        root: { y: 0.016 },
        barrel: { angle: 0.04 },
        neck: { angle: 0.1 },
        beastHead: { angle: -0.06 },
        tail: { angle: 0.08 },
        seat: { y: -0.01, angle: 0.18 },
        rTorso: { angle: 0.06 },
        rUpperArmF: { angle: 0.02 },
        rForeArmF: { angle: 0.34 },
        rUpperArmB: { angle: -0.02 },
        rForeArmB: { angle: 0.38 },
        rThighF: { angle: -0.04 },
        rThighB: { angle: -0.04 }
      }
    },
    {
      // Fourth beat: the lead fore plants and the body rolls over it. The hind
      // pair has already left the ground and is swinging forward underneath.
      t: 0.6,
      pose: {
        ...legs([0.66, -0.24, -0.2], [0.5, 0.04, -0.14], [0.02, 0.06, -0.04], [-0.3, 0.1, 0.06]),
        root: { y: 0.01 },
        barrel: { angle: 0.08 },
        neck: { angle: 0.2 },
        beastHead: { angle: -0.14 },
        tail: { angle: 0.16 },
        seat: { y: -0.006, angle: 0.2 },
        rTorso: { angle: 0.05 },
        rUpperArmF: { angle: -0.02 },
        rForeArmF: { angle: 0.3 },
        rUpperArmB: { angle: -0.06 },
        rForeArmB: { angle: 0.34 },
        rThighF: { angle: -0.02 },
        rThighB: { angle: -0.02 }
      }
    },
    {
      // Extension. The forehand pushes off, the animal stretches out flat and
      // leaves the ground for the second time in the cycle.
      t: 0.8,
      pose: {
        ...legs([0.1, -0.72, 0.24], [0.24, -0.56, 0.2], [0.52, 0.22, -0.1], [0.34, 0.4, 0.05]),
        root: { y: -0.022 },
        barrel: { angle: -0.01 },
        neck: { angle: 0.06 },
        beastHead: { angle: -0.04 },
        tail: { angle: -0.14 },
        seat: { y: 0.012, angle: 0.14 },
        rTorso: { angle: -0.01 },
        rUpperArmF: { angle: -0.1 },
        rForeArmF: { angle: 0.26 },
        rUpperArmB: { angle: -0.14 },
        rForeArmB: { angle: 0.3 },
        rThighF: { angle: 0.03 },
        rThighB: { angle: 0.03 }
      }
    }
  ]
}

/**
 * The idle.
 *
 * A standing horse is never quite still — it shifts its weight, its head
 * swings, its tail moves — but it is also not performing, so all of this is
 * small. The one liberty taken is the off hind resting: a horse at ease cocks
 * one hind leg and stands on three, and it is the most recognisable thing a
 * stationary horse does.
 */
const RIDE_IDLE: Clip = {
  name: 'idle',
  duration: 3100,
  loop: true,
  ease: 'sine',
  keys: [
    {
      t: 0,
      pose: {
        ...STAND,
        hindThighB: { angle: 0.3 },
        hindShinB: { angle: -0.46 },
        hindHoofB: { angle: 0.3 },
        root: { y: 0 },
        neck: { angle: 0.02 },
        beastHead: { angle: 0.0 },
        tail: { angle: -0.06 },
        seat: { y: 0, angle: 0.02 },
        rUpperArmF: { angle: -0.08 },
        rForeArmF: { angle: 0.3 },
        rUpperArmB: { angle: -0.12 },
        rForeArmB: { angle: 0.34 }
      }
    },
    {
      t: 0.5,
      pose: {
        ...STAND,
        hindThighB: { angle: 0.32 },
        hindShinB: { angle: -0.5 },
        hindHoofB: { angle: 0.34 },
        root: { y: -0.004 },
        neck: { angle: -0.05 },
        beastHead: { angle: 0.05 },
        tail: { angle: 0.1 },
        seat: { y: -0.003, angle: 0.0 },
        rUpperArmF: { angle: -0.04 },
        rForeArmF: { angle: 0.34 },
        rUpperArmB: { angle: -0.08 },
        rForeArmB: { angle: 0.38 }
      }
    }
  ]
}

/**
 * The attack, in two flavours.
 *
 * Anticipation, strike, recovery — the same shape as the footman's, but the
 * anticipation is done by the *mount*. The horse gathers and lifts its forehand
 * off the ground, which throws the rider's weight back and cocks the arm; then
 * the front feet come down and the whole animal drives forward underneath the
 * blow. A cavalryman does not hit with his shoulder, he hits with half a ton of
 * horse, and the clip has to say so.
 *
 * The two flavours exist because a lance is not a sabre. A sabre is *swung*:
 * the hand travels nearly three radians from cocked-behind to forward-and-down,
 * and the weapon travels with it. A lance is *couched*: it stays level the
 * whole way through and the reach comes from the horse, not the arm. Feeding a
 * lance through the sabre's arc points it straight into the ground at contact,
 * which is what the first pass of this did.
 */
function rideAttack(style: 'swing' | 'thrust'): Clip {
  const swing = style === 'swing'
  // upper arm, forearm — at the wind-up, at contact, and through the follow.
  const arm = swing
    ? { wind: [-1.15, -0.7], hit: [0.85, 0.12], follow: [0.5, 0.4] }
    : { wind: [-0.45, 0.25], hit: [-0.1, -0.05], follow: [-0.24, 0.12] }
  // A sabre needs the horse under it and a torso wound up to swing from; a
  // lance needs the horse behind it and a body that folds straight forward.
  const twist = swing ? 1 : 0.4
  const rear = swing ? 1 : 0.65
  return {
    name: 'attack',
    duration: 540,
    loop: false,
    ease: 'quad',
    keys: [
      { t: 0, pose: { ...STAND } },
      {
        // Gather and rear: forehand up, hocks under, rider coiled back.
        t: 0.34,
        pose: {
          ...legs(
            [0.02, -0.5, 0.28],
            [0.1, -0.44, 0.24],
            [-0.4 * rear, 0.8 * rear, 0.34 * rear],
            [-0.55 * rear, 0.95 * rear, 0.4 * rear]
          ),
          root: { y: -0.018 * rear, x: -0.014 },
          barrel: { angle: -0.2 * rear },
          neck: { angle: -0.24 },
          beastHead: { angle: 0.2 },
          tail: { angle: -0.2 },
          seat: { y: 0.006, angle: -0.14 * twist },
          rTorso: { angle: -0.2 * twist },
          rHead: { angle: 0.08 },
          rUpperArmF: { angle: arm.wind[0] },
          rForeArmF: { angle: arm.wind[1] },
          rUpperArmB: { angle: 0.24 },
          rForeArmB: { angle: 0.5 }
        },
        ease: 'cubic'
      },
      {
        // Contact. `back` overshoots this and settles into it, which is the
        // difference between a blow landing and an arm waving.
        t: 0.46,
        pose: {
          ...legs([0.5, -0.06, -0.14], [0.42, -0.02, -0.1], [-0.2, 0.12, 0.04], [-0.28, 0.16, 0.06]),
          root: { y: 0.012, x: 0.02 },
          barrel: { angle: 0.1 },
          neck: { angle: 0.2 },
          beastHead: { angle: -0.16 },
          tail: { angle: 0.18 },
          seat: { y: -0.008, angle: 0.26 },
          rTorso: { angle: 0.3 * twist },
          rHead: { angle: -0.06 },
          rUpperArmF: { angle: arm.hit[0] },
          rForeArmF: { angle: arm.hit[1] },
          rUpperArmB: { angle: -0.3 },
          rForeArmB: { angle: 0.2 }
        },
        ease: 'back'
      },
      {
        // Follow through, still committed forward.
        t: 0.64,
        pose: {
          ...legs([0.34, -0.16, -0.06], [0.28, -0.14, -0.04], [-0.1, 0.08, 0.02], [-0.14, 0.1, 0.02]),
          root: { y: 0.006, x: 0.008 },
          barrel: { angle: 0.05 },
          neck: { angle: 0.1 },
          beastHead: { angle: -0.06 },
          tail: { angle: 0.08 },
          seat: { y: -0.003, angle: 0.16 },
          rTorso: { angle: 0.16 * twist },
          rUpperArmF: { angle: arm.follow[0] },
          rForeArmF: { angle: arm.follow[1] },
          rUpperArmB: { angle: -0.14 }
        },
        ease: 'sine'
      },
      { t: 1, pose: { ...STAND }, ease: 'sine' }
    ]
  }
}

const RIDE_SWING = rideAttack('swing')
const RIDE_THRUST = rideAttack('thrust')

/**
 * The beast stands folded rather than propped: hock high and well behind, wrist
 * ahead of the shoulder, the whole animal a hand's breadth lower than its legs
 * could hold it. Solved so the pads sit exactly on the ground.
 */
const PROWL_STAND = legs([0.66, -1.32, 0.66], [0.66, -1.32, 0.66], [-0.58, 1.23, -0.65], [-0.58, 1.23, -0.65])

/**
 * One foot's stride, sampled eight times.
 *
 * These are not eyeballed. Each entry is a foot *position* — so far forward of
 * the hip, so far below it — pushed back through `solveTwoBoneIk`, because the
 * thing that has to be true of a walk is that the planted foot does not slide
 * and does not sink, and that is a statement about where the foot is, not about
 * what angle the thigh is at. Six of the eight samples hold the foot on the
 * ground and walk it steadily backward from full reach to full extension; the
 * remaining two lift it, fold it and swing it forward again. That 3:1 duty
 * ratio is what separates a walk from a trot.
 *
 * The two legs fold opposite ways, which is the single strongest signal that
 * something is an animal: the forelimb's wrist breaks *forward* of the line
 * from shoulder to foot, the hind limb's hock breaks *backward*.
 */
type Cycle = readonly Leg[]

const PROWL_FORE: Cycle = [
  [-0.83, 0.61, 0.22], // full reach, pad landing
  [-0.83, 1.04, -0.21],
  [-0.68, 1.21, -0.53], // under the shoulder, carrying
  [-0.43, 1.2, -0.77],
  [-0.12, 1.01, -0.9],
  [0.25, 0.61, -0.86], // full extension behind, about to lift
  [-0.47, 1.76, -1.29], // folded and swinging through
  [-1.08, 1.54, -0.46] // thrown forward, reaching for the next plant
]

const PROWL_HIND: Cycle = [
  [-0.12, -0.85, 0.97], // reaching under the belly
  [0.23, -1.18, 0.95],
  [0.5, -1.31, 0.8], // under the hip, driving
  [0.72, -1.31, 0.58],
  [0.88, -1.18, 0.3],
  [0.92, -0.85, -0.08], // driven out behind
  [1.22, -1.86, 0.64], // hock snapped shut, foot clear of the ground
  [0.53, -1.72, 1.19]
]

// Lateral sequence — near hind, near fore, far hind, far fore — expressed as
// how many of the eight samples each leg lags the near hind by. Writing the
// gait as offsets rather than as four hand-copied pose lists is the only way to
// be sure all four legs are genuinely walking the same stride.
const PROWL_BODY = [
  // root.y, barrel, neck, head, tail. The body dips onto each of the four
  // footfalls and the head nods with the working shoulder, while the tail
  // sways once per stride so the whole thing does not read as a four-frame loop.
  [0.006, -0.01, 0.04, 0.0, -0.18],
  [-0.003, 0.01, 0.1, -0.05, -0.1],
  [0.005, 0.04, 0.15, -0.11, 0.02],
  [-0.004, 0.02, 0.12, -0.07, 0.14],
  [0.006, -0.01, 0.07, -0.02, 0.2],
  [-0.003, 0.01, 0.11, -0.06, 0.12],
  [0.005, 0.04, 0.16, -0.12, 0.0],
  [-0.004, 0.02, 0.1, -0.05, -0.12]
]

/**
 * The prowl.
 *
 * Head low the whole way through — below the line of the shoulders, which is
 * the entire difference between a beast stalking and a horse ambling — a long
 * stride off the folded legs, and shoulders that visibly work as each forefoot
 * takes the load.
 */
const BEAST_WALK: Clip = {
  name: 'walk',
  duration: 980,
  loop: true,
  ease: 'sine',
  keys: Array.from({ length: 8 }, (_, k) => {
    const [y, barrel, neck, head, tail] = PROWL_BODY[k]
    return {
      t: k / 8,
      pose: {
        ...legs(
          PROWL_HIND[(k + 4) % 8],
          PROWL_HIND[k % 8],
          PROWL_FORE[(k + 2) % 8],
          PROWL_FORE[(k + 6) % 8]
        ),
        root: { y },
        barrel: { angle: barrel },
        neck: { angle: neck },
        beastHead: { angle: head },
        tail: { angle: tail }
      }
    }
  })
}

/** Breathing, a slow tail sway, and the head quartering the ground. */
const BEAST_IDLE: Clip = {
  name: 'idle',
  duration: 2900,
  loop: true,
  ease: 'sine',
  keys: [
    {
      t: 0,
      pose: {
        ...PROWL_STAND,
        root: { y: 0 },
        barrel: { angle: 0.01 },
        neck: { angle: 0.06 },
        beastHead: { angle: -0.04 },
        tail: { angle: -0.16 }
      }
    },
    {
      t: 0.5,
      pose: {
        ...PROWL_STAND,
        root: { y: -0.005 },
        barrel: { angle: -0.01 },
        neck: { angle: -0.02 },
        beastHead: { angle: 0.06 },
        tail: { angle: 0.18 }
      }
    }
  ]
}

/**
 * The lunge.
 *
 * The beast has no arms and no weapon, so the whole body is the strike. It
 * crouches — hocks folded, chest dropped, head drawn back over the shoulders —
 * and then throws itself forward, forelegs raking and the head driving out past
 * the line of the chest. The recovery pulls back on the haunches rather than
 * settling in place, so it ends where it can go again.
 */
const BEAST_ATTACK: Clip = {
  name: 'attack',
  duration: 500,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: { ...PROWL_STAND } },
    {
      // Crouch. Everything gathers back and down over the hind legs.
      t: 0.32,
      pose: {
        ...legs([0.93, -1.66, 0.73], [0.93, -1.66, 0.73], [-0.95, 1.69, -0.74], [-0.95, 1.69, -0.74]),
        root: { y: 0.018, x: -0.02 },
        barrel: { angle: 0.06 },
        neck: { angle: -0.3 },
        beastHead: { angle: 0.24 },
        tail: { angle: -0.3 }
      },
      ease: 'cubic'
    },
    {
      // The lunge itself: hinds straight behind, forelegs thrown out, jaws
      // past the chest. Overshoot and settle.
      t: 0.46,
      pose: {
        ...legs([1.12, -1.09, -0.04], [1.06, -1.02, -0.06], [-1.43, 1.53, -0.1], [-1.5, 1.46, -0.06]),
        root: { y: -0.014, x: 0.026 },
        barrel: { angle: -0.1 },
        neck: { angle: 0.3 },
        beastHead: { angle: -0.26 },
        tail: { angle: 0.24 }
      },
      ease: 'back'
    },
    {
      t: 0.64,
      pose: {
        ...legs([0.9, -1.3, 0.4], [0.86, -1.26, 0.4], [-0.9, 1.44, -0.54], [-0.86, 1.4, -0.54]),
        root: { y: 0.004, x: 0.01 },
        barrel: { angle: -0.02 },
        neck: { angle: 0.14 },
        beastHead: { angle: -0.1 },
        tail: { angle: 0.1 }
      },
      ease: 'sine'
    },
    { t: 1, pose: { ...PROWL_STAND }, ease: 'sine' }
  ]
}

// ────────────────────────────── Drawing ──────────────────────────────

/**
 * Smooth interpolation through a short table of control points.
 *
 * An animal's outline is a handful of landmarks — croup, loin, withers, girth,
 * flank — and everything between them is a curve. Authoring the landmarks and
 * letting this fill in the rest is far easier to tune than a trigonometric
 * expression that happens to look like a horse.
 */
type Profile = readonly (readonly [number, number])[]

function curve(t: number, points: Profile): number {
  if (t <= points[0][0]) return points[0][1]
  const last = points[points.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ta, va] = points[i]
    const [tb, vb] = points[i + 1]
    if (t <= tb) {
      const u = (t - ta) / (tb - ta)
      return va + (vb - va) * (0.5 - Math.cos(Math.PI * u) / 2)
    }
  }
  return last[1]
}

// Landmarks as fractions of the girth, measured from the spine line. t runs
// from the croup (0) to the point of the shoulder (1).
//
// These swing hard on purpose. The barrel is only about ten pixels deep at a
// playable size, so a profile that varies by two of them is a brick with
// rounded ends — the croup, the dip of the loin, the rise of the withers and
// the tuck of the flank all have to be worth at least a pixel each or the
// animal has no landmarks at all.
const HORSE_BACK: Profile = [[0, 0.3], [0.1, 0.5], [0.32, 0.4], [0.58, 0.38], [0.86, 0.54], [0.96, 0.44], [1, 0.3]]
const HORSE_BELLY: Profile = [[0, 0.46], [0.16, 0.4], [0.36, 0.28], [0.66, 0.52], [0.86, 0.52], [1, 0.34]]
// The beast carries its shoulders above its croup and tucks harder at the
// flank, which is most of why it reads as a predator and not as livestock.
const BEAST_BACK: Profile = [[0, 0.28], [0.12, 0.46], [0.36, 0.34], [0.6, 0.4], [0.82, 0.56], [0.94, 0.44], [1, 0.28]]
const BEAST_BELLY: Profile = [[0, 0.44], [0.2, 0.36], [0.44, 0.22], [0.72, 0.46], [0.9, 0.48], [1, 0.32]]

/** Tack drawn onto the mount's body, in the rider's own colours. */
interface Tack {
  blanket: Material
  saddle: Material
  accent: number
}

/**
 * The barrel: rump, loin, girth and chest as one part.
 *
 * Silhouette first, then the two muscle masses that actually describe an
 * animal at this size — the round of the haunch and the slab of the shoulder —
 * then tack. Detail is drawn freely and trimmed back to the outline afterwards,
 * so a haunch can be shaped as a full blob without bulging the profile.
 *
 * Authored pointing right, with its origin at the core, so the bone can pitch
 * the whole body about the animal's centre of mass.
 */
function drawBarrel(
  lengthPx: number,
  depthPx: number,
  hide: Material,
  mane: Material,
  opts: { back: Profile; belly: Profile; tack?: Tack; hackles?: boolean }
): PartArt {
  const L = Math.max(12, Math.round(lengthPx * RES))
  const D = Math.max(6, Math.round(depthPx * RES))
  const p = partCanvas(L, D * 2.6)
  const x0 = PAD
  const cy = Math.round(p.h / 2)
  const r = hide.ramp

  const tops: number[] = []
  const bots: number[] = []

  // ── silhouette ──────────────────────────────────────────────────────────
  for (let i = 0; i < L; i += 1) {
    const t = L > 1 ? i / (L - 1) : 0
    const x = x0 + i
    const top = Math.round(cy - D * curve(t, opts.back))
    const bot = Math.round(cy + D * curve(t, opts.belly))
    tops.push(top)
    bots.push(bot)
    const h = Math.max(1, bot - top + 1)
    p.fill(x, top, 1, h, r[2])
    // The barrel is a cylinder: the underside falls away from the key light and
    // the last row of it is in full shadow.
    const shade = Math.max(1, Math.round(h * 0.24))
    p.fill(x, bot - shade + 1, 1, shade, r[1])
    p.set(x, bot, r[0])
    // The topline catches the light, hardest over the withers where it faces
    // up and to the right. Running the brightest tone across the whole forehand
    // read as a white slab; it belongs on one landmark, not on half the animal.
    p.set(x, top, t > 0.74 && t < 0.94 ? r[4] : r[3])
    if (h > 5) p.set(x, top + 1, r[3])
  }

  // ── muscle ──────────────────────────────────────────────────────────────
  // Two grooves and two lit patches, and that is the entire anatomy budget.
  // Shaded blobs were tried here first and they simply eat the body: an orb
  // wide enough to read as a haunch covers a third of the barrel in its own
  // shadow, and the animal turns into a dark lump with legs.
  const crease = (t: number) => {
    const i = Math.round(t * (L - 1))
    p.fill(x0 + i, tops[i] + 1, 1, Math.max(2, Math.round((bots[i] - tops[i]) * 0.72)), r[1])
  }
  crease(0.28) // in front of the haunch, where the stifle sits
  crease(0.68) // behind the shoulder blade
  const patch = (t: number, w: number) => {
    const i = Math.round(t * (L - 1))
    const n = Math.max(1, Math.round(L * w))
    for (let k = 0; k < n && i + k < L; k += 1) p.fill(x0 + i + k, tops[i + k] + 1, 1, 2, r[3])
  }
  patch(0.08, 0.14) // the round of the rump
  patch(0.74, 0.14) // the top of the shoulder

  // ── trim detail back to the outline ─────────────────────────────────────
  for (let x = 0; x < p.w; x += 1) {
    const i = x - x0
    const inside = i >= 0 && i < L
    for (let y = 0; y < p.h; y += 1) {
      if (!inside || y < tops[i] || y > bots[i]) p.set(x, y, 0, 0)
    }
  }

  // ── things that stand proud of the body ─────────────────────────────────
  if (opts.hackles) {
    // A raised ridge along the spine. Drawn after the trim precisely because it
    // is meant to break the silhouette.
    const m = mane.ramp
    for (let i = Math.round(L * 0.2); i < Math.round(L * 0.92); i += 1) {
      const t = i / (L - 1)
      const rise = Math.max(1, Math.round(D * 0.18 * curve(t, [[0.2, 0.3], [0.55, 0.7], [0.82, 1], [0.92, 0.2]])))
      const x = x0 + i
      p.fill(x, tops[i] - rise, 1, rise, i % 2 ? m[1] : m[2])
      p.set(x, tops[i] - rise, m[0])
    }
  }

  if (opts.tack) {
    const bl = opts.tack.blanket.ramp
    const sd = opts.tack.saddle.ramp
    const ac = ramp(opts.tack.accent)
    const seatFrom = Math.round(L * 0.34)
    const seatTo = Math.round(L * 0.66)
    // Blanket: one row on the back plus a corner hanging past the cantle, in
    // the rider's own cloth with an accent edge. Two rows was enough to bury
    // the loin entirely, which is the only part of the topline the eye can see
    // once the rider is sitting on the rest of it.
    for (let i = Math.max(0, seatFrom - 4); i < seatTo + 1 && i < L; i += 1) {
      const x = x0 + i
      const drop = i < seatFrom ? Math.max(2, Math.round(D * 0.34)) : 1
      p.fill(x, tops[i], 1, drop, bl[2])
      if (i < seatFrom) p.set(x, tops[i] + drop - 1, ac[3])
    }
    // Saddle: one row of seat with a pommel in front and a cantle behind, each
    // exactly one pixel proud of it. At this size that single pixel either side
    // is the whole difference between a saddle and a stripe.
    for (let i = seatFrom; i < seatTo && i < L; i += 1) {
      const t = (i - seatFrom) / Math.max(1, seatTo - seatFrom - 1)
      const rise = t < 0.16 || t > 0.86 ? 1 : 0
      const x = x0 + i
      p.fill(x, tops[i] - rise - 1, 1, rise + 2, sd[2])
      p.set(x, tops[i] - rise - 1, sd[3])
    }
    // Girth round the barrel, and a short stirrup leather with an iron on it.
    const gi = Math.round(L * 0.64)
    p.fill(x0 + gi, tops[gi] + 1, 1, bots[gi] - tops[gi], sd[1])
    const si = Math.round(L * 0.5)
    const stirLen = Math.max(3, Math.round(D * 0.7))
    p.fill(x0 + si, tops[si], 1, stirLen, sd[1])
    p.frame(x0 + si - 1, tops[si] + stirLen, 3, 3, ramp(0x9aa2ae, { contrast: 1.2 })[3])
  }

  return { canvas: sealPart(p, hide.base), origin: [(x0 + L / 2) / p.w, cy / p.h] }
}

/**
 * The neck.
 *
 * Authored pointing **down** with its origin at the withers, like any other
 * limb. Once the bone rotates it up and forward, the part's local +x edge ends
 * up along the top of the neck — which is both the crest, where the mane goes,
 * and the edge the light lands on. That is not a coincidence; the limb
 * convention was chosen so the two agree.
 */
function drawNeck(
  lengthPx: number,
  baseWPx: number,
  tipWPx: number,
  hide: Material,
  mane: Material,
  opts: { crest?: boolean; ruff?: boolean }
): PartArt {
  const L = Math.max(4, Math.round(lengthPx * RES))
  const W0 = Math.max(2, Math.round(baseWPx * RES))
  const W1 = Math.max(2, Math.round(tipWPx * RES))
  const fringe = Math.max(1, Math.round(W0 * 0.45))
  const p = partCanvas(W0 + fringe * 2 + 2, L)
  const cx = PAD + fringe + Math.round(W0 / 2)
  const top = PAD
  const r = hide.ramp
  const m = mane.ramp

  // Two rows drawn *above* the origin, which plug into the body. Without them
  // the neck's outline and the barrel's outline meet edge to edge and leave a
  // two-pixel black seam across the withers, which reads as a decapitation.
  const over = 2
  const widths: number[] = []
  const lefts: number[] = []
  for (let i = -over; i < L; i += 1) {
    const t = L > 1 ? Math.max(0, i) / (L - 1) : 0
    const w = Math.max(2, Math.round(W0 + (W1 - W0) * curve(t, [[0, 0], [0.55, 0.5], [1, 1]])))
    // A neck is not a cone: the throat hollows out under the jaw, so the
    // centreline bows toward the crest as it rises.
    const bow = Math.round(W0 * 0.16 * Math.sin(t * Math.PI))
    const left = cx - (w >> 1) + bow
    widths[i + over] = w
    lefts[i + over] = left
    p.fill(left, top + i, w, 1, r[2])
    p.set(left, top + i, r[1])
    if (w > 2) p.set(left + w - 1, top + i, r[3])
    if (w > 4) p.set(left + w - 2, top + i, r[3])
  }

  if (opts.crest) {
    // The mane: strands off the crest edge, alternating tones and lengths so it
    // reads as hair rather than as a second silhouette. Two pixels is the whole
    // budget — a fringe as wide as the neck is a second neck.
    for (let i = 0; i < L; i += 1) {
      const t = L > 1 ? i / (L - 1) : 0
      const edge = lefts[i + over] + widths[i + over] - 1
      const len = Math.max(1, Math.round(fringe * (0.4 + 0.6 * Math.sin(t * Math.PI))) - (i % 3 === 0 ? 1 : 0))
      p.fill(edge, top + i, Math.max(1, len), 1, i % 2 ? m[1] : m[2])
    }
  }
  if (opts.ruff) {
    // Shorter, on both sides, and heaviest at the shoulder — a mantle rather
    // than a mane.
    for (let i = 0; i < L; i += 1) {
      const t = L > 1 ? i / (L - 1) : 0
      const len = Math.max(1, Math.round(fringe * (0.8 - 0.6 * t)))
      p.fill(lefts[i + over] + widths[i + over] - 1, top + i, len, 1, i % 2 ? m[1] : m[2])
      p.fill(lefts[i + over] - len + 1, top + i, len, 1, i % 2 ? m[0] : m[1])
    }
  }

  return { canvas: sealPart(p, hide.base), origin: [cx / p.w, top / p.h] }
}

/**
 * The head, authored pointing down from the poll toward the muzzle.
 *
 * After the bone rotation the part's local +x is *up* — the forehead and the
 * line of the nose — and local -x is the jaw and the throat. So the ears rise
 * off the +x side of the poll, the eye sits high on the +x half, and the muzzle
 * and the chin are drawn toward -x. Getting that mapping backwards produces a
 * horse wearing its own jaw as a hat, which is exactly as bad as it sounds.
 */
function drawQuadHead(
  lengthPx: number,
  widthPx: number,
  hide: Material,
  mane: Material,
  opts: { jaw: 'equine' | 'fanged'; eye: number; bridle?: Material }
): PartArt {
  const L = Math.max(5, Math.round(lengthPx * RES))
  const W = Math.max(3, Math.round(widthPx * RES))
  const earLen = Math.max(2, Math.round(W * 0.55))
  const p = partCanvas(W * 2 + earLen, L + 2)
  const cx = PAD + W
  const top = PAD + 1
  const r = hide.ramp
  const m = mane.ramp
  const fanged = opts.jaw === 'fanged'

  // The two edges of the face, as fractions of W from the bone line. The crown
  // side is nearly straight; the jaw side carries the cheek and the chin.
  //
  // This head is around eight pixels long. Everything drawn on it competes with
  // everything else, so it gets a shape, an eye and a nostril — the blaze,
  // forelock, brow ridge and bridle cheekpiece that were here first all landed
  // on top of one another and turned the face into a smear.
  const crown: Profile = fanged
    ? [[0, 0.58], [0.3, 0.5], [0.7, 0.38], [1, 0.34]]
    : [[0, 0.52], [0.25, 0.44], [0.7, 0.32], [1, 0.34]]
  const jaw: Profile = fanged
    ? [[0, 0.66], [0.32, 0.7], [0.68, 0.5], [1, 0.48]]
    : [[0, 0.6], [0.24, 0.64], [0.62, 0.34], [1, 0.32]]

  // Two rows above the poll, same trick as the neck: they vanish inside the
  // crest and stop the two outlines meeting in a black join.
  for (let i = -2; i < L; i += 1) {
    const t = L > 1 ? Math.max(0, i) / (L - 1) : 0
    const up = Math.max(1, Math.round(W * curve(t, crown)))
    const down = Math.max(1, Math.round(W * curve(t, jaw)))
    p.fill(cx - down, top + i, down + up + 1, 1, r[2])
    p.set(cx - down, top + i, r[1])
    p.set(cx + up, top + i, r[3])
  }

  // One ear, off the poll on the crown side. Two overlap into a smudge.
  const earBase = cx + Math.round(W * curve(0, crown))
  for (let i = 0; i < earLen; i += 1) p.fill(earBase + i, top - (i < earLen - 1 ? 1 : 0), 1, 2, i ? r[3] : r[2])

  // Eye: one dark pixel, one lit pixel above it for the brow. There is no
  // third pixel available and it does not need one.
  const eyeX = cx + Math.round(W * 0.12)
  const eyeY = top + Math.round(L * 0.28)
  p.set(eyeX, eyeY, ramp(opts.eye, { contrast: 1.45 })[fanged ? 4 : 0])
  p.set(eyeX, eyeY - 1, r[3])

  // Muzzle: a nostril, and the mouth as a single shadow pixel under the chin.
  p.set(cx - Math.max(1, Math.round(W * 0.14)), top + L - 2, r[0])
  if (fanged) {
    // A fang breaking the jawline, which is the whole read on a predator head.
    p.set(cx - Math.round(W * curve(0.85, jaw)) - 1, top + L - 2, ramp(0xe8e2d2)[4])
    p.set(cx - Math.round(W * curve(0.6, jaw)), top + L - 4, m[0])
  } else if (opts.bridle) {
    // A noseband, one pixel, and nothing else. Reins cannot be drawn as a rigid
    // part, so the bridle is implied rather than tracked.
    const nb = top + Math.round(L * 0.66)
    p.fill(cx - Math.round(W * curve(0.66, jaw)), nb, Math.round(W * (curve(0.66, jaw) + curve(0.66, crown))) + 1, 1, opts.bridle.ramp[1])
  }

  return { canvas: sealPart(p, hide.base), origin: [cx / p.w, top / p.h] }
}

/**
 * One leg segment. Authored pointing down, origin at the joint at its top.
 *
 * `limbSegment` from the shared vocabulary tapers by a fraction; a horse's leg
 * needs a taper of five to one from the haunch to the cannon bone, which that
 * one cannot express without going to nothing. So this takes both widths and
 * shapes the fall between them, heaviest near the top where the muscle is.
 */
function drawLegBone(
  lengthPx: number,
  topWPx: number,
  botWPx: number,
  mat: Material,
  opts: { cap?: boolean; muscle?: boolean } = {}
): PartArt {
  const L = Math.max(3, Math.round(lengthPx * RES))
  const T = Math.max(2, Math.round(topWPx * RES))
  const B = Math.max(1, Math.round(botWPx * RES))
  const p = partCanvas(T + 2, L + 2)
  const cx = PAD + Math.round(T / 2)
  const top = PAD
  const r = mat.ramp

  for (let i = 0; i < L; i += 1) {
    const t = L > 1 ? i / (L - 1) : 0
    // The mass stays high and then falls away fast, which is where the
    // gaskin-to-cannon shape of a real leg comes from. Holding the width past
    // halfway turns the leg into a slab, so the fall starts early and is steep.
    const shape = opts.muscle ? curve(t, [[0, 0], [0.22, 0.24], [0.5, 0.78], [1, 1]]) : curve(t, [[0, 0], [1, 1]])
    const w = Math.max(1, Math.round(T + (B - T) * shape))
    const x = cx - (w >> 1)
    p.fill(x, top + i, w, 1, r[2])
    p.set(x, top + i, r[1])
    if (w > 2) p.set(x + w - 1, top + i, r[3])
  }

  if (opts.cap) orb(p, cx, top + 1, T * 0.5, T * 0.4, r)
  // The joint at the bottom — knee, hock or fetlock — reads as a small knob.
  if (B >= 2) orb(p, cx, top + L - 1, Math.max(1, B * 0.7), Math.max(1, B * 0.6), r)

  return { canvas: sealPart(p, mat.base), origin: [cx / p.w, top / p.h] }
}

/**
 * A hoof or a paw, with its pastern. Origin at the fetlock, toe pointing right,
 * because the rig mirrors the whole container for facing.
 */
function drawHoof(
  lengthPx: number,
  heightPx: number,
  leg: Material,
  horn: Material,
  opts: { paw?: boolean } = {}
): PartArt {
  const Lh = Math.max(3, Math.round(lengthPx * RES))
  const H = Math.max(2, Math.round(heightPx * RES))
  const p = partCanvas(Lh + 2, H + 2)
  const ankleX = PAD + Math.round(Lh * 0.32)
  const top = PAD
  const lr = leg.ramp
  const hr = horn.ramp

  // Pastern: a short slope forward off the fetlock, so the foot is not welded
  // straight onto the cannon bone.
  const pastern = Math.max(1, Math.round(H * 0.34))
  p.fill(ankleX - 1, top, 3, pastern, lr[2])
  p.set(ankleX + 1, top, lr[3])

  if (opts.paw) {
    // A splayed pad with toes and claws — wider than it is deep.
    p.fill(PAD, top + pastern, Lh, H - pastern, hr[2])
    p.fill(PAD, top + H - 1, Lh, 1, hr[0])
    p.set(PAD + Lh - 1, top + pastern, hr[3])
    for (let i = 1; i < Lh; i += 2) p.set(PAD + i, top + H - 2, hr[1])
    // One claw, at the toe, and only one. A lit row across the whole pad turned
    // every beast in the roster into something wearing four white socks.
    p.set(PAD + Lh - 1, top + H - 2, ramp(0xd8d2c2)[3])
  } else {
    // A hoof: a wedge that is wider at the ground than at the coronet.
    for (let i = 0; i < H - pastern; i += 1) {
      const t = (i + 1) / Math.max(1, H - pastern)
      const w = Math.max(2, Math.round(Lh * (0.6 + 0.4 * t)))
      const x = PAD + Math.round((Lh - w) * 0.4)
      p.fill(x, top + pastern + i, w, 1, hr[2])
      p.set(x, top + pastern + i, hr[1])
      p.set(x + w - 1, top + pastern + i, hr[3])
    }
    p.fill(PAD, top + H - 1, Lh, 1, hr[0])
  }

  return { canvas: sealPart(p, horn.base), origin: [ankleX / p.w, top / p.h] }
}

/**
 * The tail. Authored pointing down from the dock, so the bone's rest angle
 * carries it back and the clips swing it.
 */
function drawTail(lengthPx: number, widthPx: number, mane: Material, opts: { whip?: boolean } = {}): PartArt {
  const L = Math.max(4, Math.round(lengthPx * RES))
  const W = Math.max(2, Math.round(widthPx * RES))
  const p = partCanvas(W * 2, L + 2)
  const cx = PAD + Math.round(W * 0.7)
  const top = PAD
  const r = mane.ramp

  if (opts.whip) {
    // One tapering rope, with a tuft on the end.
    for (let i = 0; i < L; i += 1) {
      const t = L > 1 ? i / (L - 1) : 0
      const w = Math.max(1, Math.round(W * (1 - 0.65 * t)))
      const drift = Math.round(W * 0.35 * Math.sin(t * Math.PI * 0.8))
      const x = cx - (w >> 1) - drift
      p.fill(x, top + i, w, 1, r[2])
      p.set(x, top + i, r[1])
      if (w > 2) p.set(x + w - 1, top + i, r[3])
    }
    for (let i = 0; i < 3; i += 1) {
      p.line(cx - 1, top + L - 2, cx - 2 - i, top + L + 1 + i, i % 2 ? r[1] : r[2])
    }
  } else {
    // A dock with hair falling off it: several strands that spread as they go,
    // alternating tone so the mass has some depth to it.
    p.fill(cx - (W >> 1), top, W, Math.max(2, Math.round(L * 0.22)), r[2])
    p.fill(cx + (W >> 1) - 1, top, 1, Math.max(2, Math.round(L * 0.22)), r[3])
    for (let s = 0; s < 5; s += 1) {
      const spread = (s - 2) * Math.max(1, Math.round(W * 0.3))
      p.line(cx, top + Math.round(L * 0.18), cx + spread, top + L - 1 - Math.abs(s - 2), s % 2 ? r[1] : r[2])
    }
    p.line(cx + Math.round(W * 0.4), top + Math.round(L * 0.2), cx + Math.round(W * 0.5), top + L - 3, r[3])
  }

  return { canvas: sealPart(p, mane.base), origin: [cx / p.w, top / p.h] }
}

// ─────────────────────────── Part assembly ───────────────────────────

/**
 * The animal's colours.
 *
 * A warhorse pulled straight from the rider's livery comes out blue or crimson,
 * which is not a horse. So the hide is a real hide colour with only a little of
 * the owner's palette bled into it — enough that two factions' cavalry are
 * distinguishable at a glance, not enough that either stops being an animal.
 * The beast, which *is* the unit rather than the unit's transport, takes its
 * hide from the visual's own skin colour instead.
 */
function hideFor(v: UnitVisual, wild: boolean): { hide: Material; mane: Material; horn: Material } {
  const base = wild ? v.skin : mix(0x6a4a32, v.cloth2, 0.22)
  return {
    hide: leather(base),
    mane: leather(tone(base, wild ? -0.3 : -0.44)),
    // Horn is pale on a hoofed animal and dark on a padded one — a paw drawn in
    // the same tone as a hoof reads as four white socks.
    horn: leather(tone(base, wild ? -0.38 : -0.52))
  }
}

/** Builds the sixteen parts every quadruped needs, near side and far side. */
function quadParts(
  P: Quad,
  v: UnitVisual,
  height: number,
  opts: { wild: boolean; tack?: Tack }
): Record<string, PartArt> {
  const px = (f: number) => f * height
  // `bulk` is a statement about the *rider's* build, so the animal only takes
  // the square root of it. A heavier lancer should not come with a fatter
  // horse's head; he should come with a slightly stronger horse.
  const bulk = Math.sqrt(v.bulk ?? 1)
  const { hide, mane, horn } = hideFor(v, opts.wild)
  // The far side is simply darker. It is the cheapest depth cue there is, it
  // needs no second silhouette, and the old rig already got this one right.
  // A third of a step down was enough to turn an already dark leather into a
  // silhouette; a fifth reads as "behind the body" without going to black.
  const farHide = leather(tone(hide.base, -0.2))
  const farHorn = leather(tone(horn.base, -0.2))

  const parts: Record<string, PartArt> = {}

  parts.barrel = drawBarrel(px(P.bodyLen), px(P.bodyDepth) * bulk, hide, mane, {
    back: opts.wild ? BEAST_BACK : HORSE_BACK,
    belly: opts.wild ? BEAST_BELLY : HORSE_BELLY,
    tack: opts.tack,
    hackles: opts.wild
  })
  parts.neck = drawNeck(px(P.neckLen), px(P.neckBaseW) * bulk, px(P.neckTipW) * bulk, hide, mane, {
    crest: !opts.wild,
    ruff: opts.wild
  })
  parts.beastHead = drawQuadHead(px(P.headLen), px(P.headW) * bulk, hide, mane, {
    jaw: opts.wild ? 'fanged' : 'equine',
    eye: opts.wild ? v.accent : 0x241a12,
    bridle: opts.tack ? opts.tack.saddle : undefined
  })
  parts.tail = drawTail(px(P.tailLen), px(P.tailW) * bulk, mane, { whip: opts.wild })

  for (const side of ['F', 'B'] as const) {
    const mat = side === 'F' ? hide : farHide
    const hoofMat = side === 'F' ? horn : farHorn
    parts[`hindThigh${side}`] = drawLegBone(px(P.hindThigh), px(P.hindTopW) * bulk, px(P.hindMidW) * bulk, mat, {
      cap: true,
      muscle: true
    })
    parts[`hindShin${side}`] = drawLegBone(px(P.hindShin), px(P.hindMidW) * bulk, px(P.legBotW) * bulk, mat, {
      muscle: true
    })
    parts[`hindHoof${side}`] = drawHoof(px(P.hoofLen) * bulk, px(P.hoofH), mat, hoofMat, { paw: opts.wild })
    parts[`foreThigh${side}`] = drawLegBone(px(P.foreThigh), px(P.foreTopW) * bulk, px(P.foreMidW) * bulk, mat, {
      cap: true,
      muscle: true
    })
    parts[`foreShin${side}`] = drawLegBone(px(P.foreShin), px(P.foreMidW) * bulk, px(P.legBotW) * bulk, mat)
    parts[`foreHoof${side}`] = drawHoof(px(P.hoofLen) * bulk, px(P.hoofH), mat, hoofMat, { paw: opts.wild })
  }

  return parts
}

/**
 * The rider's upper body.
 *
 * Composed from the shared library rather than reimplemented: a mounted
 * lancer's chest, helmet and weapon are the same objects a footman's are, and
 * drawing a second set of them is how an army stops looking like one army. Only
 * the proportions change — he is smaller than a man on foot, because he is
 * sitting down and because the horse has to be the bigger shape.
 */
function riderParts(v: UnitVisual, height: number): { parts: Record<string, PartArt>; metrics: RigMetrics } {
  const px = (f: number) => f * height
  const bulk = v.bulk ?? 1
  const armoured = v.torso === 'plate' || v.torso === 'exo' || v.torso === 'mail'
  const sleeve = v.torso === 'bare' ? skinMat(v.skin) : armoured ? metalMat(v.metal) : clothMat(v.cloth)
  const glove = armoured ? metalMat(v.metal) : skinMat(v.skin)
  const trouser =
    v.torso === 'bare' || v.torso === 'fur'
      ? skinMat(v.skin)
      : armoured
        ? metalMat(tone(v.metal, -0.12))
        : clothMat(v.cloth2)
  const boot = armoured ? metalMat(v.metal) : leather(tone(v.cloth2, -0.34))
  const backSleeve = clothMat(tone(sleeve.base, -0.3))
  const backTrouser = clothMat(tone(trouser.base, -0.3))
  const backBoot = leather(tone(boot.base, -0.3))
  const backGlove = clothMat(tone(glove.base, -0.3))
  const thick = px(R.limbThick) * bulk

  const parts: Record<string, PartArt> = {}
  parts.rUpperArmF = limbSegment(px(R.upperArm), thick, sleeve, { capTop: true, capBottom: true, taper: 0.86 })
  parts.rForeArmF = limbSegment(px(R.foreArm), thick * 0.86, sleeve, { capBottom: true, taper: 0.8 })
  parts.rHandF = drawHand(px(R.handSize) * bulk, glove, { armoured })
  parts.rUpperArmB = limbSegment(px(R.upperArm), thick, backSleeve, { capTop: true, capBottom: true, taper: 0.86 })
  parts.rForeArmB = limbSegment(px(R.foreArm), thick * 0.86, backSleeve, { capBottom: true, taper: 0.8 })
  parts.rHandB = drawHand(px(R.handSize) * bulk, backGlove, { armoured })

  parts.rThighF = limbSegment(px(R.thigh), thick * 1.16, trouser, { capTop: true, capBottom: true, taper: 0.84 })
  parts.rShinF = limbSegment(px(R.shin), thick * 0.94, trouser, { capBottom: true, taper: 0.8 })
  parts.rBootF = drawBoot(px(R.footLen) * bulk, px(R.footH), boot)
  parts.rThighB = limbSegment(px(R.thigh), thick * 1.16, backTrouser, { capTop: true, capBottom: true, taper: 0.84 })
  parts.rShinB = limbSegment(px(R.shin), thick * 0.94, backTrouser, { capBottom: true, taper: 0.8 })
  parts.rBootB = drawBoot(px(R.footLen) * bulk, px(R.footH), backBoot)

  const seatY = MOUNT.coreY + R.seatY
  const metrics: RigMetrics = {
    height,
    legLen: px(R.thigh + R.shin),
    torsoH: px(R.torsoLen),
    bodyW: px(0.2) * bulk,
    armLen: px(R.upperArm + R.foreArm),
    headR: px(R.headR),
    hipY: px(seatY),
    shoulderY: px(seatY - R.torsoLen * 0.8),
    neckY: px(seatY - R.torsoLen)
  }

  // The torso canvas carries PAD rows of empty space below the drawn body, so
  // an origin of exactly 1 floats the whole upper body a few pixels above the
  // saddle. Anchor on the drawn edge instead.
  const chest = drawTorso(v, metrics)
  parts.chest = { canvas: chest, origin: [0.5, (chest.h - PAD) / chest.h] }
  parts.head = { canvas: drawHead(v, metrics), origin: [0.5, 0.82] }

  const weapon = drawWeapon(v.weapon, v, metrics)
  if (weapon) {
    parts.weapon = {
      canvas: weapon.canvas,
      origin: [weapon.grip[0] / weapon.canvas.w, weapon.grip[1] / weapon.canvas.h]
    }
  }
  if (v.shield && v.shield !== 'none') {
    const shield = drawShield(v.shield, v, metrics)
    if (shield) parts.shield = { canvas: shield, origin: [0.5, 0.5] }
  }
  if (v.cape) parts.cape = { canvas: drawCape(v, metrics), origin: [0.5, 0.06] }

  return { parts, metrics }
}

// ───────────────────────────── Archetypes ─────────────────────────────

export const riderArchetype: Archetype = {
  id: 'rider',
  claims: v => v.kind === 'rider',
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const ranged = RANGED_WEAPONS.has(v.weapon)
    const tack: Tack = {
      blanket: clothMat(v.cloth2),
      saddle: leather(tone(0x6a4a32, -0.3)),
      accent: v.accent
    }
    const couched = ranged || COUCHED_WEAPONS.has(v.weapon)
    const parts = { ...quadParts(MOUNT, v, height, { wild: false, tack }), ...riderParts(v, height).parts }
    const clips: Record<ClipName, Clip> = {
      idle: RIDE_IDLE,
      walk: RIDE_WALK,
      attack: couched ? RIDE_THRUST : RIDE_SWING
    }
    return {
      skeleton: buildRiderSkeleton(
        // Every weapon in the library is drawn pointing *up* out of its grip,
        // and `orient: 'right'` feeds the bone's world angle straight into the
        // sprite's rotation — so a weapon reads level and forward when its bone
        // reaches PI/2, and these rest angles are simply what each hand pose
        // needs to add up to that.
        //
        // A lance or a spear is couched flat along the line of the charge and a
        // firearm is levelled the same way, so both settle at PI/2 against
        // their own arm. A sabre instead rests carried up and forward and comes
        // *through* PI/2 on the swing, landing forward and down at contact.
        ranged ? 0.86 : COUCHED_WEAPONS.has(v.weapon) ? 0.1 : -0.5,
        ranged
      ),
      parts,
      clips,
      height,
      // The leading hand at rest: shoulder height, arm's length forward, plus
      // the reach the weapon adds beyond it.
      muzzle: [R.upperArm + R.foreArm + 0.06, MOUNT.coreY + R.seatY - R.torsoLen * 0.82]
    }
  }
}

export const beastArchetype: Archetype = {
  id: 'beast',
  claims: v => v.kind === 'humanoid' && v.chassis === 'beast',
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const clips: Record<ClipName, Clip> = { idle: BEAST_IDLE, walk: BEAST_WALK, attack: BEAST_ATTACK }
    return {
      skeleton: buildBeastSkeleton(),
      parts: quadParts(BEAST, v, height, { wild: true }),
      clips,
      height,
      // A beast has no weapon, so anything that wants a spawn point wants the
      // jaws. Solved from the rig rather than eyeballed, so it stays right when
      // the proportions are tuned.
      muzzle: jawTip(BEAST)
    }
  }
}
