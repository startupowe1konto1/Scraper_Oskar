/**
 * Supabase client factory.
 *
 * createAnonClient() — for API routes that need RLS enforcement.
 *                      Uses the public anon key; the JWT from the user's request
 *                      is set as the auth context separately (see auth.ts).
 *
 * createServiceClient() — for the scrape worker, bypasses RLS entirely.
 *                         NEVER expose this client in browser code.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // string | undefined — checked lazily in createServiceClient()

if (!url || !anonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * Public client — respects Row Level Security.
 * Scoped per-request by passing the user's JWT to auth.ts helpers.
 */
// Opt all Supabase fetch calls out of Next.js request-level cache so API
// routes always see the live database state, not a stale snapshot.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

export function createAnonClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}

/**
 * Service-role client — bypasses Row Level Security.
 * Only used in the scrape worker (server process, not API routes).
 */
export function createServiceClient() {
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}
