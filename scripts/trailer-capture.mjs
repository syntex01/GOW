/**
 * Deterministic, frame-stepped trailer capture → smooth MP4.
 *
 * Unlike scripts/trailer.mjs (real-time recordVideo, which on a software GPU
 * captures only a few unique FPS), this drives the cinematic one FIXED virtual
 * timestep at a time and screenshots each frame, so the result is perfectly
 * smooth no matter how slow each render is. Frames are assembled at FPS with
 * the bundled full ffmpeg (H.264).
 *
 * Usage:
 *   URL=http://localhost:5173/ FA=necrons FB=chaos FPS=30 \
 *     OUT=/home/user/GOW/screenshots node scripts/trailer-capture.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path;

const EXE =
  process.env.CHROME_EXE ||
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || '/home/user/GOW/screenshots';
const FA = process.env.FA || 'necrons';
const FB = process.env.FB || 'chaos';
const NAME = process.env.NAME || 'trailer-smooth';
const FPS = Number(process.env.FPS || 30);
const W = Number(process.env.W || 1920);
const H = Number(process.env.H || 1080);
const MAX_FRAMES = Number(process.env.MAX_FRAMES || 3000);
const FRAMES_DIR = process.env.FRAMES_DIR || '/tmp/claude-0/capframes';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
rmSync(FRAMES_DIR, { recursive: true, force: true });
mkdirSync(FRAMES_DIR, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'commit', timeout: 20000 });
await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 });

const re = (f) => new RegExp(f, 'i');
try { await page.locator('.faction-col').nth(0).getByText(re(FA)).first().click({ timeout: 4000 }); } catch {}
try { await page.locator('.faction-col').nth(1).getByText(re(FB)).first().click({ timeout: 4000 }); } catch {}
await page.waitForTimeout(300);
await page.getByText(/deploy/i).first().click();
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(6000); // let models/env settle (does not affect output timing)

const hasCap = await page.evaluate(() => typeof window.__capInit === 'function').catch(() => false);
if (!hasCap) {
  console.log('CAPTURE FAIL — window.__capInit hook not present');
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => window.__capInit());
const dtMs = 1000 / FPS;
console.log(`capturing at ${FPS}fps (dt=${dtMs.toFixed(2)}ms)…`);

let i = 0;
for (; i < MAX_FRAMES; i++) {
  const done = await page.evaluate((d) => window.__capStep(d), dtMs);
  const name = String(i).padStart(5, '0');
  await page.screenshot({ path: `${FRAMES_DIR}/f${name}.png` });
  if (i % 60 === 0) console.log(`  frame ${i}${done ? ' (last)' : ''}`);
  if (done) {
    i++;
    break;
  }
}
console.log(`captured ${i} frames`);
await browser.close();

const frameCount = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).length;
if (frameCount < 2) {
  console.log('CAPTURE FAIL — too few frames');
  process.exit(1);
}

const outPath = `${OUT}/${NAME}.mp4`;
const args = [
  '-y',
  '-framerate', String(FPS),
  '-i', `${FRAMES_DIR}/f%05d.png`,
  '-c:v', 'libx264',
  '-profile:v', 'high',
  '-pix_fmt', 'yuv420p',
  '-preset', 'medium',
  '-crf', '20',
  '-movflags', '+faststart',
  outPath,
];
console.log('assembling MP4…');
const r = spawnSync(FFMPEG, args, { stdio: 'inherit' });
if (r.status !== 0) {
  console.log('CAPTURE FAIL — ffmpeg assembly error');
  process.exit(1);
}
console.log(`CAPTURE DONE — ${outPath} (${frameCount} frames @ ${FPS}fps)`);
if (errors.length) {
  console.log(`(${errors.length} page error[s])`);
  for (const e of errors.slice(0, 8)) console.log('  ! ' + e);
}
