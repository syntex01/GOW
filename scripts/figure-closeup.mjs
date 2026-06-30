import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'commit' });
await page.getByText(/deploy/i).first().waitFor({ timeout: 30000 });
await page.getByText(/deploy/i).first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(7000);

// Lower the camera pitch (drag up) to a near-eye-level view of the figures.
await page.mouse.move(800, 450);
await page.mouse.down();
await page.mouse.move(800, 250, { steps: 18 }); // pitch down toward horizon
await page.mouse.up();
await page.waitForTimeout(300);
// Moderate zoom in toward the board centre.
for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(90); }
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/figures.png` });
// A tight crop around the centre where models sit.
await page.screenshot({ path: `${OUT}/figures-crop.png`, clip: { x: 520, y: 280, width: 760, height: 460 } });
await browser.close();
console.log('done');
