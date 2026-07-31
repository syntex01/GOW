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
const FILTER = new Set((process.env.GOW_RENDER_FILTER ?? '').split('|').map(value => value.trim()).filter(Boolean))

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
      unit.setLane(2)
      unit.x = centerX + (index - (selected.length - 1) / 2) * span
      unit.y = desired.layer === 'air' ? unit.y : unit.groundLine
      unit.setStage(index * 2 - selected.length)
      unit.container?.setPosition(unit.x, unit.y + unit.stageY)
      unit.container?.setDepth(1_000_000 + index)
      unit.container?.setVisible(true)
      unit.shadow?.setVisible(false)
      unit.teamRing?.setVisible(false)
      unit.conductMark?.setVisible(false)
    })

    const targetPixels = desired.squad > 1 ? 330 : 430
    const zoom = Math.max(1.7, Math.min(5.2, targetPixels / Math.max(48, desired.height)))
    const focusY = selected.length > 0
      ? (desired.layer === 'air' ? selected[0].y : selected[0].groundLine - desired.height * 0.46)
      : field.config.groundY - desired.height * 0.46
    battle.cameras.main.setZoom(zoom)
    battle.cameras.main.setScroll(
      centerX - battle.cameras.main.width / (2 * zoom),
      focusY - battle.cameras.main.height / (2 * zoom)
    )
    hud.scene.setVisible(false)

    const accent = desired.name.includes('Brain') || desired.name.includes('Mind') || desired.name.includes('Brood')
      ? '#55b9ff'
      : desired.name.includes('Head') || desired.name.includes('Host') || desired.name.includes('Butcher') || desired.name.includes('Slaughter')
        ? '#ef4638'
        : '#e8dcc4'

    document.getElementById('carnage-render-overlay')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'carnage-render-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif;color:#f4ece4;text-align:center;'
    const header = document.createElement('div')
    header.style.cssText = `position:absolute;top:18px;left:50%;transform:translateX(-50%);min-width:720px;padding:12px 34px 10px;background:rgba(5,7,11,.86);border:2px solid ${accent};box-shadow:0 8px 30px rgba(0,0,0,.45);`
    const title = document.createElement('div')
    title.textContent = desired.name.toUpperCase()
    title.style.cssText = 'font-family:Impact,Haettenschweiler,Arial Black,sans-serif;font-size:31px;letter-spacing:2px;text-shadow:0 3px 0 #100506;'
    const meta = document.createElement('div')
    meta.textContent = `AGE ${ageIndex} · ${desired.role.toUpperCase()} · ${desired.squad > 1 ? `${desired.squad}-BODY HOST` : 'SINGLE BODY'}`
    meta.style.cssText = `font-size:13px;margin-top:4px;color:${accent};font-weight:700;letter-spacing:1px;`
    header.append(title, meta)
    const footer = document.createElement('div')
    footer.textContent = desired.description
    footer.style.cssText = 'position:absolute;left:50%;bottom:20px;transform:translateX(-50%);width:min(1040px,86vw);padding:10px 18px;background:rgba(5,7,11,.78);font-size:14px;line-height:1.35;text-shadow:0 2px 0 #050608;'
    overlay.append(header, footer)
    document.body.append(overlay)

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
    const targets = FILTER.size > 0 ? roster.filter(unit => FILTER.has(unit.name)) : roster
    for (let index = 0; index < targets.length; index += 1) await captureUnit(age, targets[index], index)
  }
  if (FILTER.size === 0) await captureTechTree()
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
} finally {
  await browser.close()
}
