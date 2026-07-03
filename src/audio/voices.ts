/**
 * Real-time synth voices — orchestral instruments, the invented dark palette,
 * and the drum kit — ported from the offline numpy recipes (orch.py, thing.py,
 * engine.py) to Web Audio node graphs. Each voice builds a small oscillator/
 * filter/gain graph, schedules its envelope, connects to a destination bus, and
 * auto-releases its nodes when it finishes (osc.onended → disconnect) so a long
 * session never leaks nodes.
 */
import { envADSR, envHit } from './dsp';

export interface Rig {
  ctx: AudioContext;
  /** Shared white-noise buffer (bow/hammer/drum noise). */
  noise: AudioBuffer;
}

/** Stop an oscillator/source at `at` and tear down `nodes` once it ends. */
function reap(src: AudioScheduledSourceNode, at: number, nodes: AudioNode[]): void {
  src.stop(at);
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  };
}

function panner(ctx: AudioContext, pan: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

function noiseSource(rig: Rig): AudioBufferSourceNode {
  const s = rig.ctx.createBufferSource();
  s.buffer = rig.noise;
  s.loop = true;
  return s;
}

/* ============================= orchestral ================================= */

/** Ensemble sustained strings: a few detuned saw/tri voices, warm low-pass,
 *  slow ADSR — the bowed-body bed under the hook and chords. */
export function strings(
  rig: Rig,
  freq: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.16,
  pan = 0,
): void {
  const { ctx } = rig;
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3600;
  const pn = panner(ctx, pan);
  g.connect(lp).connect(pn).connect(dest);
  envADSR(g.gain, when, dur, gain, 0.18, 0.3, 0.85, Math.min(1.2, dur * 0.35));

  const detunes = [-7, 0, 7]; // cents — ensemble width
  const oscs: OscillatorNode[] = [];
  for (const det of detunes) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = det;
    // slow vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = freq * 0.004;
    lfo.connect(lfoG).connect(o.frequency);
    o.connect(g);
    o.start(when);
    lfo.start(when);
    reap(o, when + dur + 0.1, []);
    reap(lfo, when + dur + 0.1, []);
    oscs.push(o);
  }
  reap(oscs[0], when + dur + 0.1, [g, lp, pn]);
}

/** Felt-ish grand piano: a handful of stretched-inharmonic partials with fast
 *  per-partial decay + a low-passed hammer thump. */
export function piano(
  rig: Rig,
  freq: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.3,
  pan = 0,
): void {
  const { ctx } = rig;
  const out = ctx.createGain();
  out.gain.value = gain;
  const pn = panner(ctx, pan);
  out.connect(pn).connect(dest);

  const B = 0.0004; // inharmonicity
  const partials = [1, 2, 3, 4, 6];
  const rolloff = [1, 0.5, 0.34, 0.22, 0.12];
  partials.forEach((k, idx) => {
    const fk = k * freq * Math.sqrt(1 + B * k * k);
    if (fk > ctx.sampleRate / 2 - 200) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = fk;
    const g = ctx.createGain();
    o.connect(g).connect(out);
    const decay = Math.max(0.25, dur * 0.55) / k;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(rolloff[idx] * 0.9, when + 0.006);
    g.gain.exponentialRampToValueAtTime(1e-4, when + decay + 0.05);
    o.start(when);
    reap(o, when + decay + 0.1, [g]);
  });
  // hammer thump
  const th = noiseSource(rig);
  const thf = ctx.createBiquadFilter();
  thf.type = 'lowpass';
  thf.frequency.value = 400;
  const thg = ctx.createGain();
  th.connect(thf).connect(thg).connect(out);
  envHit(thg.gain, when, 0.25, 0.03);
  th.start(when);
  reap(th, when + 0.08, [thf, thg, out, pn]);
}

/** Warm brass swell: saw core through a formant band-pass + soft saturation,
 *  attack bloom. Carries the hook octaves in the drop/peak. */
export function brass(
  rig: Rig,
  freq: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.14,
  pan = 0,
): void {
  const { ctx } = rig;
  const g = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = BRASS_CURVE;
  const form = ctx.createBiquadFilter();
  form.type = 'bandpass';
  form.frequency.value = 1300;
  form.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const pn = panner(ctx, pan);
  g.connect(shaper).connect(form).connect(lp).connect(pn).connect(dest);
  envADSR(g.gain, when, dur, gain, 0.12, 0.2, 0.85, Math.min(1.0, dur * 0.3));

  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  o.connect(g);
  o.start(when);
  reap(o, when + dur + 0.1, [g, shaper, form, lp, pn]);
}

const BRASS_CURVE = (() => {
  const c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    c[i] = Math.tanh(x * 1.6) * 0.8;
  }
  return c;
})();

/** "Ah" choir pad: saw through three formant band-passes, slow swell, wide. */
export function choir(
  rig: Rig,
  freq: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.1,
  pan = 0,
): void {
  const { ctx } = rig;
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.value = freq;
  const g = ctx.createGain();
  const pn = panner(ctx, pan);
  const sum = ctx.createGain();
  sum.connect(g).connect(pn).connect(dest);
  const formants: Array<[number, number]> = [
    [600, 1],
    [1000, 0.6],
    [2400, 0.3],
  ];
  const bands: BiquadFilterNode[] = [];
  for (const [f, a] of formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 6;
    const bg = ctx.createGain();
    bg.gain.value = a;
    src.connect(bp).connect(bg).connect(sum);
    bands.push(bp);
  }
  envADSR(g.gain, when, dur, gain, 0.4, 0.4, 0.85, Math.min(1.5, dur * 0.35));
  src.start(when);
  reap(src, when + dur + 0.2, [g, pn, sum, ...bands]);
}

/** Short warm plucked string (pizzicato). */
export function pizz(
  rig: Rig,
  freq: number,
  when: number,
  dest: AudioNode,
  gain = 0.22,
  pan = 0,
): void {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const pn = panner(ctx, pan);
  o.connect(g).connect(lp).connect(pn).connect(dest);
  envHit(g.gain, when, gain, 0.28);
  o.start(when);
  reap(o, when + 0.4, [g, lp, pn]);
}

/** Ringing harp/gliss note — like pizz but a longer ring. */
export function harp(
  rig: Rig,
  freq: number,
  when: number,
  dest: AudioNode,
  gain = 0.18,
  pan = 0,
): void {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  const pn = panner(ctx, pan);
  o.connect(g).connect(lp).connect(pn).connect(dest);
  envHit(g.gain, when, gain, 0.9);
  o.start(when);
  reap(o, when + 1.1, [g, lp, pn]);
}

/** Timpani: sine with a fast downward pitch drop + a soft mallet-noise attack. */
export function timpani(
  rig: Rig,
  freq: number,
  when: number,
  dest: AudioNode,
  gain = 0.3,
): void {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.5, when);
  o.frequency.exponentialRampToValueAtTime(freq, when + 0.12);
  const g = ctx.createGain();
  o.connect(g).connect(dest);
  envHit(g.gain, when, gain, 0.6);
  o.start(when);
  reap(o, when + 0.7, [g]);

  const nz = noiseSource(rig);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200;
  const ng = ctx.createGain();
  nz.connect(lp).connect(ng).connect(dest);
  envHit(ng.gain, when, gain * 0.4, 0.06);
  nz.start(when);
  reap(nz, when + 0.1, [lp, ng]);
}

/* ============================ dark palette =============================== */

/** Cracked "revenant" bell: inharmonic modal partials, long metallic ring —
 *  the grimdark signature struck on section downbeats and in the outro. */
export function bell(
  rig: Rig,
  root: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.16,
  pan = 0,
): void {
  const { ctx } = rig;
  const out = ctx.createGain();
  out.gain.value = gain;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 120;
  const pn = panner(ctx, pan);
  out.connect(hp).connect(pn).connect(dest);

  const ratios = [0.5, 1.0, 1.2, 1.5, 2.0, 2.5];
  const amps = [0.9, 1.0, 0.63, 0.4, 0.28, 0.18];
  const decays = [dur, dur * 0.95, dur * 0.5, dur * 0.4, dur * 0.32, dur * 0.26];
  ratios.forEach((rt, i) => {
    const f = root * rt * (1 + (i % 2 ? 0.008 : -0.006)); // per-partial crack
    if (f > ctx.sampleRate / 2 - 200) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    o.connect(g).connect(out);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amps[i], when + 0.003);
    g.gain.exponentialRampToValueAtTime(1e-4, when + decays[i] + 0.05);
    o.start(when);
    reap(o, when + decays[i] + 0.1, [g]);
  });
  // silent timer node just to tear down the shared out/hp/pn once the ring ends
  const timer = ctx.createOscillator();
  timer.start(when);
  reap(timer, when + dur, [out, hp, pn]);
}

/**
 * Groundwater residue-drone: synth partials 3–6 of a *missing* low f0 so the ear
 * supplies a phantom sub-bass — the sinking floor under the whole piece. Very
 * long, slowly swelling; call once per section.
 */
export function drone(
  rig: Rig,
  f0: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.14,
): void {
  const { ctx } = rig;
  const out = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 26;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  out.connect(hp).connect(lp).connect(dest);
  // long swell in and out
  const eps = 1e-4;
  out.gain.setValueAtTime(eps, when);
  out.gain.linearRampToValueAtTime(gain, when + dur * 0.3);
  out.gain.setValueAtTime(gain, when + dur * 0.7);
  out.gain.exponentialRampToValueAtTime(eps, when + dur);

  const oscs: OscillatorNode[] = [];
  for (const k of [3, 4, 5, 6]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = k * f0;
    o.detune.value = (k % 2 ? 4 : -4);
    const g = ctx.createGain();
    g.gain.value = Math.pow(k, -1.3);
    o.connect(g).connect(out);
    o.start(when);
    reap(o, when + dur + 0.1, [g]);
    oscs.push(o);
  }
  reap(oscs[0], when + dur + 0.1, [out, hp, lp]);
}

/** A dim, wide airy noise room-tone that fills the beatless valleys. */
export function airPad(rig: Rig, dur: number, when: number, dest: AudioNode, gain = 0.05): void {
  const { ctx } = rig;
  const nz = noiseSource(rig);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  nz.connect(bp).connect(g).connect(dest);
  const eps = 1e-4;
  g.gain.setValueAtTime(eps, when);
  g.gain.linearRampToValueAtTime(gain, when + dur * 0.4);
  g.gain.setValueAtTime(gain, when + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(eps, when + dur);
  nz.start(when);
  reap(nz, when + dur + 0.1, [bp, g]);
}

/* =============================== drum kit ================================ */

/** Tuned sine sub-bass (808) with a short pitch transient — glides between the
 *  chord roots to give the drops their body. */
export function sub808(
  rig: Rig,
  freq: number,
  dur: number,
  when: number,
  dest: AudioNode,
  gain = 0.5,
): void {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 3.2, when);
  o.frequency.exponentialRampToValueAtTime(freq, when + 0.06);
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 120;
  o.connect(g).connect(lp).connect(dest);
  envADSR(g.gain, when, dur, gain, 0.005, 0.05, 0.8, 0.08);
  o.start(when);
  reap(o, when + dur + 0.1, [g, lp]);
}

export function kick(rig: Rig, when: number, dest: AudioNode, gain = 0.9): void {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, when);
  o.frequency.exponentialRampToValueAtTime(48, when + 0.06);
  const g = ctx.createGain();
  o.connect(g).connect(dest);
  envHit(g.gain, when, gain, 0.32);
  o.start(when);
  reap(o, when + 0.4, [g]);
  // click
  const nz = noiseSource(rig);
  const ng = ctx.createGain();
  nz.connect(ng).connect(dest);
  envHit(ng.gain, when, gain * 0.5, 0.01);
  nz.start(when);
  reap(nz, when + 0.05, [ng]);
}

export function snare(rig: Rig, when: number, dest: AudioNode, gain = 0.5): void {
  const { ctx } = rig;
  const nz = noiseSource(rig);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  const ng = ctx.createGain();
  nz.connect(hp).connect(ng).connect(dest);
  envHit(ng.gain, when, gain * 0.9, 0.16);
  nz.start(when);
  reap(nz, when + 0.25, [hp, ng]);
  // body tone
  for (const f of [190, 280]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    o.connect(g).connect(dest);
    envHit(g.gain, when, gain * 0.28, 0.09);
    o.start(when);
    reap(o, when + 0.15, [g]);
  }
}

export function clap(rig: Rig, when: number, dest: AudioNode, gain = 0.45): void {
  const { ctx } = rig;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  hp.connect(dest);
  for (const [off, gg] of [
    [0, 1],
    [0.009, 0.9],
    [0.018, 0.8],
  ] as const) {
    const nz = noiseSource(rig);
    const g = ctx.createGain();
    nz.connect(g).connect(hp);
    envHit(g.gain, when + off, gain * gg, 0.12);
    nz.start(when + off);
    reap(nz, when + off + 0.2, [g]);
  }
}

export function hat(rig: Rig, when: number, dest: AudioNode, gain = 0.16, open = false): void {
  const { ctx } = rig;
  const nz = noiseSource(rig);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  nz.connect(hp).connect(g).connect(dest);
  envHit(g.gain, when, gain, open ? 0.18 : 0.045);
  nz.start(when);
  reap(nz, when + (open ? 0.3 : 0.08), [hp, g]);
}

export function crash(rig: Rig, when: number, dest: AudioNode, gain = 0.4): void {
  const { ctx } = rig;
  const nz = noiseSource(rig);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const g = ctx.createGain();
  nz.connect(hp).connect(g).connect(dest);
  envHit(g.gain, when, gain, 1.4);
  nz.start(when);
  reap(nz, when + 1.6, [hp, g]);
}

/** Rising filtered-noise riser into a drop (anticipation). */
export function riser(rig: Rig, dur: number, when: number, dest: AudioNode, gain = 0.3): void {
  const { ctx } = rig;
  const nz = noiseSource(rig);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, when);
  lp.frequency.exponentialRampToValueAtTime(12000, when + dur);
  const g = ctx.createGain();
  nz.connect(lp).connect(g).connect(dest);
  const eps = 1e-4;
  g.gain.setValueAtTime(eps, when);
  g.gain.linearRampToValueAtTime(gain, when + dur);
  g.gain.linearRampToValueAtTime(eps, when + dur + 0.05);
  nz.start(when);
  reap(nz, when + dur + 0.1, [lp, g]);
}
