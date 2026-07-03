/** Deploy, select a friendly unit (click its base near the bottom), screenshot
 *  so we can see the right-side unit card. */
import { chromium } from 'playwright-core';
const EXE = process.env.CHROME_EXE || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = 'file:///home/user/GOW/builds/GrimdarkTabletop.html';
const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'commit', timeout: 30000 });
await p.getByText(/deploy/i).first().waitFor({ timeout: 40000 });
await p.getByText(/deploy/i).first().click();
await p.waitForSelector('canvas', { timeout: 20000 });
await p.waitForTimeout(5000);
// Selection via canvas click is unreliable headless; inject a representative
// datacard so we can verify the card's RIGHT-side placement + styling.
const shown = await p.evaluate(() => {
  const el = document.querySelector('.unitpanel');
  if (!el) return false;
  const hud = document.querySelector('.hud'); if (hud) hud.setAttribute('data-accent','necron');
  el.classList.add('show');
  el.innerHTML = `
    <div class="datacard-head"><div class="dc-titles">
      <div class="uname">Necron Warriors</div>
      <div class="ukw">Necrons · Infantry · Battleline</div>
    </div><button class="drawer-close">✕</button></div>
    <div class="statline">
      <div class="stat"><div class="k">M</div><div class="v">5"</div></div>
      <div class="stat"><div class="k">T</div><div class="v">4</div></div>
      <div class="stat"><div class="k">Sv</div><div class="v">4+</div></div>
      <div class="stat"><div class="k">W</div><div class="v">1</div></div>
      <div class="stat"><div class="k">Ld</div><div class="v">7+</div></div>
      <div class="stat"><div class="k">OC</div><div class="v">2</div></div></div>
    <div class="ability">Reanimation Protocols · Feel No Pain 5+</div>
    <div class="wlabel"><span>Models 10/10</span><span>10/10 W</span></div>
    <div class="wbar"><span style="width:100%"></span></div>
    <table class="weapons"><thead><tr><th>Weapon</th><th>R</th><th>A</th><th>Sk</th><th>S</th><th>AP</th><th>D</th></tr></thead>
    <tbody>
      <tr class="weapon ranged"><td class="wn">Gauss Flayer<span class="kw">rapid fire 1</span></td><td>24"</td><td>1</td><td>4+</td><td>4</td><td>-1</td><td>1</td></tr>
      <tr class="weapon melee"><td class="wn">Close Combat Weapon</td><td>Melee</td><td>1</td><td>4+</td><td>4</td><td>0</td><td>1</td></tr>
    </tbody></table>
    <div class="status"><span class="badge ready">ready</span></div>`;
  return true;
});
await p.waitForTimeout(600);
const box = await p.evaluate(() => {
  const el = document.querySelector('.unitpanel.show');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { right: Math.round(window.innerWidth - r.right), top: Math.round(r.top), w: Math.round(r.width), name: el.querySelector('.uname')?.textContent };
});
await p.screenshot({ path: '/home/user/GOW/screenshots/visual/unitcard.png' });
console.log(JSON.stringify({ cardShown: shown, cardBox: box, errors: errs.filter(e=>!/font|gstatic|ERR_/.test(e)) }));
await b.close();
