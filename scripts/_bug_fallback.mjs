import { chromium } from 'playwright-core';
const URL = 'http://localhost:5182/';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ARGS = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'];
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await (await browser.newContext({ viewport:{width:1440,height:900} })).newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const r = [];
  const { GameEngine } = await import('/src/engine/game.ts');
  const { createGame } = await import('/src/engine/factory.ts');
  const { DATASHEETS, SAMPLE_ARMIES } = await import('/src/engine/data/index.ts');
  const geom = await import('/src/engine/geometry.ts');
  const mk = (seed=3) => { const e = new GameEngine(createGame({seed,players:{A:{name:'A',faction:'Necrons'},B:{name:'B',faction:'Ultramarines'}}}, DATASHEETS, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines)); e.startGame(); return e; };

  // Single-model vs single-model so collisions don't interfere.
  const e = mk(); e.advancePhase(); // movement
  const a = e.unitsOf('A').find(u=>u.startingModelCount===1 && e.isAlive(u) && !u.inReserves) || e.unitsOf('A')[0];
  const b = e.unitsOf('B').find(u=>u.startingModelCount===1 && e.isAlive(u)) || e.unitsOf('B')[0];
  // Move everyone else off to a corner spread out
  let cx=2;
  for (const u of Object.values(e.state.units)) { if (u!==a && u!==b) { for (const m of u.models){ m.position={x:cx,y:42}; cx+=1.5; } } }
  // Keep only first model of a and b for clarity
  for (let i=1;i<a.models.length;i++){ a.models[i].alive=false; a.models[i].wounds=0; }
  for (let i=1;i<b.models.length;i++){ b.models[i].alive=false; b.models[i].wounds=0; }
  a.startingModelCount=1; b.startingModelCount=1;
  // place them touching (gap ~0.2)
  a.models[0].position = { x: 30, y: 20 };
  b.models[0].position = { x: 30, y: 20 + a.models[0].baseRadius + b.models[0].baseRadius + 0.2 };
  const gap0 = geom.unitGap(a,b);
  const eng0 = geom.inEngagementRange(a,b);
  const mv = a.statline.move;
  r.push(`setup: gap0=${gap0.toFixed(2)} eng0=${eng0} move=${mv} aRadius=${a.models[0].baseRadius.toFixed(2)}`);
  // fall back full move directly away (negative y)
  const ok = e.moveUnit(a, 'fallBack', { x: 0, y: -mv });
  const gap1 = geom.unitGap(a,b);
  const eng1 = geom.inEngagementRange(a,b);
  r.push(`fallBack y=-${mv}: ok=${ok} gap1=${gap1.toFixed(2)} eng1=${eng1} moveState=${a.moveState}`);
  // try smaller partial fallback that still clears engagement (move 2")
  const e2 = mk(); e2.advancePhase();
  const a2 = e2.unitsOf('A')[0]; const b2 = e2.unitsOf('B')[0];
  for (const u of Object.values(e2.state.units)) { if (u!==a2 && u!==b2) { let yy=42; for (const m of u.models){ m.position={x:2,y:yy}; yy+=0; } } }
  for (let i=1;i<a2.models.length;i++){ a2.models[i].alive=false; }
  for (let i=1;i<b2.models.length;i++){ b2.models[i].alive=false; }
  a2.models[0].position={x:30,y:20};
  b2.models[0].position={x:30,y:20+a2.models[0].baseRadius+b2.models[0].baseRadius+0.2};
  const ok2 = e2.moveUnit(a2,'fallBack',{x:0,y:-3});
  r.push(`fallBack y=-3: ok=${ok2} gap=${geom.unitGap(a2,b2).toFixed(2)} eng=${geom.inEngagementRange(a2,b2)}`);
  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
