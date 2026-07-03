import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL, { waitUntil: 'commit' });
// Menu close-up (top hero + a faction card).
await page.getByText(/deploy/i).first().waitFor({ timeout: 30000 });
await page.screenshot({ path: `${OUT}/skin-menu.png`, clip: { x: 330, y: 270, width: 950, height: 560 } });
await page.getByText(/deploy/i).first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(5500);
await page.screenshot({ path: `${OUT}/skin-hud-full.png` });
// Close-ups of HUD chrome.
await page.screenshot({ path: `${OUT}/skin-playercard.png`, clip: { x: 8, y: 8, width: 460, height: 120 } });
await page.screenshot({ path: `${OUT}/skin-actionbar.png`, clip: { x: 380, y: 800, width: 840, height: 96 } });
await page.screenshot({ path: `${OUT}/skin-strat.png`, clip: { x: 1270, y: 470, width: 330, height: 380 } });
console.log('ERRORS=' + errors.filter((e) => !/ERR_CONNECTION_CLOSED|font|gstatic|googleapis/i.test(e)).length);
await browser.close();
