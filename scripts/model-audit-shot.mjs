import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const EXE='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT='/home/user/GOW/screenshots/audit'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({executablePath:EXE,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p=await b.newPage({viewport:{width:1360,height:480},deviceScaleFactor:1});
const N=Number(process.env.N||29);
for(let i=0;i<N;i++){
  await p.goto(`http://localhost:5173/scripts/model-audit.html?i=${i}`,{waitUntil:'commit',timeout:30000});
  try{await p.getByText('DONE').waitFor({timeout:20000});}catch{}
  await p.waitForTimeout(400);
  const name=await p.evaluate(()=>document.getElementById('lbl').textContent);
  const slug=String(i).padStart(2,'0')+'-'+name.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  await p.locator('canvas').screenshot({path:`${OUT}/${slug}.png`});
}
console.log('rendered',N,'models to',OUT);
await b.close();
