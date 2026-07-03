/**
 * Web Audio DSP primitives + musical constants for the real-time score.
 *
 * This is a faithful real-time port of the offline "Gravewater Pulse" numpy
 * synth (a D-natural-minor grimdark cinematic track): same key, tempo, Axis
 * minor vamp, signature hook, dark drone/bell palette and sidechain pump — but
 * rebuilt from OscillatorNode/BiquadFilter graphs so it streams live in the
 * browser instead of rendering a WAV. Nothing here is sampled audio; every
 * sound is generated, so the game ships silent-of-copyright.
 */

/* ------------------------------- musical grid ---------------------------- */

export const BPM = 84;
export const BEAT = 60 / BPM; // 0.714 s
export const BAR = BEAT * 4; // 2.857 s
export const STEP = BEAT / 4; // 16th, 0.179 s

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Scientific-pitch name ("D4", "F#5", "Bb2") → frequency in Hz (A4 = 440). */
export function noteFreq(name: string): number {
  let i = 1;
  let acc = 0;
  if (name.length > 1 && (name[1] === '#' || name[1] === 'b')) {
    acc = name[1] === '#' ? 1 : -1;
    i = 2;
  }
  const octave = parseInt(name.slice(i), 10);
  const midi = 12 * (octave + 1) + SEMI[name[0]] + acc;
  return 440 * 2 ** ((midi - 69) / 12);
}

/* ------------------------------- noise source ---------------------------- */

/** One shared white-noise buffer, reused by every noise-based voice/effect. */
export function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Deterministic LCG so the noise is identical every session (the synth is
  // seeded); avoids Math.random for reproducibility.
  let s = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 0xffffffff) * 2 - 1;
  }
  return buf;
}

/* ------------------------------ reverb / space --------------------------- */

/**
 * A dark, damped exponential-decay impulse response — the "behind glass" space
 * the palette (bells, choir, drones) sits in. Late energy is low-passed harder
 * than early energy so tails go warm, not hissy (matches the offline `make_ir`
 * damped design).
 */
export function makeReverbIR(ctx: BaseAudioContext, seconds = 3.2, decay = 3.0): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.floor(seconds * rate);
  const ir = ctx.createBuffer(2, n, rate);
  let s = 0x1234567;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = Math.pow(1 - t, decay);
      // progressive low-pass: coefficient falls as the tail decays → damping
      const a = 0.2 + 0.6 * t;
      lp += (rnd() - lp) * a;
      d[i] = lp * env;
    }
  }
  return ir;
}

/* ---------------------------- saturation curves -------------------------- */

/** tanh soft-saturation transfer curve for a WaveShaperNode (bus glue/warmth). */
export function makeSaturationCurve(drive = 1.2, len = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return c;
}

/* ------------------------------ scheduling ------------------------------- */

/**
 * Schedule a linear-attack / exponential-ish decay-sustain-release envelope on a
 * GainNode's gain param, peaking at `peak`. `exponentialRampToValueAtTime` can't
 * reach 0, so release ramps to a tiny epsilon then hard-sets 0.
 */
export function envADSR(
  g: AudioParam,
  when: number,
  dur: number,
  peak: number,
  a = 0.01,
  d = 0.1,
  s = 0.7,
  r = 0.2,
): void {
  const eps = 1e-4;
  const sustainLevel = Math.max(eps, peak * s);
  const attackEnd = when + a;
  const decayEnd = attackEnd + d;
  const relStart = Math.max(decayEnd, when + dur - r);
  g.setValueAtTime(eps, when);
  g.linearRampToValueAtTime(Math.max(eps, peak), attackEnd);
  g.exponentialRampToValueAtTime(sustainLevel, decayEnd);
  g.setValueAtTime(sustainLevel, relStart);
  g.exponentialRampToValueAtTime(eps, relStart + r);
  g.setValueAtTime(0, relStart + r + 0.005);
}

/** Percussive one-shot: instant attack, exponential decay to silence. */
export function envHit(g: AudioParam, when: number, peak: number, decay: number): void {
  const eps = 1e-4;
  g.setValueAtTime(Math.max(eps, peak), when);
  g.exponentialRampToValueAtTime(eps, when + decay);
  g.setValueAtTime(0, when + decay + 0.005);
}
