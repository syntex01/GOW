/**
 * UX audit driver v2 — clicks at known unit pixel coordinates (from screenshots)
 * and probes affordance state after each interaction. DEVICE=desktop|mobile.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const TARGET = process.env.TARGET || 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const DEVICE = process.env.DEVICE || 'desktop';
const OUT = '/home/user/GOW/screenshots/uxaudit';
mkdirSync(OUT, { recursive: true });

const P = DEVICE === 'mobile'
  ? { width: 390, height: 844, dpr: 3, isMobile: true, hasTouch: true }
  : { width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false };

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: P.width, height: P.height }, deviceScaleFactor: P.dpr,
  isMobile: P.isMobile, hasTouch: P.hasTouch,
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)));

const log = (...a) => console.log(`[${DEVICE}]`, ...a);
const shot = (n) => page.screenshot({ path: `${OUT}/${DEVICE}-${n}.png` }).catch(() => {});
const tap = async (loc) => { try { await loc.first().click({ timeout: 4000 }); return true; } catch { return false; } };

async function probe() {
  return page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent?.trim() || null;
    return {
      prompt: t('.actionbar .prompt'),
      banner: (() => { const b = document.querySelector('.banner.show'); return b ? b.textContent.trim() : null; })(),
      phase: t('.turn-center .pname'),
      actions: Array.from(document.querySelectorAll('.actionbar .actions button')).map((b) => b.textContent.trim()),
      moveActions: Array.from(document.querySelectorAll('.actionbar .actions button')).filter((b)=>/move|advance|fall back|remain/i.test(b.textContent)).map((b)=>b.textContent.trim()),
      unitPanelOpen: !!document.querySelector('.unitpanel.show'),
      unitName: t('.unitpanel .uname'),
      badges: Array.from(document.querySelectorAll('.unitpanel .badge')).map((b) => b.textContent.trim()),
    };
  }).catch(() => ({}));
}

// click at viewport pixel (already in CSS px)
async function click(x, y) {
  if (P.hasTouch) await page.touchscreen.tap(x, y).catch(() => {});
  else await page.mouse.click(x, y).catch(() => {});
  await page.waitForTimeout(450);
}
async function hover(x, y) { await page.mouse.move(x, y).catch(() => {}); await page.waitForTimeout(300); }
async function next() { await tap(page.locator('.actionbar button.primary')); await page.waitForTimeout(800); }

// Desktop unit pixel targets (from 1440x900 screenshots). Necron=player A (active).
const PX = P.isMobile ? {
  necronA: [180, 470], necronB: [250, 520], enemy: [300, 360], ground: [200, 380],
} : {
  necronA: [335, 445], necronB: [455, 490], necronC: [605, 555],
  enemy: [1010, 390], ground: [700, 470], far: [330, 250],
};

try {
  await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
  await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
  await tap(page.locator('.faction-col').nth(0).getByText(/necrons/i));
  await tap(page.locator('.faction-col').nth(1).getByText(/ultramarines/i));
  await tap(page.locator('.deploy-btn'));
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForTimeout(5000);

  // Turn AI OFF (button label "AI: On")
  await tap(page.locator('.actionbar .actions button', { hasText: /AI:/ }));
  await page.waitForTimeout(500);
  log('AI toggled, banner:', (await probe()).banner);

  // close stratagems panel if open (desktop it's a drawer toggle; ensure clean board)
  await shot('cmd-clean');

  // ===== COMMAND =====
  await click(...PX.necronA);
  log('COMMAND click-unit', JSON.stringify(await probe()));

  await next();
  // ===== MOVEMENT =====
  log('MOVE empty', JSON.stringify(await probe()));
  await click(...PX.necronA);
  const sel = await probe();
  log('MOVE selected', JSON.stringify(sel));
  await shot('move-selected');
  await hover(...PX.far);
  await shot('move-hover-far');
  await hover(...PX.necronB);
  await shot('move-hover-near');
  // illegal far move
  await click(...PX.far);
  log('MOVE after far-click', JSON.stringify(await probe()));
  await shot('move-after-farclick');
  // select + move legally
  await click(...PX.necronA);
  await click(...PX.ground);
  log('MOVE after legal move', JSON.stringify(await probe()));
  await shot('move-done');
  // reselect a unit that already moved
  await click(...PX.ground);
  log('MOVE reselect-moved', JSON.stringify(await probe()));
  await shot('move-reselect');

  await next();
  // ===== SHOOTING =====
  log('SHOOT empty', JSON.stringify(await probe()));
  await click(...PX.necronB);
  log('SHOOT selected', JSON.stringify(await probe()));
  await shot('shoot-selected');
  // click empty ground (dead tap test)
  await click(...PX.ground);
  log('SHOOT after ground-click', JSON.stringify(await probe()));
  // click enemy
  await click(...PX.enemy);
  await page.waitForTimeout(1200);
  await shot('shoot-dice');
  await page.waitForTimeout(3000);
  log('SHOOT after enemy-click', JSON.stringify(await probe()));
  await shot('shoot-after');
  // reselect a shooter that already shot
  await click(...PX.necronB);
  log('SHOOT reselect-after-shot', JSON.stringify(await probe()));
  await shot('shoot-reselect');
  // try a unit out of range
  await click(...PX.necronA);
  log('SHOOT distant-unit', JSON.stringify(await probe()));
  await shot('shoot-norange');

  await next();
  // ===== CHARGE =====
  log('CHARGE empty', JSON.stringify(await probe()));
  await click(...PX.necronC);
  log('CHARGE selected', JSON.stringify(await probe()));
  await shot('charge-selected');

  await next();
  // ===== FIGHT =====
  log('FIGHT empty', JSON.stringify(await probe()));
  await click(...PX.necronC);
  log('FIGHT selected', JSON.stringify(await probe()));
  await shot('fight-selected');

  await next();
  // ===== END =====
  log('END', JSON.stringify(await probe()));
  await shot('end');

  if (P.isMobile) {
    const cbtns = await page.$$('.cluster .cbtn');
    for (let i = 0; i < cbtns.length; i++) {
      await cbtns[i].tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      await shot(`drawer-${i}`);
      await cbtns[i].tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    // mobile: select a unit to see datacard drawer behavior
    await click(...PX.necronA);
    await shot('mobile-select');
  }
} catch (e) {
  log('ERROR', e.message?.slice(0, 200));
}
log('ERRORS', JSON.stringify(errors.slice(0, 8)));
await context.close().catch(() => {});
await browser.close().catch(() => {});
process.exit(0);
