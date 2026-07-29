import type Phaser from 'phaser'
import type { Body } from '../sim/physics'
import type PhysicsWorld from '../sim/physics'
import Pix, { RES, mix, outlineTone, pixelNoise, ramp, unpack, type Ramp } from './pixel'
import { shade } from './painter'

/**
 * Draws the physics world, and the mounds it leaves behind.
 *
 * The simulation owns where every chunk of a soldier is; this owns what it
 * looks like. Sprites are pooled and re-bound to bodies each frame rather than
 * created and destroyed, because a bad explosion can put a hundred new objects
 * on the field in one sub-step and allocating sprites for them mid-battle is
 * exactly the kind of hitch that makes a game feel cheap.
 *
 * The second half of this file is the pile. Loose settled debris says "some
 * things fell here"; it does not say "nobody has taken this lane in four
 * minutes". For that the dead have to accumulate into *terrain* — overlapping
 * silhouettes with limbs at angles, sinking into one shared dark mass that
 * grows in visible steps. So corpses are handed over once and forgotten: each
 * column of the field bakes its dead into a single decal that is redrawn only
 * when the pile reaches its next stage, which costs one small texture every
 * few deaths instead of a live sprite per body forever.
 *
 * Everything here is cosmetic and must never feed back into the simulation.
 * Every random-looking choice a mound makes is hashed out of the column index
 * and the corpse's own index, so both peers in a networked match grow the same
 * heap without exchanging anything.
 */

// ─────────────────────────────── Piles ───────────────────────────────

/** Field width, in world pixels, that accumulates into one mound. */
export const PILE_COLUMN = 34
/** How wide a mound is drawn — wider than its column, so neighbours merge. */
export const PILE_WIDTH = PILE_COLUMN * 2
/** Stages above bare ground. Growth is stepped so the player can see it. */
export const PILE_STAGE_COUNT = 6
/** Corpses needed to reach each stage, index 0 being "nothing here yet". */
const STAGE_THRESHOLD = [0, 2, 4, 7, 11, 16, 23]
/** Mound height at each stage, as a fraction of the average body's height. */
const STAGE_HEIGHT = [0, 0.2, 0.34, 0.48, 0.62, 0.78, 0.95]
/** Bodies drawn as distinct silhouettes at each stage. The rest are mass. */
const STAGE_BODIES = [0, 2, 4, 6, 8, 10, 12]
/** How many corpses a column remembers individually. */
const PILE_MEMORY = 14
/** Ceiling on mounds, so a pathological match cannot allocate without bound. */
const MAX_PILES = 96

/** One remembered body in a mound. */
export interface PileCorpse {
  /** Offset from the mound centre, in world pixels. */
  dx: number
  /** Which way it was facing when it fell: -1 or 1. */
  facing: number
  /** The unit's height in world pixels — a mammoth makes a bigger heap. */
  height: number
  /** Machines pile as buckled plate rather than as meat. */
  mechanical: boolean
  /** Cloth or hull colour. */
  color: number
  /** Deterministic per-body variation. */
  seed: number
}

/** The dark that everything at the bottom of a heap turns into. */
const PILE_SHADOW = 0x140a10
/** Soaked ground under a heap of the dead: blood gone brown, shadows violet. */
const PILE_SOAK = 0x2e1218
/** Cloth colours a corpse falls back to when the caller does not name one. */
const CLOTH = [0x554634, 0x3b3c44, 0x5d2d24, 0x333b2e, 0x453a48, 0x6a5c44]
/** Machine plate. */
const PLATE = [0x51555c, 0x45484e, 0x5a5347]

/**
 * Per-column size wobble. Without it every mound at the same stage is exactly
 * the same height and a busy lane turns into a wall with a flat top.
 */
const wobbleNoise = pixelNoise(0x5eed)
export function pileWobble(col: number): number {
  return 0.78 + wobbleNoise(col, 3) * 0.44
}

export function pileStageFor(count: number): number {
  let stage = 0
  for (let i = 1; i < STAGE_THRESHOLD.length; i += 1) if (count >= STAGE_THRESHOLD[i]) stage = i
  return stage
}

/** Mound height in world pixels for a stage, given the average body height. */
export function pileStageHeight(stage: number, avgHeight: number): number {
  const s = Math.max(0, Math.min(PILE_STAGE_COUNT, Math.round(stage)))
  return STAGE_HEIGHT[s] * Math.max(18, avgHeight)
}

/** A canvas handed to the texture manager — structurally `painter.Canvas2D`. */
export interface PileCanvas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

/**
 * A body lying in the heap: a capsule torso shaded in three steps from its
 * lit upper-right edge down into its own shadow, a head, and limbs at
 * whatever angle they came to rest at.
 */
function drawBody(
  p: Pix,
  cx: number,
  cy: number,
  angle: number,
  len: number,
  tones: Ramp,
  noise: (x: number, y: number) => number,
  seed: number,
  facing: number
): void {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const thick = Math.max(2, len * 0.3)
  const hx = cx + dx * len * 0.5 * facing
  const hy = cy + dy * len * 0.5 * facing
  const tx = cx - dx * len * 0.42 * facing
  const ty = cy - dy * len * 0.42 * facing

  // Torso, then two narrower passes offset up and to the right: the key light
  // comes from there, so that is where the plane turns toward it.
  p.thickLine(tx, ty, hx, hy, Math.round(thick), tones[1])
  p.thickLine(tx + 0.4, ty - 0.7, hx + 0.4, hy - 0.7, Math.max(1, Math.round(thick - 1.6)), tones[2])
  p.thickLine(tx + 0.9, ty - 1.3, hx + 0.9, hy - 1.3, Math.max(1, Math.round(thick - 3)), tones[3])

  // Head, hanging a little further along than the shoulders.
  const headR = Math.max(1.2, thick * 0.55)
  const headX = hx + dx * headR * 0.9 * facing
  const headY = hy + dy * headR * 0.9 * facing - headR * 0.2
  p.ellipse(headX, headY, headR, headR * 0.92, tones[1])
  p.ellipse(headX + 0.6, headY - 0.6, headR * 0.6, headR * 0.55, tones[2])

  // Limbs. One or two per body, flung at an angle that has nothing to do with
  // the torso — that mismatch is most of what makes a heap read as bodies.
  const limbs = 1 + (noise(seed, 3) > 0.45 ? 1 : 0)
  for (let i = 0; i < limbs; i += 1) {
    const spread = (noise(seed + i * 5, 7) - 0.5) * 2.4
    const la = angle + spread + (i === 0 ? 0.9 : -1.1)
    const ll = len * (0.3 + noise(seed + i * 5, 11) * 0.28)
    const ax = cx + dx * len * (noise(seed + i, 13) - 0.5) * 0.6
    const ay = cy + dy * len * (noise(seed + i, 13) - 0.5) * 0.6
    const ex = ax + Math.cos(la) * ll
    const ey = ay + Math.sin(la) * ll
    p.thickLine(ax, ay, ex, ey, Math.max(1, Math.round(thick * 0.42)), tones[1])
    p.thickLine(ax + 0.5, ay - 0.6, ex + 0.5, ey - 0.6, Math.max(1, Math.round(thick * 0.3)), tones[2])
    // A hand or a boot on the end, so the limb terminates in something.
    p.set(Math.round(ex), Math.round(ey), tones[2])
  }
}

/**
 * Bakes one mound.
 *
 * The heap is built as a mass first — a bump of dark, lumpy ground-coloured
 * fill — and the individual bodies are laid into its surface afterwards, so
 * the ones underneath genuinely disappear into it instead of being stacked
 * like a sprite pile. A depth pass then drowns everything more than a few
 * pixels below the local surface in the same shadow, which is what welds a
 * dozen separate silhouettes into one readable shape.
 */
export function buildPileTexture(
  corpses: readonly PileCorpse[],
  stage: number,
  avgHeight: number,
  seed = 0
): PileCanvas {
  const heightPx = pileStageHeight(stage, avgHeight)
  const w = Math.max(8, Math.round(PILE_WIDTH * RES))
  // Room above the mass for the bodies riding on top of it and for limbs.
  const h = Math.max(6, Math.round(heightPx * RES) + 4)
  const p = new Pix(w, h)
  const noise = pixelNoise(seed * 7919 + 13)
  const cx = (w - 1) / 2
  const groundY = h - 1
  const H = heightPx * RES

  if (stage <= 0) return p.toCanvas() as PileCanvas

  // ── The mass. Only two thirds of the height is bulk: the rest is made of
  // the bodies riding on top, so the skyline is limbs rather than a smooth
  // dome. The bulk itself is a mid dark — the depth pass does the drowning.
  const bulk = ramp(mix(PILE_SOAK, PILE_SHADOW, 0.45), { contrast: 0.9, hueShift: 0.06, shadowSat: 0.16 })
  const domeH = H * 0.68
  // How much of the brush's width the mass actually spans, so neighbouring
  // mounds do not all end at exactly the same place.
  const span = 0.74 + noise(seed, 1) * 0.26
  const surface = new Int32Array(w)
  for (let x = 0; x < w; x += 1) {
    const t = (x - cx) / (w * 0.5 * span)
    // A bell rather than a half circle: a heap of bodies slumps away to
    // nothing at its edges, and a flat-topped profile reads as sandbags.
    const dome = Math.abs(t) >= 1 ? 0 : Math.exp(-2.7 * t * t) - 0.066
    const lump = 0.74 + noise(x, seed) * 0.16 + noise(Math.round(x / 3), seed + 5) * 0.1
    if (dome <= 0.02) {
      surface[x] = groundY + 1
      continue
    }
    surface[x] = Math.max(1, Math.round(groundY - domeH * dome * lump))
    for (let y = surface[x]; y <= groundY; y += 1) {
      // A speckled bulk: cloth, mud and limbs too far in to make out.
      const n = noise(x * 2, y * 2)
      p.set(x, y, n > 0.88 ? bulk[2] : n > 0.55 ? bulk[1] : bulk[0])
    }
  }

  // ── The bodies. Drawn back to front so the front rank overlaps the rest.
  const shown = Math.min(corpses.length, STAGE_BODIES[Math.min(PILE_STAGE_COUNT, stage)])
  const placed: {
    x: number
    y: number
    a: number
    len: number
    tones: Ramp
    seed: number
    facing: number
    crest: boolean
  }[] = []
  for (let i = 0; i < shown; i += 1) {
    const c = corpses[corpses.length - 1 - i]
    const n = pixelNoise(c.seed * 2654435761 + i * 40503)
    // Bodies stack in courses: the ones that fell last ride the crest.
    const course = 1 - i / Math.max(1, shown - 1)
    const bx = cx + c.dx * RES * 0.85 + (n(1, 2) - 0.5) * w * 0.18
    const clamped = Math.max(2, Math.min(w - 3, bx))
    const col = Math.max(0, Math.min(w - 1, Math.round(clamped)))
    const top = Math.min(surface[col], groundY)
    // The newest bodies ride the crest — a little above it, so their outlines
    // and not the dome are what the mound's skyline is made of.
    const by = top + (groundY - top) * (1 - course) * 0.85 - course * 2
    // Foreshortened: a body lying across the heap shows a fraction of its
    // standing length, and a heap of full-length silhouettes reads as a row.
    const len = Math.max(4, c.height * RES * (0.38 + n(3, 4) * 0.26))
    // Mostly lying over, but the ones caught by the heap are propped up.
    const angle = (n(5, 6) - 0.5) * 0.9 + (course > 0.6 ? (n(7, 8) - 0.5) * 1.1 : 0)
    const base = c.mechanical
      ? PLATE[Math.floor(n(9, 1) * PLATE.length) % PLATE.length]
      : c.color || CLOTH[Math.floor(n(9, 1) * CLOTH.length) % CLOTH.length]
    // Deeper bodies are pre-dimmed a little; the depth pass finishes the job.
    const tones = ramp(mix(base, PILE_SHADOW, 0.12 + (1 - course) * 0.22), {
      contrast: c.mechanical ? 1.15 : 0.95,
      hueShift: c.mechanical ? 0.05 : 0.07,
      shadowSat: 0.2
    })
    placed.push({
      x: clamped,
      y: by,
      a: angle,
      len,
      tones,
      seed: c.seed + i,
      facing: c.facing >= 0 ? 1 : -1,
      crest: course > 0.72
    })
  }
  // Painter's order, back to front. Everything but the top course goes down
  // now so the depth pass can drown it; the crest is held back and laid on
  // afterwards at full value.
  placed.sort((a, b) => a.y - b.y)
  for (const b of placed) {
    if (!b.crest) drawBody(p, b.x, b.y, b.a, b.len, b.tones, noise, b.seed, b.facing)
  }

  // ── Depth. Everything more than a few pixels below the local surface goes
  // into the same shadow, dithered across the join so it steps rather than
  // fades. This is the pass that makes a dozen bodies read as one mound.
  const soakFrom = Math.max(3, Math.round(H * 0.3))
  for (let x = 0; x < w; x += 1) {
    let top = -1
    for (let y = 0; y < h; y += 1) {
      if ((p.get(x, y) >>> 24) > 0) {
        top = y
        break
      }
    }
    if (top < 0) continue
    for (let y = top; y < h; y += 1) {
      const value = p.get(x, y)
      if ((value >>> 24) === 0) continue
      // The onset wanders column to column, or the three steps into shadow
      // line up into horizontal bands across the whole mound.
      const depth = (y - top - soakFrom - noise(x, 401) * 3) / Math.max(4, H * 0.8)
      if (depth <= 0) continue
      const t = Math.min(1, depth)
      const [r, g, b] = unpack(value)
      const hex = (r << 16) | (g << 8) | b
      // Quantised into three steps with a hashed threshold on each boundary.
      // An ordered dither would checkerboard across the flat of a body; a
      // stochastic one grains it, which is what a heap should look like.
      const level = Math.floor(t * 3 + noise(x * 7 + 1, y * 7 + 3))
      p.set(x, y, mix(hex, PILE_SHADOW, Math.min(1, level / 3) * 0.72))
    }
  }

  // ── The crest. The last bodies to fall are still legible as bodies, which
  // is what keeps the heap from reading as a rock.
  for (const b of placed) {
    if (b.crest) drawBody(p, b.x, b.y, b.a, b.len, b.tones, noise, b.seed, b.facing)
  }

  // ── Blood. A heap of the dead is wet, and it runs down the face of the
  // heap rather than sitting on top of it: streaks from the surface down, and
  // a crust where they collect at the foot.
  const gore = ramp(0x5e1018, { hueShift: 0.03, contrast: 1, shadowSat: 0.14 })
  const tops = new Int32Array(w).fill(h)
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      if ((p.get(x, y) >>> 24) > 0) {
        tops[x] = y
        break
      }
    }
  }
  for (let x = 1; x < w - 1; x += 1) {
    const top = tops[x]
    if (top >= h || surface[x] > groundY) continue
    // Only in the creases. Blood on the skyline reads as a red candle; blood
    // where two bodies meet reads as blood.
    if (top <= Math.min(tops[x - 1], tops[x + 1])) continue
    if (noise(x, 909) < 0.72) continue
    const run = 1 + Math.floor(noise(x, 911) * 2.4)
    for (let k = 0; k < run; k += 1) {
      if (top + k > groundY) break
      p.set(x, top + k, k === 0 ? gore[1] : gore[0])
    }
  }

  // ── Limbs that never went under. Drawn after the depth pass so they keep
  // their own value and read as sticking out of the mass.
  const pokes = Math.min(4, Math.floor(stage * 0.7))
  for (let i = 0; i < pokes; i += 1) {
    const c = corpses.length > 0 ? corpses[(corpses.length - 1 - i * 3 + corpses.length * 3) % corpses.length] : null
    const n = pixelNoise((c?.seed ?? i) * 91 + i * 7717)
    const col = Math.max(1, Math.min(w - 2, Math.round(cx + (n(1, 1) - 0.5) * w * 0.72)))
    const from = Math.max(0, surface[col] + 1)
    const a = -Math.PI / 2 + (n(2, 2) - 0.5) * 2.2
    const len = Math.max(2.5, H * (0.12 + n(3, 3) * 0.2))
    const tones = ramp(mix(c?.mechanical ? 0x7a7f88 : c?.color || CLOTH[i % CLOTH.length], PILE_SHADOW, 0.38), {
      contrast: 1.05
    })
    const ex = col + Math.cos(a) * len
    const ey = from + Math.sin(a) * len
    p.thickLine(col, from, ex, ey, 2, tones[1])
    p.line(col + 1, from, ex + 1, ey, tones[3])
    // A hand, a hoof, a bent strut.
    p.set(Math.round(ex), Math.round(ey), tones[2])
    p.set(Math.round(ex + Math.cos(a + 1.2)), Math.round(ey + Math.sin(a + 1.2)), tones[1])
  }

  // ── The ground gives out underneath. A soaked fringe wider than the mound,
  // so the heap is bedded into the field rather than standing on it.
  const soak = ramp(PILE_SOAK, { hueShift: 0.09, contrast: 1.1, shadowSat: 0.24 })
  for (let x = 0; x < w; x += 1) {
    // Only where the heap actually rests. A fringe drawn to the full width
    // turns a row of mounds into one flat-bottomed slab.
    if (surface[x] > groundY) continue
    const t = Math.abs((x - cx) / (w * 0.5))
    const reach = Math.round((1 - t * t) * 3 + noise(x, 77) * 2)
    for (let i = 0; i <= reach; i += 1) {
      const y = groundY - i
      if (i === 0 || noise(x, y + 3) > 0.25) p.set(x, y, i < 2 ? soak[0] : noise(x, y) > 0.6 ? soak[1] : soak[0])
    }
    // A last dribble past the foot of the mound.
    if (noise(x, 91) > 0.72) p.set(x, groundY, soak[1])
  }

  // ── One silhouette. The outline goes on last, tinted toward whatever it is
  // wrapping, so the heap sits in the scene instead of on it.
  p.outline(outlineTone(PILE_SOAK), { diagonals: false })
  p.tintOutline(0.4)
  return p.toCanvas() as PileCanvas
}

interface Pile {
  col: number
  /** Mound centre in world space. */
  x: number
  /** Ground line the mound stands on. */
  y: number
  count: number
  stage: number
  height: number
  heightSum: number
  corpses: PileCorpse[]
  sprite?: Phaser.GameObjects.Image
  textureKey?: string
}

let debrisInstance = 0

export default class DebrisLayer {
  private scene: Phaser.Scene
  private pool: Phaser.GameObjects.Image[] = []
  private used = 0
  private destroyed = false
  private piles = new Map<number, Pile>()
  private readonly instance: number

  constructor(scene: Phaser.Scene, private depth = 100) {
    this.scene = scene
    debrisInstance += 1
    this.instance = debrisInstance
  }

  private take(): Phaser.GameObjects.Image {
    if (this.used < this.pool.length) {
      const existing = this.pool[this.used]
      this.used += 1
      existing.setVisible(true)
      return existing
    }
    const image = this.scene.add.image(0, 0, 'fx:debris').setDepth(this.depth)
    this.pool.push(image)
    this.used += 1
    return image
  }

  /** Binds one sprite per live body, hiding whatever is left over. */
  render(world: PhysicsWorld): void {
    if (this.destroyed) return
    this.used = 0
    for (const body of world.bodies) {
      if (body.dead) continue
      const sprite = this.take()
      this.apply(sprite, body)
    }
    for (let i = this.used; i < this.pool.length; i += 1) this.pool[i].setVisible(false)
  }

  private apply(sprite: Phaser.GameObjects.Image, body: Body): void {
    if (sprite.texture.key !== body.texture && this.scene.textures.exists(body.texture)) {
      sprite.setTexture(body.texture)
    }
    sprite.setPosition(Math.round(body.x), Math.round(body.y))
    sprite.setOrigin(body.originX, body.originY)
    sprite.setRotation(body.rot)
    sprite.setFlipX(body.flip)
    sprite.setTint(body.color)
    // Settled debris sinks behind the fighting so the field stays readable
    // however much of it accumulates.
    sprite.setDepth(body.settled ? this.depth - 30 : this.depth)
    let scale = body.kind === 'gib' || body.kind === 'scrap' ? body.size : body.size * 0.5
    let alpha = body.ttl < 700 ? Math.max(0, body.ttl / 700) : 1
    if (body.spoil && body.ttlMax) {
      // A SPOIL ROTS WHERE YOU CAN SEE IT.
      //
      // Decay is the rule the whole harvest turns on, and a rule you are merely
      // told about is not a rule you play around. A fresh piece is big and
      // bright; a piece with seconds left is small, dull and half faded, so a
      // commander can look at their own half and tell at a glance which heaps
      // are still worth sending someone to.
      //
      // Worth shows too: a spoil off something expensive is visibly larger.
      const left = Math.max(0, Math.min(1, body.ttl / body.ttlMax))
      const rot = left * left
      scale *= (0.72 + 0.5 * Math.min(1.6, body.worth ?? 1)) * (0.55 + 0.45 * rot)
      alpha = Math.min(alpha, 0.42 + 0.58 * rot)
      sprite.setTint(shade(body.color, -0.55 * (1 - rot)))
    }
    sprite.setScale(scale)
    sprite.setAlpha(alpha)
  }

  // ─────────────────────────── Corpse piles ───────────────────────────

  /**
   * Hands one dead body to the field. The caller is done with it after this:
   * the corpse becomes part of a baked mound rather than a live object.
   *
   * `color` and `seed` are optional; leaving them out gets a deterministic
   * choice made from the position, which is what keeps two peers' heaps
   * identical without any of this touching the simulation.
   */
  addCorpse(
    x: number,
    y: number,
    facing: number,
    unitHeight: number,
    mechanical = false,
    color = 0,
    seed = 0
  ): void {
    if (this.destroyed) return
    const col = Math.floor(x / PILE_COLUMN)
    let pile = this.piles.get(col)
    if (!pile) {
      if (this.piles.size >= MAX_PILES) return
      pile = {
        col,
        x: (col + 0.5) * PILE_COLUMN,
        y,
        count: 0,
        stage: 0,
        height: 0,
        heightSum: 0,
        corpses: []
      }
      this.piles.set(col, pile)
    }
    // The ground line drifts toward wherever bodies are actually falling.
    pile.y = pile.y + (y - pile.y) * 0.35
    pile.count += 1
    pile.heightSum += Math.max(12, unitHeight)
    const record: PileCorpse = {
      dx: x - pile.x,
      facing: facing >= 0 ? 1 : -1,
      height: Math.max(12, unitHeight),
      mechanical,
      color,
      seed: seed || ((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663) ^ (pile.count * 83492791)) >>> 0
    }
    if (pile.corpses.length < PILE_MEMORY) pile.corpses.push(record)
    else pile.corpses[pile.count % PILE_MEMORY] = record

    const stage = pileStageFor(pile.count)
    if (stage !== pile.stage) {
      pile.stage = stage
      pile.height = pileStageHeight(stage, pile.heightSum / pile.count) * pileWobble(pile.col)
      this.rebuild(pile)
    }
  }

  /** Rebakes one mound's decal. Only ever called when it changes stage. */
  private rebuild(pile: Pile): void {
    const key = `pile:${this.instance}:${pile.col}:${pile.stage}`
    if (!this.scene.textures.exists(key)) {
      const canvas = buildPileTexture(
        pile.corpses,
        pile.stage,
        (pile.heightSum / pile.count) * pileWobble(pile.col),
        pile.col
      )
      this.scene.textures.addCanvas(key, canvas.canvas)
    }
    const previous = pile.textureKey
    pile.textureKey = key
    if (!pile.sprite) {
      pile.sprite = this.scene.add
        .image(Math.round(pile.x), Math.round(pile.y) + 2, key)
        .setOrigin(0.5, 1)
        // Above the stains and the settled debris, below the living.
        .setDepth(this.depth - 22)
        .setScale(1 / RES)
    } else {
      pile.sprite.setTexture(key)
      pile.sprite.setPosition(Math.round(pile.x), Math.round(pile.y) + 2)
    }
    if (previous && previous !== key && this.scene.textures.exists(previous)) {
      this.scene.textures.remove(previous)
    }
  }

  /**
   * How high the dead are stacked at a world x, in pixels above the ground.
   * Gameplay can read this as cover — it is derived only from calls the
   * simulation itself made, in the order it made them, so it is safe to.
   */
  pileHeightAt(x: number): number {
    let best = 0
    for (const pile of this.piles.values()) {
      const dx = (x - pile.x) / (PILE_WIDTH * 0.5)
      if (dx <= -1 || dx >= 1) continue
      // Same dome the mound is drawn with, so the number matches the picture.
      const h = pile.height * Math.pow(Math.max(0, 1 - dx * dx), 0.5)
      if (h > best) best = h
    }
    return best
  }

  /** Which growth stage the heap at a world x has reached, 0..PILE_STAGE_COUNT. */
  pileStageAt(x: number): number {
    const pile = this.piles.get(Math.floor(x / PILE_COLUMN))
    return pile ? pile.stage : 0
  }

  /** How many bodies have gone into the heap at a world x. */
  corpseCountAt(x: number): number {
    const pile = this.piles.get(Math.floor(x / PILE_COLUMN))
    return pile ? pile.count : 0
  }

  /** Every mound on the field, for a minimap or a debug overlay. */
  pileSummary(): { x: number; height: number; stage: number; count: number }[] {
    const out: { x: number; height: number; stage: number; count: number }[] = []
    for (const pile of this.piles.values()) {
      out.push({ x: pile.x, height: pile.height, stage: pile.stage, count: pile.count })
    }
    return out
  }

  /** Wipes every mound. Used when a match ends or restarts. */
  clearPiles(): void {
    for (const pile of this.piles.values()) {
      pile.sprite?.destroy()
      if (pile.textureKey && this.scene.textures.exists(pile.textureKey)) {
        this.scene.textures.remove(pile.textureKey)
      }
    }
    this.piles.clear()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.clearPiles()
    this.pool.forEach(s => s.destroy())
    this.pool.length = 0
  }
}
