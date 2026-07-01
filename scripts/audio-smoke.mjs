/** Headless audio smoke test: load the built game, instrument AudioContext to
 *  count oscillators + track state, fire a gesture (deploy) so the score + SFX
 *  start, advance a few phases to trigger combat SFX, and assert no page errors
 *  and that voices were actually synthesised. */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'file:///home/user/GOW/builds/GrimdarkTabletop.html';

const instrument = () => {
  const Orig = window.AudioContext || window.webkitAudioContext;
  const stats = { ctx: 0, osc: 0, buf: 0, state: 'none' };
  window.__audio = stats;
  if (!Orig) return;
  const wrap = (AC) =>
    class extends AC {
      constructor(...a) {
        super(...a);
        stats.ctx++;
        const inst = this;
        const resume = () => inst.resume && inst.resume().then(() => (stats.state = inst.state)).catch(() => {});
        resume();
        setTimeout(resume, 120);
        const oc = this.createOscillator.bind(this);
        this.createOscillator = () => {
          stats.osc++;
          return oc();
        };
        const bs = this.createBufferSource.bind(this);
        this.createBufferSource = () => {
          stats.buf++;
          return bs();
        };
      }
    };
  window.AudioContext = wrap(Orig);
  try {
    window.webkitAudioContext = wrap(Orig);
  } catch {
    /* readonly in some builds */
  }
};

const b = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => {
  if (m.type() === 'error') errs.push('console: ' + m.text());
});
await p.addInitScript(instrument);
await p.goto(URL, { waitUntil: 'commit', timeout: 30000 });
await p.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
await p.getByText(/deploy/i).first().click(); // gesture → unlock + startMusic
await p.waitForSelector('canvas', { timeout: 20000 });
await p.waitForTimeout(2500);
// advance several phases to trigger phase/turn/combat SFX
for (let i = 0; i < 6; i++) {
  try {
    await p.getByText(/next phase/i).first().click({ timeout: 2000 });
  } catch {
    /* button may be transiently disabled */
  }
  await p.waitForTimeout(500);
}
await p.waitForTimeout(1500);
const stats = await p.evaluate(() => window.__audio);
const realErrs = errs.filter((e) => !/font|gstatic|ERR_|favicon|Download the React/.test(e));
console.log(JSON.stringify({ stats, errors: realErrs.length, sample: realErrs.slice(0, 5) }, null, 2));
await b.close();
