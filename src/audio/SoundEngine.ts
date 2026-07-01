/* =========================================================================
   SOUND ENGINE — fully procedural, IP-safe Web Audio synthesis.

   No audio files are bundled or downloaded: every sound is generated from
   oscillators and noise at runtime via a small declarative DSL, so new sounds
   are one-liners (see SOUND_LIBRARY below). Designed for a grimdark wargame —
   gritty, metallic, dark, never cartoonish.

   Headless safety: the engine never touches AudioContext at import time. The
   context is created lazily inside unlock() (after a user gesture). In
   environments without an AudioContext (tests / SSR) every method is a silent
   no-op, so importing this module is always safe.
   ========================================================================= */

import { Soundtrack } from './Soundtrack';

// --------------------------------------------------------------------- DSL

/** Oscillator waveform, plus our synthetic 'noise' source (filtered buffer). */
export type OscKind = 'sine' | 'square' | 'saw' | 'triangle' | 'noise';

/** One synthesis voice within a sound. Sources are summed into the bus. */
export interface SoundLayer {
  /** Waveform / source type. */
  osc: OscKind;
  /** Start frequency in Hz (for noise this is the filter sweep start). */
  freq: number;
  /** Optional end frequency — linearly swept over the layer duration. */
  freqEnd?: number;
  /** Layer duration in seconds. */
  dur: number;
  /** Attack time in seconds (default 0.005). */
  attack?: number;
  /** Decay/release time in seconds (default = remaining duration). */
  decay?: number;
  /** Peak gain 0..1 (default 0.5). */
  gain?: number;
  /** Optional band/low/high-pass shaping filter. */
  filter?: { type: BiquadFilterType; freq: number; q?: number };
  /** Detune in cents (constant offset). */
  detune?: number;
  /** Delay before this layer starts, in seconds (default 0). */
  delay?: number;
}

/** A complete, declarative sound. Layers play in parallel into the SFX bus. */
export interface SoundDef {
  layers: SoundLayer[];
  /** 0..1 short reverb/echo tail mixed in for a sense of cavernous space. */
  space?: number;
}

/** Per-play overrides. */
export interface PlayOpts {
  /** Linear gain scale applied to the whole sound (default 1). */
  gain?: number;
  /** Extra detune in cents applied to every tonal layer (default 0). */
  detune?: number;
  /** Disable the small random pitch jitter that varies repeats (default on). */
  noJitter?: boolean;
}

type Bus = 'master' | 'sfx' | 'music';

interface VolumeState {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
  music_enabled: boolean;
}

const STORAGE_KEY = 'gow.audio';
const DEFAULTS: VolumeState = {
  master: 0.8,
  sfx: 0.9,
  music: 0.45,
  muted: false,
  music_enabled: true,
};

/** Feature-detect a usable AudioContext constructor (guarded for headless). */
type Ctor = typeof AudioContext;
function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  return (window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) ?? null;
}

/**
 * The sound engine. One shared instance is exported as `sound`.
 *
 * Routing:  layer voices → sfx bus ─┐
 *                  soundtrack → music bus ─┼→ master gain → destination
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  /** A short shared noise buffer, reused by every 'noise' layer (no per-play alloc). */
  private noiseBuf: AudioBuffer | null = null;
  private soundtrack: Soundtrack | null = null;
  private vol: VolumeState = this.load();

  // ------------------------------------------------------------- persistence
  private load(): VolumeState {
    try {
      if (typeof localStorage === 'undefined') return { ...DEFAULTS };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const p = JSON.parse(raw) as Partial<VolumeState>;
      return {
        master: clamp01(p.master ?? DEFAULTS.master),
        sfx: clamp01(p.sfx ?? DEFAULTS.sfx),
        music: clamp01(p.music ?? DEFAULTS.music),
        muted: !!(p.muted ?? DEFAULTS.muted),
        music_enabled: p.music_enabled ?? DEFAULTS.music_enabled,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private save(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.vol));
    } catch {
      /* storage may be unavailable (private mode) — ignore. */
    }
  }

  // ------------------------------------------------------------------ unlock
  /**
   * Create/resume the AudioContext. Safe to call repeatedly; must be invoked
   * from a user gesture (pointerdown/keydown) for browsers to allow audio.
   * No-op when no AudioContext is available (headless/tests).
   */
  unlock(): void {
    const Ctor = audioCtor();
    if (!Ctor) return;
    if (!this.ctx) {
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
      this.buildBuses();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Build the master/sfx/music bus graph and the shared noise buffer once. */
  private buildBuses(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyGains();

    // Pre-render ~1s of white noise; every gritty layer reuses this buffer.
    const len = Math.floor(ctx.sampleRate * 1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.soundtrack = new Soundtrack(ctx, this.musicBus);
  }

  /** Push the current volume/mute state onto the live gain nodes. */
  private applyGains(): void {
    if (!this.ctx) return;
    const m = this.vol.muted ? 0 : this.vol.master;
    this.master.gain.value = m;
    this.sfxBus.gain.value = this.vol.sfx;
    this.musicBus.gain.value = this.vol.music;
  }

  // -------------------------------------------------------------- volume API
  setVolume(bus: Bus, v: number): void {
    this.vol[bus] = clamp01(v);
    this.applyGains();
    this.save();
  }

  getVolume(bus: Bus): number {
    return this.vol[bus];
  }

  setMuted(b: boolean): void {
    this.vol.muted = b;
    this.applyGains();
    this.save();
  }

  isMuted(): boolean {
    return this.vol.muted;
  }

  // -------------------------------------------------------------- music API
  /** Start the procedural soundtrack (idempotent). No-op if music disabled. */
  startMusic(): void {
    this.unlock();
    if (!this.ctx || !this.soundtrack) return;
    if (!this.vol.music_enabled) return;
    this.soundtrack.start();
  }

  stopMusic(): void {
    this.soundtrack?.stop();
  }

  setMusicEnabled(b: boolean): void {
    this.vol.music_enabled = b;
    this.save();
    if (b) this.startMusic();
    else this.stopMusic();
  }

  isMusicEnabled(): boolean {
    return this.vol.music_enabled;
  }

  // --------------------------------------------------------------- playback
  /** Play a named library event. Falls back to a generic blip for unknowns. */
  playEvent(name: string, opts?: PlayOpts): void {
    const def = SOUND_LIBRARY[name] ?? SOUND_LIBRARY.__fallback;
    this.play(def, opts);
  }

  /**
   * Build and fire the synthesis graph for a SoundDef. Each layer becomes an
   * oscillator (or noise source) → optional biquad → ADSR gain → sfx bus, with
   * automatic stop + disconnect when it finishes. Small random pitch jitter is
   * applied so repeated plays vary.
   */
  play(def: SoundDef, opts: PlayOpts = {}): void {
    this.unlock();
    if (!this.ctx) return; // headless / no audio
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const masterScale = opts.gain ?? 1;
    const jitter = opts.noJitter ? 0 : (Math.random() * 2 - 1) * 35; // ±35 cents

    // Optional shared "space" send: a feedback delay gives a dark, cavernous tail.
    let space: GainNode | null = null;
    let maxEnd = 0;
    if (def.space && def.space > 0) {
      space = ctx.createGain();
      space.gain.value = 0;
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.085;
      const fb = ctx.createGain();
      fb.gain.value = Math.min(0.6, def.space * 0.6);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1800;
      space.connect(delay);
      delay.connect(tone);
      tone.connect(fb);
      fb.connect(delay);
      delay.connect(this.sfxBus);
      // Open the send to the requested wet level for this sound's lifetime.
      space.gain.setValueAtTime(Math.min(1, def.space), now);
    }

    for (const layer of def.layers) {
      const start = now + (layer.delay ?? 0);
      const dur = Math.max(0.01, layer.dur);
      const attack = Math.max(0.001, layer.attack ?? 0.005);
      const decay = layer.decay ?? Math.max(0.01, dur - attack);
      const peak = (layer.gain ?? 0.5) * masterScale;
      const end = start + attack + decay;
      maxEnd = Math.max(maxEnd, end);

      // --- source ---
      let source: AudioScheduledSourceNode;
      let freqParam: AudioParam | null = null;
      if (layer.osc === 'noise') {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        source = src;
      } else {
        const osc = ctx.createOscillator();
        osc.type = layer.osc === 'saw' ? 'sawtooth' : layer.osc;
        const detune = (layer.detune ?? 0) + (opts.detune ?? 0) + jitter;
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(layer.freq, start);
        if (layer.freqEnd !== undefined) {
          osc.frequency.linearRampToValueAtTime(Math.max(1, layer.freqEnd), end);
        }
        freqParam = osc.frequency;
        source = osc;
      }

      // --- optional filter (noise layers sweep the filter via freq/freqEnd) ---
      let node: AudioNode = source;
      if (layer.filter) {
        const biq = ctx.createBiquadFilter();
        biq.type = layer.filter.type;
        biq.Q.value = layer.filter.q ?? 1;
        biq.frequency.setValueAtTime(layer.filter.freq, start);
        node.connect(biq);
        node = biq;
      } else if (layer.osc === 'noise') {
        // Default-shape noise with a sweeping bandpass for "grit".
        const biq = ctx.createBiquadFilter();
        biq.type = 'bandpass';
        biq.Q.value = 0.9;
        biq.frequency.setValueAtTime(layer.freq, start);
        if (layer.freqEnd !== undefined) {
          biq.frequency.linearRampToValueAtTime(Math.max(20, layer.freqEnd), end);
        }
        node.connect(biq);
        node = biq;
      }
      // Suppress the unused warning when a tonal layer has no sweep.
      void freqParam;

      // --- ADSR gain ---
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      node.connect(env);
      env.connect(this.sfxBus);
      if (space) env.connect(space);

      source.start(start);
      source.stop(end + 0.02);
      // Disconnect the whole little chain once the source ends.
      source.onended = () => {
        try {
          source.disconnect();
          env.disconnect();
        } catch {
          /* already torn down */
        }
      };
    }

    // Tear down the space send shortly after the last layer ends.
    if (space) {
      const s = space;
      const killAt = (maxEnd - now + 0.6) * 1000;
      window.setTimeout(() => {
        try {
          s.disconnect();
        } catch {
          /* ignore */
        }
      }, Math.max(0, killAt));
    }
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/* =========================================================================
   NAMED LIBRARY — one declarative entry per game action/event.

   Tuning notes: low fundamentals + sawtooth/noise + lowpass/bandpass give the
   gritty, metallic, oppressive grimdark character. UI sounds stay terse and
   dark rather than bright/cartoonish.
   ========================================================================= */
export const SOUND_LIBRARY: Record<string, SoundDef> = {
  // --- UI ---
  ui_click: {
    layers: [
      { osc: 'square', freq: 220, freqEnd: 130, dur: 0.07, attack: 0.001, decay: 0.06, gain: 0.18 },
      { osc: 'noise', freq: 2600, freqEnd: 900, dur: 0.05, attack: 0.001, decay: 0.04, gain: 0.12 },
    ],
  },
  ui_hover: {
    layers: [{ osc: 'sine', freq: 520, freqEnd: 640, dur: 0.05, attack: 0.002, decay: 0.045, gain: 0.06 }],
  },
  ui_cancel: {
    layers: [
      { osc: 'square', freq: 200, freqEnd: 90, dur: 0.13, attack: 0.001, decay: 0.12, gain: 0.18 },
      { osc: 'saw', freq: 150, freqEnd: 70, dur: 0.13, gain: 0.1 },
    ],
  },
  toggle: {
    layers: [
      { osc: 'square', freq: 320, freqEnd: 180, dur: 0.06, attack: 0.001, decay: 0.05, gain: 0.16 },
      { osc: 'noise', freq: 3200, freqEnd: 1200, dur: 0.04, gain: 0.1 },
    ],
  },

  // --- flow / structure ---
  phase_change: {
    layers: [
      // D3 → A3 fifth swell, over a struck low D bell — a ceremonial cue in-key
      // with the score (Gravewater Pulse is D minor).
      { osc: 'sine', freq: 146.83, freqEnd: 220, dur: 0.5, attack: 0.02, decay: 0.46, gain: 0.2 },
      { osc: 'triangle', freq: 73.42, dur: 0.5, gain: 0.16 },
      { osc: 'sine', freq: 130, dur: 0.9, attack: 0.002, decay: 0.88, gain: 0.12 },
      { osc: 'noise', freq: 600, freqEnd: 200, dur: 0.4, gain: 0.05 },
    ],
    space: 0.35,
  },
  turn_start: {
    layers: [
      { osc: 'saw', freq: 73.42, freqEnd: 110, dur: 0.7, attack: 0.04, decay: 0.6, gain: 0.2, filter: { type: 'lowpass', freq: 700, q: 4 } },
      { osc: 'sine', freq: 146.83, dur: 0.7, gain: 0.16 },
      { osc: 'sine', freq: 220, dur: 0.6, delay: 0.06, gain: 0.1 },
      // distant war-horn swell rising a fifth
      { osc: 'saw', freq: 98, freqEnd: 146.83, dur: 0.85, delay: 0.05, attack: 0.12, decay: 0.7, gain: 0.12, filter: { type: 'lowpass', freq: 900, q: 2 } },
    ],
    space: 0.5,
  },
  command_point: {
    layers: [
      { osc: 'sine', freq: 880, freqEnd: 1320, dur: 0.18, attack: 0.003, decay: 0.16, gain: 0.14 },
      { osc: 'triangle', freq: 440, dur: 0.2, gain: 0.1 },
    ],
    space: 0.2,
  },

  // --- dice ---
  dice_roll: {
    layers: [
      { osc: 'noise', freq: 1800, freqEnd: 3000, dur: 0.28, attack: 0.005, decay: 0.26, gain: 0.2, filter: { type: 'bandpass', freq: 2200, q: 0.7 } },
      { osc: 'square', freq: 180, freqEnd: 90, dur: 0.2, gain: 0.06 },
    ],
  },
  dice_settle: {
    layers: [
      { osc: 'noise', freq: 1200, freqEnd: 300, dur: 0.12, attack: 0.001, decay: 0.11, gain: 0.16, filter: { type: 'bandpass', freq: 900, q: 1.2 } },
      { osc: 'square', freq: 120, freqEnd: 60, dur: 0.1, gain: 0.1 },
    ],
  },

  // --- movement ---
  move: {
    layers: [
      { osc: 'noise', freq: 500, freqEnd: 200, dur: 0.32, attack: 0.04, decay: 0.28, gain: 0.12, filter: { type: 'lowpass', freq: 600, q: 0.7 } },
      { osc: 'saw', freq: 80, freqEnd: 60, dur: 0.3, gain: 0.08 },
    ],
  },
  advance: {
    layers: [
      { osc: 'noise', freq: 700, freqEnd: 300, dur: 0.42, attack: 0.03, decay: 0.38, gain: 0.14, filter: { type: 'lowpass', freq: 900, q: 0.8 } },
      { osc: 'saw', freq: 95, freqEnd: 70, dur: 0.4, gain: 0.08 },
    ],
  },
  deep_strike: {
    layers: [
      { osc: 'sine', freq: 1400, freqEnd: 120, dur: 0.6, attack: 0.005, decay: 0.55, gain: 0.18 },
      { osc: 'saw', freq: 220, freqEnd: 55, dur: 0.6, gain: 0.14, filter: { type: 'lowpass', freq: 1200, q: 6 } },
      { osc: 'noise', freq: 3000, freqEnd: 400, dur: 0.5, gain: 0.12 },
    ],
    space: 0.5,
  },
  charge: {
    layers: [
      { osc: 'saw', freq: 110, freqEnd: 260, dur: 0.55, attack: 0.02, decay: 0.5, gain: 0.22, filter: { type: 'lowpass', freq: 1400, q: 3 } },
      { osc: 'square', freq: 55, freqEnd: 130, dur: 0.55, gain: 0.14 },
      { osc: 'noise', freq: 800, freqEnd: 2400, dur: 0.5, gain: 0.1 },
    ],
    space: 0.35,
  },

  // --- shooting (weapon families) ---
  shoot_gauss: {
    layers: [
      { osc: 'saw', freq: 900, freqEnd: 240, dur: 0.32, attack: 0.002, decay: 0.3, gain: 0.2, filter: { type: 'bandpass', freq: 1400, q: 5 } },
      { osc: 'square', freq: 1800, freqEnd: 600, dur: 0.2, gain: 0.1 },
      { osc: 'noise', freq: 4000, freqEnd: 1500, dur: 0.25, gain: 0.08 },
    ],
    space: 0.25,
  },
  shoot_bolter: {
    layers: [
      // sharp mechanical crack of the mass-reactive round detonating
      { osc: 'noise', freq: 5200, freqEnd: 1800, dur: 0.05, attack: 0.0005, decay: 0.045, gain: 0.22, filter: { type: 'highpass', freq: 2600 } },
      { osc: 'square', freq: 160, freqEnd: 70, dur: 0.16, attack: 0.001, decay: 0.14, gain: 0.26 },
      { osc: 'noise', freq: 2200, freqEnd: 500, dur: 0.14, gain: 0.2, filter: { type: 'bandpass', freq: 1600, q: 0.8 } },
      { osc: 'saw', freq: 90, freqEnd: 44, dur: 0.18, gain: 0.14, filter: { type: 'lowpass', freq: 600 } },
    ],
    space: 0.15,
  },
  shoot_plasma: {
    layers: [
      { osc: 'sine', freq: 700, freqEnd: 1600, dur: 0.26, attack: 0.004, decay: 0.24, gain: 0.18 },
      { osc: 'saw', freq: 350, freqEnd: 180, dur: 0.26, gain: 0.12, filter: { type: 'bandpass', freq: 1200, q: 4 } },
      { osc: 'noise', freq: 3000, freqEnd: 800, dur: 0.22, gain: 0.12 },
    ],
    space: 0.3,
  },
  shoot_heavy: {
    layers: [
      { osc: 'square', freq: 90, freqEnd: 45, dur: 0.4, attack: 0.002, decay: 0.38, gain: 0.3 },
      { osc: 'saw', freq: 60, freqEnd: 35, dur: 0.4, gain: 0.18, filter: { type: 'lowpass', freq: 500, q: 2 } },
      { osc: 'noise', freq: 1400, freqEnd: 300, dur: 0.35, gain: 0.16 },
      // deep sub-boom recoil tail
      { osc: 'sine', freq: 70, freqEnd: 30, dur: 0.55, delay: 0.02, attack: 0.004, decay: 0.5, gain: 0.24 },
    ],
    space: 0.4,
  },

  // --- melee ---
  melee_swing: {
    layers: [
      { osc: 'noise', freq: 600, freqEnd: 2600, dur: 0.18, attack: 0.005, decay: 0.16, gain: 0.16, filter: { type: 'bandpass', freq: 1500, q: 0.7 } },
      { osc: 'saw', freq: 130, freqEnd: 240, dur: 0.16, gain: 0.08 },
    ],
  },
  melee_hit: {
    layers: [
      { osc: 'square', freq: 240, freqEnd: 90, dur: 0.16, attack: 0.001, decay: 0.14, gain: 0.26 },
      { osc: 'noise', freq: 3200, freqEnd: 700, dur: 0.1, gain: 0.18, filter: { type: 'highpass', freq: 1200 } },
      { osc: 'saw', freq: 70, dur: 0.18, gain: 0.14 },
      // metallic ring of blade-on-armour
      { osc: 'square', freq: 1760, freqEnd: 1560, dur: 0.24, delay: 0.005, attack: 0.001, decay: 0.23, gain: 0.1, filter: { type: 'bandpass', freq: 2100, q: 9 } },
    ],
    space: 0.28,
  },
  save_clang: {
    layers: [
      { osc: 'square', freq: 1900, freqEnd: 1500, dur: 0.22, attack: 0.001, decay: 0.2, gain: 0.16, filter: { type: 'bandpass', freq: 2400, q: 8 } },
      { osc: 'triangle', freq: 950, dur: 0.2, gain: 0.1 },
      { osc: 'noise', freq: 5000, freqEnd: 2000, dur: 0.08, gain: 0.12 },
    ],
    space: 0.3,
  },

  // --- damage / death ---
  wound_thud: {
    layers: [
      { osc: 'sine', freq: 140, freqEnd: 60, dur: 0.2, attack: 0.002, decay: 0.18, gain: 0.26 },
      { osc: 'noise', freq: 500, freqEnd: 120, dur: 0.16, gain: 0.14, filter: { type: 'lowpass', freq: 500, q: 1 } },
    ],
  },
  mortal_wound: {
    layers: [
      { osc: 'sine', freq: 220, freqEnd: 50, dur: 0.45, attack: 0.002, decay: 0.42, gain: 0.24 },
      { osc: 'saw', freq: 110, freqEnd: 40, dur: 0.45, gain: 0.16, filter: { type: 'lowpass', freq: 800, q: 5 } },
      { osc: 'noise', freq: 1800, freqEnd: 200, dur: 0.4, gain: 0.12 },
    ],
    space: 0.4,
  },
  model_death: {
    layers: [
      { osc: 'saw', freq: 180, freqEnd: 45, dur: 0.5, attack: 0.003, decay: 0.47, gain: 0.22, filter: { type: 'lowpass', freq: 700, q: 3 } },
      { osc: 'noise', freq: 1200, freqEnd: 150, dur: 0.45, gain: 0.18 },
      { osc: 'sine', freq: 90, freqEnd: 40, dur: 0.5, gain: 0.16 },
    ],
    space: 0.4,
  },
  unit_destroyed: {
    layers: [
      { osc: 'saw', freq: 130, freqEnd: 35, dur: 0.9, attack: 0.01, decay: 0.85, gain: 0.26, filter: { type: 'lowpass', freq: 600, q: 4 } },
      { osc: 'square', freq: 65, freqEnd: 30, dur: 0.9, gain: 0.2 },
      { osc: 'noise', freq: 2000, freqEnd: 120, dur: 0.8, gain: 0.2 },
      { osc: 'sine', freq: 200, freqEnd: 48, dur: 0.7, delay: 0.05, gain: 0.12 },
    ],
    space: 0.6,
  },

  // --- objectives / stratagems ---
  objective_captured: {
    layers: [
      { osc: 'sine', freq: 262, freqEnd: 392, dur: 0.6, attack: 0.02, decay: 0.55, gain: 0.2 },
      { osc: 'triangle', freq: 196, dur: 0.6, gain: 0.14 },
      { osc: 'sine', freq: 523, dur: 0.5, delay: 0.12, gain: 0.12 },
    ],
    space: 0.5,
  },
  stratagem: {
    layers: [
      { osc: 'saw', freq: 130, freqEnd: 330, dur: 0.5, attack: 0.01, decay: 0.46, gain: 0.2, filter: { type: 'bandpass', freq: 1100, q: 3 } },
      { osc: 'square', freq: 660, freqEnd: 990, dur: 0.3, gain: 0.1 },
      { osc: 'noise', freq: 2400, freqEnd: 4000, dur: 0.3, gain: 0.08 },
    ],
    space: 0.35,
  },

  // --- terminal ---
  victory: {
    layers: [
      // a rising, resolving D-major fanfare (the one bright cadence)
      { osc: 'sine', freq: 146.83, freqEnd: 293.66, dur: 1.4, attack: 0.05, decay: 1.3, gain: 0.24 },
      { osc: 'triangle', freq: 73.42, dur: 1.5, gain: 0.18 },
      { osc: 'sine', freq: 220, dur: 1.2, delay: 0.16, gain: 0.16 }, // A
      { osc: 'triangle', freq: 369.99, dur: 1.1, delay: 0.32, gain: 0.13 }, // F# (major third)
      { osc: 'sine', freq: 587.33, dur: 1.0, delay: 0.5, gain: 0.12 }, // D5
    ],
    space: 0.75,
  },
  defeat: {
    layers: [
      // a sinking D-minor descent with a mourning cracked-bell partial
      { osc: 'sine', freq: 174.61, freqEnd: 110, dur: 1.6, attack: 0.05, decay: 1.5, gain: 0.24 }, // F → A fall
      { osc: 'saw', freq: 98, freqEnd: 55, dur: 1.7, gain: 0.16, filter: { type: 'lowpass', freq: 600, q: 3 } },
      { osc: 'sine', freq: 146.83, freqEnd: 73.42, dur: 1.5, delay: 0.2, gain: 0.16 }, // D3 → D2
      { osc: 'sine', freq: 130, dur: 2.0, delay: 0.1, attack: 0.003, decay: 1.9, gain: 0.1 }, // dark bell hum
    ],
    space: 0.75,
  },
  error: {
    layers: [
      { osc: 'square', freq: 160, freqEnd: 120, dur: 0.22, attack: 0.001, decay: 0.2, gain: 0.2 },
      { osc: 'saw', freq: 90, dur: 0.22, gain: 0.12, filter: { type: 'lowpass', freq: 500 } },
    ],
  },

  // --- generic fallback for any unmapped name ---
  __fallback: {
    layers: [{ osc: 'sine', freq: 300, freqEnd: 200, dur: 0.08, attack: 0.002, decay: 0.07, gain: 0.1 }],
  },
};

/** The shared, app-wide sound engine instance. */
export const sound = new SoundEngine();
