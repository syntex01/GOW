import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const glb = [];
page.on('response', (r) => { if (r.url().includes('.glb')) glb.push(`${r.status()} ${r.url().split('/').pop()}`); });
const warns = [];
page.on('console', (m) => { if (/ModelRegistry|GLTF|glb|model/i.test(m.text())) warns.push(`[${m.type()}] ${m.text()}`); });

await page.goto(URL, { waitUntil: 'commit' });
await page.getByText(/deploy/i).first().waitFor({ timeout: 30000 });
await page.getByText(/deploy/i).first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(7000); // allow GLB load + clone + swap

// Deep zoom toward the bottom-left (player A / Necrons) cluster.
await page.mouse.move(800, 480);
for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(90); }
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/model-zoom.png` });

console.log('GLB_RESPONSES=' + JSON.stringify(glb));
console.log('MODEL_LOGS=' + JSON.stringify(warns.slice(0, 10)));
await browser.close();
