import Phaser from 'phaser'
import { audio } from '../core/audio'
import { gameEvents } from '../core/events'
import { ACHIEVEMENTS, save } from '../core/save'
import { session } from '../core/session'
import { ageDef } from '../data/ages'
import { ENDLESS_WAVE_SECONDS, LEVELS, computeStars } from '../data/levels'
import Background from '../gfx/background'
import { AGE_THEMES } from '../gfx/palette'
import Vfx from '../gfx/vfx'
import AiController, { AI_PROFILES } from '../sim/ai'
import Battlefield from '../sim/battlefield'
import type { Faction } from '../sim/types'

export const WORLD_WIDTH = 1380
export const GROUND_Y = 545
export const AIR_Y = 240
/** Slight zoom so soldiers read clearly without shrinking the battlefield. */
const CAMERA_ZOOM = 1.0
/** Vertical scroll that puts the ground line just above the command bar. */
const CAMERA_SCROLL_Y = 0

/** The playable battle: world, simulation, camera work and mode rules. */
export default class BattleScene extends Phaser.Scene {
  battlefield!: Battlefield
  paused = false
  speedIndex = 0
  wave = 1

  private background!: Background
  private vfx!: Vfx
  private ai!: AiController
  private waveTimer = 0
  private cameraFocus = 0
  private dragStartX = 0
  private dragCameraX = 0
  private dragging = false
  private manualCameraUntil = 0
  private ended = false

  private readonly speeds = [1, 2, 3]

  constructor() {
    super({ key: 'BattleScene' })
  }

  create(): void {
    this.resetSceneState()
    const cam = this.cameras.main
    cam.fadeIn(320, 0, 0, 0)
    cam.setBounds(0, 0, WORLD_WIDTH, cam.height)
    cam.setZoom(CAMERA_ZOOM)

    this.vfx = new Vfx(this, GROUND_Y)
    this.background = new Background(this, WORLD_WIDTH, GROUND_Y)

    const setup = session.setup
    const level = setup.level
    const profile = { ...AI_PROFILES[setup.difficulty] }

    this.battlefield = new Battlefield(
      this,
      {
        worldWidth: WORLD_WIDTH,
        groundY: GROUND_Y,
        airY: AIR_Y,
        startingGold: level?.startingGold ?? (setup.mode === 'endless' ? 1600 : 900),
        enemyStartAge: level?.enemyStartAge ?? 0,
        playerModifiers: level?.playerModifiers,
        enemyModifiers: {
          income: profile.incomeMultiplier,
          unitHp: profile.unitHpMultiplier,
          unitDamage: profile.unitDamageMultiplier,
          ...(level?.enemyModifiers ?? {})
        }
      },
      this.vfx
    )

    if (level?.playerStartAge) {
      for (let i = 0; i < level.playerStartAge; i += 1) {
        this.battlefield.player.xp = this.battlefield.player.xpToAdvance
        this.battlefield.player.gold += this.battlefield.player.evolveCost
        this.battlefield.evolve('player')
      }
    }

    this.ai = new AiController(this.battlefield, profile)
    this.background.setAge(this.battlefield.player.age)

    this.battlefield.onMatchEnd = victory => this.finish(victory)
    this.battlefield.onAgeAdvanced = (faction, age) => this.handleAgeAdvanced(faction, age)
    this.battlefield.onAbilityUsed = (faction, abilityId) => {
      if (faction === 'player') {
        const color = AGE_THEMES[this.battlefield.player.age].fog
        this.background.flashSky(color, 0.35)
      }
      gameEvents.emit('ability:used', { faction, abilityId })
    }
    this.battlefield.onUnitKilled = faction => {
      if (faction === 'player') this.checkKillAchievements()
    }

    if (session.setup.mode === 'endless') this.configureEndless()

    this.setupInput()
    this.scene.launch('HUDScene')
    this.scene.bringToTop('HUDScene')

    audio.setAge(this.battlefield.player.age)
    audio.startMusic(this.battlefield.player.age)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup())
  }

  /**
   * Phaser reuses a scene instance across `restart()`, so class field
   * initialisers only ever run once. Every mutable field has to be reset by
   * hand or a restarted battle inherits the previous match's paused flag,
   * wave counter and camera state.
   */
  private resetSceneState(): void {
    this.paused = false
    this.ended = false
    this.speedIndex = 0
    this.wave = 1
    this.waveTimer = 0
    this.cameraFocus = 0
    this.dragging = false
    this.dragStartX = 0
    this.dragCameraX = 0
    this.manualCameraUntil = 0
  }

  // ─────────────────────────────── Modes ───────────────────────────────

  private configureEndless(): void {
    const bf = this.battlefield
    bf.enemyBase.maxHp *= 2.2
    bf.enemyBase.hp = bf.enemyBase.maxHp
    // Breaking through does not win the siege — it buys three waves of relief.
    bf.enemyBase.onDestroyed = () => {
      bf.enemyBase.alive = true
      bf.enemyBase.hp = bf.enemyBase.maxHp
      this.vfx.flash(0xffffff, 400, 0.5)
      this.vfx.floatingLabel(bf.enemyBase.x, GROUND_Y - 260, 'BREAKTHROUGH! +3 WAVES', '#4ade80')
      audio.play('victory', 0.8)
      for (let i = 0; i < 3; i += 1) this.advanceWave()
      bf.player.gold += 2500 * this.wave * 0.2
    }
  }

  private advanceWave(): void {
    this.wave += 1
    const bf = this.battlefield
    bf.registerWave(this.wave)
    this.ai.escalate(this.wave)

    const mods = bf.enemy.modifiers
    mods.income *= 1.1
    mods.unitHp *= 1.055
    mods.unitDamage *= 1.05
    bf.enemy.gold += 400 + this.wave * 120

    // Push the enemy up an age roughly every four waves.
    if (this.wave % 4 === 0 && bf.enemy.age < 4) {
      bf.enemy.xp = bf.enemy.xpToAdvance
      bf.enemy.gold += bf.enemy.evolveCost
      bf.evolve('enemy')
    }

    if (this.wave >= 20) this.unlockAchievement('survivor')
    gameEvents.emit('hud:flash', { message: `WAVE ${this.wave}`, tone: 'warn' })
  }

  private handleAgeAdvanced(faction: Faction, age: number): void {
    if (faction === 'player') {
      this.background.setAge(age)
      audio.setAge(age)
      gameEvents.emit('hud:flash', { message: `${ageDef(age).name.toUpperCase()} REACHED`, tone: 'good' })
      if (age >= 4) this.unlockAchievement('evolved')
    }
    gameEvents.emit('age:advanced', { faction, age })
  }

  // ─────────────────────────────── Input ───────────────────────────────

  private setupInput(): void {
    const keyboard = this.input.keyboard
    if (!keyboard) return

    keyboard.on('keydown-ESC', () => this.togglePause())
    keyboard.on('keydown-P', () => this.togglePause())
    keyboard.on('keydown-F', () => this.cycleSpeed())
    keyboard.on('keydown-E', () => this.tryEvolve())
    keyboard.on('keydown-Q', () => this.tryAbility())
    keyboard.on('keydown-SPACE', () => this.tryAbility())
    keyboard.on('keydown-U', () => this.tryEconomy())
    keyboard.on('keydown-BACKSPACE', () => {
      const refund = this.battlefield.player.cancelLast()
      if (refund > 0) audio.play('coin', 0.4)
    })

    for (let i = 1; i <= 7; i += 1) {
      keyboard.on(`keydown-${DIGIT_KEYS[i - 1]}`, () => this.queueByIndex(i - 1))
    }

    // Drag to pan; releases back to auto-follow after a moment.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > this.cameras.main.height - 120) return
      this.dragging = true
      this.dragStartX = pointer.x
      this.dragCameraX = this.cameras.main.scrollX
    })
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.dragging = false
    })
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging || !pointer.isDown) return
      const dx = (this.dragStartX - pointer.x) / CAMERA_ZOOM
      if (Math.abs(dx) > 4) {
        this.cameras.main.setScroll(this.dragCameraX + dx, CAMERA_SCROLL_Y)
        this.manualCameraUntil = this.time.now + 2600
      }
    })
  }

  queueByIndex(index: number): void {
    const roster = this.battlefield.player.roster
    const def = roster[index]
    if (!def) return
    const reason = this.battlefield.player.blockReason(def)
    if (reason) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: reason, tone: 'warn' })
      return
    }
    this.battlefield.queueUnit('player', def.id)
    audio.play('ui_click', 0.4)
  }

  tryEvolve(): boolean {
    const army = this.battlefield.player
    if (army.age >= 4) {
      gameEvents.emit('hud:flash', { message: 'Already at the final age', tone: 'info' })
      return false
    }
    if (army.xp < army.xpToAdvance) {
      gameEvents.emit('hud:flash', { message: 'Not enough experience to evolve', tone: 'warn' })
      audio.play('ui_denied', 0.5)
      return false
    }
    if (army.gold < army.evolveCost) {
      gameEvents.emit('hud:flash', { message: `Evolution costs ${army.evolveCost} gold`, tone: 'warn' })
      audio.play('ui_denied', 0.5)
      return false
    }
    return this.battlefield.evolve('player')
  }

  tryAbility(): boolean {
    if (!this.battlefield.player.abilityReady) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: 'Special ability is still charging', tone: 'warn' })
      return false
    }
    const used = this.battlefield.useAbility('player')
    if (used) {
      this.checkAbilityAchievement()
      this.manualCameraUntil = 0
    }
    return used
  }

  tryEconomy(): boolean {
    const army = this.battlefield.player
    const cost = army.incomeUpgradeCost()
    if (cost === null) {
      gameEvents.emit('hud:flash', { message: 'Economy fully upgraded', tone: 'info' })
      return false
    }
    if (!army.buyIncomeUpgrade()) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `Economy upgrade costs ${cost} gold`, tone: 'warn' })
      return false
    }
    this.battlefield.stats.goldSpent += cost
    audio.play('coin', 0.6)
    gameEvents.emit('hud:flash', { message: 'Income increased', tone: 'good' })
    return true
  }

  cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % this.speeds.length
    this.battlefield.speedScale = this.speeds[this.speedIndex]
    audio.play('ui_click', 0.4)
  }

  get speed(): number {
    return this.speeds[this.speedIndex]
  }

  togglePause(): void {
    if (this.ended) return
    this.paused = !this.paused
    gameEvents.emit('match:paused', { paused: this.paused })
    audio.play('ui_click', 0.5)
  }

  quitToMenu(): void {
    // Guard against a second call once the scene has already handed off.
    if (!this.scene.isActive()) return
    this.ended = true
    audio.stopMusic()
    this.scene.stop('HUDScene')
    this.scene.start('MenuScene')
  }

  // ─────────────────────────────── Loop ───────────────────────────────

  override update(_time: number, delta: number): void {
    this.background.update(delta, this.cameras.main.scrollX)
    if (this.paused || this.ended) return

    this.battlefield.update(delta)
    this.ai.update(delta * this.battlefield.speedScale)
    this.updateCamera(delta)
    this.updateMusicIntensity()

    if (session.setup.mode === 'endless') {
      this.waveTimer += delta * this.battlefield.speedScale
      if (this.waveTimer >= ENDLESS_WAVE_SECONDS * 1000) {
        this.waveTimer = 0
        this.advanceWave()
      }
    }
  }

  /** Keeps the front line framed without fighting the player's own panning. */
  private updateCamera(delta: number): void {
    const cam = this.cameras.main
    if (this.time.now < this.manualCameraUntil) return

    const bf = this.battlefield
    let playerFront = bf.playerBase.x
    let enemyFront = bf.enemyBase.x
    for (const u of bf.units) {
      if (!u.alive) continue
      if (u.faction === 'player') playerFront = Math.max(playerFront, u.x)
      else enemyFront = Math.min(enemyFront, u.x)
    }

    // Focus on the contact point, biased slightly toward the player's side.
    const contact = (playerFront + enemyFront) / 2
    const halfView = cam.width / (2 * CAMERA_ZOOM)
    const target = Phaser.Math.Clamp(contact - 30, halfView, WORLD_WIDTH - halfView)
    this.cameraFocus = Phaser.Math.Linear(this.cameraFocus || target, target, Math.min(1, delta / 420))
    cam.setScroll(this.cameraFocus - cam.width / 2, CAMERA_SCROLL_Y)
  }

  private updateMusicIntensity(): void {
    const bf = this.battlefield
    const unitPressure = Math.min(1, bf.units.length / 22)
    const healthPressure = 1 - bf.playerBase.hp / bf.playerBase.maxHp
    audio.setIntensity(Math.max(unitPressure * 0.7, healthPressure))
  }

  // ─────────────────────────── Results & unlocks ───────────────────────────

  private finish(victory: boolean): void {
    if (this.ended) return
    this.ended = true
    const bf = this.battlefield
    const setup = session.setup
    const stats = { ...bf.stats }
    stats.wavesSurvived = this.wave

    const healthRatio = bf.playerBase.hp / bf.playerBase.maxHp
    const seconds = bf.elapsedMs / 1000
    let stars = 0
    let newRecord = false

    if (setup.mode === 'campaign' && setup.level && victory) {
      stars = computeStars(setup.level, healthRatio, seconds)
      const index = Math.max(0, indexOfLevel(setup.level.id))
      save.recordCampaignResult(setup.level.id, index, stars)
    }
    if (setup.mode === 'endless') {
      newRecord = save.recordEndless(setup.difficulty, this.wave)
    }

    save.recordMatch(stats, victory)
    const unlocked = this.evaluateAchievements(victory, healthRatio, stats.kills)

    session.result = { victory, stats, setup, stars, newRecord, unlockedAchievements: unlocked }
    gameEvents.emit('match:ended', { victory, stats })

    audio.stopMusic()
    this.time.delayedCall(600, () => {
      this.scene.stop('HUDScene')
      this.scene.start('ResultScene')
    })
  }

  private evaluateAchievements(victory: boolean, healthRatio: number, kills: number): string[] {
    const unlocked: string[] = []
    const setup = session.setup

    if (kills > 0 && save.bumpAchievement('first_blood', kills, 1)) unlocked.push('first_blood')
    if (save.bumpAchievement('centurion', kills, 100)) unlocked.push('centurion')
    if (save.bumpAchievement('legion', kills, 1000)) unlocked.push('legion')
    if (save.bumpAchievement('tycoon', this.battlefield.stats.goldEarned, 100000)) unlocked.push('tycoon')

    if (victory) {
      if (healthRatio >= 0.999 && save.bumpAchievement('flawless', 1, 1)) unlocked.push('flawless')
      if (setup.difficulty === 'warlord' && save.bumpAchievement('warlord', 1, 1)) unlocked.push('warlord')
      if (setup.difficulty === 'nightmare' && save.bumpAchievement('nightmare', 1, 1)) unlocked.push('nightmare')
      if (setup.mode === 'campaign') {
        const beaten = Object.keys(save.campaign.stars).length
        const totalStars = Object.values(save.campaign.stars).reduce((a, b) => a + b, 0)
        if (beaten >= 12 && save.achievementProgress('campaigner') < 12) {
          save.bumpAchievement('campaigner', 12, 12)
          unlocked.push('campaigner')
        }
        if (totalStars >= 36 && save.achievementProgress('perfectionist') < 36) {
          save.bumpAchievement('perfectionist', 36, 36)
          unlocked.push('perfectionist')
        }
      }
    }
    if (session.setup.mode === 'endless' && this.wave >= 20 && save.achievementProgress('survivor') < 20) {
      save.bumpAchievement('survivor', 20, 20)
      unlocked.push('survivor')
    }
    return unlocked
  }

  private checkKillAchievements(): void {
    // Cheap incremental check so the toast appears mid-battle, not only at the end.
    const kills = this.battlefield.stats.kills
    if (kills === 1) this.unlockAchievement('first_blood')
  }

  private checkAbilityAchievement(): void {
    if (save.bumpAchievement('demolition', 1, 25)) this.unlockAchievement('demolition')
  }

  private unlockAchievement(id: string): void {
    const achievement = ACHIEVEMENTS.find(a => a.id === id)
    if (!achievement) return
    if (save.achievementProgress(id) < achievement.target) {
      save.bumpAchievement(id, achievement.target, achievement.target)
    }
    gameEvents.emit('hud:flash', { message: `Achievement: ${achievement.name}`, tone: 'good' })
  }

  private cleanup(): void {
    this.battlefield.destroy()
    this.background.destroy()
    this.vfx.destroy()
  }
}

const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN']

function indexOfLevel(id: string): number {
  return LEVELS.findIndex(l => l.id === id)
}
