/** Opens the Supabase database for the scripts, with the keys of .env (or of the environment). */
import { fileURLToPath } from 'node:url';
import { createSupabaseStore } from '../server/supabase-store.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env file: environment variables only */
}

export function openStore() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('No database configured: set SUPABASE_URL and SUPABASE_SECRET_KEY (in .env, see .env.example).');
  }
  return createSupabaseStore({ url: SUPABASE_URL, secretKey: SUPABASE_SECRET_KEY });
}
