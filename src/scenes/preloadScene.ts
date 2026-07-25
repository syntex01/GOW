import Phaser from 'phaser'
import { createTextureJobs, texturesReady, type TextureJob } from '../gfx/textureFactory'
import { UI } from '../gfx/palette'
import { FONT, FONT_DISPLAY, hex } from '../ui/widgets'

/**
 * All game art is generated procedurally, so "loading" is really "drawing".
 * The work is sliced across frames so the progress bar stays responsive.
 */
export default class PreloadScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Graphics
  private statusText!: Phaser.GameObjects.Text
  private percentText!: Phaser.GameObjects.Text
  private progress = 0
  private targetProgress = 0

  constructor() {
    super({ key: 'PreloadScene' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.ink)
    const { centerX, centerY, width } = this.cameras.main

    this.add
      .text(centerX, centerY - 96, 'GOW', {
        fontFamily: FONT_DISPLAY,
        fontSize: '76px',
        color: hex(UI.text)
      })
      .setOrigin(0.5)

    this.statusText = this.add
      .text(centerX, centerY + 42, 'Preparing…', {
        fontFamily: FONT,
        fontSize: '16px',
        color: hex(UI.textDim)
      })
      .setOrigin(0.5)

    this.percentText = this.add
      .text(centerX, centerY - 22, '0%', {
        fontFamily: FONT_DISPLAY,
        fontSize: '30px',
        color: hex(UI.gold)
      })
      .setOrigin(0.5)

    this.bar = this.add.graphics()
    this.barWidth = Math.min(520, width - 120)

    this.jobs = createTextureJobs(this)
    if (this.jobs.length === 0 && texturesReady()) {
      this.targetProgress = 1
      this.finish()
    }
  }

  private barWidth = 480
  private jobs: TextureJob[] = []
  private jobIndex = 0
  private finished = false

  /** Runs as much generation as fits in one frame budget, then yields. */
  private pumpJobs(): void {
    if (this.jobIndex >= this.jobs.length) return
    const budgetMs = 14
    const start = performance.now()
    while (this.jobIndex < this.jobs.length && performance.now() - start < budgetMs) {
      const job = this.jobs[this.jobIndex]
      this.statusText.setText(job.label)
      job.run()
      this.jobIndex += 1
      this.targetProgress = this.jobIndex / this.jobs.length
    }
    if (this.jobIndex >= this.jobs.length) this.finish()
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    this.statusText.setText('Ready')
    this.time.delayedCall(280, () => this.scene.start('MenuScene'))
  }

  override update(_time: number, delta: number): void {
    this.pumpJobs()
    this.progress = Phaser.Math.Linear(this.progress, this.targetProgress, Math.min(1, delta / 90))
    this.percentText.setText(`${Math.round(this.progress * 100)}%`)

    const { centerX, centerY } = this.cameras.main
    const x = centerX - this.barWidth / 2
    const y = centerY + 6
    this.bar.clear()
    this.bar.fillStyle(UI.panel, 1)
    this.bar.fillRoundedRect(x - 3, y - 3, this.barWidth + 6, 20, 10)
    this.bar.fillStyle(0x1b2436, 1)
    this.bar.fillRoundedRect(x, y, this.barWidth, 14, 7)
    this.bar.fillStyle(UI.gold, 1)
    this.bar.fillRoundedRect(x, y, Math.max(14, this.barWidth * this.progress), 14, 7)
  }
}
