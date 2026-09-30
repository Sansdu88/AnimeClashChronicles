/**
 * Visual effects for rare pulls: particle bursts, screen flashes, manga
 * onomatopoeia ("BOOM!!") and screen shake.
 */
import { prefersReducedMotion } from '../dom.js';

let canvas = null;
let ctx = null;
let particles = [];
let running = false;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
}

function drawStar(size) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 === 0 ? size : size * 0.4;
    const angle = (Math.PI / 4) * i;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

function step() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vy += 0.16;
    p.vx *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.spin;
    p.life -= p.decay;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    if (p.star) drawStar(p.size);
    else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
  if (particles.length) requestAnimationFrame(step);
  else {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/** Confetti/star explosion centered on (x, y), in viewport coordinates. */
export function burst(x, y, { colors = ['#fff'], count = 40, power = 1 } = {}) {
  if (prefersReducedMotion()) count = Math.min(count, 10);
  ensureCanvas();
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 7) * power;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3 * power,
      size: 4 + Math.random() * 7,
      color: colors[i % colors.length],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
      star: Math.random() < 0.35,
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(step);
  }
}

export function flash(color = '#fff', duration = 450) {
  const element = document.createElement('div');
  element.className = 'fx-flash';
  element.style.setProperty('--flash', color);
  element.style.setProperty('--duration', `${duration}ms`);
  document.body.append(element);
  setTimeout(() => element.remove(), duration + 50);
}

/** Manga sound-effect lettering popping at (x, y). */
export function onomatopoeia(text, { x, y, color = '#fff', size = 'l', tilt = -8 } = {}) {
  const element = document.createElement('div');
  element.className = `fx-sfx fx-sfx--${size}`;
  element.textContent = text;
  element.setAttribute('aria-hidden', 'true');
  // Keep the lettering on screen even for the cards at the edges.
  element.style.left = `${Math.min(Math.max(x, window.innerWidth * 0.22), window.innerWidth * 0.78)}px`;
  element.style.top = `${Math.max(y, 60)}px`;
  element.style.setProperty('--color', color);
  element.style.setProperty('--tilt', `${tilt}deg`);
  document.body.append(element);
  setTimeout(() => element.remove(), 1300);
}

/** Shakes the booster stage (shaking <body> would break its fixed positioning). */
export function shakeScreen(target = document.querySelector('.stage__content')) {
  if (!target || prefersReducedMotion()) return;
  target.classList.remove('fx-shake');
  void target.offsetWidth; // restart the animation
  target.classList.add('fx-shake');
  setTimeout(() => target.classList.remove('fx-shake'), 600);
}

export const RARITY_COLORS = {
  N: ['#8d99ae', '#edf2f4'],
  R: ['#3a86ff', '#bde0fe', '#ffffff'],
  SR: ['#9d4edd', '#e0aaff', '#c77dff', '#ffffff'],
  SSR: ['#ffd23f', '#f4a100', '#fff3b0', '#ffffff'],
  UR: ['#ff2e88', '#ffbe0b', '#3a86ff', '#8338ec', '#06d6a0', '#ffffff'],
  REV: ['#00d177', '#0041f4', '#c57900', '#7cc713', '#f9295f', '#000000', '#ffffff'],
};
