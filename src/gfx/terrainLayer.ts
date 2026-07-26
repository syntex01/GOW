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

  /** The opening board's furniture, in the house pixel style. */
  private buildPropArt(): void {
    const add = (key: string, p: Pix): void => {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key)
      this.scene.textures.addCanvas(key, p.toCanvasScaled(1).canvas)
    }
    const trunk = ramp(0x6b4a2e, { contrast: 0.7 })
    const leaf = ramp(0x4e7a38, { contrast: 0.75 })
    const tree = new Pix(30, 46)
    for (let y = 26; y < 46; y += 1) {
      tree.set(14, y, trunk[2])
      tree.set(15, y, trunk[3])
      tree.set(16, y, trunk[1])
    }
    tree.set(12, 44, trunk[1]); tree.set(18, 44, trunk[1])
    for (let y = 0; y < 30; y += 1) {
      const t = y / 30
      const w = Math.round(4 + Math.sin(t * Math.PI) * 11)
      for (let x = 15 - w; x <= 15 + w; x += 1) {
        const edge = Math.abs(x - 15) > w - 2
        const lit = x > 15 + w * 0.2 && y < 12
        tree.set(x, y + 2, edge ? leaf[1] : lit ? leaf[3] : (x * 7 + y * 5) % 9 < 2 ? leaf[1] : leaf[2])
      }
    }
    add('prop:tree', tree)

    const stump = new Pix(30, 46)
    for (let y = 38; y < 46; y += 1) { stump.set(14, y, trunk[1]); stump.set(15, y, trunk[2]); stump.set(16, y, trunk[1]) }
    stump.set(14, 37, trunk[3]); stump.set(15, 37, trunk[4]); stump.set(16, 37, trunk[3])
    stump.set(11, 45, trunk[1]); stump.set(19, 45, trunk[1])
    add('prop:tree:dead', stump)

    const wall = ramp(0xa08a68, { contrast: 0.7 })
    const roof = ramp(0x8a5238, { contrast: 0.75 })
    const hut = new Pix(44, 40)
    for (let y = 18; y < 40; y += 1) for (let x = 6; x < 38; x += 1) {
      hut.set(x, y, (x + y) % 11 === 0 ? wall[1] : x > 30 ? wall[1] : wall[2])
    }
    for (let y = 0; y < 18; y += 1) {
      const over = 2 + Math.round((y / 18) * 16)
      for (let x = 22 - over; x <= 22 + over; x += 1) {
        hut.set(x, y + 2, y < 4 ? roof[3] : (x + y) % 7 === 0 ? roof[1] : roof[2])
      }
    }
    for (let y = 26; y < 40; y += 1) for (let x = 18; x < 26; x += 1) hut.set(x, y, tone(wall[0], -0.25))
    add('prop:hut', hut)

    const ruin = new Pix(44, 40)
    for (let x = 6; x < 38; x += 1) {
      const h = 4 + Math.round(Math.abs(Math.sin(x * 1.7)) * 9)
      for (let y = 40 - h; y < 40; y += 1) ruin.set(x, y, (x + y) % 9 === 0 ? wall[0] : wall[1])
    }
    for (let x = 8; x < 38; x += 6) ruin.set(x, 39, tone(wall[0], -0.3))
    add('prop:hut:dead', ruin)
  }

  private refreshProp(index: number): void {
    const prop = this.bf.props[index]
    const sprite = this.propSprites[index]
    if (!prop || !sprite) return
    if (!prop.alive) {
      sprite.setTexture(`prop:${prop.kind}:dead`)
    } else {
      // A hurt tree shivers; a hurt hut just gets dust — the flash says "this
      // is cover and it is being spent".
      sprite.setTint(0xffd9a8)
      this.scene.time.delayedCall(90, () => sprite.clearTint())
    }
  }

  /** Repaints the strips from the sim's relief field, throttled. */
  update(deltaMs: number): void {
    this.sinceRedraw += deltaMs
    if (this.sinceRedraw < 350) return
    this.sinceRedraw = 0
    const scarred = this.bf.terrain.scarring()
    if (scarred === 0 && this.lastScarred === 0) return
    this.lastScarred = scarred

    const era = this.bf.era
    const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, era))]
    const soil = ramp(mix(theme.groundDark, theme.ground, 0.35), { contrast: 0.75 })
    const leanTint: Record<string, number> = {
      carnage: 0x6e2a24,
      ordnance: 0x2c2622,
      engineering: 0x5c6066,
      occult: 0x4c3a66,
      blight: 0x3e6e34
    }
    const playerLean = this.bf.leanOf('player')
    const enemyLean = this.bf.leanOf('enemy')
    const mid = this.bf.terrain.width / 2

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const key = `terrain:lane:${lane}`
      const canvas = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture
      const ctx = canvas.context
      const relief = this.bf.terrain.laneRelief(lane)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < relief.length; i += 1) {
        const h = relief[i]
        if (Math.abs(h) < 1.5) continue
        const x = i * RELIEF_BUCKET
        const lean: TechBranchLean = x < mid ? playerLean : enemyLean
        const tint = lean ? leanTint[lean] : null
        if (h > 0) {
          // A mound: lit crest, earthen body, dark footing — and the colour of
          // whoever's war built it creeping over the top by the late eras.
          const top = TerrainLayer.UP - Math.round(h)
          const wob = (i * 13) % 3
          ctx.fillStyle = hex(soil[3])
          ctx.fillRect(x, top + wob, RELIEF_BUCKET, 2)
          ctx.fillStyle = hex(soil[2])
          ctx.fillRect(x, top + wob + 2, RELIEF_BUCKET, Math.max(0, Math.round(h) - 4))
          ctx.fillStyle = hex(soil[1])
          ctx.fillRect(x, TerrainLayer.UP - 3, RELIEF_BUCKET, 3)
          if (tint && era >= 2 && (i * 7) % 5 < 2) {
            ctx.fillStyle = hex(mix(tint, soil[3], 0.3))
            ctx.fillRect(x + (i % 3) * 2, top + wob, 2, 2)
          }
          if ((i * 11) % 7 === 0 && h > 8) {
            // A pale fleck of bone where the mound is old enough to be one.
            ctx.fillStyle = hex(tone(soil[4], 0.25))
            ctx.fillRect(x + 3, top + wob + 3, 2, 1)
          }
        } else {
          // A crater: a dark bowl bitten below the road line, a scorched lip.
          const depth = Math.round(-h)
          ctx.fillStyle = hex(tone(soil[0], -0.25))
          ctx.fillRect(x, TerrainLayer.UP, RELIEF_BUCKET, depth)
          ctx.fillStyle = hex(soil[0])
          ctx.fillRect(x, TerrainLayer.UP + depth - 2, RELIEF_BUCKET, 2)
          ctx.fillStyle = hex(mix(tint ?? 0x241c16, soil[1], 0.45))
          ctx.fillRect(x, TerrainLayer.UP - 2, RELIEF_BUCKET, 2)
        }
      }
      canvas.refresh()
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
