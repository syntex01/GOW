/** Drive into the SHOOTING phase and capture target highlight + dice tray. */
import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = '/home/user/GOW/screenshots/uxaudit';
const DEVICE = process.env.DEVICE || 'desktop';
const P = DEVICE==='mobile'?{w:390,h:844,dpr:3,t:true}:{w:1440,h:900,dpr:1,t:false};
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: P.w, height: P.h }, deviceScaleFactor: P.dpr, isMobile: P.t, hasTouch: P.t });
const page = await ctx.newPage();
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
const log=(...a)=>console.log(`[${DEVICE}]`,...a);
const shot=(n)=>page.screenshot({path:`${OUT}/${DEVICE}-${n}.png`}).catch(()=>{});
const probe=()=>page.evaluate(()=>({prompt:document.querySelector('.actionbar .prompt')?.textContent?.trim()||null,phase:document.querySelector('.turn-center .pname')?.textContent?.trim()||null,banner:(()=>{const x=document.querySelector('.banner.show');return x?x.textContent.trim():null;})(),unit:document.querySelector('.unitpanel .uname')?.textContent?.trim()||null,badges:Array.from(document.querySelectorAll('.unitpanel .badge')).map(b=>b.textContent.trim()),dice:!!document.querySelector('.dicetray.show'),diceTitle:document.querySelector('.dicetray .dt-title')?.textContent?.trim()||null,diceTally:Array.from(document.querySelectorAll('.dicetray .dt-tally')).map(x=>x.textContent.trim())})).catch(()=>({}));
const click=async(x,y)=>{ if(P.t) await page.touchscreen.tap(x,y).catch(()=>{}); else await page.mouse.click(x,y).catch(()=>{}); await page.waitForTimeout(450); };
const next=async()=>{ await page.locator('.actionbar button.primary').first().click({timeout:4000}).catch(()=>{}); await page.waitForTimeout(900); };

await page.goto('file:///home/user/GOW/builds/GrimdarkTabletop.html',{waitUntil:'commit'});
await page.getByText(/deploy/i).first().waitFor({timeout:40000});
await page.locator('.deploy-btn').click();
await page.waitForSelector('canvas'); await page.waitForTimeout(4500);

// command -> movement -> shooting (no selection in between)
await next(); // movement
await next(); // shooting
log('SHOOTING', JSON.stringify(await probe()));
await shot('s-shoot-empty');

// Necron units along bottom: try several to find one with a target in range
const candidates = P.t ? [[180,470],[250,520],[300,500]] : [[605,555],[455,490],[700,600],[820,640],[335,445]];
let selectedOk=false;
for (const [x,y] of candidates){
  await click(x,y);
  const pr=await probe();
  log(`try shooter @${x},${y}`, JSON.stringify({unit:pr.unit,prompt:pr.prompt,banner:pr.banner}));
  if(pr.prompt && /Click a highlighted enemy/.test(pr.prompt)){ selectedOk=true; await shot('s-shoot-selected'); break; }
}
// capture target-highlight state regardless
await shot('s-shoot-targets');

// Enemy (Ultramarine) cluster top-right; click to shoot
const enemy = P.t?[300,360]:[1010,390];
await click(...enemy);
await page.waitForTimeout(900);
log('after enemy click', JSON.stringify(await probe()));
await shot('s-dice-1');
await page.waitForTimeout(900);
await shot('s-dice-2');
await page.waitForTimeout(1200);
await shot('s-dice-3');
await page.waitForTimeout(2500);
log('after dice', JSON.stringify(await probe()));
await shot('s-after');
log('ERRORS', JSON.stringify(errs.slice(0,6)));
await b.close(); process.exit(0);
