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
  const engage = (a,b,e) => { const bc = geom.unitCentroid(b); for (const m of a.models) m.position = { x: bc.x+0.4, y: bc.y+0.4 }; geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board); };

  // C1: fight twice blocked (hasFought)
  try {
    const e = mk(); while(e.state.phase!=='fight') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    engage(a,b,e);
    const cf1 = e.canFight(a,b);
    e.fight(a,b);
    const cf2 = e.canFight(a,b);
    r.push(`C1 fight twice blocked: canFight1=${cf1} hasFought=${a.hasFought} canFight2=${cf2}: ${cf2===false?'PASS':'FAIL'}`);
  } catch(err){r.push('C1 ERR '+err.message);}

  // C2: chargers fight first ordering
  try {
    const e = mk();
    // set up two engaged units, one charged
    while(e.state.phase!=='fight') e.advancePhase();
    const aUnits = e.unitsOf('A').filter(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    const a1 = aUnits[0], a2 = aUnits[1];
    engage(a1,b,e); engage(a2,b,e);
    a2.hasChargedThisTurn = true; // a2 charged
    const order = e.fightOrder().map(u=>u.id);
    const idxA2 = order.indexOf(a2.id);
    const idxA1 = order.indexOf(a1.id);
    r.push(`C2 charger first: a2(charged) idx=${idxA2} a1 idx=${idxA1}: ${(idxA2>=0 && (idxA1<0 || idxA2<idxA1))?'PASS':'FAIL'} order=${JSON.stringify(order.map(id=>e.state.units[id].name))}`);
  } catch(err){r.push('C2 ERR '+err.message);}

  // C3: protected leader cannot be shot
  try {
    const e = mk();
    // find a unit with attached leader
    const withLeader = Object.values(e.state.units).find(u=>u.attachedLeaderIds && u.attachedLeaderIds.length>0);
    if (!withLeader) { r.push('C3 SKIP: no attached leaders in sample armies'); }
    else {
      const leaderId = withLeader.attachedLeaderIds[0];
      const leader = e.state.units[leaderId];
      const prot = e.isProtectedLeader(leader);
      const targetable = e.targetableEnemiesOf(leader.ownerId==='A'?'B':'A').some(u=>u.id===leaderId);
      r.push(`C3 protected leader: leader=${leader.name} bodyguard=${withLeader.name} isProtected=${prot} appearsTargetable=${targetable}: ${prot && !targetable ?'PASS':'NOTE'}`);
    }
  } catch(err){r.push('C3 ERR '+err.message);}

  // C4: battle-shock: below half strength triggers test in command
  try {
    const e = mk(5);
    const a = e.unitsOf('A').find(u=>u.startingModelCount>=4 && e.isAlive(u));
    if (a) {
      // kill more than half the models
      const killN = Math.ceil(a.models.length/2)+1;
      for (let i=0;i<killN;i++){ a.models[i].alive=false; a.models[i].wounds=0; }
      const below = geom.isBelowHalfStrength(a);
      // run a fresh command phase for A: it's A's turn already. Force re-run.
      e.startCommandPhase();
      r.push(`C4 battleshock: unit=${a.name} startCount=${a.startingModelCount} aliveNow=${geom.aliveModels(a).length} belowHalf=${below} isBattleShocked=${a.isBattleShocked} (test ran=${below?'yes':'n/a'})`);
    } else r.push('C4 SKIP no 4+ model unit');
  } catch(err){r.push('C4 ERR '+err.message);}

  // C5: shooting out of range yields no shootable weapons
  try {
    const e = mk(); while(e.state.phase!=='shooting') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    // move b far away (corner)
    for (const m of b.models) m.position = { x: 58, y: 42 };
    for (const m of a.models) m.position = { x: 2, y: 2 };
    geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
    const w = e.shootableWeapons(a,b);
    const res = e.shoot(a,b); // should resolve 0 weapons
    r.push(`C5 out-of-range shoot: shootableWeapons=${w.length} shootResults=${res.length} gap=${geom.unitGap(a,b).toFixed(0)}: ${w.length===0?'PASS':'FAIL'}`);
  } catch(err){r.push('C5 ERR '+err.message);}

  // C6: advancing unit can only fire Assault weapons
  try {
    const e = mk(); while(e.state.phase!=='shooting') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    const ac = geom.unitCentroid(a); for (const m of b.models) m.position={x:ac.x,y:ac.y-8};
    geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
    a.moveState='advanced';
    const w = e.shootableWeapons(a,b);
    const assaultOnly = w.every(wp => wp.keywords.some(k=>k.t==='assault'));
    r.push(`C6 advanced shoots only Assault: weapons=${w.map(x=>x.name).join('|')||'none'} allAssault=${assaultOnly}: ${assaultOnly?'PASS':'FAIL'}`);
  } catch(err){r.push('C6 ERR '+err.message);}

  // C7: fell back cannot shoot
  try {
    const e = mk();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    a.moveState='fellBack';
    r.push(`C7 fellBack canShoot=${e.canShoot(a)}: ${e.canShoot(a)===false?'PASS':'FAIL'}`);
  } catch(err){r.push('C7 ERR '+err.message);}

  // C8: dead unit selection / fight resolution skips dead
  try {
    const e = mk(); while(e.state.phase!=='fight') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    for (const m of a.models){m.alive=false;m.wounds=0;}
    const order = e.fightOrder();
    const inOrder = order.some(u=>u.id===a.id);
    r.push(`C8 dead unit excluded from fightOrder: ${!inOrder?'PASS':'FAIL'}`);
  } catch(err){r.push('C8 ERR '+err.message);}

  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
