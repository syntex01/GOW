import Phaser from 'phaser'
import { audio } from '../core/audio'
import { UI } from '../gfx/palette'
import { FONT_DISPLAY, hex } from '../ui/widgets'

/**
 * Minimal first scene: paints something on screen immediately, hooks up the
 * one-time audio unlock, then hands off to the texture generator.
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.ink)
    const { centerX, centerY } = this.cameras.main

    const title = this.add
      .text(centerX, centerY - 10, 'GOW', {
        fontFamily: FONT_DISPLAY,
        fontSize: '92px',
        color: hex(UI.text)
      })
      .setOrigin(0.5)
      .setAlpha(0)

    const sub = this.add
      .text(centerX, centerY + 54, 'GEARS OF WAR THROUGH THE AGES', {
        fontFamily: '"Trebuchet MS", system-ui, sans-serif',
        fontSize: '17px',
        color: hex(UI.textDim)
      })
      .setOrigin(0.5)
      .setAlpha(0)

    this.tweens.add({ targets: [title, sub], alpha: 1, duration: 420, ease: 'Quad.easeOut' })

    // Browsers require a gesture before audio can start.
    const unlock = () => audio.unlock()
    this.input.once(Phaser.Input.Events.POINTER_DOWN, unlock)
    this.input.keyboard?.once('keydown', unlock)

    this.time.delayedCall(320, () => this.scene.start('PreloadScene'))
  }
}
