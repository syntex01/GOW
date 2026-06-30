/** Mobile UX capture: phases, drawers, selection, datacard behaviour. */
import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = '/home/user/GOW/screenshots/uxaudit';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
const log=(...a)=>console.log('[mobile]',...a);
const shot=(n)=>page.screenshot({path:`${OUT}/mobile-${n}.png`}).catch(()=>{});
const probe=()=>page.evaluate(()=>({prompt:document.querySelector('.actionbar .prompt')?.textContent?.trim()||null,phase:document.querySelector('.turn-center .pname')?.textContent?.trim()||null,primary:document.querySelector('.actionbar button.primary')?.textContent?.trim()||null,actionsVisible:!!document.querySelector('.actionbar'),drawerOpen:document.querySelector('.drawer.open')?.className||null,unit:document.querySelector('.unitpanel .uname')?.textContent?.trim()||null})).catch(()=>({}));
const tapXY=async(x,y)=>{ await page.touchscreen.tap(x,y).catch(()=>{}); await page.waitForTimeout(450); };
const next=async()=>{ await page.locator('.actionbar button.primary').first().tap({timeout:4000}).catch(()=>{}); await page.waitForTimeout(900); };

await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').tap();
await page.waitForSelector('canvas'); await page.waitForTimeout(4500);

log('COMMAND', JSON.stringify(await probe()));
await shot('m-01-command');

// drawers
const cbtns = await page.$$('.cluster .cbtn');
log('cluster btns', cbtns.length);
for (let i=0;i<cbtns.length;i++){
  await cbtns[i].tap({timeout:2000}).catch(()=>{});
  await page.waitForTimeout(500);
  log(`drawer ${i}`, JSON.stringify(await probe()));
  await shot(`m-drawer-${i}`);
  await cbtns[i].tap({timeout:2000}).catch(()=>{});
  await page.waitForTimeout(300);
}

await next(); log('MOVE', JSON.stringify(await probe())); await shot('m-02-move');
// select a unit on the board (Necron bottom area)
await tapXY(160, 560); log('MOVE sel', JSON.stringify(await probe())); await shot('m-03-move-sel');
// see if datacard auto-opened as drawer or covers board
await next(); log('SHOOT', JSON.stringify(await probe())); await shot('m-04-shoot');
await tapXY(160, 540); log('SHOOT sel', JSON.stringify(await probe())); await shot('m-05-shoot-sel');
await next(); log('CHARGE', JSON.stringify(await probe())); await shot('m-06-charge');
await next(); log('FIGHT', JSON.stringify(await probe())); await shot('m-07-fight');
await next(); log('END', JSON.stringify(await probe())); await shot('m-08-end');
log('ERRORS', JSON.stringify(errs.slice(0,6)));
await b.close(); process.exit(0);
