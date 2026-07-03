/** Render one battle view for the graphics audit and screenshot it. Env: FA, FB,
 *  ORBIT (drag steps), ZOOM (wheel-in steps), NAME, URL (defaults to the offline
 *  single-file build so it survives restarts / needs no server). */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const OUT = process.env.OUT || '/home/user/GOW/screenshots/visual';
const FA = process.env.FA || 'necrons', FB = process.env.FB || 'ultramarines';
const ORBIT = Number(process.env.ORBIT || 0), ZOOM = Number(process.env.ZOOM || 2);
const NAME = process.env.NAME || `${FA}-${FB}-o${ORBIT}-z${ZOOM}`;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'commit', timeout: 30000 });
await p.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
const re = (f) => new RegExp(f, 'i');
try { await p.locator('.faction-col').nth(0).getByText(re(FA)).first().click({ timeout: 4000 }); } catch {}
try { await p.locator('.faction-col').nth(1).getByText(re(FB)).first().click({ timeout: 4000 }); } catch {}
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas', { timeout: 20000 }); await p.waitForTimeout(7000);
await p.mouse.move(800, 450);
if (ORBIT > 0) { await p.mouse.down(); for (let i=0;i<ORBIT;i++){ await p.mouse.move(800+i*18,450); await p.waitForTimeout(20);} await p.mouse.up(); }
for (let i=0;i<ZOOM;i++){ await p.mouse.wheel(0,-250); await p.waitForTimeout(120); }
await p.waitForTimeout(2500);
const path = `${OUT}/${NAME}.png`.replace(/[^\w./-]/g, '_');
await p.screenshot({ path });
console.log(JSON.stringify({ name: NAME, screenshot: path, errors: errs.filter((e)=>!/font|gstatic|ERR_/.test(e)).length }));
await b.close();
