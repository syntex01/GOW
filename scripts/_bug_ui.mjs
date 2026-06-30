import { chromium } from 'playwright-core';
const URL = 'http://localhost:5182/';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ARGS = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'];

async function run(label, viewport, touch) {
  const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push('console:'+m.text()); });
  page.on('pageerror', e => errs.push('pageerror:'+e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  const log = [];

  // Deploy default battle (AI on B)
  await page.waitForSelector('.deploy-btn', { timeout: 10000 });
  await page.click('.deploy-btn');
  await page.waitForSelector('.hud .actionbar', { timeout: 10000 });
  await page.waitForTimeout(800);
  log.push(`[${label}] battle started, HUD present`);

  // Screenshot
  await page.screenshot({ path: `/home/user/GOW/screenshots/bughunt/${label}-start.png` });

  // Edge case: tap empty board area (canvas) with nothing selected
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + 30, box.y + 30); // top corner, likely empty
  await page.waitForTimeout(150);
  log.push(`[${label}] tapped empty board: no crash`);

  // Rapid taps
  for (let i=0;i<8;i++){ await page.mouse.click(box.x + 100 + i*20, box.y + 200); }
  await page.waitForTimeout(200);
  log.push(`[${label}] rapid taps done`);

  // Click "Next Phase" button repeatedly to walk through a full turn incl. AI turn
  const clickNext = async () => {
    const btn = await page.$('.actionbar .actions .btn.primary');
    if (btn) { await btn.click(); await page.waitForTimeout(400); }
  };
  // Read current phase text
  const phaseText = async () => page.$eval('.turn-center .phase', el => el.textContent.trim()).catch(()=> '?');
  log.push(`[${label}] phase: ${await phaseText()}`);
  for (let i=0;i<7;i++){ await clickNext(); }
  await page.waitForTimeout(1500); // let AI turn run
  log.push(`[${label}] after 7 Next: phase=${await phaseText()}`);
  const round = await page.$eval('.turn-center .round', el=>el.textContent.trim()).catch(()=>'?');
  log.push(`[${label}] round indicator: ${round}`);

  // Open drawers (mobile bottom sheets / desktop panels)
  for (const sel of ['Toggle datacard','Toggle stratagems','Toggle battle log']) {
    const b = await page.$(`button[aria-label="${sel}"]`);
    if (b){ await b.click(); await page.waitForTimeout(200); }
  }
  await page.screenshot({ path: `/home/user/GOW/screenshots/bughunt/${label}-drawers.png` });
  log.push(`[${label}] drawers toggled`);

  // Try a stratagem click in stratagems drawer (an enabled one if any)
  try {
    const stratBtn = await page.$('.stratpanel .strat:not([disabled])');
    if (stratBtn) { await stratBtn.click({ timeout: 2000 }); await page.waitForTimeout(300); log.push(`[${label}] clicked an enabled stratagem`); }
    else log.push(`[${label}] no enabled stratagem available right now`);
  } catch (e) { log.push(`[${label}] stratagem click skipped: ${e.message.split('\n')[0]}`); }
  // Close drawers so they don't intercept the action bar on mobile
  const bd = await page.$('.drawer-backdrop.show');
  if (bd) { await bd.click({ timeout: 2000 }).catch(()=>{}); await page.waitForTimeout(150); }

  // Play many turns fast to reach end, watch for errors / stuck
  let lastSig = '';
  for (let i=0;i<60;i++){
    const btn = await page.$('.actionbar .actions .btn.primary');
    if (!btn) { log.push(`[${label}] no Next button at iter ${i}`); break; }
    await btn.click({ timeout: 3000 }).catch(()=>{});
    await page.waitForTimeout(120);
    const victory = await page.$('.banner.victory');
    if (victory) { const t = await victory.textContent(); log.push(`[${label}] VICTORY banner: ${t}`); break; }
    const sig = (await page.$eval('.turn-center', el=>el.textContent.trim()).catch(()=>'?'));
    if (sig === lastSig && i>3) { log.push(`[${label}] STUCK at iter ${i}: ${sig}`); }
    lastSig = sig;
  }
  await page.screenshot({ path: `/home/user/GOW/screenshots/bughunt/${label}-end.png` });
  const finalRound = await page.$eval('.turn-center .round', el=>el.textContent.trim()).catch(()=>'?');
  log.push(`[${label}] final round: ${finalRound}`);

  await browser.close();
  return { log, errs };
}

const desktop = await run('desktop', { width: 1440, height: 900 }, false);
const mobile = await run('mobile', { width: 390, height: 844 }, true);
console.log('=== DESKTOP ==='); desktop.log.forEach(l=>console.log(l));
console.log('--- desktop errors ---'); [...new Set(desktop.errs)].forEach(e=>console.log(e));
console.log('=== MOBILE ==='); mobile.log.forEach(l=>console.log(l));
console.log('--- mobile errors ---'); [...new Set(mobile.errs)].forEach(e=>console.log(e));
