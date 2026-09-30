/**
 * Opens the Supabase database for the scripts, with the keys of .env
 * (or of the environment variables, e.g. on GitHub Actions).
 */
import { fileURLToPath } from 'node:url';
import { createSupabaseStore } from '../server/supabase-store.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env file: environment variables only */
}

/** readOnly: the publishable key is enough (the card catalog is public). */
export function openStore({ readOnly = false } = {}) {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY } = process.env;
  const key = SUPABASE_SECRET_KEY || (readOnly ? SUPABASE_PUBLISHABLE_KEY : undefined);
  if (!SUPABASE_URL || !key) {
    const keys = readOnly ? 'SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY' : 'SUPABASE_SECRET_KEY';
    throw new Error(`No database configured: set SUPABASE_URL and ${keys} (in .env, see .env.example).`);
  }
  return createSupabaseStore({ url: SUPABASE_URL, secretKey: key });
}
