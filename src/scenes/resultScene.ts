import Phaser from 'phaser'
import { audio } from '../core/audio'
import { ACHIEVEMENTS, save } from '../core/save'
import { session } from '../core/session'
import { LEVELS } from '../data/levels'
import { UI } from '../gfx/palette'
import { Button, formatNumber, formatTime, label, panel } from '../ui/widgets'

/** Post-match summary: outcome, score breakdown, stars, and what to do next. */
export default class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ResultScene' })
  }

  create(): void {
    const cam = this.cameras.main
    const result = session.result
    cam.setBackgroundColor(UI.ink)
    cam.fadeIn(360, 0, 0, 0)

    if (!result) {
      this.scene.start('MenuScene')
      return
    }

    const { victory, stats, setup, stars } = result
    const cx = cam.width / 2

    this.add
      .rectangle(0, 0, cam.width, cam.height, victory ? 0x0d2a1a : 0x2a0d10, 1)
      .setOrigin(0, 0)
      .setAlpha(0.45)

    const title = label(this, cx, 54, victory ? 'VICTORY' : 'DEFEAT', {
      size: 76,
      display: true,
      align: 'center',
      color: victory ? UI.good : UI.bad,
      stroke: true
    })
    title.setScale(0.7).setAlpha(0)
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut' })

    const subtitle =
      setup.mode === 'campaign' && setup.level
        ? setup.level.name
        : setup.mode === 'endless'
          ? `Endless Siege — survived ${stats.wavesSurvived} waves`
          : 'Quick Battle'
    label(this, cx, 140, subtitle, { size: 19, align: 'center', color: UI.textDim })

    if (setup.mode === 'campaign' && victory) {
      for (let i = 0; i < 3; i += 1) {
        const star = this.add
          .image(cx - 60 + i * 60, 194, 'ui:star')
          .setScale(0)
          .setTint(i < stars ? UI.gold : 0x2c3850)
        this.tweens.add({
          targets: star,
          scale: 0.9,
          duration: 340,
          delay: 420 + i * 160,
          ease: 'Back.easeOut'
        })
      }
    }

    if (result.newRecord) {
      label(this, cx, 186, 'NEW PERSONAL RECORD', { size: 20, align: 'center', color: UI.gold, bold: true })
    }

    // Score breakdown panel.
    const panelW = 520
    const panelX = cx - panelW - 14
    panel(this, panelX, 236, panelW, 300, 'ui:glass')
    label(this, panelX + 20, 250, 'BATTLE REPORT', { size: 16, bold: true, color: UI.gold })

    const rows: [string, string][] = [
      ['Duration', formatTime(stats.durationMs)],
      ['Units built', `${stats.unitsBuilt}`],
      ['Units lost', `${stats.unitsLost}`],
      ['Enemies destroyed', `${stats.kills}`],
      ['Damage dealt', formatNumber(stats.damageDealt)],
      ['Damage taken', formatNumber(stats.damageTaken)],
      ['Gold earned', formatNumber(stats.goldEarned)],
      ['Abilities used', `${stats.abilitiesUsed}`],
      ['Highest age', `${stats.agesReached}`]
    ]
    rows.forEach(([name, value], i) => {
      const y = 282 + i * 26
      label(this, panelX + 20, y, name, { size: 15, color: UI.textDim })
      label(this, panelX + panelW - 20, y, value, { size: 15, color: UI.text, align: 'right', bold: true })
    })

    // Score panel.
    const scoreX = cx + 14
    panel(this, scoreX, 236, panelW, 300, 'ui:glass')
    label(this, scoreX + 20, 250, 'SCORE', { size: 16, bold: true, color: UI.gold })
    const scoreText = label(this, scoreX + panelW / 2, 288, '0', {
      size: 66,
      display: true,
      align: 'center',
      color: UI.gold
    })
    this.tweens.addCounter({
      from: 0,
      to: stats.score,
      duration: 1100,
      delay: 400,
      ease: 'Cubic.easeOut',
      onUpdate: tween => scoreText.setText(formatNumber(tween.getValue() ?? 0))
    })

    const unlocked = result.unlockedAchievements
      .map(id => ACHIEVEMENTS.find(a => a.id === id)?.name)
      .filter(Boolean) as string[]
    label(this, scoreX + 20, 372, unlocked.length > 0 ? 'ACHIEVEMENTS UNLOCKED' : 'LIFETIME TOTALS', {
      size: 14,
      bold: true,
      color: unlocked.length > 0 ? UI.good : UI.textDim
    })
    if (unlocked.length > 0) {
      label(this, scoreX + 20, 396, unlocked.map(n => `★  ${n}`).join('\n'), {
        size: 16,
        color: UI.good
      })
    } else {
      const life = save.lifetime
      label(
        this,
        scoreX + 20,
        396,
        `${formatNumber(life.kills)} lifetime kills\n${formatNumber(life.goldEarned)} gold earned\n${save.all.matchesWon} victories in ${save.all.matchesPlayed} battles`,
        { size: 16, color: UI.textDim }
      )
    }

    this.buildActions(cx, victory)
    audio.play(victory ? 'victory' : 'defeat', 0.9)
  }

  private buildActions(cx: number, victory: boolean): void {
    const setup = session.setup
    const y = 566
    const buttons: { text: string; sub: string; accent: number; onClick: () => void }[] = []

    const nextLevel =
      setup.mode === 'campaign' && setup.level && victory
        ? LEVELS[LEVELS.findIndex(l => l.id === setup.level?.id) + 1]
        : undefined

    if (nextLevel) {
      buttons.push({
        text: 'NEXT MISSION',
        sub: nextLevel.name,
        accent: UI.good,
        onClick: () => {
          session.start({ mode: 'campaign', level: nextLevel, difficulty: nextLevel.difficulty })
          this.scene.start('BattleScene')
        }
      })
    }

    buttons.push({
      text: 'FIGHT AGAIN',
      sub: 'same setup',
      accent: UI.player,
      onClick: () => {
        session.start(setup)
        this.scene.start('BattleScene')
      }
    })

    buttons.push({
      text: 'MAIN MENU',
      sub: 'choose another battle',
      accent: UI.panelEdge,
      onClick: () => this.scene.start('MenuScene')
    })

    const bw = 260
    const gap = 16
    const totalW = buttons.length * bw + (buttons.length - 1) * gap
    buttons.forEach((entry, i) => {
      new Button(this, cx - totalW / 2 + i * (bw + gap), y, {
        width: bw,
        height: 76,
        text: entry.text,
        subtext: entry.sub,
        fontSize: 21,
        accent: entry.accent,
        onClick: entry.onClick
      })
    })

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'))
  }
}
