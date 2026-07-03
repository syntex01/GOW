/**
 * Weapon visual-effects composition layer.
 *
 * The renderer owns the low-level primitive toolkit (`FxKit`); this module is
 * pure *composition*: one composer per weapon archetype that arranges those
 * primitives into a distinctive, on-theme grimdark-40k effect. Nothing here
 * touches Three.js, the scene, or the primitive implementations — every visual
 * is expressed only through the `FxKit` contract.
 *
 * World convention (matches the existing engine `playShoot`):
 *   - muzzle = `from` raised by +1.0 on Y (weapon barrel height)
 *   - impact = `to`   raised by +0.9 on Y (target torso height)
 *   - ground = impact projected to ~0.2 on Y (for shock rings)
 *
 * `color` is the shooter faction tint. Archetype *signature* colours are FIXED
 * (green gauss, blue plasma, red heavy, …) so a weapon reads at a glance; the
 * faction tint is only applied where it does not fight that readability
 * (bolter/generic tracers, missile backblast, sniper crack fleck).
 *
 * All counts are clamped to `kit.budget` (`volleys`, `sparks`); at most one
 * `boom` and one `glowLight` per shot; long-lived (>0.5s) effects are always
 * single-instance so total particle cost stays within the tier cap.
 */
import type { FxKit, V3 } from './fxkit';

export type WeaponArchetype =
  | 'bolter'
  | 'gauss'
  | 'plasma'
  | 'melta'
  | 'flamer'
  | 'heavy'
  | 'missile'
  | 'sniper'
  | 'generic';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/** Raise a point on Y without mutating the input (V3 is a plain record). */
function up(p: V3, dy: number): V3 {
  return { x: p.x, y: p.y + dy, z: p.z };
}

/** Project a point down to ground level for shock rings. */
function ground(p: V3): V3 {
  return { x: p.x, y: 0.2, z: p.z };
}

/**
 * Deterministic per-volley spread at the target so staggered shots fan out
 * instead of stacking. Mirrors the engine's existing jitter formula exactly.
 */
function jitter(p: V3, r: number, i: number): V3 {
  return {
    x: p.x + (((i * 1357) % 7) / 7 - 0.5) * 2 * r,
    y: p.y,
    z: p.z + (((i * 911) % 5) / 5 - 0.5) * 2 * r,
  };
}

/** Clamp an integer into [lo, hi]. */
function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/* ------------------------------------------------------------------ */
/* Classification                                                     */
/* ------------------------------------------------------------------ */

/**
 * Map a weapon's name + keywords to an archetype. First match wins, so more
 * specific / signature terms are tested before generic fallbacks (e.g. a
 * "heavy bolter" resolves to `heavy` because weight dominates its read).
 */
export function classifyWeapon(name: string, keywords: string[]): WeaponArchetype {
  const hay = `${name} ${keywords.join(' ')}`.toLowerCase();
  const has = (...terms: string[]): boolean => terms.some((t) => hay.includes(t));

  if (has('gauss', 'tesla', 'flayer', 'flay')) return 'gauss';
  if (has('plasma')) return 'plasma';
  if (has('melta', 'fusion', 'inferno')) return 'melta';
  if (has('flame', 'flamer', 'torrent', 'burna')) return 'flamer';
  if (has('lascannon', 'heavy', 'autocannon', 'battlecannon', 'volcano')) return 'heavy';
  if (has('missile', 'rocket', 'krak', 'frag', 'launcher')) return 'missile';
  if (has('sniper', 'longrifle', 'rail', 'railgun', 'las-fusil')) return 'sniper';
  if (has('bolt', 'bolter', 'gun', 'stubber')) return 'bolter';
  return 'generic';
}

/* ------------------------------------------------------------------ */
/* Composers                                                          */
/* ------------------------------------------------------------------ */

type Composer = (kit: FxKit, from: V3, to: V3, color: number, volleys: number) => void;

/**
 * BOLTER — mass-reactive kinetic staccato.
 * A warm cordite muzzle flash, then several faction-tinted tracers staggered a
 * frame apart and fanned across the target. Only the final shot spits impact
 * sparks + a flash, so it reads as a punchy burst rather than a beam. No ring,
 * no boom, no shake — pure rapid-fire dashes.
 */
const bolter: Composer = (kit, from, to, color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const n = clampInt(volleys, 1, kit.budget.volleys);
  const sc = kit.budget.sparks;

  kit.flash(m, 0xffd9a0, 1.1, 0.1); // warm barrel bloom
  for (let i = 0; i < n; i++) {
    kit.tracer(m, jitter(hit, 0.25, i), color, { delay: i * 0.05, thickness: 0.9, speed: 1.15 });
  }
  const arrival = (n - 1) * 0.05 + 0.17;
  kit.flash(jitter(hit, 0.25, n - 1), 0xffe0b0, 0.7, 0.1);
  kit.sparks(hit, 0xffb070, Math.min(6, sc), 3.5);
  void arrival; // timing is encoded in tracer delays; kept for readability
};

/**
 * GAUSS — Necron disintegration. FIXED green, faction tint ignored.
 * A green charge bloom at the muzzle, a violently flickering emerald beam with
 * a thin white-hot core overlaid on top, then a slow drift of green motes, a
 * lingering bloom and a faint disintegration ripple-ring at the impact. High
 * flicker is the signature. No boom, no shake — a clean, silent vaporising.
 */
const gauss: Composer = (kit, from, to, _color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const sc = kit.budget.sparks;
  const hi = kit.budget.tier === 'high';
  void volleys; // gauss is a single sustained beam, not a volley

  kit.flash(m, 0x2bff6a, 1.0, 0.13); // green charge glow
  kit.beam(m, hit, 0x3dff7a, { life: 0.3, thickness: 0.9, flicker: 0.85 });
  kit.beam(m, hit, 0xd9ffe8, { life: 0.24, thickness: 0.3, flicker: 1.0 }); // white-hot core
  kit.sparks(hit, 0x8dffb0, Math.min(10, sc), 1.0); // slow drifting motes
  kit.flash(hit, 0x66ff9a, 0.9, 0.18); // lingering disintegration bloom
  kit.ring(hit, 0x3dff7a, 0.7); // ripple
  if (hi) kit.glowLight(hit, 0x3dff7a, 0.6, 0.2);
};

/**
 * PLASMA — supercharged blue-white orb.
 * A bright cyan-white charge bloom + a brief blue light at the muzzle, then a
 * single fat, slowish `bolt` with a white-blue head and deep-blue trail (the
 * bolt owns its own travel timing). On arrival a modest fireball "splash" plus
 * a hot white flash. Reads as one heavy glowing round with a blue splash — no
 * shake, it is not a heavy weapon.
 */
const plasma: Composer = (kit, from, to, _color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const hi = kit.budget.tier === 'high';
  void volleys; // one deliberate round, not a burst

  kit.flash(m, 0xbfe4ff, 1.35, 0.15); // charge bloom
  if (hi) kit.glowLight(m, 0x2a6bff, 1.0, 0.15);
  kit.bolt(m, hit, 0x9fd8ff, { delay: 0.02, size: 1.3, speed: 0.8, trailColor: 0x3a86ff });
  kit.boom(hit, 0x66b0ff, 0.7); // small plasma splash
  kit.flash(hit, 0xdff0ff, 1.0, 0.14);
};

/**
 * MELTA — thermal heat-lance, brutal and short.
 * Furnace bloom at BOTH ends first, then a very short, THICK, slow-flickering
 * orange beam with a white core. Heavy molten spray + a lighter drip of sparks
 * at the impact, a scorch ring and (on non-low tiers) an orange impact light
 * and a solid camera kick. Reads like slag being poured through the target.
 */
const melta: Composer = (kit, from, to, _color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const sc = kit.budget.sparks;
  const shakeOK = kit.budget.tier !== 'low';
  void volleys;

  kit.flash(m, 0xfff2d0, 1.6, 0.2); // muzzle furnace
  kit.flash(hit, 0xffcaa0, 1.8, 0.24); // impact furnace
  kit.beam(m, hit, 0xffb060, { life: 0.2, thickness: 1.6, flicker: 0.3 });
  kit.beam(m, hit, 0xfff2d0, { life: 0.16, thickness: 0.45, flicker: 0.2 }); // white core
  kit.sparks(hit, 0xff9a3c, Math.min(14, sc), 6.5); // molten spray
  kit.sparks(hit, 0xffca6a, Math.max(3, Math.min(sc - 3, sc)), 3.0); // slow drips
  kit.ring(hit, 0xff8a4a, 0.6); // scorch
  kit.glowLight(hit, 0xff7a1a, 1.4, 0.22);
  if (shakeOK) kit.shake(0.25);
};

/**
 * FLAMER — wide, lingering fire fan. No projectile, no single impact.
 * An ignition pop at the muzzle, then one wide, long-lived orange cone toward
 * the target with a hotter, narrower inner cone layered inside it, plus a few
 * stray embers at the far reach. Long `life` makes the flame hang in the air;
 * a single cone per layer keeps the particle cost bounded. No beam/boom/ring.
 */
const flamer: Composer = (kit, from, to, _color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const sc = kit.budget.sparks;
  const hi = kit.budget.tier === 'high';
  void volleys;

  kit.flash(m, 0xffd070, 1.1, 0.15); // ignition
  if (hi) kit.glowLight(m, 0xff6a12, 0.9, 0.2);
  kit.cone(m, hit, 0xff7a2a, { life: 0.9, spread: 0.55, count: Math.min(sc, sc) });
  kit.cone(m, hit, 0xffd24a, { life: 0.7, spread: 0.35, count: Math.min(20, sc) }); // hot core
  kit.sparks(hit, 0xff6a12, Math.min(5, sc), 0.8); // embers at reach
};

/**
 * HEAVY (lascannon / autocannon / battlecannon) — weighty red lance + detonation.
 * A heavy red muzzle recoil flash + light, a thick red beam with a white-hot
 * core, then a real explosion at the target: fireball, shock ring, impact light
 * and a strong camera shake (tier-gated). Slow-cadence, screen-punching.
 */
const heavy: Composer = (kit, from, to, _color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const shakeOK = kit.budget.tier !== 'low';
  void volleys;

  kit.flash(m, 0xff5533, 1.4, 0.15); // muzzle recoil
  kit.glowLight(m, 0xff3320, 1.0, 0.15);
  kit.beam(m, hit, 0xff3a2a, { life: 0.24, thickness: 1.6, flicker: 0.22 });
  kit.beam(m, hit, 0xffd0c0, { life: 0.16, thickness: 0.4, flicker: 0.25 }); // white core
  kit.boom(hit, 0xff6a30, 1.5); // real detonation (owns its own sparks)
  kit.ring(ground(to), 0xff4020, 1.3);
  if (shakeOK) kit.shake(0.5);
};

/**
 * MISSILE — arcing rocket then the biggest blast in the set.
 * A launch flash tinted by the faction plus a faint grey backblast spark spit,
 * then the SLOWEST `bolt` with a big warhead and dull grey smoke trail (the
 * slow speed + grey trail is what separates it from plasma's fast blue orb).
 * On arrival: the largest fireball, a wide shock ring, an impact light and the
 * heaviest shake. The signature payoff of the whole kit.
 */
const missile: Composer = (kit, from, to, color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const sc = kit.budget.sparks;
  const shakeOK = kit.budget.tier !== 'low';
  void volleys;

  kit.flash(m, color, 1.0, 0.12); // faction-tinted launch
  kit.sparks(m, 0xbfbfbf, Math.min(6, sc), 1.5); // backblast smoke-spark
  kit.bolt(m, hit, 0xffd0a0, { delay: 0.03, size: 1.5, speed: 0.5, trailColor: 0xcfcfcf });
  kit.boom(hit, 0xff7a30, 1.9); // biggest fireball
  kit.ring(ground(to), 0xff5a20, 1.6);
  kit.glowLight(hit, 0xff5a1a, 1.9, 0.3);
  if (shakeOK) kit.shake(0.7);
};

/**
 * SNIPER / RAIL — surgical instant hitscan.
 * A single, razor-thin, near-white beam with essentially no flicker and a very
 * short life — there one frame, gone the next. A tiny, sharp white muzzle crack
 * and a minimal impact flash with a tight, high-velocity spark fleck tinted by
 * the faction. No ring, no boom, no shake — restraint is the signature.
 */
const sniper: Composer = (kit, from, to, color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const sc = kit.budget.sparks;
  void volleys;

  kit.beam(m, hit, 0xeaf2ff, { life: 0.11, thickness: 0.25, flicker: 0.05 });
  kit.flash(m, 0xffffff, 0.9, 0.06); // sharp crack
  kit.flash(hit, 0xdfe8ff, 0.7, 0.08);
  kit.sparks(hit, color, Math.min(3, sc), 6.0); // tight, fast fleck
};

/**
 * GENERIC — neutral fallback that mirrors the current engine baseline.
 * A faction-tinted muzzle flash, up to three staggered, fanned tracers, then a
 * single impact flash + spark burst on the last arrival. Understated so any
 * classified weapon always feels richer than the default.
 */
const generic: Composer = (kit, from, to, color, volleys) => {
  const m = up(from, 1.0);
  const hit = up(to, 0.9);
  const n = Math.min(clampInt(volleys, 1, kit.budget.volleys), 3);
  const sc = kit.budget.sparks;

  kit.flash(m, color, 1.1, 0.12);
  for (let i = 0; i < n; i++) {
    kit.tracer(m, jitter(hit, 0.35, i), color, { delay: i * 0.06, thickness: 1.0, speed: 1.0 });
  }
  kit.flash(hit, color, 0.9, 0.12);
  kit.sparks(hit, 0xffb070, Math.max(3, Math.min(sc - 2, sc)), 4.0);
};

/** Composer table — one distinctive effect per archetype. */
export const ARCHETYPE_FX: Record<WeaponArchetype, Composer> = {
  bolter,
  gauss,
  plasma,
  melta,
  flamer,
  heavy,
  missile,
  sniper,
  generic,
};
