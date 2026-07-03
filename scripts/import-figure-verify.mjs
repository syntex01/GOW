/* Imports a REAL model (marine.glb) onto a unit via the in-app Import Model
 * flow and zooms in to confirm the unit visibly becomes that figure. */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';
const MODEL = process.env.MODEL || 'models/marine.glb';
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
const glb = [];
page.on('response', (r) => { if (r.url().includes('.glb')) glb.push(`${r.status()} ${r.url().split('/').pop()}`); });

await page.goto(URL, { waitUntil: 'commit' });
await page.getByText(/deploy/i).first().waitFor({ timeout: 30000 });
await page.getByText(/deploy/i).first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(6000);

// Select a friendly unit by clicking on the board (bottom area = player A line),
// then import a real model onto it.
await page.mouse.click(820, 560);
await page.waitForTimeout(400);
await page.getByText('Import Model ▾').first().click();
await page.waitForTimeout(400);
await page.fill('#murl', MODEL);
await page.getByText('Apply', { exact: true }).click();
await page.waitForTimeout(3500);

// Zoom toward the imported unit and screenshot.
await page.mouse.move(820, 520);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(90); }
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/import-real-figure.png` });

console.log('GLB=' + JSON.stringify(glb));
console.log('REAL_ERRORS=' + errors.filter((e) => !/ERR_CONNECTION_CLOSED|font|gstatic|googleapis/i.test(e)).length);
await browser.close();
