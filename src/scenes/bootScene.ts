export default class BootScene extends Phaser.Scene {
  private orientationNotice?: Phaser.GameObjects.Text

  constructor() {
    super({
      key: 'BootScene'
    })
  }

  create() {
    this.cameras.main.setBackgroundColor('#05060a')
    const { centerX, centerY } = this.cameras.main

    this.orientationNotice = this.add
      .text(centerX, centerY, 'Rotate to landscape for the best experience', {
        fontFamily: 'Arial',
        fontSize: '24px',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: this.cameras.main.width - 80 }
      })
      .setOrigin(0.5)
      .setAlpha(0)

    this.scale.on(Phaser.Scale.Events.ORIENTATION_CHANGE, this.handleOrientationChange, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this)
    this.handleOrientationChange(this.scale.orientation)

    this.time.delayedCall(150, () => {
      this.scene.start('PreloadScene')
    }, [], this)
  }

  private handleOrientationChange(orientation: any) {
    if (!this.orientationNotice) {
      return
    }

    const orientationValue = typeof orientation === 'string' ? orientation : String(orientation)
    const isPortrait = orientationValue.indexOf('portrait') === 0
    this.orientationNotice.setAlpha(isPortrait ? 1 : 0)
  }

  private onShutdown() {
    this.scale.off(Phaser.Scale.Events.ORIENTATION_CHANGE, this.handleOrientationChange, this)
  }
}
