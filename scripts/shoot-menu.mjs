import { chromium } from 'playwright-core';

const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/menu.png` });

// Find and click the DEPLOY button to start a battle (default factions, vs AI).
const deploy = page.getByText(/deploy/i);
if (await deploy.count()) {
  await deploy.first().click();
  await page.waitForTimeout(6500); // scene + GLB models settle
  await page.screenshot({ path: `${OUT}/menu-deployed.png` });
  console.log('deployed OK');
} else {
  console.log('DEPLOY button not found');
}

console.log('CONSOLE_ERRORS=' + errors.length);
for (const e of errors.slice(0, 12)) console.log('  ! ' + e);
await browser.close();
