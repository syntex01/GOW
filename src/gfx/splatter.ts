import Phaser from 'phaser'
import { save } from '../core/save'
import { rng } from '../core/rng'

/**
 * The permanent mess.
 *
 * Everything that lands wetly, burns, or breaks leaves a mark here, and the
 * marks stay for the rest of the match. A battlefield that remembers where the
 * fighting happened does more for the feel of a long game than any amount of
 * transient particle work: by the fifth minute the ground in front of a
 * contested fortress is black with it, and you can read the history of the
 * match off the floor.
 *
 * This layer is *purely cosmetic*. Gameplay reads the gore map the simulation
 * keeps instead, because stains have to be identical on both peers in a
 * networked match and a texture is not something you can hash cheaply.
 */

/** How far above the ground line the layer reaches, for wall splatter. */
const ABOVE_GROUND = 260
/** How far below, so stains sit under the units' feet. */
const BELOW_GROUND = 60

export type SplatKind = 'blood' | 'scorch' | 'oil' | 'dust'

const VARIANTS: Record<SplatKind, number> = { blood: 6, scorch: 4, oil: 3, dust: 3 }

let splatterInstance = 0

export default class Splatter {
  private scene: Phaser.Scene
  private texture: Phaser.Textures.DynamicTexture | null = null
  private image?: Phaser.GameObjects.Image
  private readonly key: string
  private readonly originY: number
  private enabled: boolean
  private destroyed = false
  /** Stamps applied this frame, so a massacre cannot stall the renderer. */
  private budget = 0
  private stampsThisFrame = 0

  constructor(scene: Phaser.Scene, worldWidth: number, groundY: number, depth = 70) {
    this.scene = scene
    splatterInstance += 1
    this.key = `splatter:${splatterInstance}`
    this.originY = groundY - ABOVE_GROUND
    this.enabled = save.settings.particleQuality !== 'low'
    this.budget = save.settings.particleQuality === 'high' ? 26 : 12

    if (!this.enabled) return
    const height = ABOVE_GROUND + BELOW_GROUND
    this.texture = scene.textures.addDynamicTexture(this.key, worldWidth, height)
    if (!this.texture) {
      this.enabled = false
      return
    }
    // Stains accumulate, so the texture is never cleared after this point.
    this.texture.clear()
    this.image = scene.add.image(0, this.originY, this.key).setOrigin(0, 0).setDepth(depth)
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Call once per frame so the per-frame stamp budget refills. */
  beginFrame(): void {
    this.stampsThisFrame = 0
  }

  /**
   * Marks the ground or a wall.
   *
   * `speed` decides the character of the mark: a body that arrives slowly
   * leaves a compact pool, one that arrives fast leaves a long streak thrown
   * in its direction of travel. That single rule is most of what makes the
   * floor look like something happened on it rather than like a texture.
   */
  stamp(
    x: number,
    y: number,
    kind: SplatKind,
    scale: number,
    speed = 0,
    angle = 0,
    alpha = 1
  ): void {
    const texture = this.texture
    if (!texture || this.destroyed) return
    if (this.stampsThisFrame >= this.budget) return
    this.stampsThisFrame += 1

    const localY = y - this.originY
    if (localY < -20 || localY > texture.height + 20) return

    const variant = rng.int(0, VARIANTS[kind] - 1)
    const stretch = 1 + Math.min(2.2, speed / 420)
    texture.stamp(`splat:${kind}:${variant}`, '__BASE', x, localY, {
      alpha,
      // Stretched along the direction of travel, so a fast impact reads as a
      // streak rather than a bigger circle.
      scaleX: scale * stretch,
      scaleY: scale / Math.sqrt(stretch),
      rotation: angle,
      erase: false
    })
  }

  /** A long smear, used where something skidded rather than landed. */
  smear(x0: number, y0: number, x1: number, y1: number, kind: SplatKind, scale: number): void {
    const steps = Math.min(8, Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 12)))
    const angle = Math.atan2(y1 - y0, x1 - x0)
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      this.stamp(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        kind,
        scale * (1 - t * 0.5),
        260,
        angle,
        0.75
      )
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.image?.destroy()
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key)
    this.texture = null
  }
}
