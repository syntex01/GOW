import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:3, hasTouch:true, isMobile:true });
const p = await ctx.newPage();
await p.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit',timeout:30000});
await p.getByText(/deploy/i).first().waitFor({timeout:40000}).catch(()=>{});
await p.locator('.faction-col').nth(0).getByText(/necrons/i).first().tap().catch(()=>{});
await p.locator('.faction-col').nth(1).getByText(/orks|ultramarines/i).first().tap().catch(()=>{});
await p.getByText(/machine spirit|vs ai|\bai\b/i).first().tap().catch(()=>{});
await p.getByText(/deploy/i).first().tap().catch(()=>{});
await p.waitForSelector('canvas',{timeout:20000}).catch(()=>{});
await p.waitForTimeout(7000);
const r = await p.evaluate(() => {
  const out = {};
  out.mqMobile = matchMedia('(max-width:820px)').matches;
  out.innerWidth = innerWidth; out.innerHeight = innerHeight;
  const log = document.querySelector('.logpanel');
  if (log){ const cs=getComputedStyle(log); const rc=log.getBoundingClientRect();
    out.log = {hasOpen:log.classList.contains('open'), display:cs.display, transform:cs.transform.slice(0,30), pos:cs.position, x:Math.round(rc.x), y:Math.round(rc.y), w:Math.round(rc.width), h:Math.round(rc.height), visible: rc.height>0 && cs.display!=='none' && cs.visibility!=='hidden'}; }
  const ab = document.querySelector('.actionbar');
  if (ab){ const cs=getComputedStyle(ab); const rc=ab.getBoundingClientRect();
    out.actionbar = {flexDir:cs.flexDirection, left:cs.left, transform:cs.transform.slice(0,20), x:Math.round(rc.x), w:Math.round(rc.width), right:Math.round(rc.x+rc.width), overflowsLeft:rc.x<-1, overflowsRight:rc.x+rc.width>innerWidth+1};
    out.actionbarBtns = Array.from(ab.querySelectorAll('button')).map(x=>{const xr=x.getBoundingClientRect();return {t:(x.textContent||'').trim().slice(0,14),x:Math.round(xr.x),r:Math.round(xr.x+xr.width),clip:xr.x<-1||xr.x+xr.width>innerWidth+1};});
  }
  const dr = document.querySelectorAll('.drawer.open'); out.openDrawers = dr.length;
  return out;
});
console.log(JSON.stringify(r,null,2));
await ctx.close(); await b.close(); process.exit(0);
