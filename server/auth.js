/**
 * Accounts: password hashing, session tokens, cookies and input validation.
 * Uses node:crypto only (scrypt for passwords, random 256-bit session tokens).
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = 'mb_session';
export const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

// ── Passwords ────────────────────────────────────────────────────────────────

/** "scrypt$N$r$p$salt$hash" (base64 salt and hash). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [algorithm, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

// Checked when the e-mail is unknown, so that answering takes the same time
// whether an account exists or not.
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('anime-clash-chronicles-dummy-password');
  await verifyPassword(password, dummyHash);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export const newSessionToken = () => randomBytes(32).toString('base64url');

/** Only a hash of each token is stored, so a copy of the database cannot be used to log in. */
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function readSessionToken(req) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('=')) || null;
  }
  return null;
}

export function sessionCookie(token, { secure = false } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 3600}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ── Validation ───────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) throw new HttpError(400, 'Enter a valid e-mail address', null, 'invalid_email');
  return email;
}

export function checkPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, 'The password must be 8 to 128 characters long', null, 'weak_password');
  }
  return value;
}

// ── Brute-force protection ───────────────────────────────────────────────────

/** Counts failures per key; `blocked(key)` once `max` failures happened within `windowMs`. */
export function createRateLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();
  const recent = (key) => (failures.get(key) ?? []).filter((time) => Date.now() - time < windowMs);
  return {
    blocked: (key) => recent(key).length >= max,
    fail(key) {
      failures.set(key, [...recent(key), Date.now()]);
      if (failures.size > 10_000) failures.clear(); // never grows without bound
    },
    reset: (key) => failures.delete(key),
  };
}
