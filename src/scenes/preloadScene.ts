type ImageAsset = { key: string; url: string }
type SpritesheetAsset = ImageAsset & { frameWidth: number; frameHeight: number }
type AtlasAsset = { key: string; textureURL: string; atlasURL: string }

type AssetManifest = {
  images?: ImageAsset[]
  spritesheets?: SpritesheetAsset[]
  audio?: { key: string; urls: string[] }[]
  atlases?: AtlasAsset[]
}

const ASSET_MANIFEST_KEY = 'asset-manifest'

export default class PreloadScene extends Phaser.Scene {
  private loadingText?: Phaser.GameObjects.Text

  constructor() {
    super({
      key: 'PreloadScene'
    })
  }

  preload() {
    this.cameras.main.setBackgroundColor('#0b0d17')
    const { centerX, centerY } = this.cameras.main

    this.loadingText = this.add
      .text(centerX, centerY, 'Loading…', {
        fontFamily: 'Arial',
        fontSize: '32px',
        color: '#ffffff'
      })
      .setOrigin(0.5, 0.5)

    this.load.on(Phaser.Loader.Events.PROGRESS, this.handleProgress, this)
    this.load.on(Phaser.Loader.Events.COMPLETE, this.handleComplete, this)

    this.load.json(ASSET_MANIFEST_KEY, 'assets/manifest/core.json')
  }

  create() {
    const manifest = this.cache.json.get(ASSET_MANIFEST_KEY) as AssetManifest | null
    this.load.off(Phaser.Loader.Events.PROGRESS, this.handleProgress, this)
    this.load.off(Phaser.Loader.Events.COMPLETE, this.handleComplete, this)

    // Create particle texture procedurally
    this.createParticleTexture()

    this.loadFromManifest(manifest).then(() => {
      this.scene.start('MenuScene')
    })
  }

  private createParticleTexture() {
    // Create a simple white circle texture for particles
    const graphics = this.add.graphics()
    graphics.fillStyle(0xffffff, 1)
    graphics.fillCircle(8, 8, 8)
    graphics.generateTexture('particle', 16, 16)
    graphics.destroy()
  }

  private handleProgress(value: number) {
    if (this.loadingText) {
      const percentage = Math.round(value * 100)
      this.loadingText.setText(`Loading… ${percentage}%`)
    }
  }

  private handleComplete() {
    if (this.loadingText) {
      this.loadingText.setText('Preparing world…')
    }
  }

  private loadFromManifest(manifest: AssetManifest | null | undefined) {
    if (!manifest) {
      return Promise.resolve()
    }

    const hasAssets =
      (manifest.images && manifest.images.length > 0) ||
      (manifest.spritesheets && manifest.spritesheets.length > 0) ||
      (manifest.audio && manifest.audio.length > 0) ||
      (manifest.atlases && manifest.atlases.length > 0)

    if (!hasAssets) {
      return Promise.resolve()
    }

    if (manifest.images) {
      manifest.images.forEach(asset => this.load.image(asset.key, asset.url))
    }

    if (manifest.spritesheets) {
      manifest.spritesheets.forEach(asset =>
        this.load.spritesheet(asset.key, asset.url, {
          frameWidth: asset.frameWidth,
          frameHeight: asset.frameHeight
        })
      )
    }

    if (manifest.atlases) {
      manifest.atlases.forEach(asset => this.load.atlas(asset.key, asset.textureURL, asset.atlasURL))
    }

    if (manifest.audio) {
      manifest.audio.forEach(asset => this.load.audio(asset.key, asset.urls))
    }

    return new Promise<void>(resolve => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve())
      this.load.start()
    })
  }
}
