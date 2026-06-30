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
  const mk = (s=3)=>{const e=new GameEngine(createGame({seed:s,players:{A:{name:'A',faction:'x'},B:{name:'B',faction:'y'}}},DATASHEETS,SAMPLE_ARMIES.necrons,SAMPLE_ARMIES.ultramarines));e.startGame();return e;};

  // E1: CP increments each command phase for active player
  try {
    const e = mk();
    const cp0 = e.state.players.A.commandPoints;
    // pass through a full round back to A command
    let g=0; while (!(e.state.activePlayer==='A' && e.state.phase==='command' && e.state.round===2) && g<30){ e.advancePhase(); g++; }
    const cp1 = e.state.players.A.commandPoints;
    r.push(`E1 CP gain: A start=${cp0} after one full round=${cp1} (each command +1) :: ${cp1>cp0?'PASS':'FAIL'}`);
  } catch(err){r.push('E1 ERR '+err.message);}

  // E2: shooting a dead (already-destroyed) unit
  try {
    const e = mk(); while(e.state.phase!=='shooting') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    for (const m of b.models){m.alive=false;m.wounds=0;}
    const inEnemies = e.enemiesOf('A').some(x=>x.id===b.id);
    const w = e.shootableWeapons(a,b);
    r.push(`E2 dead unit not in enemiesOf=${!inEnemies}, shootableWeapons=${w.length}: ${!inEnemies?'PASS':'FAIL'}`);
  } catch(err){r.push('E2 ERR '+err.message);}

  // E3: send to reserves only round 1; in round 2 blocked
  try {
    const e = mk();
    const u = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves && !u.leadingUnitId);
    e.state.round = 2;
    const res = e.sendToReserves(u.id);
    r.push(`E3 sendToReserves round 2 blocked: ok=${res.ok} msg='${res.message}': ${res.ok===false?'PASS':'FAIL'}`);
  } catch(err){r.push('E3 ERR '+err.message);}

  // E4: deep strike round 1 blocked
  try {
    const e = mk();
    const u = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves&&!u.leadingUnitId);
    e.sendToReserves(u.id);
    const res = e.deepStrikeArrive(u.id, {x:30,y:22});
    r.push(`E4 deepStrike round 1 blocked: ok=${res.ok} msg='${res.message}': ${res.ok===false?'PASS':'FAIL'}`);
  } catch(err){r.push('E4 ERR '+err.message);}

  // E5: winner draw when both wiped
  try {
    const e = mk();
    for (const pl of ['A','B']) for (const u of e.unitsOf(pl)) for (const m of u.models){m.alive=false;m.wounds=0;}
    r.push(`E5 both wiped => draw: ${e.winner()}: ${e.winner()==='draw'?'PASS':'FAIL'}`);
  } catch(err){r.push('E5 ERR '+err.message);}

  // E6: moveModel coherency — moving a model out of coherency reverts
  try {
    const e = mk(); e.advancePhase();
    const a = e.unitsOf('A').find(u=>geom.aliveModels(u).length>=3 && e.isAlive(u) && !u.inReserves);
    if (a){
      const m = geom.aliveModels(a)[0];
      const far = { x: m.position.x + a.statline.move, y: m.position.y };
      const ok = e.moveModel(a.id, m.id, far); // likely breaks coherency
      r.push(`E6 moveModel coherency: unit=${a.name} moveOk=${ok} coherent=${geom.isCoherent(a)}`);
    } else r.push('E6 SKIP no 3+ model unit');
  } catch(err){r.push('E6 ERR '+err.message);}

  // E7: applyMortalWounds removes models
  try {
    const e = mk();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const before = geom.aliveModels(a).length;
    e.applyMortalWounds(a, 5);
    r.push(`E7 mortal wounds: models ${before}->${geom.aliveModels(a).length} (applied 5)`);
  } catch(err){r.push('E7 ERR '+err.message);}

  // E8: overdue reserves destroyed at round 4 command
  try {
    const e = mk();
    const u = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves&&!u.leadingUnitId);
    e.sendToReserves(u.id);
    e.state.round = 4;
    e.startCommandPhase();
    r.push(`E8 overdue reserves destroyed at R4: aliveAfter=${e.isAlive(u)} inReserves=${u.inReserves}: ${!e.isAlive(u)?'PASS':'FAIL'}`);
  } catch(err){r.push('E8 ERR '+err.message);}

  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
