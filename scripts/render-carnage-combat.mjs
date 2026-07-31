import { readFile, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const basePath = path.join(dir, 'render-carnage-combat-base.mjs')
const tempPath = path.join(dir, '.render-carnage-combat-clean.mjs')

let source = await readFile(basePath, 'utf8')
source = source.replace(", '--disable-frame-rate-limit'", '')
source = source.replace(
  '  const page = await context.newPage()\n  const startedAt = Date.now()',
  `  const page = await context.newPage()\n  try {\n    const overlay = await context.newCDPSession(page)\n    await Promise.allSettled([\n      overlay.send('Overlay.setShowPaintRects', { result: false }),\n      overlay.send('Overlay.setShowDebugBorders', { show: false }),\n      overlay.send('Overlay.setShowHitTestBorders', { show: false }),\n      overlay.send('Overlay.setShowFPSCounter', { show: false }),\n      overlay.send('Overlay.setShowScrollBottleneckRects', { show: false })\n    ])\n  } catch {}\n  await page.mouse.move(1910, 1070)\n  const startedAt = Date.now()`
)

await writeFile(tempPath, source, 'utf8')
try {
  await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`)
} finally {
  await rm(tempPath, { force: true })
}
