import Phaser from 'phaser'
import { audio } from '../core/audio'
import { UI } from '../gfx/palette'

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif'
export const FONT_DISPLAY = 'Impact, Haettenschweiler, "Arial Black", sans-serif'

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** Stretchable rounded panel built from the generated 'ui:panel' texture. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  texture = 'ui:panel'
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(x, y, texture, undefined, w, h, 18, 18, 18, 18).setOrigin(0, 0)
}

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options: {
    size?: number
    color?: number
    bold?: boolean
    display?: boolean
    align?: 'left' | 'center' | 'right'
    wrap?: number
    stroke?: boolean
  } = {}
): Phaser.GameObjects.Text {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: options.display ? FONT_DISPLAY : FONT,
    fontSize: `${options.size ?? 16}px`,
    color: hex(options.color ?? UI.text),
    align: options.align ?? 'left'
  }
  if (options.bold && !options.display) style.fontStyle = 'bold'
  if (options.wrap) style.wordWrap = { width: options.wrap }
  if (options.stroke) {
    style.stroke = hex(UI.ink)
    style.strokeThickness = 4
  }
  const t = scene.add.text(x, y, text, style)
  if (options.align === 'center') t.setOrigin(0.5, 0)
  else if (options.align === 'right') t.setOrigin(1, 0)
  return t
}

export interface ButtonOptions {
  width: number
  height: number
  text?: string
  subtext?: string
  fontSize?: number
  accent?: number
  icon?: string
  iconScale?: number
  onClick: () => void
  onHover?: () => void
  onOut?: () => void
  /** Small text pinned to the bottom-right corner, e.g. a hotkey. */
  corner?: string
}

/** Interactive panel button with hover, press, disabled and "flash" states. */
export class Button {
  readonly container: Phaser.GameObjects.Container
  readonly width: number
  readonly height: number

  private scene: Phaser.Scene
  private bg: Phaser.GameObjects.NineSlice
  private accentBar: Phaser.GameObjects.Rectangle
  private textObj?: Phaser.GameObjects.Text
  private subObj?: Phaser.GameObjects.Text
  private cornerObj?: Phaser.GameObjects.Text
  private iconObj?: Phaser.GameObjects.Image
  private overlay: Phaser.GameObjects.Rectangle
  private cooldownMask: Phaser.GameObjects.Rectangle
  private enabled = true
  private muted = false
  private hovered = false

  constructor(scene: Phaser.Scene, x: number, y: number, options: ButtonOptions) {
    this.scene = scene
    this.width = options.width
    this.height = options.height

    this.container = scene.add.container(x, y)
    this.bg = scene.add.nineslice(0, 0, 'ui:button', undefined, options.width, options.height, 14, 14, 14, 14)
    this.bg.setOrigin(0, 0)
    this.container.add(this.bg)

    this.accentBar = scene.add
      .rectangle(0, options.height - 4, options.width, 4, options.accent ?? UI.panelEdge, 1)
      .setOrigin(0, 0)
    this.container.add(this.accentBar)

    if (options.icon) {
      this.iconObj = scene.add
        .image(options.width / 2, options.height * 0.42, options.icon)
        .setScale(options.iconScale ?? 0.62)
      this.container.add(this.iconObj)
    }

    if (options.text) {
      this.textObj = label(scene, options.width / 2, options.icon ? options.height - 30 : options.height / 2 - 12, options.text, {
        size: options.fontSize ?? 17,
        align: 'center',
        bold: true
      })
      this.container.add(this.textObj)
    }
    if (options.subtext) {
      this.subObj = label(scene, options.width / 2, options.height - 20, options.subtext, {
        size: 13,
        color: UI.gold,
        align: 'center'
      })
      this.container.add(this.subObj)
    }
    if (options.corner) {
      this.cornerObj = label(scene, options.width - 6, 4, options.corner, {
        size: 11,
        color: UI.textDim,
        align: 'right'
      })
      this.container.add(this.cornerObj)
    }

    this.cooldownMask = scene.add
      .rectangle(0, options.height, options.width, 0, 0x000000, 0.55)
      .setOrigin(0, 1)
    this.container.add(this.cooldownMask)

    this.overlay = scene.add.rectangle(0, 0, options.width, options.height, 0xffffff, 0).setOrigin(0, 0)
    this.container.add(this.overlay)

    this.overlay
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
        if (!this.enabled) return
        this.hovered = true
        this.overlay.setFillStyle(0xffffff, 0.09)
        audio.play('ui_hover', 0.35)
        options.onHover?.()
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
        this.hovered = false
        this.overlay.setFillStyle(0xffffff, 0)
        this.container.setScale(1)
        options.onOut?.()
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
        if (!this.enabled) return
        this.container.setScale(0.97)
      })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.container.setScale(1)
        if (!this.enabled) {
          audio.play('ui_denied', 0.5)
          this.shake()
          return
        }
        audio.play('ui_click', 0.5)
        options.onClick()
      })
  }

  private get live(): boolean {
    return Boolean(this.bg.scene)
  }

  setEnabled(value: boolean): this {
    if (!this.live) return this
    if (this.enabled === value) return this
    this.enabled = value
    const alpha = value ? 1 : 0.42
    this.bg.setAlpha(alpha)
    this.accentBar.setAlpha(alpha)
    this.iconObj?.setAlpha(alpha)
    this.textObj?.setAlpha(value ? 1 : 0.6)
    this.subObj?.setAlpha(value ? 1 : 0.6)
    return this
  }

  /**
   * Dims a button without deadening it.
   *
   * A disabled button eats its own click, so the handler never gets to say
   * WHY it will not work — the player is left staring at a grey rectangle.
   * Muting keeps the "not yet" look and still lets the click through, so the
   * action can explain itself.
   */
  setMuted(value: boolean): this {
    if (!this.live) return this
    if (this.muted === value) return this
    this.muted = value
    const alpha = value ? 0.55 : 1
    this.bg.setAlpha(alpha)
    this.accentBar.setAlpha(alpha)
    this.iconObj?.setAlpha(alpha)
    this.textObj?.setAlpha(value ? 0.72 : 1)
    this.subObj?.setAlpha(value ? 0.72 : 1)
    return this
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isHovered(): boolean {
    return this.hovered
  }

  setText(text: string): this {
    if (!this.live) return this
    this.textObj?.setText(text)
    return this
  }

  /** Lets a button shrink its label when the content changes length. */
  setFontSize(size: number): this {
    this.textObj?.setFontSize(size)
    return this
  }

  setSubtext(text: string, color?: number): this {
    if (!this.live) return this
    this.subObj?.setText(text)
    if (color !== undefined) this.subObj?.setColor(hex(color))
    return this
  }

  setAccent(color: number): this {
    if (!this.live) return this
    this.accentBar.setFillStyle(color, 1)
    return this
  }

  /** 0 = ready, 1 = fully masked. Used for build queues and ability charge. */
  setCooldown(ratio: number): this {
    if (!this.live) return this
    const clamped = Phaser.Math.Clamp(ratio, 0, 1)
    this.cooldownMask.height = this.height * clamped
    return this
  }

  setIcon(key: string): this {
    if (this.iconObj) this.iconObj.setTexture(key)
    return this
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y)
    return this
  }

  setDepth(depth: number): this {
    this.container.setDepth(depth)
    return this
  }

  pulse(color = UI.good): void {
    const ring = this.scene.add
      .rectangle(this.width / 2, this.height / 2, this.width, this.height, color, 0.5)
      .setOrigin(0.5)
    this.container.add(ring)
    this.scene.tweens.add({
      targets: ring,
      alpha: 0,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 380,
      onComplete: () => ring.destroy()
    })
  }

  private shake(): void {
    const x = this.container.x
    this.scene.tweens.add({
      targets: this.container,
      x: x + 5,
      duration: 45,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.container.setX(x)
    })
  }

  destroy(): void {
    this.container.destroy()
  }
}

/** Rounded progress bar with an optional label. */
export class Bar {
  private bg: Phaser.GameObjects.NineSlice
  private fill: Phaser.GameObjects.NineSlice
  private width: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
    container?: Phaser.GameObjects.Container
  ) {
    this.width = width
    this.bg = scene.add.nineslice(x, y, 'ui:bar', undefined, width, height, 8, 8, 8, 8).setOrigin(0, 0)
    this.bg.setTint(0x1b2436)
    this.fill = scene.add.nineslice(x, y, 'ui:bar', undefined, width, height, 8, 8, 8, 8).setOrigin(0, 0)
    this.fill.setTint(color)
    container?.add([this.bg, this.fill])
  }

  private get live(): boolean {
    return Boolean(this.fill.scene) && Boolean(this.bg.scene)
  }

  setValue(ratio: number): this {
    if (!this.live) return this
    const clamped = Phaser.Math.Clamp(ratio, 0, 1)
    this.fill.width = Math.max(6, this.width * clamped)
    this.fill.setVisible(clamped > 0.001)
    return this
  }

  setColor(color: number): this {
    if (!this.live) return this
    this.fill.setTint(color)
    return this
  }

  setDepth(depth: number): this {
    if (!this.live) return this
    this.bg.setDepth(depth)
    this.fill.setDepth(depth + 1)
    return this
  }

  setVisible(visible: boolean): this {
    if (!this.live) return this
    this.bg.setVisible(visible)
    this.fill.setVisible(visible && this.fill.width > 6)
    return this
  }

  destroy(): void {
    this.bg.destroy()
    this.fill.destroy()
  }
}

/** Floating info panel anchored above the cursor. */
export class Tooltip {
  private container: Phaser.GameObjects.Container
  private bg: Phaser.GameObjects.NineSlice
  private title: Phaser.GameObjects.Text
  private body: Phaser.GameObjects.Text
  private scene: Phaser.Scene
  private width = 300

  constructor(scene: Phaser.Scene, depth = 1000) {
    this.scene = scene
    this.container = scene.add.container(0, 0).setDepth(depth).setVisible(false).setScrollFactor(0)
    this.bg = scene.add.nineslice(0, 0, 'ui:glass', undefined, this.width, 120, 18, 18, 18, 18).setOrigin(0, 1)
    this.title = label(scene, 14, -108, '', { size: 18, bold: true, color: UI.text })
    this.body = label(scene, 14, -84, '', { size: 14, color: UI.textDim, wrap: this.width - 28 })
    this.container.add([this.bg, this.title, this.body])
  }

  show(x: number, y: number, title: string, body: string): void {
    this.title.setText(title)
    this.body.setText(body)
    const height = this.body.height + 56
    this.bg.setSize(this.width, height)
    this.title.setY(-height + 12)
    this.body.setY(-height + 38)
    const clampedX = Phaser.Math.Clamp(x, 8, this.scene.scale.width - this.width - 8)
    this.container.setPosition(clampedX, y).setVisible(true)
  }

  hide(): void {
    this.container.setVisible(false)
  }

  destroy(): void {
    this.container.destroy()
  }
}

/** Full-screen modal backdrop with a centred panel. */
export class Modal {
  readonly container: Phaser.GameObjects.Container
  readonly panelBg: Phaser.GameObjects.NineSlice
  readonly panelX: number
  readonly panelY: number
  readonly panelWidth: number
  readonly panelHeight: number

  constructor(scene: Phaser.Scene, width: number, height: number, depth = 2000) {
    const cam = scene.cameras.main
    this.panelWidth = width
    this.panelHeight = height
    this.panelX = (cam.width - width) / 2
    this.panelY = (cam.height - height) / 2

    this.container = scene.add.container(0, 0).setDepth(depth).setScrollFactor(0)
    const backdrop = scene.add
      .rectangle(0, 0, cam.width, cam.height, 0x03060d, 0.78)
      .setOrigin(0, 0)
      .setInteractive()
    this.panelBg = panel(scene, this.panelX, this.panelY, width, height)
    this.container.add([backdrop, this.panelBg])
  }

  add(child: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]): void {
    this.container.add(child)
  }

  destroy(): void {
    this.container.destroy()
  }
}

/** Formats large gold values compactly (1.2k, 3.4M). */
export function formatNumber(value: number): string {
  const v = Math.floor(value)
  if (v < 10000) return v.toLocaleString('en-US')
  if (v < 1000000) return `${(v / 1000).toFixed(1)}k`
  return `${(v / 1000000).toFixed(2)}M`
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
