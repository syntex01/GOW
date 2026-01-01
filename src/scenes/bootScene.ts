export default class BootScene extends Phaser.Scene {
  constructor() {
    super({
      key: 'BootScene'
    })
  }

  create() {
    this.cameras.main.setBackgroundColor('#05060a')

    // Immediately proceed to preload
    const self = this
    this.time.delayedCall(100, function() {
      self.scene.start('PreloadScene')
    }, [], this)
  }
}
