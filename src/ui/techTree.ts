import Phaser from 'phaser'
import { audio } from '../core/audio'
import { FACTIONS_BY_ID } from '../data/factions'
import {
  BRANCH_ACCENT,
  CREEDS,
  MAX_RING,
  OATHS,
  TECHS,
  TECHS_BY_ID,
  oathRivals,
  type TechId,
  type TechNode
} from '../data/tech'
import { MORPH_LINES, MORPH_TECHS } from '../data/morphs'
import { UNITS_BY_ID } from '../data/units'
import { FACTION_UNITS } from '../data/factions'
import { LEAN_RULES, TECH_MECHANICS } from '../data/techInfo'
import type { UnitDef } from '../data/types'
import { UI } from '../gfx/palette'
import type Army from '../sim/army'
import {
  NODE_SIZE_PX,
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

/**
 * Shape and colour, one per kind, worn by every node and echoed in the header
 * legend. The frames already say *how important* a node is; the badge says
 * *what sort of thing it does* before you have read a word.
 */
const KIND_BADGE: Record<TechNode['kind'], { color: number; label: string }> = {
  behaviour: { color: 0x76c7ff, label: 'DOCTRINE — changes the rules' },
  stat: { color: 0xffd66e, label: 'UPGRADE — a number goes up' },
  unit: { color: 0x8ef29a, label: 'NEW UNIT' },
  ascension: { color: 0xff9df0, label: 'ASCENSION' }
}

const ANY_UNIT_BY_ID: Record<string, UnitDef> = {
  ...UNITS_BY_ID,
  ...Object.fromEntries(FACTION_UNITS.map(u => [u.id, u]))
}

/** One line of card numbers for the unit a node fields. */
function unitStatline(unitId: string): string | null {
  const def = ANY_UNIT_BY_ID[unitId]
  if (!def) return null
  const squad = def.squad && def.squad > 1 ? ` ×${def.squad} per card` : ''
  return `${def.name}: ${def.hp} hp · ${def.damage} dmg every ${(def.attackMs / 1000).toFixed(1)}s · range ${def.range} · ${def.cost}g${squad}`
}

/**
 * Who a node actually touches, stated as units where that is knowable.
 *
 * The four kinds answer differently: a unit node names its unit, a morph gate
 * names the roster units it will reshape (resolved against the army the player
 * has *right now*, roles and all), a stat node names its scope, and everything
 * else is an army-wide rule.
 */
function affectedUnits(node: TechNode, army: Army): string {
  if (node.kind === 'unit' && node.unlocks) {
    const def = ANY_UNIT_BY_ID[node.unlocks]
    return def ? `adds ${def.name} to your roster` : 'adds a new unit to your roster'
  }
  if (node.kind === 'ascension') {
    return 'your whole army — ascending rebuilds the roster around this creed'
  }
  for (const line of MORPH_LINES) {
    const idx = line.stages.findIndex(s => s.tech === node.id)
    if (idx < 0) continue
    const stage = line.stages[idx]
    const hit = army.roster.filter(d => !stage.roles || stage.roles.includes(d.role))
    const names = hit.map(d => d.name)
    const listed = names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5} more` : '')
    const scope = stage.roles ? `${stage.roles.join(' & ')} units` : 'every unit you build'
    return names.length > 0
      ? `morphs ${scope} (${line.title} ${idx + 1}/3): ${listed}`
      : `morphs ${scope} — none in your roster yet`
  }
  if (node.kind === 'stat' && node.stat) {
    const pct = Math.round((node.stat.mult - 1) * 100)
    const amount = `${pct >= 0 ? '+' : ''}${pct}%`
    switch (node.stat.key) {
      case 'income': return `your economy — income ${amount}. No unit is touched.`
      case 'bounty': return `your economy — kill bounties ${amount}. No unit is touched.`
      case 'buildSpeed': return `every unit — trains ${amount} faster`
      case 'baseHp': return `your fortress — hull ${amount}`
      case 'abilityRate': return `your commander abilities — recharge ${amount}`
      case 'unitHp': return `every unit you field — hp ${amount}`
      case 'unitDamage': return `every unit you field — damage ${amount}`
      case 'unitSpeed': return `every unit you field — speed ${amount}`
      case 'unitRange': return `every ranged unit — reach ${amount}`
      case 'toughness': return `every unit you field — damage taken ${amount}`
    }
  }
  return node.branch === 'core'
    ? 'army-wide rule change — every unit lives under it'
    : `army-wide rule change, and it deepens your ${node.branch} lean (ground rules, morphs and the rim all count it)`
}

interface NodeView {
  node: TechNode
  x: number
  y: number
  frame: Phaser.GameObjects.Image
  icon: Phaser.GameObjects.Image
  badge: Phaser.GameObjects.Image
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
  /** The node the detail strip and the research button are talking about. */
  private focused: TechId | null = null
  /** Gold ring around the focused node, so eye and strip agree. */
  private marker!: Phaser.GameObjects.Graphics
  private buyBtn!: Button

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
  private detailAffects: Phaser.GameObjects.Text
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

    // Kind legend: the badge shapes, spelled out once. After this, every node
    // on the board answers "what sort of thing is this" without being read.
    let kx = px + 26
    for (const kind of ['behaviour', 'stat', 'unit', 'ascension'] as const) {
      const spec = KIND_BADGE[kind]
      const img = scene.add.image(kx, py + 67, this.badgeKey(scene, kind)).setOrigin(0, 0.5).setDisplaySize(12, 12)
      const short = spec.label.split(' — ')[0]
      const text = label(scene, kx + 16, py + 61, short, { size: 10, color: spec.color })
      this.container.add([img, text])
      kx += 16 + text.width + 22
    }
    this.container.add(
      label(scene, kx + 6, py + 61, '· colour = creed · line = prerequisite', { size: 10, color: UI.textDim })
    )

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
    const detailH = 104
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
    // The focus ring sits above every medallion, so it can never be buried.
    this.marker = scene.add.graphics()
    this.graph.add(this.marker)

    // ── detail strip ─────────────────────────────────────────────────────
    const dy = this.viewY + this.viewH + 8
    const strip = scene.add
      .rectangle(this.viewX, dy, this.viewW, detailH - 8, 0x0b1220, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(1, UI.panelEdge)
    this.container.add(strip)
    // Left column: what it is and what it does.
    this.detailName = label(scene, this.viewX + 12, dy + 8, 'Select a node', { size: 16, bold: true })
    this.detailMeta = label(scene, this.viewX + 12, dy + 30, '', { size: 11, color: UI.gold })
    this.detailBody = label(scene, this.viewX + 12, dy + 48, 'Drag to pan. Click any node to inspect it; research with the button on the right.', {
      size: 12,
      color: UI.textDim,
      wrap: this.viewW - 640
    })
    // Middle column: who it touches, and what stands in the way.
    const midX = this.viewX + this.viewW - 610
    this.detailAffects = label(scene, midX, dy + 8, '', { size: 11, color: KIND_BADGE.unit.color, wrap: 380 })
    this.detailReq = label(scene, midX, dy + 56, '', { size: 11, color: UI.textDim, wrap: 380 })
    this.container.add([this.detailName, this.detailMeta, this.detailBody, this.detailAffects, this.detailReq])

    // Right column: the one action. Buying moved off the nodes and onto a
    // button, so inspecting a node can never accidentally spend 900 gold.
    this.buyBtn = new Button(scene, this.viewX + this.viewW - 212, dy + 24, {
      width: 200,
      height: 48,
      text: 'RESEARCH',
      accent: UI.gold,
      fontSize: 16,
      onClick: () => this.tryBuyFocused()
    })
    this.buyBtn.setDepth(3002)
    this.buyBtn.container.setVisible(false)
    this.buttons.push(this.buyBtn)

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

  /**
   * One tiny stamped shape per kind: circle for doctrine, diamond for upgrade,
   * square for unit, four-point star for ascension. Drawn with Phaser's own
   * geometry because at twelve pixels a shape needs edges, not shading.
   */
  private badgeKey(scene: Phaser.Scene, kind: TechNode['kind']): string {
    const key = `tt:kind:${kind}`
    if (scene.textures.exists(key)) return key
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    const c = KIND_BADGE[kind].color
    const s = 16
    const m = s / 2
    g.fillStyle(0x060a12, 1)
    g.fillCircle(m, m, m - 1)
    g.lineStyle(1.5, c, 1)
    g.fillStyle(c, 1)
    if (kind === 'behaviour') {
      g.strokeCircle(m, m, 4.5)
    } else if (kind === 'stat') {
      g.fillPoints(
        [new Phaser.Geom.Point(m, m - 5), new Phaser.Geom.Point(m + 5, m), new Phaser.Geom.Point(m, m + 5), new Phaser.Geom.Point(m - 5, m)],
        true
      )
    } else if (kind === 'unit') {
      g.fillRect(m - 4, m - 4, 8, 8)
    } else {
      g.fillPoints(
        [
          new Phaser.Geom.Point(m, m - 6),
          new Phaser.Geom.Point(m + 1.8, m - 1.8),
          new Phaser.Geom.Point(m + 6, m),
          new Phaser.Geom.Point(m + 1.8, m + 1.8),
          new Phaser.Geom.Point(m, m + 6),
          new Phaser.Geom.Point(m - 1.8, m + 1.8),
          new Phaser.Geom.Point(m - 6, m),
          new Phaser.Geom.Point(m - 1.8, m - 1.8)
        ],
        true
      )
    }
    g.generateTexture(key, s, s)
    g.destroy()
    return key
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
      // Kind badge, pinned to the frame's shoulder. Minor nodes are small
      // enough that the badge rides slightly further out so it never covers
      // the emblem itself.
      const bs = size === 'minor' ? 13 : 16
      const badge = scene.add
        .image(x + px / 2 - bs * 0.3, y - px / 2 + bs * 0.3, this.badgeKey(scene, node.kind))
        .setDisplaySize(bs, bs)

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

      frame.on('pointerover', () => this.preview(node.id))
      frame.on('pointerout', () => {
        // Hover was only ever a preview: when the pointer leaves, the strip
        // returns to the node the player actually clicked, so travelling
        // across the board to the research button never loses the selection.
        if (this.focused && this.focused !== node.id) this.fillStrip(this.focused)
      })
      frame.on('pointerup', () => {
        // A pan that ends over a node is a pan, not a click.
        if (this.dragging) return
        audio.play('ui_click', 0.4)
        const now = this.graph.scene.time.now
        const isDouble = this.lastClickId === node.id && now - this.lastClickAt < 420
        this.lastClickId = node.id
        this.lastClickAt = now
        this.focus(node.id)
        // Double-click is the fast lane: inspect once, confirm with the
        // second click, no trip to the button required.
        if (isDouble) this.tryBuyFocused()
      })

      this.graph.add([frame, icon, badge, name, tag])
      this.views.push({ node, x, y, frame, icon, badge, name, tag, state: 'locked', art: null })
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

  /** Half the drawn width of a node's frame, for attaching links to its rim. */
  private halfOf(node: TechNode): number {
    return (NODE_SIZE_PX[nodeSizeFor(node)] * ART) / 2
  }

  /**
   * Links, redrawn from scratch.
   *
   * The old connectors were stamped images laid as axis-aligned elbows, and
   * every edge between the same two columns shared one vertical run — so the
   * runs stacked, crossed rows of unrelated nodes, and read as damage rather
   * than structure. Now each link is its own curve on one Graphics object:
   * out of the parent's right rim, into the child's left rim, horizontal at
   * both ends so the flow direction is never ambiguous. Where several links
   * leave one node or arrive at one node, their endpoints fan out along the
   * rim instead of piling onto the centre, which is what makes forty edges in
   * one column legible.
   *
   * Colour is the child's creed. Weight and brightness are the state: owned
   * links are solid, buyable links glow, locked links are ghosts.
   */
  private drawEdges(): void {
    interface EdgeRun {
      x1: number
      y1: number
      x2: number
      y2: number
      color: number
      state: NodeState
    }
    const g = this.edges
    g.clear()

    // First pass: collect, so departures and arrivals can be fanned.
    const raw: { parent: TechNode; child: TechNode; state: NodeState; color: number }[] = []
    for (const view of this.views) {
      const child = view.node
      for (const parentId of [...child.requires, ...(child.requiresAny ?? [])]) {
        const parent = TECHS_BY_ID[parentId]
        if (!parent) continue
        const state: NodeState = this.army.techs.has(child.id)
          ? 'owned'
          : this.army.techs.has(parentId) && view.state !== 'locked'
            ? 'available'
            : 'locked'
        const color =
          child.kind === 'ascension' && child.becomes
            ? FACTIONS_BY_ID[child.becomes].accent
            : BRANCH_ACCENT[child.branch]
        raw.push({ parent, child, state, color })
      }
    }
    const leaving = new Map<TechId, typeof raw>()
    const arriving = new Map<TechId, typeof raw>()
    for (const e of raw) {
      ;(leaving.get(e.parent.id) ?? leaving.set(e.parent.id, []).get(e.parent.id)!).push(e)
      ;(arriving.get(e.child.id) ?? arriving.set(e.child.id, []).get(e.child.id)!).push(e)
    }
    const fan = (
      list: typeof raw,
      e: (typeof raw)[number],
      half: number,
      keyOf: (edge: (typeof raw)[number]) => number
    ): number => {
      const n = list.length
      if (n <= 1) return 0
      const sorted = [...list].sort((a, b) => keyOf(a) - keyOf(b))
      const i = sorted.indexOf(e)
      const spread = Math.min(14, (half * 1.4) / (n - 1))
      return (i - (n - 1) / 2) * spread
    }

    const runs: EdgeRun[] = raw.map(e => {
      const hp = this.halfOf(e.parent)
      const hc = this.halfOf(e.child)
      return {
        x1: this.nodeX(e.parent) + hp - 5,
        y1: this.nodeY(e.parent) + fan(leaving.get(e.parent.id)!, e, hp, a => this.nodeY(a.child)),
        x2: this.nodeX(e.child) - hc + 5,
        y2: this.nodeY(e.child) + fan(arriving.get(e.child.id)!, e, hc, a => this.nodeY(a.parent)),
        color: e.color,
        state: e.state
      }
    })

    const stroke = (e: EdgeRun, width: number, alpha: number) => {
      g.lineStyle(width, e.color, alpha)
      g.beginPath()
      // Cubic with horizontal tangents; the pull grows with the horizontal
      // gap so long hops swing wide instead of kinking.
      const c = Math.max(46, Math.abs(e.x2 - e.x1) * 0.45)
      g.moveTo(e.x1, e.y1)
      const steps = 24
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps
        const mt = 1 - t
        const x = mt * mt * mt * e.x1 + 3 * mt * mt * t * (e.x1 + c) + 3 * mt * t * t * (e.x2 - c) + t * t * t * e.x2
        const y = (mt * mt * mt + 3 * mt * mt * t) * e.y1 + (3 * mt * t * t + t * t * t) * e.y2
        g.lineTo(x, y)
      }
      g.strokePath()
    }

    // Ghosts under glows under solids, so what you own is always on top.
    for (const e of runs) if (e.state === 'locked') stroke(e, 2, 0.16)
    for (const e of runs)
      if (e.state === 'available') {
        stroke(e, 7, 0.12)
        stroke(e, 3, 0.8)
      }
    for (const e of runs)
      if (e.state === 'owned') {
        stroke(e, 8, 0.16)
        stroke(e, 3.5, 1)
      }

    this.drawOaths()
  }

  /**
   * Oaths, drawn as what they are: a short broken tie between two nodes that
   * will never both be yours. It is dashed rather than solid because nothing
   * flows along it, and once one arm is sworn the tie goes cold and the other
   * arm greys out — the screen says "you gave that up" without a word.
   */
  private drawOaths(): void {
    const g = this.edges
    const drawn = new Set<string>()
    for (const view of this.views) {
      for (const rivalId of OATHS[view.node.id] ?? []) {
        const key = view.node.id < rivalId ? `${view.node.id}|${rivalId}` : `${rivalId}|${view.node.id}`
        if (drawn.has(key)) continue
        drawn.add(key)
        const rival = TECHS_BY_ID[rivalId]
        if (!rival) continue
        const ax = this.nodeX(view.node)
        const ay = this.nodeY(view.node)
        const bx = this.nodeX(rival)
        const by = this.nodeY(rival)
        const settled = this.army.techs.has(view.node.id) || this.army.techs.has(rivalId)
        const color = settled ? 0x6b3038 : 0xd8555f
        const alpha = settled ? 0.4 : 0.85
        // Dashes, walked along the straight line between the two medallions.
        const len = Math.max(1, Math.hypot(bx - ax, by - ay))
        const ux = (bx - ax) / len
        const uy = (by - ay) / len
        const inset = Math.max(this.halfOf(view.node), this.halfOf(rival)) + 2
        g.lineStyle(settled ? 2 : 2.5, color, alpha)
        for (let d = inset; d < len - inset; d += 11) {
          const e = Math.min(len - inset, d + 6)
          g.beginPath()
          g.moveTo(ax + ux * d, ay + uy * d)
          g.lineTo(ax + ux * e, ay + uy * e)
          g.strokePath()
        }
        // A break mark at the midpoint: the tie is cut, not merely thin.
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2
        g.lineStyle(settled ? 2 : 3, color, alpha)
        for (const sign of [-1, 1]) {
          g.beginPath()
          g.moveTo(mx - 5 * sign - uy * 5, my + ux * -5 + 0)
          g.lineTo(mx + 5 * sign + uy * 5, my + ux * 5 + 0)
          g.strokePath()
        }
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

  private lastClickId: TechId | null = null
  private lastClickAt = 0

  /** Click: selects the node — marker, detail strip and research button. */
  private focus(id: TechId): void {
    this.showDetail(id)
  }

  /**
   * Hover: describes the node in the strip WITHOUT stealing the selection.
   * The research button and the gold ring stay with the clicked node.
   */
  private preview(id: TechId): void {
    if (this.destroyed) return
    this.liftNode(id)
    this.fillStrip(id)
  }

  private drawMarker(): void {
    this.marker.clear()
    if (!this.focused) return
    const view = this.views.find(v => v.node.id === this.focused)
    if (!view) return
    this.marker.lineStyle(2, 0xffd66e, 0.9)
    this.marker.strokeCircle(view.x, view.y, this.halfOf(view.node) + 7)
  }

  private tryBuyFocused(): void {
    if (!this.focused) return
    if (this.army.techAvailability(this.focused) !== 'ready') {
      audio.play('ui_denied', 0.4)
      return
    }
    audio.play('ui_click', 0.6)
    this.onBuy(this.focused)
    this.showDetail(this.focused)
  }

  /** The research button always describes the focused node, or hides. */
  /**
   * How long this node would take at the rate this army's halls produce.
   *
   * Stated in seconds rather than points, because the number a commander wants
   * is "when", and points only answer that once you have divided them by a rate
   * you cannot see from the node.
   */
  private etaFor(id: string): string {
    const cost = this.army.researchCost(id as never)
    const rate = Math.max(0.1, this.army.researchRate)
    const secs = Math.ceil(cost / rate)
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
  }

  private updateBuyButton(): void {
    const node = this.focused ? TECHS_BY_ID[this.focused] : null
    if (!node) {
      this.buyBtn.container.setVisible(false)
      return
    }
    this.buyBtn.container.setVisible(true)
    switch (this.army.techAvailability(node.id)) {
      case 'owned':
        this.buyBtn.setText('RESEARCHED').setEnabled(false)
        break
      case 'ready':
        this.buyBtn
          .setText(node.kind === 'ascension' ? 'BEGIN ASCENSION' : `STUDY · ${this.etaFor(node.id)}`)
          .setEnabled(true)
        break
      case 'studying':
        this.buyBtn
          .setText(`${Math.round(this.army.studyProgress * 100)}%  ·  ABANDON`)
          .setEnabled(true)
        break
      case 'research':
        // Something else is on the bench. You may take it off, and lose it.
        this.buyBtn.setText(`SWITCH · ${this.etaFor(node.id)}`).setEnabled(true)
        break
      case 'age':
        this.buyBtn.setText(`AGE ${node.age + 1} FIRST`).setEnabled(false)
        break
      case 'demand':
        this.buyBtn.setText('EARN IT FIRST').setEnabled(false)
        break
      case 'sworn':
        this.buyBtn.setText('OATH ALREADY SWORN').setEnabled(false)
        break
      default:
        this.buyBtn.setText('LOCKED').setEnabled(false)
        break
    }
  }

  private liftNode(id: TechId): void {
    if (this.hovered === id) return
    for (const view of this.views) {
      const lift = view.node.id === id ? 1.12 : 1
      view.frame.setScale((view.frame.scaleX / (view.lift ?? 1)) * lift)
      view.icon.setScale((view.icon.scaleX / (view.lift ?? 1)) * lift)
      view.lift = lift
    }
    this.hovered = id
  }

  private showDetail(id: TechId): void {
    if (this.destroyed) return
    const node = TECHS_BY_ID[id]
    if (!node) return
    this.liftNode(id)
    this.focused = id
    this.drawMarker()
    this.updateBuyButton()
    this.fillStrip(id)
    this.drawEdges()
  }

  /** Text only — everything below the board that describes one node. */
  private fillStrip(id: TechId): void {
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
          : state === 'studying'
            ? `on the bench — ${Math.round(this.army.studyProgress * 100)}%, about ${Math.ceil(this.army.studySecondsLeft)}s left`
            : state === 'research'
              ? `${formatNumber(this.army.researchCost(node.id))} RP of work — the bench is busy`
            : state === 'age'
              ? `locked until age ${node.age + 1}`
              : state === 'demand' && node.demand
                ? `${node.demand.label} — ${formatNumber(Math.floor(this.army.deeds[node.demand.metric]))}/${formatNumber(node.demand.amount)}`
                : state === 'sworn'
                  ? `closed by your oath to ${TECHS_BY_ID[this.army.sworn(node.id) ?? '']?.name ?? 'the other road'}`
                  : 'prerequisites not met'

    this.detailName.setText(node.name).setColor(
      hex(node.kind === 'ascension' && node.becomes ? FACTIONS_BY_ID[node.becomes].accent : BRANCH_ACCENT[node.branch])
    )
    this.detailMeta.setText(
      `${kind}  ·  ring ${node.ring}  ·  ${formatNumber(node.cost)}g  ·  age ${node.age + 1}  ·  ${status}`
    )
    this.detailMeta.setColor(hex(state === 'owned' ? UI.good : state === 'ready' ? UI.gold : UI.textDim))
    // Flavour first, then the rules in numbers. For a unit node the numbers
    // are the unit's own card; for a stat node they derive from the node.
    const mechanics =
      TECH_MECHANICS[node.id] ??
      (node.kind === 'unit' && node.unlocks ? unitStatline(node.unlocks) : null) ??
      (node.branch !== 'core' ? LEAN_RULES[node.branch] : null)
    this.detailBody.setText(mechanics ? `${node.effect}\n▸ ${mechanics}` : node.effect)
    this.detailAffects
      .setText(`AFFECTS: ${affectedUnits(node, this.army)}`)
      .setColor(hex(KIND_BADGE[node.kind].color))

    const missing = node.requires.filter(r => !this.army.techs.has(r))
    const fork = node.requiresAny?.length
      ? ` · and either ${node.requiresAny.map(r => TECHS_BY_ID[r]?.name ?? r).join(' or ')}`
      : ''
    const forkUnmet = Boolean(node.requiresAny?.length) && !node.requiresAny!.some(r => this.army.techs.has(r))
    const base =
      node.requires.length === 0
        ? 'the root — needs nothing'
        : missing.length === 0
          ? `follows: ${node.requires.map(r => TECHS_BY_ID[r]?.name ?? r).join(', ')}`
          : `still needs: ${missing.map(r => TECHS_BY_ID[r]?.name ?? r).join(', ')}`
    // An oath is the most consequential thing on the screen, so it is said in
    // full before the click, not discovered afterwards.
    const rivals = oathRivals(node.id)
    const oath = rivals.length
      ? state === 'owned'
        ? `  ⟡ OATH SWORN — ${rivals.map(r => r.name).join(', ')} closed for this war`
        : state === 'sworn'
          ? `  ⟡ OATH LOST — you already swore ${TECHS_BY_ID[this.army.sworn(node.id) ?? '']?.name ?? 'the other road'}`
          : `  ⟡ OATH — taking this closes ${rivals.map(r => r.name).join(', ')} forever`
      : ''
    this.detailReq.setText(base + fork + oath)
    this.detailReq.setColor(
      hex(rivals.length && state !== 'owned' ? UI.warn : missing.length === 0 && !forkUnmet ? UI.textDim : UI.warn)
    )
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
      view.badge.setAlpha(state === 'locked' ? 0.55 : 1)

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
                : `${formatNumber(this.army.researchCost(view.node.id))} RP`
            )
            .setColor(hex(UI.gold))
          break
        case 'research':
          view.name.setColor(hex(UI.text)).setAlpha(0.8)
          view.tag
            .setText(`${formatNumber(this.army.researchCost(view.node.id))} RP · short`)
            .setColor(hex(UI.warn))
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
        case 'sworn':
          // Not "locked" — forsaken. It reads differently because it is
          // permanent, and because it was the player's own decision.
          view.name.setColor(hex(UI.bad)).setAlpha(0.45)
          view.tag.setText('OATH LOST').setColor(hex(UI.bad))
          break
        default:
          view.name.setColor(hex(UI.textDim)).setAlpha(0.5)
          view.tag.setText('').setColor(hex(UI.panelEdge))
          break
      }
    }
    this.drawEdges()
    this.updateBuyButton()
    // Gold or age may have moved under the strip; keep its words honest.
    if (this.focused) this.showDetail(this.focused)
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
