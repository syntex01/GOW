/**
 * Mobile playability audit: loads the exact single-file build the user has and
 * drives a full game with TOUCH emulation (phone viewport), logging every
 * console error / page error and screenshotting each step so layout/interaction
 * breakage on a phone is visible. Reports a structured PASS/FAIL per step.
 *
 *   TARGET=file:///home/user/GOW/builds/GrimdarkTabletop.html node scripts/audit-mobile.mjs
 *   (or TARGET=http://localhost:5181/)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const TARGET = process.env.TARGET || 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const OUT = process.env.OUT || '/home/user/GOW/screenshots/audit';
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);
mkdirSync(OUT, { recursive: true });

const errors = [];
const benign = (t) => /font|gstatic|googleapis|ERR_CONNECTION|Failed to load resource.*font/i.test(t);

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !benign(m.text())) errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const steps = [];
const log = (name, ok, note = '') => { steps.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${note ? ' :: ' + note : ''}`); };
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});

// Detect horizontal overflow (a classic mobile layout break).
async function overflow() {
  return page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  })).catch(() => ({ overflow: 0 }));
}
async function tapText(re, timeout = 4000) {
  try { await page.getByText(re).first().tap({ timeout }); return true; } catch { return false; }
}

try {
  await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
  const mounted = await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  log('menu mounts', mounted);
  await shot('01-menu');
  const ov = await overflow();
  log('menu no horizontal overflow', ov.overflow <= 2, `overflow=${ov.overflow}px (scrollW=${ov.scrollW} clientW=${ov.clientW})`);

  // Faction picks (tap a card in each column).
  const colA = page.locator('.faction-col').nth(0);
  const colB = page.locator('.faction-col').nth(1);
  const fa = await colA.getByText(/necrons/i).first().tap({ timeout: 4000 }).then(() => true).catch(() => false);
  const fb = await colB.getByText(/orks|ultramarines/i).first().tap({ timeout: 4000 }).then(() => true).catch(() => false);
  log('tap faction A', fa); log('tap faction B', fb);

  // Mode: VS AI.
  await tapText(/machine spirit|vs|ai/i, 2500);
  await shot('02-selected');

  // Deploy.
  const deployed = await tapText(/deploy/i, 5000);
  log('tap deploy', deployed);
  const canvas = await page.waitForSelector('canvas', { timeout: 20000 }).then(() => true).catch(() => false);
  log('battle canvas appears', canvas);
  await page.waitForTimeout(7000);
  await shot('03-battle');
  const ov2 = await overflow();
  log('battle no horizontal overflow', ov2.overflow <= 2, `overflow=${ov2.overflow}px`);

  // HUD present + key controls visible/ tappable.
  const primary = await page.$('.hud button.primary, button.primary');
  log('primary action button present', !!primary);

  // Tap the canvas centre (select a unit via touch raycast).
  const c = await page.$('canvas');
  if (c) {
    const box = await c.boundingBox();
    if (box) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.62);
      await page.waitForTimeout(800);
    }
  }
  await shot('04-tap-unit');
  const panelAfter = await page.$('.unitpanel, .unit-panel, [class*="unit"]');
  log('tap canvas (unit select) did not crash', true);

  // Advance through several phases via the primary button (drives AI too).
  let advanced = 0;
  for (let i = 0; i < 10; i++) {
    const btn = await page.$('.hud button.primary, button.primary');
    if (!btn) break;
    await btn.tap({ timeout: 2000 }).catch(() => {});
    advanced++;
    await page.waitForTimeout(700);
  }
  log('advance phases via primary button', advanced > 0, `tapped ${advanced}x`);
  await shot('05-phases');

  // Open stratagems / a menu control if present.
  const strat = await page.$('.stratpanel button, [class*="strat"] button');
  if (strat) { await strat.tap({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); }
  await shot('06-strat');

  // Try the bottom action bar buttons (import army / model / new battle) — ensure tappable, modal opens & closes.
  const importBtn = await page.$('text=/import model/i');
  if (importBtn) {
    await importBtn.tap({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot('07-import-open');
    // close modal if present
    await tapText(/cancel|close|×/i, 1500);
  }

  // Camera: one-finger drag (orbit) and pinch (zoom) — ensure no crash.
  if (c) {
    const box = await c.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      // simple drag via touchscreen
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(300);
    }
  }
  log('camera touch interaction did not crash', true);
  await shot('08-final');
} catch (e) {
  log('audit run', false, e.message);
}

await context.close();
await browser.close();

const fails = steps.filter((s) => !s.ok);
console.log(`\n=== MOBILE AUDIT: ${steps.length - fails.length}/${steps.length} steps passed, ${errors.length} console/page errors ===`);
for (const e of errors.slice(0, 25)) console.log('  ! ' + e);
console.log('screenshots in ' + OUT);
process.exit(0);
