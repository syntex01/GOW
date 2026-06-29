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
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(4500);

// Click the primary phase button to walk player A through all phases; the 6th
// click ends A's turn and hands off to the AI, which plays its whole turn.
for (let i = 0; i < 7; i++) {
  const primary = page.locator('.actionbar .btn.primary');
  if (await primary.count()) {
    await primary.first().click();
    await page.waitForTimeout(500);
  }
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/ai-turn.png` });

// Pull the visible battle-log text so we can confirm the AI acted.
const log = await page.locator('.logpanel').innerText().catch(() => '');
console.log('PAGEERRORS=' + errors.length);
console.log('--- battle log (tail) ---');
console.log(log.split('\n').slice(0, 24).join('\n'));
await browser.close();
