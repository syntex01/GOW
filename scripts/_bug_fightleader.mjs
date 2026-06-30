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
  const e = new GameEngine(createGame({seed:3,players:{A:{name:'A',faction:'x'},B:{name:'B',faction:'y'}}}, DATASHEETS, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines));
  e.startGame();
  while (e.state.phase!=='fight') e.advancePhase();

  const bguard = Object.values(e.state.units).find(u=>u.ownerId==='B' && u.attachedLeaderIds.length>0);
  const leader = e.state.units[bguard.attachedLeaderIds[0]];
  const attacker = e.unitsOf('A').find(u=>u.weapons.some(w=>w.kind==='melee') && e.isAlive(u) && !u.inReserves);

  // Engage attacker with the bodyguard (and thus the co-located leader)
  const bc = geom.unitCentroid(bguard);
  for (const m of attacker.models) m.position = { x: bc.x + 0.3, y: bc.y + 0.3 };
  geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);

  r.push(`leaderProtected=${e.isProtectedLeader(leader)} engaged(attacker,leader)=${geom.inEngagementRange(attacker,leader)} engaged(attacker,bodyguard)=${geom.inEngagementRange(attacker,bguard)}`);

  // Replicate HUD.selectForFight target set
  const fightTargets = e.enemiesOf('A').filter(en => geom.inEngagementRange(attacker, en)).map(en=>en.id);
  r.push(`HUD fight targets include protected leader? ${fightTargets.includes(leader.id)} (targets: ${fightTargets.map(id=>e.state.units[id].name).join(', ')})`);

  // Does canFight allow fighting the protected leader directly?
  const cf = e.canFight(attacker, leader);
  const leaderWoundsBefore = geom.aliveModels(leader).reduce((a,m)=>a+m.wounds,0);
  if (cf) {
    const res = e.fight(attacker, leader);
    const leaderWoundsAfter = geom.aliveModels(leader).reduce((a,m)=>a+m.wounds,0);
    r.push(`canFight(protected leader)=${cf} -> FOUGHT leader directly. leaderWounds ${leaderWoundsBefore}->${leaderWoundsAfter}, damage=${leaderWoundsBefore-leaderWoundsAfter} :: ${leaderWoundsBefore-leaderWoundsAfter>0 || res.length>0 ? 'BUG: protected leader can be meleed directly, bypassing bodyguard' : 'no damage (but still allowed)'}`);
  } else {
    r.push(`canFight(protected leader)=${cf} (correctly blocked)`);
  }
  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
