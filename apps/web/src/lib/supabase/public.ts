import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@soundcheck/contracts/database';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env';

let client: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Anonymous server client for public catalog data (songs, albums, artists, artwork). It never reads cookies, so
 * pages that only use it can be statically cached and revalidated instead of rendered on every request.
 */
export function supabasePublic() {
  client ??= createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
