import { chromium } from 'playwright-core';

const EXE =
  process.env.CHROME_EXE ||
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(5000); // let three.js settle + GLB models load + clone

await page.screenshot({ path: `${OUT}/01-deployment.png` });

// Advance to the Movement phase and screenshot the HUD state.
const next = page.getByText('Next Phase ▸');
if (await next.count()) {
  await next.first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02-movement.png` });
}

// Select a unit by clicking near player A's deployment row (bottom of board).
await page.mouse.click(800, 720);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-selected.png` });

console.log('CONSOLE_ERRORS=' + errors.length);
for (const e of errors.slice(0, 20)) console.log('  ! ' + e);

await browser.close();
