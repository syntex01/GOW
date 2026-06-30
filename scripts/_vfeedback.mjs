import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const b=await chromium.launch({executablePath:EXE,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const p=await b.newPage({viewport:{width:1400,height:860},deviceScaleFactor:1.5});
await p.goto('http://localhost:5182/',{waitUntil:'commit'});
await p.getByText(/deploy/i).first().waitFor({timeout:40000});
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas',{timeout:20000}); await p.waitForTimeout(6000);
// Movement phase: advance once
await p.locator('button.primary').first().click(); await p.waitForTimeout(1500);
await p.screenshot({path:'/home/user/GOW/screenshots/feedback-movement.png'});
const prompt=await p.evaluate(()=>document.querySelector('.actionbar .prompt')?.textContent||'');
console.log('PROMPT:', prompt.slice(0,120));
await b.close();
