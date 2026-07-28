import Phaser from 'phaser'
import { rng } from '../core/rng'
import type Battlefield from '../sim/battlefield'
import { LANE_Y } from '../sim/types'
import Pix, { mix, ramp } from './pixel'

/**
 * The ground war, made visible.
 *
 * Fire, spores and plague are among the most consequential things a doctrine
 * can put on the field — they deny lanes, eat corpses, burn each other off —
 * and until now they were *completely invisible*, which meant half the
 * strategy layer was happening in the dark. Every zone now has a body: a bed
 * of embers, a carpet of growth, a bank of contagion, drawn in the same pixel
 * vocabulary as the terrain and animated by frame-cycling rather than tweens
 * so a hundred of them cost nothing.
 *
 * The art is authored small, once, and stretched per zone; the *motion* comes
 * from swapping between three frames on a per-zone phase, plus a slow ambient
 * mote for anything the player should feel drifting.
 */

const FRAMES = 3
const TILE_W = 64
const TILE_H = 26

type ZoneKind = 'fire' | 'spore' | 'plague'

interface ZoneView {
  body: Phaser.GameObjects.Image
  glow: Phaser.GameObjects.Image
}

export default class ZoneLayer {
  private scene: Phaser.Scene
  private bf: Battlefield
  private groundY: number
  private views: ZoneView[] = []
  private clock = 0
  private moteClock = 0

  constructor(scene: Phaser.Scene, bf: Battlefield, groundY: number) {
    this.scene = scene
    this.bf = bf
    this.groundY = groundY
    this.buildTextures()
  }

  // ─────────────────────────────── the art ───────────────────────────────

  private buildTextures(): void {
    for (const kind of ['fire', 'spore', 'plague'] as ZoneKind[]) {
      for (let f = 0; f < FRAMES; f += 1) {
        const key = `zone:${kind}:${f}`
        if (this.scene.textures.exists(key)) continue
        this.scene.textures.addCanvas(key, this.paint(kind, f).toCanvasScaled(1).canvas)
      }
    }
    if (!this.scene.textures.exists('zone:glow')) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0xffffff, 0.16)
      g.fillEllipse(48, 16, 96, 30)
      g.fillStyle(0xffffff, 0.2)
      g.fillEllipse(48, 16, 60, 18)
      g.generateTexture('zone:glow', 96, 32)
      g.destroy()
    }
  }

  /** One frame of one kind of ground. Deterministic: index-driven, no rolls. */
  private paint(kind: ZoneKind, frame: number): Pix {
    const p = new Pix(TILE_W, TILE_H)
    // How solid this column is: full in the middle, ragged at the rim. A
    // zone is a patch of ground, and patches do not have straight edges.
    const edge = (x: number): number => {
      const t = Math.min(x, TILE_W - 1 - x) / 9
      return Math.min(1, t)
    }
    const solid = (x: number, y: number): boolean => {
      const e = edge(x)
      if (e >= 1) return true
      return ((x * 7 + y * 5 + frame * 3) % 10) / 10 < e
    }
    if (kind === 'fire') {
      // A bed of burning ground: char below, live coals above, licking flame.
      const coal = ramp(0xc03a10, { contrast: 0.9 })
      for (let x = 0; x < TILE_W; x += 1) {
        const crest = 12 + ((x * 7 + frame * 5) % 5)
        for (let y = crest; y < TILE_H; y += 1) {
          if (!solid(x, y)) continue
          const deep = y > crest + 5
          p.set(x, y, deep ? 0x140c08 : mix(0x2a1408, coal[0], 0.5))
        }
        if (!solid(x, crest)) continue
        // Coals: bright pixels that move between frames, so the bed breathes.
        if ((x * 3 + frame * 11) % 7 < 2) {
          p.set(x, crest, coal[4])
          p.set(x, crest + 1, coal[3])
        } else if ((x * 5 + frame * 7) % 9 < 3) {
          p.set(x, crest + 1, coal[2])
        }
        // Flame tongues, only on some columns and only two pixels tall.
        if ((x * 13 + frame * 17) % 11 === 0) {
          p.set(x, crest - 2, 0xffb648)
          p.set(x, crest - 1, 0xff7a20)
        }
      }
    } else if (kind === 'spore') {
      // A carpet of growth: dark moss bed, pale caps, fine fuzz on top.
      const moss = ramp(0x47803c, { contrast: 0.8 })
      for (let x = 0; x < TILE_W; x += 1) {
        const crest = 14 + ((x * 5 + frame * 3) % 4)
        for (let y = crest; y < TILE_H; y += 1) {
          if (!solid(x, y)) continue
          p.set(x, y, y > crest + 4 ? 0x16300f : moss[(x + y) % 2 === 0 ? 1 : 2])
        }
        if (!solid(x, crest)) continue
        if ((x * 7 + frame * 5) % 6 === 0) p.set(x, crest - 1, moss[3])
        // Fruiting caps: stalk and pale head, drifting between frames.
        if ((x * 11 + frame * 13) % 17 === 0) {
          p.set(x, crest - 2, 0x9fc488)
          p.set(x, crest - 3, 0xd8f0c0)
          p.set(x + 1 < TILE_W ? x + 1 : x, crest - 3, 0xd8f0c0)
        }
      }
    } else {
      // Contagion: a low bank of sick air, thicker in places, always moving.
      const sick = ramp(0x6f8f4a, { contrast: 0.6 })
      for (let x = 0; x < TILE_W; x += 1) {
        const top = 8 + ((x * 3 + frame * 9) % 7)
        for (let y = top; y < TILE_H; y += 1) {
          if (!solid(x, y)) continue
          const dense = (x * 5 + y * 3 + frame * 7) % 9 < 4
          if (!dense && y < top + 4) continue
          p.set(x, y, y > TILE_H - 5 ? mix(0x2c3a1c, sick[1], 0.5) : sick[(x + frame) % 2 === 0 ? 2 : 1])
        }
        if ((x * 17 + frame * 5) % 13 === 0) p.set(x, top, 0xbcd89a)
      }
    }
    return p
  }

  // ────────────────────────────── the update ─────────────────────────────

  update(dtMs: number): void {
    this.clock += dtMs
    const zones = this.bf.zones
    // Grow the pool to fit; shrink by hiding, never by churning textures.
    while (this.views.length < zones.length) {
      const body = this.scene.add
        .image(0, 0, 'zone:fire:0')
        .setOrigin(0.5, 1)
        .setDepth(64)
        .setVisible(false)
      const glow = this.scene.add
        .image(0, 0, 'zone:glow')
        .setOrigin(0.5, 0.5)
        .setDepth(63)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
      this.views.push({ body, glow })
    }

    const frame = Math.floor(this.clock / 130)
    for (let i = 0; i < this.views.length; i += 1) {
      const view = this.views[i]
      const zone = zones[i]
      if (!zone || zone.ttl <= 0) {
        view.body.setVisible(false)
        view.glow.setVisible(false)
        continue
      }
      const lane = zone.lane >= 0 ? zone.lane : 2
      const y = this.groundY + LANE_Y[lane] + 4
      // Each zone runs its own phase, so a field of them never pulses in step.
      const f = (frame + i) % FRAMES
      const kind = zone.kind as ZoneKind
      view.body.setTexture(`zone:${kind}:${f}`)
      view.body.setPosition(zone.x, y)
      // Authored 64 wide; stretched to the zone's real diameter so what you
      // see is exactly the ground the simulation is charging for.
      view.body.setDisplaySize(Math.max(24, zone.radius * 2), TILE_H * 2)
      // Fade in on birth, out on death: no zone ever pops.
      const life = Math.min(1, zone.ttl / 900)
      const base = kind === 'plague' ? 0.62 : 0.88
      view.body.setVisible(true).setAlpha(base * life)
      // All-lane zones (a burst that covers the field) sit flatter and wider.
      if (zone.lane < 0) view.body.setDisplaySize(Math.max(24, zone.radius * 2), TILE_H * 1.4)

      const lit = kind === 'fire'
      view.glow
        .setVisible(lit || kind === 'plague')
        .setPosition(zone.x, y - 12)
        .setDisplaySize(Math.max(30, zone.radius * 2.1), 34)
        .setTint(lit ? 0xff7a20 : 0x9fd47a)
        .setAlpha((lit ? 0.5 : 0.16) * life * (0.8 + 0.2 * Math.sin(this.clock / 180 + i)))
    }

    // Ambient: embers climb out of fire, spores drift off growth. Slow, few,
    // and only for zones the camera can actually see.
    this.moteClock += dtMs
    if (this.moteClock < 260) return
    this.moteClock = 0
    const cam = this.scene.cameras.main
    const left = cam.worldView.x - 40
    const right = cam.worldView.right + 40
    for (let i = 0; i < zones.length && i < 24; i += 1) {
      const zone = zones[i]
      if (zone.ttl <= 0 || zone.x < left || zone.x > right) continue
      if ((i + Math.floor(this.clock / 260)) % 3 !== 0) continue
      const lane = zone.lane >= 0 ? zone.lane : 2
      const y = this.groundY + LANE_Y[lane]
      const fire = zone.kind === 'fire'
      const mote = this.scene.add
        .image(zone.x + rng.spread(zone.radius * 1.6), y - 2, 'fx:soft')
        .setDepth(66)
        .setBlendMode(fire ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
        .setTint(fire ? 0xffb648 : zone.kind === 'spore' ? 0xd8f0c0 : 0xbcd89a)
        .setScale(fire ? 0.1 : 0.14)
        .setAlpha(fire ? 0.9 : 0.55)
      this.scene.tweens.add({
        targets: mote,
        y: y - (fire ? 54 : 30) - rng.range(0, 20),
        x: mote.x + rng.spread(fire ? 10 : 26),
        alpha: 0,
        scale: fire ? 0.02 : 0.05,
        duration: fire ? 780 : 1500,
        ease: fire ? 'Sine.easeOut' : 'Sine.easeInOut',
        onComplete: () => mote.destroy()
      })
    }
  }

  destroy(): void {
    for (const view of this.views) {
      view.body.destroy()
      view.glow.destroy()
    }
    this.views.length = 0
  }
}
