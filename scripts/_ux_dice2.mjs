/** Let AI play several rounds; snapshot the dice tray whenever it appears. */
import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = '/home/user/GOW/screenshots/uxaudit';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const log=(...a)=>console.log('[dice2]',...a);
const shot=(n)=>page.screenshot({path:`${OUT}/${n}.png`}).catch(()=>{});
const diceState=()=>page.evaluate(()=>{const d=document.querySelector('.dicetray');const shown=d&&d.classList.contains('show');return {shown,title:document.querySelector('.dicetray .dt-title')?.textContent?.trim()||null,label:document.querySelector('.dicetray .dt-label')?.textContent?.trim()||null,tally:document.querySelector('.dicetray .dt-tally')?.textContent?.trim()||null,dice:document.querySelectorAll('.dicetray .dt-die').length};}).catch(()=>({shown:false}));

await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').click();
await page.waitForSelector('canvas'); await page.waitForTimeout(4500);
// AI stays ON (default). Speed up dice would help but keep default.

let caps=0;
// Advance phases repeatedly; between each, poll quickly for the dice tray.
for(let step=0; step<60 && caps<5; step++){
  await page.locator('.actionbar button.primary').first().click({timeout:4000}).catch(()=>{});
  // poll for dice for up to ~6s
  for(let i=0;i<24;i++){
    const ds=await diceState();
    if(ds.shown && ds.dice>0){
      caps++;
      log('DICE', JSON.stringify(ds));
      await shot(`dicereal-${caps}-${ds.label||'x'}`);
      // grab a couple frames across steps
      await page.waitForTimeout(500);
      const ds2=await diceState();
      await shot(`dicereal-${caps}b`);
      log('  ->', JSON.stringify(ds2));
      break;
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
}
log('captured', caps);
await b.close(); process.exit(0);
