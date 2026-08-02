import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const BASE_URL = process.env.GOW_RENDER_URL ?? 'http://127.0.0.1:8080'
const OUT_DIR = path.resolve(process.env.GOW_COMBAT_OUT ?? 'artifacts/carnage-combat')
const RAW_DIR = path.join(OUT_DIR, 'raw')
const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30

const scenes = [
  {
    slug: '01-age-1-corrupted-vanguard',
    title: 'AGE 1 — CORRUPTED VANGUARD',
    subtitle: 'Human formations beginning to rot from within',
    age: 1,
    duration: 12,
    playerNames: ['Husk', 'Corrupted Longbowman', 'Corrupted Pikeman', 'Corrupted Knight', 'Corrupted Battle Monk']
  },
  {
    slug: '02-age-2-early-mutations',
    title: 'AGE 2 — EARLY MUTATIONS',
    subtitle: 'Flenser, Ripjaw and Brain Stealer break the conventional line',
    age: 2,
    duration: 12,
    playerNames: ['Swollen Husk', 'Flenser', 'Ripjaw', 'Brain Stealer', 'Corrupted Field Surgeon']
  },
  {
    slug: '03-age-3-monster-host',
    title: 'AGE 3 — MONSTER HOST',
    subtitle: 'The human army is gone',
    age: 3,
    duration: 14,
    playerNames: ['Bloated Husk', 'Butcher', 'Ripjaw Alpha', 'Brood Nurse', 'Carrion Choir', 'Shrike', 'Monstrum', 'Carrion Widow']
  },
  {
    slug: '04-age-4-apex-roster',
    title: 'AGE 4 — APEX CARNAGE',
    subtitle: 'Bleeding engines, execution beasts and demonic warforms',
    age: 4,
    duration: 16,
    playerNames: ['Charnel Husk', 'Flensing Host', 'Skinrider', 'Mind Flayer', 'Charnel Engine', 'The Headsman', 'The Great Maw', 'Widow Queen', 'Flesh Wall']
  },
  {
    slug: '05-incarnation-of-slaughter',
    title: 'INCARNATION OF SLAUGHTER',
    subtitle: 'What rises where the host stood, versus the heaviest conventional line',
    age: 4,
    duration: 16,
    // BY ID, not by name. The lord is `hidden` and never on a roster — in a
    // real match it exists only because `Battlefield.possess` raised it. The
    // roster lookup the other scenes use would find the CARD instead, which is
    // a one-hitpoint payment that places nothing and would render empty ground.
    playerNames: [],
    playerIds: ['nk_incarnation_lord'],
    capstone: true
  }
]

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(RAW_DIR, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-frame-rate-limit']
})

const results = []

async function run(cmd, args) {
  const { stdout, stderr } = await execFileAsync(cmd, args, { maxBuffer: 16 * 1024 * 1024 })
  if (stdout.trim()) console.log(stdout.trim())
  if (stderr.trim()) console.log(stderr.trim())
}

async function renderScene(scene, index) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: RAW_DIR, size: { width: WIDTH, height: HEIGHT } }
  })
  const page = await context.newPage()
  const startedAt = Date.now()

  page.on('console', message => {
    const text = message.text()
    if (!text.includes('Phaser v')) console.log(`[browser:${message.type()}] ${text}`)
  })
  page.on('pageerror', error => console.error(`[browser:error] ${error.stack ?? error.message}`))

  await page.goto(`${BASE_URL}/?combatRender=${index + 1}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__gowGame && window.__gowStartSeeded), null, { timeout: 30_000 })
  await page.evaluate(seed => window.__gowStartSeeded('skirmish', 'veteran', seed, true), 41_000 + index * 137)
  await page.waitForFunction(() => {
    const battle = window.__gowGame?.scene?.getScene('BattleScene')
    return Boolean(battle?.scene?.isActive() && battle.battlefield?.player && battle.battlefield?.enemy)
  }, null, { timeout: 30_000 })

  const setup = await page.evaluate(({ spec }) => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
    const hud = game.scene.getScene('HUDScene')
    const field = battle.battlefield
    const player = field.player
    const enemy = field.enemy

    const prepare = army => {
      army.gold = 9_000_000
      army.research = 9_000_000
      army.deeds.kills = 9999
      army.population = -100_000
      army.buildSlots = 32
      army.reserveMode = 'rush'
    }
    prepare(player)
    prepare(enemy)

    while (player.age < spec.age) {
      player.gold = 9_000_000
      player.xp = player.xpToAdvance
      field.evolve('player')
    }
    while (enemy.age < spec.age) {
      enemy.gold = 9_000_000
      enemy.xp = enemy.xpToAdvance
      field.evolve('enemy')
    }

    const carnage = window.__gowTechs
      .filter(tech => tech.branch === 'carnage' && tech.age <= spec.age)
      .sort((a, b) => a.ring - b.ring || a.row - b.row)
    for (const tech of carnage) {
      player.techs.add(tech.id)
      if (tech.unlocks) player.unlocked.add(tech.unlocks)
    }
    if (spec.age === 4) player.ascendedTo = 'nekrotics'

    const selectedPlayer = spec.playerNames
      .map(name => player.roster.find(def => def.name === name))
      .filter(Boolean)

    const enemyPool = [...enemy.roster]
      .filter(def => def.layer === 'ground' || def.hitsAir)
      .sort((a, b) => (b.height + b.hp / 150) - (a.height + a.hp / 150))

    let selectedEnemy
    if (spec.capstone) {
      const titan = enemyPool.find(def => /titan/i.test(def.name))
      const supports = enemyPool.filter(def => def !== titan).slice(0, 3)
      selectedEnemy = titan ? [titan, ...supports] : enemyPool.slice(0, 4)
    } else {
      const wanted = Math.max(5, Math.min(9, selectedPlayer.length + 1))
      selectedEnemy = enemyPool.slice(0, wanted)
    }

    const lanes = [2, 1, 3, 0, 4, 2, 1, 3, 0, 4]
    selectedPlayer.forEach((def, i) => player.enqueue(def.id, lanes[i % lanes.length]))
    // `enqueue` resolves through ALL_UNITS_BY_ID rather than the roster, so a
    // hidden body can be staged for a render without being purchasable.
    const staged = spec.playerIds ?? []
    staged.forEach((id, i) => player.enqueue(id, lanes[(selectedPlayer.length + i) % lanes.length]))
    selectedEnemy.forEach((def, i) => enemy.enqueue(def.id, lanes[i % lanes.length]))

    battle.paused = false
    hud.scene.setVisible(false)

    return {
      playerNames: [...selectedPlayer.map(def => def.name), ...staged],
      enemyNames: selectedEnemy.map(def => def.name),
      worldWidth: field.config.worldWidth
    }
  }, { spec: scene })

  await page.waitForTimeout(2600)

  const staged = await page.evaluate(({ spec }) => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
    const field = battle.battlefield
    battle.paused = true

    const players = field.units.filter(unit => unit.faction === 'player' && unit.alive && spec.playerNames.includes(unit.def.name))
    const enemies = field.units.filter(unit => unit.faction === 'enemy' && unit.alive)
    const center = field.config.worldWidth / 2
    const laneOffsets = [-78, -38, 0, 38, 78]

    const place = (unit, x, lane, facing) => {
      unit.setLane(lane)
      unit.x = x
      unit.y = unit.def.layer === 'air' ? field.airY - 36 : unit.groundLine
      unit.facing = facing
      unit.dir = facing
      unit.state = 'advance'
      unit.container?.setPosition(unit.x, unit.y)
      unit.container?.setVisible(true)
      unit.shadow?.setPosition(unit.x, unit.groundLine + 2)
      unit.teamRing?.setPosition(unit.x, unit.groundLine + 1)
      unit.conductMark?.setPosition(unit.x + facing * (unit.radius + 7), unit.groundLine + 1)
      unit.flushVisual?.()
    }

    players.forEach((unit, i) => {
      const lane = i % 5
      const rank = Math.floor(i / 5)
      place(unit, center - 230 - rank * 72 - Math.abs(laneOffsets[lane]) * 0.15, lane, 1)
    })
    enemies.forEach((unit, i) => {
      const lane = i % 5
      const rank = Math.floor(i / 5)
      place(unit, center + 230 + rank * 72 + Math.abs(laneOffsets[lane]) * 0.15, lane, -1)
    })

    const camera = battle.cameras.main
    const zoom = spec.capstone ? 1.18 : spec.age >= 3 ? 1.08 : 1.16
    camera.setZoom(zoom)
    camera.setScroll(center - camera.width / (2 * zoom), -40)

    const accent = spec.age >= 4 ? 0xe1382f : spec.age === 3 ? 0xc9503b : 0xa86d43
    battle.add.rectangle(960, 56, 1260, 84, 0x05070b, 0.86)
      .setStrokeStyle(2, accent, 0.95)
      .setScrollFactor(0)
      .setDepth(200_000)
    battle.add.text(960, 19, spec.title, {
      fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
      fontSize: '38px',
      color: '#f5eee8',
      stroke: '#100506',
      strokeThickness: 7,
      letterSpacing: 2
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(200_001)
    battle.add.text(960, 66, spec.subtitle, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: '#e0b8a9',
      stroke: '#08090d',
      strokeThickness: 4
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(200_001)

    battle.add.text(38, 1020, 'REAL-TIME IN-ENGINE COMBAT · PROCEDURAL RIGS · NO CONCEPT ART', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#d6cdc5',
      stroke: '#050608',
      strokeThickness: 4
    }).setScrollFactor(0).setDepth(200_001)

    return { playerBodies: players.length, enemyBodies: enemies.length, zoom }
  }, { spec: scene })

  await page.waitForTimeout(900)
  const combatStartedAt = Date.now()
  await page.evaluate(() => {
    const battle = window.__gowGame.scene.getScene('BattleScene')
    battle.paused = false
  })
  await page.waitForTimeout(scene.duration * 1000)

  const video = page.video()
  await context.close()
  const rawPath = path.join(RAW_DIR, `${scene.slug}.webm`)
  await video.saveAs(rawPath)

  const trimStart = Math.max(0, (combatStartedAt - startedAt) / 1000 - 0.65)
  const outputPath = path.join(OUT_DIR, `${scene.slug}-1080p.mp4`)
  await run('ffmpeg', [
    '-y',
    '-ss', trimStart.toFixed(3),
    '-i', rawPath,
    '-t', String(scene.duration + 0.7),
    '-vf', `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '16',
    '-profile:v', 'high',
    '-level', '4.2',
    '-movflags', '+faststart',
    '-an',
    outputPath
  ])

  const { stdout: probe } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration',
    '-of', 'json',
    outputPath
  ])
  const metadata = JSON.parse(probe)
  results.push({
    ...scene,
    ...setup,
    ...staged,
    file: path.basename(outputPath),
    video: metadata.streams?.[0] ?? null
  })
  console.log(`Rendered ${outputPath}`)
}

try {
  for (let i = 0; i < scenes.length; i += 1) await renderScene(scenes[i], i)
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await rm(RAW_DIR, { recursive: true, force: true })
}
