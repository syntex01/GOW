import Phaser from 'phaser'
import { gameEvents } from '../core/events'
import { session } from '../core/session'
import { ageDef } from '../data/ages'
import { TURRET_SLOTS, turretsForAge } from '../data/turrets'
import { morphInfoFor } from '../data/morphs'
import type { UnitDef } from '../data/types'
import { AGE_THEMES, FACTION_COLOR, TIER_COLORS, UI } from '../gfx/palette'
import { ensureUnitArt } from '../gfx/textureFactory'
import Tutorial from '../ui/tutorial'
import { audio } from '../core/audio'
import BasePanel from '../ui/basePanel'
import TechTree from '../ui/techTree'
import { Bar, Button, Modal, Tooltip, formatNumber, formatTime, hex, label, panel } from '../ui/widgets'
import BattleScene from './battleScene'

const BAR_Y = 600
const CARD_Y = 612
const CARD_W = 72
const CARD_H = 86

/** Overlay scene: every readout and control the player interacts with. */
export default class HUDScene extends Phaser.Scene {
  private battle!: BattleScene

  private goldText!: Phaser.GameObjects.Text
  private incomeText!: Phaser.GameObjects.Text
  /** So the siege warning fires when it starts, not once every frame. */
  private siegeWarned = false
  private ageText!: Phaser.GameObjects.Text
  private popText!: Phaser.GameObjects.Text
  private enemyGoldText!: Phaser.GameObjects.Text
  private enemyAgeText!: Phaser.GameObjects.Text
  private timerText!: Phaser.GameObjects.Text
  private waveText!: Phaser.GameObjects.Text

  private playerHpBar!: Bar
  private playerXpBar!: Bar
  private enemyHpBar!: Bar
  private enemyXpBar!: Bar

  private unitCards: { button: Button; def: UnitDef }[] = []
  private laneRows: { box: Phaser.GameObjects.Rectangle; mine: Phaser.GameObjects.Text; theirs: Phaser.GameObjects.Text }[] = []
  private turretButtons: Button[] = []
  private bannerPips: Phaser.GameObjects.Rectangle[] = []
  private evolveButton!: Button
  private abilityButton!: Button
  private economyButton!: Button
  private techButton!: Button
  private techTree?: TechTree
  private basePanel?: BasePanel
  private speedButton!: Button
  private pauseButton!: Button

  private queueIcons: { icon: Phaser.GameObjects.Image; bar: Bar }[] = []
  private tooltip!: Tooltip
  private toast!: Phaser.GameObjects.Text
  private toastTween?: Phaser.Tweens.Tween
  private pauseModal?: Modal
  private turretPopup?: Phaser.GameObjects.Container
  private tutorial?: Tutorial
  private lastAge = -1
  /** Identity of the roster on screen, so unlocks and ascension refresh it. */
  private lastRosterKey = ''

  constructor() {
    super({ key: 'HUDScene' })
  }

  create(): void {
    this.resetWidgets()
    gameEvents.on('hud:tech', () => this.toggleTechTree())
    gameEvents.on('hud:base', () => this.toggleBasePanel())
    this.battle = this.scene.get('BattleScene') as BattleScene
    this.buildTopBar()
    this.buildBottomBar()

    this.tooltip = new Tooltip(this, 1500)
    this.toast = this.add
      .text(this.cameras.main.width / 2, 150, '', {
        fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
        fontSize: '30px',
        color: hex(UI.text),
        stroke: hex(UI.ink),
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(1400)

    this.buildLanePicker()

    gameEvents.on('hud:flash', this.showToast, this)
    gameEvents.on('match:paused', this.handlePause, this)
    gameEvents.on('hud:lane', this.refreshLanes, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('hud:flash', this.showToast, this)
      gameEvents.off('match:paused', this.handlePause, this)
      gameEvents.off('hud:lane', this.refreshLanes, this)
      this.tooltip.destroy()
      this.pauseModal?.destroy()
      this.tutorial?.destroy()
    })

    this.rebuildRoster()

    // First-time players get a short, self-paced walkthrough.
    const level = session.setup.level
    if (session.setup.mode === 'campaign' && level && Tutorial.shouldRun(level.id)) {
      this.tutorial = new Tutorial(this, this.battle.battlefield)
    }
  }

  /**
   * The scene instance is reused across restarts, so these arrays still hold
   * the previous match's destroyed widgets. Clearing them stops `update()`
   * from poking objects whose textures are already gone.
   */
  private resetWidgets(): void {
    this.techTree?.destroy()
    this.techTree = undefined
    this.basePanel?.destroy()
    this.basePanel = undefined
    this.unitCards = []
    this.turretButtons = []
    this.queueIcons = []
    this.turretPopup = undefined
    this.pauseModal = undefined
    this.tutorial = undefined
    this.lastAge = -1
    this.lastRosterKey = ''
  }

  // ─────────────────────────────── Top bar ───────────────────────────────

  private buildTopBar(): void {
    const width = this.cameras.main.width
    this.add.existing(panel(this, 0, -20, width, 96, 'ui:glass').setDepth(0))

    // Player block.
    this.ageText = label(this, 14, 6, 'Stone Age', { size: 17, bold: true, color: UI.player }).setDepth(2)
    this.goldText = label(this, 14, 28, '0', { size: 27, display: true, color: UI.gold }).setDepth(2)
    this.incomeText = label(this, 14, 56, '+0/s', { size: 12, color: UI.textDim }).setDepth(2)

    label(this, 200, 6, 'FORTRESS', { size: 11, color: UI.textDim }).setDepth(2)
    this.playerHpBar = new Bar(this, 200, 20, 250, 14, UI.player)
    this.playerHpBar.setDepth(2)
    label(this, 200, 40, 'EVOLUTION', { size: 11, color: UI.textDim }).setDepth(2)
    this.playerXpBar = new Bar(this, 200, 54, 250, 9, UI.xp)
    this.playerXpBar.setDepth(2)
    this.popText = label(this, 460, 20, '0/0', { size: 13, color: UI.textDim }).setDepth(2)

    // Centre block.
    const cx = width / 2
    this.timerText = label(this, cx, 2, '0:00', { size: 24, display: true, align: 'center' }).setDepth(2)
    this.waveText = label(this, cx, 30, '', { size: 12, align: 'center', color: UI.warn }).setDepth(2)

    this.speedButton = new Button(this, cx - 68, 48, {
      width: 62,
      height: 38,
      text: '1x',
      fontSize: 17,
      accent: UI.accent,
      corner: 'F',
      onClick: () => {
        this.battle.cycleSpeed()
        this.speedButton.setText(`${this.battle.speed}x`)
      }
    })
    this.speedButton.setDepth(2)

    this.pauseButton = new Button(this, cx + 6, 48, {
      width: 62,
      height: 38,
      text: 'II',
      fontSize: 17,
      accent: UI.panelEdge,
      corner: 'Esc',
      onClick: () => this.battle.togglePause()
    })
    this.pauseButton.setDepth(2)

    // Enemy block (mirrored).
    this.enemyAgeText = label(this, width - 14, 6, 'Stone Age', {
      size: 17,
      bold: true,
      color: UI.enemy,
      align: 'right'
    }).setDepth(2)
    this.enemyGoldText = label(this, width - 14, 28, '0', {
      size: 27,
      display: true,
      color: UI.gold,
      align: 'right'
    }).setDepth(2)

    label(this, width - 202, 6, 'ENEMY FORTRESS', { size: 11, color: UI.textDim, align: 'right' }).setDepth(2)
    this.enemyHpBar = new Bar(this, width - 452, 20, 250, 14, UI.enemy)
    this.enemyHpBar.setDepth(2)
    label(this, width - 202, 38, 'THEIR EVOLUTION', { size: 11, color: UI.textDim, align: 'right' }).setDepth(2)
    this.enemyXpBar = new Bar(this, width - 452, 54, 250, 9, 0x8a5cf6)
    this.enemyXpBar.setDepth(2)
  }

  // ────────────────────────────── Bottom bar ──────────────────────────────

  private buildBottomBar(): void {
    const width = this.cameras.main.width
    this.add.existing(panel(this, 0, BAR_Y, width, 130, 'ui:glass').setDepth(0))

    // Turret slots — a 2×2 grid, because eleven unit cards now own the
    // bar's left flank and the old row of four no longer fits beside them.
    for (let i = 0; i < TURRET_SLOTS; i += 1) {
      const button = new Button(this, 852 + (i % 2) * 60, CARD_Y + Math.floor(i / 2) * 45, {
        width: 56,
        height: 41,
        text: '+',
        fontSize: 16,
        accent: UI.warn,
        onClick: () => this.handleTurretSlot(i)
      })
      button.setDepth(2)
      this.turretButtons.push(button)
    }

    this.techButton = new Button(this, 980, CARD_Y, {
      width: 70,
      height: CARD_H,
      text: 'TECH',
      subtext: 'research',
      fontSize: 13,
      accent: 0xb46bff,
      corner: 'R',
      onClick: () => this.toggleTechTree()
    })
    this.techButton.setDepth(2)

    this.economyButton = new Button(this, 1054, CARD_Y, {
      width: 70,
      height: CARD_H,
      text: 'BASE',
      subtext: '—',
      fontSize: 13,
      accent: UI.gold,
      corner: 'U',
      onClick: () => this.toggleBasePanel()
    })
    this.economyButton.setDepth(2)

    this.evolveButton = new Button(this, 1128, CARD_Y, {
      width: 70,
      height: CARD_H,
      text: 'EVOLVE',
      subtext: '—',
      fontSize: 13,
      accent: UI.xp,
      corner: 'E',
      onClick: () => this.battle.tryEvolve()
    })
    this.evolveButton.setDepth(2)

    this.abilityButton = new Button(this, 1202, CARD_Y, {
      width: 68,
      height: CARD_H,
      text: 'ABILITY',
      subtext: 'charging',
      fontSize: 12,
      accent: UI.accent,
      corner: 'Q / Space',
      onClick: () => this.battle.tryAbility()
    })
    this.abilityButton.setDepth(2)
  }

  /** Rebuilds the unit cards after an age change. */
  private rebuildRoster(): void {
    this.unitCards.forEach(c => c.button.destroy())
    this.unitCards = []

    const army = this.battle.localArmy
    const roster = army.roster
    // Morphed units are derived, so their sprite and icon may not exist yet.
    roster.forEach(def => ensureUnitArt(this, def))
    roster.forEach((def, i) => {
      const button = new Button(this, 10 + i * (CARD_W + 4), CARD_Y, {
        width: CARD_W,
        height: CARD_H,
        icon: `icon:${def.id}`,
        iconScale: 0.62,
        subtext: `${def.cost}`,
        accent: ROLE_COLORS[def.role] ?? UI.panelEdge,
        corner: `${i + 1}`,
        onClick: () => this.battle.queueByIndex(i),
        onHover: () => this.showUnitTooltip(def, 10 + i * (CARD_W + 4)),
        onOut: () => this.tooltip.hide()
      })
      button.setDepth(2)
      this.unitCards.push({ button, def })
    })
    this.lastAge = army.age
    this.lastRosterKey = roster.map(d => d.id).join(',')
  }

  private showUnitTooltip(def: UnitDef, x: number): void {
    const dps = (def.damage / (def.attackMs / 1000)).toFixed(0)
    const lines = [
      `${def.role.toUpperCase()} · ${def.armor} armour · ${def.pop} pop`,
      `${def.hp} HP · ${def.damage} ${def.damageType} · ~${dps} DPS`,
      `Range ${def.range} · Speed ${def.speed} · Build ${(def.buildMs / 1000).toFixed(1)}s`,
      def.hitsAir ? 'Can hit air targets' : 'Ground targets only',
      '',
      def.description
    ]
    const morph = morphInfoFor(def.id)
    if (morph) {
      lines.splice(4, 0, `${morph.title} doctrine, stage ${morph.stage} — was ${morph.baseName}`)
    }
    this.tooltip.show(x, BAR_Y - 8, `${def.name} — ${def.cost} gold`, lines.join('\n'))
  }

  // ──────────────────────────── Turret handling ────────────────────────────

  /** Opens or closes the research screen. */
  private toggleTechTree(): void {
    if (this.techTree) {
      this.techTree.destroy()
      this.techTree = undefined
      this.battle.modalOpen = false
      return
    }
    this.battle.modalOpen = true
    audio.play('ui_click', 0.5)
    this.techTree = new TechTree(
      this,
      this.battle.localArmy,
      id => {
        if (this.battle.tryTech(id)) this.techTree?.refresh()
      },
      () => {
        this.techTree?.destroy()
        this.techTree = undefined
        this.battle.modalOpen = false
      }
    )
  }

  /**
   * Opens or closes the outworks. Every action inside it goes back through the
   * battle scene's command path, so a networked match applies it on the same
   * tick on both machines — the panel never touches the simulation directly.
   */
  private toggleBasePanel(): void {
    if (this.basePanel) {
      this.basePanel.destroy()
      this.basePanel = undefined
      this.battle.modalOpen = false
      return
    }
    this.battle.modalOpen = true
    audio.play('ui_click', 0.5)
    const close = (): void => {
      this.basePanel?.destroy()
      this.basePanel = undefined
      this.battle.modalOpen = false
    }
    this.basePanel = new BasePanel(this, this.battle.battlefield, this.battle.localFaction, {
      build: (plot, id) => {
        if (this.battle.tryBuild(plot, id)) this.basePanel?.refresh()
      },
      raze: plot => {
        if (this.battle.tryRaze(plot)) this.basePanel?.refresh()
      },
      fortify: track => {
        if (this.battle.tryFortify(track as never)) this.basePanel?.refresh()
      },
      garrison: (seat, id) => {
        if (this.battle.trySetGarrison(seat, id)) this.basePanel?.refresh()
      },
      close
    })
  }

  private handleTurretSlot(index: number): void {
    const base = this.battle.localBase
    const slot = base.slots[index]
    this.closeTurretPopup()
    if (slot.def) {
      this.openTurretPopup(index, true)
    } else {
      this.openTurretPopup(index, false)
    }
  }

  private openTurretPopup(slotIndex: number, occupied: boolean): void {
    const army = this.battle.localArmy
    const base = this.battle.localBase
    const options = occupied ? [] : turretsForAge(army.age).slice(-4)
    const rows = occupied ? 1 : options.length
    const popupW = 320
    const rowH = 62
    const popupH = rows * rowH + 46
    const x = Phaser.Math.Clamp(600 - popupW / 2, 8, this.cameras.main.width - popupW - 8)
    const y = BAR_Y - popupH - 8

    const container = this.add.container(0, 0).setDepth(1600)
    const backdrop = this.add
      .rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.01)
      .setOrigin(0, 0)
      .setInteractive()
    backdrop.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.closeTurretPopup())
    container.add(backdrop)
    container.add(panel(this, x, y, popupW, popupH))

    if (occupied) {
      const def = base.slots[slotIndex].def
      if (!def) return
      container.add(label(this, x + 14, y + 12, def.name, { size: 18, bold: true, color: UI.warn }))
      const hpRatio = base.slots[slotIndex].hp / def.hp
      container.add(
        label(this, x + 14, y + 34, `Integrity ${Math.round(hpRatio * 100)}%  ·  DMG ${def.damage}  ·  RNG ${def.range}`, {
          size: 13,
          color: UI.textDim
        })
      )
      const sell = new Button(this, x + 14, y + 58, {
        width: popupW - 28,
        height: 46,
        text: `SELL FOR ${Math.round(def.cost * 0.6 * hpRatio)} GOLD`,
        fontSize: 16,
        accent: UI.bad,
        onClick: () => {
          this.battle.sellTurret(slotIndex)
          this.closeTurretPopup()
        }
      })
      sell.setDepth(1601)
      container.add(sell.container)
    } else if (options.length === 0) {
      container.add(label(this, x + 14, y + 16, 'No defences available yet.', { size: 15, color: UI.textDim }))
    } else {
      container.add(label(this, x + 14, y + 10, 'BUILD DEFENCE', { size: 14, bold: true, color: UI.warn }))
      options.forEach((def, i) => {
        const affordable = army.gold >= def.cost
        const b = new Button(this, x + 12, y + 36 + i * rowH, {
          width: popupW - 24,
          height: rowH - 6,
          text: def.name,
          subtext: `${def.cost} gold · DMG ${def.damage} · RNG ${def.range}${def.hitsAir ? ' · AA' : ''}`,
          fontSize: 16,
          accent: TIER_COLORS[def.age],
          onClick: () => {
            if (army.gold < def.cost) {
              this.showToast({ message: 'Not enough gold', tone: 'warn' })
              return
            }
            this.battle.buildTurret(slotIndex, def.id)
            this.closeTurretPopup()
          }
        })
        b.setEnabled(affordable).setDepth(1601)
        container.add(b.container)
      })
    }

    this.turretPopup = container
  }

  private closeTurretPopup(): void {
    this.turretPopup?.destroy()
    this.turretPopup = undefined
  }

  // ─────────────────────────────── Pause ───────────────────────────────

  private handlePause = ({ paused }: { paused: boolean }): void => {
    if (!paused) {
      this.pauseModal?.destroy()
      this.pauseModal = undefined
      return
    }
    const modal = new Modal(this, 460, 340, 1800)
    const px = modal.panelX
    const py = modal.panelY
    modal.add(label(this, px + 460 / 2, py + 24, 'PAUSED', { size: 40, display: true, align: 'center' }))

    const setup = session.setup
    const subtitle =
      setup.mode === 'campaign' && setup.level
        ? setup.level.name
        : setup.mode === 'endless'
          ? `Endless Siege — wave ${this.battle.wave}`
          : 'Quick Battle'
    modal.add(label(this, px + 460 / 2, py + 74, subtitle, { size: 15, align: 'center', color: UI.textDim }))

    const resume = new Button(this, px + 40, py + 116, {
      width: 380,
      height: 58,
      text: 'RESUME',
      fontSize: 22,
      accent: UI.good,
      onClick: () => this.battle.togglePause()
    })
    const restart = new Button(this, px + 40, py + 184, {
      width: 380,
      height: 58,
      text: 'RESTART BATTLE',
      fontSize: 20,
      accent: UI.warn,
      onClick: () => {
        this.battle.scene.stop('HUDScene')
        this.battle.scene.restart()
      }
    })
    const quit = new Button(this, px + 40, py + 252, {
      width: 380,
      height: 58,
      text: 'ABANDON — RETURN TO MENU',
      fontSize: 17,
      accent: UI.bad,
      onClick: () => this.battle.quitToMenu()
    })
    modal.add([resume.container, restart.container, quit.container])
    this.pauseModal = modal
  }

  private showToast = ({ message, tone }: { message: string; tone: 'info' | 'warn' | 'good' }): void => {
    const color = tone === 'good' ? UI.good : tone === 'warn' ? UI.warn : UI.text
    this.toast.setText(message).setColor(hex(color)).setAlpha(1).setScale(0.8)
    this.toastTween?.stop()
    this.toastTween = this.tweens.add({
      targets: this.toast,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({ targets: this.toast, alpha: 0, delay: 1100, duration: 420 })
      }
    })
  }

  // ─────────────────────────────── Per-frame ───────────────────────────────

  /**
   * The lane picker: three files, the active one lit.
   *
   * Placement is the only decision this game asks for, so its control earns a
   * permanent place on the screen: click a row, press Z/X/C, or click the path
   * itself in the world. The counts alongside are the board state — how many
   * pieces of each side walk each file — because a chess player is always
   * counting the file before committing to it.
   */
  private buildLanePicker(): void {
    const x = 12
    const y0 = BAR_Y - 130
    const names = ['FAR', '·', 'MID', '·', 'NEAR']
    this.laneRows = []
    for (let lane = 0; lane < 5; lane += 1) {
      const y = y0 + lane * 24
      const box = this.add
        .rectangle(x, y, 148, 21, UI.panel, 0.85)
        .setOrigin(0, 0)
        .setStrokeStyle(1, UI.panelEdge)
        .setDepth(900)
        .setInteractive({ useHandCursor: true })
      box.on('pointerup', () => {
        this.battle.localLane = lane
        audio.play('ui_click', 0.35)
        this.refreshLanes()
      })
      const name = label(this, x + 8, y + 4, `${['Z', 'X', 'C', 'V', 'B'][lane]} ${names[lane]}`, {
        size: 11,
        bold: true,
        color: UI.textDim
      }).setDepth(901)
      const mine = label(this, x + 88, y + 4, '', { size: 11, color: UI.good }).setDepth(901)
      const theirs = label(this, x + 116, y + 4, '', { size: 11, color: UI.bad }).setDepth(901)
      void name
      this.laneRows.push({ box, mine, theirs })
    }
    this.refreshLanes()
  }

  private refreshLanes(): void {
    if (this.laneRows.length === 0) return
    const bf = this.battle?.battlefield
    for (let lane = 0; lane < 5; lane += 1) {
      const row = this.laneRows[lane]
      const active = this.battle.localLane === lane
      row.box.setStrokeStyle(active ? 2 : 1, active ? UI.gold : UI.panelEdge)
      row.box.setFillStyle(active ? 0x1d2740 : UI.panel, active ? 0.95 : 0.7)
      if (!bf) continue
      let mine = 0
      let theirs = 0
      for (const u of bf.units) {
        if (!u.alive || u.layer === 'air' || u.lane !== lane) continue
        if (u.faction === this.battle.localFaction) mine += 1
        else theirs += 1
      }
      row.mine.setText(String(mine))
      row.theirs.setText(String(theirs))
    }
  }

  override update(_time: number, delta: number): void {
    const bf = this.battle?.battlefield
    if (!bf) return
    if (this.bannerPips.length !== bf.banners.length) {
      this.bannerPips.forEach(p => p.destroy())
      const n = bf.banners.length
      this.bannerPips = bf.banners.map((_, i) =>
        this.add
          .rectangle(this.cameras.main.width / 2 + (i - (n - 1) / 2) * 26, 44, 16, 8, 0x39415a, 1)
          .setStrokeStyle(1, 0x11141c)
          .setDepth(2)
      )
    }
    for (let i = 0; i < this.bannerPips.length; i += 1) {
      const hold = bf.banners[i]?.hold ?? 0
      this.bannerPips[i].setFillStyle(hold >= 50 ? 0x63b3ff : hold <= -50 ? 0xff5a52 : 0x39415a, 1)
    }
    if (!this.battle.paused) this.tutorial?.update(delta)
    // Gold and ages move while the research screen is open, so what it says is
    // affordable has to keep up.
    this.techTree?.refresh()
    // "player"/"enemy" here mean *this client's* side and its opponent, which
    // for the guest in a networked match is the world's 'enemy' faction.
    const player = this.battle.localArmy
    const enemy = this.battle.foeArmy
    const myBase = this.battle.localBase
    const foeBase = this.battle.foeBase

    // Research changes the roster mid-age — an unlock adds a card, ascension
    // replaces every one of them — so the bar tracks the roster's identity
    // rather than just the age it belongs to.
    if (player.age !== this.lastAge || this.battle.localArmy.roster.map(d => d.id).join(',') !== this.lastRosterKey) {
      this.rebuildRoster()
    }

    this.refreshLanes()
    this.goldText.setText(formatNumber(player.gold))
    // A cut supply line is the most expensive thing that can be happening to
    // you, and it happens off-screen at the wall — so it is said in the one
    // place the player is already looking, in the colour of a problem.
    const siege = Math.round(player.siege * 100)
    this.incomeText
      .setText(siege > 0 ? `+${player.incomePerSecond.toFixed(0)}/s  SIEGED −${siege}%` : `+${player.incomePerSecond.toFixed(0)}/s`)
      .setColor(hex(siege >= 40 ? UI.bad : siege > 0 ? UI.warn : UI.textDim))
    if (siege > 0 && this.siegeWarned === false) {
      this.siegeWarned = true
      gameEvents.emit('hud:flash', { message: 'Supply line cut — clear your wall', tone: 'warn' })
    } else if (siege === 0) this.siegeWarned = false
    this.ageText.setText(ageDef(player.age).name).setColor(hex(AGE_ACCENT[player.age]))
    this.popText.setText(`${player.population + player.queuedPopulation()}/${player.populationCap}`)
    this.enemyGoldText.setText(formatNumber(enemy.gold))
    this.enemyAgeText.setText(ageDef(enemy.age).name)

    const mine = FACTION_COLOR[this.battle.localFaction]
    const theirs = FACTION_COLOR[this.battle.foeArmy.faction]
    this.playerHpBar.setValue(myBase.hp / myBase.maxHp)
    this.playerHpBar.setColor(healthColor(myBase.hp / myBase.maxHp, mine))
    this.enemyHpBar.setValue(foeBase.hp / foeBase.maxHp)
    this.enemyHpBar.setColor(healthColor(foeBase.hp / foeBase.maxHp, theirs))

    // A full bar is a promise: hold back the last sliver until evolving is
    // genuinely possible, so "the bar is full" and "the button works" can
    // never disagree.
    this.playerXpBar.setValue(
      player.age >= 4 ? 1 : player.xp >= player.xpToAdvance ? 1 : Math.min(0.97, player.xp / player.xpToAdvance)
    )
    this.enemyXpBar.setValue(enemy.age >= 4 ? 1 : enemy.xp / enemy.xpToAdvance)

    this.timerText.setText(formatTime(bf.elapsedMs))
    const statusBits: string[] = []
    if (session.setup.mode === 'endless') statusBits.push(`WAVE ${this.battle.wave}`)
    if (this.battle.isNetworked) {
      statusBits.push(this.battle.lockstep?.isStalled ? 'WAITING FOR OPPONENT' : 'VERSUS')
    } else if (this.battle.speed !== 1) {
      statusBits.push(`${this.battle.speed}x`)
    }
    this.waveText.setText(statusBits.join('  ·  '))
    this.speedButton.setText(`${this.battle.speed}x`)

    this.updateUnitCards()
    this.updateQueue()
    this.updateActionButtons()
    this.updateTurretButtons()
  }

  private updateUnitCards(): void {
    const army = this.battle.localArmy
    for (const { button, def } of this.unitCards) {
      const blocked = army.blockReason(def)
      button.setEnabled(blocked === null)
      button.setSubtext(`${def.cost}`, army.gold >= def.cost ? UI.gold : UI.bad)
    }
  }

  private updateQueue(): void {
    const queue = this.battle.localArmy.queue
    while (this.queueIcons.length < queue.length) {
      const index = this.queueIcons.length
      const icon = this.add.image(24 + index * 46, 566, 'ui:pixel').setScale(0.5).setDepth(3)
      const bar = new Bar(this, 6 + index * 46, 586, 36, 6, UI.good)
      bar.setDepth(3).setVisible(false)
      this.queueIcons.push({ icon, bar })
    }
    this.queueIcons.forEach((entry, i) => {
      const item = queue[i]
      if (!item) {
        entry.icon.setVisible(false)
        entry.bar.setValue(0).setVisible(false)
        return
      }
      entry.icon.setVisible(true).setTexture(`icon:${item.def.id}`).setScale(0.42)
      entry.bar.setVisible(true).setValue(1 - item.remainingMs / item.totalMs)
    })
  }

  private updateActionButtons(): void {
    const army = this.battle.localArmy

    // Evolve.
    if (army.age >= 4) {
      this.evolveButton.setText('MAX AGE').setSubtext('—', UI.textDim).setEnabled(false).setCooldown(0)
    } else {
      const xpRatio = Math.min(1, army.xp / army.xpToAdvance)
      const ready = army.canEvolve
      const xpFull = army.xp >= army.xpToAdvance
      // FLOOR, never round: rounding showed "100% XP" from 99.5% up, so a
      // button that was genuinely one experience point short claimed it was
      // ready and then refused to work. And when experience IS full, the
      // thing standing in the way is gold — so say gold.
      const shown = xpFull ? 100 : Math.min(99, Math.floor(xpRatio * 100))
      this.evolveButton
        .setText('EVOLVE')
        .setSubtext(
          ready ? `${army.evolveCost} gold` : xpFull ? `needs ${formatNumber(army.evolveCost)}g` : `${shown}% XP`,
          ready ? UI.gold : xpFull ? UI.warn : UI.textDim
        )
        // Always live: a click that cannot evolve still explains itself.
        .setEnabled(true)
        .setMuted(!ready)
        .setCooldown(1 - xpRatio)
      if (ready) this.evolveButton.setAccent(UI.good)
      else this.evolveButton.setAccent(UI.xp)
    }

    // Ability.
    const ability = army.ability
    const ready = army.abilityReady
    this.abilityButton
      .setText(ability.short)
      .setSubtext(
        ready ? 'READY' : `${Math.min(99, Math.floor(army.abilityCharge * 100))}%`,
        ready ? UI.good : UI.textDim
      )
      .setEnabled(true)
      .setMuted(!ready)
      .setCooldown(1 - army.abilityCharge)
      .setAccent(ready ? UI.good : UI.accent)

    // The outworks. The button reports how much of your ground is developed,
    // because that is the number a commander actually watches — an empty plot
    // is money not working and a burned one is money that stopped.
    const plots = this.battle.battlefield.activeSeat(this.battle.localFaction).plots
    const up = plots.filter(p => p.alive).length
    const hurt = plots.some(p => p.def && !p.alive)
    this.economyButton
      .setText('BASE')
      .setSubtext(`${up}/${plots.length} plots`, hurt ? UI.bad : up === plots.length ? UI.good : UI.gold)
      .setEnabled(true)
  }

  private updateTurretButtons(): void {
    const base = this.battle.localBase
    const army = this.battle.localArmy
    base.slots.forEach((slot, i) => {
      const button = this.turretButtons[i]
      if (slot.def) {
        const ratio = slot.hp / slot.def.hp
        button
          .setText(slot.def.name.split(' ')[0])
          .setFontSize(13)
          .setSubtext(`${Math.round(ratio * 100)}%`, ratio > 0.5 ? UI.good : UI.bad)
          .setAccent(TIER_COLORS[slot.def.age])
          .setEnabled(true)
      } else {
        const affordable = turretsForAge(army.age).some(t => t.cost <= army.gold)
        button
          .setText('+')
          .setFontSize(26)
          .setSubtext('turret', affordable ? UI.gold : UI.textDim)
          .setAccent(UI.warn)
          .setEnabled(true)
      }
    })
  }
}

const ROLE_COLORS: Record<string, number> = {
  melee: 0xf87171,
  ranged: 0x6ec7ff,
  siege: 0xf2c14e,
  air: 0x8b5cf6,
  support: 0x4ade80,
  tank: 0xfb923c
}

const AGE_ACCENT = AGE_THEMES.map(t => t.fog)

function healthColor(ratio: number, base: number): number {
  if (ratio > 0.5) return base
  if (ratio > 0.22) return UI.warn
  return UI.bad
}
