import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const b=await chromium.launch({executablePath:EXE,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const phase=()=>page.evaluate(()=>document.querySelector('.turn-center .pname')?.textContent?.trim()||null);
const unit=()=>page.evaluate(()=>document.querySelector('.unitpanel .uname')?.textContent?.trim()||null);
await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').click();
await page.waitForSelector('canvas'); await page.waitForTimeout(4500);
await page.locator('.actionbar .actions button',{hasText:/AI:/}).click(); await page.waitForTimeout(400);
// to movement
await page.locator('.actionbar button.primary').click(); await page.waitForTimeout(800);
console.log('phase after 1 advance:', await phase());
// select unit
await page.mouse.click(455,490); await page.waitForTimeout(500);
console.log('selected unit:', await unit(), 'phase:', await phase());
// now click Next Phase WITH selection active
await page.locator('.actionbar button.primary').click({timeout:4000}).catch(e=>console.log('click err',e.message));
await page.waitForTimeout(900);
console.log('phase after Next-Phase-with-selection:', await phase(), 'unit:', await unit());
// click again
await page.locator('.actionbar button.primary').click({timeout:4000}).catch(()=>{});
await page.waitForTimeout(900);
console.log('phase after 2nd click:', await phase());
await b.close();
