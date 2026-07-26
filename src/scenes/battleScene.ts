import Phaser from 'phaser'
import { audio } from '../core/audio'
import { gameEvents } from '../core/events'
import { ACHIEVEMENTS, save } from '../core/save'
import { session } from '../core/session'
import { ageDef } from '../data/ages'
import { FACTIONS_BY_ID } from '../data/factions'
import { TECHS_BY_ID, type TechId } from '../data/tech'
import { ENDLESS_WAVE_SECONDS, LEVELS, computeStars } from '../data/levels'
import Environment from '../gfx/environment'
import DebrisLayer from '../gfx/debrisLayer'
import Splatter from '../gfx/splatter'
import Lighting from '../gfx/lighting'
import { AGE_THEMES } from '../gfx/palette'
import Vfx from '../gfx/vfx'
import LockstepDriver, { applyCommand } from '../net/lockstep'
import type { PeerState } from '../net/peer'
import { TICK_SUBSTEPS, type Command, type NetMessage } from '../net/protocol'
import AiController, { AI_PROFILES } from '../sim/ai'
import type Army from '../sim/army'
import type Base from '../sim/base'
import Battlefield from '../sim/battlefield'
import { OPPOSITE, type Faction } from '../sim/types'

export const WORLD_WIDTH = 1920
export const GROUND_Y = 520
export const AIR_Y = 240
/** Slight zoom so soldiers read clearly without shrinking the battlefield. */
const CAMERA_ZOOM = 1.0
/** Vertical scroll that puts the ground line just above the command bar. */
const CAMERA_SCROLL_Y = 0

/** The playable battle: world, simulation, camera work and mode rules. */
export default class BattleScene extends Phaser.Scene {
  battlefield!: Battlefield
  paused = false
  /** True while a full-screen panel owns the keyboard. */
  modalOpen = false
  speedIndex = 0
  wave = 1
  /** The lane the next built unit will walk — the whole of placement. */
  localLane = 2

  private background!: Environment
  private debris!: DebrisLayer
  private splatter!: Splatter
  private lighting!: Lighting
  private vfx!: Vfx
  /** Absent in peer-to-peer matches, where both sides are human. */
  ai?: AiController
  private waveTimer = 0
  private cameraFocus = 0
  private dragStartX = 0
  private dragCameraX = 0
  private dragging = false
  private manualCameraUntil = 0
  private ended = false
  /** A disconnect has been seen and is waiting out its grace window. */
  private leaving = false
  private matchSeed = 0

  /**
   * Which side this client commands. Always 'player' offline; the guest in a
   * networked match commands 'enemy' in the shared world.
   */
  localFaction: Faction = 'player'
  /** Present only in peer-to-peer matches. */
  lockstep?: LockstepDriver

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

    this.lighting = new Lighting(this, 700, GROUND_Y - 138)
    this.vfx = new Vfx(this, GROUND_Y, this.lighting)
    this.background = new Environment(this, WORLD_WIDTH, GROUND_Y)
    // The mess sits above the ground and below the fighting.
    this.splatter = new Splatter(this, WORLD_WIDTH, GROUND_Y, 70)
    this.debris = new DebrisLayer(this, 100)

    const setup = session.setup
    const level = setup.level
    const profile = { ...(AI_PROFILES[setup.difficulty] ?? AI_PROFILES.veteran) }
    // One seed drives combat rolls, the AI and spawn jitter, so a match is
    // fully reproducible — and identical on both machines when networked.
    this.matchSeed = setup.seed ?? (Date.now() >>> 0)

    this.battlefield = new Battlefield(
      this,
      {
        worldWidth: WORLD_WIDTH,
        groundY: GROUND_Y,
        airY: AIR_Y,
        startingGold: level?.startingGold ?? (setup.mode === 'endless' ? 1600 : 900),
        enemyStartAge: level?.enemyStartAge ?? 0,
        seed: this.matchSeed,
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

    // A networked match has two humans; nobody is driving the AI.
    if (!setup.netRole) {
      this.ai = new AiController(this.battlefield, profile, (this.matchSeed ^ 0x9e3779b9) >>> 0)
    }
    this.background.setAge(this.battlefield.player.age)
    this.lighting.setAge(this.battlefield.player.age)

    // The simulation decides where everything lands; the scene paints it.
    this.battlefield.onStain = (body, x, y, speed, onWall) => {
      const kind =
        body.kind === 'gib' || body.kind === 'blood'
          ? 'blood'
          : body.kind === 'scrap' || body.kind === 'shrapnel'
            ? 'oil'
            : 'dust'
      const scale = body.kind === 'blood' ? 0.5 + body.size * 0.5 : 0.9 + body.size * 0.6
      this.splatter.stamp(
        x,
        y,
        kind,
        onWall ? scale * 0.55 : scale,
        speed,
        onWall ? Math.PI / 2 : 0,
        onWall ? 0.7 : 1
      )
    }

    this.battlefield.onCorpse = unit => {
      const machine = unit.def.visual.kind !== 'humanoid' && unit.def.visual.kind !== 'rider'
      // A heap of Nekrotic dead should not look like a heap of Cinder Host
      // dead. Once a side has committed to a creed, the ground it loses men on
      // takes that creed's colour, so a long match leaves a record of which
      // direction each commander went.
      const creed = this.battlefield.armyFor(unit.faction).ascendedTo
      const dye = creed ? FACTIONS_BY_ID[creed].accent : null
      this.debris.addCorpse(
        unit.x,
        GROUND_Y + unit.stageY,
        unit.faction === 'player' ? 1 : -1,
        unit.def.height,
        machine,
        dye ?? (machine ? unit.def.visual.metal : unit.def.visual.cloth),
        unit.id
      )
    }

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

    this.setupNetworking()
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
    this.leaving = false
    this.speedIndex = 0
    this.wave = 1
    this.waveTimer = 0
    this.cameraFocus = 0
    this.localLane = 2
    this.dragging = false
    this.dragStartX = 0
    this.dragCameraX = 0
    this.manualCameraUntil = 0
  }

  /** The army and fortress this client is playing. */
  get localArmy(): Army {
    return this.battlefield.armyFor(this.localFaction)
  }

  get localBase(): Base {
    return this.battlefield.baseFor(this.localFaction)
  }

  get foeArmy(): Army {
    return this.battlefield.armyFor(OPPOSITE[this.localFaction])
  }

  get foeBase(): Base {
    return this.battlefield.baseFor(OPPOSITE[this.localFaction])
  }

  get isNetworked(): boolean {
    return this.lockstep !== undefined
  }

  // ───────────────────────────── Networking ─────────────────────────────

  private setupNetworking(): void {
    const setup = session.setup
    if (!setup.netRole) return

    // Host commands the left fortress, guest the right. Both simulate the
    // same world; only the point of view differs.
    this.localFaction = setup.netRole === 'host' ? 'player' : 'enemy'
    const peer = session.peer ?? undefined

    this.lockstep = new LockstepDriver(this.battlefield, this.localFaction, {
      send: message => peer?.send(message),
      onDesync: (tick, mine, theirs) => this.handleDesync(tick, mine, theirs),
      onStall: stalled =>
        gameEvents.emit('hud:flash', {
          message: stalled ? 'Waiting for opponent…' : 'Opponent reconnected',
          tone: stalled ? 'warn' : 'good'
        }),
      onLost: () => this.handleOpponentLeft('they stopped responding')
    })

    if (peer) {
      this.netHandler = (message: NetMessage) => {
        if (message.k === 'tick') this.lockstep?.receive(message)
        else if (message.k === 'bye') this.handleOpponentLeft(message.reason)
      }
      session.setNetHandler(this.netHandler, (state, detail) => this.handleLinkState(state, detail))
    }
  }

  private netHandler?: (message: NetMessage) => void

  private handleDesync(tick: number, mine: number, theirs: number): void {
    console.warn(`[gow] desync at tick ${tick}: ${mine} vs ${theirs}`)
    gameEvents.emit('hud:flash', {
      message: 'Simulations diverged — match ended',
      tone: 'warn'
    })
    this.endNetworkedMatch('The two games fell out of sync, so the match was stopped.')
  }

  /**
   * A peer that closes its tab or loses its network never gets to send a
   * `bye`, so the link's own health is the only signal that the match is over.
   */
  private handleLinkState(state: PeerState, detail?: string): void {
    if (this.ended) return
    if (state === 'interrupted') {
      gameEvents.emit('hud:flash', { message: 'Connection interrupted…', tone: 'warn' })
      return
    }
    if (state === 'failed' || state === 'closed') {
      this.handleOpponentLeft(detail ?? 'connection lost')
    }
  }

  private handleOpponentLeft(reason: string): void {
    if (this.ended || this.leaving) return
    this.leaving = true
    // The peer may simply have finished the match a tick before we did — the
    // link goes down the same way either way. Our own simulation is only
    // milliseconds behind and already holds their queued commands, so give it
    // a moment to reach the same conclusion. A real result beats a disconnect
    // notice every time.
    this.time.delayedCall(1500, () => {
      if (this.ended) return
      gameEvents.emit('hud:flash', { message: 'Opponent left', tone: 'warn' })
      this.endNetworkedMatch(`Your opponent disconnected (${reason}).`)
    })
  }

  private endNetworkedMatch(reason: string): void {
    if (this.ended) return
    this.ended = true
    this.lockstep?.stop()
    session.endNetworkMatch(reason)
    session.netEndReason = reason
    audio.stopMusic()
    this.time.delayedCall(400, () => {
      this.scene.stop('HUDScene')
      this.scene.start('MenuScene')
    })
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
    this.ai?.escalate(this.wave)

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
      this.lighting.setAge(age)
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

    keyboard.on('keydown-ESC', () => {
      // A full-screen panel owns Escape while it is up, or closing research
      // would also pause the battle behind it.
      if (this.modalOpen) return
      this.togglePause()
    })
    keyboard.on('keydown-P', () => this.togglePause())
    keyboard.on('keydown-F', () => this.cycleSpeed())
    keyboard.on('keydown-E', () => this.tryEvolve())
    keyboard.on('keydown-Q', () => this.tryAbility())
    keyboard.on('keydown-SPACE', () => this.tryAbility())
    keyboard.on('keydown-U', () => this.tryEconomy())
    keyboard.on('keydown-R', () => gameEvents.emit('hud:tech', undefined))
    // The whole of placement: pick the file the next piece will walk.
    const LANE_KEYS = ['Z', 'X', 'C', 'V', 'B']
    LANE_KEYS.forEach((key, lane) => keyboard.on(`keydown-${key}`, () => this.setLane(lane)))
    keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault()
      this.setLane((this.localLane + 1) % 5)
    })
    keyboard.on('keydown-BACKSPACE', () => {
      if (this.localArmy.queue.length === 0) return
      this.dispatch({ t: 'cancel' })
      audio.play('coin', 0.4)
    })

    for (let i = 1; i <= DIGIT_KEYS.length; i += 1) {
      keyboard.on(`keydown-${DIGIT_KEYS[i - 1]}`, () => this.queueByIndex(i - 1))
    }

    // Drag to pan; releases back to auto-follow after a moment.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.y > this.cameras.main.height - 120) return
      this.dragging = true
      this.dragStartX = pointer.x
      this.dragCameraX = this.cameras.main.scrollX
    })
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      // A click on one of the paths — not a drag, not the HUD — is a lane
      // order, the same gesture as pointing at a file on a board.
      const moved = Math.abs(pointer.x - this.dragStartX) > 6
      if (!moved && pointer.y < this.cameras.main.height - 120) {
        const dy = pointer.y - GROUND_Y
        if (dy > -92 && dy < 94) {
          this.setLane(dy < -51 ? 0 : dy < -17 ? 1 : dy < 17 ? 2 : dy < 51 ? 3 : 4)
        }
      }
      this.dragging = false
    })
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging || !pointer.isDown) return
      const dx = (this.dragStartX - pointer.x) / CAMERA_ZOOM
      if (Math.abs(dx) > 4) {
        this.cameras.main.setScroll(Math.round(this.dragCameraX + dx), CAMERA_SCROLL_Y)
        this.manualCameraUntil = this.time.now + 2600
      }
    })
  }

  private setLane(lane: number): void {
    if (lane === this.localLane) return
    this.localLane = lane
    audio.play('ui_click', 0.35)
    gameEvents.emit('hud:lane', lane)
  }

  /**
   * Every player action funnels through here. Offline it applies immediately;
   * networked it becomes a command that both peers execute on the same tick.
   */
  private dispatch(command: Command): void {
    if (this.lockstep) this.lockstep.issue(command)
    else applyCommand(this.battlefield, this.localFaction, command)
  }

  queueByIndex(index: number): void {
    const army = this.localArmy
    const def = army.roster[index]
    if (!def) return
    const reason = army.blockReason(def)
    if (reason) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: reason, tone: 'warn' })
      return
    }
    this.dispatch({ t: 'unit', id: def.id, lane: this.localLane })
    audio.play('ui_click', 0.4)
  }

  buildTurret(slot: number, turretId: string): void {
    this.dispatch({ t: 'turret', slot, id: turretId })
    audio.play('ui_click', 0.4)
  }

  sellTurret(slot: number): void {
    this.dispatch({ t: 'sell', slot })
    audio.play('ui_click', 0.4)
  }

  tryEvolve(): boolean {
    const army = this.localArmy
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
    this.dispatch({ t: 'evolve' })
    return true
  }

  tryAbility(): boolean {
    if (!this.localArmy.abilityReady) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: 'Special ability is still charging', tone: 'warn' })
      return false
    }
    this.dispatch({ t: 'ability' })
    if (!this.isNetworked) this.checkAbilityAchievement()
    this.manualCameraUntil = 0
    return true
  }

  /**
   * Researches a behaviour. Like every other action it goes out as a command,
   * so a networked match applies it on the same tick on both machines.
   */
  tryTech(id: TechId): boolean {
    const army = this.localArmy
    const node = TECHS_BY_ID[id]
    const state = army.techAvailability(id)
    if (state === 'owned') return false
    if (state === 'locked') {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `${node.name} needs its prerequisite first`, tone: 'warn' })
      return false
    }
    if (state === 'age') {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `${node.name} unlocks in a later age`, tone: 'warn' })
      return false
    }
    if (state === 'demand' && node.demand) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `${node.name}: ${node.demand.label}`, tone: 'warn' })
      return false
    }
    if (state === 'gold') {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `${node.name} costs ${node.cost} gold`, tone: 'warn' })
      return false
    }
    this.dispatch({ t: 'tech', id })
    audio.play('evolve', 0.6)
    gameEvents.emit('hud:flash', { message: `${node.name} researched`, tone: 'good' })
    return true
  }

  tryEconomy(): boolean {
    const army = this.localArmy
    const cost = army.incomeUpgradeCost()
    if (cost === null) {
      gameEvents.emit('hud:flash', { message: 'Economy fully upgraded', tone: 'info' })
      return false
    }
    if (army.gold < cost) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `Economy upgrade costs ${cost} gold`, tone: 'warn' })
      return false
    }
    this.dispatch({ t: 'econ' })
    audio.play('coin', 0.6)
    gameEvents.emit('hud:flash', { message: 'Income increased', tone: 'good' })
    return true
  }

  cycleSpeed(): void {
    if (this.isNetworked) {
      gameEvents.emit('hud:flash', { message: 'Game speed is fixed in multiplayer', tone: 'info' })
      return
    }
    this.speedIndex = (this.speedIndex + 1) % this.speeds.length
    this.battlefield.speedScale = this.speeds[this.speedIndex]
    audio.play('ui_click', 0.4)
  }

  get speed(): number {
    return this.speeds[this.speedIndex]
  }

  togglePause(): void {
    if (this.ended) return
    if (this.isNetworked && !this.paused) {
      // Pausing cannot stop the opponent's clock, so the menu opens without
      // freezing the world.
      gameEvents.emit('hud:flash', { message: 'The battle continues while this menu is open', tone: 'info' })
    }
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
    const cam = this.cameras.main
    this.background.update(delta, cam.scrollX)
    this.splatter.beginFrame(delta)
    this.debris.render(this.battlefield.physics)
    // Composite lighting from whatever registered a light this frame.
    this.lighting.render(cam.worldView.x, cam.worldView.y)
    if (this.ended) return
    if (this.paused && !this.isNetworked) return

    if (this.lockstep) {
      // Fixed network ticks; wall-clock only decides *when* a tick may run.
      this.lockstep.update(delta, TICK_SUBSTEPS * Battlefield.stepMs)
    } else {
      this.battlefield.update(delta)
      this.ai?.update(delta * this.battlefield.speedScale)
    }
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
    cam.setScroll(Math.round(this.cameraFocus - cam.width / 2), CAMERA_SCROLL_Y)
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

    // `victory` is expressed from the left-hand fortress's point of view. The
    // guest in a networked match commands the right-hand one, so the meaning
    // has to be flipped for them.
    const localVictory = this.isNetworked ? victory === (this.localFaction === 'player') : victory
    const stats = { ...bf.statsFor(this.localFaction) }
    stats.wavesSurvived = this.wave

    const healthRatio = this.localBase.hp / this.localBase.maxHp
    const seconds = bf.elapsedMs / 1000
    let stars = 0
    let newRecord = false

    if (this.isNetworked) {
      // A peer match has no campaign progress and no achievements: the
      // opponent controls half the inputs, so neither would mean anything.
      session.result = {
        victory: localVictory,
        stats,
        setup,
        stars: 0,
        newRecord: false,
        unlockedAchievements: []
      }
      gameEvents.emit('match:ended', { victory: localVictory, stats })
      session.endNetworkMatch('match finished', false)
      audio.stopMusic()
      this.time.delayedCall(600, () => {
        this.scene.stop('HUDScene')
        this.scene.start('ResultScene')
      })
      return
    }

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
    if (session.onNetMessage === this.netHandler) session.onNetMessage = null
    this.lockstep?.stop()
    this.battlefield.destroy()
    this.background.destroy()
    this.debris.destroy()
    this.splatter.destroy()
    this.lighting.destroy()
    this.vfx.destroy()
  }
}

const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']

function indexOfLevel(id: string): number {
  return LEVELS.findIndex(l => l.id === id)
}
