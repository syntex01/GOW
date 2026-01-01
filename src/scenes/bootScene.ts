export default class BootScene extends Phaser.Scene {
  constructor() {
    super({
      key: 'BootScene'
    })
  }

  create() {
    this.cameras.main.setBackgroundColor('#05060a')

    // Immediately proceed to preload
    this.time.delayedCall(100, () => {
      this.scene.start('PreloadScene')
    })
  }
}
