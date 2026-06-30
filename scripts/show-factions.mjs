import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || '/home/user/GOW/screenshots';
const A = process.env.FA || 'chaos';
const B = process.env.FB || 'orks';
const NAME = process.env.NAME || 'factions';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await p.goto(URL, { waitUntil: 'commit' });
await p.getByText(/deploy/i).first().waitFor({ timeout: 30000 });
const colA = p.locator('.faction-col').nth(0);
const colB = p.locator('.faction-col').nth(1);
const re = (f) => new RegExp(f === 'chaos' ? 'chaos' : f, 'i');
try { await colA.getByText(re(A)).first().click({ timeout: 4000 }); } catch {}
try { await colB.getByText(re(B)).first().click({ timeout: 4000 }); } catch {}
await p.waitForTimeout(300);
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas', { timeout: 20000 });
await p.waitForTimeout(7000);
await p.evaluate(() => window.__frameBiggest && window.__frameBiggest());
await p.waitForTimeout(1800);
await p.mouse.move(800, 450);
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(100); }
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/${NAME}.png` });
console.log('done');
await b.close();
