/**
 * "Gravewater Pulse" — the looping grimdark cinematic score, ported live from
 * the offline build spec. D natural minor, 84 BPM, the Axis minor vamp
 * (Dm–Bb–F–Am7 = i–VI–III–v7), the signature arch hook with its m6 leap, a dark
 * drone/bell palette "behind glass", and a modern sidechain pump locked to the
 * kick. Uses the standard Web Audio look-ahead scheduler ("two clocks"): a
 * coarse timer wakes up ~every 100 ms and schedules any bars that fall inside a
 * short look-ahead window, so timing rides the sample-accurate audio clock and
 * never drifts with the main thread.
 */
import { BAR, BEAT, STEP, noteFreq } from './dsp';
import type { Rig } from './voices';
import * as V from './voices';

/** Destinations + the sidechain hook the scheduler renders into. */
export interface MusicNodes {
  /** Ducked bus — pads, hook, bass, palette (breathes with the kick). */
  bed: AudioNode;
  /** Un-ducked bus — the drum kit. */
  drums: AudioNode;
  /** Reverb send (palette/bell/choir go here too). */
  reverb: AudioNode;
  /** Pump the bed down on a kick at `when`. */
  duck: (when: number) => void;
}

/* -------------------------- harmony + melody tables ---------------------- */

// The four-bar Axis vamp, one chord per bar. Voicings kept in the mid register.
const VAMP: Array<{ root: string; pad: string[] }> = [
  { root: 'D2', pad: ['D3', 'F3', 'A3', 'D4'] }, // i   Dm
  { root: 'Bb1', pad: ['Bb2', 'D3', 'F3', 'Bb3'] }, // VI  Bb
  { root: 'F2', pad: ['F3', 'A3', 'C4', 'F4'] }, // III F
  { root: 'A1', pad: ['A2', 'E3', 'G3', 'C4'] }, // v7  Am7
];

// Peak reharm: the darkest bar sits on Eb (Phrygian bII) — max tension.
const EB_REHARM = { root: 'Eb2', pad: ['Eb3', 'G3', 'Bb3', 'Eb4'] };

// The canonical hook, per bar of the 4-bar phrase: [beatOffset, durBeats, note].
const HOOK: Array<Array<[number, number, string]>> = [
  // Bar 1 (Dm): A4 → the signature minor-6th leap up to a held F5 → E5
  [
    [0, 1.5, 'A4'],
    [1.5, 0.5, 'D5'],
    [2, 0.5, 'F5'],
    [2.5, 1.5, 'E5'],
  ],
  // Bar 2 (Bb)
  [
    [0, 1, 'D5'],
    [1, 0.5, 'F5'],
    [1.5, 0.5, 'E5'],
    [2, 1, 'D5'],
    [3, 0.5, 'C5'],
    [3.5, 0.5, 'D5'],
  ],
  // Bar 3 (F)
  [
    [0, 1.5, 'A4'],
    [1.5, 0.5, 'C5'],
    [2, 1, 'D5'],
    [3, 1, 'A4'],
  ],
  // Bar 4 (Am7): lands on the 5th (A) and HANGS — the open-loop earworm tail
  [
    [0, 0.5, 'G4'],
    [0.5, 0.5, 'A4'],
    [1, 1, 'C5'],
    [2, 2, 'A4'],
  ],
];

// Cello counter-melody (contrary motion), one sustained note per bar.
const COUNTER = ['F3', 'D3', 'C3', 'E3'];

/* ------------------------------- song form ------------------------------ */

type SectionName = 'theme' | 'build' | 'drop' | 'peak' | 'bridge' | 'final' | 'outro';
interface Section {
  name: SectionName;
  bars: number;
}

// Every section is a multiple of 4 bars so the vamp + hook phrase stay aligned.
const FORM: Section[] = [
  { name: 'theme', bars: 8 },
  { name: 'build', bars: 4 },
  { name: 'drop', bars: 8 },
  { name: 'peak', bars: 8 },
  { name: 'bridge', bars: 4 },
  { name: 'final', bars: 8 },
  { name: 'outro', bars: 4 },
];
const FORM_BARS = FORM.reduce((a, s) => a + s.bars, 0); // 44 bars ≈ 2:06 loop

function sectionAt(bar: number): { section: SectionName; barInSection: number } {
  let b = bar % FORM_BARS;
  for (const s of FORM) {
    if (b < s.bars) return { section: s.name, barInSection: b };
    b -= s.bars;
  }
  return { section: 'theme', barInSection: 0 };
}

export class Music {
  private timer: number | null = null;
  private nextBarTime = 0;
  private barIndex = 0;
  private running = false;

  constructor(
    private rig: Rig,
    private nodes: MusicNodes,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.barIndex = 0;
    this.nextBarTime = this.rig.ctx.currentTime + 0.15;
    this.timer = window.setInterval(() => this.tick(), 90);
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!this.running) return;
    const ctx = this.rig.ctx;
    const lookahead = 0.5;
    while (this.nextBarTime < ctx.currentTime + lookahead) {
      this.scheduleBar(this.barIndex, this.nextBarTime);
      this.nextBarTime += BAR;
      this.barIndex++;
    }
  }

  /* ----------------------------- per-bar render -------------------------- */

  private scheduleBar(bar: number, when: number): void {
    const { section, barInSection } = sectionAt(bar);
    const vampPos = bar % 4;
    let chord = VAMP[vampPos];
    // Peak: reharmonise the 3rd bar of a phrase onto Eb(bII) for the darkest hit.
    if (section === 'peak' && vampPos === 2) chord = EB_REHARM;

    const R = this.rig;
    const { bed, drums, reverb } = this.nodes;

    // Section start: lay a long palette drone (phantom-root floor) + a bell.
    if (barInSection === 0) {
      const secBars = FORM.find((s) => s.name === section)?.bars ?? 4;
      const dur = secBars * BAR;
      // Choruses sit on the A (dominant) floor; everything else on D.
      const floor = section === 'drop' || section === 'peak' || section === 'final' ? 55 : 36.7;
      V.drone(R, floor, dur, when, bed, section === 'bridge' ? 0.16 : 0.12);
      if (section === 'bridge' || section === 'theme' || section === 'outro') {
        V.airPad(R, dur, when, reverb, 0.05);
      }
      // Revenant bell struck on the downbeat of the heavy sections + outro.
      if (section === 'drop' || section === 'peak' || section === 'final' || section === 'outro') {
        V.bell(R, 130, 4.2, when, reverb, section === 'peak' ? 0.2 : 0.15, -0.2);
      }
    }

    // Chord pad (skip on the bare outro / thin bridge downbeats handled below).
    if (section !== 'outro') {
      const padGain = section === 'bridge' ? 0.0 : section === 'theme' ? 0.11 : 0.13;
      if (padGain > 0) {
        chord.pad.forEach((n, i) => {
          V.strings(R, noteFreq(n), BAR * 0.98, when, bed, padGain, (i - 1.5) * 0.18);
        });
      }
    }

    // Bass / sub — drops, peak and final get the 808 glide to the chord root.
    if (section === 'drop' || section === 'peak' || section === 'final') {
      V.sub808(R, noteFreq(chord.root), BAR * 0.95, when, bed, 0.5);
    } else if (section === 'theme' || section === 'bridge') {
      // soft pizz root pulse on beats 1 & 3
      V.pizz(R, noteFreq(chord.root) * 2, when, bed, 0.14, 0);
      V.pizz(R, noteFreq(chord.root) * 2, when + 2 * BEAT, bed, 0.12, 0);
    }

    // Counter-melody cello in peak/final (contrary motion under the hook).
    if (section === 'peak' || section === 'final') {
      V.strings(R, noteFreq(COUNTER[vampPos]), BAR * 0.98, when, bed, 0.08, 0.4);
    }

    // The hook — re-orchestrated per section (mere-exposure + anti-habituation).
    this.scheduleHook(section, vampPos, when);

    // Timpani downbeat accent in the fuller sections.
    if (section === 'drop' || section === 'peak' || section === 'final' || section === 'build') {
      V.timpani(R, noteFreq(chord.root) * 2, when, drums, 0.28);
    }

    // Beat.
    this.scheduleBeat(section, barInSection, when);
  }

  private scheduleHook(section: SectionName, vampPos: number, when: number): void {
    const R = this.rig;
    const bed = this.nodes.bed;
    const reverb = this.nodes.reverb;
    const events = HOOK[vampPos];

    // Prologue-ish thinning: theme states it clean; bridge only a fragment.
    if (section === 'bridge' && vampPos !== 0) return;

    for (const [beat, durBeats, note] of events) {
      const t = when + beat * BEAT;
      const dur = durBeats * BEAT;
      const f = noteFreq(note);
      switch (section) {
        case 'theme':
          V.strings(R, f, dur, t, bed, 0.14, 0);
          V.piano(R, f, dur, t, bed, 0.16, 0);
          break;
        case 'drop':
          V.brass(R, f, dur, t, bed, 0.13, 0);
          V.strings(R, f, dur, t, bed, 0.1, 0.15);
          break;
        case 'peak':
          V.brass(R, f, dur, t, bed, 0.14, 0);
          V.strings(R, f * 2, dur, t, bed, 0.08, -0.15); // octave up
          // choir sings the phrase in augmentation (only the long notes)
          if (durBeats >= 1) V.choir(R, f, dur, t, reverb, 0.09, 0.3);
          break;
        case 'bridge':
          V.pizz(R, f, t, bed, 0.18, 0);
          break;
        case 'final':
          V.strings(R, f, dur, t, bed, 0.13, 0);
          V.brass(R, f, dur, t, bed, 0.1, 0.1);
          if (durBeats >= 1) V.choir(R, f, dur, t, reverb, 0.08, -0.3);
          break;
        case 'outro':
          V.piano(R, f, dur, t, bed, 0.2, 0);
          break;
        case 'build':
          // build carries no melody — the riser/roll owns the bar
          break;
      }
    }
  }

  private scheduleBeat(section: SectionName, barInSection: number, when: number): void {
    const R = this.rig;
    const { drums, duck } = this.nodes;

    if (section === 'build') {
      // Accelerating snare roll + a filter-opening riser across the 4-bar build.
      if (barInSection === 0) V.riser(R, 4 * BAR, when, drums, 0.28);
      const divs = [4, 4, 8, 16][barInSection] ?? 8;
      for (let beat = 0; beat < 4; beat++) {
        for (let j = 0; j < divs; j++) {
          const t = when + beat * BEAT + (j * BEAT) / divs;
          const g = 0.12 + 0.22 * ((barInSection * 4 + beat) / 16);
          V.snare(R, t, drums, g);
        }
      }
      return;
    }

    const heavy = section === 'drop' || section === 'peak' || section === 'final';
    const half = section === 'bridge';

    if (heavy) {
      const kicks = [0, 6, 10, 14];
      for (const s of kicks) {
        const t = when + s * STEP;
        V.kick(R, t, drums, 0.85);
        duck(t);
      }
      for (const s of [4, 12]) V.clap(R, when + s * STEP, drums, 0.42);
      const double = section === 'peak' || section === 'final';
      for (let s = 0; s < 16; s += double ? 1 : 2) {
        V.hat(R, when + s * STEP, drums, 0.13, s === 14);
      }
      if (barInSection === 0) V.crash(R, when, drums, 0.4);
    } else if (half) {
      // half-time feel: kick on 1, snare on 3, sparse hats
      V.kick(R, when, drums, 0.7);
      duck(when);
      V.snare(R, when + 8 * STEP, drums, 0.4);
      for (const s of [4, 12]) V.hat(R, when + s * STEP, drums, 0.1);
    }
    // theme / outro: no kit (drone + pizz + hook carry them).
  }
}
