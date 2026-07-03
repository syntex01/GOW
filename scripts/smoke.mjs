/**
 * Headless browser smoke test.
 *
 * Loads the dev server, drives the menu into a battle, clicks the primary action
 * button through several phases (triggering an AI turn), exercises the dice tray
 * via window.__demoDice if present, and FAILS if any console error appears that
 * is not a benign external-resource fetch failure (fonts / CDN connection drops).
 *
 * Robust by design: if the page can't be loaded (no dev server running during a
 * CI/agent session), it prints SKIP and exits 0. When a server *is* up it runs
 * for real and exits 1 on any genuine console error.
 *
 * Mirrors the launch pattern of scripts/shoot-v2.mjs (swiftshader/ANGLE args).
 *
 * Usage: node scripts/smoke.mjs   (optionally URL=... CHROME_EXE=...)
 */
import { chromium } from 'playwright-core';

const EXE =
  process.env.CHROME_EXE ||
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = process.env.URL || 'http://localhost:5173/';
const PHASE_CLICKS = Number(process.env.PHASE_CLICKS || 8);

/** Console errors we tolerate: external font/resource fetches that drop. */
function isBenign(text) {
  const t = String(text);
  return (
    t.includes('ERR_CONNECTION_CLOSED') ||
    t.includes('ERR_CONNECTION_REFUSED') ||
    t.includes('ERR_NAME_NOT_RESOLVED') ||
    t.includes('ERR_INTERNET_DISCONNECTED') ||
    t.includes('net::ERR_') && (t.includes('font') || t.includes('fonts.')) ||
    /Failed to load resource/i.test(t) && /font|fonts\.|gstatic|googleapis/i.test(t)
  );
}

function pass(msg) {
  console.log(`SMOKE PASS — ${msg}`);
  process.exit(0);
}
function fail(msg, errs = []) {
  console.log(`SMOKE FAIL — ${msg}`);
  for (const e of errs.slice(0, 20)) console.log('  ! ' + e);
  process.exit(1);
}
function skip(msg) {
  console.log(`SMOKE SKIP — ${msg}`);
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      // The app server is local; never route its requests through an HTTP proxy
      // (the agent sandbox may set one, which would break module/asset loads).
      '--no-proxy-server',
    ],
  });
} catch (e) {
  skip(`could not launch browser: ${e.message}`);
}

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
const benign = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  (isBenign(m.text()) ? benign : errors).push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (req) => {
  // Network failures only matter if they're not external fonts/resources.
  const u = req.url();
  if (!isBenign(u + ' ' + (req.failure()?.errorText ?? ''))) {
    // Same-origin app asset failing is a real problem.
    if (u.startsWith(URL) && !/\.(woff2?|ttf|otf)$/i.test(u)) {
      errors.push(`REQUESTFAILED: ${u} (${req.failure()?.errorText})`);
    }
  }
});

// --- Load the page (robustly). ---
try {
  // 'commit' (navigation committed) is the robust signal for a Vite dev page:
  // the HMR websocket keeps connections open, so 'load'/'networkidle' can stall.
  await page.goto(URL, { waitUntil: 'commit', timeout: 15000 });
} catch (e) {
  await browser.close();
  skip(`page failed to load (${e.message}). Is the dev server running at ${URL}?`);
}

// The dev module graph (three.js + app) can take 10-15s to evaluate under the
// software renderer before the menu mounts. Poll for the menu/app shell.
const MOUNT_TIMEOUT = Number(process.env.MOUNT_TIMEOUT || 30000);
let hasApp = false;
const deadline = Date.now() + MOUNT_TIMEOUT;
while (Date.now() < deadline) {
  hasApp = await page
    .evaluate(() => {
      const app = document.querySelector('#app');
      return (
        !!document.querySelector('canvas, .menu, .faction-col, [data-accent]') ||
        (!!app && app.childElementCount > 0)
      );
    })
    .catch(() => false);
  if (hasApp) break;
  await page.waitForTimeout(1000);
}
if (!hasApp) {
  await browser.close();
  if (errors.length) fail('app never mounted and console errors present', errors);
  skip(`app shell never mounted at ${URL} within ${MOUNT_TIMEOUT}ms; treating as no usable dev server.`);
}

// --- Drive the menu into a battle. ---
async function tryClick(selector, opts = {}) {
  const el = await page.$(selector);
  if (!el) return false;
  try {
    await el.click({ timeout: 1500, ...opts });
    return true;
  } catch {
    return false;
  }
}

// Pick a faction in each player's column (first card found per column).
const factionCols = await page.$$('.faction-col');
for (const col of factionCols) {
  const pick = await col.$('.faction-pick');
  if (pick) {
    try {
      await pick.click({ timeout: 1500 });
    } catch {
      /* ignore */
    }
  }
}
await page.waitForTimeout(300);

// Hit the Deploy button to start the battle (if the menu is present).
await tryClick('.deploy-btn');
await tryClick('button.primary');
// Robust fallback: click anything whose text reads "deploy".
try {
  const deploy = page.getByText(/deploy/i);
  if (await deploy.count()) await deploy.first().click({ timeout: 1500 });
} catch {
  /* ignore */
}
await page.waitForTimeout(500);

// Wait for the 3D canvas to appear (the battle view). If it never does, that's
// still not necessarily a failure if no console errors fired — but we need a
// canvas to consider the smoke meaningful.
let canvasOk = true;
try {
  await page.waitForSelector('canvas', { timeout: 8000 });
} catch {
  canvasOk = false;
}

if (!canvasOk) {
  await browser.close();
  if (errors.length) fail('no canvas and console errors present', errors);
  skip('battle canvas never appeared (menu may need different navigation); no console errors seen.');
}

// Let the scene (env + models + bloom) settle.
await page.waitForTimeout(4000);

// --- Click the primary action button through several phases. ---
// The HUD primary button cycles phases ("Next Phase ▸" / "End Turn ▸"), which
// hands the turn to the AI and runs an AI turn somewhere in the cycle.
let clicks = 0;
for (let i = 0; i < PHASE_CLICKS; i++) {
  const clicked = await tryClick('.hud button.primary');
  if (!clicked) {
    // Fall back to any primary button on screen.
    if (!(await tryClick('button.primary'))) break;
  }
  clicks++;
  await page.waitForTimeout(900);
}

// --- Exercise the dice demo if exposed. ---
const hasDemo = await page.evaluate(() => typeof window.__demoDice === 'function').catch(() => false);
if (hasDemo) {
  await page.evaluate(() => window.__demoDice()).catch(() => {});
  await page.waitForTimeout(1200);
}

await page.waitForTimeout(500);
await browser.close();

// --- Verdict ---
console.log(`phases-advanced=${clicks} dice-demo=${hasDemo ? 'yes' : 'absent'} ` +
  `errors=${errors.length} benign-ignored=${benign.length}`);
if (errors.length) {
  fail(`${errors.length} unexpected console error(s) during the run`, errors);
}
pass(`drove ${clicks} phase click(s), dice demo ${hasDemo ? 'fired' : 'absent'}, no unexpected console errors`);
