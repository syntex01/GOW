import { chromium } from 'playwright-core';

const URL = 'http://localhost:5182/';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ARGS = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'];

const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console:'+m.text()); });
page.on('pageerror', e => errors.push('pageerror:'+e.message));
await page.goto(URL, { waitUntil: 'networkidle' });

// Run engine-level tests by importing modules from the dev server.
const result = await page.evaluate(async () => {
  const out = [];
  const log = (s) => out.push(s);
  const game = await import('/src/engine/game.ts');
  const factory = await import('/src/engine/factory.ts');
  const dataMod = await import('/src/engine/data/index.ts');
  const geom = await import('/src/engine/geometry.ts');
  const { GameEngine } = game;
  const { createGame } = factory;
  const { DATASHEETS, SAMPLE_ARMIES } = dataMod;

  function fresh(seed = 12345) {
    const cfg = { seed, players: { A: { name: 'A', faction: 'Necrons' }, B: { name: 'B', faction: 'Ultramarines' } } };
    const st = createGame(cfg, DATASHEETS, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines);
    return new GameEngine(st);
  }

  // ---- helpers
  const unitsA = (e) => e.unitsOf('A');
  const firstAliveA = (e) => unitsA(e).find(u => e.isAlive(u) && !u.inReserves);

  // TEST 1: moving too far should be rejected
  try {
    const e = fresh();
    e.startGame();
    e.advancePhase(); // command->movement
    const u = firstAliveA(e);
    const allow = e.moveAllowance(u, 'normal');
    const ok = e.moveUnit(u, 'normal', { x: allow + 5, y: 0 });
    log(`T1 move too far rejected: ${ok === false ? 'PASS' : 'FAIL (allowed '+(allow+5)+'" with allowance '+allow+')'}`);
  } catch (err) { log('T1 ERROR '+err.message); }

  // TEST 2: normal move while engaged should be rejected (must fall back)
  // Place A unit adjacent to a B unit.
  try {
    const e = fresh();
    e.startGame(); e.advancePhase();
    const a = firstAliveA(e);
    const b = e.enemiesOf('A')[0];
    // move A's models on top of B
    const bc = geom.unitCentroid(b);
    for (const m of a.models) m.position = { x: bc.x, y: bc.y };
    geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);
    const engaged = e.enemiesOf('A').some(en => geom.inEngagementRange(a, en));
    const ok = e.moveUnit(a, 'normal', { x: 0.2, y: 0 });
    log(`T2 normal move while engaged blocked (engaged=${engaged}): ${ok === false ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T2 ERROR '+err.message); }

  // TEST 3: advance roll applied to allowance
  try {
    const e = fresh();
    e.startGame(); e.advancePhase();
    const u = firstAliveA(e);
    const base = u.statline.move;
    const r = e.rollAdvance(u);
    const adv = e.moveAllowance(u, 'advance');
    log(`T3 advance allowance = move+roll: base=${base} roll=${r} adv=${adv} : ${adv === base + r ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T3 ERROR '+err.message); }

  // TEST 4: shoot twice should be blocked (canShoot false after shot)
  try {
    const e = fresh();
    e.startGame();
    // jump to shooting
    while (e.state.phase !== 'shooting') e.advancePhase();
    const a = firstAliveA(e);
    const b = e.enemiesOf('A')[0];
    // place in range with LoS: move B near A
    const ac = geom.unitCentroid(a);
    for (const m of b.models) m.position = { x: ac.x, y: ac.y - 6 };
    geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);
    const can1 = e.canShoot(a);
    e.shoot(a, b);
    const can2 = e.canShoot(a);
    log(`T4 shoot twice blocked: first canShoot=${can1}, hasShot=${a.hasShot}, second canShoot=${can2}: ${can2 === false ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T4 ERROR '+err.message); }

  // TEST 5: deep strike within 9" rejected, beyond allowed (round 2)
  try {
    const e = fresh();
    e.startGame();
    const u = firstAliveA(e);
    const r1 = e.sendToReserves(u.id);
    // advance to round 2 movement
    let guard = 0;
    while (!(e.state.round === 2 && e.state.phase === 'movement') && guard < 40) { e.advancePhase(); guard++; }
    // try to arrive on top of an enemy
    const enemy = e.enemiesOf('A')[0];
    const ec = geom.unitCentroid(enemy);
    const bad = e.deepStrikeArrive(u.id, { x: ec.x, y: ec.y });
    // try a far empty spot
    const good = e.deepStrikeArrive(u.id, { x: e.state.board.width/2, y: e.state.board.height/2 });
    log(`T5 deepstrike: round=${e.state.round} reserve.ok=${r1.ok} near-enemy rejected=${!bad.ok} ('${bad.message}') far ok=${good.ok}: ${(!bad.ok) ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T5 ERROR '+err.message); }

  // TEST 6: stratagem wrong-phase blocked
  try {
    const e = fresh();
    e.startGame(); // command phase
    const u = firstAliveA(e);
    // go_to_ground is a shooting-or-any phase? check phase gating with a clearly-phased one
    const res = e.activateStratagem('fire_overwatch', { unitId: u.id, targetUnitId: e.enemiesOf('A')[0].id });
    log(`T6 fire_overwatch phase: phase=${e.state.phase} ok=${res.ok} msg='${res.message}'`);
  } catch (err) { log('T6 ERROR '+err.message); }

  // TEST 7: insufficient CP blocked
  try {
    const e = fresh();
    e.startGame(); // gains 1 CP
    const u = firstAliveA(e);
    e.state.players.A.commandPoints = 0;
    const res = e.activateStratagem('command_reroll', { unitId: u.id });
    log(`T7 insufficient CP blocked: ok=${res.ok} msg='${res.message}': ${res.ok === false ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T7 ERROR '+err.message); }

  // TEST 8: win detection when one side wiped
  try {
    const e = fresh();
    e.startGame();
    for (const u of e.unitsOf('B')) for (const m of u.models) { m.alive = false; m.wounds = 0; }
    log(`T8 winner when B wiped: ${e.winner()} : ${e.winner() === 'A' ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T8 ERROR '+err.message); }

  // TEST 9: objective scoring caps & end-of-turn
  try {
    const e = fresh();
    e.startGame();
    // put an A unit on center objective
    const a = firstAliveA(e);
    const obj = e.state.objectives[0];
    for (const m of a.models) m.position = { x: obj.position.x, y: obj.position.y };
    geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);
    const before = e.state.players.A.victoryPoints;
    e.scoreEndOfTurn();
    const after = e.state.players.A.victoryPoints;
    log(`T9 objective scoring: before=${before} after=${after} (held should give 5/obj up to 15)`);
  } catch (err) { log('T9 ERROR '+err.message); }

  // TEST 10: charge out of range fails; in range succeeds & sets engagement
  try {
    const e = fresh();
    e.startGame();
    while (e.state.phase !== 'charge') e.advancePhase();
    const a = firstAliveA(e);
    const b = e.enemiesOf('A')[0];
    // place B exactly 5" away (within 12")
    const ac = geom.unitCentroid(a);
    for (const m of b.models) m.position = { x: ac.x, y: ac.y - 5 };
    geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);
    const tgts = e.chargeTargets(a);
    log(`T10 charge targets within 12": count=${tgts.length} gap=${geom.unitGap(a,b).toFixed(1)}`);
  } catch (err) { log('T10 ERROR '+err.message); }

  // TEST 11: fall back leaves combat and blocks shooting same turn
  try {
    const e = fresh();
    e.startGame(); e.advancePhase(); // movement
    const a = firstAliveA(e);
    const b = e.enemiesOf('A')[0];
    const bc = geom.unitCentroid(b);
    for (const m of a.models) m.position = { x: bc.x + 0.5, y: bc.y + 0.5 };
    geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);
    const eng = e.enemiesOf('A').some(en => geom.inEngagementRange(a, en));
    // fall back away
    const ok = e.moveUnit(a, 'fallBack', { x: 0, y: a.statline.move });
    const stillEng = e.enemiesOf('A').some(en => geom.inEngagementRange(a, en));
    log(`T11 fallBack: engagedBefore=${eng} moveOk=${ok} engagedAfter=${stillEng} moveState=${a.moveState} canShoot=${e.canShoot(a)}`);
  } catch (err) { log('T11 ERROR '+err.message); }

  // TEST 12: battle-shocked unit OC = 0
  try {
    const e = fresh();
    e.startGame();
    const a = firstAliveA(e);
    a.isBattleShocked = true;
    log(`T12 battleshock OC=0: ${geom.unitObjectiveControl(a)} : ${geom.unitObjectiveControl(a) === 0 ? 'PASS' : 'FAIL'}`);
  } catch (err) { log('T12 ERROR '+err.message); }

  return out;
});

console.log('=== ENGINE TESTS ===');
for (const r of result) console.log(r);
console.log('=== PAGE ERRORS ===');
for (const e of errors) console.log(e);
await browser.close();
