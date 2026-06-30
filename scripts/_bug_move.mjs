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

  // M1: charge math — place B at known gap within 12, check the engagement after success
  try {
    const e = mk(2); while(e.state.phase!=='charge') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    // isolate: move all other units away
    for (const u of Object.values(e.state.units)) { if (u!==a && u!==b) for (const m of u.models) m.position={x:1,y:1}; }
    // place b 4" gap straight above a
    const ac = geom.unitCentroid(a);
    for (const m of b.models) m.position = { x: ac.x, y: ac.y + 4 + 1 }; // ~4" gap
    geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
    const gapBefore = geom.unitGap(a,b);
    const tgts = e.chargeTargets(a).map(t=>t.name);
    // force a known roll by seeding many tries
    let succ=null;
    for (let i=0;i<1;i++){ succ = e.charge(a,b); }
    const gapAfter = geom.unitGap(a,b);
    const engaged = geom.inEngagementRange(a,b);
    r.push(`M1 charge: gapBefore=${gapBefore.toFixed(1)} targets=${JSON.stringify(tgts)} roll=${succ.roll} success=${succ.success} gapAfter=${gapAfter.toFixed(2)} engagedAfter=${engaged} :: ${succ.success && !engaged ? 'BUG: success but NOT engaged' : 'ok'}`);
  } catch(err){r.push('M1 ERR '+err.message);}

  // M1b: repeat many times to see if successful charges always end in engagement
  try {
    let bugCount=0, succCount=0, samples=0;
    for (let seed=1; seed<=40; seed++){
      const e = mk(seed); while(e.state.phase!=='charge') e.advancePhase();
      const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
      const b = e.enemiesOf('A')[0];
      for (const u of Object.values(e.state.units)) { if (u!==a && u!==b) for (const m of u.models) m.position={x:1,y:1}; }
      const ac = geom.unitCentroid(a);
      const gapWanted = 3 + (seed%7); // vary 3..9
      for (const m of b.models) m.position = { x: ac.x, y: ac.y + gapWanted + 1 };
      geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
      const res = e.charge(a,b);
      samples++;
      if (res.success){ succCount++; if (!geom.inEngagementRange(a,b)) bugCount++; }
    }
    r.push(`M1b charge end-in-engagement over ${samples} samples: successes=${succCount} successesNOTengaged=${bugCount} :: ${bugCount>0?'BUG':'ok'}`);
  } catch(err){r.push('M1b ERR '+err.message);}

  // M2: fall back from combat moves out of engagement
  try {
    const e = mk(); e.advancePhase(); // movement
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    for (const u of Object.values(e.state.units)) { if (u!==a && u!==b) for (const m of u.models) m.position={x:1,y:1}; }
    const ac = geom.unitCentroid(a);
    for (const m of b.models) m.position = { x: ac.x, y: ac.y + 1 }; // ~touching
    geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
    const engBefore = geom.inEngagementRange(a,b);
    const mv = a.statline.move;
    // fall back a full move directly away (down)
    const ok = e.moveUnit(a, 'fallBack', { x: 0, y: -mv });
    const engAfter = geom.inEngagementRange(a,b);
    r.push(`M2 fallBack: engBefore=${engBefore} move=${mv} ok=${ok} engAfter=${engAfter} moveState=${a.moveState} :: ${ok && !engAfter ? 'ok' : (engBefore && !ok ? 'NOTE: could not fall back full move (maybe blocked)' : 'check')}`);
  } catch(err){r.push('M2 ERR '+err.message);}

  // M3: pile-in and consolidate move toward enemy
  try {
    const e = mk(); while(e.state.phase!=='fight') e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    const b = e.enemiesOf('A')[0];
    for (const u of Object.values(e.state.units)) { if (u!==a && u!==b) for (const m of u.models) m.position={x:1,y:1}; }
    const ac = geom.unitCentroid(a);
    for (const m of b.models) m.position = { x: ac.x, y: ac.y + 4 };
    geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
    const gap0 = geom.unitGap(a,b);
    const moved = e.pileIn(a.id);
    const gap1 = geom.unitGap(a,b);
    r.push(`M3 pileIn: gap ${gap0.toFixed(1)}->${gap1.toFixed(1)} moved=${moved.toFixed(1)} :: ${gap1<=gap0?'ok (closer)':'BUG (further)'}`);
  } catch(err){r.push('M3 ERR '+err.message);}

  // M4: moveUnit allowance edge — exactly at allowance should succeed
  try {
    const e = mk(); e.advancePhase();
    const a = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    for (const u of e.unitsOf('B')) for (const m of u.models) m.position={x:55,y:40};
    const allow = e.moveAllowance(a,'normal');
    const ok = e.moveUnit(a,'normal',{x: allow, y: 0});
    r.push(`M4 move exactly allowance(${allow}) succeeds: ${ok?'PASS':'FAIL'}`);
  } catch(err){r.push('M4 ERR '+err.message);}

  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
