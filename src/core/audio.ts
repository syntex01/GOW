import { save } from './save'

/**
 * Fully procedural audio. Every sound effect and every note of the score is
 * synthesised with the Web Audio API at runtime, so the game ships without a
 * single audio file and stays tiny.
 */

export type SfxName =
  | 'ui_click'
  | 'ui_hover'
  | 'ui_denied'
  | 'coin'
  | 'spawn'
  | 'melee_light'
  | 'melee_heavy'
  | 'bow'
  | 'arrow_hit'
  | 'gunshot'
  | 'machinegun'
  | 'cannon'
  | 'explosion'
  | 'explosion_big'
  | 'laser'
  | 'railgun'
  | 'plasma'
  | 'death'
  | 'death_mech'
  | 'base_hit'
  | 'evolve'
  | 'ability'
  | 'victory'
  | 'defeat'
  | 'heal'
  | 'shield'

/** Minor-key palettes that shift as the player advances through the ages. */
const AGE_SCALES: number[][] = [
  [0, 3, 5, 7, 10], // Stone — pentatonic minor, primal
  [0, 2, 3, 5, 7, 8, 10], // Medieval — natural minor
  [0, 2, 3, 5, 7, 9, 10], // Renaissance — dorian, brighter
  [0, 2, 3, 5, 6, 7, 10], // Modern — with a tritone bite
  [0, 1, 3, 5, 6, 8, 10] // Future — locrian-ish, alien
]

const AGE_ROOTS = [55, 58.27, 61.74, 49, 51.91] // A1, Bb1, B1, G1, Ab1

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private noiseBuffer: AudioBuffer | null = null

  private musicTimer: number | null = null
  private nextNoteTime = 0
  private step = 0
  private age = 0
  private intensity = 0
  private musicRunning = false
  private started = false

  /** Throttling so a hundred simultaneous gunshots do not blow out the mix. */
  private lastPlayed = new Map<SfxName, number>()
  private voiceCount = 0

  /** Must be called from inside a user gesture handler. */
  unlock(): void {
    if (this.started) {
      void this.ctx?.resume()
      return
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      this.ctx = ctx
      this.compressor = ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -14
      this.compressor.knee.value = 24
      this.compressor.ratio.value = 8
      this.compressor.attack.value = 0.004
      this.compressor.release.value = 0.22

      this.master = ctx.createGain()
      this.master.gain.value = 0.9
      this.musicBus = ctx.createGain()
      this.musicBus.gain.value = save.settings.musicVolume
      this.sfxBus = ctx.createGain()
      this.sfxBus.gain.value = save.settings.sfxVolume

      this.musicBus.connect(this.compressor)
      this.sfxBus.connect(this.compressor)
      this.compressor.connect(this.master)
      this.master.connect(ctx.destination)

      this.noiseBuffer = this.buildNoiseBuffer(ctx)
      this.started = true
      void ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 2)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let brown = 0
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1
      // A touch of brown noise makes explosions feel weightier than pure white.
      brown = (brown + 0.02 * white) / 1.02
      data[i] = white * 0.75 + brown * 4
    }
    return buffer
  }

  applyVolumes(): void {
    if (this.musicBus) this.musicBus.gain.value = save.settings.musicVolume
    if (this.sfxBus) this.sfxBus.gain.value = save.settings.sfxVolume
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  private noise(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    return src
  }

  private env(peak: number, attack: number, decay: number, at: number): GainNode | null {
    if (!this.ctx) return null
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    return gain
  }

  private track(node: AudioScheduledSourceNode, stopAt: number): void {
    this.voiceCount += 1
    node.onended = () => {
      this.voiceCount -= 1
    }
    node.stop(stopAt)
  }

  /**
   * Plays a synthesised effect. `variation` (0..1) detunes the sound so
   * repeated hits do not sound like a machine.
   */
  play(name: SfxName, volume = 1, variation = Math.random()): void {
    if (!this.ctx || !this.sfxBus || save.settings.sfxVolume <= 0) return
    if (this.voiceCount > 48) return

    const now = this.now()
    const throttle = SFX_THROTTLE[name] ?? 0
    const last = this.lastPlayed.get(name) ?? -1
    if (throttle > 0 && now - last < throttle) return
    this.lastPlayed.set(name, now)

    const out = this.sfxBus
    const v = Math.max(0, Math.min(1.6, volume))

    switch (name) {
      case 'ui_click':
        this.blip(660 + variation * 40, 0.05, 0.06 * v, 'square', out)
        break
      case 'ui_hover':
        this.blip(880 + variation * 60, 0.03, 0.025 * v, 'sine', out)
        break
      case 'ui_denied':
        this.sweep(220, 110, 0.18, 0.09 * v, 'sawtooth', out)
        break
      case 'coin':
        this.blip(1180, 0.04, 0.05 * v, 'triangle', out)
        this.blip(1560, 0.07, 0.04 * v, 'triangle', out, 0.045)
        break
      case 'spawn':
        this.sweep(180, 320, 0.16, 0.07 * v, 'triangle', out)
        break
      case 'melee_light':
        this.burst(0.06, 2600 + variation * 900, 0.16 * v, out, 'highpass')
        this.blip(420 + variation * 120, 0.05, 0.05 * v, 'square', out)
        break
      case 'melee_heavy':
        this.burst(0.13, 900 + variation * 350, 0.24 * v, out, 'bandpass')
        this.sweep(160, 60, 0.16, 0.16 * v, 'sine', out)
        break
      case 'bow':
        this.burst(0.1, 3200, 0.1 * v, out, 'highpass')
        this.sweep(900, 2400, 0.09, 0.05 * v, 'sine', out)
        break
      case 'arrow_hit':
        this.burst(0.05, 1500, 0.12 * v, out, 'bandpass')
        this.sweep(240, 120, 0.07, 0.08 * v, 'triangle', out)
        break
      case 'gunshot':
        this.burst(0.09, 1800 + variation * 700, 0.3 * v, out, 'bandpass')
        this.sweep(220, 55, 0.13, 0.22 * v, 'sine', out)
        break
      case 'machinegun':
        this.burst(0.05, 2400, 0.18 * v, out, 'bandpass')
        this.sweep(180, 70, 0.06, 0.12 * v, 'square', out)
        break
      case 'cannon':
        this.burst(0.42, 420, 0.42 * v, out, 'lowpass')
        this.sweep(130, 32, 0.5, 0.4 * v, 'sine', out)
        break
      case 'explosion':
        this.burst(0.55, 900, 0.4 * v, out, 'lowpass')
        this.sweep(160, 34, 0.6, 0.36 * v, 'sine', out)
        break
      case 'explosion_big':
        this.burst(1.1, 640, 0.55 * v, out, 'lowpass')
        this.sweep(120, 24, 1.2, 0.5 * v, 'sine', out)
        this.burst(0.3, 3000, 0.2 * v, out, 'highpass')
        break
      case 'laser':
        this.sweep(1800 + variation * 400, 320, 0.16, 0.16 * v, 'sawtooth', out)
        this.blip(2600, 0.05, 0.06 * v, 'sine', out)
        break
      case 'railgun':
        this.sweep(90, 2600, 0.24, 0.2 * v, 'sawtooth', out)
        this.burst(0.3, 5200, 0.2 * v, out, 'highpass')
        break
      case 'plasma':
        this.sweep(700, 180, 0.3, 0.18 * v, 'square', out)
        this.burst(0.24, 1400, 0.14 * v, out, 'bandpass')
        break
      case 'death':
        this.sweep(320, 90, 0.26, 0.13 * v, 'sawtooth', out)
        this.burst(0.16, 700, 0.1 * v, out, 'lowpass')
        break
      case 'death_mech':
        this.sweep(180, 40, 0.5, 0.2 * v, 'square', out)
        this.burst(0.4, 500, 0.2 * v, out, 'lowpass')
        break
      case 'base_hit':
        this.burst(0.3, 300, 0.3 * v, out, 'lowpass')
        this.sweep(90, 45, 0.34, 0.26 * v, 'sine', out)
        break
      case 'evolve':
        this.chord([440, 554.37, 659.25, 880], 0.9, 0.13 * v, out)
        this.sweep(220, 1760, 0.7, 0.09 * v, 'triangle', out)
        break
      case 'ability':
        this.sweep(120, 900, 0.6, 0.2 * v, 'sawtooth', out)
        this.chord([146.83, 220, 293.66], 0.7, 0.12 * v, out)
        break
      case 'victory':
        this.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.16, 0.13 * v, out)
        break
      case 'defeat':
        this.arpeggio([392, 349.23, 311.13, 233.08], 0.24, 0.13 * v, out)
        break
      case 'heal':
        this.sweep(520, 1040, 0.28, 0.08 * v, 'sine', out)
        break
      case 'shield':
        this.blip(300, 0.22, 0.1 * v, 'triangle', out)
        this.blip(450, 0.3, 0.07 * v, 'sine', out, 0.05)
        break
    }
  }

  private blip(
    freq: number,
    duration: number,
    peak: number,
    type: OscillatorType,
    out: AudioNode,
    delay = 0
  ): void {
    if (!this.ctx) return
    const at = this.now() + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    const gain = this.env(peak, 0.005, duration, at)
    if (!gain) return
    osc.connect(gain).connect(out)
    osc.start(at)
    this.track(osc, at + duration + 0.05)
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    peak: number,
    type: OscillatorType,
    out: AudioNode
  ): void {
    if (!this.ctx) return
    const at = this.now()
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration)
    const gain = this.env(peak, 0.006, duration, at)
    if (!gain) return
    osc.connect(gain).connect(out)
    osc.start(at)
    this.track(osc, at + duration + 0.05)
  }

  private burst(
    duration: number,
    cutoff: number,
    peak: number,
    out: AudioNode,
    filterType: BiquadFilterType
  ): void {
    if (!this.ctx) return
    const src = this.noise()
    if (!src) return
    const at = this.now()
    const filter = this.ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency.setValueAtTime(cutoff, at)
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.25), at + duration)
    filter.Q.value = filterType === 'bandpass' ? 1.4 : 0.8
    const gain = this.env(peak, 0.004, duration, at)
    if (!gain) return
    src.connect(filter).connect(gain).connect(out)
    src.start(at)
    this.track(src, at + duration + 0.05)
  }

  private chord(freqs: number[], duration: number, peak: number, out: AudioNode): void {
    freqs.forEach((f, i) => this.blip(f, duration, peak, i % 2 === 0 ? 'triangle' : 'sine', out, i * 0.012))
  }

  private arpeggio(freqs: number[], step: number, peak: number, out: AudioNode): void {
    freqs.forEach((f, i) => this.blip(f, step * 1.8, peak, 'triangle', out, i * step))
  }

  // ---------------------------------------------------------------------------
  // Generative score
  // ---------------------------------------------------------------------------

  startMusic(age = 0): void {
    if (!this.ctx || this.musicRunning) return
    this.age = age
    this.musicRunning = true
    this.step = 0
    this.nextNoteTime = this.now() + 0.1
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 60)
  }

  stopMusic(): void {
    this.musicRunning = false
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer)
      this.musicTimer = null
    }
  }

  /** 0 = calm, 1 = all-out war. Drives drum density and layer count. */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value))
  }

  setAge(age: number): void {
    this.age = Math.max(0, Math.min(AGE_SCALES.length - 1, age))
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicBus || !this.musicRunning) return
    if (save.settings.musicVolume <= 0) return
    const lookahead = 0.35
    const bpm = 78 + this.age * 6 + this.intensity * 26
    const stepDuration = 60 / bpm / 2 // eighth notes

    while (this.nextNoteTime < this.now() + lookahead) {
      this.playMusicStep(this.step, this.nextNoteTime, stepDuration)
      this.step = (this.step + 1) % 64
      this.nextNoteTime += stepDuration
    }
  }

  private playMusicStep(step: number, at: number, dur: number): void {
    if (!this.ctx || !this.musicBus) return
    const scale = AGE_SCALES[this.age]
    const root = AGE_ROOTS[this.age]
    const bar = Math.floor(step / 16)
    const degrees = [0, 5, 3, 4]
    const chordRoot = root * Math.pow(2, degrees[bar % degrees.length] / 12)

    // Bass on the downbeats.
    if (step % 4 === 0) {
      this.musicNote(chordRoot, at, dur * 3.4, 0.13, 'triangle', 260)
    }
    // Sustained pad every bar.
    if (step % 16 === 0) {
      const third = chordRoot * Math.pow(2, scale[2] / 12)
      const fifth = chordRoot * Math.pow(2, scale[4] / 12)
      this.musicNote(chordRoot * 2, at, dur * 14, 0.045, 'sine', 900)
      this.musicNote(third * 2, at, dur * 14, 0.035, 'sine', 900)
      this.musicNote(fifth * 2, at, dur * 14, 0.03, 'sine', 900)
    }
    // Arpeggio layer joins as the battle heats up.
    if (this.intensity > 0.25 && step % 2 === 0) {
      const degree = scale[(step / 2) % scale.length]
      const freq = chordRoot * 4 * Math.pow(2, degree / 12)
      this.musicNote(freq, at, dur * 1.4, 0.03 + this.intensity * 0.03, 'square', 2200)
    }
    // Percussion.
    if (step % 8 === 0) this.drum(at, 'kick')
    if (this.intensity > 0.15 && step % 8 === 4) this.drum(at, 'snare')
    if (this.intensity > 0.5 && step % 2 === 1) this.drum(at, 'hat')
    if (this.intensity > 0.8 && step % 16 === 14) this.drum(at, 'kick')
  }

  private musicNote(
    freq: number,
    at: number,
    duration: number,
    peak: number,
    type: OscillatorType,
    cutoff: number
  ): void {
    if (!this.ctx || !this.musicBus) return
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.08, duration * 0.25))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(filter).connect(gain).connect(this.musicBus)
    osc.start(at)
    osc.stop(at + duration + 0.05)
  }

  private drum(at: number, kind: 'kick' | 'snare' | 'hat'): void {
    if (!this.ctx || !this.musicBus) return
    if (kind === 'kick') {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(140, at)
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.16)
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0.22, at)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
      osc.connect(gain).connect(this.musicBus)
      osc.start(at)
      osc.stop(at + 0.25)
      return
    }
    const src = this.noise()
    if (!src) return
    const filter = this.ctx.createBiquadFilter()
    const gain = this.ctx.createGain()
    if (kind === 'snare') {
      filter.type = 'bandpass'
      filter.frequency.value = 1900
      gain.gain.setValueAtTime(0.11, at)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15)
      src.connect(filter).connect(gain).connect(this.musicBus)
      src.start(at)
      src.stop(at + 0.18)
    } else {
      filter.type = 'highpass'
      filter.frequency.value = 7000
      gain.gain.setValueAtTime(0.045, at)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
      src.connect(filter).connect(gain).connect(this.musicBus)
      src.start(at)
      src.stop(at + 0.07)
    }
  }
}

/** Minimum seconds between repeats of the same effect. */
const SFX_THROTTLE: Partial<Record<SfxName, number>> = {
  melee_light: 0.045,
  melee_heavy: 0.06,
  gunshot: 0.05,
  machinegun: 0.035,
  bow: 0.05,
  arrow_hit: 0.04,
  laser: 0.05,
  plasma: 0.06,
  death: 0.07,
  coin: 0.08,
  explosion: 0.06,
  base_hit: 0.12,
  spawn: 0.08
}

export const audio = new AudioEngine()
