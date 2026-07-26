/**
 * The skeletal animation core.
 *
 * What replaced what, and why it matters: units used to be a handful of flat
 * parts rotated directly by sine waves — one bone per arm, one per leg, no
 * knees, no elbows, no keyframes. That reads as a paper doll being wiggled.
 * A soldier at this scale sells motion through *joints* and through *timing*:
 * a knee that bends under weight, an elbow that trails the shoulder, a strike
 * that winds up before it lands and overshoots before it recovers.
 *
 * So: a real skeleton, evaluated by forward kinematics, posed by keyframed
 * clips with easing, and then modified by additive layers that ride on top of
 * whatever the clip is doing — aim, recoil, breath, lean, flinch. The clip
 * says "walking"; the additive layers say "…while aiming up-right, one frame
 * after being hit, leaning into the wind".
 *
 * Everything here is pure maths on plain objects. It draws nothing and touches
 * no engine type, which is what lets the archetypes be authored and tested
 * independently, and what keeps a rig cheap enough to evaluate for every unit
 * on the field every frame.
 *
 * ## Conventions
 *
 * - Angles are radians in **screen space**: 0 points right, positive turns
 *   clockwise (down), because y grows downward.
 * - Bone offsets and lengths are **fractions of the unit's height**, so one
 *   skeleton describes a clubman and a titan alike.
 * - A bone's children hang off its *tip*, which is `length` along its own
 *   direction. A bone with length 0 is a pure pivot — useful for hips and
 *   shoulders that need to rotate without being drawn.
 * - Facing is handled by the container's x scale, so nothing here ever needs
 *   to know which way a unit is looking.
 */

/** One bone. Purely descriptive: a skeleton is a plain array of these. */
export interface Bone {
  name: string
  /** Parent bone name, or null for the root. */
  parent: string | null
  /** Offset from the parent's tip, in unit-height fractions. */
  x: number
  y: number
  /** Rest rotation relative to the parent, radians. */
  angle: number
  /** Distance to this bone's tip, where its children attach. */
  length: number
  /**
   * Which drawn part rides on this bone. Omitted for pure pivots. A part is
   * drawn with its origin at the bone's *root* and rotated by the bone's world
   * angle, so a limb texture is authored pointing straight down.
   */
  part?: string
  /** Painter's order within the rig. Higher draws in front. */
  depth: number
  /**
   * Which way this bone's texture was authored.
   *
   * Limbs are drawn pointing down, because that is how a resting arm or leg
   * hangs and it makes the clips readable as "how far from hanging". Bodies
   * and heads are drawn upright. Weapons are drawn pointing right, along the
   * line they are aimed. Mixing these up silently rotates a part by a quarter
   * or a half turn, which looks exactly like a broken rig — so it is declared
   * rather than assumed.
   */
  orient?: PartOrient
  /**
   * Multiplies how strongly additive layers reach this bone. A hand should
   * follow the aim completely; a hip should barely notice it.
   */
  weights?: Partial<Record<AdditiveChannel, number>>
}

export type PartOrient = 'down' | 'up' | 'right'

export type Skeleton = Bone[]

/**
 * Turns a bone's world angle into the rotation its texture needs, given how
 * that texture was authored. One place, so the convention cannot drift.
 */
export function partRotation(boneAngle: number, orient: PartOrient = 'down'): number {
  switch (orient) {
    case 'up':
      return boneAngle + Math.PI / 2
    case 'right':
      return boneAngle
    default:
      return boneAngle - Math.PI / 2
  }
}

/** What a pose can say about one bone. Anything omitted keeps its rest value. */
export interface BonePose {
  /** Added to the bone's rest angle. */
  angle?: number
  /** Added to the bone's rest offset, in unit-height fractions. */
  x?: number
  y?: number
  /** Scales the bone's length, for squash and stretch. */
  stretch?: number
}

export type Pose = Record<string, BonePose>

/** A keyframe: a pose, and where in the clip it sits (0..1). */
export interface Keyframe {
  t: number
  pose: Pose
  /** Easing into this key. Defaults to the clip's. */
  ease?: EaseName
}

export type EaseName = 'linear' | 'sine' | 'quad' | 'cubic' | 'back' | 'hold'

export interface Clip {
  name: string
  /** Milliseconds for one pass. Scaled at runtime by gait or attack speed. */
  duration: number
  loop: boolean
  /** Default easing between keys. */
  ease?: EaseName
  keys: Keyframe[]
}

/**
 * Additive layers ride on top of the clip.
 *
 * Keeping them separate from the clip is the whole trick: a walk cycle does
 * not need eleven variants for eleven aim angles, and a flinch does not need
 * to know whether the unit was walking or standing when it was hit.
 */
export type AdditiveChannel = 'aim' | 'recoil' | 'breathe' | 'lean' | 'flinch'

export type Additive = Partial<Record<AdditiveChannel, number>>

// ───────────────────────────────── Easing ─────────────────────────────────

/**
 * `back` overshoots deliberately — it is what makes a strike feel like it has
 * mass rather than snapping to a stop. `hold` is a step function, for poses
 * that should read as a hard cut (a muzzle flash frame, a blade at contact).
 */
function easeWith(name: EaseName, t: number): number {
  switch (name) {
    case 'hold':
      return 0
    case 'linear':
      return t
    case 'sine':
      return 0.5 - Math.cos(Math.PI * t) / 2
    case 'quad':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'cubic':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'back': {
      const c = 1.70158
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c + 1) * (2 * t - 2) + c) + 2) / 2
    }
    default:
      return t
  }
}

// ─────────────────────────────── Evaluation ───────────────────────────────

/** A bone resolved into rig-local space. Positions are unit-height fractions. */
export interface BoneTransform {
  x: number
  y: number
  angle: number
  /** Length after any stretch, so a caller can find the tip. */
  length: number
  depth: number
  part?: string
  orient: PartOrient
}

export type RigTransforms = Record<string, BoneTransform>

function lerpPose(a: BonePose | undefined, b: BonePose | undefined, t: number): BonePose {
  const av = a ?? {}
  const bv = b ?? {}
  return {
    angle: (av.angle ?? 0) + ((bv.angle ?? 0) - (av.angle ?? 0)) * t,
    x: (av.x ?? 0) + ((bv.x ?? 0) - (av.x ?? 0)) * t,
    y: (av.y ?? 0) + ((bv.y ?? 0) - (av.y ?? 0)) * t,
    stretch: (av.stretch ?? 1) + ((bv.stretch ?? 1) - (av.stretch ?? 1)) * t
  }
}

/**
 * The pose a clip is in at normalised time `phase` (0..1).
 *
 * Looping clips wrap from the last key back to the first, so a walk cycle only
 * has to author the keys once and does not need a duplicate final frame.
 */
export function samplePose(clip: Clip, phase: number): Pose {
  const keys = clip.keys
  if (keys.length === 0) return {}
  if (keys.length === 1) return keys[0].pose

  const p = clip.loop ? ((phase % 1) + 1) % 1 : Math.max(0, Math.min(1, phase))

  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t <= p) i += 1

  const from = keys[i]
  const isLast = i === keys.length - 1
  const to = isLast ? (clip.loop ? keys[0] : from) : keys[i + 1]
  const toT = isLast ? (clip.loop ? 1 : from.t) : to.t

  const span = toT - from.t
  const raw = span > 1e-6 ? (p - from.t) / span : 1
  const eased = easeWith(to.ease ?? clip.ease ?? 'sine', Math.max(0, Math.min(1, raw)))

  const names = new Set([...Object.keys(from.pose), ...Object.keys(to.pose)])
  const out: Pose = {}
  for (const name of names) out[name] = lerpPose(from.pose[name], to.pose[name], eased)
  return out
}

/** Blends two poses, for cross-fading between clips. */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a
  if (t >= 1) return b
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  const out: Pose = {}
  for (const name of names) out[name] = lerpPose(a[name], b[name], t)
  return out
}

/**
 * How each additive channel bends a bone.
 *
 * Held here rather than in the archetypes so that "recoil" means the same
 * thing everywhere — a rifleman and a plasma mech should kick the same way,
 * scaled by their own weights, or the army stops looking like one army.
 */
const ADDITIVE_SHAPE: Record<AdditiveChannel, (amount: number) => BonePose> = {
  // Aim is fed in as the target angle already, so it maps straight through.
  aim: amount => ({ angle: amount }),
  // A shove back along the bone plus a lift, which is what a recoiling arm does.
  recoil: amount => ({ angle: -amount * 0.55, x: -amount * 0.018 }),
  breathe: amount => ({ y: -amount * 0.008, angle: amount * 0.02 }),
  lean: amount => ({ angle: amount * 0.35 }),
  flinch: amount => ({ angle: -amount * 0.4, y: amount * 0.01 })
}

/**
 * Resolves a skeleton and a pose into rig-local transforms.
 *
 * Bones must be listed parents-before-children; skeletons are authored that
 * way and the helper below asserts it, because a silently mis-ordered rig
 * produces limbs that lag one frame behind their own body.
 */
export function evaluate(
  skeleton: Skeleton,
  pose: Pose,
  additive: Additive = {}
): RigTransforms {
  const out: RigTransforms = {}

  for (const bone of skeleton) {
    const local = pose[bone.name]
    let angle = bone.angle + (local?.angle ?? 0)
    let dx = bone.x + (local?.x ?? 0)
    let dy = bone.y + (local?.y ?? 0)

    // Additive layers, weighted per bone. A bone with no weight for a channel
    // ignores it entirely, which is how the legs stay out of the aim.
    for (const channel of Object.keys(additive) as AdditiveChannel[]) {
      const weight = bone.weights?.[channel]
      if (!weight) continue
      const amount = additive[channel]
      if (!amount) continue
      const shape = ADDITIVE_SHAPE[channel](amount * weight)
      angle += shape.angle ?? 0
      dx += shape.x ?? 0
      dy += shape.y ?? 0
    }

    const length = bone.length * (local?.stretch ?? 1)

    if (bone.parent === null) {
      out[bone.name] = { x: dx, y: dy, angle, length, depth: bone.depth, part: bone.part, orient: bone.orient ?? 'down' }
      continue
    }

    const parent = out[bone.parent]
    if (!parent) {
      // A dangling parent is an authoring error, not a runtime condition — fall
      // back to rig space so the unit is visibly wrong rather than invisible.
      out[bone.name] = { x: dx, y: dy, angle, length, depth: bone.depth, part: bone.part, orient: bone.orient ?? 'down' }
      continue
    }

    // Children hang off the parent's tip.
    const tipX = parent.x + Math.cos(parent.angle) * parent.length
    const tipY = parent.y + Math.sin(parent.angle) * parent.length
    const worldAngle = parent.angle + angle
    // The offset is expressed in the parent's frame, so it rotates with it.
    const cos = Math.cos(parent.angle)
    const sin = Math.sin(parent.angle)
    out[bone.name] = {
      x: tipX + dx * cos - dy * sin,
      y: tipY + dx * sin + dy * cos,
      angle: worldAngle,
      length,
      depth: bone.depth,
      part: bone.part,
      orient: bone.orient ?? 'down'
    }
  }

  return out
}

/**
 * Checks a skeleton is well formed. Called once per archetype at build time,
 * where a thrown error is a developer's problem rather than a player's.
 */
export function validateSkeleton(skeleton: Skeleton, label: string): void {
  const seen = new Set<string>()
  for (const bone of skeleton) {
    if (seen.has(bone.name)) throw new Error(`${label}: duplicate bone "${bone.name}"`)
    if (bone.parent !== null && !seen.has(bone.parent)) {
      throw new Error(`${label}: bone "${bone.name}" precedes its parent "${bone.parent}"`)
    }
    seen.add(bone.name)
  }
}

/** Convenience for authoring: a bone with sensible defaults. */
export function bone(
  name: string,
  parent: string | null,
  spec: Partial<Omit<Bone, 'name' | 'parent'>> = {}
): Bone {
  return {
    name,
    parent,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    angle: spec.angle ?? 0,
    length: spec.length ?? 0,
    part: spec.part,
    depth: spec.depth ?? 0,
    orient: spec.orient,
    weights: spec.weights
  }
}

/**
 * A two-bone IK solve, used where a pose reads better as "put the foot here"
 * than as a pair of angles — planting a foot on the ground through a stride,
 * or holding a two-handed weapon with both hands actually on it.
 *
 * Returns the two joint angles, or null when the target is unreachable, in
 * which case the caller should keep the posed angles rather than snap.
 */
export function solveTwoBoneIk(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  upperLength: number,
  lowerLength: number,
  /** +1 bends the joint one way, -1 the other. A knee and an elbow differ. */
  bend: 1 | -1
): { upper: number; lower: number } | null {
  const dx = targetX - originX
  const dy = targetY - originY
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-5) return null
  const reach = upperLength + lowerLength
  // Just out of reach is common mid-stride; clamp rather than fail, so the limb
  // straightens toward the target instead of popping.
  const clamped = Math.min(dist, reach * 0.999)
  const base = Math.atan2(dy, dx)
  const cosUpper =
    (clamped * clamped + upperLength * upperLength - lowerLength * lowerLength) /
    (2 * clamped * upperLength)
  if (!Number.isFinite(cosUpper)) return null
  const upperOffset = Math.acos(Math.max(-1, Math.min(1, cosUpper)))
  const cosJoint =
    (upperLength * upperLength + lowerLength * lowerLength - clamped * clamped) /
    (2 * upperLength * lowerLength)
  const joint = Math.acos(Math.max(-1, Math.min(1, cosJoint)))
  return {
    upper: base + upperOffset * bend,
    lower: (Math.PI - joint) * -bend
  }
}
