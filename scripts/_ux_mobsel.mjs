import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT='/home/user/GOW/screenshots/uxaudit';
const b=await chromium.launch({executablePath:EXE,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
const page=await ctx.newPage();
const probe=()=>page.evaluate(()=>({phase:document.querySelector('.turn-center .pname')?.textContent?.trim()||null,unit:document.querySelector('.unitpanel .uname')?.textContent?.trim()||null,unitPanelShow:!!document.querySelector('.unitpanel.show'),unitDrawerOpen:!!document.querySelector('.unitpanel.drawer.open'),prompt:document.querySelector('.actionbar .prompt')?.textContent?.trim()||null}));
await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').tap(); await page.waitForSelector('canvas'); await page.waitForTimeout(4500);
await page.locator('.actionbar .actions button',{hasText:/AI:/}).tap().catch(()=>{}); await page.waitForTimeout(400);
await page.getByRole('button',{name:'Next Phase ▸'}).tap(); await page.waitForTimeout(800); // movement
// select a Necron unit
for(const [x,y] of [[150,560],[200,600],[120,540],[250,620],[180,520]]){
  await page.touchscreen.tap(x,y); await page.waitForTimeout(500);
  const p=await probe();
  if(p.unit){ console.log('selected',JSON.stringify(p)); await page.screenshot({path:`${OUT}/mobile-select-state.png`}); break; }
  console.log('miss',x,y);
}
await b.close();
