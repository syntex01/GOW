import Phaser from 'phaser'
import { audio } from '../core/audio'
import { rng } from '../core/rng'
import { ACHIEVEMENTS, DIFFICULTIES, DIFFICULTY_LABEL, save, type Difficulty } from '../core/save'
import { session } from '../core/session'
import { AGES } from '../data/ages'
import { LEVELS } from '../data/levels'
import { TURRETS } from '../data/turrets'
import { UNITS } from '../data/units'
import Background from '../gfx/background'
import Lighting from '../gfx/lighting'
import { AGE_THEMES, TIER_COLORS, UI } from '../gfx/palette'
import Vfx from '../gfx/vfx'
import Unit from '../sim/unit'
import { Button, formatNumber, formatTime, label, panel } from '../ui/widgets'

type View = 'main' | 'campaign' | 'skirmish' | 'endless' | 'codex' | 'settings' | 'achievements' | 'howto'

const GROUND_Y = 640

/** Main menu, mode selection, codex, settings and achievements. */
export default class MenuScene extends Phaser.Scene {
  private background!: Background
  private lighting!: Lighting
  private vfx!: Vfx
  private parade: Unit[] = []
  private viewContainer!: Phaser.GameObjects.Container
  private view: View = 'main'
  private buttons: Button[] = []
  private paradeAge = 0

  constructor() {
    super({ key: 'MenuScene' })
  }

  create(): void {
    const cam = this.cameras.main
    this.paradeAge = rng.int(0, AGE_THEMES.length - 1)

    this.lighting = new Lighting(this, 300)
    this.lighting.setAge(this.paradeAge)
    this.vfx = new Vfx(this, GROUND_Y, this.lighting)
    this.background = new Background(this, cam.width, GROUND_Y)
    this.background.setAge(this.paradeAge)

    this.viewContainer = this.add.container(0, 0).setDepth(500)
    this.spawnParade()

    this.showView('main')

    audio.setAge(this.paradeAge)
    audio.setIntensity(0.18)
    audio.startMusic(this.paradeAge)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup())

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.view !== 'main') this.showView('main')
    })
  }

  // ─────────────────────────── Decorative parade ───────────────────────────

  private spawnParade(): void {
    const roster = UNITS.filter(u => u.age === this.paradeAge)
    const count = 7
    for (let i = 0; i < count; i += 1) {
      const def = roster[i % roster.length]
      const unit = new Unit(this, def, 'player', -160 + i * 190 + rng.spread(40), {
        groundY: GROUND_Y,
        airY: GROUND_Y - 210,
        vfx: this.vfx,
        speedScale: 1
      })
      this.parade.push(unit)
    }
  }

  override update(_time: number, delta: number): void {
    this.background.update(delta, 0)
    const width = this.cameras.main.width
    for (const unit of this.parade) {
      unit.update(delta, null, null)
      if (unit.x > width + 180) unit.x = -180
    }
    this.lighting.render(0, 0)
  }

  // ──────────────────────────────── Views ────────────────────────────────

  private showView(view: View): void {
    this.view = view
    this.buttons.forEach(b => b.destroy())
    this.buttons = []
    this.viewContainer.removeAll(true)

    switch (view) {
      case 'main':
        this.buildMain()
        break
      case 'campaign':
        this.buildCampaign()
        break
      case 'skirmish':
        this.buildSkirmish()
        break
      case 'endless':
        this.buildEndless()
        break
      case 'codex':
        this.buildCodex()
        break
      case 'settings':
        this.buildSettings()
        break
      case 'achievements':
        this.buildAchievements()
        break
      case 'howto':
        this.buildHowTo()
        break
    }
  }

  private addButton(x: number, y: number, options: ConstructorParameters<typeof Button>[3]): Button {
    const button = new Button(this, x, y, options)
    this.viewContainer.add(button.container)
    this.buttons.push(button)
    return button
  }

  private header(title: string, subtitle?: string): void {
    const cam = this.cameras.main
    const bar = panel(this, 0, 0, cam.width, 96, 'ui:glass')
    this.viewContainer.add(bar)
    this.viewContainer.add(
      label(this, 34, 20, title, { size: 34, display: true, color: UI.text })
    )
    if (subtitle) {
      this.viewContainer.add(label(this, 36, 60, subtitle, { size: 15, color: UI.textDim }))
    }
    this.addButton(cam.width - 150, 24, {
      width: 120,
      height: 48,
      text: 'BACK',
      accent: UI.panelEdge,
      corner: 'Esc',
      onClick: () => this.showView('main')
    })
  }

  private buildMain(): void {
    const cam = this.cameras.main
    const cx = cam.width / 2

    this.viewContainer.add(
      label(this, cx, 68, 'GOW', { size: 108, display: true, align: 'center', color: UI.text, stroke: true })
    )
    this.viewContainer.add(
      label(this, cx, 182, 'GEARS OF WAR THROUGH THE AGES', {
        size: 18,
        align: 'center',
        color: UI.gold,
        bold: true
      })
    )
    this.viewContainer.add(
      label(this, cx, 208, 'Five ages. Thirty-two units. One lane. Destroy their fortress before they destroy yours.', {
        size: 14,
        align: 'center',
        color: UI.textDim
      })
    )

    const entries: { text: string; sub: string; accent: number; view: View | 'multiplayer' }[] = [
      { text: 'CAMPAIGN', sub: '12 missions', accent: UI.gold, view: 'campaign' },
      { text: 'ENDLESS SIEGE', sub: 'survive the waves', accent: UI.bad, view: 'endless' },
      { text: 'QUICK BATTLE', sub: 'one-off skirmish', accent: UI.player, view: 'skirmish' },
      { text: 'MULTIPLAYER', sub: 'peer-to-peer, no server', accent: 0x30d5c8, view: 'multiplayer' },
      { text: 'ARMORY', sub: 'unit codex', accent: UI.accent, view: 'codex' },
      { text: 'ACHIEVEMENTS', sub: `${this.unlockedCount()}/${ACHIEVEMENTS.length}`, accent: UI.good, view: 'achievements' },
      { text: 'HOW TO PLAY', sub: 'controls & rules', accent: UI.xp, view: 'howto' },
      { text: 'SETTINGS', sub: 'audio & graphics', accent: UI.panelEdge, view: 'settings' }
    ]

    const cols = 4
    const bw = 236
    const bh = 92
    const gap = 18
    const totalW = cols * bw + (cols - 1) * gap
    const startX = cx - totalW / 2
    const startY = 268

    entries.forEach((entry, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      this.addButton(startX + col * (bw + gap), startY + row * (bh + gap), {
        width: bw,
        height: bh,
        text: entry.text,
        subtext: entry.sub,
        accent: entry.accent,
        fontSize: entry.text.length > 12 ? 18 : 21,
        onClick: () => {
          if (entry.view === 'multiplayer') this.launchMultiplayer()
          else this.showView(entry.view)
        }
      })
    })

    // Explain why a networked match ended, if one just did.
    if (session.netEndReason) {
      this.viewContainer.add(
        label(this, cx, 460, session.netEndReason, {
          size: 15,
          align: 'center',
          color: UI.warn,
          wrap: 900
        })
      )
    }

    const s = save.all
    const stars = Object.values(save.campaign.stars).reduce((a, b) => a + b, 0)
    this.viewContainer.add(
      label(
        this,
        cx,
        482,
        `${s.matchesWon} victories  •  ${formatNumber(s.lifetime.kills)} kills  •  ${stars}/36 stars  •  ${formatTime(
          s.totalPlaytimeMs
        )} played`,
        { size: 14, align: 'center', color: UI.textDim }
      )
    )
    this.viewContainer.add(
      label(this, cam.width - 16, cam.height - 26, 'v1.0', { size: 12, align: 'right', color: UI.textDim })
    )
  }

  private buildCampaign(): void {
    this.header('CAMPAIGN', 'Twelve missions across five ages of warfare.')
    const cols = 4
    const bw = 288
    const bh = 116
    const gap = 14
    const startX = (this.cameras.main.width - (cols * bw + (cols - 1) * gap)) / 2
    const startY = 122

    LEVELS.forEach((level, index) => {
      const unlocked = index <= save.campaign.unlocked
      const stars = save.campaign.stars[level.id] ?? 0
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = startX + col * (bw + gap)
      const y = startY + row * (bh + gap)

      const button = this.addButton(x, y, {
        width: bw,
        height: bh,
        text: level.name,
        subtext: unlocked ? DIFFICULTY_LABEL[level.difficulty] : 'LOCKED',
        fontSize: 18,
        accent: unlocked ? TIER_COLORS[Math.min(4, level.enemyStartAge)] : UI.panelEdge,
        onClick: () => {
          if (!unlocked) return
          session.start({ mode: 'campaign', level, difficulty: level.difficulty })
          this.launchBattle()
        }
      })
      button.setEnabled(unlocked)

      // Star rating strip.
      for (let s = 0; s < 3; s += 1) {
        const star = this.add
          .image(x + bw - 26 - s * 24, y + 22, 'ui:star')
          .setScale(0.34)
          .setTint(s < stars ? UI.gold : 0x2c3850)
        this.viewContainer.add(star)
      }
      if (unlocked) {
        this.viewContainer.add(
          label(this, x + 12, y + 56, level.briefing, { size: 12, color: UI.textDim, wrap: bw - 24 })
        )
      }
    })
  }

  private buildSkirmish(): void {
    this.header('QUICK BATTLE', 'Pick a difficulty and fight a single unrestricted battle.')
    const cam = this.cameras.main
    const cx = cam.width / 2
    let chosen: Difficulty = save.settings.difficulty
    const diffButtons: Button[] = []

    const refresh = () => {
      diffButtons.forEach((b, i) => b.setAccent(DIFFICULTIES[i] === chosen ? UI.gold : UI.panelEdge))
    }

    DIFFICULTIES.forEach((difficulty, i) => {
      const b = this.addButton(cx - 2 * 150 - 12 + i * 156, 190, {
        width: 144,
        height: 84,
        text: DIFFICULTY_LABEL[difficulty].toUpperCase(),
        subtext: DIFFICULTY_BLURB[difficulty],
        fontSize: 18,
        accent: UI.panelEdge,
        onClick: () => {
          chosen = difficulty
          save.updateSettings({ difficulty })
          refresh()
        }
      })
      diffButtons.push(b)
    })
    refresh()

    this.viewContainer.add(
      label(this, cx, 306, 'Both commanders start in the Stone Age with an even purse.', {
        size: 15,
        align: 'center',
        color: UI.textDim
      })
    )

    this.addButton(cx - 140, 360, {
      width: 280,
      height: 78,
      text: 'DEPLOY',
      subtext: 'begin the battle',
      fontSize: 26,
      accent: UI.good,
      onClick: () => {
        session.start({ mode: 'skirmish', difficulty: chosen })
        this.launchBattle()
      }
    })
  }

  private buildEndless(): void {
    this.header('ENDLESS SIEGE', 'The enemy never stops coming. How long can the fortress hold?')
    const cam = this.cameras.main
    const cx = cam.width / 2
    let chosen: Difficulty = save.settings.difficulty
    const diffButtons: Button[] = []

    const refresh = () => {
      diffButtons.forEach((b, i) => b.setAccent(DIFFICULTIES[i] === chosen ? UI.bad : UI.panelEdge))
    }

    DIFFICULTIES.forEach((difficulty, i) => {
      const best = save.all.endlessBest[difficulty] ?? 0
      const b = this.addButton(cx - 2 * 150 - 12 + i * 156, 190, {
        width: 144,
        height: 84,
        text: DIFFICULTY_LABEL[difficulty].toUpperCase(),
        subtext: best > 0 ? `best: wave ${best}` : 'no record',
        fontSize: 18,
        accent: UI.panelEdge,
        onClick: () => {
          chosen = difficulty
          save.updateSettings({ difficulty })
          refresh()
        }
      })
      diffButtons.push(b)
    })
    refresh()

    this.viewContainer.add(
      label(
        this,
        cx,
        306,
        'Every 45 seconds the enemy grows stronger. Break through their fortress to skip three waves ahead.',
        { size: 15, align: 'center', color: UI.textDim, wrap: 760 }
      )
    )

    this.addButton(cx - 140, 372, {
      width: 280,
      height: 78,
      text: 'HOLD THE LINE',
      subtext: 'begin the siege',
      fontSize: 24,
      accent: UI.bad,
      onClick: () => {
        session.start({ mode: 'endless', difficulty: chosen })
        this.launchBattle()
      }
    })
  }

  private buildCodex(): void {
    this.header('ARMORY', 'Every unit and defence in the game, with their exact numbers.')
    const cam = this.cameras.main
    let age = 0
    const ageButtons: Button[] = []
    let listContainer = this.add.container(0, 0)
    this.viewContainer.add(listContainer)

    const renderList = () => {
      listContainer.removeAll(true)
      const units = UNITS.filter(u => u.age === age)
      const turrets = TURRETS.filter(t => t.age === age)
      const cols = 4
      const cw = 296
      const ch = 128
      const startX = (cam.width - (cols * cw + (cols - 1) * 12)) / 2

      units.forEach((def, i) => {
        const x = startX + (i % cols) * (cw + 12)
        const y = 244 + Math.floor(i / cols) * (ch + 10)
        const card = panel(this, x, y, cw, ch, 'ui:glass')
        const icon = this.add.image(x + 46, y + ch / 2, `icon:${def.id}`).setScale(0.82)
        const name = label(this, x + 94, y + 12, def.name, { size: 17, bold: true })
        const role = label(this, x + 94, y + 34, `${def.role.toUpperCase()} • ${def.armor}`, {
          size: 11,
          color: UI.textDim
        })
        const dps = (def.damage / (def.attackMs / 1000)).toFixed(0)
        const stats = label(
          this,
          x + 94,
          y + 52,
          `HP ${def.hp}   DMG ${def.damage} ${def.damageType}\nDPS ~${dps}   RNG ${def.range}\nCOST ${def.cost}   POP ${def.pop}`,
          { size: 12, color: UI.text }
        )
        listContainer.add([card, icon, name, role, stats])
      })

      const turretY = 244 + Math.ceil(units.length / cols) * (ch + 10) + 6
      turrets.forEach((def, i) => {
        const x = startX + i * (cw + 12)
        const tCard = panel(this, x, turretY, cw, 74, 'ui:glass')
        const tIcon = this.add.image(x + 40, turretY + 40, `turret:${def.id}:base`).setScale(0.5)
        const tName = label(this, x + 78, turretY + 8, def.name, { size: 16, bold: true, color: UI.warn })
        const tStats = label(
          this,
          x + 78,
          turretY + 30,
          `DMG ${def.damage}  RNG ${def.range}  ${def.hitsAir ? 'AA' : 'ground only'}\nCOST ${def.cost}`,
          { size: 12, color: UI.textDim }
        )
        listContainer.add([tCard, tIcon, tName, tStats])
      })
    }

    AGES.forEach((ageDefinition, i) => {
      const b = this.addButton(60 + i * 232, 122, {
        width: 220,
        height: 78,
        text: ageDefinition.name.toUpperCase(),
        subtext: AGE_THEMES[i].tagline,
        fontSize: 17,
        accent: UI.panelEdge,
        onClick: () => {
          age = i
          ageButtons.forEach((btn, j) => btn.setAccent(j === i ? TIER_COLORS[i] : UI.panelEdge))
          renderList()
        }
      })
      ageButtons.push(b)
    })
    ageButtons[0].setAccent(TIER_COLORS[0])
    renderList()
  }

  private buildSettings(): void {
    this.header('SETTINGS', 'Tune the presentation to your machine and taste.')
    const cam = this.cameras.main
    const left = cam.width / 2 - 320

    this.slider(left, 150, 'Music volume', save.settings.musicVolume, value => {
      save.updateSettings({ musicVolume: value })
      audio.applyVolumes()
    })
    this.slider(left, 218, 'Effects volume', save.settings.sfxVolume, value => {
      save.updateSettings({ sfxVolume: value })
      audio.applyVolumes()
      audio.play('ui_click', 0.6)
    })

    const toggles: { key: keyof typeof save.settings; text: string; hint: string }[] = [
      { key: 'screenShake', text: 'Screen shake', hint: 'Camera kick on heavy impacts' },
      { key: 'showDamageNumbers', text: 'Damage numbers', hint: 'Floating combat text' },
      { key: 'bloodEffects', text: 'Blood effects', hint: 'Gore particles and ground stains' }
    ]

    toggles.forEach((toggle, i) => {
      const y = 294 + i * 66
      const b = this.addButton(left, y, {
        width: 300,
        height: 54,
        text: toggle.text,
        subtext: toggle.hint,
        fontSize: 17,
        accent: save.settings[toggle.key] ? UI.good : UI.panelEdge,
        onClick: () => {
          const next = !save.settings[toggle.key]
          save.updateSettings({ [toggle.key]: next } as never)
          b.setAccent(next ? UI.good : UI.panelEdge)
          b.setText(`${toggle.text}: ${next ? 'ON' : 'OFF'}`)
        }
      })
      b.setText(`${toggle.text}: ${save.settings[toggle.key] ? 'ON' : 'OFF'}`)
    })

    const qualities: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high']
    const qualityButtons: Button[] = []
    this.viewContainer.add(label(this, left + 340, 294, 'Particle quality', { size: 15, color: UI.textDim }))
    qualities.forEach((q, i) => {
      const b = this.addButton(left + 340 + i * 106, 318, {
        width: 100,
        height: 54,
        text: q.toUpperCase(),
        fontSize: 16,
        accent: save.settings.particleQuality === q ? UI.gold : UI.panelEdge,
        onClick: () => {
          save.updateSettings({ particleQuality: q })
          qualityButtons.forEach((btn, j) => btn.setAccent(qualities[j] === q ? UI.gold : UI.panelEdge))
        }
      })
      qualityButtons.push(b)
    })

    this.addButton(left + 340, 426, {
      width: 300,
      height: 54,
      text: 'RESET ALL PROGRESS',
      subtext: 'campaign, records and achievements',
      fontSize: 16,
      accent: UI.bad,
      onClick: () => {
        save.reset()
        this.showView('settings')
      }
    })
  }

  private slider(x: number, y: number, name: string, value: number, onChange: (v: number) => void): void {
    const width = 300
    this.viewContainer.add(label(this, x, y, name, { size: 15, color: UI.textDim }))
    const valueText = label(this, x + width, y, `${Math.round(value * 100)}%`, {
      size: 15,
      color: UI.gold,
      align: 'right'
    })
    this.viewContainer.add(valueText)

    const track = this.add.nineslice(x, y + 26, 'ui:bar', undefined, width, 12, 6, 6, 6, 6).setOrigin(0, 0)
    track.setTint(0x1b2436)
    const fill = this.add
      .nineslice(x, y + 26, 'ui:bar', undefined, Math.max(12, width * value), 12, 6, 6, 6, 6)
      .setOrigin(0, 0)
    fill.setTint(UI.gold)
    const knob = this.add.circle(x + width * value, y + 32, 11, UI.text).setStrokeStyle(2, UI.panelEdge)
    this.viewContainer.add([track, fill, knob])

    const hit = this.add
      .rectangle(x, y + 20, width, 26, 0xffffff, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true, draggable: true })
    this.viewContainer.add(hit)

    const apply = (pointerX: number) => {
      const v = Phaser.Math.Clamp((pointerX - x) / width, 0, 1)
      fill.width = Math.max(12, width * v)
      knob.setX(x + width * v)
      valueText.setText(`${Math.round(v * 100)}%`)
      onChange(v)
    }
    hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (p: Phaser.Input.Pointer) => apply(p.x))
    hit.on(Phaser.Input.Events.GAMEOBJECT_DRAG, (p: Phaser.Input.Pointer) => apply(p.x))
  }

  private buildAchievements(): void {
    this.header('ACHIEVEMENTS', `${this.unlockedCount()} of ${ACHIEVEMENTS.length} unlocked.`)
    const cam = this.cameras.main
    const cols = 3
    const cw = 384
    const ch = 92
    const startX = (cam.width - (cols * cw + (cols - 1) * 14)) / 2

    ACHIEVEMENTS.forEach((achievement, i) => {
      const progress = save.achievementProgress(achievement.id)
      const done = progress >= achievement.target
      const x = startX + (i % cols) * (cw + 14)
      const y = 124 + Math.floor(i / cols) * (ch + 12)
      const card = panel(this, x, y, cw, ch, 'ui:glass')
      const star = this.add
        .image(x + 40, y + ch / 2, 'ui:star')
        .setScale(0.55)
        .setTint(done ? UI.gold : 0x2c3850)
      const name = label(this, x + 76, y + 12, achievement.name, {
        size: 17,
        bold: true,
        color: done ? UI.gold : UI.text
      })
      const desc = label(this, x + 76, y + 34, achievement.description, {
        size: 12,
        color: UI.textDim,
        wrap: cw - 96
      })
      const ratio = Math.min(1, progress / achievement.target)
      const barBg = this.add.nineslice(x + 76, y + ch - 20, 'ui:bar', undefined, cw - 100, 8, 4, 4, 4, 4).setOrigin(0, 0)
      barBg.setTint(0x1b2436)
      const barFill = this.add
        .nineslice(x + 76, y + ch - 20, 'ui:bar', undefined, Math.max(8, (cw - 100) * ratio), 8, 4, 4, 4, 4)
        .setOrigin(0, 0)
      barFill.setTint(done ? UI.good : UI.player)
      const count = label(this, x + cw - 12, y + 10, `${Math.min(progress, achievement.target)}/${achievement.target}`, {
        size: 12,
        color: UI.textDim,
        align: 'right'
      })
      this.viewContainer.add([card, star, name, desc, barBg, barFill, count])
    })
  }

  private buildHowTo(): void {
    this.header('HOW TO PLAY', 'The whole game in one screen.')
    const cam = this.cameras.main
    const colW = (cam.width - 140) / 2

    const left = [
      ['The loop', ''],
      ['', 'Gold arrives every second and from kills. Spend it on units, which march out and fight on their own.'],
      ['', 'Kills also earn experience. Fill the EVOLUTION bar and press E to advance an age: a new roster, more income, a tougher fortress and a stronger special ability.'],
      ['', 'Destroy the enemy fortress to win.'],
      ['Counters', ''],
      ['', 'Pierce shreds unarmoured troops but glances off heavy armour. Blunt does the opposite. Explosive is what breaks fortresses. Energy is even against everything.'],
      ['', 'Air units can only be hit by anti-air. Field a gunship against someone with none and the game is over.']
    ]

    const right = [
      ['Controls', ''],
      ['', '1 – 7        Train the matching unit'],
      ['', 'E             Evolve to the next age'],
      ['', 'Q / Space  Fire the special ability'],
      ['', 'U             Buy the next economy upgrade'],
      ['', 'F             Cycle game speed (single-player)'],
      ['', 'Backspace  Cancel the last queued unit'],
      ['', 'Esc / P      Pause'],
      ['', 'Drag         Pan the camera'],
      ['Defences', ''],
      ['', 'Three turret slots sit on your fortress. Click one to build, click an existing turret to sell it. Turrets take splash damage when the wall is hit.']
    ]

    const render = (rows: string[][], x: number) => {
      let y = 130
      for (const [heading, body] of rows) {
        if (heading) {
          this.viewContainer.add(label(this, x, y, heading.toUpperCase(), { size: 15, bold: true, color: UI.gold }))
          y += 26
        }
        if (body) {
          const text = label(this, x, y, body, { size: 14, color: UI.text, wrap: colW })
          this.viewContainer.add(text)
          y += text.height + 12
        }
      }
    }

    render(left, 60)
    render(right, 80 + colW)
  }

  private launchMultiplayer(): void {
    audio.stopMusic()
    this.cameras.main.fadeOut(220, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('MultiplayerScene')
    })
  }

  private unlockedCount(): number {
    return ACHIEVEMENTS.filter(a => save.achievementProgress(a.id) >= a.target).length
  }

  private launchBattle(): void {
    audio.stopMusic()
    this.cameras.main.fadeOut(280, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('BattleScene')
    })
  }

  private cleanup(): void {
    this.parade.forEach(u => u.destroy())
    this.parade = []
    this.buttons.forEach(b => b.destroy())
    this.background.destroy()
    this.lighting.destroy()
    this.vfx.destroy()
  }
}

const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  recruit: 'forgiving',
  veteran: 'a fair fight',
  warlord: 'they play well',
  nightmare: 'no mercy'
}
