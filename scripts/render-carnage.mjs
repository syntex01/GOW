import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = process.env.GOW_RENDER_URL ?? 'http://127.0.0.1:8080'
const OUT_DIR = path.resolve(process.env.GOW_RENDER_OUT ?? 'artifacts/carnage-renders')

await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader']
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  colorScheme: 'dark'
})
const page = await context.newPage()

page.on('console', message => console.log(`[browser:${message.type()}] ${message.text()}`))
page.on('pageerror', error => console.error(`[browser:error] ${error.stack ?? error.message}`))

const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function boot(seed) {
  await page.goto(`${BASE_URL}/?render=${seed}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__gowGame && window.__gowStartSeeded), null, { timeout: 30_000 })
  await page.evaluate(seedValue => window.__gowStartSeeded('skirmish', 'veteran', seedValue, true), seed)
  await page.waitForFunction(() => {
    const battle = window.__gowGame?.scene?.getScene('BattleScene')
    return Boolean(battle?.scene?.isActive() && battle.battlefield?.player)
  }, null, { timeout: 30_000 })
  await page.waitForTimeout(700)
}

async function configureCarnage(age, { ascended = false, frontier = false } = {}) {
  return page.evaluate(({ targetAge, shouldAscend, frontierOnly }) => {
    const battle = window.__gowGame.scene.getScene('BattleScene')
    const army = battle.battlefield.player
    army.gold = 5_000_000
    army.research = 5_000_000
    army.deeds.kills = 999
    army.population = -10_000
    army.buildSlots = 20
    army.reserveMode = 'rush'

    while (army.age < targetAge) {
      army.gold = 5_000_000
      army.xp = army.xpToAdvance
      battle.battlefield.evolve('player')
    }

    const carnage = window.__gowTechs
      .filter(tech => tech.branch === 'carnage' && tech.age <= targetAge)
      .sort((a, b) => a.ring - b.ring || a.row - b.row)

    for (const tech of carnage) {
      const shouldOwn = !frontierOnly || tech.age < targetAge || tech.id === 'butchery' || tech.id === 'death_throes'
      if (!shouldOwn) continue
      army.techs.add(tech.id)
      if (tech.unlocks) army.unlocked.add(tech.unlocks)
    }
    if (shouldAscend) army.ascendedTo = 'nekrotics'

    return army.roster.map(def => ({
      id: def.id,
      name: def.name,
      age: def.age,
      height: def.height,
      role: def.role,
      layer: def.layer,
      squad: def.squad ?? 1,
      description: def.description
    }))
  }, { targetAge: age, shouldAscend: ascended, frontierOnly: frontier })
}

async function spawnUnit(def) {
  await page.evaluate(({ unitId }) => {
    const battle = window.__gowGame.scene.getScene('BattleScene')
    const army = battle.battlefield.player
    army.gold = 5_000_000
    army.population = -10_000
    army.reserveMode = 'rush'
    army.enqueue(unitId, 2)
  }, { unitId: def.id })
  await page.waitForTimeout(550)
}

async function stageCloseup(def, age) {
  return page.evaluate(({ desired, ageIndex }) => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
    const hud = game.scene.getScene('HUDScene')
    const field = battle.battlefield
    const all = field.units.filter(unit => unit.faction === 'player' && unit.alive)
    const selected = all.filter(unit => unit.def.id === desired.id || unit.def.name === desired.name).slice(0, desired.squad)

    for (const unit of all) {
      const keep = selected.includes(unit)
      unit.container?.setVisible(keep)
      if (!keep) unit.x = -20_000
    }

    const centerX = field.config.worldWidth / 2
    const span = Math.max(42, desired.height * 0.58)
    selected.forEach((unit, index) => {
      unit.setLane(desired.layer === 'air' ? 2 : 2)
      unit.x = centerX + (index - (selected.length - 1) / 2) * span
      unit.y = desired.layer === 'air' ? unit.y : unit.groundLine
      unit.setStage(index * 2 - selected.length)
      unit.container?.setVisible(true)
    })

    const targetPixels = desired.squad > 1 ? 330 : 430
    const zoom = Math.max(1.7, Math.min(5.2, targetPixels / Math.max(48, desired.height)))
    battle.cameras.main.setZoom(zoom)
    battle.cameras.main.setScroll(centerX - battle.cameras.main.width / (2 * zoom), desired.layer === 'air' ? -70 : 0)
    hud.scene.setVisible(false)

    const accent = desired.name.includes('Brain') || desired.name.includes('Mind') || desired.name.includes('Brood')
      ? 0x55b9ff
      : desired.name.includes('Head') || desired.name.includes('Host') || desired.name.includes('Butcher') || desired.name.includes('Slaughter')
        ? 0xef4638
        : 0xe8dcc4

    battle.add.rectangle(640, 54, 820, 74, 0x05070b, 0.84)
      .setStrokeStyle(2, accent, 0.9)
      .setScrollFactor(0)
      .setDepth(100_000)
    battle.add.text(640, 24, desired.name.toUpperCase(), {
      fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
      fontSize: '30px',
      color: '#f4ece4',
      stroke: '#100506',
      strokeThickness: 6,
      letterSpacing: 2
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100_001)
    battle.add.text(640, 61, `AGE ${ageIndex} · ${desired.role.toUpperCase()} · ${desired.squad > 1 ? `${desired.squad}-BODY HOST` : 'SINGLE BODY'}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      color: `#${accent.toString(16).padStart(6, '0')}`,
      stroke: '#08090d',
      strokeThickness: 3
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100_001)
    battle.add.text(640, 662, desired.description, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#d9d1ca',
      stroke: '#050608',
      strokeThickness: 4,
      align: 'center',
      wordWrap: { width: 1040 }
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100_001)

    battle.paused = true
    return { count: selected.length, zoom }
  }, { desired: def, ageIndex: age })
}

const manifest = []

async function captureUnit(age, def, index) {
  await boot(20_000 + age * 100 + index)
  const roster = await configureCarnage(age, { ascended: age === 4 })
  const live = roster.find(unit => unit.id === def.id && unit.name === def.name) ?? def
  await spawnUnit(live)
  const staged = await stageCloseup(live, age)
  const dir = path.join(OUT_DIR, `age-${age}`)
  await mkdir(dir, { recursive: true })
  const filename = `${String(index + 1).padStart(2, '0')}-${slug(live.name)}.png`
  const output = path.join(dir, filename)
  await page.waitForTimeout(250)
  await page.screenshot({ path: output, fullPage: true })
  manifest.push({ age, ...live, filename: `age-${age}/${filename}`, renderedBodies: staged.count, zoom: staged.zoom })
  console.log(`Rendered Age ${age}: ${live.name} (${staged.count} body/bodies)`)
}

async function captureTechTree() {
  await boot(29_917)
  await configureCarnage(4, { frontier: true })
  await page.evaluate(() => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
    const army = battle.battlefield.player
    army.gold = 5_000_000
    army.research = 5_000_000
    army.deeds.kills = 999
    game.scene.getScene('HUDScene').toggleTechTree()
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT_DIR, 'carnage-tech-tree.png'), fullPage: true })
}

try {
  for (const age of [1, 2, 3, 4]) {
    await boot(19_000 + age)
    const roster = await configureCarnage(age, { ascended: age === 4 })
    for (let index = 0; index < roster.length; index += 1) await captureUnit(age, roster[index], index)
  }
  await captureTechTree()
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
} finally {
  await browser.close()
}
