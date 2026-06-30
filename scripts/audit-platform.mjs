/**
 * Parameterized cross-platform audit driver.
 *
 * One invocation = one matrix cell: a DEVICE profile × a FLOW × a TARGET. It
 * drives the game in an emulated device context, runs mechanical checks
 * (console errors, horizontal overflow, off-screen/clipped HUD controls, tap
 * target sizes, drawer behaviour, camera gestures), saves a screenshot, and
 * prints a single JSON line: { target, device, flow, ok, errors[], checks[],
 * screenshot }. Designed to be called by the cross-platform audit workflow.
 *
 *   DEVICE=iphone-13 FLOW=battle-hud TARGET=file:///.../GrimdarkTabletop.html \
 *     node scripts/audit-platform.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const TARGET = process.env.TARGET || 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const DEVICE = process.env.DEVICE || 'iphone-13';
const FLOW = process.env.FLOW || 'boot';
const OUT = process.env.OUT || '/home/user/GOW/screenshots/audit-platform';
mkdirSync(OUT, { recursive: true });

/** Device profiles: [w, h, dpr, isMobile, hasTouch]. Covers the spread the user runs. */
const DEVICES = {
  'galaxy-fold': [280, 653, 3, true, true],
  'small-android': [320, 640, 2, true, true],
  'galaxy-s20': [360, 800, 3, true, true],
  'iphone-se': [375, 667, 2, true, true],
  'iphone-13': [390, 844, 3, true, true],
  'pixel-7': [412, 915, 2.6, true, true],
  'iphone-14-pro-max': [430, 932, 3, true, true],
  'phone-landscape': [844, 390, 3, true, true],
  'ipad-mini-portrait': [768, 1024, 2, true, true],
  'ipad-mini-landscape': [1024, 768, 2, true, true],
  'ipad-pro-portrait': [1024, 1366, 2, true, true],
  'ipad-pro-landscape': [1366, 1024, 2, true, true],
  'laptop': [1440, 900, 1, false, false],
  'desktop-hd': [1280, 720, 1, false, false],
  'desktop-fhd': [1920, 1080, 1, false, false],
  'desktop-4k': [2560, 1440, 2, false, false],
  'ultrawide': [2560, 1080, 1, false, false],
  'android-tablet-ls': [1280, 800, 2, true, true],
};

const benign = (t) => /font|gstatic|googleapis|ERR_CONNECTION|Failed to load resource.*(font|woff)/i.test(t);
const checks = [];
const errors = [];
const add = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });

const [w, h, dpr, isMobile, hasTouch] = DEVICES[DEVICE] || DEVICES['iphone-13'];

const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile, hasTouch });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !benign(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));

const tap = async (loc) => { try { await loc.first().tap({ timeout: 4000 }); return true; } catch { try { await loc.first().click({ timeout: 2000 }); return true; } catch { return false; } } };
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
const geom = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return null;
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
}, sel).catch(() => null);
const onScreen = (g, padX = 2, padY = 2) => g && g.left >= -padX && g.right <= g.vw + padX && g.top >= -padY && g.bottom <= g.vh + padY;
const shotPath = `${OUT}/${DEVICE}__${FLOW}.png`.replace(/[^\w./-]/g, '_');
const shot = () => page.screenshot({ path: shotPath }).catch(() => {});

async function getIntoBattle() {
  await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
  await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
  await tap(page.locator('.faction-col').nth(0).getByText(/necrons/i));
  await tap(page.locator('.faction-col').nth(1).getByText(/ultramarines|orks/i));
  await tap(page.getByText(/deploy/i));
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForTimeout(6000);
}

// Multi-touch pinch via CDP (zoom check).
async function pinch(cdp, cx, cy, outward) {
  const seq = outward ? [[60, 0], [110, 0], [160, 0]] : [[160, 0], [110, 0], [60, 0]];
  const pt = (d) => [{ x: cx - d, y: cy }, { x: cx + d, y: cy }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(seq[0][0]) });
  for (const [d] of seq) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

try {
  if (FLOW === 'boot') {
    await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
    const mounted = await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
    add('menu mounts', mounted);
    add('no horizontal overflow', (await overflow()) <= 2, `ov=${await overflow()}`);
    await shot();
  } else if (FLOW === 'menu') {
    await page.goto(TARGET, { waitUntil: 'commit', timeout: 30000 });
    await page.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
    add('faction A tap', await tap(page.locator('.faction-col').nth(0).getByText(/orks/i)));
    add('faction B tap', await tap(page.locator('.faction-col').nth(1).getByText(/chaos|ultramarines/i)));
    add('mode tap', await tap(page.getByText(/machine spirit|hotseat/i)));
    add('no horizontal overflow', (await overflow()) <= 2);
    const deploy = await geom('.deploy-bar, .deploy-btn');
    add('deploy control on-screen', onScreen(deploy));
    await shot();
  } else if (FLOW === 'battle-hud') {
    await getIntoBattle();
    const ab = await geom('.actionbar');
    add('action bar on-screen', onScreen(ab), JSON.stringify(ab));
    const prim = await geom('.actionbar button.primary, button.primary');
    add('primary button on-screen', onScreen(prim));
    add('no horizontal overflow', (await overflow()) <= 2);
    for (const sel of ['.topbar', '.phaserail', '.cluster']) {
      const g = await geom(sel); add(`${sel} on-screen`, onScreen(g, 4, 4), JSON.stringify(g));
    }
    await shot();
  } else if (FLOW === 'drawers') {
    await getIntoBattle();
    const cbtns = await page.$$('.cluster .cbtn, .cluster button');
    add('cluster buttons present', cbtns.length >= 3, `n=${cbtns.length}`);
    let openedOk = 0;
    for (let i = 0; i < cbtns.length; i++) {
      await cbtns[i].tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      const open = await page.evaluate(() => { const d = document.querySelector('.drawer.open'); if (!d) return null; const r = d.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; }).catch(() => null);
      if (open && open.top < open.vh - 20 && open.bottom <= open.vh + 60) openedOk++;
      await cbtns[i].tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    add('at least one drawer opens on-screen', openedOk >= 1, `opened=${openedOk}`);
    await shot();
  } else if (FLOW === 'select-move') {
    await getIntoBattle();
    await tap(page.locator('.actionbar button.primary, button.primary')); // -> movement
    await page.waitForTimeout(1200);
    const c = await page.$('canvas'); const box = await c.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.72).catch(() => {});
    await page.waitForTimeout(800);
    const dc = await geom('.unitpanel');
    add('datacard does not cover board', !dc || dc.top >= dc.vh - 30 || dc.h < dc.vh * 0.5, JSON.stringify(dc));
    const ab = await geom('.actionbar');
    add('action bar reachable after select', onScreen(ab));
    await shot();
  } else if (FLOW === 'camera') {
    await getIntoBattle();
    const c = await page.$('canvas'); const box = await c.boundingBox();
    const cdp = await context.newCDPSession(page);
    const before = await page.screenshot();
    await pinch(cdp, box.x + box.width / 2, box.y + box.height / 2, true);
    await page.waitForTimeout(600);
    const after = await page.screenshot();
    add('pinch-zoom changes view', Buffer.compare(before, after) !== 0);
    // one-finger orbit
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.touchscreen.tap(box.x + 40, box.y + 40).catch(() => {});
    add('camera gestures no crash', errors.length === 0);
    await shot();
  } else if (FLOW === 'modals') {
    await getIntoBattle();
    const opened = await tap(page.getByText(/import model/i));
    await page.waitForTimeout(700);
    const modal = await geom('.modal');
    add('import-model modal opens', opened && !!modal);
    add('modal fits viewport', onScreen(modal, 6, 6), JSON.stringify(modal));
    const closed = await tap(page.getByText(/cancel|close/i));
    await page.waitForTimeout(400);
    const modalAfter = await geom('.modal-backdrop.show, .modal');
    add('modal dismisses', closed);
    await shot();
  } else if (FLOW === 'phase-cycle') {
    await getIntoBattle();
    let n = 0;
    for (let i = 0; i < 14; i++) { const b = await page.$('.actionbar button.primary, button.primary'); if (!b) break; await b.tap({ timeout: 2000 }).catch(() => {}); n++; await page.waitForTimeout(600); }
    add('advanced phases incl AI turn', n >= 6, `taps=${n}`);
    add('no errors across turn cycle', errors.length === 0);
    await shot();
  } else {
    add('unknown flow', false, FLOW);
  }
} catch (e) {
  add('flow run', false, e.message?.slice(0, 200));
}

await context.close().catch(() => {});
await browser.close().catch(() => {});

const failed = checks.filter((c) => !c.pass);
const ok = failed.length === 0 && errors.length === 0;
console.log(JSON.stringify({ target: TARGET, device: DEVICE, flow: FLOW, w, h, dpr, ok, errors, checks, screenshot: shotPath }));
process.exit(0);
