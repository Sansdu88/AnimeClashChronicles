/**
 * Sound effects synthesized with the Web Audio API (no audio files needed).
 *
 * Safari (iPhone, iPad, Mac) only starts the sound of a page during a tap, a click or a key:
 * the audio engine (AudioContext) is only made during one (see wake), and the sounds asked
 * before the first tap are skipped. Safari also stops the engine when something interrupts
 * the page (phone locked, another app, the Mac asleep…), or leaves it 'running' with its clock
 * stuck: at every tap, an engine that does not play is replaced. On an iPhone or an iPad, Web
 * Audio is also muted in silent mode (the switch on the side): while the game's sound is on
 * (🔊), it plays as "playback" audio, like a video, which silent mode does not mute.
 *
 * An event gives the game its own sounds (`sfx.theme`, see THEMES): during Halloween, an
 * organ, ghosts, thunder and a witch's cackle replace some of the usual ones.
 */
import { storage } from '../dom.js';

const SOUND_KEY = 'mangaBooster.sound';
let theme = null; // the sounds of an event (a key of THEMES), or null
let context = null; // the audio engine, made during a tap
let madeAt = 0; // when it was made (performance.now())
let clock = null; // when its clock last moved: { context, time, at }
let playedAt = 0; // when the last sound started
let enabled = storage.get(SOUND_KEY) !== 'off';

// iPhone, iPod and iPad (an iPad says it is a Mac, but a Mac has no touch screen).
const isIOS = /iPhone|iPod|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// ── Silent mode (iPhone, iPad) ──────────────────────────────────────────────

let track = null; // a silent <audio> track, for the iPhones without navigator.audioSession
let trackUrl = null;

/** 0.25 s of silence, as a WAV file (16-bit samples at 0). */
function silentWav() {
  const rate = 22050;
  const size = (rate / 4) * 2;
  const view = new DataView(new ArrayBuffer(44 + size));
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // size of the format
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, size, true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** navigator.audioSession (iOS 16.4+): 'playback' plays in silent mode, 'auto' is muted by it. */
function sessionType(type) {
  try {
    navigator.audioSession.type = type;
  } catch {
    /* a Safari that refuses it: the silent mode stays */
  }
}

/**
 * Makes the game's sound "playback" audio, which plays in silent mode (during a tap): through
 * navigator.audioSession (iOS 16.4+), else by playing a silent <audio> track in a loop (the
 * whole page's sound is then playback audio).
 */
function playInSilentMode() {
  if (!isIOS) return;
  if (navigator.audioSession) {
    sessionType('playback');
    return;
  }
  if (!track) {
    trackUrl ??= URL.createObjectURL(silentWav());
    track = document.createElement('audio');
    track.setAttribute('x-webkit-airplay', 'deny');
    track.loop = true;
    track.src = trackUrl;
  }
  if (track.paused) track.play()?.catch(() => {});
}

/** The silent track stops (the page is hidden, or the game's sound turned off): no "Now Playing" on the lock screen. */
function stopSilentTrack() {
  if (!track) return;
  track.pause();
  track.removeAttribute('src');
  track.load();
  track = null;
}

/** The game's sound is off: silent mode mutes the page again, like any other. */
function followSilentMode() {
  if (isIOS && navigator.audioSession) sessionType('auto');
  stopSilentTrack();
}

/**
 * True when the engine says 'running' but its clock did not move since a sound started a
 * moment ago: Safari sometimes does that, and nothing plays.
 */
function clockStuck() {
  const time = context.currentTime;
  if (clock?.context !== context || clock.time !== time) clock = { context, time, at: performance.now() };
  return playedAt > clock.at && performance.now() - playedAt > 300;
}

/**
 * Every tap, click or key wakes the sound up: silent mode, then the engine. One that does not
 * play (none yet, interrupted, clock stuck, still suspended) is replaced by a new one made during
 * the tap, which Safari starts at once; a suspended one made a moment ago (by the same tap: a
 * pointerup, then its click) may still be starting. A silent sound unlocks it on iOS.
 */
function wake() {
  if (!enabled) return;
  try {
    playInSilentMode();
    if (context?.state === 'running' && !clockStuck()) return;
    const starting = context?.state === 'suspended' && performance.now() - madeAt < 500;
    if (!starting) {
      context?.close().catch(() => {});
      context = new (window.AudioContext || window.webkitAudioContext)();
      madeAt = performance.now();
    }
    if (context.state !== 'running') context.resume()?.catch(() => {});
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, context.sampleRate);
    silence.connect(context.destination);
    silence.start(0);
  } catch {
    /* audio not available: stay silent */
  }
}

if (enabled && isIOS && navigator.audioSession) sessionType('playback');
for (const type of ['touchend', 'pointerup', 'click', 'keydown']) {
  document.addEventListener(type, wake, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSilentTrack();
});

/**
 * One note. `envelope`: 'hit' (a strike that fades at once), 'hold' (held, then it fades at the
 * end, like an organ) or 'swell' (it rises slowly, like a ghost's wail). `vibrato`: { rate (Hz),
 * depth (Hz) }, the pitch wobbles.
 */
function tone(frequency, { start = 0, duration = 0.15, type = 'sine', gain = 0.1, slideTo, envelope = 'hit', vibrato } = {}) {
  const ctx = context;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const volume = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  volume.gain.setValueAtTime(0.0001, t);
  if (envelope === 'hold') {
    volume.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    volume.gain.setValueAtTime(gain, t + duration * 0.75);
  } else if (envelope === 'swell') {
    volume.gain.exponentialRampToValueAtTime(gain, t + duration * 0.4);
    volume.gain.setValueAtTime(gain, t + duration * 0.6);
  } else {
    volume.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  }
  volume.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  // One connect() at a time: in old Safaris, connect() returns nothing.
  osc.connect(volume);
  volume.connect(ctx.destination);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.setValueAtTime(vibrato.rate, t);
    depth.gain.setValueAtTime(vibrato.depth, t);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + duration + 0.05);
  }
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/**
 * Filtered white noise. `swell`: the volume rises instead of falling (a reversed cymbal).
 * `filter`: 'bandpass' (a hiss that sweeps), or 'lowpass' (a rumble).
 */
function noise({ start = 0, duration = 0.3, gain = 0.2, from = 3000, to = 600, swell = false, filter: shape = 'bandpass' } = {}) {
  const ctx = context;
  const t = ctx.currentTime + start;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = shape;
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const volume = ctx.createGain();
  volume.gain.setValueAtTime(swell ? 0.0001 : gain, t);
  volume.gain.exponentialRampToValueAtTime(swell ? gain : 0.0001, t + duration);
  source.connect(filter);
  filter.connect(volume);
  volume.connect(ctx.destination);
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

  // ── Halloween (THEMES.halloween uses them too) ──
  // A ghost's wail: up, then a long fall, over a breath of wind.
  ghost: () => {
    tone(330, { duration: 0.75, gain: 0.07, slideTo: 640, envelope: 'swell', vibrato: { rate: 5.5, depth: 14 } });
    tone(640, { start: 0.65, duration: 1.2, gain: 0.07, slideTo: 260, envelope: 'hold', vibrato: { rate: 5, depth: 18 } });
    noise({ duration: 1.8, gain: 0.04, from: 500, to: 1500, swell: true });
  },
  // A witch's cackle: six "ha!" falling lower and lower.
  cackle: () => {
    for (let i = 0; i < 6; i++) {
      const pitch = 980 - i * 60;
      tone(pitch, { start: i * 0.13, duration: 0.11, type: 'sawtooth', gain: 0.04, slideTo: pitch * 0.7, vibrato: { rate: 30, depth: 40 } });
      tone(pitch * 2, { start: i * 0.13, duration: 0.09, type: 'triangle', gain: 0.025, slideTo: pitch * 1.3 });
    }
  },
  // Thunder: the crack, then a long rumble.
  thunder: () => {
    noise({ duration: 0.25, gain: 0.3, from: 6000, to: 1500 });
    noise({ start: 0.08, duration: 2.2, gain: 0.5, from: 700, to: 60, filter: 'lowpass' });
    tone(55, { start: 0.05, duration: 1.6, gain: 0.3, slideTo: 32 });
  },
  // A church bell tolls (the partials of a bell are not in tune with each other).
  bell: () => {
    [
      [146.8, 0.06],
      [293.7, 0.08],
      [352, 0.04],
      [440, 0.03],
      [587.3, 0.05],
      [880, 0.02],
    ].forEach(([frequency, gain]) => tone(frequency, { duration: 3, gain }));
  },
  // A door creaks open.
  creak: () => tone(95, { duration: 0.9, type: 'sawtooth', gain: 0.03, slideTo: 150, envelope: 'swell', vibrato: { rate: 22, depth: 25 } }),
};

/** An organ note: a square wave over a sawtooth one octave lower, held. */
const organ = (frequency, { start = 0, duration = 0.4, gain = 0.03 } = {}) => {
  tone(frequency, { start, duration, type: 'square', gain, envelope: 'hold' });
  tone(frequency / 2, { start, duration, type: 'sawtooth', gain: gain * 0.7, envelope: 'hold' });
};

/**
 * The sounds an event changes (`sfx.theme`): the others stay as they are.
 * Halloween: the opening of Bach's Toccata in D minor on the organ, ghosts, thunder, minor keys.
 */
const THEMES = {
  halloween: {
    fanfare: () => {
      organ(440, { duration: 0.09 });
      organ(392, { start: 0.08, duration: 0.09 });
      organ(440, { start: 0.16, duration: 0.6 });
      [392, 349.2, 329.6, 293.7].forEach((note, i) => organ(note, { start: 0.9 + i * 0.13, duration: 0.14 }));
      organ(277.2, { start: 1.42, duration: 0.32 });
      [293.7, 349.2, 440].forEach((note) => organ(note, { start: 1.78, duration: 1.3, gain: 0.025 }));
      tone(73.4, { start: 1.78, duration: 1.4, type: 'sawtooth', gain: 0.05, envelope: 'hold' });
    },
    whoosh: () => {
      tone(420, { duration: 0.6, gain: 0.06, slideTo: 760, envelope: 'swell', vibrato: { rate: 6, depth: 16 } });
      noise({ duration: 0.5, gain: 0.08, from: 400, to: 3000 });
    },
    crack: () => {
      noise({ duration: 0.3, gain: 0.35, from: 7000, to: 900 });
      tone(80, { duration: 0.6, gain: 0.3, slideTo: 38 });
    },
    boom: () => {
      SOUNDS.thunder();
      [293.7, 349.2, 440, 587.3].forEach((note) => organ(note, { start: 0.4, duration: 1.8, gain: 0.022 }));
    },
    charge: () => tone(180, { duration: 0.9, gain: 0.06, slideTo: 900, envelope: 'swell', vibrato: { rate: 7, depth: 20 } }),
    // Bones knock together.
    N: () => {
      tone(420, { duration: 0.07, type: 'triangle', gain: 0.09 });
      tone(300, { start: 0.07, duration: 0.08, type: 'triangle', gain: 0.07 });
    },
    R: () => arpeggio([440, 523.3], { duration: 0.26, type: 'triangle', gain: 0.08, vibrato: { rate: 6, depth: 6 } }),
    SR: () => arpeggio([440, 523.3, 659.3], { duration: 0.34, type: 'triangle', gain: 0.09, step: 0.08, vibrato: { rate: 6, depth: 6 } }),
    SSR: () => {
      [293.7, 349.2, 440, 587.3].forEach((note, i) => organ(note, { start: i * 0.09, duration: 0.9 }));
      tone(1174.7, { start: 0.4, duration: 1.4, gain: 0.04 });
    },
    UR: () => {
      tone(70, { duration: 0.6, gain: 0.35, slideTo: 35 });
      arpeggio([440, 523.3, 622.3, 740, 880], { duration: 0.5, type: 'square', gain: 0.035, step: 0.09 });
      SOUNDS.ghost();
    },
  },
};

export const sfx = {
  get enabled() {
    return enabled;
  },
  /** The sounds of an event ('halloween'), or null for the usual ones. */
  get theme() {
    return theme;
  },
  set theme(value) {
    theme = THEMES[value] ? value : null;
  },
  /** Turned on or off by a tap (the 🔊 button): the sound wakes up, or silent mode applies again. */
  set enabled(value) {
    enabled = Boolean(value);
    storage.set(SOUND_KEY, enabled ? 'on' : 'off');
    if (enabled) wake();
    else followSilentMode();
  },
  /** Plays a sound (the event's when it has its own); before the first tap there is no audio engine yet, and nothing plays. */
  play(name) {
    if (!enabled || !context) return;
    playedAt = performance.now();
    try {
      (THEMES[theme]?.[name] ?? SOUNDS[name])?.();
    } catch {
      /* audio not available: stay silent */
    }
  },
};
