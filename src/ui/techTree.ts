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
import {
  CONNECTOR_H,
  NODE_SIZE_PX,
  drawConnector,
  drawLinkBoss,
  drawNodeFrame,
  drawNodeIcon,
  drawTreeBackdrop,
  nodeSizeFor,
  type NodeState
} from './techTreeArt'
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

const COL_W = 254
const ROW_H = 120
/** The art is authored small and shown at a whole multiple, as pixel art must be. */
const ART = 2

/** Five availability states collapse onto the three the art draws. */
function artState(state: ReturnType<Army['techAvailability']>): NodeState {
  if (state === 'owned') return 'owned'
  return state === 'ready' ? 'available' : 'locked'
}

interface NodeView {
  node: TechNode
  x: number
  y: number
  frame: Phaser.GameObjects.Image
  icon: Phaser.GameObjects.Image
  name: Phaser.GameObjects.Text
  tag: Phaser.GameObjects.Text
  state: ReturnType<Army['techAvailability']>
  art: NodeState | null
  /** Scale currently applied by the hover lift, so it can be taken back off. */
  lift?: number
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

    if (!scene.textures.exists('tt:backdrop')) {
      scene.textures.addCanvas('tt:backdrop', drawTreeBackdrop(this.viewW, this.viewH).canvas)
    }
    const frame = scene.add
      .image(this.viewX, this.viewY, 'tt:backdrop')
      .setOrigin(0, 0)
      .setDisplaySize(this.viewW, this.viewH)
      .setInteractive()
    this.container.add(frame)
    const frameEdge = scene.add
      .rectangle(this.viewX, this.viewY, this.viewW, this.viewH)
      .setOrigin(0, 0)
      .setStrokeStyle(1, UI.panelEdge)
    this.container.add(frameEdge)

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

  /**
   * Registers a drawn canvas as a texture once and hands back its key. Every
   * frame, emblem, link and boss in the network is one of a small number of
   * distinct pictures, so they are drawn once and stamped a hundred times.
   */
  private tex(scene: Phaser.Scene, key: string, make: () => { canvas: HTMLCanvasElement }): string {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make().canvas)
    return key
  }

  private frameKey(scene: Phaser.Scene, node: TechNode, state: NodeState): string {
    const accent = node.kind === 'ascension' && node.becomes ? FACTIONS_BY_ID[node.becomes].accent : undefined
    const size = nodeSizeFor(node)
    return this.tex(scene, `tt:f:${size}:${node.branch}:${state}:${accent ?? 0}`, () =>
      drawNodeFrame(size, node.branch, state, accent)
    )
  }

  private iconKey(scene: Phaser.Scene, node: TechNode, state: NodeState): string {
    const accent = node.kind === 'ascension' && node.becomes ? FACTIONS_BY_ID[node.becomes].accent : undefined
    return this.tex(scene, `tt:i:${node.id}:${state}`, () => drawNodeIcon(node, state, accent))
  }

  private buildNodes(scene: Phaser.Scene): void {
    for (const node of TECHS) {
      const x = this.nodeX(node)
      const y = this.nodeY(node)
      const size = nodeSizeFor(node)
      const px = NODE_SIZE_PX[size] * ART

      const frame = scene.add
        .image(x, y, this.frameKey(scene, node, 'locked'))
        .setDisplaySize(px, px)
        .setInteractive({ useHandCursor: true })
      const icon = scene.add.image(x, y, this.iconKey(scene, node, 'locked')).setDisplaySize(px, px)

      // A hundred names at once is a wall of text. The medallions carry the
      // shape of the network; only the nodes that change what your army *is*
      // wear their name in the open, and everything else answers on hover.
      const named = size !== 'minor'
      const name = label(scene, x, y + px / 2 + 4, named ? (MORPH_TECHS.has(node.id) ? `${node.name} ⟳` : node.name) : '', {
        size: size === 'ascendancy' ? 13 : 11,
        bold: true,
        align: 'center'
      }).setOrigin(0.5, 0)
      const tag = label(scene, x, y + px / 2 + (size === 'ascendancy' ? 22 : 19), '', {
        size: 10,
        color: UI.textDim,
        align: 'center'
      }).setOrigin(0.5, 0)

      frame.on('pointerover', () => this.showDetail(node.id))
      frame.on('pointerup', () => {
        // A pan that ends over a node is a pan, not a click.
        if (this.dragging) return
        if (this.army.techAvailability(node.id) !== 'ready') {
          audio.play('ui_denied', 0.4)
          return
        }
        audio.play('ui_click', 0.6)
        this.onBuy(node.id)
      })

      this.graph.add([frame, icon, name, tag])
      this.views.push({ node, x, y, frame, icon, name, tag, state: 'locked', art: null })
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

  /** Node centres — the links run between the medallions themselves. */
  private edgePoints(parent: TechNode, child: TechNode): [number, number, number, number] {
    return [this.nodeX(parent), this.nodeY(parent), this.nodeX(child), this.nodeY(child)]
  }

  /**
   * Links, as forged runs rather than hairlines.
   *
   * Every run is an elbow of axis-aligned pieces, which is both what keeps a
   * hundred parallel edges legible where a fan of diagonals turns into
   * hatching, and what lets the connector art be stamped rather than rotated.
   * A rosette covers each corner so the mitre never shows. The images are
   * pooled: the network's shape never changes, only which state each run is in.
   */
  private linkPool: Phaser.GameObjects.Image[] = []
  private linkUsed = 0

  private link(scene: Phaser.Scene, key: string, x: number, y: number, w: number, h: number): void {
    let img = this.linkPool[this.linkUsed]
    if (!img) {
      img = scene.add.image(0, 0, key).setOrigin(0.5, 0.5)
      this.linkPool.push(img)
      this.graph.addAt(img, 0)
    }
    img.setTexture(key).setPosition(x, y).setDisplaySize(w, h).setVisible(true)
    this.linkUsed += 1
  }

  private drawEdges(): void {
    const scene = this.graph.scene
    this.linkUsed = 0
    const thick = CONNECTOR_H * ART
    for (const view of this.views) {
      const child = view.node
      for (const parentId of child.requires) {
        const parent = TECHS_BY_ID[parentId]
        if (!parent) continue
        const state: NodeState = this.army.techs.has(child.id)
          ? 'owned'
          : this.army.techs.has(parentId) && view.state !== 'locked'
            ? 'available'
            : 'locked'
        const branch = child.branch
        const [x1, y1, x2, y2] = this.edgePoints(parent, child)
        const mid = x1 + (x2 - x1) * 0.5

        const runH = (a: number, b: number, y: number) => {
          const len = Math.abs(b - a)
          if (len < 12) return
          const key = this.tex(scene, `tt:h:${Math.round(len / ART)}:${state}:${branch}`, () =>
            drawConnector(len / ART, state, branch)
          )
          this.link(scene, key, (a + b) / 2, y, len, thick)
        }
        runH(x1, mid, y1)
        runH(mid, x2, y2)
        const vlen = Math.abs(y2 - y1)
        if (vlen >= 12) {
          const key = this.tex(scene, `tt:v:${Math.round(vlen / ART)}:${state}:${branch}`, () =>
            drawConnector(vlen / ART, state, branch, true)
          )
          this.link(scene, key, mid, (y1 + y2) / 2, thick, vlen)
          const boss = this.tex(scene, `tt:b:${state}:${branch}`, () => drawLinkBoss(state, branch))
          this.link(scene, boss, mid, y1, 13 * ART, 13 * ART)
          this.link(scene, boss, mid, y2, 13 * ART, 13 * ART)
        }
      }
    }
    for (let i = this.linkUsed; i < this.linkPool.length; i += 1) this.linkPool[i].setVisible(false)
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
    if (this.hovered !== id) {
      for (const view of this.views) {
        const lift = view.node.id === id ? 1.12 : 1
        view.frame.setScale(view.frame.scaleX / (view.lift ?? 1) * lift)
        view.icon.setScale(view.icon.scaleX / (view.lift ?? 1) * lift)
        view.lift = lift
      }
    }
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
              : state === 'demand' && node.demand
                ? `${node.demand.label} — ${formatNumber(Math.floor(this.army.deeds[node.demand.metric]))}/${formatNumber(node.demand.amount)}`
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
    const scene = this.graph.scene
    for (const view of this.views) {
      const state = this.army.techAvailability(view.node.id)
      view.state = state
      // Repainting a medallion means swapping two textures, so only do it when
      // the grade it draws in has actually changed.
      const art = artState(state)
      if (art !== view.art) {
        view.art = art
        view.frame.setTexture(this.frameKey(scene, view.node, art))
        view.icon.setTexture(this.iconKey(scene, view.node, art))
      }
      view.frame.setAlpha(state === 'locked' ? 0.5 : 1)
      view.icon.setAlpha(state === 'locked' ? 0.5 : 1)

      switch (state) {
        case 'owned':
          view.name.setColor(hex(UI.good)).setAlpha(1)
          view.tag.setText(view.node.kind === 'ascension' ? 'ASCENDED' : 'researched').setColor(hex(UI.good))
          break
        case 'ready':
          view.name.setColor(hex(UI.text)).setAlpha(1)
          view.tag
            .setText(
              view.node.kind === 'ascension'
                ? 'ASCEND — one only'
                : `${formatNumber(view.node.cost)}g`
            )
            .setColor(hex(UI.gold))
          break
        case 'gold':
          view.name.setColor(hex(UI.text)).setAlpha(0.8)
          view.tag.setText(`${formatNumber(view.node.cost)}g · short`).setColor(hex(UI.warn))
          break
        case 'age':
          view.name.setColor(hex(UI.text)).setAlpha(0.7)
          view.tag.setText(`age ${view.node.age + 1}`).setColor(hex(UI.warn))
          break
        case 'demand':
          // Bought with deeds, not gold. Show the tally, because a demand you
          // cannot see your progress toward is just an arbitrary wall.
          view.name.setColor(hex(UI.text)).setAlpha(0.85)
          view.tag
            .setText(
              view.node.demand
                ? `${Math.floor(this.army.deeds[view.node.demand.metric])}/${view.node.demand.amount} · earn it`
                : 'earn it'
            )
            .setColor(hex(UI.gold))
          break
        default:
          view.name.setColor(hex(UI.textDim)).setAlpha(0.5)
          view.tag.setText('').setColor(hex(UI.panelEdge))
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
