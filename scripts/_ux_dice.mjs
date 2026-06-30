/** Force a real combat to capture the dice tray: advance a unit up, then shoot. */
import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = '/home/user/GOW/screenshots/uxaudit';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const log=(...a)=>console.log('[dice]',...a);
const shot=(n)=>page.screenshot({path:`${OUT}/${n}.png`}).catch(()=>{});
const probe=()=>page.evaluate(()=>({prompt:document.querySelector('.actionbar .prompt')?.textContent?.trim()||null,phase:document.querySelector('.turn-center .pname')?.textContent?.trim()||null,banner:(()=>{const x=document.querySelector('.banner.show');return x?x.textContent.trim():null;})(),unit:document.querySelector('.unitpanel .uname')?.textContent?.trim()||null,dice:!!document.querySelector('.dicetray.show'),diceTitle:document.querySelector('.dicetray .dt-title')?.textContent?.trim()||null,diceLabel:document.querySelector('.dicetray .dt-label')?.textContent?.trim()||null,diceTally:document.querySelector('.dicetray .dt-tally')?.textContent?.trim()||null,skip:!!document.querySelector('.dicetray .dt-skip')})).catch(()=>({}));
const click=async(x,y)=>{ await page.mouse.click(x,y).catch(()=>{}); await page.waitForTimeout(450); };
const next=async()=>{ await page.locator('.actionbar button.primary').first().click({timeout:4000}).catch(()=>{}); await page.waitForTimeout(900); };

await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').click();
await page.waitForSelector('canvas'); await page.waitForTimeout(4500);
// turn AI off so the enemy stays put
await page.locator('.actionbar .actions button', { hasText: /AI:/ }).click(); await page.waitForTimeout(400);

await next(); // movement
// Pick the Immortals (mid-board ~455,490) and ADVANCE toward enemy top-right repeatedly
async function advanceUp(sx,sy){
  await click(sx,sy);
  const adv = page.locator('.actionbar .actions button', { hasText: /^Advance$/ });
  await adv.click({timeout:3000}).catch(()=>{});
  await page.waitForTimeout(400);
  // click a destination up-and-right toward enemy
  await click(sx+120, sy-120);
  await page.waitForTimeout(400);
}
// advance the front Necron units toward the Ultramarines a few times across re-selection
await advanceUp(605,555);
await advanceUp(700,500);
await advanceUp(820,470);
await shot('dice-pre-move');
log('after moves', JSON.stringify(await probe()));

await next(); // shooting
log('SHOOT', JSON.stringify(await probe()));
// try each forward unit, shoot nearest enemy
const shooters=[[820,360],[760,400],[700,440],[900,420],[1000,400]];
const enemies=[[1010,390],[870,350],[790,330],[950,400]];
let fired=false;
for(const [sx,sy] of shooters){
  await click(sx,sy);
  const p=await probe();
  if(p.unit && /Click a highlighted enemy/.test(p.prompt||'')){
    for(const [ex,ey] of enemies){
      await click(ex,ey);
      await page.waitForTimeout(700);
      const q=await probe();
      if(q.dice){ fired=true; log('DICE FIRED', JSON.stringify(q)); break; }
    }
  }
  if(fired) break;
}
if(fired){
  await shot('dice-tray-1');
  await page.waitForTimeout(900); log('dice mid', JSON.stringify(await probe())); await shot('dice-tray-2');
  await page.waitForTimeout(1100); await shot('dice-tray-3');
  await page.waitForTimeout(1400); await shot('dice-tray-4');
  await page.waitForTimeout(2500); log('dice end', JSON.stringify(await probe())); await shot('dice-after');
} else {
  log('NO DICE — could not get target in range'); await shot('dice-nofire');
}
await b.close(); process.exit(0);
