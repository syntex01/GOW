/**
 * UX audit driver. Walks the game phase-by-phase, probing the renderer for
 * affordance state (selection, targets, overlays) and capturing annotated
 * screenshots. DEVICE=desktop|mobile.  TARGET defaults to dev server.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const TARGET = process.env.TARGET || 'http://localhost:5181/';
const DEVICE = process.env.DEVICE || 'desktop';
const OUT = '/home/user/GOW/screenshots/uxaudit';
mkdirSync(OUT, { recursive: true });

const PROFILE = DEVICE === 'mobile'
  ? { width: 390, height: 844, dpr: 3, isMobile: true, hasTouch: true }
  : { width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false };

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: PROFILE.width, height: PROFILE.height },
  deviceScaleFactor: PROFILE.dpr, isMobile: PROFILE.isMobile, hasTouch: PROFILE.hasTouch,
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));

const log = (...a) => console.log(`[${DEVICE}]`, ...a);
const shot = (name) => page.screenshot({ path: `${OUT}/${DEVICE}-${name}.png` }).catch(() => {});
const tap = async (loc) => { try { await loc.first().click({ timeout: 4000 }); return true; } catch { return false; } };
const txt = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() || null, sel).catch(() => null);

// expose engine + scene state via window hooks if available
async function probe() {
  return page.evaluate(() => {
    const out = {};
    const prompt = document.querySelector('.actionbar .prompt');
    out.prompt = prompt ? prompt.textContent.trim() : null;
    out.banner = (() => { const b = document.querySelector('.banner.show'); return b ? b.textContent.trim() : null; })();
    out.phase = document.querySelector('.turn-center .pname')?.textContent?.trim() || null;
    out.round = document.querySelector('.turn-center .round')?.textContent?.trim() || null;
    // action buttons (label + disabled + title)
    out.actions = Array.from(document.querySelectorAll('.actionbar .actions button')).map((b) => ({
      label: b.textContent.trim(), disabled: b.disabled, title: b.title || null,
    }));
    // unit panel badges
    out.badges = Array.from(document.querySelectorAll('.unitpanel .badge')).map((b) => b.textContent.trim());
    out.unitName = document.querySelector('.unitpanel .uname')?.textContent?.trim() || null;
    return out;
  }).catch(() => ({}));
}

async function canvasBox() { const c = await page.$('canvas'); return c ? c.boundingBox() : null; }
async function clickCanvas(fx, fy) {
  const b = await canvasBox(); if (!b) return;
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  if (PROFILE.hasTouch) await page.touchscreen.tap(x, y).catch(() => {});
  else await page.mouse.click(x, y).catch(() => {});
  await page.waitForTimeout(400);
}
async function hoverCanvas(fx, fy) {
  const b = await canvasBox(); if (!b) return;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy).catch(() => {});
  await page.waitForTimeout(300);
}
async function nextPhase() {
  await tap(page.locator('.actionbar button.primary'));
  await page.waitForTimeout(700);
}

try {
  await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
  await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
  await shot('00-menu');
  log('MENU', JSON.stringify({ deployVisible: true }));

  // pick factions (Necrons vs Ultramarines), hotseat so we can drive both sides
  await tap(page.locator('.faction-col').nth(0).getByText(/necrons/i));
  await tap(page.locator('.faction-col').nth(1).getByText(/ultramarines/i));
  // turn AI off to inspect both turns manually — leave default (hotseat)
  await tap(page.getByText(/^Deploy$/i).or(page.locator('.deploy-btn')));
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForTimeout(5000);

  // Turn AI off so we can drive both turns manually.
  await tap(page.locator('.actionbar button', { hasText: /^AI:/ }));
  await page.waitForTimeout(400);

  // ---- COMMAND ----
  log('COMMAND', JSON.stringify(await probe()));
  await shot('01-command');

  // try clicking a unit during command (should it do anything?)
  await clickCanvas(0.4, 0.75);
  await page.waitForTimeout(400);
  log('COMMAND after unit-click', JSON.stringify(await probe()));
  await shot('01b-command-unitclick');

  await nextPhase();

  // ---- MOVEMENT ----
  log('MOVEMENT empty', JSON.stringify(await probe()));
  await shot('02-movement-empty');
  // select a unit
  await clickCanvas(0.42, 0.78);
  log('MOVEMENT selected', JSON.stringify(await probe()));
  await shot('03-movement-selected');
  // hover far away to see range ring + measurement
  await hoverCanvas(0.42, 0.2);
  await shot('04-movement-hover-far');
  // hover near
  await hoverCanvas(0.45, 0.6);
  await shot('05-movement-hover-near');
  // attempt an illegal (too-far) move
  await clickCanvas(0.5, 0.05);
  log('MOVEMENT after far-click (illegal?)', JSON.stringify(await probe()));
  await shot('06-movement-illegal');
  // re-select + legal move
  await clickCanvas(0.42, 0.78);
  await clickCanvas(0.44, 0.6);
  log('MOVEMENT after move', JSON.stringify(await probe()));
  await shot('07-movement-moved');
  // try selecting the SAME unit again (already moved) - does anything indicate done?
  await clickCanvas(0.44, 0.6);
  log('MOVEMENT reselect moved unit', JSON.stringify(await probe()));
  await shot('08-movement-reselect');

  await nextPhase();

  // ---- SHOOTING ----
  log('SHOOTING empty', JSON.stringify(await probe()));
  await shot('09-shooting-empty');
  // select a shooter
  await clickCanvas(0.44, 0.6);
  log('SHOOTING selected', JSON.stringify(await probe()));
  await shot('10-shooting-selected');
  // try clicking empty ground (dead tap?)
  await clickCanvas(0.5, 0.4);
  log('SHOOTING after empty-ground click', JSON.stringify(await probe()));
  // click an enemy target if any highlighted (top of board ~ player B)
  await clickCanvas(0.5, 0.22);
  await page.waitForTimeout(1500);
  log('SHOOTING after target click', JSON.stringify(await probe()));
  await shot('11-shooting-dice');
  await page.waitForTimeout(2500);
  await shot('12-shooting-after');
  // re-click same shooter (already shot) - silent?
  await clickCanvas(0.44, 0.6);
  log('SHOOTING reselect after shot', JSON.stringify(await probe()));
  await shot('13-shooting-reselect');

  await nextPhase();

  // ---- CHARGE ----
  log('CHARGE empty', JSON.stringify(await probe()));
  await shot('14-charge-empty');
  await clickCanvas(0.44, 0.55);
  log('CHARGE selected', JSON.stringify(await probe()));
  await shot('15-charge-selected');

  await nextPhase();

  // ---- FIGHT ----
  log('FIGHT empty', JSON.stringify(await probe()));
  await shot('16-fight-empty');
  await clickCanvas(0.44, 0.5);
  log('FIGHT selected', JSON.stringify(await probe()));
  await shot('17-fight-selected');

  await nextPhase();
  // ---- END ----
  log('END', JSON.stringify(await probe()));
  await shot('18-end');

  // drawers (mobile especially)
  if (PROFILE.isMobile) {
    const cbtns = await page.$$('.cluster .cbtn');
    for (let i = 0; i < cbtns.length; i++) {
      await cbtns[i].tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      await shot(`drawer-${i}`);
      await cbtns[i].tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  } else {
    // open stratagems on desktop
    await tap(page.locator('.cluster .cbtn').nth(2));
    await page.waitForTimeout(500);
    await shot('strat-panel');
  }
} catch (e) {
  log('ERROR', e.message?.slice(0, 200));
}
log('CONSOLE ERRORS', JSON.stringify(errors.slice(0, 10)));
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
