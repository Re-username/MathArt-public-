/* Minimal WebAudio synth — no assets needed. */

let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    if (!audio) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

let masterVolume = 0.8;

function tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.05, slideTo?: number, delay = 0): void {
  const ac = ctx();
  if (!ac) return;
  gain *= masterVolume;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst(dur: number, gain = 0.12, delay = 0): void {
  const ac = ctx();
  if (!ac) return;
  gain *= masterVolume;
  const t0 = ac.currentTime + delay;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3000, t0);
  filter.frequency.exponentialRampToValueAtTime(200, t0 + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t0);
}

export const sfx = {
  enabled: true,
  setVolume(v: number): void {
    masterVolume = Math.max(0, Math.min(1, v));
  },
  click(): void {
    if (this.enabled) tone(660, 0.05, 'square', 0.03);
  },
  hover(): void {
    if (this.enabled) tone(990, 0.03, 'square', 0.012);
  },
  open(): void {
    if (this.enabled) {
      tone(440, 0.06, 'square', 0.03);
      tone(880, 0.07, 'square', 0.03, undefined, 0.05);
    }
  },
  tick(): void {
    if (this.enabled) tone(1180, 0.04, 'square', 0.028);
  },
  ready(): void {
    if (this.enabled) {
      tone(587, 0.08, 'square', 0.04);
      tone(880, 0.1, 'square', 0.04, undefined, 0.07);
      tone(1175, 0.12, 'square', 0.04, undefined, 0.14);
    }
  },
  turn(): void {
    if (this.enabled) {
      tone(520, 0.07, 'square', 0.04);
      tone(780, 0.09, 'square', 0.04, undefined, 0.08);
    }
  },
  shot(): void {
    if (this.enabled) tone(220, 0.35, 'sawtooth', 0.05, 1400);
  },
  explosion(): void {
    if (this.enabled) {
      noiseBurst(0.45, 0.14);
      tone(120, 0.4, 'sine', 0.12, 40);
    }
  },
  hit(): void {
    if (this.enabled) {
      noiseBurst(0.3, 0.1);
      tone(300, 0.25, 'square', 0.06, 90);
    }
  },
  death(): void {
    if (this.enabled) {
      noiseBurst(0.5, 0.12);
      tone(400, 0.6, 'sawtooth', 0.07, 50);
    }
  },
  error(): void {
    if (this.enabled) tone(160, 0.15, 'square', 0.05, 110);
  },
  win(): void {
    if (this.enabled) {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.05, undefined, i * 0.13));
    }
  },
  spawn(): void {
    if (this.enabled) tone(880, 0.12, 'sine', 0.04, 1320);
  },
};
