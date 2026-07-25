import Phaser from 'phaser'
import { save } from '../core/save'
import { AGE_THEMES } from './palette'
import { css, shade } from './painter'
import { RES } from './pixel'

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

  private sky!: Phaser.GameObjects.Image
  private sun!: Phaser.GameObjects.Image
  private clouds: Phaser.GameObjects.Image[] = []
  private ridges: Phaser.GameObjects.TileSprite[] = []
  private ground!: Phaser.GameObjects.TileSprite
  private groundShade!: Phaser.GameObjects.Graphics
  private foreground!: Phaser.GameObjects.TileSprite
  private motes?: Phaser.GameObjects.Particles.ParticleEmitter
  private weather?: Phaser.GameObjects.Particles.ParticleEmitter
  private vignette!: Phaser.GameObjects.Image
  private age = -1
  private time = 0
  private destroyed = false

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

    // The sky is a pre-dithered texture rather than a gradient: a smooth blend
    // is the one thing that would give the whole pixel-art scene away.
    this.sky = this.scene.add
      .image(0, 0, 'sky:0')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-1000)
      .setDisplaySize(w, h)

    this.sun = this.scene.add
      .image(w * 0.72, h * 0.2, 'sky:sun')
      .setScrollFactor(0.02)
      .setDepth(-990)
      .setScale(1.4)
      .setBlendMode(Phaser.BlendModes.ADD)

    // Deliberately faint: clouds add depth, but at high alpha they flatten the
    // whole scene into a haze.
    for (let i = 0; i < 5; i += 1) {
      const cloud = this.scene.add
        .image(Math.random() * this.worldWidth, h * (0.07 + Math.random() * 0.24), 'sky:cloud')
        .setScrollFactor(0.06)
        .setDepth(-980)
        .setScale(1 / RES)
        .setAlpha(0.12 + Math.random() * 0.16)
      this.clouds.push(cloud)
    }

    // Every band reaches down to the ground line. Staggering their bottoms
    // instead leaves a horizontal seam across the screen wherever one band
    // ends and the one in front of it has not started yet.
    const crests = [81, 173, 265]
    for (let i = 0; i < 3; i += 1) {
      const bottom = this.groundY + 8
      const ridge = this.scene.add
        .tileSprite(0, bottom, w, bottom - crests[i], 'ridge:0:0')
        .setOrigin(0, 1)
        .setScrollFactor(0)
        .setDepth(-970 + i)
      ridge.setTileScale(1 / RES, 1 / RES)
      this.ridges.push(ridge)
    }

    this.ground = this.scene.add
      .tileSprite(0, this.groundY, w, h - this.groundY + 40, 'ground:0')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-900)
    this.ground.setTileScale(1 / RES, 1 / RES)

    this.groundShade = this.scene.add.graphics().setScrollFactor(0).setDepth(-899)

    // Sits in front of everything except the vignette, and scrolls faster than
    // the world so it reads as being very close to the camera.
    this.foreground = this.scene.add
      .tileSprite(0, this.groundY + 62, w, 110, 'fg:0')
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(760)
    this.foreground.setTileScale(1 / RES, 1 / RES)

    if (save.settings.particleQuality === 'high') {
      this.motes = this.scene.add
        .particles(0, 0, 'fx:soft', {
          emitZone: {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-40, h * 0.45, w + 80, h * 0.5),
            quantity: 1
          },
          lifespan: { min: 4000, max: 9000 },
          speedX: { min: -14, max: 10 },
          speedY: { min: -18, max: 6 },
          scale: { min: 0.012, max: 0.035 },
          alpha: { start: 0.3, end: 0, ease: 'Sine.easeInOut' },
          frequency: 190,
          quantity: 1,
          blendMode: Phaser.BlendModes.ADD
        })
        .setScrollFactor(0)
        .setDepth(770)
    }

    this.vignette = this.scene.add
      .image(w / 2, h / 2, 'fx:vignette')
      .setScrollFactor(0)
      .setDepth(900)
      .setDisplaySize(w, h)
  }

  setAge(age: number): void {
    if (this.destroyed) return
    const clamped = Math.max(0, Math.min(AGE_THEMES.length - 1, age))
    if (clamped === this.age) return
    this.age = clamped
    const theme = AGE_THEMES[clamped]
    const cam = this.scene.cameras.main
    const w = cam.width
    const h = cam.height

    this.sky.setTexture(`sky:${clamped}`).setDisplaySize(w, h)

    this.sun.setTint(shade(theme.sun, -0.5))
    this.clouds.forEach(c => c.setTint(shade(theme.fog, -0.2)))

    this.ridges.forEach((ridge, i) => {
      ridge.setTexture(`ridge:${clamped}:${i}`)
      // Distance is baked into each band's colour, so no alpha tricks here.
      ridge.setAlpha(1)
    })

    this.ground.setTexture(`ground:${clamped}`)
    this.foreground.setTexture(`fg:${clamped}`)
    this.motes?.setParticleTint(shade(theme.fog, 0.25))

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
    // Scene restarts can land an update between teardown and rebuild; touching
    // a destroyed TileSprite throws inside Phaser's UV update.
    if (this.destroyed) return
    this.time += delta

    this.ridges.forEach((ridge, i) => {
      ridge.tilePositionX = scrollX * RIDGE_SCROLL[i]
    })
    this.ground.tilePositionX = scrollX
    // Faster than 1:1 — the closer something is, the more it slides.
    this.foreground.tilePositionX = scrollX * 1.35

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
    if (this.destroyed) return
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
    if (this.destroyed) return
    this.destroyed = true
    this.motes?.destroy()
    this.foreground.destroy()
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
