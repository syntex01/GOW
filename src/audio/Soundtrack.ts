/* =========================================================================
   SOUNDTRACK — procedural grimdark ambient drone.

   A slowly evolving dark pad: a stack of detuned low oscillators fed through a
   shared lowpass that breathes under a slow LFO, plus a faint sub. Over the top,
   an occasional distant "toll" (a struck, decaying bell-like tone through
   reverb) and a low percussive heartbeat punctuate the drone.

   It loops seamlessly because it is *continuous* synthesis — nothing is sample-
   looped, so there are no seams or clicks. It is cheap: a handful of persistent
   nodes plus one timer that schedules sparse events; no per-frame allocation.
   Everything is routed through the music bus passed in by SoundEngine.
   ========================================================================= */

export class Soundtrack {
  private playing = false;
  /** Persistent drone voices + their shaping nodes, torn down on stop(). */
  private nodes: AudioNode[] = [];
  private oscs: OscillatorNode[] = [];
  private lfo: OscillatorNode | null = null;
  private out: GainNode | null = null;
  /** Reverb send for distant tolls. */
  private space: GainNode | null = null;
  /** Timer that schedules the next sparse punctuation event. */
  private eventTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private ctx: AudioContext,
    private bus: GainNode,
  ) {}

  /** Start the drone (idempotent). */
  start(): void {
    if (this.playing) return;
    this.playing = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Master fade-in node for the whole soundtrack (click-free start).
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.9, now + 4);
    out.connect(this.bus);
    this.out = out;

    // A breathing lowpass shared by the drone stack.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 6;
    filter.connect(out);
    this.nodes.push(filter);

    // Slow LFO modulating the filter cutoff (the "breath", ~0.05 Hz).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260; // ±260 Hz sweep around the 420 Hz base
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);
    this.lfo = lfo;
    this.nodes.push(lfoGain);

    // Detuned low oscillator stack: a brooding D minor-ish drone (D2/A2/F3),
    // each voice slightly detuned for a wide, unsettled chorus.
    const drone: Array<{ f: number; type: OscillatorType; detune: number; g: number }> = [
      { f: 73.42, type: 'sawtooth', detune: -7, g: 0.16 }, // D2
      { f: 73.42, type: 'sawtooth', detune: 8, g: 0.16 }, // D2 (detuned twin)
      { f: 110.0, type: 'triangle', detune: -4, g: 0.13 }, // A2
      { f: 174.61, type: 'sine', detune: 5, g: 0.09 }, // F3
      { f: 36.71, type: 'sine', detune: 0, g: 0.22 }, // D1 sub
    ];
    for (const v of drone) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = v.f;
      osc.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.value = v.g;
      osc.connect(g);
      // The sub bypasses the breathing filter so the low end stays steady.
      g.connect(v.f < 50 ? out : filter);
      osc.start(now);
      this.oscs.push(osc);
      this.nodes.push(g);
    }

    // A small feedback-delay "space" for the distant tolls.
    const space = ctx.createGain();
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.37;
    const fb = ctx.createGain();
    fb.gain.value = 0.55;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1200;
    space.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    delay.connect(out);
    this.space = space;
    this.nodes.push(delay, fb, tone);

    this.scheduleEvent();
  }

  /** Stop the drone with a short fade so there is no click. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.eventTimer) {
      clearTimeout(this.eventTimer);
      this.eventTimer = null;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.out;
    if (out) {
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    }
    const stopAt = now + 1.3;
    for (const o of this.oscs) {
      try {
        o.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    if (this.lfo) {
      try {
        this.lfo.stop(stopAt);
      } catch {
        /* ignore */
      }
    }
    // Disconnect everything a beat after the fade completes.
    const nodes = this.nodes.slice();
    const oscs = this.oscs.slice();
    window.setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      for (const o of oscs) {
        try {
          o.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, 1500);
    this.nodes = [];
    this.oscs = [];
    this.lfo = null;
    this.out = null;
    this.space = null;
  }

  /** Schedule the next sparse punctuation (toll or heartbeat) and re-arm. */
  private scheduleEvent(): void {
    if (!this.playing) return;
    // 7–16s between events keeps it sparse and oppressive.
    const wait = 7000 + Math.random() * 9000;
    this.eventTimer = setTimeout(() => {
      if (!this.playing) return;
      if (Math.random() < 0.6) this.toll();
      else this.heartbeat();
      this.scheduleEvent();
    }, wait);
  }

  /** A distant, decaying struck tone (bell-ish) sent through the space delay. */
  private toll(): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // A low fundamental with a couple of inharmonic partials for a dark bell.
    const partials = [
      { f: 98 + Math.random() * 8, g: 0.18 },
      { f: 196, g: 0.08 },
      { f: 263, g: 0.05 },
    ];
    const mix = ctx.createGain();
    mix.gain.value = 1;
    if (this.space) mix.connect(this.space);
    if (this.out) mix.connect(this.out);
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = p.f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(p.g, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
      osc.connect(g);
      g.connect(mix);
      osc.start(now);
      osc.stop(now + 3.3);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          /* ignore */
        }
      };
    }
    window.setTimeout(() => {
      try {
        mix.disconnect();
      } catch {
        /* ignore */
      }
    }, 3600);
  }

  /** A low, dull percussive heartbeat (two soft thumps). */
  private heartbeat(): void {
    const ctx = this.ctx;
    const base = ctx.currentTime;
    for (const offset of [0, 0.34]) {
      const t = base + offset;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g);
      if (this.out) g.connect(this.out);
      osc.start(t);
      osc.stop(t + 0.32);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          /* ignore */
        }
      };
    }
  }
}
