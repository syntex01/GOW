import Phaser from 'phaser'
import { AGE_THEMES } from './palette'
import Pix, { mix, ramp, tone } from './pixel'
import type Battlefield from '../sim/battlefield'
import { RELIEF_BUCKET } from '../sim/terrain'
import { LANE_COUNT, LANE_Y, type TechBranchLean } from '../sim/types'

/**
 * Draws what the war has made of the ground.
 *
 * One canvas strip per lane, repainted a couple of times a second from the
 * simulation's relief field: mounds of settled dead rising out of the road,
 * crater bowls bitten into it, and the tint of whichever direction each
 * commander has leant — mycelium green creeping over a Blight half, char and
 * embers over a Cinder one. The strips are world-locked like the floor, so
 * nothing here can slide against the soldiers standing on it.
 *
 * It also owns the standing props — the trees and huts of the clean opening
 * board — and swaps them to stumps and rubble when the sim knocks them down.
 */
export default class TerrainLayer {
  private scene: Phaser.Scene
  private bf: Battlefield
  private strips: Phaser.GameObjects.Image[] = []
  private propSprites: Phaser.GameObjects.Image[] = []
  private sinceRedraw = 0
  private lastScarred = -1
  /** Redraw counter, used to make embers breathe and wisps sway. */
  private flicker = 0

  /** Strip geometry: this much head-room above the ground line, this much bowl below. */
  private static readonly UP = 30
  private static readonly DOWN = 20

  constructor(scene: Phaser.Scene, bf: Battlefield, groundY: number) {
    this.scene = scene
    this.bf = bf
    const h = TerrainLayer.UP + TerrainLayer.DOWN
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const key = `terrain:lane:${lane}`
      if (scene.textures.exists(key)) scene.textures.remove(key)
      const canvas = scene.textures.createCanvas(key, bf.terrain.width, h)
      canvas?.refresh()
      const img = scene.add
        .image(0, groundY + LANE_Y[lane] - TerrainLayer.UP, key)
        .setOrigin(0, 0)
        .setDepth(60 + lane * 0.2)
      this.strips.push(img)
    }
    this.buildPropArt()
    for (let i = 0; i < bf.props.length; i += 1) {
      const prop = bf.props[i]
      const img = scene.add
        .image(prop.x, groundY + LANE_Y[prop.lane] + 3, `prop:${prop.kind}`)
        .setOrigin(0.5, 1)
        .setDepth(120 + (LANE_Y[prop.lane] + 68) * 0.08 - 0.01)
      this.propSprites.push(img)
    }
    bf.onPropChanged = index => this.refreshProp(index)
  }

  /**
   * The opening board's furniture, person-scaled: soldiers stand 60–95px
   * tall, so a tree towers at ~160, a cart comes to the shoulder, a well to
   * the chest, a boulder to the waist. Nothing here should ever read as a
   * miniature again.
   */
  private buildPropArt(): void {
    const add = (key: string, p: Pix): void => {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key)
      this.scene.textures.addCanvas(key, p.toCanvasScaled(1).canvas)
    }
    const trunk = ramp(0x6b4a2e, { contrast: 0.7 })
    const leaf = ramp(0x4e7a38, { contrast: 0.75 })

    // ── The tree: 64×160, trunk a soldier could hide behind. ──
    const TW = 64, TH = 160, tcx = 32
    const tree = new Pix(TW, TH)
    for (let y = 92; y < TH; y += 1) {
      const w = 3 + Math.round((y - 92) / 34)
      for (let x = tcx - w; x <= tcx + w; x += 1) {
        tree.set(x, y, x < tcx - w + 2 ? trunk[1] : x > tcx + w - 2 ? trunk[1] : x < tcx ? trunk[2] : trunk[3])
      }
    }
    // Root flare.
    for (const [dx, len] of [[-7, 4], [7, 4], [-10, 2], [10, 2]]) {
      for (let k = 0; k < len; k += 1) tree.set(tcx + dx, TH - 1 - k, trunk[1])
    }
    // A branch either side, holding up the canopy.
    for (let k = 0; k < 12; k += 1) {
      tree.set(tcx - 6 - k, 88 - Math.round(k * 0.7), trunk[2])
      tree.set(tcx - 5 - k, 88 - Math.round(k * 0.7), trunk[1])
      tree.set(tcx + 6 + k, 84 - Math.round(k * 0.5), trunk[2])
    }
    // The canopy: a big irregular dome, lit from the right.
    for (let y = 0; y < 96; y += 1) {
      const t = y / 96
      const w = Math.round(Math.sin(Math.min(1, t * 1.15) * Math.PI) * 30) + (((y * 7) % 5) - 2)
      if (w <= 0) continue
      for (let x = tcx - w; x <= tcx + w; x += 1) {
        if (x < 0 || x >= TW) continue
        const edge = Math.abs(x - tcx) > w - 3
        const lit = x > tcx + w * 0.15 && y < 40
        const hole = ((x * 13 + y * 7) % 31) === 0
        if (hole) continue
        tree.set(x, y + 2, edge ? leaf[1] : lit ? leaf[3] : (x * 7 + y * 5) % 9 < 2 ? leaf[1] : leaf[2])
      }
    }
    add('prop:tree', tree)

    // The stump and the fallen crown beside it.
    const stump = new Pix(TW, TH)
    for (let y = TH - 22; y < TH; y += 1) {
      const w = 4 + Math.round((y - (TH - 22)) / 10)
      for (let x = tcx - w; x <= tcx + w; x += 1) stump.set(x, y, x < tcx ? trunk[1] : trunk[2])
    }
    for (let x = tcx - 4; x <= tcx + 4; x += 1) stump.set(x, TH - 23, trunk[4])
    stump.set(tcx - 2, TH - 23, trunk[3]); stump.set(tcx + 1, TH - 23, trunk[3])
    // The felled trunk lying to one side.
    for (let x = 2; x < tcx - 8; x += 1) {
      const y = TH - 6 + ((x % 7) === 0 ? -1 : 0)
      stump.set(x, y, trunk[2]); stump.set(x, y + 1, trunk[1])
    }
    add('prop:tree:dead', stump)

    // ── The well: 40×58, chest-high stone ring, posts and a little roof. ──
    const stone = ramp(0x8a8a92, { contrast: 0.7 })
    const wood = ramp(0x7a5a36, { contrast: 0.7 })
    const well = new Pix(40, 58)
    for (let y = 34; y < 58; y += 1) for (let x = 6; x < 34; x += 1) {
      const ring = y < 38 || x < 10 || x >= 30
      if (!ring) continue
      well.set(x, y, ((x >> 2) + (y >> 2)) % 2 === 0 ? stone[2] : stone[1])
    }
    for (let x = 6; x < 34; x += 1) well.set(x, 34, stone[3])
    for (let y = 38; y < 54; y += 1) for (let x = 11; x < 29; x += 1) well.set(x, y, tone(stone[0], -0.4))
    for (let y = 10; y < 34; y += 1) { well.set(8, y, wood[2]); well.set(9, y, wood[1]); well.set(30, y, wood[2]); well.set(31, y, wood[1]) }
    for (let y = 0; y < 10; y += 1) {
      const over = 3 + Math.round((y / 10) * 14)
      for (let x = 20 - over; x <= 20 + over; x += 1) {
        if (x < 0 || x >= 40) continue
        well.set(x, y + 2, y < 3 ? wood[3] : (x + y) % 6 === 0 ? wood[1] : wood[2])
      }
    }
    well.set(20, 20, wood[3]) // the rope
    for (let y = 21; y < 30; y += 1) well.set(20, y, tone(wood[0], -0.2))
    add('prop:well', well)

    const wellDead = new Pix(40, 58)
    for (let x = 4; x < 36; x += 1) {
      const h = 3 + Math.round(Math.abs(Math.sin(x * 1.3)) * 7)
      for (let y = 58 - h; y < 58; y += 1) wellDead.set(x, y, (x + y) % 5 === 0 ? stone[0] : stone[1])
    }
    for (let k = 0; k < 8; k += 1) wellDead.set(6 + k, 50 - k, wood[1]) // a fallen post
    add('prop:well:dead', wellDead)

    // ── The cart: 72×52, shoulder-high hay cart on two big wheels. ──
    const hay = ramp(0xc2a24e, { contrast: 0.75 })
    const cart = new Pix(72, 52)
    // Wheels.
    for (const wx of [20, 52]) {
      for (let a = 0; a < 40; a += 1) {
        const ang = (a / 40) * Math.PI * 2
        cart.set(Math.round(wx + Math.cos(ang) * 9), Math.round(40 + Math.sin(ang) * 9), wood[1])
        cart.set(Math.round(wx + Math.cos(ang) * 8), Math.round(40 + Math.sin(ang) * 8), wood[2])
      }
      cart.set(wx, 40, wood[3]); cart.set(wx - 1, 40, wood[1]); cart.set(wx + 1, 40, wood[1])
      for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-4, -4], [4, 4], [-4, 4], [4, -4]]) {
        cart.set(wx + dx, 40 + dy, wood[1])
      }
    }
    // Bed and sideboards.
    for (let y = 26; y < 34; y += 1) for (let x = 6; x < 66; x += 1) {
      cart.set(x, y, y === 26 ? wood[3] : (x % 9) === 0 ? wood[1] : wood[2])
    }
    // The hay load.
    for (let y = 10; y < 26; y += 1) {
      const t = (y - 10) / 16
      const w = Math.round(18 + t * 12)
      for (let x = 36 - w; x <= 36 + w; x += 1) {
        if (x < 7 || x > 65) continue
        cart.set(x, y, (x * 5 + y * 3) % 7 < 2 ? hay[1] : y < 14 ? hay[3] : hay[2])
      }
    }
    // Shafts, resting on the ground.
    for (let k = 0; k < 14; k += 1) cart.set(65 + Math.min(6, k), 34 + Math.round(k * 1.1), wood[1])
    add('prop:cart', cart)

    const cartDead = new Pix(72, 52)
    // One surviving wheel, leaning; planks and spilled hay.
    for (let a = 0; a < 40; a += 1) {
      const ang = (a / 40) * Math.PI * 2
      cartDead.set(Math.round(24 + Math.cos(ang) * 9), Math.round(43 + Math.sin(ang) * 6), wood[1])
    }
    for (let x = 8; x < 64; x += 1) {
      const h = 2 + Math.round(Math.abs(Math.sin(x * 0.9)) * 5)
      for (let y = 52 - h; y < 52; y += 1) cartDead.set(x, y, (x + y) % 4 === 0 ? hay[1] : wood[1])
    }
    for (let k = 0; k < 10; k += 1) cartDead.set(40 + k, 44 - Math.round(k * 0.5), wood[2])
    add('prop:cart:dead', cartDead)

    // ── The boulder: 48×34, waist-high granite. ──
    const rock = ramp(0x84847e, { contrast: 0.7 })
    const boulder = new Pix(48, 34)
    for (let y = 0; y < 34; y += 1) {
      const t = y / 34
      const w = Math.round(Math.sin(Math.min(1, 0.25 + t) * Math.PI * 0.62) * 23) + (((y * 5) % 3) - 1)
      if (w <= 0) continue
      for (let x = 24 - w; x <= 24 + w; x += 1) {
        if (x < 0 || x >= 48) continue
        const edge = Math.abs(x - 24) > w - 2
        const lit = x > 24 + w * 0.2 && y < 14
        boulder.set(x, y, edge ? rock[1] : lit ? rock[3] : (x * 3 + y * 7) % 11 < 2 ? rock[1] : rock[2])
      }
    }
    boulder.set(18, 10, rock[4]); boulder.set(30, 6, rock[4])
    add('prop:boulder', boulder)

    const boulderDead = new Pix(48, 34)
    // Split in two, halves fallen apart.
    for (let y = 20; y < 34; y += 1) {
      const w = Math.round((y - 18) * 0.9)
      for (let x = 12 - w; x <= 12 + w; x += 1) if (x >= 0) boulderDead.set(x, y, x < 12 ? rock[1] : rock[2])
      for (let x = 36 - w; x <= 36 + w; x += 1) if (x < 48) boulderDead.set(x, y, x < 36 ? rock[2] : rock[1])
    }
    add('prop:boulder:dead', boulderDead)
  }

  private refreshProp(index: number): void {
    const prop = this.bf.props[index]
    const sprite = this.propSprites[index]
    if (!prop || !sprite) return
    if (!prop.alive) {
      sprite.setTexture(`prop:${prop.kind}:dead`)
    } else {
      // Alive again (an engineering rebuild) or merely hurt — either way the
      // living art is the right one, and the flash says "this is cover and it
      // is being spent".
      if (sprite.texture.key !== `prop:${prop.kind}`) sprite.setTexture(`prop:${prop.kind}`)
      sprite.setTint(0xffd9a8)
      this.scene.time.delayedCall(90, () => sprite.clearTint())
    }
  }

  /** Repaints the strips from the sim's relief field, throttled. */
  update(deltaMs: number): void {
    this.sinceRedraw += deltaMs
    if (this.sinceRedraw < 350) return
    this.sinceRedraw = 0
    this.flicker = (this.flicker + 1) & 0xffff
    const scarred = this.bf.terrain.scarring()
    if (scarred === 0 && this.lastScarred === 0) return
    this.lastScarred = scarred

    const era = this.bf.era
    const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, era))]
    const soil = ramp(mix(theme.groundDark, theme.ground, 0.35), { contrast: 0.75 })
    const playerLean = this.bf.leanOf('player')
    const enemyLean = this.bf.leanOf('enemy')
    const mid = this.bf.terrain.width / 2

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const key = `terrain:lane:${lane}`
      const canvas = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture
      const ctx = canvas.context
      const relief = this.bf.terrain.laneRelief(lane)
      const haunt = this.bf.terrain.laneHaunt(lane)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < relief.length; i += 1) {
        const h = relief[i]
        const x = i * RELIEF_BUCKET
        // Whose ground rule governs this bucket. Mounds and haunts belong to
        // the half they sit on; a crater belongs to whoever shelled it, which
        // is almost always the *other* commander.
        const halfLean: TechBranchLean = x < mid ? playerLean : enemyLean
        const foeLean: TechBranchLean = x < mid ? enemyLean : playerLean
        if (haunt[i] > 0.15 && halfLean === 'occult') this.drawHaunt(ctx, x, i, haunt[i])
        if (Math.abs(h) < 1.5) continue
        if (h > 0) this.drawMound(ctx, x, i, h, soil, era, halfLean)
        else this.drawCrater(ctx, x, i, -h, soil, foeLean)
      }
      canvas.refresh()
    }
  }

  /**
   * A mound of the settled dead. The base shape is the same everywhere; what
   * the creed of that half has *done* with the mound is what changes:
   * carnage keeps it as meat and bone, engineering terraces it while the
   * quarry eats it, blight grows through it, and everyone else gets soil.
   */
  private drawMound(
    ctx: CanvasRenderingContext2D,
    x: number,
    i: number,
    h: number,
    soil: readonly number[],
    era: number,
    lean: TechBranchLean
  ): void {
    // The sim's relief is in mass units; drawn 1:1 it reads as a smudge.
    // Half again as tall on screen, with a lit crest-edge and a shadowed
    // trailing edge, and a pile of dead finally LOOKS like a pile.
    const hv = Math.min(TerrainLayer.UP - 3, Math.round(h * 1.5))
    const top = TerrainLayer.UP - hv
    const wob = (i * 13) % 3
    const body = Math.max(0, hv - 4)
    // A dark rim above the crest: the silhouette line that makes the pile
    // read as a SHAPE against ground drawn from the same soil family.
    ctx.fillStyle = hex(tone(soil[0], -0.4))
    ctx.fillRect(x, top + wob - 1, RELIEF_BUCKET, 1)

    if (lean === 'carnage') {
      // A flesh mound: raw meat over old blood, ribs surfacing where it is
      // tall enough to be made of what it is made of.
      ctx.fillStyle = hex(mix(0xa03830, soil[3], 0.15))
      ctx.fillRect(x, top + wob, RELIEF_BUCKET, 2)
      ctx.fillStyle = hex(mix(0x6e241e, soil[2], 0.18))
      ctx.fillRect(x, top + wob + 2, RELIEF_BUCKET, body)
      ctx.fillStyle = hex(mix(0xc85a48, soil[4], 0.3))
      ctx.fillRect(x, top + wob, 1, Math.max(2, Math.round(body * 0.6)))
      ctx.fillStyle = hex(0x2e0d0a)
      ctx.fillRect(x + RELIEF_BUCKET - 1, top + wob + 1, 1, Math.max(2, body))
      ctx.fillStyle = hex(mix(0x421611, soil[1], 0.22))
      ctx.fillRect(x, TerrainLayer.UP - 3, RELIEF_BUCKET, 3)
      if (h > 5) {
        // Ribs: pale arcs breaking the surface.
        ctx.fillStyle = hex(0xe8dcc4)
        const rx = x + ((i * 5) % 3)
        ctx.fillRect(rx, top + wob + 1, 2, Math.min(4, body + 1))
        ctx.fillRect(rx + 4, top + wob + 2, 1, Math.min(3, body))
      }
      if (h > 4) {
        // The blood that never dries at the mound's foot.
        ctx.fillStyle = hex(0x58120e)
        ctx.fillRect(x - 1, TerrainLayer.UP - 1, RELIEF_BUCKET + 2, 2)
      }
      return
    }

    if (lean === 'blight') {
      // Overgrowth: moss swallowing the mound, fungal caps on the crest.
      ctx.fillStyle = hex(mix(0x8fd694, soil[3], 0.15))
      ctx.fillRect(x, top + wob, RELIEF_BUCKET, 2)
      ctx.fillStyle = hex(mix(0x47803c, soil[2], 0.2))
      ctx.fillRect(x, top + wob + 2, RELIEF_BUCKET, body)
      ctx.fillStyle = hex(mix(0xb8e0a0, soil[4], 0.3))
      ctx.fillRect(x, top + wob, 1, Math.max(2, Math.round(body * 0.6)))
      ctx.fillStyle = hex(0x16300f)
      ctx.fillRect(x + RELIEF_BUCKET - 1, top + wob + 1, 1, Math.max(2, body))
      ctx.fillStyle = hex(mix(0x2c5426, soil[1], 0.25))
      ctx.fillRect(x, TerrainLayer.UP - 3, RELIEF_BUCKET, 3)
      if (h > 4 && (i * 7) % 3 !== 0) {
        // A fruiting body: stalk and pale cap.
        const fx = x + 2 + ((i * 11) % 3)
        ctx.fillStyle = hex(0xd8f0c0)
        ctx.fillRect(fx - 1, top + wob - 3, 4, 2)
        ctx.fillStyle = hex(0x9fc488)
        ctx.fillRect(fx, top + wob - 1, 2, 3)
      }
      return
    }

    if (lean === 'engineering') {
      // A mound being eaten by the quarry: terraced, staked, half gone.
      ctx.fillStyle = hex(mix(0x7a8494, soil[3], 0.45))
      ctx.fillRect(x, top + wob, RELIEF_BUCKET, 2)
      ctx.fillStyle = hex(mix(0x4a525e, soil[2], 0.4))
      ctx.fillRect(x, top + wob + 2, RELIEF_BUCKET, body)
      // Terrace cuts: hard horizontal steps no natural mound has.
      ctx.fillStyle = hex(0x2b3038)
      for (let step = top + wob + 3; step < TerrainLayer.UP - 2; step += 3) {
        ctx.fillRect(x, step, RELIEF_BUCKET, 1)
      }
      if ((i * 3) % 4 === 0) {
        // A survey stake with a warning cap.
        ctx.fillStyle = hex(0xc8d0d8)
        ctx.fillRect(x + 4, top + wob - 4, 1, 5)
        ctx.fillStyle = hex(0xffb030)
        ctx.fillRect(x + 3, top + wob - 5, 3, 2)
      }
      ctx.fillStyle = hex(soil[1])
      ctx.fillRect(x, TerrainLayer.UP - 3, RELIEF_BUCKET, 3)
      return
    }

    // The default mound: lit crest, earthen body, dark footing, bone flecks
    // once it is old enough — and, for ordnance/occult halves without their
    // own mound style, a faint cast of that creed's colour.
    const cast = lean === 'ordnance' ? 0x2c2622 : lean === 'occult' ? 0x4c3a66 : null
    ctx.fillStyle = hex(cast ? mix(tone(soil[3], 0.2), cast, 0.25) : tone(soil[3], 0.2))
    ctx.fillRect(x, top + wob, RELIEF_BUCKET, 2)
    ctx.fillStyle = hex(cast ? mix(soil[2], cast, 0.25) : soil[2])
    ctx.fillRect(x, top + wob + 2, RELIEF_BUCKET, body)
    // Volume: the key light catches the left shoulder, the right falls off.
    ctx.fillStyle = hex(tone(soil[4], 0.15))
    ctx.fillRect(x, top + wob, 1, Math.max(2, Math.round(body * 0.6)))
    ctx.fillStyle = hex(tone(soil[0], -0.2))
    ctx.fillRect(x + RELIEF_BUCKET - 1, top + wob + 1, 1, Math.max(2, body))
    ctx.fillStyle = hex(soil[1])
    ctx.fillRect(x, TerrainLayer.UP - 3, RELIEF_BUCKET, 3)
    if (cast && era >= 2 && (i * 7) % 5 < 2) {
      ctx.fillStyle = hex(mix(cast, soil[3], 0.3))
      ctx.fillRect(x + (i % 3) * 2, top + wob, 2, 2)
    }
    // The dead showing through: bone flecks from h>5, a skull crown on the
    // tall ones. This is what the mounds are made of; show it.
    if (h > 5 && (i * 11) % 3 !== 1) {
      ctx.fillStyle = hex(0xcfc6ae)
      ctx.fillRect(x + 1 + ((i * 5) % 4), top + wob + 2 + ((i * 3) % 3), 2, 1)
      ctx.fillRect(x + 4 - (i % 2), top + wob + 5 + ((i * 7) % 2), 1, 2)
    }
    if (h > 9 && (i * 13) % 4 === 0) {
      const sx = x + 2 + (i % 3)
      ctx.fillStyle = hex(0xd8d0bc)
      ctx.fillRect(sx, top + wob - 1, 3, 3)
      ctx.fillStyle = hex(0x2a2018)
      ctx.fillRect(sx + 1, top + wob, 1, 1)
    }
  }

  /**
   * A crater. When the commander who dug it leans ordnance it is not a scar,
   * it is a weapon that is still going: embers in the bowl, a charred lip,
   * the no-man's-land the sim actually makes it.
   */
  private drawCrater(
    ctx: CanvasRenderingContext2D,
    x: number,
    i: number,
    depth: number,
    soil: readonly number[],
    diggerLean: TechBranchLean
  ): void {
    const d = Math.round(depth)
    if (diggerLean === 'ordnance') {
      ctx.fillStyle = hex(0x181210)
      ctx.fillRect(x, TerrainLayer.UP, RELIEF_BUCKET, d)
      // Embers still alive down in the bowl, breathing with the redraws.
      const glow = (i * 17 + this.flicker * 3) % 5
      if (glow < 2 && d > 3) {
        ctx.fillStyle = hex(glow === 0 ? 0xe86a20 : 0xa03a10)
        ctx.fillRect(x + 1 + ((i * 7) % 4), TerrainLayer.UP + d - 3, 2, 1)
      }
      // The charred lip.
      ctx.fillStyle = hex(0x241c16)
      ctx.fillRect(x, TerrainLayer.UP - 2, RELIEF_BUCKET, 2)
      ctx.fillStyle = hex(mix(0x3a2c20, soil[1], 0.4))
      ctx.fillRect(x, TerrainLayer.UP + d - 1, RELIEF_BUCKET, 1)
      return
    }
    // An ordinary crater: dark bowl, plain lip, on its way to healing.
    ctx.fillStyle = hex(tone(soil[0], -0.25))
    ctx.fillRect(x, TerrainLayer.UP, RELIEF_BUCKET, d)
    ctx.fillStyle = hex(soil[0])
    ctx.fillRect(x, TerrainLayer.UP + d - 2, RELIEF_BUCKET, 2)
    ctx.fillStyle = hex(mix(0x241c16, soil[1], 0.45))
    ctx.fillRect(x, TerrainLayer.UP - 2, RELIEF_BUCKET, 2)
  }

  /**
   * Haunted ground: where the occult's half consumed a body instead of
   * letting it become a mound. An ash ring, and a wisp that only stands
   * still if you never look twice.
   */
  private drawHaunt(ctx: CanvasRenderingContext2D, x: number, i: number, intensity: number): void {
    // The ash ring where a body used to be.
    ctx.fillStyle = hex(0x46405a)
    ctx.fillRect(x - 1, TerrainLayer.UP - 2, RELIEF_BUCKET + 2, 3)
    ctx.fillStyle = hex(0x2a2438)
    ctx.fillRect(x + 1, TerrainLayer.UP - 1, RELIEF_BUCKET - 2, 1)
    if (intensity > 0.3) {
      // The wisp: a small violet flame that drifts with the flicker counter.
      const sway = (i * 5 + this.flicker) % 3
      const wy = TerrainLayer.UP - 8 - ((i * 3 + this.flicker) % 3)
      ctx.fillStyle = hex(0x8a4fd0)
      ctx.fillRect(x + 2 + sway, wy + 1, 2, 4)
      ctx.fillStyle = hex(0xb46bff)
      ctx.fillRect(x + 2 + sway, wy, 2, 2)
      ctx.fillStyle = hex(0xe8d4ff)
      ctx.fillRect(x + 3 + sway, wy, 1, 1)
    }
  }

  destroy(): void {
    for (const strip of this.strips) strip.destroy()
    for (const sprite of this.propSprites) sprite.destroy()
    this.strips = []
    this.propSprites = []
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}
