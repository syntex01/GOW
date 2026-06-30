import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(URL, { waitUntil: 'commit' });
const deploy = page.getByText(/deploy/i);
await deploy.first().waitFor({ timeout: 30000 });
await deploy.first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(5000);
// Open Import Model, type the bundled model URL, Apply.
const btn = page.getByText('Import Model ▾'); await btn.first().click();
await page.waitForTimeout(400);
await page.fill('#murl', 'models/necron.glb');
await page.getByText('Apply', { exact: true }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'screenshots/model-import.png' });
const realErrors = errors.filter((e) => !/ERR_CONNECTION_CLOSED|font|gstatic|googleapis/i.test(e));
console.log('REAL_ERRORS=' + realErrors.length);
for (const e of realErrors.slice(0, 8)) console.log('  ! ' + e);
await browser.close();
