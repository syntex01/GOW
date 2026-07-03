/**
 * Records the in-engine AI-vs-AI cinematic as a trailer (webm).
 *
 * Flow: launch the software-rendered headless build, drive the menu into a
 * battle with two grimdark-fitting factions, let the scene settle, then call
 * the dev hook `window.__trailer()` (src/ui/Cinematic.ts) which directs a full
 * AI-vs-AI battle with camera framing, combat FX and title cards. The whole
 * page is screen-recorded via Playwright's recordVideo, so the recorded frames
 * ARE the finished film — no ffmpeg post-processing (the bundled ffmpeg lacks
 * the lavfi/drawtext filters anyway).
 *
 * Usage:
 *   URL=http://localhost:5173/ FA=necrons FB=chaos OUT=/home/user/GOW/screenshots \
 *     node scripts/trailer.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, renameSync } from 'node:fs';

const EXE =
  process.env.CHROME_EXE ||
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || '/home/user/GOW/screenshots';
const FA = process.env.FA || 'necrons';
const FB = process.env.FB || 'chaos';
const NAME = process.env.NAME || 'trailer';
const W = Number(process.env.W || 1920);
const H = Number(process.env.H || 1080);

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--no-proxy-server',
  ],
});

const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'commit', timeout: 20000 });
await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 });

// Pick the two requested factions (first column = A, second = B).
const re = (f) => new RegExp(f, 'i');
const colA = page.locator('.faction-col').nth(0);
const colB = page.locator('.faction-col').nth(1);
try { await colA.getByText(re(FA)).first().click({ timeout: 4000 }); } catch {}
try { await colB.getByText(re(FB)).first().click({ timeout: 4000 }); } catch {}
await page.waitForTimeout(300);

await page.getByText(/deploy/i).first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
// Let the environment / models / bloom settle before rolling.
await page.waitForTimeout(7000);

const hasTrailer = await page
  .evaluate(() => typeof window.__trailer === 'function')
  .catch(() => false);
if (!hasTrailer) {
  console.log('TRAILER FAIL — window.__trailer hook not present');
  await context.close();
  await browser.close();
  process.exit(1);
}

console.log('rolling…');
// Run the full cinematic to completion (it resolves when the finale fades out).
await page.evaluate(() => window.__trailer()).catch((e) => {
  console.log('trailer threw: ' + e.message);
});
await page.waitForTimeout(800);

const video = page.video();
await context.close(); // finalises the recording
await browser.close();

let saved = `${OUT}/${NAME}.webm`;
if (video) {
  const src = await video.path();
  try {
    renameSync(src, saved);
  } catch {
    saved = src;
  }
}

console.log(`TRAILER DONE — ${saved}`);
if (errors.length) {
  console.log(`(${errors.length} console error[s] during run)`);
  for (const e of errors.slice(0, 10)) console.log('  ! ' + e);
}
