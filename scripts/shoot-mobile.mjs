import { chromium } from 'playwright-core';

const EXE =
  process.env.CHROME_EXE ||
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
// iPhone-ish portrait viewport.
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/mobile-01-board.png` });

// Open the stratagems drawer (the ⚔ cluster button) to show the bottom sheet.
const strat = page.locator('.cbtn', { hasText: '⚔' });
if (await strat.count()) {
  await strat.first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/mobile-02-stratagems.png` });
}

console.log('MOBILE_PAGEERRORS=' + errors.length);
for (const e of errors.slice(0, 10)) console.log('  ! ' + e);
await browser.close();
