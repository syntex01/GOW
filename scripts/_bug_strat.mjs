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
  const mk = (seed=3, listA, listB) => { const e = new GameEngine(createGame({seed,players:{A:{name:'A',faction:'a'},B:{name:'B',faction:'b'}}}, DATASHEETS, listA, listB)); e.startGame(); return e; };

  // S1: 'opponents-turn' stratagem (Go to Ground) usable on YOUR OWN turn (when not enforced)
  try {
    const e = mk(3, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines);
    while (e.state.phase !== 'shooting') e.advancePhase(); // your own shooting phase
    const inf = e.unitsOf('A').find(u => u.keywords.includes('INFANTRY') && e.isAlive(u) && !u.inReserves);
    e.state.players.A.commandPoints = 5;
    const res = e.activateStratagem('go_to_ground', { unitId: inf.id });
    r.push(`S1 Go to Ground on own turn (shooting phase): ok=${res.ok} goToGround=${inf.goToGround} :: ${res.ok ? 'NOTE: opponents-turn stratagem usable on own turn (when not enforced)' : 'blocked'}`);
  } catch(err){r.push('S1 ERR '+err.message);}

  // S2: counter-offensive in wrong phase blocked
  try {
    const e = mk(3, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines);
    // command phase
    const u = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    e.state.players.A.commandPoints = 5;
    const res = e.activateStratagem('counter_offensive', { unitId: u.id });
    r.push(`S2 counter_offensive in command phase: ok=${res.ok} msg='${res.message}' :: ${res.ok===false?'PASS (blocked)':'FAIL'}`);
  } catch(err){r.push('S2 ERR '+err.message);}

  // S3: command_reroll applies & is consumed
  try {
    const e = mk(3, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines);
    const u = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    e.state.players.A.commandPoints = 5;
    const cp0 = e.state.players.A.commandPoints;
    const res = e.activateStratagem('command_reroll', { unitId: u.id });
    r.push(`S3 command_reroll: ok=${res.ok} pendingReroll=${u.pendingRerollHits} cpSpent=${cp0 - e.state.players.A.commandPoints} :: ${u.pendingRerollHits && cp0-e.state.players.A.commandPoints===1?'PASS':'FAIL'}`);
  } catch(err){r.push('S3 ERR '+err.message);}

  // S4: grenade requires GRENADES keyword & range; test with orks (have GRENADES)
  try {
    const e = mk(3, SAMPLE_ARMIES.orks ?? SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines);
    const grn = e.unitsOf('A').find(u => u.keywords.includes('GRENADES') && e.isAlive(u) && !u.inReserves);
    if (!grn) { r.push('S4 SKIP no GRENADES unit (A faction='+e.state.players.A.faction+')'); }
    else {
      const tgt = e.enemiesOf('A')[0];
      const geom = await import('/src/engine/geometry.ts');
      const tc = geom.unitCentroid(tgt); const gc = geom.unitCentroid(grn);
      // move target within 8"
      for (const m of tgt.models) m.position = { x: gc.x, y: gc.y + 3 };
      geom.resolveCollisions(e.state.units,e.state.terrain,e.state.board);
      while (e.state.phase !== 'shooting') e.advancePhase();
      e.state.players.A.commandPoints = 5;
      const res = e.activateStratagem('grenade', { unitId: grn.id, targetUnitId: tgt.id });
      r.push(`S4 grenade: ok=${res.ok} msg='${res.message}'`);
    }
  } catch(err){r.push('S4 ERR '+err.message);}

  // S5: dark_pact requires CHAOS; sample armies non-chaos -> blocked
  try {
    const e = mk(3, SAMPLE_ARMIES.chaos ?? SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines);
    const u = e.unitsOf('A').find(u=>e.isAlive(u)&&!u.inReserves);
    e.state.players.A.commandPoints = 5;
    const res = e.activateStratagem('dark_pact', { unitId: u.id });
    r.push(`S5 dark_pact: faction=${e.state.players.A.faction} keywords=[${u.keywords.join(',')}] ok=${res.ok} msg='${res.message}'`);
  } catch(err){r.push('S5 ERR '+err.message);}

  // S6: available list of sample armies (keys)
  r.push('SAMPLE_ARMIES keys: ' + Object.keys(SAMPLE_ARMIES).join(', '));

  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
