/* Procedural synthwave background music — dark driving loops in the spirit of
 * Hotline Miami: four-on-the-floor kick, offbeat hats, saw bass arpeggios,
 * minor-key pads and sparse lead stabs. Several tracks rotate automatically.
 * All synthesis is WebAudio — no audio assets. */

interface Chord { root: number; minor: boolean } // root = MIDI note

interface Track {
  bpm: number;
  bars: Chord[];          // one chord per bar
  bassOctaves: boolean;   // octave-jumping 16th bassline
  hats16: boolean;        // 16th hats instead of 8ths
  leadEvery: number;      // lead stab every N bars (0 = none)
}

const TRACKS: Track[] = [
  { // Am F C G — the classic dark runner
    bpm: 104,
    bars: [{ root: 45, minor: true }, { root: 41, minor: false }, { root: 48, minor: false }, { root: 43, minor: false }],
    bassOctaves: true, hats16: true, leadEvery: 2,
  },
  { // Dm Bb F C — heavier, faster
    bpm: 112,
    bars: [{ root: 38, minor: true }, { root: 46, minor: false }, { root: 41, minor: false }, { root: 48, minor: false }],
    bassOctaves: true, hats16: false, leadEvery: 2,
  },
  { // Em C G D — brighter drive
    bpm: 98,
    bars: [{ root: 40, minor: true }, { root: 48, minor: false }, { root: 43, minor: false }, { root: 50, minor: false }],
    bassOctaves: false, hats16: true, leadEvery: 4,
  },
  { // Fm Ab Eb Bb — slow menace
    bpm: 92,
    bars: [{ root: 41, minor: true }, { root: 44, minor: false }, { root: 39, minor: false }, { root: 46, minor: false }],
    bassOctaves: true, hats16: true, leadEvery: 2,
  },
  { // Cm Ab Bb G — neon noir
    bpm: 108,
    bars: [{ root: 48, minor: true }, { root: 44, minor: false }, { root: 46, minor: false }, { root: 43, minor: false }],
    bassOctaves: false, hats16: false, leadEvery: 2,
  },
  { // Gm Eb Bb F — mid-tempo chase
    bpm: 100,
    bars: [{ root: 43, minor: true }, { root: 39, minor: false }, { root: 46, minor: false }, { root: 41, minor: false }],
    bassOctaves: true, hats16: false, leadEvery: 4,
  },
  { // Bbm Gb Db Ab — heavy stomp
    bpm: 94,
    bars: [{ root: 46, minor: true }, { root: 42, minor: false }, { root: 37, minor: false }, { root: 44, minor: false }],
    bassOctaves: true, hats16: true, leadEvery: 2,
  },
  { // C G Am F — bright uplifter
    bpm: 118,
    bars: [{ root: 48, minor: false }, { root: 43, minor: false }, { root: 45, minor: true }, { root: 41, minor: false }],
    bassOctaves: false, hats16: true, leadEvery: 2,
  },
  { // Ebm Ab Bb Bbm — tense street
    bpm: 106,
    bars: [{ root: 39, minor: true }, { root: 44, minor: false }, { root: 46, minor: false }, { root: 46, minor: true }],
    bassOctaves: true, hats16: false, leadEvery: 2,
  },
];

const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

class MusicEngine {
  enabled = true;
  private volume = 0.55;
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0; // AudioContext time of the next 16th step
  private step = 0;     // global 16th-step counter
  private trackIdx = Math.floor(Math.random() * TRACKS.length);
  private barsPlayed = 0;

  // Пользовательские треки (mp3): встраиваются в ротацию — после каждых двух
  // синтезированных треков играет следующий трек из плейлиста, потом ротация продолжается.
  private customUrls: string[] = [];
  private customKey = '';
  private customIdx = 0;
  private customEl: HTMLAudioElement | null = null;
  private customNode: MediaElementAudioSourceNode | null = null;
  private customPlaying = false;
  private synthSinceCustom = 0;

  setCustomTracks(urls: string[]): void {
    const key = urls.join('|');
    if (key === this.customKey) return;
    this.customKey = key;
    this.customUrls = urls;
    if (this.customIdx >= urls.length) this.customIdx = 0;
    if (this.customPlaying) {
      this.customEl?.pause();
      this.customPlaying = false;
    }
    if (!this.customEl) {
      const el = new Audio();
      el.preload = 'auto';
      el.onended = () => {
        this.customPlaying = false;
        // планировщик продолжает с текущего момента, без догоняющего барабана
        if (this.ac) this.nextStep = this.ac.currentTime + 0.08;
      };
      this.customEl = el;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ac) this.master.gain.setTargetAtTime(this.volume * 0.9, this.ac.currentTime, 0.05);
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** список пользовательских треков (диагностика/E2E) */
  get customList(): string[] {
    return [...this.customUrls];
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    try {
      if (!this.ac) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = this.volume * 0.9;
        this.master.connect(this.ac.destination);
        const len = this.ac.sampleRate;
        this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ac.state === 'suspended') void this.ac.resume();
      this.nextStep = this.ac.currentTime + 0.08;
      this.step = 0;
      this.barsPlayed = 0;
      this.timer = setInterval(() => this.pump(), 90);
    } catch {
      /* audio unavailable */
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // тишина полная: и синтезатор, и пользовательский трек
    if (this.customEl) this.customEl.pause();
    this.customPlaying = false;
    this.synthSinceCustom = 0;
    if (this.ac && this.ac.state === 'running') void this.ac.suspend();
  }

  private startCustom(): void {
    const el = this.customEl;
    if (!el || !this.ac || !this.master || this.customUrls.length === 0) return;
    if (!this.customNode) {
      try {
        this.customNode = this.ac.createMediaElementSource(el);
        this.customNode.connect(this.master);
      } catch {
        this.customEl = null; // элемент уже привязан в другом контексте — играем без него
        return;
      }
    }
    // следующий трек плейлиста (по кругу)
    const url = this.customUrls[this.customIdx % this.customUrls.length];
    this.customIdx++;
    if (el.src !== url) el.src = url;
    el.currentTime = 0;
    this.customPlaying = true;
    el.play().catch(() => { this.customPlaying = false; });
  }

  private pump(): void {
    if (!this.ac || !this.master) return;
    if (this.customPlaying) {
      // пока играет mp3 — синтезатор молчит, часы просто переставляем вперёд
      this.nextStep = this.ac.currentTime + 0.08;
      return;
    }
    const track = TRACKS[this.trackIdx % TRACKS.length];
    const stepDur = 60 / track.bpm / 4; // 16th note
    while (this.nextStep < this.ac.currentTime + 0.25) {
      this.scheduleStep(track, this.step, this.nextStep, stepDur);
      this.step++;
      this.nextStep += stepDur;
      if (this.step % 64 === 0) {
        this.barsPlayed += 4;
        if (this.barsPlayed >= 8) { // two passes through the progression, then rotate track
          this.barsPlayed = 0;
          this.trackIdx = (this.trackIdx + 1) % TRACKS.length;
          this.synthSinceCustom++;
          if (this.customEl && this.synthSinceCustom >= 2) {
            this.synthSinceCustom = 0;
            this.startCustom();
          }
        }
      }
    }
  }

  private scheduleStep(track: Track, step: number, t: number, stepDur: number): void {
    const bar = Math.floor(step / 16) % track.bars.length;
    const inBar = step % 16;
    const chord = track.bars[bar];

    // Kick — four on the floor
    if (inBar % 4 === 0) this.kick(t);
    // Snare on 2 & 4
    if (inBar === 4 || inBar === 12) this.snare(t);
    // Hats
    const hatHit = track.hats16 ? inBar % 2 === 1 : inBar % 4 === 2;
    if (hatHit) this.hat(t, inBar % 8 === 3 ? 0.05 : 0.028);
    // Bass — driving 16ths on the chord root
    const oct = track.bassOctaves && inBar % 4 === 2 ? 12 : 0;
    const bassNote = inBar === 14 ? chord.root + 7 : chord.root + oct;
    this.bass(t, midi(bassNote - 12), stepDur * 0.9);
    // Pad — chord tones at the start of each bar
    if (inBar === 0) {
      const third = chord.minor ? 3 : 4;
      this.pad(t, [chord.root + 12, chord.root + 12 + third, chord.root + 19], stepDur * 16);
    }
    // Lead stab — minor pentatonic sparkle
    if (track.leadEvery > 0 && bar % track.leadEvery === 0 && inBar === 6) {
      const penta = chord.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
      const n = chord.root + 24 + penta[(step * 7 + bar * 3) % penta.length];
      this.lead(t, midi(n), stepDur * 3);
      if (track.hats16) this.lead(t + stepDur * 2, midi(n + (chord.minor ? 3 : 4)), stepDur * 2);
    }
  }

  private kick(t: number): void {
    const ac = this.ac!, out = this.master!;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.26);
  }

  private snare(t: number): void {
    const ac = this.ac!, out = this.master!;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(f).connect(g).connect(out);
    src.start(t, 0.05); src.stop(t + 0.18);
    const o = ac.createOscillator();
    o.type = 'triangle'; o.frequency.value = 190;
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g2).connect(out);
    o.start(t); o.stop(t + 0.12);
  }

  private hat(t: number, gain: number): void {
    const ac = this.ac!, out = this.master!;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7500;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(f).connect(g).connect(out);
    src.start(t, 0.3); src.stop(t + 0.06);
  }

  private bass(t: number, freq: number, dur: number): void {
    const ac = this.ac!, out = this.master!;
    const o = ac.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = freq;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.setValueAtTime(0.16, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private pad(t: number, notes: number[], dur: number): void {
    const ac = this.ac!, out = this.master!;
    for (const n of notes) {
      for (const det of [-4, 4]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const f = ac.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 1200;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022, t + dur * 0.3);
        g.gain.setValueAtTime(0.022, t + dur * 0.7);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(out);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  private lead(t: number, freq: number, dur: number): void {
    const ac = this.ac!, out = this.master!;
    const o = ac.createOscillator();
    o.type = 'square'; o.frequency.value = freq;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 3200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
}

export const music = new MusicEngine();

// отладочный доступ для E2E-тестов
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__music = music;
}
