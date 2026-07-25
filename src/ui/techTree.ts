import Phaser from 'phaser'
import { audio } from '../core/audio'
import { FACTIONS_BY_ID } from '../data/factions'
import {
  BRANCH_ACCENT,
  CREEDS,
  MAX_RING,
  TECHS,
  TECHS_BY_ID,
  type TechId,
  type TechNode
} from '../data/tech'
import { MORPH_TECHS } from '../data/morphs'
import { UI } from '../gfx/palette'
import type Army from '../sim/army'
import { Button, formatNumber, hex, label, panel } from './widgets'

/**
 * The research network.
 *
 * Not a list and not five columns — a graph, drawn as one. The root sits at
 * the left, every node is placed by its distance from the root, and every
 * prerequisite is drawn as a line you can follow with your eye. Near the root
 * the lines cross constantly: those nodes have several parents and belong to
 * everybody. Further out the crossings stop, the lines run straight, and the
 * five ascension nodes at the rim each sit at the end of a lineage you had to
 * commit to. The picture *is* the design pitch; if you can see it, you have
 * understood the choice.
 *
 * Because ~100 nodes cannot each carry a sentence, the sentence moves to a
 * detail strip at the foot of the panel and follows whatever you point at.
 */

const COL_W = 208
const ROW_H = 46
const NODE_W = 168
const NODE_H = 34

interface NodeView {
  node: TechNode
  x: number
  y: number
  box: Phaser.GameObjects.Rectangle
  name: Phaser.GameObjects.Text
  tag: Phaser.GameObjects.Text
  state: ReturnType<Army['techAvailability']>
}

export default class TechTree {
  private container: Phaser.GameObjects.Container
  private graph: Phaser.GameObjects.Container
  private edges: Phaser.GameObjects.Graphics
  private buttons: Button[] = []
  private army: Army
  private onBuy: (id: TechId) => void
  private destroyed = false
  private views: NodeView[] = []
  private viewById = new Map<TechId, NodeView>()
  private hovered: TechId | null = null

  private panX = 0
  private panY = 0
  private minPanX = 0
  private minPanY = 0
  private dragging = false
  private dragOx = 0
  private dragOy = 0

  private readonly viewX: number
  private readonly viewY: number
  private readonly viewW: number
  private readonly viewH: number

  private detailName: Phaser.GameObjects.Text
  private detailMeta: Phaser.GameObjects.Text
  private detailBody: Phaser.GameObjects.Text
  private detailReq: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, army: Army, onBuy: (id: TechId) => void, onClose: () => void) {
    this.army = army
    this.onBuy = onBuy

    const cam = scene.cameras.main
    this.container = scene.add.container(0, 0).setDepth(3000).setScrollFactor(0)
    const backdrop = scene.add
      .rectangle(0, 0, cam.width, cam.height, 0x03060d, 0.92)
      .setOrigin(0, 0)
      .setInteractive()
    this.container.add(backdrop)

    const panelW = cam.width - 40
    const panelH = cam.height - 40
    const px = 20
    const py = 20
    this.container.add(panel(scene, px, py, panelW, panelH, 'ui:glass'))

    const ascended = army.ascendedTo ? FACTIONS_BY_ID[army.ascendedTo] : null
    this.container.add(
      label(scene, px + 24, py + 12, ascended ? ascended.name : 'RESEARCH NETWORK', {
        size: 26,
        display: true,
        color: ascended ? ascended.accent : UI.text
      })
    )
    this.container.add(
      label(
        scene,
        px + 26,
        py + 44,
        ascended
          ? ascended.doctrine
          : 'One root. The further out you go the fewer ways there are onward — and the rim makes you choose.',
        { size: 12, color: UI.textDim, wrap: panelW - 480 }
      )
    )

    // Creed legend, so the colours mean something before you hover anything.
    let lx = px + panelW - 132
    for (let i = CREEDS.length - 1; i >= 0; i -= 1) {
      const creed = CREEDS[i]
      const swatch = scene.add.rectangle(lx, py + 62, 9, 9, creed.accent).setOrigin(1, 0.5)
      const text = label(scene, lx - 14, py + 56, creed.name, { size: 10, color: creed.accent, align: 'right' })
      this.container.add([swatch, text])
      lx -= Math.max(72, text.width + 30)
    }

    const close = new Button(scene, px + panelW - 122, py + 12, {
      width: 106,
      height: 36,
      text: 'CLOSE',
      accent: UI.panelEdge,
      corner: 'Esc',
      onClick: () => {
        audio.play('ui_click', 0.5)
        onClose()
      }
    })
    close.setDepth(3002)
    this.buttons.push(close)

    // ── the graph viewport ───────────────────────────────────────────────
    const detailH = 84
    this.viewX = px + 16
    this.viewY = py + 78
    this.viewW = panelW - 32
    this.viewH = panelH - 96 - detailH

    const frame = scene.add
      .rectangle(this.viewX, this.viewY, this.viewW, this.viewH, 0x070c16, 0.55)
      .setOrigin(0, 0)
      .setStrokeStyle(1, UI.panelEdge)
      .setInteractive()
    this.container.add(frame)

    this.graph = scene.add.container(this.viewX, this.viewY).setDepth(3001).setScrollFactor(0)
    this.container.add(this.graph)
    // Everything in the graph is clipped to the viewport, so a node scrolled
    // out of frame does not paint over the header or the detail strip.
    const mask = scene.make
      .graphics({ x: 0, y: 0 }, false)
      .fillStyle(0xffffff)
      .fillRect(this.viewX, this.viewY, this.viewW, this.viewH)
    this.graph.setMask(mask.createGeometryMask())

    this.edges = scene.add.graphics()
    this.graph.add(this.edges)

    this.assignSlots()
    const graphW = (MAX_RING + 1) * COL_W + 40
    const graphH = this.rowCount * ROW_H + 56
    this.minPanX = Math.min(0, this.viewW - graphW)
    this.minPanY = Math.min(0, this.viewH - graphH)

    this.buildNodes(scene)
    this.layoutRingHeaders(scene)

    // ── detail strip ─────────────────────────────────────────────────────
    const dy = this.viewY + this.viewH + 8
    const strip = scene.add
      .rectangle(this.viewX, dy, this.viewW, detailH - 8, 0x0b1220, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(1, UI.panelEdge)
    this.container.add(strip)
    this.detailName = label(scene, this.viewX + 12, dy + 6, 'Point at a node', { size: 16, bold: true })
    this.detailMeta = label(scene, this.viewX + 12, dy + 27, '', { size: 11, color: UI.gold })
    this.detailBody = label(scene, this.viewX + 12, dy + 44, 'Drag to pan. Click a lit node to research it.', {
      size: 12,
      color: UI.textDim,
      wrap: this.viewW - 320
    })
    this.detailReq = label(scene, this.viewX + this.viewW - 12, dy + 6, '', {
      size: 11,
      color: UI.textDim,
      align: 'right',
      wrap: 290
    })
    this.container.add([this.detailName, this.detailMeta, this.detailBody, this.detailReq])

    // ── input ────────────────────────────────────────────────────────────
    scene.input.on('wheel', this.onWheel, this)
    scene.input.on('pointerdown', this.onPointerDown, this)
    scene.input.on('pointermove', this.onPointerMove, this)
    scene.input.on('pointerup', this.onPointerUp, this)
    scene.input.keyboard?.once('keydown-ESC', () => onClose())

    // Open looking at the frontier rather than at the root you bought long ago.
    this.focusFrontier()
    this.refresh()
  }

  // ───────────────────────────── construction ─────────────────────────────

  /**
   * Vertical slot per node, resolved so nothing overlaps.
   *
   * The data gives every node a `row`, which is an authoring hint about which
   * creed's band it belongs in, not a guarantee of uniqueness — two nodes in
   * the same ring can and do ask for the same row. Rather than hand-tuning a
   * hundred numbers every time a node is added, the view sorts each ring by
   * its requested row and pushes ties down by one slot. Intent is preserved,
   * collisions cannot happen, and adding a node never silently buries another.
   */
  private slots = new Map<TechId, number>()
  private rowCount = 0

  private assignSlots(): void {
    for (let ring = 0; ring <= MAX_RING; ring += 1) {
      const nodes = TECHS.filter(t => t.ring === ring).sort((a, b) => a.row - b.row || (a.id < b.id ? -1 : 1))
      let next = 0
      for (const node of nodes) {
        const slot = Math.max(node.row, next)
        this.slots.set(node.id, slot)
        next = slot + 1
        this.rowCount = Math.max(this.rowCount, slot + 1)
      }
    }
  }

  private nodeX(node: TechNode): number {
    return 20 + node.ring * COL_W
  }

  private nodeY(node: TechNode): number {
    return 34 + (this.slots.get(node.id) ?? node.row) * ROW_H
  }

  private buildNodes(scene: Phaser.Scene): void {
    for (const node of TECHS) {
      const x = this.nodeX(node)
      const y = this.nodeY(node)
      const accent = node.kind === 'ascension' && node.becomes
        ? FACTIONS_BY_ID[node.becomes].accent
        : BRANCH_ACCENT[node.branch]

      const box = scene.add
        .rectangle(x, y, NODE_W, node.kind === 'ascension' ? NODE_H + 6 : NODE_H, UI.panel, 0.95)
        .setOrigin(0, 0.5)
        .setStrokeStyle(node.kind === 'ascension' ? 2 : 1, accent)
        .setInteractive({ useHandCursor: true })

      const name = label(scene, x + 8, y - 12, MORPH_TECHS.has(node.id) ? `${node.name} ⟳` : node.name, {
        size: 12,
        bold: true
      })
      const tag = label(scene, x + 8, y + 2, '', { size: 10, color: UI.textDim })

      box.on('pointerover', () => this.showDetail(node.id))
      box.on('pointerup', () => {
        // A pan that ends over a node is a pan, not a click.
        if (this.dragging) return
        if (this.army.techAvailability(node.id) !== 'ready') {
          audio.play('ui_denied', 0.4)
          return
        }
        audio.play('ui_click', 0.6)
        this.onBuy(node.id)
      })

      this.graph.add([box, name, tag])
      const view: NodeView = { node, x, y, box, name, tag, state: 'locked' }
      this.views.push(view)
      this.viewById.set(node.id, view)
    }
  }

  /** Thin ring markers, so "how far out am I" is readable at a glance. */
  private layoutRingHeaders(scene: Phaser.Scene): void {
    for (let ring = 0; ring <= MAX_RING; ring += 1) {
      const x = 20 + ring * COL_W
      const text = ring === 0 ? 'ROOT' : ring === MAX_RING ? 'THE RIM' : `RING ${ring}`
      const t = label(scene, x, 4, text, { size: 10, color: ring === MAX_RING ? UI.gold : UI.panelEdge, bold: true })
      this.graph.add(t)
    }
  }

  // ─────────────────────────────── drawing ────────────────────────────────

  /** Where an edge leaves a parent and where it arrives at a child. */
  private edgePoints(parent: TechNode, child: TechNode): [number, number, number, number] {
    return [
      this.nodeX(parent) + NODE_W,
      this.nodeY(parent),
      this.nodeX(child),
      this.nodeY(child)
    ]
  }

  private drawEdges(): void {
    const g = this.edges
    g.clear()
    for (const view of this.views) {
      const child = view.node
      for (const parentId of child.requires) {
        const parent = TECHS_BY_ID[parentId]
        if (!parent) continue
        const owned = this.army.techs.has(parentId)
        const childOwned = this.army.techs.has(child.id)
        const lit = owned && (childOwned || view.state === 'ready' || view.state === 'gold' || view.state === 'age')
        const colour = childOwned ? UI.good : lit ? BRANCH_ACCENT[child.branch] : UI.panelEdge
        const alpha = childOwned ? 0.75 : lit ? 0.55 : 0.22
        const focus = this.hovered === child.id || this.hovered === parentId
        g.lineStyle(focus ? 2 : 1, focus ? UI.gold : colour, focus ? 0.95 : alpha)

        const [x1, y1, x2, y2] = this.edgePoints(parent, child)
        // Elbow rather than a straight diagonal: with a hundred nodes, parallel
        // runs stay legible where a fan of diagonals turns into hatching.
        const mid = x1 + (x2 - x1) * 0.5
        g.beginPath()
        g.moveTo(x1, y1)
        g.lineTo(mid, y1)
        g.lineTo(mid, y2)
        g.lineTo(x2, y2)
        g.strokePath()
      }
    }
  }

  // ──────────────────────────────── input ────────────────────────────────

  private inView(p: Phaser.Input.Pointer): boolean {
    return (
      p.x >= this.viewX && p.x <= this.viewX + this.viewW && p.y >= this.viewY && p.y <= this.viewY + this.viewH
    )
  }

  private onWheel(p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number): void {
    if (this.destroyed || !this.inView(p)) return
    // A trackpad gives horizontal deltas; a wheel gives only vertical, and the
    // network is wider than it is tall, so shift maps vertical onto horizontal.
    if (p.event && (p.event as WheelEvent).shiftKey) this.panBy(-dy * 0.8, 0)
    else this.panBy(-dx * 0.8, -dy * 0.8)
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.destroyed || !this.inView(p)) return
    this.dragging = false
    this.dragOx = p.x - this.panX
    this.dragOy = p.y - this.panY
    this.pressed = true
  }

  private pressed = false

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.destroyed || !this.pressed || !p.isDown) return
    const nx = p.x - this.dragOx
    const ny = p.y - this.dragOy
    if (!this.dragging && Math.abs(nx - this.panX) + Math.abs(ny - this.panY) < 5) return
    this.dragging = true
    this.setPan(nx, ny)
  }

  private onPointerUp(): void {
    this.pressed = false
    // Cleared next frame so the node's own pointerup still sees the drag flag.
    this.graph.scene.time.delayedCall(0, () => {
      this.dragging = false
    })
  }

  private panBy(dx: number, dy: number): void {
    this.setPan(this.panX + dx, this.panY + dy)
  }

  private setPan(x: number, y: number): void {
    this.panX = Phaser.Math.Clamp(x, this.minPanX, 0)
    this.panY = Phaser.Math.Clamp(y, this.minPanY, 0)
    this.graph.setPosition(this.viewX + this.panX, this.viewY + this.panY)
  }

  /** Centre on the outermost ring that still has something buyable in it. */
  private focusFrontier(): void {
    let ring = 0
    for (const view of this.views) {
      if (this.army.techAvailability(view.node.id) === 'ready') ring = Math.max(ring, view.node.ring)
    }
    this.setPan(-(Math.max(0, ring - 1) * COL_W), 0)
  }

  // ─────────────────────────────── detail ────────────────────────────────

  private showDetail(id: TechId): void {
    if (this.destroyed) return
    this.hovered = id
    const node = TECHS_BY_ID[id]
    if (!node) return
    const state = this.army.techAvailability(id)
    const kind =
      node.kind === 'ascension'
        ? 'ASCENSION'
        : node.kind === 'unit'
          ? 'NEW UNIT'
          : node.kind === 'stat'
            ? 'UPGRADE'
            : 'DOCTRINE'
    const status =
      state === 'owned'
        ? 'researched'
        : state === 'ready'
          ? 'ready to research'
          : state === 'gold'
            ? `needs ${formatNumber(node.cost - Math.floor(this.army.gold))}g more`
            : state === 'age'
              ? `locked until age ${node.age + 1}`
              : 'prerequisites not met'

    this.detailName.setText(node.name).setColor(
      hex(node.kind === 'ascension' && node.becomes ? FACTIONS_BY_ID[node.becomes].accent : BRANCH_ACCENT[node.branch])
    )
    this.detailMeta.setText(
      `${kind}  ·  ring ${node.ring}  ·  ${formatNumber(node.cost)}g  ·  age ${node.age + 1}  ·  ${status}`
    )
    this.detailMeta.setColor(hex(state === 'owned' ? UI.good : state === 'ready' ? UI.gold : UI.textDim))
    this.detailBody.setText(
      MORPH_TECHS.has(node.id)
        ? `${node.effect}  ⟶  Your existing units change shape when this lands.`
        : node.effect
    )

    const missing = node.requires.filter(r => !this.army.techs.has(r))
    this.detailReq.setText(
      node.requires.length === 0
        ? 'the root — needs nothing'
        : missing.length === 0
          ? `follows: ${node.requires.map(r => TECHS_BY_ID[r]?.name ?? r).join(', ')}`
          : `still needs: ${missing.map(r => TECHS_BY_ID[r]?.name ?? r).join(', ')}`
    )
    this.detailReq.setColor(hex(missing.length === 0 ? UI.textDim : UI.warn))
    this.drawEdges()
  }

  // ─────────────────────────────── refresh ───────────────────────────────

  /** Re-reads the army so state is right the moment gold or an age changes. */
  refresh(): void {
    if (this.destroyed) return
    for (const view of this.views) {
      const state = this.army.techAvailability(view.node.id)
      view.state = state
      const accent =
        view.node.kind === 'ascension' && view.node.becomes
          ? FACTIONS_BY_ID[view.node.becomes].accent
          : BRANCH_ACCENT[view.node.branch]

      switch (state) {
        case 'owned':
          view.box.setFillStyle(0x123322, 0.95).setStrokeStyle(view.node.kind === 'ascension' ? 2 : 1, UI.good)
          view.name.setColor(hex(UI.text)).setAlpha(1)
          view.tag.setText(view.node.kind === 'ascension' ? 'ASCENDED' : 'researched').setColor(hex(UI.good))
          break
        case 'ready':
          view.box.setFillStyle(0x1d2740, 0.98).setStrokeStyle(2, UI.gold)
          view.name.setColor(hex(UI.text)).setAlpha(1)
          view.tag
            .setText(
              view.node.kind === 'ascension'
                ? 'ASCEND — one only'
                : `${formatNumber(view.node.cost)}g · research`
            )
            .setColor(hex(UI.gold))
          break
        case 'gold':
          view.box.setFillStyle(UI.panel, 0.9).setStrokeStyle(1, accent)
          view.name.setColor(hex(UI.text)).setAlpha(0.8)
          view.tag.setText(`${formatNumber(view.node.cost)}g · short`).setColor(hex(UI.warn))
          break
        case 'age':
          view.box.setFillStyle(UI.panel, 0.9).setStrokeStyle(1, accent)
          view.name.setColor(hex(UI.text)).setAlpha(0.7)
          view.tag.setText(`age ${view.node.age + 1}`).setColor(hex(UI.warn))
          break
        default:
          view.box.setFillStyle(0x0a101c, 0.85).setStrokeStyle(1, UI.panelEdge)
          view.name.setColor(hex(UI.textDim)).setAlpha(0.55)
          view.tag.setText('locked').setColor(hex(UI.panelEdge))
          break
      }
    }
    this.drawEdges()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const input = this.graph.scene?.input
    input?.off('wheel', this.onWheel, this)
    input?.off('pointerdown', this.onPointerDown, this)
    input?.off('pointermove', this.onPointerMove, this)
    input?.off('pointerup', this.onPointerUp, this)
    this.buttons.forEach(b => b.destroy())
    this.buttons.length = 0
    this.container.destroy(true)
  }
}
