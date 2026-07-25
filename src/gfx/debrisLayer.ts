import Phaser from 'phaser'
import type { Body } from '../sim/physics'
import type PhysicsWorld from '../sim/physics'

/**
 * Draws the physics world.
 *
 * The simulation owns where every chunk of a soldier is; this owns what it
 * looks like. Sprites are pooled and re-bound to bodies each frame rather than
 * created and destroyed, because a bad explosion can put a hundred new objects
 * on the field in one sub-step and allocating sprites for them mid-battle is
 * exactly the kind of hitch that makes a game feel cheap.
 */
export default class DebrisLayer {
  private scene: Phaser.Scene
  private pool: Phaser.GameObjects.Image[] = []
  private used = 0
  private destroyed = false

  constructor(scene: Phaser.Scene, private depth = 100) {
    this.scene = scene
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
    const scale = body.kind === 'gib' || body.kind === 'scrap' ? body.size : body.size * 0.5
    sprite.setScale(scale)
    // Short-lived debris fades out rather than blinking away.
    sprite.setAlpha(body.ttl < 700 ? Math.max(0, body.ttl / 700) : 1)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.pool.forEach(s => s.destroy())
    this.pool.length = 0
  }
}
