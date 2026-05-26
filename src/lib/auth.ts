/**
 * Auth helpers — Phase 2b: real Supabase JWT verification.
 *
 * The function signature stays identical to Phase 2a so endpoint code never changes.
 */
import type { User } from '@/types/api';
import { createAnonClient, createServiceClient } from '@/lib/db';

/**
 * Return the currently authenticated user for the request.
 * Reads the JWT from `Authorization: Bearer <token>` header.
 * Verifies it with Supabase, then fetches the profile row for plan data.
 *
 * Throws an Error with message containing 'UNAUTHENTICATED' if the token is missing or invalid.
 */
export async function currentUser(req?: Request): Promise<User> {
  if (!req) throw new Error('UNAUTHENTICATED: no request context');

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('UNAUTHENTICATED: missing or malformed Authorization header');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error('UNAUTHENTICATED: empty token');

  // Step 1: Verify JWT using anon client (auth.getUser validates the token)
  const anonClient = createAnonClient();
  const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !authUser) {
    throw new Error(`UNAUTHENTICATED: ${authError?.message ?? 'invalid token'}`);
  }

  // Step 2: Fetch profile using service client (bypasses RLS, safe since JWT already verified above)
  const db = createServiceClient();
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, email, plan, monthly_queries_used, monthly_queries_limit, created_at')
    .eq('id', authUser.id)
    .single();

  if (profileError?.code === 'PGRST116' || !profile) {
    // PGRST116 = no rows — first login, auto-create profile
    const { data: newProfile, error: insertError } = await db
      .from('profiles')
      .insert({ id: authUser.id, email: authUser.email ?? '' })
      .select()
      .single();
    if (insertError || !newProfile) {
      throw new Error(`INTERNAL: profile creation failed`);
    }
    return {
      id: newProfile.id,
      email: newProfile.email,
      plan: newProfile.plan,
      created_at: newProfile.created_at,
      monthly_queries_used: newProfile.monthly_queries_used,
      monthly_queries_limit: newProfile.monthly_queries_limit,
    };
  }

  if (profileError) {
    // profileError is narrowed to never after the PGRST116 check above, so we cast
    throw new Error(`INTERNAL: profile lookup failed: ${(profileError as { message: string }).message}`);
  }

  return {
    id: profile.id,
    email: profile.email,
    plan: profile.plan,
    created_at: profile.created_at,
    monthly_queries_used: profile.monthly_queries_used,
    monthly_queries_limit: profile.monthly_queries_limit,
  };
}
