import { createClient } from '@supabase/supabase-js';

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error } = await db
    .from('profiles')
    .update({ monthly_queries_used: 0, monthly_queries_limit: 100 })
    .eq('id', '4be899b9-bb1a-49c0-bb76-b3460bd4ebf3');
  if (error) { console.error(error.message); process.exit(1); }
  console.log('Profile updated: limit=100, used=0');
}
main().catch(e => { console.error(e); process.exit(1); });
