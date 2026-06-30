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

  // Find a protected leader on B (Captain leads Intercessors)
  const bguard = Object.values(e.state.units).find(u=>u.ownerId==='B' && u.attachedLeaderIds.length>0);
  if (!bguard){ r.push('no B leader pair'); return r; }
  const leaderId = bguard.attachedLeaderIds[0];
  const leader = e.state.units[leaderId];
  r.push(`B pair: bodyguard=${bguard.name} leader=${leader.name} leaderProtected=${e.isProtectedLeader(leader)}`);

  // Now simulate UI selectForShooting target computation for an A shooter
  const shooter = e.unitsOf('A').find(u=>u.weapons.some(w=>w.kind==='ranged') && e.isAlive(u) && !u.inReserves);
  // place shooter in range/LoS of the leader
  const lc = geom.unitCentroid(leader);
  for (const m of shooter.models) m.position = { x: lc.x, y: lc.y - 8 };
  // also move bodyguard with leader so leader stays "protected" and in range
  geom.resolveCollisions(e.state.units, e.state.terrain, e.state.board);

  // Replicate HUD.selectForShooting: uses enemiesOf (NOT targetableEnemiesOf)
  const uiTargets = e.enemiesOf('A').filter(en => e.shootableWeapons(shooter, en).length > 0).map(en=>en.id);
  const leaderHighlighted = uiTargets.includes(leaderId);
  // The CORRECT set would use targetableEnemiesOf
  const correctTargets = e.targetableEnemiesOf('A').filter(en => e.shootableWeapons(shooter, en).length > 0).map(en=>en.id);
  const leaderInCorrect = correctTargets.includes(leaderId);
  r.push(`shooter=${shooter.name} shootableWeaponsVsLeader=${e.shootableWeapons(shooter,leader).length}`);
  r.push(`HUD would highlight protected leader as target: ${leaderHighlighted} (correct=${leaderInCorrect})`);

  // What happens if you DO shoot the protected leader?
  const before = JSON.stringify({hasShot: shooter.hasShot});
  const res = e.shoot(shooter, leader);
  r.push(`shoot(protected leader): results=${res.length} hasShot=${shooter.hasShot} (no-op: leader protected) -> shooter shooting wasted=${res.length===0 && !shooter.hasShot}`);

  // AI implication: ai.ts iterates enemiesOf and may pick the protected leader.
  // Simulate AI best-target pick (most weapons) including the leader nearby.
  let best=null, bestN=0;
  for (const en of e.enemiesOf('A')) { const n = e.shootableWeapons(shooter,en).length; if (n>bestN){bestN=n;best=en;} }
  r.push(`AI best target for shooter = ${best?best.name:'none'} (n=${bestN}); is protected leader? ${best?.id===leaderId}`);

  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
