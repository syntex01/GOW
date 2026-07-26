import type { UnitVisual } from '../../data/types'
import {
  PAD,
  cloth as clothMat,
  foot as drawFoot,
  hand as drawHand,
  leather,
  limbSegment,
  metal as metalMat,
  pelvis as drawPelvis,
  skin as skinMat,
  type Material
} from '../anatomy'
import { ramp, tone } from '../pixel'
import { bone, validateSkeleton, type Clip, type Skeleton } from '../rig'
import { drawCape, drawShield, drawTorso } from '../unitArt'
import { drawHeadHi } from '../heads'
import { drawWeaponHi } from '../weapons'
import type { Archetype, ArchetypeBuild, ClipName, PartArt } from './types'

/**
 * The footman: two legs, two arms, a head, and something in its hands.
 *
 * This is the body plan most of the roster uses, and it is the reference every
 * other archetype is built against. Get this one right and the army reads as
 * an army.
 *
 * ## What changed from the old rig
 *
 * The old rig gave each limb a single bone. A leg was one rectangle pivoting
 * at the hip, so it swept through a stride like a pendulum on a clock — no
 * knee, so no weight, no push-off, no absorption on the landing. Arms were the
 * same, which meant a sword swing was the whole arm rotating rigidly from the
 * shoulder.
 *
 * Here every limb is thigh + shin + foot and upper arm + forearm + hand, and
 * the torso and pelvis are separate bones that counter-rotate against each
 * other through a stride. That is what makes a walk read as a walk.
 *
 * ## Authoring convention
 *
 * Shoulder and hip pivots are rotated so that **a limb at local angle zero
 * hangs straight down**. Every angle in the clips below is therefore "how far
 * from hanging", which is how the motion is actually reasoned about, rather
 * than an absolute screen angle that has to be mentally un-rotated every time.
 */

/**
 * Weapons that are aimed rather than swung. They rest levelled along the line
 * of fire; everything else rides up and back, ready to come down.
 */
const RANGED_WEAPONS = new Set<UnitVisual['weapon']>([
  'sling', 'bow', 'musket', 'rifle', 'lmg', 'rpg', 'laser', 'railgun', 'plasma', 'grenade'
])

/**
 * How long each weapon is, as a fraction of the unit's height.
 *
 * This is equipment, not anatomy, so it lives with the body plan that carries
 * it rather than with the weapon art. A lance has to out-reach a sabre or the
 * silhouette lies about what the unit does.
 */
const WEAPON_LENGTH: Partial<Record<UnitVisual['weapon'], number>> = {
  club: 0.42,
  sword: 0.55,
  saber: 0.55,
  axe: 0.48,
  spear: 0.95,
  lance: 1.15,
  staff: 0.9,
  bow: 0.62,
  sling: 0.34,
  grenade: 0.16,
  musket: 0.78,
  rifle: 0.7,
  lmg: 0.68,
  rpg: 0.8,
  laser: 0.6,
  railgun: 0.85,
  plasma: 0.66
}

// Proportions as fractions of the unit's height. Authored once, here, so that
// a clubman and a titan are the same creature at different scales.
const P = {
  hipY: -0.38,
  pelvisW: 0.2,
  pelvisH: 0.07,
  torsoLen: 0.29,
  neckLen: 0.04,
  headR: 0.115,
  shoulderDrop: 0.04,
  shoulderSpread: 0.055,
  upperArm: 0.15,
  foreArm: 0.14,
  handSize: 0.055,
  hipSpread: 0.045,
  thigh: 0.2,
  shin: 0.18,
  footLen: 0.1,
  footH: 0.045,
  limbThick: 0.062
}

function materialsFor(v: UnitVisual): {
  sleeve: Material
  glove: Material
  trouser: Material
  boot: Material
  accent: number
} {
  const armoured = v.torso === 'plate' || v.torso === 'exo' || v.torso === 'mail'
  return {
    sleeve: v.torso === 'bare' ? skinMat(v.skin) : armoured ? metalMat(v.metal) : clothMat(v.cloth),
    glove: armoured ? metalMat(v.metal) : skinMat(v.skin),
    trouser:
      v.torso === 'bare' || v.torso === 'fur' ? skinMat(v.skin) : armoured ? metalMat(tone(v.metal, -0.12)) : clothMat(v.cloth2),
    boot: armoured ? metalMat(v.metal) : leather(tone(v.cloth2, -0.34)),
    accent: v.accent
  }
}

/**
 * The skeleton.
 *
 * Bones are listed parents-before-children, which `validateSkeleton` enforces
 * — a rig whose bones are out of order animates one frame behind itself, and
 * that is a miserable bug to find by eye.
 */
/**
 * @param weaponRest  local angle of the weapon against a downward-pointing hand
 * @param ranged      raises the weapon arm to firing height, so the aim layer
 *                    tilts around level rather than around hanging straight
 *                    down — without this a musketeer aims his musket at his
 *                    own boots and the aim additive only makes it worse
 */
function buildSkeleton(weaponRest: number, ranged: boolean): Skeleton {
  // A melee soldier does not walk with its arm hanging and the blade tip in
  // the dirt — it carries at the ready. Raising the rest pose is also what
  // gives the attack clip somewhere to wind up *from*.
  const armRest = ranged ? -1.28 : -0.5
  const foreRest = ranged ? 0.42 : -0.22
  // The weapon's restAngle is given in world terms — 0 is level, negative
  // lifts the tip. The bone hangs off the hand, so it has to be converted out
  // of the hand's frame or the weapon sits a quarter turn off.
  const handRest = Math.PI / 2 + armRest + foreRest
  const weaponLocal = weaponRest - handRest
  const s: Skeleton = [
    // Root sits at the hips and stays world-aligned, so the legs never inherit
    // the torso's lean.
    bone('root', null, { y: P.hipY, depth: 30 }),
    // The pelvis hangs off the root pointing down, so it draws unrotated and
    // can sway with the hips. Hanging it on the world-aligned root directly
    // laid it on its side.
    bone('pelvisBone', 'root', { angle: Math.PI / 2, length: P.pelvisH, part: 'pelvis', depth: 30 }),

    // ── torso chain ──────────────────────────────────────────────────────
    // Points up. Everything worn on the upper body rides this, so a lean or a
    // twist at the waist carries the head, both arms and the weapon with it.
    bone('torso', 'root', {
      angle: -Math.PI / 2,
      length: P.torsoLen,
      part: 'chest',
      orient: 'up',
      depth: 31,
      weights: { breathe: 1, lean: 1, flinch: 0.6 }
    }),
    bone('neck', 'torso', { length: P.neckLen, depth: 34 }),
    bone('head', 'neck', {
      length: P.headR,
      part: 'head',
      orient: 'up',
      depth: 35,
      weights: { breathe: 0.4, aim: 0.12, flinch: 1 }
    }),

    // ── arms ─────────────────────────────────────────────────────────────
    // The pivots carry angle PI so that, against a torso pointing up, a limb
    // at local zero hangs straight down.
    bone('shoulderB', 'torso', {
      x: -P.shoulderDrop,
      y: -P.shoulderSpread,
      angle: Math.PI,
      depth: 20
    }),
    bone('upperArmB', 'shoulderB', {
      angle: ranged ? -0.95 : -0.18,
      length: P.upperArm,
      part: 'upperArmB',
      depth: 20,
      weights: { aim: 0.42, recoil: 0.4 }
    }),
    bone('foreArmB', 'upperArmB', {
      angle: ranged ? 0.72 : 0.24,
      length: P.foreArm,
      part: 'foreArmB',
      depth: 21,
      weights: { aim: 0.34, recoil: 0.6 }
    }),
    bone('handB', 'foreArmB', { part: 'handB', depth: 22 }),

    bone('shoulderF', 'torso', {
      x: -P.shoulderDrop,
      y: P.shoulderSpread,
      angle: Math.PI,
      depth: 50
    }),
    bone('upperArmF', 'shoulderF', {
      angle: armRest,
      length: P.upperArm,
      part: 'upperArmF',
      depth: 50,
      weights: { aim: 0.6, recoil: 0.7 }
    }),
    bone('foreArmF', 'upperArmF', {
      angle: foreRest,
      length: P.foreArm,
      part: 'foreArmF',
      depth: 51,
      weights: { aim: 0.4, recoil: 1 }
    }),
    bone('handF', 'foreArmF', { part: 'handF', depth: 52 }),
    // The weapon hangs off the hand, so it inherits every bit of arm motion
    // for free — including the recoil layer, which is the whole point.
    // Held against a hand that points down, so the local angle is measured from
    // there: a melee weapon rides up and forward at rest, a ranged one levels
    // off along the line of fire.
    bone('weapon', 'handF', {
      angle: weaponLocal,
      part: 'weapon',
      orient: 'right',
      depth: 53,
      weights: { aim: 0.1 }
    }),

    // ── legs ─────────────────────────────────────────────────────────────
    bone('hipB', 'root', { x: -P.hipSpread * 0.5, angle: Math.PI / 2, depth: 10 }),
    bone('thighB', 'hipB', { length: P.thigh, part: 'thighB', depth: 10 }),
    bone('shinB', 'thighB', { length: P.shin, part: 'shinB', depth: 11 }),
    bone('footB', 'shinB', { part: 'footB', depth: 12 }),

    bone('hipF', 'root', { x: P.hipSpread * 0.5, angle: Math.PI / 2, depth: 40 }),
    bone('thighF', 'hipF', { length: P.thigh, part: 'thighF', depth: 40 }),
    bone('shinF', 'thighF', { length: P.shin, part: 'shinF', depth: 41 }),
    bone('footF', 'shinF', { part: 'footF', depth: 42 }),

    // Worn kit that is not part of the body.
    bone('cape', 'torso', { y: -0.02, part: 'cape', orient: 'up', depth: 5 }),
    // Braced across the body, not dangling from the wrist. Hanging it on the
    // hand meant its facing swung through the whole arm swing, which is not
    // what a shield does — a shield stays pointed at the enemy.
    bone('shield', 'torso', {
      x: -P.torsoLen * 0.42,
      y: -P.shoulderSpread * 1.5,
      part: 'shield',
      orient: 'up',
      depth: 23,
      weights: { lean: 0.4 }
    })
  ]
  validateSkeleton(s, 'footman')
  return s
}

// ──────────────────────────────── Clips ────────────────────────────────

/**
 * The walk.
 *
 * Four keys, and the details that matter are the ones a pendulum cannot do:
 * the knee bends hard on the passing leg so the foot clears the ground, the
 * planted leg straightens and takes the weight, the pelvis drops on the
 * contact and rises over the passing pose, and the shoulders counter-rotate
 * against the hips. The arms swing opposite their own leg, and the elbows
 * trail — a forearm reaches its extreme slightly after the upper arm does,
 * which is what stops the swing looking mechanical.
 */
const WALK: Clip = {
  name: 'walk',
  duration: 700,
  loop: true,
  ease: 'sine',
  keys: [
    {
      // Contact: back leg forward and straight, front leg trailing.
      t: 0,
      pose: {
        root: { y: 0.004 },
        torso: { angle: 0.05 },
        thighB: { angle: -0.42 },
        shinB: { angle: 0.12 },
        footB: { angle: -0.1 },
        thighF: { angle: 0.38 },
        shinF: { angle: 0.34 },
        footF: { angle: 0.22 },
        upperArmB: { angle: 0.34 },
        foreArmB: { angle: 0.22 },
        upperArmF: { angle: -0.3 },
        foreArmF: { angle: 0.3 }
      }
    },
    {
      // Passing: weight over the planted leg, the other knee tucked up.
      t: 0.25,
      pose: {
        root: { y: -0.012 },
        torso: { angle: 0.02 },
        thighB: { angle: -0.05 },
        shinB: { angle: 0.05 },
        footB: { angle: 0.05 },
        thighF: { angle: -0.02 },
        shinF: { angle: 0.72 },
        footF: { angle: 0.28 },
        upperArmB: { angle: 0.1 },
        foreArmB: { angle: 0.3 },
        upperArmF: { angle: -0.06 },
        foreArmF: { angle: 0.36 }
      }
    },
    {
      // The mirrored contact.
      t: 0.5,
      pose: {
        root: { y: 0.004 },
        torso: { angle: 0.05 },
        thighB: { angle: 0.38 },
        shinB: { angle: 0.34 },
        footB: { angle: 0.22 },
        thighF: { angle: -0.42 },
        shinF: { angle: 0.12 },
        footF: { angle: -0.1 },
        upperArmB: { angle: -0.3 },
        foreArmB: { angle: 0.3 },
        upperArmF: { angle: 0.34 },
        foreArmF: { angle: 0.22 }
      }
    },
    {
      t: 0.75,
      pose: {
        root: { y: -0.012 },
        torso: { angle: 0.02 },
        thighB: { angle: -0.02 },
        shinB: { angle: 0.72 },
        footB: { angle: 0.28 },
        thighF: { angle: -0.05 },
        shinF: { angle: 0.05 },
        footF: { angle: 0.05 },
        upperArmB: { angle: -0.06 },
        foreArmB: { angle: 0.36 },
        upperArmF: { angle: 0.1 },
        foreArmF: { angle: 0.3 }
      }
    }
  ]
}

/**
 * The idle.
 *
 * Almost nothing, on purpose. A soldier standing in line should look like it
 * is holding still under load, not performing. The visible life comes from the
 * breathe additive layer; this clip only settles the stance and lets the
 * weapon hand drift a little so a rank of them does not look stamped.
 */
const IDLE: Clip = {
  name: 'idle',
  duration: 2600,
  loop: true,
  ease: 'sine',
  keys: [
    {
      t: 0,
      pose: {
        thighB: { angle: -0.06 },
        shinB: { angle: 0.08 },
        thighF: { angle: 0.06 },
        shinF: { angle: 0.04 },
        upperArmB: { angle: 0.06 },
        foreArmB: { angle: 0.16 },
        upperArmF: { angle: -0.04 },
        foreArmF: { angle: 0.2 }
      }
    },
    {
      t: 0.5,
      pose: {
        thighB: { angle: -0.06 },
        shinB: { angle: 0.08 },
        thighF: { angle: 0.06 },
        shinF: { angle: 0.04 },
        upperArmB: { angle: 0.02 },
        foreArmB: { angle: 0.2 },
        upperArmF: { angle: -0.08 },
        foreArmF: { angle: 0.26 }
      }
    }
  ]
}

/**
 * The attack.
 *
 * Anticipation, strike, recovery — in that order and with those proportions,
 * because a blow with no wind-up has no weight no matter how fast it moves.
 * A third of the clip pulls back and coils the torso away from the target, an
 * eighth of it snaps through with `back` easing so the arm overshoots, and the
 * remainder settles. The legs brace into it: the front knee bends and the body
 * drops, so the strike comes off the ground rather than out of the shoulder.
 */
const ATTACK: Clip = {
  name: 'attack',
  duration: 520,
  loop: false,
  ease: 'quad',
  keys: [
    { t: 0, pose: {} },
    {
      // Wind up: weight back, weapon arm cocked, torso twisted away.
      t: 0.34,
      pose: {
        root: { y: 0.012, x: -0.012 },
        torso: { angle: -0.22 },
        head: { angle: 0.08 },
        upperArmF: { angle: -1.15 },
        foreArmF: { angle: -0.7 },
        upperArmB: { angle: 0.3 },
        foreArmB: { angle: 0.5 },
        thighF: { angle: 0.16 },
        shinF: { angle: 0.3 },
        thighB: { angle: -0.2 }
      },
      ease: 'cubic'
    },
    {
      // Contact. `back` overshoots past this pose and settles into it, which
      // is the difference between a hit and a wave.
      t: 0.46,
      pose: {
        root: { y: 0.004, x: 0.014 },
        torso: { angle: 0.3 },
        head: { angle: -0.06 },
        upperArmF: { angle: 0.85 },
        foreArmF: { angle: 0.12 },
        upperArmB: { angle: -0.3 },
        foreArmB: { angle: 0.2 },
        thighF: { angle: -0.24 },
        shinF: { angle: 0.16 },
        thighB: { angle: 0.22 },
        shinB: { angle: 0.3 }
      },
      ease: 'back'
    },
    {
      // Follow through, still committed forward.
      t: 0.62,
      pose: {
        root: { y: 0.008, x: 0.008 },
        torso: { angle: 0.18 },
        upperArmF: { angle: 0.55 },
        foreArmF: { angle: 0.4 },
        upperArmB: { angle: -0.16 },
        thighF: { angle: -0.12 },
        shinF: { angle: 0.2 },
        thighB: { angle: 0.12 }
      },
      ease: 'sine'
    },
    { t: 1, pose: {}, ease: 'sine' }
  ]
}

// ──────────────────────────────── Parts ────────────────────────────────

function buildParts(v: UnitVisual, height: number): {
  parts: Record<string, PartArt>
  weaponRest: number
  twoHanded: boolean
  metrics: { bodyW: number; torsoH: number; armLen: number; legLen: number; headR: number; height: number; hipY: number; shoulderY: number; neckY: number }
} {
  const mats = materialsFor(v)
  const bulk = v.bulk ?? 1
  const px = (fraction: number) => fraction * height
  const thick = px(P.limbThick) * bulk

  const parts: Record<string, PartArt> = {}
  const put = (name: string, art: { canvas: PartArt['canvas']; origin: [number, number] } | null) => {
    if (art) parts[name] = art
  }

  // Limbs. The back-side copies are darkened so the far limb sits behind the
  // body without needing a separate silhouette — the cheapest depth cue there
  // is, and one the old rig already got right.
  const backSleeve = clothMat(tone(mats.sleeve.base, -0.3))
  const backTrouser = clothMat(tone(mats.trouser.base, -0.3))
  const backBoot = leather(tone(mats.boot.base, -0.3))
  const backGlove = clothMat(tone(mats.glove.base, -0.3))
  const accentRamp = ramp(mats.accent)
  const striped = v.torso === 'exo'

  put('upperArmF', limbSegment(px(P.upperArm), thick, mats.sleeve, { capTop: true, capBottom: true, taper: 0.86, band: striped ? { at: 0.75, ramp: accentRamp } : undefined }))
  put('foreArmF', limbSegment(px(P.foreArm), thick * 0.86, mats.sleeve, { capBottom: true, taper: 0.8 }))
  put('handF', drawHand(px(P.handSize) * bulk, mats.glove, { armoured: v.torso === 'plate' || v.torso === 'exo' }))
  put('upperArmB', limbSegment(px(P.upperArm), thick, backSleeve, { capTop: true, capBottom: true, taper: 0.86 }))
  put('foreArmB', limbSegment(px(P.foreArm), thick * 0.86, backSleeve, { capBottom: true, taper: 0.8 }))
  put('handB', drawHand(px(P.handSize) * bulk, backGlove, { armoured: v.torso === 'plate' || v.torso === 'exo' }))

  put('thighF', limbSegment(px(P.thigh), thick * 1.18, mats.trouser, { capTop: true, capBottom: true, taper: 0.82 }))
  put('shinF', limbSegment(px(P.shin), thick * 0.96, mats.trouser, { capBottom: true, taper: 0.78 }))
  put('footF', drawFoot(px(P.footLen) * bulk, px(P.footH), mats.boot))
  put('thighB', limbSegment(px(P.thigh), thick * 1.18, backTrouser, { capTop: true, capBottom: true, taper: 0.82 }))
  put('shinB', limbSegment(px(P.shin), thick * 0.96, backTrouser, { capBottom: true, taper: 0.78 }))
  put('footB', drawFoot(px(P.footLen) * bulk, px(P.footH), backBoot))

  put('pelvis', drawPelvis(px(P.pelvisW) * bulk, px(P.pelvisH), mats.trouser))

  // Torso, head, weapon, shield and cape still come from the existing library,
  // which already draws them well. They are composed here rather than
  // reimplemented so the rig can be proved end to end before the higher
  // fidelity passes land on them one at a time.
  const legacyMetrics = {
    height,
    legLen: px(-P.hipY),
    torsoH: px(P.torsoLen),
    bodyW: px(0.25) * bulk,
    armLen: px(P.upperArm + P.foreArm),
    headR: px(P.headR),
    hipY: px(P.hipY),
    shoulderY: px(P.hipY - P.torsoLen * 0.8),
    neckY: px(P.hipY - P.torsoLen)
  }

  // The torso canvas carries PAD rows of empty space below the drawn body, so
  // an origin of exactly 1 floats the whole upper body a few pixels above the
  // hips. Anchor on the drawn edge instead.
  const chestCanvas = drawTorso(v, legacyMetrics)
  parts.chest = { canvas: chestCanvas, origin: [0.5, (chestCanvas.h - PAD) / chestCanvas.h] }
  // The head library computes its own neck-join origin from the drawn geometry
  // rather than the old hardcoded 0.82, which was tuned for one helmet and
  // wrong for the ten others.
  parts.head = drawHeadHi(v, px(P.headR))

  const weapon = drawWeaponHi(v.weapon, v, height * (WEAPON_LENGTH[v.weapon] ?? 0.55))
  if (weapon) {
    parts.weapon = {
      canvas: weapon.canvas,
      origin: [weapon.grip[0] / weapon.canvas.w, weapon.grip[1] / weapon.canvas.h]
    }
  }
  if (v.shield && v.shield !== 'none') {
    const shield = drawShield(v.shield, v, legacyMetrics)
    if (shield) parts.shield = { canvas: shield, origin: [0.5, 0.5] }
  }
  if (v.cape) parts.cape = { canvas: drawCape(v, legacyMetrics), origin: [0.5, 0.06] }

  return { parts, metrics: legacyMetrics, weaponRest: weapon?.restAngle ?? 0, twoHanded: weapon?.twoHanded ?? false }
}

export const footmanArchetype: Archetype = {
  id: 'footman',
  claims: v => v.kind === 'humanoid',
  build(v: UnitVisual, height: number): ArchetypeBuild {
    const ranged = RANGED_WEAPONS.has(v.weapon)
    const { parts, weaponRest, twoHanded } = buildParts(v, height)
    const clips: Record<ClipName, Clip> = { idle: IDLE, walk: WALK, attack: ATTACK }
    return {
      // Two-handed weapons bring the off hand onto the haft, so the support
      // arm comes across the body whether or not the weapon is aimed.
      skeleton: buildSkeleton(weaponRest, ranged || twoHanded),
      parts,
      clips,
      height,
      // Roughly where the leading hand ends up: shoulder height, arm's length
      // forward. Good enough for a muzzle flash, and the projectile system
      // already spreads from it.
      muzzle: [P.upperArm + P.foreArm, P.hipY - P.torsoLen * 0.82]
    }
  }
}
