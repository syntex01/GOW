import Phaser from 'phaser'

export type BaseSide = 'player' | 'enemy'

export interface BaseConfig {
  scene: Phaser.Scene
  side: BaseSide
  x: number
  y: number
  width: number
  height: number
  maxHp: number
  label: string
  fillColor: number
  strokeColor: number
}

export default class Base {
  private container: Phaser.GameObjects.Container
  private body: Phaser.GameObjects.Rectangle
  private hpBarBg: Phaser.GameObjects.Rectangle
  private hpBar: Phaser.GameObjects.Rectangle
  private label: Phaser.GameObjects.Text
  private hp: number
  private maxHp: number
  private hpBarMaxWidth: number
  readonly side: BaseSide

  constructor(config: BaseConfig) {
    const { scene, side, x, y, width, height, maxHp, label, fillColor, strokeColor } = config
    this.side = side
    this.maxHp = maxHp
    this.hp = maxHp

    this.body = scene.add.rectangle(0, 0, width, height, fillColor, 0.85)
    this.body.setStrokeStyle(4, strokeColor, 1)

    this.hpBarMaxWidth = width * 0.75
    const barHeight = 14
    this.hpBarBg = scene.add.rectangle(
      0,
      -(height / 2 + barHeight * 1.5),
      this.hpBarMaxWidth,
      barHeight,
      0x0f172a,
      0.9
    )
    this.hpBarBg.setOrigin(0.5)

    this.hpBar = scene.add.rectangle(
      this.hpBarBg.x - this.hpBarMaxWidth / 2,
      this.hpBarBg.y,
      this.hpBarMaxWidth,
      barHeight,
      0x22c55e,
      1
    )
    this.hpBar.setOrigin(0, 0.5)

    this.label = scene.add.text(0, height / 2 + 16, label, {
      fontFamily: 'Arial Black',
      fontSize: '18px',
      color: '#ffffff'
    })
    this.label.setOrigin(0.5, 0)

    this.container = scene.add.container(x, y, [this.body, this.hpBarBg, this.hpBar, this.label])
  }

  destroy() {
    this.container.destroy()
  }

  getBounds() {
    const bounds = this.body.getBounds()
    return new Phaser.Geom.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height)
  }

  getImpactX() {
    const bounds = this.getBounds()
    return this.side === 'player' ? bounds.right : bounds.left
  }

  getHp() {
    return this.hp
  }

  setHp(value: number) {
    this.hp = Phaser.Math.Clamp(value, 0, this.maxHp)
    const percentage = this.hp / this.maxHp
    const barWidth = this.hpBarMaxWidth * percentage
    this.hpBar.displayWidth = barWidth
    if (percentage > 0.6) {
      this.hpBar.fillColor = 0x22c55e
    } else if (percentage > 0.3) {
      this.hpBar.fillColor = 0xfacc15
    } else {
      this.hpBar.fillColor = 0xef4444
    }
  }

  takeDamage(amount: number) {
    this.setHp(this.hp - amount)
    return this.hp <= 0
  }
}
