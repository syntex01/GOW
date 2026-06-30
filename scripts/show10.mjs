import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'screenshots';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await p.goto(URL, { waitUntil: 'commit' });
await p.getByText(/deploy/i).first().waitFor({ timeout: 30000 });
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas', { timeout: 20000 });
await p.waitForTimeout(7000);
await p.evaluate(() => window.__frameBiggest && window.__frameBiggest());
await p.waitForTimeout(1800);
// Zoom tighter toward the framed squad (orbit target is the squad centre).
await p.mouse.move(800, 450);
for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(100); }
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/ten-figures.png` });
console.log('done');
await b.close();
