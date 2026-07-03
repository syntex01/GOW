/** Phone-viewport smoke render: verify the low tier (no bloom composer, 1x DPR)
 *  renders the battlefield cleanly with no page errors. */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'commit', timeout: 30000 });
await p.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
// Verify the host room code generates (client-side), then start a hotseat battle
// so the menu hides and we can screenshot the actual low-tier battlefield.
try { await p.getByText(/^online$/i).first().click({ timeout: 3000 }); } catch {}
await p.waitForTimeout(500);
const code = await p.evaluate(() => document.querySelector('.rc-code')?.textContent || '(none)');
try { await p.getByText(/hotseat/i).first().click({ timeout: 3000 }); } catch {}
await p.waitForTimeout(300);
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas', { timeout: 20000 });
await p.waitForTimeout(6000);
await p.screenshot({ path: '/home/user/GOW/screenshots/visual/mobile.png' });
console.log(JSON.stringify({ roomCode: code, errors: errs.filter((e)=>!/font|gstatic|ERR_/.test(e)) }));
await b.close();
