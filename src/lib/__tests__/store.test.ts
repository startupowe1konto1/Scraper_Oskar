// src/lib/__tests__/store.test.ts
// Integration tests — require real Supabase with migration applied.
// Skips automatically if NEXT_PUBLIC_SUPABASE_URL is not set.
import { describe, test, expect, afterEach, beforeAll } from 'vitest';

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_EMAIL = 'store-test@shoppalyzer.dev';

// Resolved in beforeAll — holds the real auth user UUID
let TEST_USER_ID: string;

describe.skipIf(!hasSupabase)('store (Supabase integration)', () => {
  const createdIds: string[] = [];

  beforeAll(async () => {
    const { createServiceClient } = await import('../db');
    const db = createServiceClient();

    // Look up existing test user by email, or create one
    const { data: listData } = await db.auth.admin.listUsers({ perPage: 1000 });
    const existing = listData?.users?.find(u => u.email === TEST_USER_EMAIL);

    if (existing) {
      TEST_USER_ID = existing.id;
    } else {
      const { data: createData, error } = await db.auth.admin.createUser({
        email: TEST_USER_EMAIL,
        email_confirm: true,
      });
      if (error || !createData.user) throw new Error(`Could not create test auth user: ${error?.message}`);
      TEST_USER_ID = createData.user.id;
    }

    // Ensure profile exists (trigger may have created it; upsert is idempotent)
    await db.from('profiles').upsert({
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      plan: 'free',
    });
  });

  afterEach(async () => {
    if (createdIds.length === 0) return;
    const { createServiceClient } = await import('../db');
    const db = createServiceClient();
    await db.from('queries').delete().in('id', createdIds);
    createdIds.length = 0;
  });

  test('insertQuery creates a record', async () => {
    const { insertQuery } = await import('../store');
    const q = await insertQuery({
      user_id: TEST_USER_ID,
      input: 'https://allegro.pl/oferta/test-12345678',
      input_type: 'allegro_url',
      context: { product_url: 'https://allegro.pl/oferta/test-12345678' },
    });

    createdIds.push(q.id);
    expect(q.id).toBeTruthy();
    expect(q.status).toBe('queued');
    expect(q.user_id).toBe(TEST_USER_ID);
    expect(q.resolved.product_url).toBe('https://allegro.pl/oferta/test-12345678');
  });

  test('getQueryForUser retrieves by id + user_id', async () => {
    const { insertQuery, getQueryForUser } = await import('../store');
    const q = await insertQuery({
      user_id: TEST_USER_ID,
      input: 'https://allegro.pl/oferta/test-12345678',
      input_type: 'allegro_url',
    });
    createdIds.push(q.id);

    const found = await getQueryForUser(q.id, TEST_USER_ID);
    expect(found).not.toBeUndefined();
    expect(found!.id).toBe(q.id);

    const notFound = await getQueryForUser(q.id, 'a0000000-0000-0000-0000-000000000000');
    expect(notFound).toBeUndefined();
  });

  test('listQueriesForUser returns correct results', async () => {
    const { insertQuery, listQueriesForUser } = await import('../store');
    const q1 = await insertQuery({ user_id: TEST_USER_ID, input: 'https://allegro.pl/oferta/aaa', input_type: 'allegro_url' });
    const q2 = await insertQuery({ user_id: TEST_USER_ID, input: 'https://allegro.pl/oferta/bbb', input_type: 'allegro_url' });
    createdIds.push(q1.id, q2.id);

    const { queries, total } = await listQueriesForUser(TEST_USER_ID, { limit: 10 });
    expect(total).toBeGreaterThanOrEqual(2);
    const ids = queries.map(q => q.id);
    expect(ids).toContain(q1.id);
    expect(ids).toContain(q2.id);
  });
});
