import Phaser from 'phaser'
import { save } from '../core/save'
import { AGE_THEMES } from './palette'

/**
 * Two-pass 2D lighting.
 *
 * The shade pass fills a dynamic texture with the age's ambient darkness and
 * then *erases* soft blobs wherever a light sits, so lit pockets punch through
 * the gloom. The glow pass adds coloured light on top. Together they turn a
 * flat side-view into something with depth and mood, and make muzzle flashes,
 * explosions and energy weapons genuinely illuminate the battlefield.
 */

export interface AmbientSpec {
  /** Colour of the unlit areas. */
  color: number
  /** How dark the unlit areas get, 0..1. */
  strength: number
}

/** Per-age mood. Night-time ages get a much stronger ambient. */
const AMBIENT: AmbientSpec[] = [
  { color: 0x2a1030, strength: 0.5 }, // Stone — dusk, warm shadows
  { color: 0x05101f, strength: 0.66 }, // Medieval — night blue
  { color: 0x141728, strength: 0.54 }, // Renaissance — overcast rain
  { color: 0x0d1219, strength: 0.5 }, // Modern — grey haze
  { color: 0x04050f, strength: 0.76 } // Future — deep night, neon reads
]

/** Number of bands used to ramp the shadow in from the horizon. */
const GRADIENT_BANDS = 14

interface Light {
  x: number
  y: number
  radius: number
  color: number
  intensity: number
}

// Unique per instance: two scenes can briefly overlap during a transition,
// and sharing a texture key means one scene's teardown pulls the texture out
// from under the other's still-live Image.
let lightingInstance = 0

export default class Lighting {
  private scene: Phaser.Scene
  private shadeTexture: Phaser.Textures.DynamicTexture | null = null
  private glowTexture: Phaser.Textures.DynamicTexture | null = null
  private shadeImage?: Phaser.GameObjects.Image
  private glowImage?: Phaser.GameObjects.Image
  private eraser?: Phaser.GameObjects.Image
  private lights: Light[] = []
  private ambient: AmbientSpec = AMBIENT[0]
  /** Screen Y where the shadow starts fading in. */
  private horizonY: number
  private flicker = 0
  private enabled: boolean
  private width: number
  private height: number
  private destroyed = false
  /** Width of the falloff stamp, so the scale maths follows the texture. */
  private stampSize = 192
  private readonly shadeKey: string
  private readonly glowKey: string

  constructor(scene: Phaser.Scene, depth = 700, horizonY?: number) {
    this.scene = scene
    this.width = scene.cameras.main.width
    this.height = scene.cameras.main.height
    // Above the horizon the sky already carries its own gradient; darkening it
    // as well just turns the whole frame to mud.
    this.horizonY = horizonY ?? this.height * 0.34
    lightingInstance += 1
    this.shadeKey = `lighting:shade:${lightingInstance}`
    this.glowKey = `lighting:glow:${lightingInstance}`
    this.enabled = save.settings.particleQuality !== 'low'

    if (!this.enabled) return

    const textures = scene.textures
    this.shadeTexture = textures.addDynamicTexture(this.shadeKey, this.width, this.height)
    this.glowTexture = textures.addDynamicTexture(this.glowKey, this.width, this.height)
    if (!this.shadeTexture || !this.glowTexture) {
      this.enabled = false
      return
    }

    this.shadeImage = scene.add
      .image(0, 0, this.shadeKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth)
    this.glowImage = scene.add
      .image(0, 0, this.glowKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setBlendMode(Phaser.BlendModes.ADD)

    // One off-screen stamp reused for every light, so no per-frame allocation.
    this.eraser = scene.make.image({ key: GLOW_STAMP_KEY, add: false })
    this.stampSize = this.eraser.width || 192
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setAge(age: number): void {
    this.ambient = AMBIENT[Math.max(0, Math.min(AMBIENT.length - 1, age))]
    void AGE_THEMES
  }

  /**
   * Queues a light for this frame. Lights are transient by design: callers
   * re-add them every frame while the source exists.
   */
  add(x: number, y: number, radius: number, color: number, intensity = 1): void {
    if (!this.enabled || this.lights.length > 90) return
    this.lights.push({ x, y, radius, color, intensity })
  }

  /** A light that breathes, for braziers, reactors and other standing sources. */
  addFlickering(x: number, y: number, radius: number, color: number, intensity = 1, phase = 0): void {
    const wobble = 0.86 + Math.sin(this.flicker * 3.1 + phase) * 0.09 + Math.sin(this.flicker * 7.7 + phase) * 0.05
    this.add(x, y, radius * wobble, color, intensity * wobble)
  }

  /** A one-frame burst, for muzzle flashes and impacts. */
  flash(x: number, y: number, radius: number, color: number, intensity = 1): void {
    this.add(x, y, radius, color, intensity)
  }

  /**
   * Composites both passes. `scrollX` converts world coordinates into the
   * screen-space the light textures live in.
   */
  render(scrollX: number, scrollY: number): void {
    if (!this.enabled || this.destroyed) return
    const shade = this.shadeTexture
    const glow = this.glowTexture
    const eraser = this.eraser
    if (!shade || !glow || !eraser) return

    this.flicker += 0.016

    shade.clear()
    // Ramp the shadow in from the horizon so the sky keeps its own colour and
    // the ground reads as genuinely dark.
    const bandHeight = (this.height - this.horizonY) / GRADIENT_BANDS
    for (let i = 0; i < GRADIENT_BANDS; i += 1) {
      const t = (i + 1) / GRADIENT_BANDS
      shade.fill(
        this.ambient.color,
        this.ambient.strength * (0.25 + 0.75 * t),
        0,
        this.horizonY + i * bandHeight,
        this.width,
        bandHeight + 1
      )
    }
    glow.clear()

    for (const light of this.lights) {
      const sx = light.x - scrollX
      const sy = light.y - scrollY
      // Skip anything comfortably off screen.
      if (sx < -light.radius || sx > this.width + light.radius) continue
      if (sy < -light.radius || sy > this.height + light.radius) continue

      const scale = (light.radius * 2) / this.stampSize
      eraser.setScale(scale).setAlpha(Math.min(1, light.intensity * 1.25))
      shade.erase(eraser, sx, sy)

      glow.stamp(GLOW_STAMP_KEY, '__BASE', sx, sy, {
        alpha: Math.min(0.85, light.intensity * 0.6),
        tint: light.color,
        scaleX: scale * 0.75,
        scaleY: scale * 0.75,
        blendMode: Phaser.BlendModes.ADD
      })
    }

    this.lights.length = 0
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.shadeImage?.destroy()
    this.glowImage?.destroy()
    this.eraser?.destroy()
    const textures = this.scene.textures
    if (textures.exists(this.shadeKey)) textures.remove(this.shadeKey)
    if (textures.exists(this.glowKey)) textures.remove(this.glowKey)
    this.shadeTexture = null
    this.glowTexture = null
  }
}

const GLOW_STAMP_KEY = 'fx:light'
