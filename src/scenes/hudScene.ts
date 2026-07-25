import Phaser from 'phaser'
import { gameEvents } from '../core/events'
import { session } from '../core/session'
import { ageDef } from '../data/ages'
import { TURRET_SLOTS, turretsForAge } from '../data/turrets'
import type { UnitDef } from '../data/types'
import { AGE_THEMES, TIER_COLORS, UI } from '../gfx/palette'
import Tutorial from '../ui/tutorial'
import { Bar, Button, Modal, Tooltip, formatNumber, formatTime, hex, label, panel } from '../ui/widgets'
import BattleScene from './battleScene'

const BAR_Y = 600
const CARD_Y = 612
const CARD_W = 86
const CARD_H = 86

/** Overlay scene: every readout and control the player interacts with. */
export default class HUDScene extends Phaser.Scene {
  private battle!: BattleScene

  private goldText!: Phaser.GameObjects.Text
  private incomeText!: Phaser.GameObjects.Text
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
  private turretButtons: Button[] = []
  private evolveButton!: Button
  private abilityButton!: Button
  private economyButton!: Button
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

  constructor() {
    super({ key: 'HUDScene' })
  }

  create(): void {
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

    gameEvents.on('hud:flash', this.showToast, this)
    gameEvents.on('match:paused', this.handlePause, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('hud:flash', this.showToast, this)
      gameEvents.off('match:paused', this.handlePause, this)
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

    // Turret slots.
    for (let i = 0; i < TURRET_SLOTS; i += 1) {
      const button = new Button(this, 664 + i * 76, CARD_Y, {
        width: 72,
        height: CARD_H,
        text: '+',
        subtext: 'turret',
        fontSize: 26,
        accent: UI.warn,
        onClick: () => this.handleTurretSlot(i)
      })
      button.setDepth(2)
      this.turretButtons.push(button)
    }

    this.economyButton = new Button(this, 900, CARD_Y, {
      width: 84,
      height: CARD_H,
      text: 'ECON',
      subtext: '—',
      fontSize: 16,
      accent: UI.gold,
      corner: 'U',
      onClick: () => this.battle.tryEconomy()
    })
    this.economyButton.setDepth(2)

    this.evolveButton = new Button(this, 992, CARD_Y, {
      width: 128,
      height: CARD_H,
      text: 'EVOLVE',
      subtext: '—',
      fontSize: 19,
      accent: UI.xp,
      corner: 'E',
      onClick: () => this.battle.tryEvolve()
    })
    this.evolveButton.setDepth(2)

    this.abilityButton = new Button(this, 1128, CARD_Y, {
      width: 140,
      height: CARD_H,
      text: 'ABILITY',
      subtext: 'charging',
      fontSize: 16,
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

    const army = this.battle.battlefield.player
    const roster = army.roster
    roster.forEach((def, i) => {
      const button = new Button(this, 12 + i * (CARD_W + 6), CARD_Y, {
        width: CARD_W,
        height: CARD_H,
        icon: `icon:${def.id}`,
        iconScale: 0.62,
        subtext: `${def.cost}`,
        accent: ROLE_COLORS[def.role] ?? UI.panelEdge,
        corner: `${i + 1}`,
        onClick: () => this.battle.queueByIndex(i),
        onHover: () => this.showUnitTooltip(def, 12 + i * (CARD_W + 6)),
        onOut: () => this.tooltip.hide()
      })
      button.setDepth(2)
      this.unitCards.push({ button, def })
    })
    this.lastAge = army.age
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
    this.tooltip.show(x, BAR_Y - 8, `${def.name} — ${def.cost} gold`, lines.join('\n'))
  }

  // ──────────────────────────── Turret handling ────────────────────────────

  private handleTurretSlot(index: number): void {
    const base = this.battle.battlefield.playerBase
    const slot = base.slots[index]
    this.closeTurretPopup()
    if (slot.def) {
      this.openTurretPopup(index, true)
    } else {
      this.openTurretPopup(index, false)
    }
  }

  private openTurretPopup(slotIndex: number, occupied: boolean): void {
    const army = this.battle.battlefield.player
    const base = this.battle.battlefield.playerBase
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
          this.battle.battlefield.sellTurret('player', slotIndex)
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
            if (this.battle.battlefield.buildTurret('player', slotIndex, def.id)) {
              this.closeTurretPopup()
            } else {
              this.showToast({ message: 'Not enough gold', tone: 'warn' })
            }
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

  override update(_time: number, delta: number): void {
    const bf = this.battle?.battlefield
    if (!bf) return
    if (!this.battle.paused) this.tutorial?.update(delta)
    const player = bf.player
    const enemy = bf.enemy

    if (player.age !== this.lastAge) this.rebuildRoster()

    this.goldText.setText(formatNumber(player.gold))
    this.incomeText.setText(`+${player.incomePerSecond.toFixed(0)}/s`)
    this.ageText.setText(ageDef(player.age).name).setColor(hex(AGE_ACCENT[player.age]))
    this.popText.setText(`${player.population + player.queuedPopulation()}/${player.populationCap}`)
    this.enemyGoldText.setText(formatNumber(enemy.gold))
    this.enemyAgeText.setText(ageDef(enemy.age).name)

    this.playerHpBar.setValue(bf.playerBase.hp / bf.playerBase.maxHp)
    this.playerHpBar.setColor(healthColor(bf.playerBase.hp / bf.playerBase.maxHp, UI.player))
    this.enemyHpBar.setValue(bf.enemyBase.hp / bf.enemyBase.maxHp)
    this.enemyHpBar.setColor(healthColor(bf.enemyBase.hp / bf.enemyBase.maxHp, UI.enemy))

    this.playerXpBar.setValue(player.age >= 4 ? 1 : player.xp / player.xpToAdvance)
    this.enemyXpBar.setValue(enemy.age >= 4 ? 1 : enemy.xp / enemy.xpToAdvance)

    this.timerText.setText(formatTime(bf.elapsedMs))
    const statusBits: string[] = []
    if (session.setup.mode === 'endless') statusBits.push(`WAVE ${this.battle.wave}`)
    if (this.battle.speed !== 1) statusBits.push(`${this.battle.speed}x`)
    this.waveText.setText(statusBits.join('  ·  '))
    this.speedButton.setText(`${this.battle.speed}x`)

    this.updateUnitCards()
    this.updateQueue()
    this.updateActionButtons()
    this.updateTurretButtons()
  }

  private updateUnitCards(): void {
    const army = this.battle.battlefield.player
    for (const { button, def } of this.unitCards) {
      const blocked = army.blockReason(def)
      button.setEnabled(blocked === null)
      button.setSubtext(`${def.cost}`, army.gold >= def.cost ? UI.gold : UI.bad)
    }
  }

  private updateQueue(): void {
    const queue = this.battle.battlefield.player.queue
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
    const army = this.battle.battlefield.player

    // Evolve.
    if (army.age >= 4) {
      this.evolveButton.setText('MAX AGE').setSubtext('—', UI.textDim).setEnabled(false).setCooldown(0)
    } else {
      const xpRatio = Math.min(1, army.xp / army.xpToAdvance)
      const ready = army.canEvolve
      this.evolveButton
        .setText('EVOLVE')
        .setSubtext(ready ? `${army.evolveCost} gold` : `${Math.round(xpRatio * 100)}% XP`, ready ? UI.gold : UI.textDim)
        .setEnabled(ready)
        .setCooldown(1 - xpRatio)
      if (ready) this.evolveButton.setAccent(UI.good)
      else this.evolveButton.setAccent(UI.xp)
    }

    // Ability.
    const ability = army.ability
    const ready = army.abilityReady
    this.abilityButton
      .setText(ability.short)
      .setSubtext(ready ? 'READY' : `${Math.round(army.abilityCharge * 100)}%`, ready ? UI.good : UI.textDim)
      .setEnabled(ready)
      .setCooldown(1 - army.abilityCharge)
      .setAccent(ready ? UI.good : UI.accent)

    // Economy.
    const cost = army.incomeUpgradeCost()
    if (cost === null) {
      this.economyButton.setText('ECON').setSubtext('MAX', UI.good).setEnabled(false)
    } else {
      this.economyButton
        .setText(`ECON ${army.incomeLevel + 1}`)
        .setSubtext(`${formatNumber(cost)}`, army.gold >= cost ? UI.gold : UI.bad)
        .setEnabled(army.gold >= cost)
    }
  }

  private updateTurretButtons(): void {
    const base = this.battle.battlefield.playerBase
    const army = this.battle.battlefield.player
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
