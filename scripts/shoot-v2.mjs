import { chromium } from 'playwright-core';

const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(6000); // env + GLB models + bloom settle

await page.screenshot({ path: `${OUT}/v2-board.png` });

// Trigger the dice tray demo and capture mid-animation.
await page.evaluate(() => window.__demoDice && window.__demoDice());
await page.waitForTimeout(1100);
await page.screenshot({ path: `${OUT}/v2-dice.png` });

console.log('CONSOLE_ERRORS=' + errors.length);
for (const e of errors.slice(0, 12)) console.log('  ! ' + e);
await browser.close();
