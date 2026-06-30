import { chromium } from 'playwright-core';
const URL = 'http://localhost:5182/';
const EXE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ARGS = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'];
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const page = await (await browser.newContext({ viewport:{width:1440,height:900} })).newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror:'+e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const r = [];
  const { GameEngine } = await import('/src/engine/game.ts');
  const { createGame } = await import('/src/engine/factory.ts');
  const { DATASHEETS, SAMPLE_ARMIES } = await import('/src/engine/data/index.ts');
  const { runAiTurn } = await import('/src/engine/ai.ts');

  // Run several full games with different seeds, AI vs AI both sides.
  for (let seed = 1; seed <= 6; seed++) {
    try {
      const cfg = { seed, players:{A:{name:'A',faction:'Necrons'},B:{name:'B',faction:'Ultramarines'}} };
      const e = new GameEngine(createGame(cfg, DATASHEETS, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.ultramarines));
      e.startGame();
      let guard = 0;
      const seen = new Set();
      while (e.winner() === undefined && guard < 200) {
        // mimic nextPhase: if active is "AI", run whole turn; else advance one phase
        const before = e.active + e.state.phase + e.state.round;
        runAiTurn(e); // both sides AI: runs the active player's whole turn
        guard++;
        const w = e.winner();
        if (w !== undefined) break;
        // detect stuck (no progress)
        const after = e.active + e.state.phase + e.state.round;
        if (before === after) { r.push(`seed ${seed}: STUCK at ${after}`); break; }
        if (e.state.round > 6) break;
      }
      const w = e.winner();
      r.push(`seed ${seed}: winner=${w} round=${e.state.round} guard=${guard} VP A=${e.state.players.A.victoryPoints} B=${e.state.players.B.victoryPoints} CP A=${e.state.players.A.commandPoints} B=${e.state.players.B.commandPoints}`);
    } catch (err) { r.push(`seed ${seed}: ERROR ${err.message} :: ${err.stack?.split('\n')[1]||''}`); }
  }
  return r;
});
out.forEach(l=>console.log(l));
console.log('--- page errors ---');
errs.forEach(e=>console.log(e));
await browser.close();
