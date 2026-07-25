import Phaser from 'phaser'
import { save } from '../core/save'
import { AGE_THEMES } from './palette'
import { css, shade } from './painter'

const RIDGE_SCROLL = [0.1, 0.24, 0.45]

/**
 * Layered parallax world: sky gradient, sun, drifting clouds, three ridge
 * bands, the battlefield floor, and per-age weather. Re-themable at runtime so
 * evolving an age visibly changes the world.
 */
export default class Background {
  private scene: Phaser.Scene
  private worldWidth: number
  private groundY: number

  private sky!: Phaser.GameObjects.Graphics
  private sun!: Phaser.GameObjects.Image
  private clouds: Phaser.GameObjects.Image[] = []
  private ridges: Phaser.GameObjects.TileSprite[] = []
  private ground!: Phaser.GameObjects.TileSprite
  private groundShade!: Phaser.GameObjects.Graphics
  private weather?: Phaser.GameObjects.Particles.ParticleEmitter
  private vignette!: Phaser.GameObjects.Image
  private age = -1
  private time = 0

  constructor(scene: Phaser.Scene, worldWidth: number, groundY: number) {
    this.scene = scene
    this.worldWidth = worldWidth
    this.groundY = groundY
    this.build()
  }

  private build(): void {
    const cam = this.scene.cameras.main
    const w = cam.width
    const h = cam.height

    this.sky = this.scene.add.graphics().setScrollFactor(0).setDepth(-1000)

    this.sun = this.scene.add
      .image(w * 0.72, h * 0.2, 'sky:sun')
      .setScrollFactor(0.02)
      .setDepth(-990)
      .setScale(0.85)
      .setBlendMode(Phaser.BlendModes.ADD)

    // Deliberately faint: clouds add depth, but at high alpha they flatten the
    // whole scene into a haze.
    for (let i = 0; i < 5; i += 1) {
      const cloud = this.scene.add
        .image(Math.random() * this.worldWidth, h * (0.07 + Math.random() * 0.24), 'sky:cloud')
        .setScrollFactor(0.06)
        .setDepth(-980)
        .setScale(0.55 + Math.random() * 0.7)
        .setAlpha(0.1 + Math.random() * 0.14)
      this.clouds.push(cloud)
    }

    for (let i = 0; i < 3; i += 1) {
      const heights = [300, 260, 220]
      const yOffsets = [0.62, 0.74, 0.86]
      const ridge = this.scene.add
        .tileSprite(0, this.groundY - h * (1 - yOffsets[i]) * 0.6, w, heights[i], 'ridge:0:0')
        .setOrigin(0, 1)
        .setScrollFactor(0)
        .setDepth(-970 + i)
      this.ridges.push(ridge)
    }

    this.ground = this.scene.add
      .tileSprite(0, this.groundY, w, h - this.groundY + 40, 'ground:0')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-900)

    this.groundShade = this.scene.add.graphics().setScrollFactor(0).setDepth(-899)

    this.vignette = this.scene.add
      .image(w / 2, h / 2, 'fx:vignette')
      .setScrollFactor(0)
      .setDepth(900)
      .setDisplaySize(w, h)
  }

  setAge(age: number): void {
    const clamped = Math.max(0, Math.min(AGE_THEMES.length - 1, age))
    if (clamped === this.age) return
    this.age = clamped
    const theme = AGE_THEMES[clamped]
    const cam = this.scene.cameras.main
    const w = cam.width
    const h = cam.height

    this.sky.clear()
    const bands = 48
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1)
      const color =
        t < 0.55
          ? Phaser.Display.Color.Interpolate.ColorWithColor(
              Phaser.Display.Color.IntegerToColor(theme.sky[0]),
              Phaser.Display.Color.IntegerToColor(theme.sky[1]),
              100,
              Math.round((t / 0.55) * 100)
            )
          : Phaser.Display.Color.Interpolate.ColorWithColor(
              Phaser.Display.Color.IntegerToColor(theme.sky[1]),
              Phaser.Display.Color.IntegerToColor(theme.sky[2]),
              100,
              Math.round(((t - 0.55) / 0.45) * 100)
            )
      this.sky.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1)
      this.sky.fillRect(0, (h * i) / bands - 1, w, h / bands + 2)
    }

    this.sun.setTint(shade(theme.sun, -0.5))
    this.clouds.forEach(c => c.setTint(shade(theme.fog, -0.2)))

    this.ridges.forEach((ridge, i) => {
      ridge.setTexture(`ridge:${clamped}:${i}`)
      ridge.setAlpha(i === 0 ? 0.72 : i === 1 ? 0.88 : 1)
    })

    this.ground.setTexture(`ground:${clamped}`)

    // Ground fog band so units read against the floor.
    this.groundShade.clear()
    this.groundShade.fillGradientStyle(theme.fog, theme.fog, theme.fog, theme.fog, 0.13, 0.13, 0, 0)
    this.groundShade.fillRect(0, this.groundY - 90, w, 90)

    this.applyWeather(theme.weather)
  }

  private applyWeather(kind: string): void {
    this.weather?.destroy()
    this.weather = undefined
    if (save.settings.particleQuality === 'low') return

    const cam = this.scene.cameras.main
    const density = save.settings.particleQuality === 'high' ? 1 : 0.5
    const zone = new Phaser.Geom.Rectangle(-50, -80, cam.width + 100, 40)

    switch (kind) {
      case 'rain':
        this.weather = this.scene.add.particles(0, 0, 'fx:rain', {
          emitZone: { type: 'random', source: zone, quantity: 1 },
          lifespan: 1400,
          speedY: { min: 700, max: 900 },
          speedX: { min: -140, max: -80 },
          scaleX: 1,
          scaleY: { min: 0.8, max: 1.6 },
          alpha: { start: 0.45, end: 0.1 },
          quantity: Math.round(3 * density),
          frequency: 26,
          tint: 0xbcd3e0,
          blendMode: Phaser.BlendModes.ADD
        })
        break
      case 'snow':
        this.weather = this.scene.add.particles(0, 0, 'fx:soft', {
          emitZone: { type: 'random', source: zone, quantity: 1 },
          lifespan: 6000,
          speedY: { min: 30, max: 70 },
          speedX: { min: -30, max: 30 },
          scale: { min: 0.03, max: 0.09 },
          alpha: { start: 0.7, end: 0 },
          quantity: Math.round(2 * density),
          frequency: 90,
          tint: 0xd7d0ff
        })
        break
      case 'ash':
        this.weather = this.scene.add.particles(0, 0, 'fx:soft', {
          emitZone: { type: 'random', source: zone, quantity: 1 },
          lifespan: 7000,
          speedY: { min: 18, max: 46 },
          speedX: { min: -46, max: -12 },
          scale: { min: 0.02, max: 0.06 },
          alpha: { start: 0.45, end: 0 },
          quantity: Math.round(2 * density),
          frequency: 110,
          tint: 0xbfc6c9
        })
        break
      case 'embers':
        this.weather = this.scene.add.particles(0, 0, 'fx:soft', {
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-50, cam.height * 0.55, cam.width + 100, cam.height * 0.4),
            quantity: 1
          },
          lifespan: 4200,
          speedY: { min: -70, max: -26 },
          speedX: { min: -20, max: 20 },
          scale: { min: 0.02, max: 0.055 },
          alpha: { start: 0.9, end: 0 },
          quantity: Math.round(1 * density),
          frequency: 140,
          tint: [0xff9a3d, 0xffd07a],
          blendMode: Phaser.BlendModes.ADD
        })
        break
      default:
        break
    }
    this.weather?.setScrollFactor(0).setDepth(880)
  }

  /** Called every frame with the camera scroll so layers slide at their own rate. */
  update(delta: number, scrollX: number): void {
    this.time += delta

    this.ridges.forEach((ridge, i) => {
      ridge.tilePositionX = scrollX * RIDGE_SCROLL[i]
    })
    this.ground.tilePositionX = scrollX

    const w = this.scene.cameras.main.width
    this.clouds.forEach((cloud, i) => {
      cloud.x -= (4 + i * 2.4) * (delta / 1000)
      const drawX = cloud.x - scrollX * 0.06
      if (drawX < -260) cloud.x += w + 520
    })

    // A gentle heat shimmer on the sun.
    this.sun.setScale(0.85 + Math.sin(this.time / 900) * 0.025)
  }

  /** Briefly washes the sky when a special ability fires. */
  flashSky(color: number, intensity = 0.5, durationMs = 260): void {
    const cam = this.scene.cameras.main
    const flash = this.scene.add
      .rectangle(0, 0, cam.width, cam.height, color, intensity)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(895)
      .setBlendMode(Phaser.BlendModes.ADD)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: durationMs,
      onComplete: () => flash.destroy()
    })
  }

  destroy(): void {
    this.weather?.destroy()
    this.sky.destroy()
    this.sun.destroy()
    this.clouds.forEach(c => c.destroy())
    this.ridges.forEach(r => r.destroy())
    this.ground.destroy()
    this.groundShade.destroy()
    this.vignette.destroy()
  }
}

/** Convenience for UI code that wants an age's accent colour as a CSS string. */
export function ageAccentCss(age: number): string {
  const theme = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, age))]
  return css(shade(theme.fog, 0.2))
}
