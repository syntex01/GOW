import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = process.env.GOW_RENDER_URL ?? 'http://127.0.0.1:8080'
const OUT_DIR = path.resolve(process.env.GOW_RENDER_OUT ?? 'artifacts/carnage-renders')

await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark'
})
const page = await context.newPage()

page.on('console', message => console.log(`[browser:${message.type()}] ${message.text()}`))
page.on('pageerror', error => console.error(`[browser:error] ${error.stack ?? error.message}`))

async function boot(seed) {
  await page.goto(`${BASE_URL}/?render=${seed}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.__gowGame && window.__gowStartSeeded), null, { timeout: 30_000 })
  await page.evaluate(seedValue => {
    window.__gowStartSeeded('skirmish', 'veteran', seedValue, true)
  }, seed)
  await page.waitForFunction(() => {
    const game = window.__gowGame
    if (!game) return false
    const battle = game.scene.getScene('BattleScene')
    return Boolean(battle?.scene?.isActive() && battle.battlefield?.player)
  }, null, { timeout: 30_000 })
  await page.waitForTimeout(900)
}

async function configureCarnage(age, { ascended = false, frontier = false } = {}) {
  return page.evaluate(({ targetAge, shouldAscend, frontierOnly }) => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
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

    return army.roster.map(def => ({ id: def.id, name: def.name, age: def.age }))
  }, { targetAge: age, shouldAscend: ascended, frontierOnly: frontier })
}

async function spawnRoster(roster) {
  for (let i = 0; i < roster.length; i += 1) {
    await page.evaluate(({ unitId, lane }) => {
      const battle = window.__gowGame.scene.getScene('BattleScene')
      const army = battle.battlefield.player
      army.gold = 5_000_000
      army.population = -10_000
      army.enqueue(unitId, lane)
    }, { unitId: roster[i].id, lane: i % 5 })
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(700)
}

async function stageRoster(roster, age) {
  return page.evaluate(({ desired, ageIndex }) => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
    const hud = game.scene.getScene('HUDScene')
    const battlefield = battle.battlefield
    const all = battlefield.units.filter(unit => unit.faction === 'player' && unit.alive)
    const selected = []
    const used = new Set()

    for (const def of desired) {
      let unit = all.find(candidate => !used.has(candidate.id) && candidate.def.id === def.id)
      if (!unit) unit = all.find(candidate => !used.has(candidate.id) && candidate.def.name === def.name)
      if (!unit) continue
      used.add(unit.id)
      selected.push({ unit, def })
    }

    for (const unit of all) {
      if (!used.has(unit.id)) {
        unit.x = -20_000
        unit.container?.setVisible(false)
      }
    }

    const rows = selected.length > 5 ? 2 : 1
    const perRow = Math.ceil(selected.length / rows)
    const centerX = battlefield.config.worldWidth / 2
    const spacing = selected.length > 8 ? 185 : selected.length > 5 ? 210 : 220
    const laneForRow = rows === 1 ? [2] : [1, 3]

    selected.forEach(({ unit }, index) => {
      const row = Math.floor(index / perRow)
      const col = index % perRow
      const rowCount = Math.min(perRow, selected.length - row * perRow)
      unit.setLane(laneForRow[row])
      unit.x = centerX + (col - (rowCount - 1) / 2) * spacing
      unit.y = unit.groundLine
      unit.setStage(0)
      unit.container?.setVisible(true)
    })

    battle.cameras.main.setZoom(selected.length > 8 ? 0.92 : selected.length > 5 ? 1.04 : 1.18)
    const zoom = battle.cameras.main.zoom
    battle.cameras.main.setScroll(centerX - battle.cameras.main.width / (2 * zoom), 0)

    hud.scene.setVisible(false)

    const accent = 0xd83b35
    const header = battle.add.text(640, 32, `CARNAGE — AGE ${ageIndex}`, {
      fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
      fontSize: '32px',
      color: '#f2e8dc',
      stroke: '#170706',
      strokeThickness: 7,
      letterSpacing: 2
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100_000)

    const sub = battle.add.text(640, 70, 'Persistent replacement roster · in-engine sprites', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#d99791',
      stroke: '#090607',
      strokeThickness: 4
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100_000)

    const labels = selected.map(({ unit, def }) => {
      const y = unit.groundLine - Math.max(64, def.height * 0.8) - 34
      const plate = battle.add.rectangle(unit.x, y + 9, Math.max(112, def.name.length * 8.2), 28, 0x08090d, 0.86)
        .setStrokeStyle(1, accent, 0.9)
        .setDepth(99_998)
      const text = battle.add.text(unit.x, y, def.name.toUpperCase(), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#f6eee7',
        stroke: '#08090d',
        strokeThickness: 3
      }).setOrigin(0.5, 0).setDepth(99_999)
      return [plate, text]
    })

    battle.paused = true
    return {
      selected: selected.map(({ unit, def }) => ({ id: def.id, name: def.name, x: unit.x, lane: unit.lane })),
      decorations: [header, sub, ...labels.flat()].length
    }
  }, { desired: roster, ageIndex: age })
}

async function captureRoster(age) {
  await boot(9400 + age)
  const roster = await configureCarnage(age, { ascended: age === 4 })
  await spawnRoster(roster)
  const staged = await stageRoster(roster, age)
  console.log(`Age ${age}: ${staged.selected.map(unit => unit.name).join(', ')}`)
  await page.waitForTimeout(350)
  await page.screenshot({
    path: path.join(OUT_DIR, `carnage-age-${age}.png`),
    fullPage: true
  })
}

async function captureTechTree() {
  await boot(9917)
  await configureCarnage(4, { frontier: true })
  await page.evaluate(() => {
    const game = window.__gowGame
    const battle = game.scene.getScene('BattleScene')
    const army = battle.battlefield.player
    army.gold = 5_000_000
    army.research = 5_000_000
    army.deeds.kills = 999
    const hud = game.scene.getScene('HUDScene')
    hud.toggleTechTree()
  })
  await page.waitForTimeout(700)
  await page.screenshot({
    path: path.join(OUT_DIR, 'carnage-tech-tree.png'),
    fullPage: true
  })
}

try {
  for (const age of [1, 2, 3, 4]) await captureRoster(age)
  await captureTechTree()
} finally {
  await browser.close()
}
