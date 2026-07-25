import Phaser from 'phaser'
import { audio } from '../core/audio'
import { TECH_BRANCHES, branchTechs, type TechId } from '../data/tech'
import { UI } from '../gfx/palette'
import type Army from '../sim/army'
import { Button, formatNumber, label, panel } from './widgets'

/**
 * The research screen.
 *
 * Laid out as three columns, one per branch, read top to bottom in research
 * order — which is also the order the prerequisites run in, so the shape of
 * the tree is the shape of the commitment. A node states what it *does*, in a
 * sentence, because "Shrapnel — your explosions throw fragments" tells a
 * player something that "Shrapnel +15%" never could.
 */
export default class TechTree {
  private container: Phaser.GameObjects.Container
  private buttons: Button[] = []
  private army: Army
  private onBuy: (id: TechId) => void
  private destroyed = false
  private rows: { id: TechId; button: Button; effect: Phaser.GameObjects.Text }[] = []

  constructor(scene: Phaser.Scene, army: Army, onBuy: (id: TechId) => void, onClose: () => void) {
    this.army = army
    this.onBuy = onBuy

    const cam = scene.cameras.main
    this.container = scene.add.container(0, 0).setDepth(3000).setScrollFactor(0)
    const backdrop = scene.add
      .rectangle(0, 0, cam.width, cam.height, 0x03060d, 0.86)
      .setOrigin(0, 0)
      .setInteractive()
    this.container.add(backdrop)

    const panelW = cam.width - 96
    const panelH = cam.height - 96
    const px = 48
    const py = 48
    this.container.add(panel(scene, px, py, panelW, panelH, 'ui:glass'))
    this.container.add(label(scene, px + 26, py + 18, 'RESEARCH', { size: 30, display: true, color: UI.text }))
    this.container.add(
      label(scene, px + 28, py + 56, 'Every branch changes what your army does, not what its numbers say.', {
        size: 14,
        color: UI.textDim
      })
    )

    const close = new Button(scene, px + panelW - 130, py + 16, {
      width: 110,
      height: 44,
      text: 'CLOSE',
      accent: UI.panelEdge,
      corner: 'Esc',
      onClick: () => {
        audio.play('ui_click', 0.5)
        onClose()
      }
    })
    close.setDepth(3001)
    this.buttons.push(close)

    const colW = (panelW - 60) / 3
    TECH_BRANCHES.forEach((branch, col) => {
      const cx = px + 30 + col * colW
      this.container.add(
        label(scene, cx, py + 92, branch.name, { size: 19, bold: true, color: branch.accent })
      )
      this.container.add(
        label(scene, cx, py + 116, branch.blurb, { size: 12, color: UI.textDim, wrap: colW - 24 })
      )

      branchTechs(branch.id).forEach((node, row) => {
        const y = py + 158 + row * 90
        const button = new Button(scene, cx, y, {
          width: colW - 26,
          height: 54,
          text: node.name,
          subtext: `${formatNumber(node.cost)} gold · age ${node.age + 1}`,
          fontSize: 17,
          accent: branch.accent,
          onClick: () => this.onBuy(node.id)
        })
        button.setDepth(3001)
        this.buttons.push(button)

        const effect = label(scene, cx + 4, y + 58, node.effect, {
          size: 12,
          color: UI.textDim,
          wrap: colW - 34
        })
        this.container.add(effect)
        this.rows.push({ id: node.id, button, effect })
      })
    })

    this.refresh()
  }

  /** Re-reads the army so state is right the moment gold or an age changes. */
  refresh(): void {
    if (this.destroyed) return
    for (const row of this.rows) {
      const state = this.army.techAvailability(row.id)
      switch (state) {
        case 'owned':
          row.button.setEnabled(false).setSubtext('RESEARCHED', UI.good)
          row.effect.setColor('#4ade80')
          break
        case 'ready':
          row.button.setEnabled(true)
          break
        case 'gold':
          row.button.setEnabled(false)
          break
        case 'age':
          row.button.setEnabled(false).setSubtext('later age', UI.warn)
          break
        default:
          row.button.setEnabled(false).setSubtext('locked', UI.textDim)
          break
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.buttons.forEach(b => b.destroy())
    this.buttons.length = 0
    this.container.destroy(true)
  }
}
