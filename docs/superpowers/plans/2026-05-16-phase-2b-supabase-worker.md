# Phase 2b: Supabase + Scrape Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 2a mocks with real Supabase Postgres persistence + JWT auth, then build a polling scrape worker that processes queued queries through Firecrawl and writes `AnalysisResult` back to the DB.

**Architecture:** Next.js API routes keep identical exported function signatures (`currentUser`, `insertQuery`, etc.) — only the implementations change. A separate long-running Node.js worker polls `queries` using the service_role client (bypasses RLS), runs the Firecrawl pipeline, parses Allegro HTML, runs the recommendation engine, and writes to `offers` + `analyses` tables.

**Tech Stack:** Supabase (Postgres + Auth + RLS), @supabase/supabase-js v2, Next.js 14 App Router, Node.js worker, FirecrawlPool (`shoppalyzer-tools/firecrawl-pool.js`), TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `.env.local` | Create | Supabase credentials (not committed) |
| `.env.local.example` | Create | Template for other devs |
| `vitest.config.ts` | Create | Test runner config |
| `src/lib/db.ts` | Create | Supabase client factory (anon + service_role) |
| `src/lib/auth.ts` | Modify | Real JWT verification → profile lookup |
| `src/lib/store.ts` | Modify | In-memory Maps → Supabase Postgres queries |
| `src/lib/allegro-scraper.ts` | Create | Firecrawl calls + Allegro HTML parser |
| `src/lib/analyzer.ts` | Create | Offer scoring + archetype classification + recommendations |
| `src/workers/scrape-worker.js` | Create | Polling loop: queued → discovering → scraping → analyzing → completed |
| `src/lib/__tests__/analyzer.test.ts` | Create | Unit tests for analyzer logic |
| `src/lib/__tests__/allegro-scraper.test.ts` | Create | Unit tests for HTML parser |

---

## ⚠️ Manual Prerequisites (do once before Task 1)

1. Create a Supabase project at https://supabase.com/dashboard → **New Project**, name it `shoppalyzer`
2. Go to **Settings → API** and copy: Project URL, `anon` key, `service_role` key
3. Run the migration: open Supabase dashboard → **SQL Editor** → paste the entire contents of `supabase/migrations/0001_initial.sql` → **Run**
4. Create a test user: **Authentication → Users → Add User** → email: `test@shoppalyzer.dev`, password: `testpass123`

---

## Task 0: Add Vitest test runner

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add test script + devDependencies)

- [ ] **Step 1: Install vitest**

```bash
cd C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend
npm install -D vitest @vitest/ui
```

Expected: vitest appears in `node_modules/.bin/vitest`

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Run vitest to verify it works (no tests yet = pass)**

```bash
npx vitest run
```

Expected: "No test files found" or "0 tests passed" — either is fine.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

## Task 1: Supabase credentials + env setup

**Files:**
- Create: `.env.local`
- Create: `.env.local.example`
- Modify: `.gitignore` (ensure .env.local is ignored)

- [ ] **Step 1: Create .env.local (fill in your real credentials from Supabase dashboard)**

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

- [ ] **Step 2: Create .env.local.example (safe to commit)**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

- [ ] **Step 3: Verify .gitignore has .env.local**

Check that `.gitignore` contains `.env.local` (Next.js scaffold adds this automatically).

```bash
cat .gitignore | findstr /i "env"
```

Expected output includes: `.env.local`

If missing, add it.

- [ ] **Step 4: Commit .env.local.example**

```bash
git add .env.local.example .gitignore
git commit -m "chore: add env template for Supabase credentials"
```

---

## Task 2: Supabase DB client factory

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Create src/lib/db.ts**

```typescript
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !anonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * Public client — respects Row Level Security.
 * Scoped per-request by passing the user's JWT to auth.ts helpers.
 */
export function createAnonClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false },
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
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to db.ts).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add Supabase client factory (anon + service_role)"
```

---

## Task 3: Replace mock auth with real Supabase JWT auth

**Files:**
- Modify: `src/lib/auth.ts`

The endpoint code (`GET /api/v1/me`, etc.) already calls `await currentUser(req)` and gets back a `User`. We only change the implementation body.

The auth flow: the client sends `Authorization: Bearer <supabase-jwt>` → we verify the JWT via Supabase → look up the `profiles` row for plan/quota → return `User`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/auth.test.ts`:

```typescript
// src/lib/__tests__/auth.test.ts
// Integration smoke test — verifies auth rejects missing token.
// Real Supabase calls require credentials in .env.local.

import { describe, test, expect } from 'vitest';
import { currentUser } from '../auth';

describe('currentUser', () => {
  test('throws UNAUTHENTICATED when no Authorization header', async () => {
    const req = new Request('http://localhost/api/v1/me');
    await expect(currentUser(req)).rejects.toThrow('UNAUTHENTICATED');
  });

  test('throws UNAUTHENTICATED when token is malformed', async () => {
    const req = new Request('http://localhost/api/v1/me', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    await expect(currentUser(req)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS (currently mock never throws)**

```bash
npx vitest run src/lib/__tests__/auth.test.ts
```

Expected: FAIL — `currentUser` returns the mock user instead of throwing.

- [ ] **Step 3: Replace src/lib/auth.ts implementation**

```typescript
/**
 * Auth helpers — Phase 2b: real Supabase JWT verification.
 *
 * The function signature stays identical to Phase 2a so endpoint code never changes.
 */
import type { User } from '@/types/api';
import { createAnonClient } from '@/lib/db';

/**
 * Return the currently authenticated user for the request.
 * Reads the JWT from `Authorization: Bearer <token>` header.
 * Verifies it with Supabase, then fetches the profile row for plan data.
 *
 * Throws an Error with message 'UNAUTHENTICATED' if the token is missing or invalid.
 */
export async function currentUser(req?: Request): Promise<User> {
  if (!req) throw new Error('UNAUTHENTICATED: no request context');

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('UNAUTHENTICATED: missing or malformed Authorization header');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new Error('UNAUTHENTICATED: empty token');

  const supabase = createAnonClient();

  // Verify JWT and get auth user
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authUser) {
    throw new Error(`UNAUTHENTICATED: ${authError?.message ?? 'invalid token'}`);
  }

  // Fetch profile (plan, quota)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, plan, monthly_queries_used, monthly_queries_limit, created_at')
    .eq('id', authUser.id)
    .single();

  if (profileError || !profile) {
    // Profile missing → auto-create (race condition on first login)
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({ id: authUser.id, email: authUser.email ?? '' })
      .select()
      .single();
    if (insertError || !newProfile) {
      throw new Error(`UNAUTHENTICATED: profile missing and could not be created`);
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

  return {
    id: profile.id,
    email: profile.email,
    plan: profile.plan,
    created_at: profile.created_at,
    monthly_queries_used: profile.monthly_queries_used,
    monthly_queries_limit: profile.monthly_queries_limit,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/auth.test.ts
```

Expected: both tests PASS (no auth header → throws UNAUTHENTICATED; bad token → throws).

- [ ] **Step 5: Update API routes to return 401 on auth failure**

Currently routes call `currentUser()` and the mock never throws. Now it can throw. We need to handle this in each route.

Modify `src/app/api/v1/me/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import type { User, ApiError } from '@/types/api';

export async function GET(req: Request) {
  let user: User;
  try {
    user = await currentUser(req);
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHENTICATED', message: 'Valid Bearer token required.' } };
    return NextResponse.json(body, { status: 401 });
  }
  return NextResponse.json(user, { status: 200 });
}
```

Modify `src/app/api/v1/queries/route.ts` — wrap the `currentUser` call:

```typescript
// Replace the existing `const user = await currentUser(req);` line at the top of POST and GET with:

// In POST handler, after `export async function POST(req: Request) {`:
let user;
try {
  user = await currentUser(req);
} catch {
  const body: ApiError = { error: { code: 'UNAUTHENTICATED', message: 'Valid Bearer token required.' } };
  return NextResponse.json(body, { status: 401 });
}

// In GET handler, same pattern:
let user;
try {
  user = await currentUser(req);
} catch {
  const body: ApiError = { error: { code: 'UNAUTHENTICATED', message: 'Valid Bearer token required.' } };
  return NextResponse.json(body, { status: 401 });
}
```

Modify `src/app/api/v1/queries/[id]/route.ts` — same pattern:

```typescript
export async function GET(req: Request, { params }: RouteContext) {
  let user;
  try {
    user = await currentUser(req);
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHENTICATED', message: 'Valid Bearer token required.' } };
    return NextResponse.json(body, { status: 401 });
  }

  const query = getQueryForUser(params.id, user.id);
  // ...rest unchanged
}
```

- [ ] **Step 6: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Manual integration test (requires real Supabase project)**

Get a JWT for your test user:
```bash
curl -s -X POST "https://YOUR_PROJECT_ID.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@shoppalyzer.dev","password":"testpass123"}' | jq .access_token
```

Then test the endpoint:
```bash
# Without token → 401
curl -s http://localhost:3000/api/v1/me | jq .

# With token → 200
JWT="<token from above>"
curl -s -H "Authorization: Bearer $JWT" http://localhost:3000/api/v1/me | jq .
```

Expected:
- No token → `{"error":{"code":"UNAUTHENTICATED",...}}`
- Valid token → `{"id":"...","email":"test@shoppalyzer.dev","plan":"free","monthly_queries_used":0,...}`

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth.ts src/lib/__tests__/auth.test.ts src/app/api/v1/me/route.ts src/app/api/v1/queries/route.ts "src/app/api/v1/queries/[id]/route.ts"
git commit -m "feat: replace mock auth with real Supabase JWT verification"
```

---

## Task 4: Replace in-memory store with Supabase Postgres

**Files:**
- Modify: `src/lib/store.ts`

Same exported function signatures (`insertQuery`, `getQueryForUser`, `listQueriesForUser`, `updateQueryStatus`, `attachResult`) — route files don't change at all.

DB schema detail: `resolved` fields (`ean`, `product_url`, `product_name`, `ocoi_token`) are separate columns in the `queries` table, not a JSONB blob. We map them to/from the `QueryDetail.resolved` nested object.

- [ ] **Step 1: Write the test**

Create `src/lib/__tests__/store.test.ts`:

```typescript
// src/lib/__tests__/store.test.ts
// Integration tests — require real Supabase with migration applied.
// Prerequisite: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local

import { describe, test, expect, beforeAll } from 'vitest';
import { insertQuery, getQueryForUser, listQueriesForUser, updateQueryStatus } from '../store';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000099'; // won't exist → we mock via service role

describe('store (Supabase)', () => {
  // Note: These tests need a real Supabase project. Skip if env not configured.
  const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://fake.supabase.co';

  test.skipIf(!hasSupabase)('insertQuery creates a record and getQueryForUser retrieves it', async () => {
    // Use service client to insert a test profile first (bypass RLS)
    const { createServiceClient } = await import('../db');
    const db = createServiceClient();
    await db.from('profiles').upsert({
      id: TEST_USER_ID,
      email: 'store-test@shoppalyzer.dev',
      plan: 'free',
    });

    const q = await insertQuery({
      user_id: TEST_USER_ID,
      input: 'https://allegro.pl/oferta/test-123456789',
      input_type: 'allegro_url',
      context: { product_url: 'https://allegro.pl/oferta/test-123456789' },
    });

    expect(q.id).toBeTruthy();
    expect(q.status).toBe('queued');
    expect(q.user_id).toBe(TEST_USER_ID);

    const found = await getQueryForUser(q.id, TEST_USER_ID);
    expect(found).not.toBeUndefined();
    expect(found!.input).toBe('https://allegro.pl/oferta/test-123456789');

    // Cleanup
    await db.from('queries').delete().eq('id', q.id);
    await db.from('profiles').delete().eq('id', TEST_USER_ID);
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS (current store uses Map, not Supabase)**

```bash
npx vitest run src/lib/__tests__/store.test.ts
```

Expected: FAIL or SKIP (if no Supabase env vars). If skip, that's fine — we rely on the curl integration test in Step 7.

- [ ] **Step 3: Replace src/lib/store.ts**

```typescript
/**
 * Data access layer — Phase 2b: backed by Supabase Postgres.
 *
 * Exported function signatures are identical to Phase 2a so no route file changes.
 * The `resolved` fields (ean, product_url, product_name, ocoi_token) are stored
 * as separate columns in the queries table, not in JSONB.
 */
import { createServiceClient } from '@/lib/db';
import type { QueryDetail, QueryStatus, AnalysisResult } from '@/types/api';

export interface CreateQueryInput {
  user_id: string;
  input: string;
  input_type: QueryDetail['input_type'];
  context?: QueryDetail['resolved'];
}

// ─── Shape helpers ────────────────────────────────────────────────────────────

function rowToQueryDetail(row: Record<string, unknown>, analysis?: Record<string, unknown> | null): QueryDetail {
  const q: QueryDetail = {
    id: row.id as string,
    user_id: row.user_id as string,
    status: row.status as QueryStatus,
    status_message: row.status_message as string | undefined,
    created_at: row.created_at as string,
    completed_at: row.completed_at as string | undefined,
    input: row.input as string,
    input_type: row.input_type as QueryDetail['input_type'],
    resolved: {
      ean: row.ean as string | undefined,
      product_url: row.product_url as string | undefined,
      product_name: row.product_name as string | undefined,
      ocoi_token: row.ocoi_token as string | undefined,
    },
  };

  if (row.error_code) {
    q.error = {
      code: row.error_code as string,
      message: row.error_message as string,
      retryable: row.error_retryable as boolean,
    };
  }

  if (analysis) {
    q.result = {
      market: analysis.market_summary as AnalysisResult['market'],
      archetype: {
        archetype: analysis.archetype as AnalysisResult['archetype']['archetype'],
        confidence: analysis.archetype_confidence as AnalysisResult['archetype']['confidence'],
        reasoning: analysis.archetype_reasoning as string,
        playbook_summary: analysis.archetype_playbook as string,
      },
      offers: (analysis.offers ?? []) as AnalysisResult['offers'],
      recommendations: (analysis.recommendations ?? []) as AnalysisResult['recommendations'],
      user_seller_verdict: analysis.user_seller_verdict as AnalysisResult['user_seller_verdict'],
    };
  }

  return q;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function insertQuery(input: CreateQueryInput): Promise<QueryDetail> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('queries')
    .insert({
      user_id: input.user_id,
      input: input.input,
      input_type: input.input_type,
      ean: input.context?.ean,
      product_url: input.context?.product_url,
      product_name: input.context?.product_name,
      ocoi_token: input.context?.ocoi_token,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`insertQuery failed: ${error?.message}`);
  return rowToQueryDetail(data);
}

export async function getQuery(id: string): Promise<QueryDetail | undefined> {
  const db = createServiceClient();
  const { data } = await db.from('queries').select('*').eq('id', id).single();
  if (!data) return undefined;
  // Fetch analysis if completed
  const { data: analysis } = await db.from('analyses').select('*').eq('query_id', id).maybeSingle();
  return rowToQueryDetail(data, analysis);
}

export async function getQueryForUser(id: string, user_id: string): Promise<QueryDetail | undefined> {
  const db = createServiceClient();
  const { data } = await db
    .from('queries')
    .select('*')
    .eq('id', id)
    .eq('user_id', user_id)
    .single();
  if (!data) return undefined;
  const { data: analysis } = await db.from('analyses').select('*').eq('query_id', id).maybeSingle();
  return rowToQueryDetail(data, analysis);
}

export async function listQueriesForUser(
  user_id: string,
  opts?: { status?: QueryStatus; limit?: number; offset?: number }
): Promise<{ queries: QueryDetail[]; total: number }> {
  const db = createServiceClient();
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;

  let query = db
    .from('queries')
    .select('*', { count: 'exact' })
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.status) query = query.eq('status', opts.status);

  const { data, count, error } = await query;
  if (error) throw new Error(`listQueriesForUser failed: ${error.message}`);

  return {
    queries: (data ?? []).map(row => rowToQueryDetail(row)),
    total: count ?? 0,
  };
}

export async function updateQueryStatus(
  id: string,
  status: QueryStatus,
  patch?: Partial<QueryDetail>
): Promise<QueryDetail | undefined> {
  const db = createServiceClient();
  const update: Record<string, unknown> = { status };
  if (patch?.status_message !== undefined) update.status_message = patch.status_message;
  if (patch?.resolved) {
    update.ean = patch.resolved.ean;
    update.product_url = patch.resolved.product_url;
    update.product_name = patch.resolved.product_name;
    update.ocoi_token = patch.resolved.ocoi_token;
  }
  if (status === 'completed' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('queries')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) return undefined;
  return rowToQueryDetail(data);
}

export async function attachResult(id: string, result: AnalysisResult): Promise<QueryDetail | undefined> {
  const db = createServiceClient();

  // Upsert offers (one row per offer)
  if (result.offers.length > 0) {
    const offersToInsert = result.offers.map(o => ({
      query_id: id,
      offer_id: o.offer_id,
      seller: o.seller,
      title: o.title,
      offer_url: o.offer_url,
      price: o.price,
      total_with_delivery: o.total_with_delivery,
      recommend_pct: o.recommend_pct,
      reviews: o.reviews,
      sold_recent: o.sold_recent,
      badges: o.badges,
      delivery_raw: o.delivery,
    }));
    await db.from('offers').upsert(offersToInsert, { onConflict: 'query_id,offer_id' });
  }

  // Upsert analysis
  await db.from('analyses').upsert({
    query_id: id,
    archetype: result.archetype.archetype,
    archetype_confidence: result.archetype.confidence,
    archetype_reasoning: result.archetype.reasoning,
    archetype_playbook: result.archetype.playbook_summary,
    market_summary: result.market,
    offers: result.offers,               // denormalized copy for fast reads
    recommendations: result.recommendations,
    user_seller_verdict: result.user_seller_verdict ?? null,
  }, { onConflict: 'query_id' });

  // Mark query completed
  const { data, error } = await db
    .from('queries')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) return undefined;
  const { data: analysis } = await db.from('analyses').select('*').eq('query_id', id).maybeSingle();
  return rowToQueryDetail(data, analysis);
}

/** Not used in Phase 2b (no in-memory state to reset). Kept for test compatibility. */
export function _resetStore() {
  // no-op: Supabase data is reset via test cleanup in individual test files
}
```

- [ ] **Step 4: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/__tests__/store.test.ts
```

Expected: PASS (or SKIP if no Supabase env vars — see integration test in Step 6).

- [ ] **Step 6: Manual integration test (requires running dev server + Supabase)**

```bash
# Start dev server: npm run dev (in another terminal)

# Get a JWT for your test user:
JWT=$(curl -s -X POST "https://YOUR_PROJECT_ID.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@shoppalyzer.dev","password":"testpass123"}' | jq -r .access_token)

# Submit a query:
curl -s -X POST http://localhost:3000/api/v1/queries \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"input":"https://allegro.pl/oferta/test-12345678"}' | jq .

# List queries:
curl -s http://localhost:3000/api/v1/queries \
  -H "Authorization: Bearer $JWT" | jq .
```

Expected: POST → 201 with query_id; GET → 200 with the query listed.

Check in Supabase dashboard → Table Editor → queries: you should see the row.

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.ts src/lib/__tests__/store.test.ts
git commit -m "feat: replace in-memory store with Supabase Postgres queries"
```

---

## Task 5: Allegro HTML scraper

**Files:**
- Create: `src/lib/allegro-scraper.ts`
- Create: `src/lib/__tests__/allegro-scraper.test.ts`

This module:
1. Calls Firecrawl via `FirecrawlPool` to get Allegro HTML
2. Parses the HTML to extract seller offers

Allegro aggregator URL pattern: `https://allegro.pl/oferta/<slug>?ocoi=<token>`
HTML patterns:
- Sold count: `aria-label` attribute containing Polish phrases: `kupiła` (1 sale), `kupiły` (2-4), `kupiło` (≥5)
- Badges: CSS class names / aria-labels for "Smart!", "Super Sprzedawca", "TOP OFERTA", "oficjalny sklep", "Firma"
- Price: `<meta itemprop="price">` or visible price element
- Seller name: `data-analytics-seller-login` or anchor text
- Offer ID: extracted from `data-item-id` or the offer URL

- [ ] **Step 1: Write the parsing unit test with a fixture**

Create `src/lib/__tests__/allegro-scraper.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { parseAllegroOffers } from '../allegro-scraper';

// Minimal HTML fixture that mimics Allegro's seller list structure
const FIXTURE_HTML = `
<article data-item-id="12345678" data-analytics-seller-login="topSeller1">
  <a href="/oferta/product-name-12345678">Product Title</a>
  <meta itemprop="price" content="249.99">
  <span aria-label="5 osób kupiło ostatnio" class="...">5</span>
  <span aria-label="Smart! - darmowa dostawa" class="badge-smart">Smart!</span>
  <span aria-label="Super Sprzedawca" class="badge-ss">Super Sprzedawca</span>
  <span aria-label="Ocena sprzedawcy 98%">98%</span>
</article>
<article data-item-id="87654321" data-analytics-seller-login="cheapSeller">
  <a href="/oferta/product-name-87654321">Product Title Alt</a>
  <meta itemprop="price" content="219.00">
  <span aria-label="1 osoba kupiła ostatnio">1</span>
  <span aria-label="Ocena sprzedawcy 85%">85%</span>
</article>
`;

describe('parseAllegroOffers', () => {
  test('extracts offer count', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers).toHaveLength(2);
  });

  test('extracts seller name and offer ID', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].seller).toBe('topSeller1');
    expect(offers[0].offer_id).toBe('12345678');
  });

  test('extracts price', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].price).toBe(249.99);
    expect(offers[1].price).toBe(219.00);
  });

  test('extracts sold count from Polish aria-labels', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].sold_recent).toBe(5);
    expect(offers[1].sold_recent).toBe(1);
  });

  test('detects Smart and Super Sprzedawca badges', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].badges.smart).toBe(true);
    expect(offers[0].badges.super_seller).toBe(true);
    expect(offers[1].badges.smart).toBe(false);
  });

  test('extracts recommend percent', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].recommend_pct).toBe(98);
    expect(offers[1].recommend_pct).toBe(85);
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS (file doesn't exist yet)**

```bash
npx vitest run src/lib/__tests__/allegro-scraper.test.ts
```

Expected: FAIL with "Cannot find module '../allegro-scraper'"

- [ ] **Step 3: Create src/lib/allegro-scraper.ts**

```typescript
/**
 * Allegro scraper — wraps Firecrawl and parses Allegro HTML.
 *
 * scrapeAllegroPage(url) → fetches HTML via FirecrawlPool
 * parseAllegroOffers(html) → extracts offer list from HTML
 */
import path from 'path';
import type { Offer } from '@/types/api';

// FirecrawlPool is a plain JS module in a sibling repo
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FirecrawlPool } = require(
  path.join(process.env.SHOPPALYZER_TOOLS_PATH || 'C:/Users/WojciechRudnicki/Claude_code/shoppalyzer-tools', 'firecrawl-pool.js')
);

let _pool: InstanceType<typeof FirecrawlPool> | null = null;
function getPool() {
  if (!_pool) _pool = new FirecrawlPool({ verbose: false });
  return _pool;
}

/**
 * Scrape an Allegro page via Firecrawl. Returns raw HTML.
 * Uses proxy:stealth to bypass bot detection.
 */
export async function scrapeAllegroPage(url: string): Promise<string> {
  const result = await getPool().scrape({
    url,
    formats: ['html'],
    proxy: 'stealth',
    waitFor: 5000,
  });
  return result.html ?? result.rawHtml ?? '';
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Polish grammar patterns for "X people bought recently":
 *  1 osoba kupiła    (1 sale)
 *  2-4 osoby kupiły  (2-4 sales)
 *  5+ osób kupiło    (5+ sales)
 * Also: "X osób kupiło ostatnio" in header (market total, skip for per-seller)
 */
const SOLD_PATTERNS: [RegExp, number][] = [
  [/(\d+)\s+osob[ay]\s+kupi[łl][ayoię]+/i, 1],  // generic catch-all
  [/(\d+)\s+osoba\s+kupi[łl]a/i, 1],              // exactly 1
  [/(\d+)\s+osoby\s+kupi[łl]y/i, 1],              // 2-4
  [/(\d+)\s+osób\s+kupi[łl]o/i, 1],               // 5+
];

function extractSoldCount(text: string): number {
  for (const [pattern] of SOLD_PATTERNS) {
    const m = text.match(pattern);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

function extractRecommendPct(text: string): number | undefined {
  const m = text.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Very lightweight HTML parser — uses regex instead of a DOM library to keep
 * dependencies minimal. Sufficient for Allegro's consistent HTML structure.
 * If Allegro changes their markup, update patterns here.
 */
export function parseAllegroOffers(html: string): Offer[] {
  const offers: Offer[] = [];

  // Split into article blocks — each seller is in an <article> element
  const articlePattern = /<article([^>]*)>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = articlePattern.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2];

    // Offer ID
    const idMatch = attrs.match(/data-item-id="(\d+)"/);
    if (!idMatch) continue; // not a product article
    const offer_id = idMatch[1];

    // Seller name
    const sellerMatch = attrs.match(/data-analytics-seller-login="([^"]+)"/);
    const seller = sellerMatch?.[1] ?? 'unknown';

    // Title — first <a> anchor text
    const titleMatch = body.match(/<a[^>]+>([^<]+)<\/a>/);
    const title = titleMatch?.[1]?.trim() ?? '';

    // Offer URL
    const urlMatch = body.match(/href="(\/oferta\/[^"]+)"/);
    const offer_url = urlMatch ? `https://allegro.pl${urlMatch[1]}` : undefined;

    // Price — <meta itemprop="price" content="...">
    const priceMatch = body.match(/itemprop="price"\s+content="([\d.]+)"/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

    // All aria-labels for badge + sold detection
    const ariaLabels: string[] = [];
    const ariaPattern = /aria-label="([^"]+)"/g;
    let ariaMatch: RegExpExecArray | null;
    while ((ariaMatch = ariaPattern.exec(body)) !== null) {
      ariaLabels.push(ariaMatch[1]);
    }

    // Sold count — look for the per-seller sold label (not the market header)
    let sold_recent = 0;
    for (const label of ariaLabels) {
      // Skip market-level "ostatnio" if it appears in a section header
      if (label.includes('kupi') && !label.includes('ostatnio w tej kategorii')) {
        const n = extractSoldCount(label);
        if (n > 0) { sold_recent = n; break; }
      }
    }

    // Recommend percent
    let recommend_pct: number | undefined;
    for (const label of ariaLabels) {
      if (label.includes('Ocena sprzedawcy') || label.includes('sprzedawc')) {
        recommend_pct = extractRecommendPct(label);
        if (recommend_pct !== undefined) break;
      }
    }

    // Badges
    const allText = attrs + body;
    const badges = {
      smart: /smart!|darmowa\s+dostawa/i.test(allText),
      super_seller: /super\s+sprzedawca/i.test(allText),
      top_offer: /top\s+oferta/i.test(allText),
      contains_promo: /promo|rabat|obni[żz]/i.test(allText),
      sponsored: /sponsorowane|reklama/i.test(allText),
      firma: /\bfirma\b/i.test(allText),
      official_store: /oficjalny\s+sklep/i.test(allText),
    };

    // Reviews — look for numeric count near "opini" or "ocen"
    let reviews: number | undefined;
    const reviewMatch = body.match(/(\d+)\s+opini[ia]/i) ?? body.match(/(\d+)\s+ocen/i);
    if (reviewMatch) reviews = parseInt(reviewMatch[1], 10);

    // Delivery — look for delivery text
    let delivery: string | undefined;
    const delivMatch = body.match(/(?:dostawa|dostarczenie)[^<]*?(?:w\s+\w+|za\s+\d+\s+dni?|jutro|dzisiaj)/i);
    if (delivMatch) delivery = delivMatch[0].trim();

    offers.push({
      id: offer_id, // use offer_id as id for now
      offer_id,
      seller,
      title,
      offer_url,
      price,
      recommend_pct,
      reviews,
      sold_recent,
      delivery,
      badges,
    });
  }

  return offers;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/allegro-scraper.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: TypeScript compile check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/allegro-scraper.ts src/lib/__tests__/allegro-scraper.test.ts
git commit -m "feat: add Allegro HTML scraper with Firecrawl integration and parser tests"
```

---

## Task 6: Recommendation engine (analyzer)

**Files:**
- Create: `src/lib/analyzer.ts`
- Create: `src/lib/__tests__/analyzer.test.ts`

Implements:
- `buildAnalysisResult(offers, productName?)` → `AnalysisResult`
- Internal: `computeMarketSummary`, `classifyArchetype`, `scoreOffer`, `assignTier`, `buildRecommendation`

Scoring weights: badges 30%, price position 25%, recommend% 20%, reviews 15%, delivery 10%.

Archetype classification:
- **VOLUME_DRIVEN**: top-3 sellers hold >60% of total sales
- **PAY_TO_PLAY**: >40% of offers are sponsored
- **BADGE_DRIVEN**: >60% of top-selling sellers have Smart + Super Seller badges
- **PRICE_THRESHOLD**: there's a price break where conversion jumps (organic sellers above price X have 0 sales)
- **PRICE_TIERED**: clear price bands (use standard deviation clustering)
- **MIXED**: multiple signals overlap with no clear dominant
- **UNKNOWN**: insufficient data (<3 offers)

- [ ] **Step 1: Write analyzer tests**

Create `src/lib/__tests__/analyzer.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { buildAnalysisResult } from '../analyzer';
import type { Offer } from '@/types/api';

function makeOffer(overrides: Partial<Offer>): Offer {
  return {
    id: Math.random().toString(36).slice(2),
    offer_id: Math.random().toString(36).slice(2),
    seller: 'seller_' + Math.random().toString(36).slice(2, 6),
    price: 100,
    sold_recent: 0,
    title: 'Test Product',
    badges: { smart: false, super_seller: false, top_offer: false, contains_promo: false, sponsored: false, firma: false, official_store: false },
    ...overrides,
  };
}

describe('buildAnalysisResult', () => {
  test('returns UNKNOWN archetype for fewer than 3 offers', () => {
    const result = buildAnalysisResult([makeOffer({}), makeOffer({})]);
    expect(result.archetype.archetype).toBe('UNKNOWN');
  });

  test('computes market summary correctly', () => {
    const offers = [
      makeOffer({ price: 100, sold_recent: 10 }),
      makeOffer({ price: 200, sold_recent: 5 }),
      makeOffer({ price: 150, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.market.price_min).toBe(100);
    expect(result.market.price_max).toBe(200);
    expect(result.market.total_visible_sales_30d).toBe(15);
    expect(result.market.total_offers).toBe(3);
  });

  test('detects VOLUME_DRIVEN when top sellers dominate sales', () => {
    const offers = [
      makeOffer({ price: 100, sold_recent: 80 }),  // top seller
      makeOffer({ price: 110, sold_recent: 15 }),  // second
      makeOffer({ price: 120, sold_recent: 2 }),
      makeOffer({ price: 130, sold_recent: 1 }),
      makeOffer({ price: 140, sold_recent: 2 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.archetype.archetype).toBe('VOLUME_DRIVEN');
  });

  test('produces a recommendation per seller', () => {
    const offers = [
      makeOffer({ seller: 'sellerA', price: 100, sold_recent: 10 }),
      makeOffer({ seller: 'sellerB', price: 150, sold_recent: 2 }),
      makeOffer({ seller: 'sellerC', price: 200, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.recommendations).toHaveLength(3);
    const sellerA = result.recommendations.find(r => r.seller === 'sellerA');
    expect(sellerA).toBeDefined();
    expect(sellerA!.scorecard.score).toBeGreaterThan(0);
  });

  test('cheapest seller with most sales gets highest score', () => {
    const offers = [
      makeOffer({ seller: 'best', price: 99, sold_recent: 50, recommend_pct: 98 }),
      makeOffer({ seller: 'mid', price: 120, sold_recent: 10, recommend_pct: 90 }),
      makeOffer({ seller: 'worst', price: 180, sold_recent: 0, recommend_pct: 70 }),
    ];
    const result = buildAnalysisResult(offers);
    const scores = result.recommendations.map(r => ({ seller: r.seller, score: r.scorecard.score }));
    const best = scores.find(s => s.seller === 'best')!;
    const worst = scores.find(s => s.seller === 'worst')!;
    expect(best.score).toBeGreaterThan(worst.score);
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

```bash
npx vitest run src/lib/__tests__/analyzer.test.ts
```

Expected: FAIL with "Cannot find module '../analyzer'"

- [ ] **Step 3: Create src/lib/analyzer.ts**

```typescript
/**
 * Recommendation engine — converts raw offer data into AnalysisResult.
 *
 * Entry point: buildAnalysisResult(offers, productName?)
 */
import { randomUUID } from 'crypto';
import type {
  Offer,
  AnalysisResult,
  MarketSummary,
  ArchetypeAssessment,
  SellerRecommendation,
  Archetype,
  Tier,
  PromoteDecision,
  Confidence,
} from '@/types/api';

// ─── Market Summary ─────────────────────────────────────────────────────────

function computeMarketSummary(offers: Offer[]): MarketSummary {
  const organic = offers.filter(o => !o.badges.sponsored);
  const sponsored = offers.filter(o => o.badges.sponsored);

  const prices = offers.map(o => o.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const price_median = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];

  const totalSales = offers.reduce((s, o) => s + (o.sold_recent ?? 0), 0);

  // MSRP: highest price among badge-rich sellers, or top quartile
  const badgeRich = offers.filter(o => o.badges.smart || o.badges.official_store || o.badges.super_seller);
  let msrp_reference = 0;
  let msrp_source: MarketSummary['msrp_source'] = 'fallback';

  if (badgeRich.length > 0) {
    const official = badgeRich.filter(o => o.badges.official_store);
    if (official.length > 0) {
      msrp_reference = Math.max(...official.map(o => o.price));
      msrp_source = 'brand_retailer';
    } else {
      msrp_reference = Math.max(...badgeRich.map(o => o.price));
      msrp_source = 'top_quartile_badged';
    }
  } else {
    // Fallback: 75th percentile price
    const p75idx = Math.floor(prices.length * 0.75);
    msrp_reference = prices[p75idx] ?? prices[prices.length - 1] ?? 0;
    msrp_source = 'fallback';
  }

  return {
    total_offers: offers.length,
    organic_count: organic.length,
    sponsored_count: sponsored.length,
    total_visible_sales_30d: totalSales,
    price_min: prices[0] ?? 0,
    price_median,
    price_max: prices[prices.length - 1] ?? 0,
    msrp_reference,
    msrp_source,
  };
}

// ─── Archetype Classification ────────────────────────────────────────────────

function classifyArchetype(offers: Offer[], market: MarketSummary): ArchetypeAssessment {
  if (offers.length < 3) {
    return {
      archetype: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: 'Too few offers to classify market archetype.',
      playbook_summary: 'Gather more data before drawing conclusions.',
    };
  }

  const totalSales = market.total_visible_sales_30d;
  const sorted = [...offers].sort((a, b) => (b.sold_recent ?? 0) - (a.sold_recent ?? 0));
  const top3Sales = sorted.slice(0, 3).reduce((s, o) => s + (o.sold_recent ?? 0), 0);
  const sponsoredPct = market.sponsored_count / market.total_offers;
  const top5 = sorted.slice(0, 5);
  const badgedTop5 = top5.filter(o => o.badges.smart && o.badges.super_seller).length;

  const scores: Record<Archetype, number> = {
    VOLUME_DRIVEN: 0, PAY_TO_PLAY: 0, BADGE_DRIVEN: 0,
    PRICE_THRESHOLD: 0, PRICE_TIERED: 0, MIXED: 0, UNKNOWN: 0,
  };

  // VOLUME_DRIVEN: top 3 sellers hold >60% of sales
  if (totalSales > 0 && top3Sales / totalSales > 0.6) scores.VOLUME_DRIVEN += (top3Sales / totalSales);

  // PAY_TO_PLAY: >40% offers sponsored
  if (sponsoredPct > 0.4) scores.PAY_TO_PLAY += sponsoredPct;

  // BADGE_DRIVEN: top 5 sellers are mostly badge-rich
  if (top5.length > 0 && badgedTop5 / top5.length > 0.6) scores.BADGE_DRIVEN += badgedTop5 / top5.length;

  // PRICE_THRESHOLD: largest price range with 0 sales is above a cluster
  const priceGap = detectPriceThreshold(offers);
  if (priceGap > 0.15) scores.PRICE_THRESHOLD += priceGap;

  // PRICE_TIERED: offers cluster into 2+ distinct price bands
  const tierCount = detectPriceTiers(offers);
  if (tierCount >= 2) scores.PRICE_TIERED += Math.min(tierCount / 3, 1);

  const winner = Object.entries(scores).sort(([, a], [, b]) => b - a)[0];
  const winnerScore = winner[1];
  const archetype = winnerScore > 0.3 ? winner[0] as Archetype : 'MIXED';
  const confidence: Confidence = winnerScore > 0.7 ? 'HIGH' : winnerScore > 0.4 ? 'MEDIUM' : 'LOW';

  const playbooks: Record<Archetype, string> = {
    VOLUME_DRIVEN: 'A few sellers dominate sales. Focus on beating the leader on price or logistics, or target the long tail.',
    PAY_TO_PLAY: 'Sponsored placement is critical. Organic visibility is low — invest in Allegro Ads or accept lower volume.',
    BADGE_DRIVEN: 'Smart + Super Seller badges are table stakes. Get them before scaling ad spend.',
    PRICE_THRESHOLD: 'There is a clear price point below which conversion happens. Price below the threshold to convert.',
    PRICE_TIERED: 'Multiple price segments exist. Choose your tier deliberately and differentiate within it.',
    MIXED: 'Multiple dynamics are at play. Analyze each seller segment separately.',
    UNKNOWN: 'Insufficient data for recommendations.',
  };

  const reasonings: Record<Archetype, string> = {
    VOLUME_DRIVEN: `Top 3 sellers account for ${Math.round(top3Sales / Math.max(totalSales, 1) * 100)}% of visible sales.`,
    PAY_TO_PLAY: `${Math.round(sponsoredPct * 100)}% of offers are sponsored listings.`,
    BADGE_DRIVEN: `${badgedTop5} of top 5 sellers by sales have both Smart and Super Seller badges.`,
    PRICE_THRESHOLD: `Price-to-sales data shows a conversion cliff at ~${detectThresholdPrice(offers)} PLN.`,
    PRICE_TIERED: `Prices cluster into ${tierCount} distinct bands.`,
    MIXED: 'No single archetype dominates; multiple market forces are active.',
    UNKNOWN: 'Not enough offers to classify.',
  };

  return {
    archetype,
    confidence,
    reasoning: reasonings[archetype],
    playbook_summary: playbooks[archetype],
  };
}

function detectPriceThreshold(offers: Offer[]): number {
  // Sort by price; find biggest relative gap where high-price side has 0 sales
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].price - sorted[i - 1].price) / sorted[i - 1].price;
    const highSide = sorted.slice(i);
    const highSideSales = highSide.reduce((s, o) => s + (o.sold_recent ?? 0), 0);
    if (highSideSales === 0 && gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

function detectThresholdPrice(offers: Offer[]): number {
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  for (let i = 1; i < sorted.length; i++) {
    const highSide = sorted.slice(i);
    if (highSide.every(o => (o.sold_recent ?? 0) === 0)) return sorted[i - 1].price;
  }
  return 0;
}

function detectPriceTiers(offers: Offer[]): number {
  if (offers.length < 4) return 1;
  const prices = offers.map(o => o.price).sort((a, b) => a - b);
  const gaps = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const threshold = 0.15; // >15% jump = new tier
  return 1 + gaps.filter(g => g > threshold).length;
}

// ─── Seller Scoring ──────────────────────────────────────────────────────────

function scoreOffer(offer: Offer, market: MarketSummary): number {
  // Badge score (30%)
  const badgePoints = (offer.badges.smart ? 2 : 0) +
    (offer.badges.super_seller ? 2 : 0) +
    (offer.badges.top_offer ? 1 : 0) +
    (offer.badges.official_store ? 3 : 0) -
    (offer.badges.sponsored ? 0.5 : 0);
  const badgeScore = Math.min(badgePoints / 5, 1) * 30;

  // Price score (25%) — lower price relative to MSRP = better
  const priceRatio = market.msrp_reference > 0 ? offer.price / market.msrp_reference : 1;
  const priceScore = Math.max(0, (1 - Math.max(priceRatio - 0.6, 0) / 0.4)) * 25;

  // Recommend % score (20%)
  const recScore = ((offer.recommend_pct ?? 80) / 100) * 20;

  // Reviews score (15%) — log scale
  const revScore = offer.reviews
    ? Math.min(Math.log10(offer.reviews + 1) / 4, 1) * 15
    : 0;

  // Delivery score (10%)
  const delivery = offer.delivery ?? '';
  const delivScore = /dzisiaj|jutro|w\s+sobotę/i.test(delivery) ? 10 :
    /\d+\s+dni/.test(delivery) ? 5 : 7; // no delivery info = assume standard

  return Math.round(badgeScore + priceScore + recScore + revScore + delivScore);
}

function assignTier(offer: Offer, score: number, market: MarketSummary): { code: Tier; label: string; why: string } {
  const priceRatio = market.msrp_reference > 0 ? offer.price / market.msrp_reference : 1;
  const isLowPrice = priceRatio < 0.75;
  const hasBadges = offer.badges.smart || offer.badges.super_seller;
  const isOfficialStore = offer.badges.official_store;

  if (isOfficialStore) return { code: 'BRAND_RETAILER', label: 'Brand Retailer', why: 'Official store, sets market price anchor.' };
  if (hasBadges && offer.recommend_pct && offer.recommend_pct >= 95) return { code: 'MID_TRUST', label: 'Mid Trust', why: 'Trusted seller with badges, competitive price.' };
  if (isLowPrice && !hasBadges && (offer.recommend_pct ?? 0) < 90) return { code: 'DEEP_DISCOUNT', label: 'Deep Discount', why: 'Lowest price but low trust signals.' };
  if (!isLowPrice && priceRatio >= 0.9 && hasBadges) return { code: 'MSRP_HOLD', label: 'MSRP Hold', why: 'Holds near MSRP with badge credibility.' };
  if (isLowPrice && hasBadges) return { code: 'WEAK_DISCOUNT', label: 'Weak Discount', why: 'Discounted with some badge support.' };
  if (score < 30) return { code: 'UNTRUSTED_MIDDLE', label: 'Untrusted Middle', why: 'Mid-price with weak trust signals.' };
  return { code: 'MID_TRUST', label: 'Mid Trust', why: 'Average seller in competitive space.' };
}

function makePromoteDecision(offer: Offer, score: number, sold: number): { decision: PromoteDecision; confidence: Confidence; reasoning: string } {
  if (score >= 70 && sold >= 5) return { decision: 'PROMOTE', confidence: 'HIGH', reasoning: 'Strong score and proven sales. Amplify with ads.' };
  if (score >= 50 && sold >= 1) return { decision: 'TEST_PROMOTE', confidence: 'MEDIUM', reasoning: 'Decent score. Test promotion with small budget first.' };
  if (score < 30) return { decision: 'DONT_PROMOTE', confidence: 'HIGH', reasoning: 'Low score. Fix fundamentals (price, badges, reviews) before spending on ads.' };
  if (sold === 0) return { decision: 'OPTIONAL', confidence: 'LOW', reasoning: 'No recent sales data. Promotion impact uncertain.' };
  return { decision: 'TEST_PROMOTE', confidence: 'LOW', reasoning: 'Mixed signals. Small test recommended.' };
}

function buildRecommendation(offer: Offer, rank: number, total: number, market: MarketSummary, converting: Offer[]): SellerRecommendation {
  const score = scoreOffer(offer, market);
  const tier = assignTier(offer, score, market);
  const promote = makePromoteDecision(offer, score, offer.sold_recent ?? 0);

  // Distance to conversion
  const isConverting = (offer.sold_recent ?? 0) > 0;
  const cheapestConverter = converting.sort((a, b) => a.price - b.price)[0];

  const distance_to_conversion = isConverting
    ? { status: 'converting' as const, message: 'This seller is actively converting sales.' }
    : converting.length === 0
    ? { status: 'unknown' as const, message: 'No sellers with known sales data.' }
    : {
        status: 'non_converting' as const,
        price_above_cheapest_converter: cheapestConverter ? offer.price - cheapestConverter.price : null,
        price_above_cheapest_converter_pct: cheapestConverter
          ? Math.round(((offer.price - cheapestConverter.price) / cheapestConverter.price) * 100)
          : null,
        nearest_converter: cheapestConverter
          ? { seller: cheapestConverter.seller, price: cheapestConverter.price, sold: cheapestConverter.sold_recent ?? 0, gap: offer.price - cheapestConverter.price }
          : null,
        nearest_cheaper_converter: cheapestConverter && cheapestConverter.price < offer.price
          ? { seller: cheapestConverter.seller, price: cheapestConverter.price, sold: cheapestConverter.sold_recent ?? 0, gap_to_close: offer.price - cheapestConverter.price }
          : null,
      };

  const what_if_moves = [];
  if (!offer.badges.smart) what_if_moves.push({ move: 'Activate Smart delivery', change: '+Smart badge', predicted_tier: 'MID_TRUST', predicted_impact: 'Higher visibility in Smart filter, +10-20% CTR', feasibility: 'EASY' as const });
  if (offer.price > market.price_median) what_if_moves.push({ move: `Reduce price to ${Math.round(market.price_median)} PLN`, change: `-${Math.round(offer.price - market.price_median)} PLN`, predicted_tier: tier.code, predicted_impact: 'Enter median price band, increase conversion probability', feasibility: 'EASY-MEDIUM' as const });
  if (!offer.badges.super_seller) what_if_moves.push({ move: 'Earn Super Seller badge', change: '+Super Seller', predicted_tier: 'MID_TRUST', predicted_impact: 'Strong trust signal, opens access to top positions', feasibility: 'MEDIUM' as const });

  const topOfferProb = rank <= 1 ? 'HIGH' as const : rank <= 3 ? 'MEDIUM' as const : rank <= 6 ? 'LOW' as const : 'VERY_LOW' as const;

  return {
    seller: offer.seller,
    tier,
    scorecard: {
      score,
      breakdown: {
        badges: `${(offer.badges.smart ? 'Smart ' : '')}${(offer.badges.super_seller ? 'SS ' : '')}`.trim() || 'None',
        price: `${offer.price} PLN (${Math.round((offer.price / market.msrp_reference) * 100)}% of MSRP)`,
        recommend: `${offer.recommend_pct ?? 'n/a'}%`,
        reviews: String(offer.reviews ?? 0),
        delivery: offer.delivery ?? 'standard',
      },
    },
    top_offer: {
      score,
      rank: rank + 1,
      probability: topOfferProb,
      predicted_winner: rank === 0,
    },
    distance_to_conversion,
    promote_recommendation: promote,
    what_if_moves: what_if_moves.slice(0, 3),
  };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export function buildAnalysisResult(offers: Offer[], _productName?: string): AnalysisResult {
  // Assign stable IDs if missing
  const withIds = offers.map(o => ({ ...o, id: o.id || randomUUID() }));

  const market = computeMarketSummary(withIds);
  const archetype = classifyArchetype(withIds, market);

  const sorted = [...withIds].sort((a, b) => (b.sold_recent ?? 0) - (a.sold_recent ?? 0));
  const converting = withIds.filter(o => (o.sold_recent ?? 0) > 0);

  const recommendations = sorted.map((offer, rank) =>
    buildRecommendation(offer, rank, sorted.length, market, converting)
  );

  return {
    market,
    archetype,
    offers: withIds,
    recommendations,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/analyzer.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: TypeScript compile check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/analyzer.ts src/lib/__tests__/analyzer.test.ts
git commit -m "feat: add recommendation engine with archetype classification and seller scoring"
```

---

## Task 7: Scrape worker

**Files:**
- Create: `src/workers/scrape-worker.js`

This is a plain Node.js script (not TypeScript) — it runs outside Next.js as `npm run worker`.

Pipeline for each query:
1. **Claim** — atomic `UPDATE ... WHERE status='queued' RETURNING *` prevents double-processing
2. **discovering** — if input is EAN, search Allegro for the aggregator URL; if allegro_url/product_url, resolve the aggregator URL
3. **scraping** — call Firecrawl via FirecrawlPool
4. **parsing** — call parseAllegroOffers (via dynamic import of the compiled TS module... wait, this is JS, not TS. We need to either compile or use a different approach)

Wait — the worker is `.js` and it needs to call `parseAllegroOffers` from `allegro-scraper.ts` and `buildAnalysisResult` from `analyzer.ts`. Since we're in a Next.js project with TypeScript, the `.ts` files are compiled by Next.js for API routes but NOT by the Node.js worker directly.

Solution: compile the TS lib files to JS for worker consumption.

Option A: Use ts-node for the worker (`npx ts-node src/workers/scrape-worker.ts`)
Option B: Keep worker as JS, inline the logic (or re-export as pure JS)
Option C: Add a build step that compiles `src/lib/` to `dist/lib/`

**Best approach for minimal friction:** Use `tsx` (a modern ts-node alternative) to run the worker as TypeScript directly.

Change:
- Worker file: `src/workers/scrape-worker.ts` (TypeScript)
- Run with: `npx tsx src/workers/scrape-worker.ts`
- Update `package.json` worker script: `"worker": "tsx src/workers/scrape-worker.ts"`

- [ ] **Step 1: Install tsx**

```bash
npm install -D tsx
```

- [ ] **Step 2: Update package.json worker script**

In `package.json` scripts, change:
```json
"worker": "node src/workers/scrape-worker.js"
```
to:
```json
"worker": "tsx src/workers/scrape-worker.ts"
```

- [ ] **Step 3: Create src/workers/scrape-worker.ts**

```typescript
/**
 * Shoppalyzer Scrape Worker
 *
 * Long-running process that polls the `queries` table for queued jobs,
 * runs the Firecrawl pipeline, and writes results back to Supabase.
 *
 * Run with: npm run worker
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   (Firecrawl keys live in ~/.shoppalyzer/firecrawl-keys.json)
 */

import 'dotenv/config';  // load .env.local for local dev
import path from 'path';
import { createServiceClient } from '@/lib/db';
import { scrapeAllegroPage, parseAllegroOffers } from '@/lib/allegro-scraper';
import { buildAnalysisResult } from '@/lib/analyzer';
import type { QueryStatus } from '@/types/api';

const POLL_INTERVAL_MS = 10_000; // 10 seconds between polls
const TOOLS_PATH = process.env.SHOPPALYZER_TOOLS_PATH ?? 'C:/Users/WojciechRudnicki/Claude_code/shoppalyzer-tools';

// ─── Supabase client ─────────────────────────────────────────────────────────

const db = createServiceClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(queryId: string | null, step: string, msg: string) {
  const prefix = queryId ? `[${queryId.slice(0, 8)}]` : '[worker]';
  console.log(`${new Date().toISOString()} ${prefix} [${step}] ${msg}`);
}

async function setStatus(id: string, status: QueryStatus, message?: string) {
  const update: Record<string, unknown> = { status };
  if (message) update.status_message = message;
  if (status === 'completed' || status === 'failed') update.completed_at = new Date().toISOString();
  const { error } = await db.from('queries').update(update).eq('id', id);
  if (error) log(id, status, `WARNING: status update failed: ${error.message}`);
}

async function logScrapeJob(queryId: string, step: string, url: string, credits: number, status: 'succeeded' | 'failed', errorMsg?: string) {
  await db.from('scrape_jobs').insert({
    query_id: queryId,
    step,
    url,
    status,
    credits_used: credits,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    error_message: errorMsg,
  });
}

// ─── Allegro URL resolution ──────────────────────────────────────────────────

async function resolveAggregatorUrl(query: Record<string, unknown>): Promise<string | null> {
  const { input, input_type, product_url, ean } = query;

  // If we already have a product_url (allegro_url or product_url input type), use it directly
  if (typeof product_url === 'string' && product_url) return product_url;
  if (input_type === 'allegro_url' || input_type === 'product_url') {
    return typeof input === 'string' ? input : null;
  }

  // EAN: search Allegro for the product
  if (input_type === 'ean' && ean) {
    const searchUrl = `https://allegro.pl/listing?string=${encodeURIComponent(String(ean))}&order=d`;
    log(query.id as string, 'discovering', `Searching Allegro for EAN ${ean}: ${searchUrl}`);
    try {
      const html = await scrapeAllegroPage(searchUrl);
      // Extract the first product URL from search results
      const productMatch = html.match(/href="(https:\/\/allegro\.pl\/oferta\/[^"?]+\?[^"]*ocoi=[^"]+)"/);
      if (productMatch) return productMatch[1];
      // Fallback: any allegro product link
      const fallback = html.match(/href="(https:\/\/allegro\.pl\/oferta\/[^"]+)"/);
      return fallback ? fallback[1] : null;
    } catch (err: unknown) {
      log(query.id as string, 'discovering', `EAN search failed: ${(err as Error).message}`);
      return null;
    }
  }

  return null;
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

async function processQuery(query: Record<string, unknown>) {
  const id = query.id as string;
  log(id, 'start', `Processing query: ${query.input}`);

  // ── discovering ──────────────────────────────────────────────────────────
  await setStatus(id, 'discovering', 'Resolving product URL...');

  const aggregatorUrl = await resolveAggregatorUrl(query);
  if (!aggregatorUrl) {
    await setStatus(id, 'failed', 'Could not resolve Allegro aggregator URL.');
    await db.from('queries').update({ error_code: 'RESOLUTION_FAILED', error_message: 'Could not find Allegro product page for the given input.', error_retryable: false }).eq('id', id);
    log(id, 'discovering', 'FAILED: could not resolve aggregator URL');
    return;
  }

  log(id, 'discovering', `Resolved URL: ${aggregatorUrl}`);
  await db.from('queries').update({ product_url: aggregatorUrl }).eq('id', id);

  // ── scraping ─────────────────────────────────────────────────────────────
  await setStatus(id, 'scraping', 'Fetching Allegro page via Firecrawl...');

  let html: string;
  try {
    html = await scrapeAllegroPage(aggregatorUrl);
    await logScrapeJob(id, 'offers_aggregator', aggregatorUrl, 10, 'succeeded');
    log(id, 'scraping', `Fetched ${html.length} chars of HTML`);
  } catch (err: unknown) {
    await logScrapeJob(id, 'offers_aggregator', aggregatorUrl, 0, 'failed', (err as Error).message);
    await setStatus(id, 'failed', `Scrape failed: ${(err as Error).message}`);
    await db.from('queries').update({ error_code: 'SCRAPE_FAILED', error_message: (err as Error).message, error_retryable: true }).eq('id', id);
    log(id, 'scraping', `FAILED: ${(err as Error).message}`);
    return;
  }

  // ── parsing ──────────────────────────────────────────────────────────────
  await setStatus(id, 'parsing', 'Parsing seller offers...');

  const offers = parseAllegroOffers(html);
  log(id, 'parsing', `Parsed ${offers.length} offers`);

  if (offers.length === 0) {
    await setStatus(id, 'failed', 'No offers found on the page. Allegro markup may have changed.');
    await db.from('queries').update({ error_code: 'PARSE_EMPTY', error_message: 'No seller offers could be parsed from the Allegro page.', error_retryable: true }).eq('id', id);
    return;
  }

  // ── analyzing ────────────────────────────────────────────────────────────
  await setStatus(id, 'analyzing', 'Running recommendation engine...');

  const productName = query.product_name as string | undefined;
  const result = buildAnalysisResult(offers, productName);
  log(id, 'analyzing', `Archetype: ${result.archetype.archetype}, ${result.recommendations.length} recommendations`);

  // ── saving results ───────────────────────────────────────────────────────
  // Upsert offers
  if (result.offers.length > 0) {
    const { error: offersError } = await db.from('offers').upsert(
      result.offers.map(o => ({
        query_id: id,
        offer_id: o.offer_id,
        seller: o.seller,
        title: o.title,
        offer_url: o.offer_url,
        price: o.price,
        total_with_delivery: o.total_with_delivery,
        recommend_pct: o.recommend_pct,
        reviews: o.reviews,
        sold_recent: o.sold_recent,
        badges: o.badges,
        delivery_raw: o.delivery,
      })),
      { onConflict: 'query_id,offer_id' }
    );
    if (offersError) log(id, 'analyzing', `WARNING: offers upsert failed: ${offersError.message}`);
  }

  // Upsert analysis
  const { error: analysisError } = await db.from('analyses').upsert({
    query_id: id,
    archetype: result.archetype.archetype,
    archetype_confidence: result.archetype.confidence,
    archetype_reasoning: result.archetype.reasoning,
    archetype_playbook: result.archetype.playbook_summary,
    market_summary: result.market,
    offers: result.offers,
    recommendations: result.recommendations,
    user_seller_verdict: result.user_seller_verdict ?? null,
  }, { onConflict: 'query_id' });

  if (analysisError) {
    log(id, 'analyzing', `FAILED to save analysis: ${analysisError.message}`);
    await setStatus(id, 'failed', 'Failed to save analysis to database.');
    return;
  }

  // Mark completed
  await db.from('queries').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    status_message: `Analysis complete: ${result.archetype.archetype} market, ${result.offers.length} sellers analyzed.`,
  }).eq('id', id);

  log(id, 'completed', `✓ Done. ${result.offers.length} offers, archetype: ${result.archetype.archetype}`);
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function claimNextQuery(): Promise<Record<string, unknown> | null> {
  // Atomic claim: pick oldest queued query and immediately mark it 'discovering'
  // This prevents two worker instances from picking the same query.
  const { data, error } = await db.rpc('claim_queued_query');

  if (error) {
    // RPC not available yet — fall back to non-atomic read+update
    const { data: rows } = await db
      .from('queries')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!rows || rows.length === 0) return null;
    const q = rows[0];
    await db.from('queries').update({ status: 'discovering' }).eq('id', q.id).eq('status', 'queued');
    return q;
  }

  return data ?? null;
}

async function poll() {
  try {
    const query = await claimNextQuery();
    if (!query) return; // nothing to do

    await processQuery(query);
  } catch (err: unknown) {
    console.error(`[worker] Unhandled error in poll():`, (err as Error).message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  log(null, 'startup', '=== Shoppalyzer Scrape Worker starting ===');
  log(null, 'startup', `Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  log(null, 'startup', `Poll interval: ${POLL_INTERVAL_MS}ms`);
  log(null, 'startup', `Tools path: ${TOOLS_PATH}`);

  // Verify Supabase connection
  const { error } = await db.from('queries').select('count').limit(1);
  if (error) {
    console.error('[worker] Cannot connect to Supabase:', error.message);
    process.exit(1);
  }
  log(null, 'startup', '✓ Supabase connection OK');

  // Initial poll immediately, then every POLL_INTERVAL_MS
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Load .env.local in worker (install dotenv)**

```bash
npm install dotenv
```

- [ ] **Step 5: TypeScript compile check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 6: Commit**

```bash
git add src/workers/scrape-worker.ts package.json package-lock.json
git commit -m "feat: add polling scrape worker (Firecrawl → parse → analyze → Supabase)"
```

---

## Task 8: End-to-end integration test

Verify the full pipeline: submit a query via API → worker processes it → poll until completed → check results.

- [ ] **Step 1: Start the dev server in one terminal**

```bash
npm run dev
```

- [ ] **Step 2: Get a JWT**

```bash
JWT=$(curl -s -X POST "https://YOUR_PROJECT_ID.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@shoppalyzer.dev","password":"testpass123"}' | jq -r .access_token)
echo "JWT obtained: ${JWT:0:20}..."
```

- [ ] **Step 3: Submit a query**

```bash
QUERY_ID=$(curl -s -X POST http://localhost:3000/api/v1/queries \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"input":"https://allegro.pl/oferta/apple-airpods-pro-2-sluchawki-bezprzewodowe-12345678"}' | jq -r .query.query_id)
echo "Query ID: $QUERY_ID"
```

Expected: `{"query":{"query_id":"...","status":"queued","estimated_completion":"..."}}`

- [ ] **Step 4: Start the worker in another terminal**

```bash
npm run worker
```

Expected worker output:
```
2026-05-16T... [startup] === Shoppalyzer Scrape Worker starting ===
2026-05-16T... [startup] ✓ Supabase connection OK
2026-05-16T... [xxxxxxxx] [start] Processing query: https://allegro.pl/...
2026-05-16T... [xxxxxxxx] [discovering] Resolved URL: ...
2026-05-16T... [xxxxxxxx] [scraping] Fetched NNNNN chars of HTML
2026-05-16T... [xxxxxxxx] [parsing] Parsed N offers
2026-05-16T... [xxxxxxxx] [analyzing] Archetype: VOLUME_DRIVEN, N recommendations
2026-05-16T... [xxxxxxxx] [completed] ✓ Done. N offers, archetype: VOLUME_DRIVEN
```

- [ ] **Step 5: Poll for completion**

```bash
curl -s "http://localhost:3000/api/v1/queries/$QUERY_ID" \
  -H "Authorization: Bearer $JWT" | jq '{status: .status, archetype: .result.archetype.archetype, offers: (.result.offers | length)}'
```

Expected:
```json
{
  "status": "completed",
  "archetype": "VOLUME_DRIVEN",
  "offers": 15
}
```

- [ ] **Step 6: Verify in Supabase dashboard**

Open Supabase Table Editor:
- `queries` table → status = 'completed'
- `offers` table → rows for this query_id
- `analyses` table → 1 row for this query_id

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: Phase 2b complete — Supabase auth + store + scrape worker + analyzer"
```

---

## Self-Review

**Spec coverage:**
- ✅ Supabase client factory (db.ts)
- ✅ Real JWT auth (auth.ts)
- ✅ Postgres store replacing in-memory (store.ts)
- ✅ API routes return 401 on missing auth
- ✅ Allegro scraper (Firecrawl integration + HTML parser)
- ✅ Recommendation engine (archetype + scoring + tiers + promote decision + what-if moves)
- ✅ Scrape worker (polling + atomic claim + full pipeline + error handling)
- ✅ Unit tests for analyzer and parser
- ✅ Integration test plan (curl)

**Gaps / known limitations:**
- `claim_queued_query` RPC is not created in the migration — the worker falls back to non-atomic claim. For single-worker setups this is fine; for multi-worker, add a Postgres function to the migration.
- `monthly_queries_used` is not yet incremented when a query is submitted (quota check is real but counter doesn't update). Add to `insertQuery` after Task 4.
- The `currentUserIdSync()` helper in auth.ts was removed — if any code depended on it, add it back returning `undefined`.

**Placeholder scan:** No TBDs or TODOs in code steps. All steps have runnable commands and actual code.

**Type consistency:**
- `insertQuery` returns `Promise<QueryDetail>` (was synchronous in Phase 2a — routes `await` it now)
- `getQueryForUser`, `listQueriesForUser`, `updateQueryStatus`, `attachResult` all return Promises
- Route handlers will need to `await` these calls — already handled in the route files (they were already `async`)

⚠️ **Breaking change in store.ts function signatures:** All functions are now `async` and return `Promise<T>`. The route files already `await` them, so no change needed there. But if any other code calls store functions synchronously, it will break.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-phase-2b-supabase-worker.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans

**Which approach?**
