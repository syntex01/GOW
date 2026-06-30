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
  const { runAiTurn } = await import('/src/engine/ai.ts');

  // Mirror match: same army both sides, A first. If A still always wins big -> first-player/structural bug.
  function play(seed, listA, listB, firstPlayer) {
    const e = new GameEngine(createGame({seed,players:{A:{name:'A',faction:'x'},B:{name:'B',faction:'y'}}}, DATASHEETS, listA, listB));
    if (firstPlayer === 'B') { e.state.firstPlayer='B'; e.state.activePlayer='B'; }
    e.startGame();
    let g=0; while (e.winner()===undefined && g<60){ runAiTurn(e); g++; if (e.state.round>6) break; }
    return { w: e.winner(), a: e.state.players.A.victoryPoints, b: e.state.players.B.victoryPoints, round: e.state.round };
  }

  // Mirror Necrons vs Necrons
  let aWins=0,bWins=0,draws=0; const rows=[];
  for (let s=1;s<=8;s++){ const o=play(s, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.necrons, 'A'); rows.push(`mirror necron seed${s}: ${o.w} (A${o.a} B${o.b})`); if(o.w==='A')aWins++; else if(o.w==='B')bWins++; else draws++; }
  r.push(`MIRROR Necron (A goes first): A=${aWins} B=${bWins} draw=${draws}`);
  rows.forEach(x=>r.push('  '+x));

  // Same mirror but B goes first
  aWins=0;bWins=0;draws=0; const rows2=[];
  for (let s=1;s<=8;s++){ const o=play(s, SAMPLE_ARMIES.necrons, SAMPLE_ARMIES.necrons, 'B'); rows2.push(`seed${s}: ${o.w} (A${o.a} B${o.b})`); if(o.w==='A')aWins++; else if(o.w==='B')bWins++; else draws++; }
  r.push(`MIRROR Necron (B goes first): A=${aWins} B=${bWins} draw=${draws}`);
  rows2.forEach(x=>r.push('  '+x));

  return r;
});
out.forEach(l=>console.log(l));
await browser.close();
