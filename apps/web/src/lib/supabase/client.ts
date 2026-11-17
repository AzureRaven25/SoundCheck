'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@soundcheck/contracts/database';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env';

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Singleton browser client (session in cookies, shared with the server via @supabase/ssr). */
export function supabaseBrowser() {
  client ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}
