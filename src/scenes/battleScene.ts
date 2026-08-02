import Phaser from 'phaser'
import { audio } from '../core/audio'
import { gameLog } from '../core/log'
import { gameEvents } from '../core/events'
import { ACHIEVEMENTS, save } from '../core/save'
import { session } from '../core/session'
import { AGES, ageDef } from '../data/ages'
import { BUILDINGS_BY_ID, REBUILD_FRACTION, SEAT_STEP, buildingCost } from '../data/buildings'
import { TRACKS_BY_ID, type FortressTrackId } from '../data/fortress'
import { FACTIONS_BY_ID } from '../data/factions'
import { TECHS_BY_ID, type TechId } from '../data/tech'
import { ENDLESS_WAVE_SECONDS, LEVELS, computeStars } from '../data/levels'
import { BAND, SLOT, onGround } from '../gfx/depth'
import Environment from '../gfx/environment'
import DebrisLayer from '../gfx/debrisLayer'
import Splatter from '../gfx/splatter'
import TerrainLayer from '../gfx/terrainLayer'
import ZoneLayer from '../gfx/zoneLayer'
import Lighting from '../gfx/lighting'
import { AGE_THEMES } from '../gfx/palette'
import Vfx from '../gfx/vfx'
import LockstepDriver, { applyCommand } from '../net/lockstep'
import type { PeerState } from '../net/peer'
import { TICK_SUBSTEPS, type Command, type NetMessage } from '../net/protocol'
import AiController, { AI_PROFILES } from '../sim/ai'
import { ORDER_LIMIT } from '../sim/army'
import type Army from '../sim/army'
import type Base from '../sim/base'
import Battlefield from '../sim/battlefield'
import { LANE_Y, OPPOSITE, type Faction, type ReserveMode } from '../sim/types'
import { rng as cosmeticRng } from '../core/rng'

/**
 * The board, sized for the war it will become rather than the one it starts as.
 *
 * Every age-up founds a seat SEAT_STEP further back, so the ground between two
 * commanders grows by that much on each side — the playfield IS the age track.
 * The whole extent is allocated once, up front, because a terrain array that
 * resized mid-match would have to be re-hashed and would fork a networked game;
 * the CAMERA is what is bounded to the part of it that is currently in use.
 *
 * Two commanders at the first age stand INITIAL_FIELD apart. Two who have both
 * reached the last age stand INITIAL_FIELD + 2 × MAX_RECEDE apart — a little
 * over twice as far, with four derelict establishments strung out between them.
 */
const SEAT_MARGIN = 150
const INITIAL_FIELD = 2100
export const MAX_RECEDE = SEAT_STEP * (AGES.length - 1)
/** Where a commander's FIRST seat stands. Everything recedes from here. */
export const FIRST_SEAT_X = SEAT_MARGIN + MAX_RECEDE
export const WORLD_WIDTH = INITIAL_FIELD + 2 * FIRST_SEAT_X
export const GROUND_Y = 520
export const AIR_Y = 240
/** Slight zoom so soldiers read clearly without shrinking the battlefield. */
const CAMERA_ZOOM = 1.0
/** Vertical scroll that puts the ground line just above the command bar. */
const CAMERA_SCROLL_Y = 0
/**
 * What a sandbox commander is handed, and re-handed whenever it runs low.
 *
 * Large enough that nothing is ever unaffordable, small enough to read as a
 * number on the bar rather than as scientific notation.
 */
const SANDBOX_PURSE = 5_000_000

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
  private terrainLayer!: TerrainLayer
  private zoneLayer!: ZoneLayer
  /** Accumulator for the peace-time stain sweep. */
  private erosionClock = 0
  private erosionX = 0
  /** Ambient creed motes — flies, embers, wisps, spores over a leaned half. */
  private ambientClock = 0
  private lighting!: Lighting
  private vfx!: Vfx
  /** Absent in peer-to-peer matches, where both sides are human. */
  ai?: AiController
  private waveTimer = 0
  private dragStartX = 0
  private dragCameraX = 0
  private dragging = false
  /** Keys that pan the camera — arrows and A/D, held rather than tapped. */
  private panDir: Record<'left' | 'right', Phaser.Input.Keyboard.Key[]> = { left: [], right: [] }
  private ended = false
  /** A disconnect has been seen and is waiting out its grace window. */
  private leaving = false
  private matchSeed = 0
  private bannerFlags: { pole: Phaser.GameObjects.Image; flag: Phaser.GameObjects.Image }[] = []
  private bannerLayoutKey = ''
  /** The Incarnation sigil burning over each fortress, one per side. */
  private sigils: Partial<Record<Faction, Phaser.GameObjects.Graphics>> = {}

  /**
   * THE SIGIL. What the player gets for gold that places no soldier.
   *
   * Drawn over the paying side's own fortress and redrawn a size larger with
   * every mark, so the investment is legible to both players from across the
   * board — the opponent can see an Incarnation being paid for and how far in
   * it is, which is the entire counterplay this mechanic used to lack.
   *
   * Cosmetic only. The simulation owns the count; this owns the picture.
   */
  private growSigil(faction: Faction, marks: number): void {
    const bf = this.battlefield
    const base = faction === 'player' ? bf.playerBase : bf.enemyBase
    let sigil = this.sigils[faction]
    if (!sigil) {
      sigil = this.add.graphics()
      sigil.setDepth(BAND.air + 4)
      this.sigils[faction] = sigil
    }

    // Grows fast for the first few marks and then flattens, so a heavy investor
    // still reads as heavier without the sigil swallowing the sky.
    const radius = 26 + Math.sqrt(marks) * 15
    const y = GROUND_Y - 300
    sigil.clear()
    sigil.lineStyle(3, 0xc0392b, 0.85)
    sigil.strokeCircle(base.x, y, radius)
    sigil.lineStyle(2, 0xff4a3c, 0.55)
    sigil.strokeCircle(base.x, y, radius * 0.72)
    // One spoke per mark, so the count is countable and not merely a size.
    const spokes = Math.min(marks, 12)
    for (let i = 0; i < spokes; i += 1) {
      const angle = (i / spokes) * Math.PI * 2
      sigil.lineBetween(
        base.x + Math.cos(angle) * radius * 0.72,
        y + Math.sin(angle) * radius * 0.72,
        base.x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius
      )
    }
    this.vfx.energyBurst(base.x, y, 0xc0392b, 1.2)
  }

  /** The sim re-lays the field's prizes as the war ages; the art follows. */
  private rebuildBannerFlags(): void {
    for (const entry of this.bannerFlags) {
      entry.pole.destroy()
      entry.flag.destroy()
    }
    this.bannerFlags = this.battlefield.banners.map(banner => {
      const laneY = GROUND_Y + LANE_Y[banner.lane]
      // A banner is furniture standing on the road, so it sorts with the road.
      const depth = onGround(banner.lane, SLOT.prop)
      return {
        pole: this.add.image(banner.x, laneY + 4, 'banner:pole').setOrigin(0.5, 1).setDepth(depth),
        flag: this.add
          .image(banner.x + 3, laneY - 46, `banner:flag:${banner.kind}`)
          .setOrigin(0, 0.5)
          .setDepth(depth)
      }
    })
    this.bannerLayoutKey = this.battlefield.banners.map(b => `${b.x}:${b.lane}:${b.kind}`).join('|')
  }

  /**
   * Which side this client commands. Always 'player' offline; the guest in a
   * networked match commands 'enemy' in the shared world.
   */
  localFaction: Faction = 'player'

  /**
   * The workbench. No AI, no scarcity, and either side is yours.
   *
   * Everything a balance question needs and nothing it does not: both
   * commanders' purses and research are topped up every tick, nobody is driving
   * the opposition, and F8 hands you the other half of the field so a matchup
   * can be BUILT rather than waited for.
   */
  sandbox = false
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
    // The camera is bounded to the ground in play, which grows as the war does.
    // `refreshCameraBounds` is called again whenever a seat is founded.
    cam.setBounds(0, 0, WORLD_WIDTH, cam.height)
    cam.setScroll(this.localFaction === 'player' ? 0 : WORLD_WIDTH, CAMERA_SCROLL_Y)
    cam.setZoom(CAMERA_ZOOM)

    this.lighting = new Lighting(this, 700, GROUND_Y - 138)
    this.vfx = new Vfx(this, GROUND_Y, this.lighting)
    this.background = new Environment(this, WORLD_WIDTH, GROUND_Y)
    // The mess sits above the ground and below the fighting.
    this.splatter = new Splatter(this, WORLD_WIDTH, GROUND_Y, BAND.litter)
    this.debris = new DebrisLayer(this, BAND.debris)

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
        // Difficulty handicaps are for the AI. In a networked match the
        // opponent is a human — and worse, each peer would read its OWN local
        // difficulty setting, hand the two simulations different modifiers,
        // and desync the match within seconds of the first hash exchange.
        // Online, both armies are vanilla, on both machines, always.
        enemyModifiers: setup.netRole
          ? {}
          : {
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

    gameLog.log('match', `battle starting: mode=${setup.mode} netRole=${setup.netRole ?? 'solo'} seed=${this.matchSeed} difficulty=${setup.netRole ? 'ignored (networked)' : setup.difficulty} pop cap age0=${this.battlefield.player.populationCap}`)
    this.sandbox = setup.sandbox === true
    // A networked match has two humans; nobody is driving the AI. Neither does
    // the sandbox — an opponent playing itself while you are trying to set a
    // matchup up is noise, and you can take that side yourself whenever you
    // want to see it answer.
    if (!setup.netRole && !this.sandbox) {
      this.ai = new AiController(this.battlefield, profile, (this.matchSeed ^ 0x9e3779b9) >>> 0)
    }
    // Say out loud what the mode is FOR. Taking the opposition is the whole
    // point of the workbench and it was documented in one source comment, so
    // anyone who did not read the code had a mode with an unreachable half.
    if (this.sandbox) {
      this.time.delayedCall(900, () => {
        gameEvents.emit('hud:flash', {
          message: 'SANDBOX — F8 or the SIDE button takes the other half of the field',
          tone: 'info'
        })
      })
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

    this.terrainLayer = new TerrainLayer(this, this.battlefield, GROUND_Y)
    // Fire, spores and plague get a body of their own.
    this.zoneLayer = new ZoneLayer(this, this.battlefield, GROUND_Y)

    // War banners: the map-control flags. Their number, lanes and KINDS come
    // from the sim (they grow with the war), so the sprites rebuild whenever
    // the layout changes. The pennant's shape says what the prize is: a
    // rectangle pays gold, a pennant pays evolution, a swallowtail feeds the
    // commander's ability.
    if (!this.textures.exists('banner:pole')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0x23262e, 1).fillRect(2, 0, 4, 58)
      g.fillStyle(0x3a3f4d, 1).fillRect(3, 0, 2, 58)
      g.fillStyle(0x14161c, 1).fillRect(0, 54, 8, 4)
      g.generateTexture('banner:pole', 8, 58)
      g.clear()
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 24, 13)
      g.fillStyle(0x000000, 0.25).fillRect(0, 11, 24, 2)
      g.generateTexture('banner:flag:gold', 24, 14)
      g.clear()
      g.fillStyle(0xffffff, 1).fillTriangle(0, 0, 26, 6, 0, 13)
      g.generateTexture('banner:flag:xp', 26, 14)
      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillRect(0, 0, 24, 14)
      g.fillTriangle(24, 0, 14, 7, 24, 14)
      g.generateTexture('banner:flag:ability', 24, 14)
      g.destroy()
    }
    this.rebuildBannerFlags()

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
        unit.groundLine + unit.stageY,
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
    this.battlefield.onIncarnationSigil = (faction, marks) => this.growSigil(faction, marks)

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
    // A test seam, and only that. A harness measuring determinism has to own
    // the clock from the very first tick: if the battle runs frame-driven even
    // for a moment before the harness pauses it, how many frames elapsed
    // depends on machine load, and two runs of the same seed legitimately
    // diverge. Setting this before starting a battle hands the harness a world
    // that has never been stepped.
    this.paused = (globalThis as { __gowPauseOnStart?: boolean }).__gowPauseOnStart === true
    this.ended = false
    this.leaving = false
    this.speedIndex = 0
    this.wave = 1
    this.waveTimer = 0
    this.localLane = 2
    this.dragging = false
    this.dragStartX = 0
    this.dragCameraX = 0
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
    // With no auto-follow, the opening frame is the one thing the scene sets:
    // each commander starts looking at their own fortress.
    if (this.localFaction === 'enemy') {
      this.cameras.main.setScroll(this.cameraLimit() - this.cameras.main.width / CAMERA_ZOOM, CAMERA_SCROLL_Y)
    }
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
    const bf = this.battlefield
    gameLog.log('sync', `desync context: units=${bf.units.length} projectiles=${bf.projectiles.length} pGold=${Math.floor(bf.player.gold)} eGold=${Math.floor(bf.enemy.gold)} pAge=${bf.player.age} eAge=${bf.enemy.age} pTechs=[${[...bf.player.techs].join(',')}] eTechs=[${[...bf.enemy.techs].join(',')}]`)
    gameLog.persist()
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
    keyboard.on('keydown-U', () => gameEvents.emit('hud:base', undefined))
    keyboard.on('keydown-R', () => gameEvents.emit('hud:tech', undefined))
    keyboard.on('keydown-G', () => this.cycleReserve())
    keyboard.on('keydown-H', () => this.emptyOssuary())
    // The black box, on demand: F9 downloads this session's debug log.
    keyboard.on('keydown-F9', () => gameLog.download())
    // The workbench: take the other side of the field.
    keyboard.on('keydown-F8', () => this.swapSide())
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
      // Shift stands the card as an order instead of buying one of it, so the
      // battle plan is reachable without ever leaving the keyboard.
      keyboard.on(`keydown-${DIGIT_KEYS[i - 1]}`, (event: KeyboardEvent) => {
        if (event.shiftKey) this.toggleOrderByIndex(i - 1)
        else this.queueByIndex(i - 1)
      })
    }

    // The camera belongs to the player, full stop. Drag to pan (the world
    // moves with the hand, clamped to the board), arrows or A/D to slide,
    // and the screen edges nudge it the way an RTS does. Nothing ever moves
    // it on its own.
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
      this.panCamera(this.dragCameraX + dx - this.cameras.main.scrollX)
    })

    this.panDir.left = [
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A)
    ]
    this.panDir.right = [
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    ]
  }

  /**
   * The right-hand edge the camera may reach: a little past the far commander,
   * never out into the ground that has not been receded into yet.
   */
  private cameraLimit(): number {
    const bf = this.battlefield
    return Math.min(WORLD_WIDTH, bf.backEdge + 320)
  }

  /** The left-hand edge, likewise. */
  private cameraFloor(): number {
    return Math.max(0, this.battlefield.frontEdge - 320)
  }

  /** Moves the camera by a delta, pinned to the board. One clamp, one place. */
  private panCamera(dx: number): void {
    const cam = this.cameras.main
    const max = Math.max(0, this.cameraLimit() - cam.width / CAMERA_ZOOM)
    cam.setScroll(Math.round(Phaser.Math.Clamp(cam.scrollX + dx, this.cameraFloor(), max)), CAMERA_SCROLL_Y)
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

  /**
   * Stands (or lifts) an order for this card in the file currently selected.
   *
   * Deliberately the SELECTED file rather than a file picked in some separate
   * dialogue: choosing a file is already the game's one placement decision and
   * already has five keys bound to it, so an order is that same decision, held.
   */
  toggleOrderByIndex(index: number): void {
    const army = this.localArmy
    const def = army.roster[index]
    if (!def) return
    const lane = this.localLane
    const standing = army.hasOrder(def.id, lane)
    if (!standing && army.orders.length >= ORDER_LIMIT) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `Battle plan is full (${ORDER_LIMIT} orders)`, tone: 'warn' })
      return
    }
    this.dispatch({ t: 'order', id: def.id, lane })
    audio.play('ui_click', 0.4)
    gameEvents.emit('hud:flash', {
      message: standing
        ? `Standing down ${def.name} · ${LANE_NAMES[lane]}`
        : `${def.name} on repeat · ${LANE_NAMES[lane]}`,
      tone: standing ? 'warn' : 'good'
    })
  }

  /**
   * Empties every finished Ossuary you hold.
   *
   * Deliberately all of them at once and deliberately a single key: after two
   * minutes of saving, the moment you choose is the decision, and asking which
   * building would turn a payoff into paperwork.
   */
  emptyOssuary(): void {
    const banked = this.battlefield.ossuaryBanked(this.localFaction)
    if (banked <= 0) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: 'Nothing banked yet', tone: 'warn' })
      return
    }
    this.dispatch({ t: 'ossuary' })
    audio.play('ui_click', 0.4)
    gameEvents.emit('hud:flash', { message: `THE RISEN — ${banked} stand up`, tone: 'good' })
  }

  /** Cycles what the standing orders refuse to spend. */
  /**
   * Keeps both purses and both benches full while the sandbox is running.
   *
   * A ceiling rather than a flat assignment, so a click that spends still shows
   * a number going down for the moment before it refills — reading `9e9` in the
   * corner tells you nothing about whether a purchase actually went through.
   * Research is topped the same way, so any node can be started at once.
   */
  private topUpSandbox(): void {
    if (!this.sandbox) return
    for (const faction of ['player', 'enemy'] as const) {
      const army = this.battlefield.armyFor(faction)
      if (army.gold < SANDBOX_PURSE / 2) army.gold = SANDBOX_PURSE
      if (army.research < SANDBOX_PURSE / 2) army.research = SANDBOX_PURSE
      if (army.studying) army.studyRp = Math.max(army.studyRp, army.researchCost(army.studying))
      army.xp = Math.max(army.xp, army.xpToAdvance)
    }
  }

  /**
   * Hands you the other side of the field.
   *
   * Everything the HUD, the input and the camera read hangs off `localFaction`
   * already — it is how a networked guest commands the far half — so taking the
   * opposition is a matter of moving that one value and telling the interface
   * to look again.
   */
  swapSide(): void {
    if (!this.sandbox) return
    this.localFaction = OPPOSITE[this.localFaction]
    this.localLane = 2
    // `pan` moves the camera's CENTRE, where `setScroll` sets its top-left, so
    // the target has to be offset by half a screen or the swap lands half a
    // viewport short of where the opening shot of that side would be.
    const cam = this.cameras.main
    const half = cam.width / 2
    cam.pan(
      this.localFaction === 'player' ? half : WORLD_WIDTH - half,
      CAMERA_SCROLL_Y + cam.height / 2,
      420,
      'Sine.easeInOut'
    )
    // The HUD re-reads `localArmy` on its next sync, so nothing has to be told
    // to rebuild — it only has to be told WHICH side it is now looking at.
    gameEvents.emit('hud:flash', {
      message: this.localFaction === 'player' ? 'COMMANDING THE LEFT' : 'COMMANDING THE RIGHT',
      tone: 'info'
    })
    gameLog.log('match', `sandbox: now commanding ${this.localFaction}`)
  }

  cycleReserve(): void {
    const order: ReserveMode[] = ['none', 'age', 'elite', 'rush']
    const next = order[(order.indexOf(this.localArmy.reserveMode) + 1) % order.length]
    this.dispatch({ t: 'reserve', mode: next })
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
    if (state === 'sworn') {
      const rival = TECHS_BY_ID[army.sworn(id) ?? '']
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', {
        message: `${node.name} is closed — you swore ${rival?.name ?? 'the other road'}`,
        tone: 'warn'
      })
      return false
    }
    if (state === 'demand' && node.demand) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `${node.name}: ${node.demand.label}`, tone: 'warn' })
      return false
    }
    // Already on the bench: clicking it again takes it off, and what was
    // invested is lost. Switching is meant to hurt.
    if (state === 'studying') {
      this.dispatch({ t: 'unstudy' })
      audio.play('ui_click', 0.4)
      gameEvents.emit('hud:flash', { message: `${node.name} abandoned`, tone: 'warn' })
      return true
    }
    // Research is work, not a purchase — you may begin a node you cannot yet
    // afford, and the bench fills at whatever rate your halls produce.
    const busy = army.studying ? TECHS_BY_ID[army.studying] : null
    this.dispatch({ t: 'study', id })
    audio.play('evolve', 0.6)
    const eta = Math.ceil(army.researchCost(id) / Math.max(0.1, army.researchRate))
    gameEvents.emit('hud:flash', {
      message: busy ? `${node.name} replaces ${busy.name} on the bench` : `Studying ${node.name} — about ${eta}s`,
      tone: busy ? 'warn' : 'good'
    })
    return true
  }

  /**
   * Raises a building on a plot, or lifts what stands there by one tier.
   *
   * Every refusal the simulation can make is spelled out here rather than
   * failing silently: the panel is the only place a player meets the outworks,
   * and "nothing happened" is the worst thing a building menu can say.
   */
  tryBuild(plot: number, id: string): boolean {
    const bf = this.battlefield
    const army = this.localArmy
    const seat = bf.activeSeat(this.localFaction)
    const target = seat.plots[plot]
    const def = BUILDINGS_BY_ID[id]
    if (!target || !def) return false
    const deny = (message: string): boolean => {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message, tone: 'warn' })
      return false
    }
    if (!seat.accepts(plot, def)) return deny(`${def.name} cannot stand on that plot`)
    if (def.requires && !army.techs.has(def.requires)) {
      return deny(`${def.name} needs ${TECHS_BY_ID[def.requires]?.name ?? 'research'}`)
    }
    if (target.underConstruction) return deny(`${target.def?.name ?? 'That plot'} is still being built`)
    if (target.alive && target.def && target.def.id !== def.id) {
      return deny(`${target.def.name} stands there — raze it first`)
    }
    const razed = !target.alive && target.def !== null
    const tier = target.alive && target.def ? target.tier + 1 : razed && target.def?.id === def.id ? target.tier : 0
    if (tier >= def.tiers.length) return deny(`${def.name} is at its highest tier`)
    const full = buildingCost(def, tier, army.age)
    const cost = razed ? Math.round(full * REBUILD_FRACTION) : full
    if (army.gold < cost) return deny(`${def.name} costs ${cost} gold`)
    this.dispatch({ t: 'build', plot, id })
    audio.play('coin', 0.6)
    gameEvents.emit('hud:flash', {
      message: razed ? `${def.name} being rebuilt` : tier > 0 ? `${def.name} raised to tier ${tier + 1}` : `${def.name} raised`,
      tone: 'good'
    })
    return true
  }

  /** Clears a plot you own, for half the money back. */
  tryRaze(plot: number): boolean {
    const target = this.battlefield.activeSeat(this.localFaction).plots[plot]
    if (!target?.alive || !target.def) return false
    this.dispatch({ t: 'raze', plot })
    audio.play('ui_click', 0.5)
    gameEvents.emit('hud:flash', { message: `${target.def.name} cleared`, tone: 'info' })
    return true
  }

  /** Buys the next level of a fortress track. */
  tryFortify(track: FortressTrackId): boolean {
    const army = this.localArmy
    const spec = TRACKS_BY_ID[track]
    const cost = army.trackCost(track)
    if (cost === null) {
      gameEvents.emit('hud:flash', { message: `${spec.name} is finished`, tone: 'info' })
      return false
    }
    if (army.gold < cost) {
      audio.play('ui_denied', 0.5)
      gameEvents.emit('hud:flash', { message: `${spec.name} costs ${cost} gold`, tone: 'warn' })
      return false
    }
    this.dispatch({ t: 'fortify', track })
    audio.play('coin', 0.6)
    gameEvents.emit('hud:flash', { message: `${spec.name} ${army.tracks[track] + 1}`, tone: 'good' })
    return true
  }

  /** Chooses what a superseded seat turns out for free. */
  trySetGarrison(seat: number, id: string): boolean {
    this.dispatch({ t: 'garrison', seat, id })
    audio.play('ui_click', 0.5)
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

  /**
   * The air over a leaned half carries its creed: black flies over the
   * carnage mounds, embers over the broken ground, wisps over the haunts,
   * spores over the bloom. Engineering gets nothing — a clean half is its
   * whole point. Pure cosmetics from the cosmetic stream, and only over
   * ground the war has actually marked, so it reads as weather, not noise.
   */
  private spawnCreedMotes(): void {
    const bf = this.battlefield
    for (const faction of ['player', 'enemy'] as Faction[]) {
      const lean = bf.leanOf(faction)
      if (!lean || lean === 'engineering') continue
      // Over the LIVE field, not the allocated world. The world is sized once
      // for the deepest seat either side will ever retire to, so most of it is
      // empty ground at age one — weather thrown across that reads as fog on a
      // map nobody is standing on.
      const halfSpan = (bf.backEdge - bf.frontEdge) / 2
      const half = faction === 'player' ? bf.frontEdge : bf.midfield
      const x = half + halfSpan * 0.08 + cosmeticRng.next() * halfSpan * 0.84
      const lane = cosmeticRng.int(0, LANE_Y.length - 1)
      const y = GROUND_Y + LANE_Y[lane] - 4 - cosmeticRng.next() * 12
      const marked =
        Math.abs(bf.terrain.heightAt(x, lane)) > 3 ||
        bf.terrain.hauntAt(x, lane) > 0.25 ||
        bf.goreAt(x) > 0.25
      if (!marked) continue
      const style = {
        carnage: { color: 0x241418, size: 2.6, rise: 24, drift: 34, alpha: 0.85, add: false, ms: 1400 },
        ordnance: { color: 0xff8a30, size: 2.2, rise: 48, drift: 12, alpha: 0.9, add: true, ms: 1100 },
        occult: { color: 0xb46bff, size: 2.8, rise: 34, drift: 8, alpha: 0.7, add: true, ms: 1800 },
        blight: { color: 0xa8e890, size: 2.2, rise: 18, drift: 26, alpha: 0.7, add: true, ms: 2300 }
      }[lean as 'carnage' | 'ordnance' | 'occult' | 'blight']
      if (!style) continue
      const mote = this.add
        .image(x, y, 'fx:soft')
        .setDepth(200)
        .setTint(style.color)
        .setAlpha(style.alpha)
        .setDisplaySize(style.size, style.size)
      if (style.add) mote.setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({
        targets: mote,
        y: y - style.rise,
        x: x + cosmeticRng.spread(style.drift),
        alpha: 0,
        duration: style.ms,
        onComplete: () => mote.destroy()
      })
    }
  }

  override update(_time: number, delta: number): void {
    const cam = this.cameras.main
    this.background.update(delta, cam.scrollX)
    this.splatter.beginFrame(delta)
    this.terrainLayer.update(delta)
    // Peace scrubs the stains, era by era: a stone-age field is green again in
    // a minute of quiet; a fusion-age one keeps its filth to the end.
    this.erosionClock += delta
    if (this.erosionClock > 900) {
      this.erosionClock = 0
      const bf = this.battlefield
      if (bf.elapsedMs - bf.lastViolenceMs > 12000) {
        const strength = [0.16, 0.09, 0.05, 0.02, 0.008][bf.era]
        // Sweeps the live field, which grows as seats recede, rather than the
        // whole allocated world — otherwise most passes scrub empty ground.
        const span = Math.max(1, bf.backEdge - bf.frontEdge)
        const walk = this.erosionX - bf.frontEdge + 173
        this.erosionX = bf.frontEdge + ((walk % span) + span) % span
        this.splatter.erode(this.erosionX, 130, strength)
      }
    }
    this.ambientClock += delta
    if (this.ambientClock > 520) {
      this.ambientClock = 0
      this.spawnCreedMotes()
    }
    // Pay off the frame's animation debt for every soldier: one pose per drawn
    // frame rather than one per simulation substep. Outside the pause check on
    // purpose — a paused field that has been stepped by hand still has to show
    // where it was stepped to.
    for (const u of this.battlefield.units) u.flushVisual()
    this.debris.render(this.battlefield.physics)
    this.zoneLayer.update(delta)
    const layoutKey = this.battlefield.banners.map(b => `${b.x}:${b.lane}:${b.kind}`).join('|')
    if (layoutKey !== this.bannerLayoutKey) this.rebuildBannerFlags()
    for (let i = 0; i < this.bannerFlags.length; i += 1) {
      const banner = this.battlefield.banners[i]
      const { flag } = this.bannerFlags[i]
      const grip = Math.abs(banner.hold) / 100
      const laneY = GROUND_Y + LANE_Y[banner.lane]
      flag.setTint(banner.hold >= 50 ? 0x63b3ff : banner.hold <= -50 ? 0xff5a52 : 0x8892a8)
      flag.setAlpha(0.45 + 0.55 * grip)
      flag.y = laneY - 34 - 14 * grip
      flag.setFlipX(banner.hold < 0)
    }
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
      this.topUpSandbox()
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

  /**
   * The player's camera controls, and only the player's: held pan keys and
   * the RTS edge-nudge. There is deliberately no auto-follow — a camera that
   * moves itself was the single most reported piece of jank, because every
   * repositioning the player made was quietly fought and then undone.
   */
  private updateCamera(delta: number): void {
    if (this.ended || this.dragging) return
    const speed = (delta / 1000) * 720
    let dx = 0
    if (this.panDir.left.some(k => k.isDown)) dx -= speed
    if (this.panDir.right.some(k => k.isDown)) dx += speed
    // Edge scroll, only while the pointer is actually over the battlefield —
    // never from the HUD strip, and never while a panel owns the input.
    const pointer = this.input.activePointer
    if (dx === 0 && !this.modalOpen && pointer.y > 70 && pointer.y < this.cameras.main.height - 120) {
      if (pointer.x < 26) dx -= speed
      else if (pointer.x > this.cameras.main.width - 26) dx += speed
    }
    if (dx !== 0) this.panCamera(dx)
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
    this.terrainLayer.destroy()
    this.lighting.destroy()
    this.vfx.destroy()
  }
}

/** How a file is named to the player, matching the lane strip in the HUD. */
const LANE_NAMES = ['FAR', 'Z-MID', 'MID', 'MID-N', 'NEAR']

const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']

function indexOfLevel(id: string): number {
  return LEVELS.findIndex(l => l.id === id)
}
