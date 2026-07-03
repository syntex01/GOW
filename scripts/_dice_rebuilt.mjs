import { chromium } from 'playwright-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
const EXE='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const TARGET='file:///tmp/claude-0/-home-user-GOW/3c8f127f-4198-55fb-877d-faf50ab85666/scratchpad/Rebuilt.html';
const OUT='/home/user/GOW/screenshots/audit-combat'; const LOG=OUT+'/_dice_fixed.log';
mkdirSync(OUT,{recursive:true}); writeFileSync(LOG,'');
const note=(k,v)=>{const l='• '+k+' :: '+(typeof v==='object'?JSON.stringify(v):v);console.log(l);appendFileSync(LOG,l+'\n');};
const browser=await chromium.launch({executablePath:EXE,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true});
const page=await ctx.newPage();
let n=0; const shot=async s=>{const f=`${OUT}/fixed-${String(++n).padStart(2,'0')}-${s}.png`;await page.screenshot({path:f}).catch(()=>{});return f;};
const tap=(x,y)=>page.touchscreen.tap(x,y); const sleep=ms=>page.waitForTimeout(ms);
async function hud(){return page.evaluate(()=>{const t=s=>document.querySelector(s)?.textContent?.trim()||'';const dt=document.querySelector('.dicetray');return{phase:t('.turn-center .pname'),round:t('.turn-center .round'),selected:document.querySelector('.unitpanel.show .uname')?.textContent?.trim()||null,diceShown:dt?(getComputedStyle(dt).visibility!=='hidden'&&dt.classList.contains('show')):false};});}
async function cbox(){return (await page.$('canvas'))?.boundingBox();}
async function closeAll(){await page.evaluate(()=>{document.querySelector('.drawer-backdrop')?.click();document.querySelectorAll('.drawer-close').forEach(b=>b.click());});await sleep(120);}
async function nextPhase(){const b=await page.$('.actionbar button.primary');if(!b)return;await b.tap({timeout:2500}).catch(()=>{});await sleep(700);}
try{
  await page.goto(TARGET,{waitUntil:'commit',timeout:30000});
  await page.getByText(/deploy/i).first().waitFor({timeout:40000}).catch(()=>{});
  await page.locator('.faction-col').nth(0).getByText(/necrons/i).first().tap({timeout:4000}).catch(()=>{});
  await page.locator('.faction-col').nth(1).getByText(/orks|ultramarines/i).first().tap({timeout:4000}).catch(()=>{});
  await page.getByText(/machine spirit|vs ai|\bai\b/i).first().tap({timeout:2500}).catch(()=>{});
  await page.getByText(/deploy/i).first().tap({timeout:5000}).catch(()=>{});
  await page.waitForSelector('canvas',{timeout:20000}).catch(()=>{});
  await sleep(7000);
  for(let i=0;i<24;i++){const h=await hud();const rn=parseInt((h.round.match(/(\d+)/)||[])[1]||'1',10);if(rn>=3 && /shoot/i.test(h.phase))break;await nextPhase();await sleep(120);}
  for(let i=0;i<6 && !/shoot/i.test((await hud()).phase);i++) await nextPhase();
  await closeAll(); note('reached',(await hud()).round+' | '+(await hud()).phase); await shot('shoot-phase');
  const b=await cbox(); let fired=false;
  const ours=[[0.45,0.72],[0.6,0.68],[0.35,0.78],[0.55,0.62],[0.7,0.66],[0.4,0.74],[0.5,0.58],[0.65,0.78],[0.3,0.66]];
  const enemyBand=[0.5,0.42,0.58,0.34,0.28,0.62,0.22,0.46,0.38];
  for(const [fx,fy] of ours){
    await tap(b.x+b.width*fx,b.y+b.height*fy); await sleep(160);
    if(!(await hud()).selected) continue;
    await closeAll();
    for(const ey of enemyBand){ for(const ex of [0.4,0.55,0.7,0.85,0.3,0.5,0.6]){
      await tap(b.x+b.width*ex,b.y+b.height*ey); await sleep(130);
      if((await hud()).diceShown){fired=true;break;}
    } if(fired)break; }
    if(fired)break;
  }
  note('dice tray fired',fired);
  if(fired){
    await sleep(700); await shot('tray-open');
    note('tray bounds',await page.evaluate(()=>{const el=document.querySelector('.dt-tray');if(!el)return null;const r=el.getBoundingClientRect();const sk=document.querySelector('.dt-skip');const sr=sk?sk.getBoundingClientRect():null;return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),vw:innerWidth,vh:innerHeight,fullyOnScreen:r.x>=-1&&r.y>=-1&&r.x+r.width<=innerWidth+1&&r.y+r.height<=innerHeight+1,dice:document.querySelectorAll('.dt-die').length,title:document.querySelector('.dt-title')?.textContent,tally:document.querySelector('.dt-tally')?.textContent,skipOnScreen:sr?(sr.y+sr.height<=innerHeight+1&&sr.x>=-1):null};}));
    await sleep(500); await shot('tray-anim');
    for(let i=0;i<30 && (await hud()).diceShown;i++){await page.evaluate(()=>document.querySelector('.dt-tray')?.click());await sleep(220);}
    note('tray dismissed',!(await hud()).diceShown); await shot('tray-dismissed');
  } else await shot('no-fire');
}catch(e){note('FATAL',e.message);}
appendFileSync(LOG,'=== DONE ===\n'); await ctx.close(); await browser.close(); process.exit(0);
