/*
 * Tests the army-list importer end-to-end in the browser and captures close-ups.
 * Flow: load menu -> Deploy -> open "Import Army" -> "Load sample" -> "Import &
 * deploy" -> zoom the camera in (wheel) -> screenshot full + cropped close-ups.
 * Env: URL, ROSTER (optional text to paste instead of the sample).
 */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';

const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'commit' });
const deploy = page.getByText(/deploy/i);
await deploy.first().waitFor({ timeout: 30000 });
await deploy.first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(5500);

// --- Import an army through the in-app modal ---
await page.getByText('Import Army ▾').first().click();
await page.waitForTimeout(400);
if (process.env.ROSTER) {
  await page.fill('#rosterText', process.env.ROSTER);
} else {
  const loadSample = page.getByText('Load sample');
  if (await loadSample.count()) await loadSample.first().click();
}
await page.getByText(/import .* deploy/i).first().click();
await page.waitForTimeout(5500);
await page.screenshot({ path: `${OUT}/import-deployed.png` });

// --- Zoom the camera in for close-ups (hand-rolled orbit uses wheel) ---
const cx = 800, cy = 480;
await page.mouse.move(cx, cy);
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(120); }
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/import-closeup-1.png` });

// Orbit a little and grab a second close-up.
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 220, cy + 40, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/import-closeup-2.png` });

const real = errors.filter((e) => !/ERR_CONNECTION_CLOSED|font|gstatic|googleapis/i.test(e));
console.log('REAL_ERRORS=' + real.length);
for (const e of real.slice(0, 10)) console.log('  ! ' + e);
await browser.close();
