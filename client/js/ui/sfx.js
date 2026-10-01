/**
 * Sound effects synthesized with the Web Audio API (no audio files needed).
 */
import { storage } from '../dom.js';

const SOUND_KEY = 'mangaBooster.sound';
let context = null;
let enabled = storage.get(SOUND_KEY) !== 'off';

function audio() {
  if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
  if (context.state === 'suspended') context.resume();
  return context;
}

function tone(frequency, { start = 0, duration = 0.15, type = 'sine', gain = 0.1, slideTo } = {}) {
  const ctx = audio();
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const volume = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  volume.gain.setValueAtTime(0.0001, t);
  volume.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(volume).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** Filtered white noise. `swell`: the volume rises instead of falling (a reversed cymbal). */
function noise({ start = 0, duration = 0.3, gain = 0.2, from = 3000, to = 600, swell = false } = {}) {
  const ctx = audio();
  const t = ctx.currentTime + start;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const volume = ctx.createGain();
  volume.gain.setValueAtTime(swell ? 0.0001 : gain, t);
  volume.gain.exponentialRampToValueAtTime(swell ? gain : 0.0001, t + duration);
  source.connect(filter).connect(volume).connect(ctx.destination);
  source.start(t);
}

const arpeggio = (notes, { step = 0.08, start = 0, ...options } = {}) =>
  notes.forEach((note, i) => tone(note, { start: start + i * step, ...options }));

const SOUNDS = {
  click: () => tone(1400, { duration: 0.04, type: 'square', gain: 0.025 }),
  shake: () => noise({ duration: 0.45, gain: 0.06, from: 900, to: 300 }),
  tear: () => {
    noise({ duration: 0.4, gain: 0.28, from: 5000, to: 700 });
    tone(240, { duration: 0.25, type: 'sawtooth', gain: 0.03, slideTo: 90 });
  },
  flip: () => noise({ duration: 0.12, gain: 0.08, from: 2500, to: 1200 }),
  charge: () => tone(180, { duration: 0.9, type: 'sawtooth', gain: 0.04, slideTo: 900 }),
  N: () => tone(520, { duration: 0.14, type: 'triangle', gain: 0.07 }),
  R: () => arpeggio([660, 990], { duration: 0.2, type: 'triangle', gain: 0.08 }),
  SR: () => arpeggio([660, 880, 1320], { duration: 0.28, type: 'triangle', gain: 0.09, step: 0.07 }),
  SSR: () => {
    arpeggio([523, 659, 784, 1047], { duration: 0.4, type: 'triangle', gain: 0.1 });
    noise({ start: 0.25, duration: 0.6, gain: 0.05, from: 8000, to: 4000 });
  },
  UR: () => {
    tone(90, { duration: 0.5, type: 'sine', gain: 0.35, slideTo: 40 });
    arpeggio([523, 659, 784, 1047, 1319, 1568], { duration: 0.55, type: 'square', gain: 0.045, step: 0.09 });
    [523, 659, 784].forEach((note) => tone(note, { start: 0.6, duration: 1.2, type: 'triangle', gain: 0.07 }));
    noise({ start: 0.5, duration: 1, gain: 0.06, from: 9000, to: 5000 });
  },
  REV: () => {
    tone(60, { duration: 0.7, type: 'sine', gain: 0.4, slideTo: 30 });
    arpeggio([1568, 1319, 1047, 784, 659, 523], { duration: 0.55, type: 'square', gain: 0.045, step: 0.09 });
    [392, 494, 587].forEach((note) => tone(note, { start: 0.6, duration: 1.4, type: 'triangle', gain: 0.07 }));
    noise({ start: 0.5, duration: 1.2, gain: 0.06, from: 5000, to: 9000 });
  },
  // ×10 show
  whoosh: () => noise({ duration: 0.35, gain: 0.12, from: 400, to: 5000 }),
  crack: () => {
    noise({ duration: 0.18, gain: 0.3, from: 7000, to: 1500 });
    tone(110, { duration: 0.3, type: 'sine', gain: 0.3, slideTo: 50 });
  },
  boom: () => {
    tone(70, { duration: 1.2, type: 'sine', gain: 0.5, slideTo: 28 });
    noise({ duration: 1.1, gain: 0.35, from: 2500, to: 150 });
    arpeggio([523, 659, 784, 1047, 1319], { start: 0.35, duration: 0.5, type: 'square', gain: 0.04, step: 0.07 });
    [523, 659, 784, 1047].forEach((note) => tone(note, { start: 0.8, duration: 1.6, type: 'triangle', gain: 0.06 }));
  },
  // A Reversed card: two heartbeats, a reversed swell, then the world flips
  // (deep impact, tape rewinding) and an eerie chord. The flip comes at 0.85 s.
  reverse: () => {
    tone(55, { duration: 0.18, type: 'sine', gain: 0.5, slideTo: 40 });
    tone(55, { start: 0.28, duration: 0.22, type: 'sine', gain: 0.55, slideTo: 38 });
    noise({ start: 0.35, duration: 0.5, gain: 0.22, from: 600, to: 9000, swell: true });
    tone(45, { start: 0.85, duration: 1.4, type: 'sine', gain: 0.55, slideTo: 25 });
    noise({ start: 0.85, duration: 0.9, gain: 0.3, from: 3000, to: 200 });
    tone(1400, { start: 0.9, duration: 0.9, type: 'sawtooth', gain: 0.035, slideTo: 90 });
    [311, 370, 466, 554].forEach((note, i) => tone(note, { start: 1.1 + i * 0.05, duration: 2.6, type: 'triangle', gain: 0.05 }));
  },
  // Kira market: a coin lands in the wallet, a pile of them (recycling many cards).
  coin: () => {
    tone(988, { duration: 0.08, type: 'square', gain: 0.05 });
    tone(1319, { start: 0.08, duration: 0.3, type: 'square', gain: 0.05 });
  },
  kaching: () => {
    noise({ duration: 0.25, gain: 0.12, from: 6000, to: 3000 });
    arpeggio([1319, 1568, 1976, 2637], { start: 0.05, duration: 0.25, type: 'square', gain: 0.035, step: 0.06 });
    tone(2637, { start: 0.3, duration: 0.6, type: 'triangle', gain: 0.05 });
  },
  fanfare: () => {
    arpeggio([392, 523, 659, 784], { duration: 0.22, type: 'square', gain: 0.045, step: 0.11 });
    [523, 659, 784, 1047].forEach((note) => tone(note, { start: 0.48, duration: 1, type: 'triangle', gain: 0.07 }));
  },
};

export const sfx = {
  get enabled() {
    return enabled;
  },
  set enabled(value) {
    enabled = Boolean(value);
    storage.set(SOUND_KEY, enabled ? 'on' : 'off');
  },
  play(name) {
    if (!enabled) return;
    try {
      SOUNDS[name]?.();
    } catch {
      /* audio not available: stay silent */
    }
  },
};
