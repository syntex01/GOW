/** Reliable phase walk (AI off, deselect before advancing) capturing charge/fight + dead-tap. */
import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = '/home/user/GOW/screenshots/uxaudit';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const log=(...a)=>console.log('[final]',...a);
const shot=(n)=>page.screenshot({path:`${OUT}/${n}.png`}).catch(()=>{});
const probe=()=>page.evaluate(()=>({prompt:document.querySelector('.actionbar .prompt')?.textContent?.trim()||null,phase:document.querySelector('.turn-center .pname')?.textContent?.trim()||null,banner:(()=>{const x=document.querySelector('.banner.show');return x?x.textContent.trim():null;})(),unit:document.querySelector('.unitpanel .uname')?.textContent?.trim()||null,badges:Array.from(document.querySelectorAll('.unitpanel .badge')).map(b=>b.textContent.trim())})).catch(()=>({}));
const click=async(x,y)=>{ await page.mouse.click(x,y).catch(()=>{}); await page.waitForTimeout(450); };
async function next(){ // deselect via Escape-like: click empty corner, then primary
  await page.keyboard.press('Escape').catch(()=>{});
  await page.locator('.actionbar button.primary').first().click({timeout:4000}).catch(()=>{});
  await page.waitForTimeout(900);
}

await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').click();
await page.waitForSelector('canvas'); await page.waitForTimeout(4500);
await page.locator('.actionbar .actions button', { hasText: /AI:/ }).click(); await page.waitForTimeout(400);
log('AI', (await probe()).banner);

await next(); log('MOVE', JSON.stringify(await probe()));
// move a unit, then try to RE-select & act on it (dead tap test)
await click(455,490); // Immortals
log('MOVE sel', JSON.stringify(await probe()));
await click(430,520); // small legal move
log('MOVE moved', JSON.stringify(await probe()));
// re-tap same (now moved) unit -> can it be reselected? badges?
await click(430,520);
log('MOVE re-tap moved unit', JSON.stringify(await probe()));
await shot('f-move-retap');

await next(); log('SHOOT', JSON.stringify(await probe()));
// select shooter, observe targets; then click own unit (dead tap)
await click(455,490);
log('SHOOT sel', JSON.stringify(await probe()));
await shot('f-shoot-sel');
await click(335,445); // another own unit -> should reselect, not dead
log('SHOOT tap-other-own', JSON.stringify(await probe()));

await next(); log('CHARGE', JSON.stringify(await probe()));
await click(335,445);
log('CHARGE sel', JSON.stringify(await probe()));
await shot('f-charge-sel');

await next(); log('FIGHT', JSON.stringify(await probe()));
await click(335,445);
log('FIGHT sel', JSON.stringify(await probe()));
await shot('f-fight-sel');

await next(); log('END', JSON.stringify(await probe()));
await shot('f-end');
// advance to hand off turn — AI off so it's player B; observe prompt
await next(); log('AFTER END (turn handoff)', JSON.stringify(await probe()));
await shot('f-handoff');
await b.close(); process.exit(0);
