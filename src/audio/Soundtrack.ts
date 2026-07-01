/* =========================================================================
   SOUNDTRACK — "Gravewater Pulse", a looping grimdark cinematic score.

   This replaces the old ambient drone with a fully-arranged, continuously
   synthesised track: D natural minor at 84 BPM, the Axis minor vamp
   (Dm–Bb–F–Am7), a signature arch hook with its minor-6th leap, a dark
   drone/bell/choir palette "behind glass", a modern sidechain pump locked to the
   kick, and a full section form (theme → build → drop → peak → bridge → final →
   outro) that loops seamlessly. It is a live port of an offline numpy/scipy
   synth spec; nothing is sampled, so it stays fully IP-safe.

   Architecture: it owns a small internal mix — a sidechained "bed" bus (pads,
   hook, bass, palette), an un-ducked drum bus, and a shared convolution reverb —
   all summed through one fade gain into the music bus SoundEngine passes in. The
   note-level arrangement lives in music.ts (the look-ahead scheduler); the voice
   synthesis in voices.ts. Cheap to stop/start and click-free.
   ========================================================================= */

import { makeNoiseBuffer, makeReverbIR } from './dsp';
import { Music, type MusicNodes } from './music';
import type { Rig } from './voices';

export class Soundtrack {
  private playing = false;
  private music: Music | null = null;
  private out: GainNode | null = null;
  private bed: GainNode | null = null;
  private teardown: AudioNode[] = [];

  constructor(
    private ctx: AudioContext,
    private bus: GainNode,
  ) {}

  /** Start the score (idempotent), fading in click-free. */
  start(): void {
    if (this.playing) return;
    this.playing = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Master fade-in for the whole soundtrack. Peaks below unity to leave the
    // engine's master headroom for the SFX bus summed alongside it.
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.8, now + 4);
    out.connect(this.bus);
    this.out = out;

    // Shared convolution reverb — the dark, damped space the palette sits in.
    const conv = ctx.createConvolver();
    conv.buffer = makeReverbIR(ctx, 3.4, 3.0);
    const reverbIn = ctx.createGain();
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.9;
    reverbIn.connect(conv);
    conv.connect(reverbReturn);
    reverbReturn.connect(out);

    // Sidechained bed (pads/hook/bass/palette) + un-ducked drum bus.
    const bed = ctx.createGain();
    bed.gain.value = 1;
    bed.connect(out);
    const drums = ctx.createGain();
    drums.connect(out);
    this.bed = bed;
    this.teardown.push(conv, reverbReturn, reverbIn, bed, drums);

    const rig: Rig = { ctx, noise: makeNoiseBuffer(ctx, 2) };
    const nodes: MusicNodes = {
      bed,
      drums,
      reverb: reverbIn,
      duck: (when) => this.duck(when),
    };
    this.music = new Music(rig, nodes);
    this.music.start();
  }

  /** Sidechain pump: dip the bed on a kick, then recover — the modern "breath". */
  private duck(when: number): void {
    if (!this.bed) return;
    const g = this.bed.gain;
    const floor = 0.45;
    g.setValueAtTime(1.0, when);
    g.linearRampToValueAtTime(floor, when + 0.006);
    g.linearRampToValueAtTime(1.0, when + 0.22);
  }

  /** Stop with a short fade so there is no click. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.music?.stop();
    this.music = null;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.out;
    if (out) {
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    }
    const nodes = this.teardown.slice();
    window.setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
      try {
        out?.disconnect();
      } catch {
        /* ignore */
      }
    }, 1500);
    this.teardown = [];
    this.out = null;
    this.bed = null;
  }
}
