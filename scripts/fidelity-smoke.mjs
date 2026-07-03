/** End-to-end smoke: deploy, play the human's turn to the AI, answer/skip the
 *  reaction window, and confirm the AI turn resolves with no page errors.
 *  Exercises the new fight-alternation, secondaries, and reaction-window paths. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const OUT = '/home/user/GOW/screenshots/visual';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'commit', timeout: 30000 });
await p.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas', { timeout: 20000 });
await p.waitForTimeout(4000);

// A background clicker that dismisses any reaction modal that appears (skip),
// so the AI turn can proceed unattended.
let reactionsSeen = 0;
const clicker = setInterval(async () => {
  try {
    const skip = await p.$('#reactSkip');
    if (skip) { reactionsSeen++; await skip.click(); }
  } catch { /* modal removed mid-click */ }
}, 250);

// Advance through the human's whole turn so control passes to the AI. Each
// action phase needs two taps (the "units could still act" confirm), so tap
// generously; taps are ignored while the AI is thinking.
const next = () => p.getByText(/next phase|end turn/i).first();
for (let i = 0; i < 20; i++) {
  try { await next().click({ timeout: 2000 }); } catch { }
  await p.waitForTimeout(500);
}
// Let the AI turn play out (its reaction windows are auto-skipped above).
await p.waitForTimeout(12000);
clearInterval(clicker);

const round = await p.evaluate(() => document.querySelector('.round')?.textContent ?? '');
const vpTags = await p.$$eval('.stat-vp', (els) => els.map((e) => e.textContent?.trim()));
await p.screenshot({ path: `${OUT}/fidelity-smoke.png` });
const realErrs = errs.filter((e) => !/font|gstatic|ERR_|favicon/.test(e));
console.log(JSON.stringify({ round, vpTags, reactionsSeen, errors: realErrs }, null, 2));
await b.close();
process.exit(realErrs.length ? 1 : 0);
