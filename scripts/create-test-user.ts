/**
 * One-time script: creates a test user and prints their JWT for E2E testing.
 * Run with: npx tsx --env-file .env.local scripts/create-test-user.ts
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin   = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anonDb  = createClient(supabaseUrl, anonKey,    { auth: { autoRefreshToken: false, persistSession: false } });

const TEST_EMAIL    = 'e2e@shoppalyzer.test';
const TEST_PASSWORD = 'E2eTestPass99!';

async function main() {
  // Upsert: try signing in first; if that fails create the user
  const { data: signinData, error: signinError } = await anonDb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (!signinError && signinData.session) {
    console.log('✓ Signed in existing test user');
    printJwt(signinData.session.access_token);
    return;
  }

  // Create via admin API (works regardless of email-confirm settings)
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError) { console.error('Create user failed:', createError.message); process.exit(1); }
  console.log('✓ Created test user:', created.user.id);

  // Sign in now
  const { data, error } = await anonDb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error) { console.error('Sign-in failed:', error.message); process.exit(1); }
  printJwt(data.session!.access_token);
}

function printJwt(token: string) {
  console.log('\n=== JWT (paste as Bearer token) ===');
  console.log(token);
  console.log('===================================\n');
}

main().catch(e => { console.error(e); process.exit(1); });
