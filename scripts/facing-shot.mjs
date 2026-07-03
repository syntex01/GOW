/** Load facing.html on the vite dev server, wait for all model tiles, screenshot. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/scripts/facing.html';
const OUT = process.env.OUT || '/home/user/GOW/screenshots/facing';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 2000 }, deviceScaleFactor: 1 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'commit', timeout: 30000 });
try { await p.getByText(/^DONE/).waitFor({ timeout: 60000 }); } catch { }
await p.waitForTimeout(1500);
const path = `${OUT}/contact.png`;
await p.locator('#wrap').screenshot({ path });
console.log(JSON.stringify({ screenshot: path, errors: errs.slice(0, 5) }));
await b.close();
