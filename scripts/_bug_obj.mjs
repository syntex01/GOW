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
  const cfg = { seed: 7, players:{A:{name:'A',faction:'Necrons'},B:{name:'B',faction:'Ultramarines'}} };
  const e = new GameEngine(createGame(cfg, DATASHEETS, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines));
  e.startGame();
  // Move ALL B units far away so they hold nothing
  for (const u of e.unitsOf('B')) for (const m of u.models) m.position = { x: 2, y: 2 };
  // Put one A unit on center objective
  const a = e.unitsOf('A').find(u => e.isAlive(u) && !u.inReserves);
  const obj = e.state.objectives[0];
  for (const m of a.models) m.position = { x: obj.position.x, y: obj.position.y };
  geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);
  geom.computeObjectiveControl(e.state.objectives, e.state.units);
  const held = e.state.objectives.map(o => ({id:o.id, by:o.controlledBy}));
  r.push('objectives after placing 1 A unit on center + B far away:');
  r.push(JSON.stringify(held));
  const heldByA = e.state.objectives.filter(o=>o.controlledBy==='A').length;
  r.push('held by A = '+heldByA);
  e.scoreEndOfTurn();
  r.push('A victoryPoints after scoreEndOfTurn = '+e.state.players.A.victoryPoints+' (expected min(held,3)*5 = '+Math.min(heldByA,3)*5+')');

  // Now check: how many objectives does ONE unit at center actually sit within?
  const within = e.state.objectives.filter(o => geom.unitGapToPoint(a, o.position) <= o.radius + 1e-6).map(o=>o.id);
  r.push('center unit within range of objectives: '+JSON.stringify(within));
  r.push('objective positions: '+JSON.stringify(e.state.objectives.map(o=>({id:o.id,p:o.position,radius:o.radius}))));
  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
