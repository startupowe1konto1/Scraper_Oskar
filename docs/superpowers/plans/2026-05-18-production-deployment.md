# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Shoppalyzer from local-only to publicly accessible at `app.shoppalyzer.com`, fully autonomous (no laptop processes), at $0/month + $12/year for the domain.

**Architecture:** Next.js app + API routes deployed to Vercel from GitHub; scrape worker deployed to Fly.io as a Docker container (free shared-CPU tier); Supabase already hosts the database + auth in cloud; Firecrawl pool refactored to load keys from env vars and persist credit usage in Supabase (no more local JSON file).

**Tech Stack:** Next.js 14, Supabase (Postgres + Auth), Fly.io (Docker), Vercel, Sentry (error tracking), TypeScript.

---

## Pre-flight: Branch & Tests

- [ ] **Step 0a: Confirm tests pass**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
npm test
```

Expected: all 36 tests pass (5 test files).

- [ ] **Step 0b: Confirm no uncommitted secrets**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
git status --short
grep -rn "SUPABASE_SERVICE_ROLE_KEY\|fc-[a-f0-9]\{32\}" --include="*.ts" --include="*.tsx" --include="*.json" --exclude-dir=node_modules --exclude-dir=.next . 2>/dev/null || echo "clean"
```

Expected: `git status` shows only docs files. Grep returns nothing (no hardcoded keys).

---

## Phase 1 — GitHub Repo + Vercel Frontend (no worker yet)

### Task 1: GitHub remote and first push

**Files:**
- Modify: `.gitignore` (verify exclusions)

- [ ] **Step 1: Verify .gitignore covers all secret-bearing files**

Read `.gitignore`. It must contain at minimum these lines (add any missing):

```
.env
.env.local
.env*.local
node_modules/
.next/
.firecrawl/
tsconfig.tsbuildinfo
e2e-jwt.txt
```

If any are missing, edit `.gitignore` and append them, then:

```bash
git add .gitignore
git commit -m "chore: ensure .gitignore covers secrets and build artifacts"
```

- [ ] **Step 2: User action — create GitHub repo**

Tell the user to:
1. Go to https://github.com/new
2. Name: `shoppalyzer-backend`
3. Visibility: **Private**
4. Do NOT initialize with README/license/.gitignore (we already have all of those)
5. After creation, copy the SSH or HTTPS URL

Wait for the user to confirm completion and provide the URL.

- [ ] **Step 3: Add remote and push**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
git remote add origin <URL-from-user>
git branch -M main   # GitHub default is 'main', we're on 'master'
git push -u origin main
```

Expected: pushes ~10 commits. GitHub repo page shows the code.

- [ ] **Step 4: Smoke check the push**

Open the GitHub repo page in browser. Confirm:
- `src/`, `docs/`, `package.json` are visible
- `.env.local` is NOT visible (gitignored correctly)
- Latest commit is `docs: swap Railway for Fly.io in deployment spec` or similar

---

### Task 2: Deploy Next.js frontend to Vercel

**Files:** No code changes. All configuration happens in the Vercel dashboard.

- [ ] **Step 1: User action — connect Vercel to GitHub**

Tell the user to:
1. Go to https://vercel.com/new
2. Sign in with GitHub (authorize Vercel to read the private repo)
3. Click "Import" on `shoppalyzer-backend`
4. Framework preset: Next.js (auto-detected)
5. Root directory: `./` (default)
6. Build/output settings: leave defaults
7. Before clicking Deploy, add environment variables (next step)

Wait for user confirmation that they're on the env vars screen.

- [ ] **Step 2: Set Vercel environment variables**

Tell the user to add the following env vars (Production scope), reading values from their local `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL = https://tleuuotfiuvqqyulblhk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = <copy from .env.local>
SUPABASE_SERVICE_ROLE_KEY = <copy from .env.local>
```

Sentry DSN will be added in Phase 4. Click Deploy.

- [ ] **Step 3: Wait for first deploy and verify**

Deploy takes ~2 min. Once done, open the `*.vercel.app` URL. Verify:
- Login page renders correctly with navy gradient "Zaloguj się" button
- `/signup` works
- No console errors on page load

Note: analyses submitted here will sit `queued` forever until Phase 3 (worker on Fly.io).

- [ ] **Step 4: Commit Vercel marker (no file change, just for tracking)**

No code commit needed. Move to Task 3.

---

### Task 3: Custom domain `app.shoppalyzer.com`

**Files:** No code changes.

- [ ] **Step 1: User action — buy `shoppalyzer.com`**

Tell the user to buy `shoppalyzer.com` from a registrar of their choice (recommend Cloudflare Registrar for at-cost pricing, ~$10/yr). Wait for confirmation.

If the user already owns the domain or wants to defer this step, skip to Phase 2 and come back to Task 3 later. The Vercel `*.vercel.app` URL works fine for the rest of the plan.

- [ ] **Step 2: Add domain in Vercel**

Tell the user:
1. Vercel project → Settings → Domains
2. Add `app.shoppalyzer.com`
3. Vercel shows the CNAME target (e.g., `cname.vercel-dns.com`)
4. Copy that CNAME target

- [ ] **Step 3: Configure DNS at registrar**

Tell the user to log into their domain registrar and add this DNS record:

```
Type:   CNAME
Name:   app
Value:  <CNAME target from Vercel>
TTL:    Auto / 3600
```

Wait 5–15 min for DNS propagation. Vercel will automatically issue an SSL cert.

- [ ] **Step 4: Verify**

Open https://app.shoppalyzer.com in a fresh browser tab. Expected: login page loads over HTTPS, no cert warning.

---

## Phase 2 — Firecrawl Pool Refactor

The current worker depends on `shoppalyzer-tools/firecrawl-pool.js`, which lives outside the backend repo. We need to port it into the backend, load keys from env, and persist credit usage in Supabase so it survives Fly.io VM restarts.

### Task 4: Supabase migration for `firecrawl_key_usage` table

**Files:**
- Create: `supabase/migrations/0003_firecrawl_usage.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0003_firecrawl_usage.sql`:

```sql
-- Persist Firecrawl API key usage so it survives worker restarts.
-- Worker reads the key list from FIRECRAWL_API_KEYS env var and upserts
-- usage counters into this table after each scrape.

CREATE TABLE IF NOT EXISTS firecrawl_key_usage (
  key_name TEXT PRIMARY KEY,
  credits_used INT NOT NULL DEFAULT 0,
  monthly_limit INT NOT NULL DEFAULT 1000,
  exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  exhausted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the service role should touch this table.
ALTER TABLE firecrawl_key_usage ENABLE ROW LEVEL SECURITY;
-- No policies — service_role bypasses RLS, no anon access at all.
```

- [ ] **Step 2: Apply the migration to Supabase**

Tell the user to open the Supabase SQL editor and paste/run the migration SQL. Confirm by querying:

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'firecrawl_key_usage';
```

Expected: one row returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_firecrawl_usage.sql
git commit -m "feat(db): add firecrawl_key_usage table for worker credit tracking"
```

---

### Task 5: Port FirecrawlPool to TypeScript

**Files:**
- Create: `src/lib/firecrawl-pool.ts`
- Create: `src/lib/__tests__/firecrawl-pool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/firecrawl-pool.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirecrawlPool } from '../firecrawl-pool';

// Minimal Supabase-like client mock that tracks upserts
function mockSupabase(rows: Record<string, unknown>[] = []) {
  const state: Record<string, unknown>[] = [...rows];
  return {
    from: () => ({
      select: () => Promise.resolve({ data: state, error: null }),
      upsert: (r: Record<string, unknown>) => {
        const idx = state.findIndex(x => x.key_name === r.key_name);
        if (idx >= 0) state[idx] = { ...state[idx], ...r };
        else state.push(r);
        return Promise.resolve({ data: r, error: null });
      },
    }),
    _state: state,
  };
}

describe('FirecrawlPool', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('picks the key with the most remaining credits', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 800, monthly_limit: 1000, exhausted: false },
      { key_name: 'key-b', credits_used: 100, monthly_limit: 1000, exhausted: false },
      { key_name: 'key-c', credits_used: 500, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [
        { name: 'key-a', value: 'fc-aaa' },
        { name: 'key-b', value: 'fc-bbb' },
        { name: 'key-c', value: 'fc-ccc' },
      ],
    });
    await pool.loadUsage();
    const picked = pool.pickKey();
    expect(picked?.name).toBe('key-b');
  });

  it('skips exhausted keys', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: true },
      { key_name: 'key-b', credits_used: 0, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [
        { name: 'key-a', value: 'fc-aaa' },
        { name: 'key-b', value: 'fc-bbb' },
      ],
    });
    await pool.loadUsage();
    expect(pool.pickKey()?.name).toBe('key-b');
  });

  it('returns null when all keys are exhausted', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: true },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [{ name: 'key-a', value: 'fc-aaa' }],
    });
    await pool.loadUsage();
    expect(pool.pickKey()).toBeNull();
  });

  it('parses FIRECRAWL_API_KEYS env var', () => {
    const keys = FirecrawlPool.parseEnvKeys('fc-aaa,fc-bbb , fc-ccc');
    expect(keys).toEqual([
      { name: 'key-1', value: 'fc-aaa' },
      { name: 'key-2', value: 'fc-bbb' },
      { name: 'key-3', value: 'fc-ccc' },
    ]);
  });

  it('parses FIRECRAWL_API_KEYS with explicit names (key-name:fc-...)', () => {
    const keys = FirecrawlPool.parseEnvKeys('alpha:fc-aaa,beta:fc-bbb');
    expect(keys).toEqual([
      { name: 'alpha', value: 'fc-aaa' },
      { name: 'beta', value: 'fc-bbb' },
    ]);
  });

  it('marks a key exhausted after a 402 response', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [{ name: 'key-a', value: 'fc-aaa' }],
    });
    await pool.loadUsage();
    // Stub the HTTPS call to always return 402
    vi.spyOn(pool as never, 'callFirecrawl').mockRejectedValue(
      Object.assign(new Error('Payment Required'), { status: 402 }),
    );
    await expect(pool.scrape({ url: 'https://example.com', formats: ['markdown'] })).rejects.toThrow();
    const rowAfter = db._state.find(r => r.key_name === 'key-a');
    expect(rowAfter?.exhausted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
npm test -- firecrawl-pool
```

Expected: FAIL with "Cannot find module '../firecrawl-pool'".

- [ ] **Step 3: Implement `src/lib/firecrawl-pool.ts`**

Create `src/lib/firecrawl-pool.ts`:

```typescript
/**
 * Firecrawl API key pool — TypeScript port of shoppalyzer-tools/firecrawl-pool.js
 * adapted for production:
 *   - Keys come from the FIRECRAWL_API_KEYS env var (comma-separated)
 *   - Per-key credit usage is persisted in Supabase (firecrawl_key_usage table)
 *     so it survives Fly.io VM restarts.
 *
 * Usage in the worker:
 *   const pool = new FirecrawlPool({
 *     db: serviceClient,
 *     keys: FirecrawlPool.parseEnvKeys(process.env.FIRECRAWL_API_KEYS ?? ''),
 *   });
 *   await pool.loadUsage();
 *   const result = await pool.scrape({ url, formats: ['rawHtml'], proxy: 'stealth' });
 */
import https from 'https';
import type { SupabaseClient } from '@supabase/supabase-js';

const FIRECRAWL_API_HOST = 'api.firecrawl.dev';
const DEFAULT_MONTHLY_LIMIT = 1000;

export interface PoolKey {
  name: string;
  value: string;
}

interface KeyState extends PoolKey {
  credits_used: number;
  monthly_limit: number;
  exhausted: boolean;
  last_used_at?: string;
  exhausted_at?: string;
}

export interface ScrapeOptions {
  url: string;
  formats?: string[];
  proxy?: 'basic' | 'stealth' | 'auto';
  waitFor?: number;
  [k: string]: unknown;
}

export interface ScrapeResult {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  metadata?: { creditsUsed?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export class FirecrawlPool {
  private db: SupabaseClient;
  private keys: KeyState[];
  private loaded = false;

  constructor(args: { db: SupabaseClient; keys: PoolKey[] }) {
    this.db = args.db;
    this.keys = args.keys.map(k => ({
      ...k,
      credits_used: 0,
      monthly_limit: DEFAULT_MONTHLY_LIMIT,
      exhausted: false,
    }));
  }

  /** Parse comma-separated env var into PoolKey[]. Supports "name:value" form. */
  static parseEnvKeys(raw: string): PoolKey[] {
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map((entry, idx) => {
        if (entry.includes(':') && !entry.startsWith('fc-')) {
          const colonIdx = entry.indexOf(':');
          return { name: entry.slice(0, colonIdx).trim(), value: entry.slice(colonIdx + 1).trim() };
        }
        return { name: `key-${idx + 1}`, value: entry };
      });
  }

  /** Load persisted usage from Supabase. Call once at startup. */
  async loadUsage(): Promise<void> {
    const { data, error } = await this.db.from('firecrawl_key_usage').select('*');
    if (error) throw new Error(`firecrawl_key_usage load failed: ${error.message}`);
    for (const row of (data ?? []) as KeyState[]) {
      const key = this.keys.find(k => k.name === row.key_name);
      if (!key) continue;
      key.credits_used = row.credits_used ?? 0;
      key.monthly_limit = row.monthly_limit ?? DEFAULT_MONTHLY_LIMIT;
      key.exhausted = row.exhausted ?? false;
      key.last_used_at = row.last_used_at;
      key.exhausted_at = row.exhausted_at;
    }
    this.loaded = true;
  }

  /** Pick the key with the most remaining credits. Returns null if all exhausted. */
  pickKey(): KeyState | null {
    const active = this.keys.filter(k => !k.exhausted);
    if (active.length === 0) return null;
    active.sort((a, b) => (b.monthly_limit - b.credits_used) - (a.monthly_limit - a.credits_used));
    return active[0];
  }

  /** Scrape with automatic key rotation on 402/429. */
  async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.loaded) await this.loadUsage();

    const tried = new Set<string>();
    let lastErr: unknown;

    while (tried.size < this.keys.length) {
      const key = this.pickKey();
      if (!key || tried.has(key.name)) break;
      tried.add(key.name);

      try {
        const result = await this.callFirecrawl(key.value, options);
        const used = (result.metadata?.creditsUsed ?? 0) || this.estimateCredits(options);
        key.credits_used += used;
        key.last_used_at = new Date().toISOString();
        await this.persistKey(key);
        return result;
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 402 || e.status === 429) {
          key.exhausted = true;
          key.exhausted_at = new Date().toISOString();
          await this.persistKey(key);
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    throw (lastErr as Error) ?? new Error('All Firecrawl keys exhausted or failed');
  }

  private estimateCredits(opts: ScrapeOptions): number {
    return opts.proxy === 'stealth' ? 10 : 1;
  }

  private async persistKey(key: KeyState): Promise<void> {
    const { error } = await this.db.from('firecrawl_key_usage').upsert(
      {
        key_name: key.name,
        credits_used: key.credits_used,
        monthly_limit: key.monthly_limit,
        exhausted: key.exhausted,
        last_used_at: key.last_used_at,
        exhausted_at: key.exhausted_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key_name' },
    );
    if (error) console.warn(`[firecrawl-pool] persist failed for ${key.name}: ${error.message}`);
  }

  // exposed protected for tests to stub
  protected callFirecrawl(apiKey: string, options: ScrapeOptions): Promise<ScrapeResult> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(options);
      const req = https.request(
        {
          hostname: FIRECRAWL_API_HOST,
          path: '/v1/scrape',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 120_000,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 402) {
              return reject(Object.assign(new Error('Payment Required'), { status: 402 }));
            }
            if (res.statusCode === 429) {
              return reject(Object.assign(new Error('Rate Limited'), { status: 429 }));
            }
            if ((res.statusCode ?? 500) >= 400) {
              return reject(
                Object.assign(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`), {
                  status: res.statusCode,
                }),
              );
            }
            try {
              const parsed = JSON.parse(data) as { success?: boolean; data?: ScrapeResult; error?: string };
              if (parsed.success === false) return reject(new Error(parsed.error ?? 'success=false'));
              resolve(parsed.data ?? (parsed as ScrapeResult));
            } catch (e) {
              reject(new Error(`Failed to parse response: ${(e as Error).message}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Firecrawl request timeout (120s)'));
      });
      req.write(body);
      req.end();
    });
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- firecrawl-pool
```

Expected: 6/6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/firecrawl-pool.ts src/lib/__tests__/firecrawl-pool.test.ts
git commit -m "feat(worker): TypeScript Firecrawl pool with Supabase-persisted usage"
```

---

### Task 6: Switch `allegro-scraper.ts` to use the new pool

**Files:**
- Modify: `src/lib/allegro-scraper.ts:22-38` (replace lazy-require with module-scoped pool)

- [ ] **Step 1: Edit `src/lib/allegro-scraper.ts`**

Replace lines 17–38 of `src/lib/allegro-scraper.ts` with:

```typescript
import type { Offer } from '@/types/api';
import { randomUUID } from 'crypto';
import { FirecrawlPool } from './firecrawl-pool';
import { createServiceClient } from './db';

let _pool: FirecrawlPool | null = null;

async function getPool(): Promise<FirecrawlPool> {
  if (!_pool) {
    const raw = process.env.FIRECRAWL_API_KEYS ?? '';
    if (!raw) throw new Error('FIRECRAWL_API_KEYS env var is required');
    _pool = new FirecrawlPool({
      db: createServiceClient(),
      keys: FirecrawlPool.parseEnvKeys(raw),
    });
    await _pool.loadUsage();
  }
  return _pool;
}
```

Then update the `scrapeAllegroPage` function (around line 44–55) so the await chain works with the new async `getPool()`:

```typescript
export async function scrapeAllegroPage(url: string): Promise<string> {
  const pool = await getPool();
  const result = await pool.scrape({
    url,
    formats: ['rawHtml'],
    proxy: 'stealth',
    waitFor: 5000,
  });
  return (result.rawHtml ?? result.html ?? '') as string;
}
```

Remove the `import path from 'path';` line at the top of the file — it's no longer needed.

- [ ] **Step 2: Re-run the existing allegro-scraper tests**

```bash
npm test -- allegro-scraper
```

Expected: tests still pass. If they fail due to network calls (the existing tests may invoke the real pool), update mocks to inject a fake FirecrawlPool — the tests should already mock at a higher level.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/allegro-scraper.ts
git commit -m "refactor(worker): switch allegro-scraper to env-driven Firecrawl pool"
```

---

### Task 7: Seed `firecrawl_key_usage` from current laptop pool

This is a one-time data migration so we don't reset all key counters when we go live.

**Files:**
- Create: `scripts/seed-firecrawl-usage.ts`

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-firecrawl-usage.ts`:

```typescript
/**
 * One-time seed of firecrawl_key_usage from the local laptop pool JSON file.
 * Run once during deployment, then never again.
 *
 *   npx tsx scripts/seed-firecrawl-usage.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createServiceClient } from '../src/lib/db';

const LOCAL_FILE = path.join(os.homedir(), '.shoppalyzer', 'firecrawl-keys.json');

async function main() {
  if (!fs.existsSync(LOCAL_FILE)) {
    console.error(`Local pool file not found at ${LOCAL_FILE}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')) as {
    keys: { name: string; credits_used?: number; monthly_limit?: number; exhausted?: boolean; last_used_at?: string }[];
  };
  const db = createServiceClient();

  for (const k of data.keys) {
    const row = {
      key_name: k.name,
      credits_used: k.credits_used ?? 0,
      monthly_limit: k.monthly_limit ?? 1000,
      exhausted: k.exhausted ?? false,
      last_used_at: k.last_used_at ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from('firecrawl_key_usage').upsert(row, { onConflict: 'key_name' });
    if (error) {
      console.error(`Failed for ${k.name}: ${error.message}`);
    } else {
      console.log(`✓ ${k.name}: ${row.credits_used} used / ${row.monthly_limit}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
npx tsx --env-file .env.local scripts/seed-firecrawl-usage.ts
```

Expected: 9 lines of output, one per key, all `✓`.

- [ ] **Step 3: Verify in Supabase**

In the Supabase SQL editor:

```sql
SELECT key_name, credits_used, monthly_limit FROM firecrawl_key_usage ORDER BY key_name;
```

Expected: 9 rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-firecrawl-usage.ts
git commit -m "chore: one-time seed script for firecrawl_key_usage from local pool"
```

---

## Phase 3 — Deploy Worker to Fly.io

### Task 8: Add Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile` at repo root:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install only production deps for a smaller image
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source (worker reads from src/workers + src/lib at runtime via tsx)
COPY tsconfig.json ./
COPY src ./src

# tsx is a dev dependency, install it explicitly for the runtime
RUN npm install tsx@^4 --no-save

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/workers/scrape-worker.ts"]
```

- [ ] **Step 2: Write the .dockerignore**

Create `.dockerignore`:

```
node_modules
.next
.git
.firecrawl
docs
*.md
README.md
e2e-jwt.txt
tsconfig.tsbuildinfo
.env*
supabase
scripts
```

- [ ] **Step 3: Build the Docker image locally to verify**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
docker build -t shoppalyzer-worker:test .
```

Expected: builds successfully. If Docker isn't installed on Windows, skip this step and trust Fly.io to build remotely.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): add Dockerfile for worker container"
```

---

### Task 9: Add `fly.toml` config

**Files:**
- Create: `fly.toml`

- [ ] **Step 1: Write the fly.toml**

Create `fly.toml`:

```toml
app = "shoppalyzer-worker"
primary_region = "waw"

[build]

[env]
  NODE_ENV = "production"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256

# No [http_service] block — this is a worker, no inbound HTTP

[processes]
  worker = "npx tsx src/workers/scrape-worker.ts"

[deploy]
  strategy = "rolling"

[[restart]]
  policy = "on-failure"
  retries = 10
```

- [ ] **Step 2: Commit**

```bash
git add fly.toml
git commit -m "feat(deploy): add fly.toml for worker hosting"
```

---

### Task 10: Deploy worker to Fly.io

**Files:** No code changes.

- [ ] **Step 1: User action — install Fly CLI**

Tell the user to install the Fly CLI:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Then verify:

```powershell
fly version
```

Expected: prints a version number. Wait for user confirmation.

- [ ] **Step 2: User action — log in and create the app**

Tell the user:

```bash
fly auth signup    # or `fly auth login` if account exists
fly apps create shoppalyzer-worker --org personal
```

If the app name is taken globally on Fly.io, suggest `shoppalyzer-worker-<random>` and update `fly.toml` accordingly.

- [ ] **Step 3: Set Fly secrets**

Tell the user, from the repo root:

```bash
fly secrets set NEXT_PUBLIC_SUPABASE_URL=https://tleuuotfiuvqqyulblhk.supabase.co
fly secrets set NEXT_PUBLIC_SUPABASE_ANON_KEY=<value from .env.local>
fly secrets set SUPABASE_SERVICE_ROLE_KEY=<value from .env.local>
fly secrets set FIRECRAWL_API_KEYS=<comma-separated keys from ~/.shoppalyzer/firecrawl-keys.json>
```

To assemble the FIRECRAWL_API_KEYS value, run:

```bash
node -e "const d = require(require('os').homedir()+'/.shoppalyzer/firecrawl-keys.json'); console.log(d.keys.map(k => k.name+':'+k.value).join(','));"
```

Then paste that whole string after `FIRECRAWL_API_KEYS=`.

- [ ] **Step 4: Deploy**

```bash
fly deploy
```

Expected: builds the Docker image remotely, ships it, starts the VM. Takes ~3–5 minutes.

- [ ] **Step 5: Verify worker is running**

```bash
fly logs
```

Expected log lines:

```
[worker] [startup] === Shoppalyzer Scrape Worker starting ===
[worker] [startup] Supabase: https://tleuuotfiuvqqyulblhk.supabase.co
[worker] [startup] ✓ Supabase connection OK
```

If you see crashes, check the logs for the actual error, fix, redeploy.

- [ ] **Step 6: End-to-end test through production**

In a browser:
1. Open the Vercel URL (or `app.shoppalyzer.com` if Task 3 is done)
2. Sign up with a fresh email
3. Submit the known-good Sony URL: `https://allegro.pl/oferty-produktu/sluchawki-bezprzewodowe-wokoluszne-sony-wh-1000xm5-e120b95a-1e21-4fac-8c84-fead7a8769ba?stan=nowe`
4. Watch `fly logs` — confirm worker picks it up, advances through statuses, completes
5. In the browser, confirm the results page renders with archetype, sellers, recommendations

If this works, the stack is fully on the web. ✅

---

## Phase 4 — Hardening

### Task 11: Sentry error tracking on Next.js + worker

**Files:**
- Modify: `package.json` (add `@sentry/nextjs` dep)
- Create (auto-generated): `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`
- Modify: `next.config.js` or `next.config.ts` (wrap with `withSentryConfig`)
- Modify: `src/workers/scrape-worker.ts:30-50` (init Sentry node SDK)

- [ ] **Step 1: User action — create Sentry projects**

Tell the user to:
1. Sign up at https://sentry.io (free tier)
2. Create project `shoppalyzer-web` (platform: Next.js) → copy DSN
3. Create project `shoppalyzer-worker` (platform: Node.js) → copy DSN

Wait for both DSN values.

- [ ] **Step 2: Run the Sentry Next.js wizard**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend"
npx @sentry/wizard@latest -i nextjs
```

Answer the prompts: paste the `shoppalyzer-web` DSN when asked. The wizard auto-creates the config files and modifies `next.config.ts`.

- [ ] **Step 3: Add Sentry to the worker**

Install the node SDK:

```bash
npm install @sentry/node
```

Modify `src/workers/scrape-worker.ts`. Add to the top of the file (before any other imports that might throw):

```typescript
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN_WORKER) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WORKER,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
  });
}
```

Then, in `markFailed()` (the worker's error handler), capture the exception:

```typescript
async function markFailed(/* existing args */) {
  Sentry.captureException(new Error(`${errorCode}: ${errorMessage}`), {
    tags: { query_id: id, error_code: errorCode },
  });
  // ...existing logic
}
```

- [ ] **Step 4: Add env vars to Vercel + Fly.io**

Tell the user:

```bash
# Fly.io
fly secrets set SENTRY_DSN_WORKER=<worker DSN>

# Vercel: add via dashboard
NEXT_PUBLIC_SENTRY_DSN = <web DSN>
SENTRY_AUTH_TOKEN = <from Sentry settings → Auth Tokens, for source map upload>
```

- [ ] **Step 5: Verify**

Push the code, redeploy. Then in production, trigger an intentional error (e.g., submit an invalid URL that the worker will fail on). Within ~60s, the error should appear in the Sentry dashboard for the correct project.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(observability): wire Sentry into Next.js app and worker"
```

---

### Task 12: Email verification + "check your email" screen

**Files:**
- Modify: Supabase Auth settings (dashboard, no code)
- Modify: `src/app/(auth)/signup/page.tsx` (post-signup screen)

- [ ] **Step 1: Enable email confirmation in Supabase**

Tell the user:
1. Supabase dashboard → Authentication → Providers → Email
2. Toggle "Confirm email" ON
3. Save

- [ ] **Step 2: Customize the verification email template (optional)**

Tell the user (optional polish, skip if in a hurry):
1. Supabase → Authentication → Email Templates → Confirm signup
2. Subject: `Potwierdź swój adres email – Shoppalyzer`
3. In the body, replace `{{ .SiteURL }}` references so the redirect goes to `https://app.shoppalyzer.com`

- [ ] **Step 3: Update signup page to show "check your email" screen**

Modify `src/app/(auth)/signup/page.tsx`. Replace the success handler (find the `signUp({...})` call) so that on success, it sets state to a new "sent" view instead of redirecting:

```typescript
// near the top of the component:
const [sentToEmail, setSentToEmail] = useState<string | null>(null);

// in handleSubmit, replace the success branch:
const { data, error } = await supabase.auth.signUp({ email, password });
if (error) {
  setError(error.message);
  return;
}
// Email confirmation is required — show the sent screen instead of redirecting
setSentToEmail(email);
```

Then, before the existing JSX, add a conditional render:

```tsx
if (sentToEmail) {
  return (
    <div className="mx-auto max-w-md py-16 px-4">
      <div className="rounded-lg border bg-card p-8 shadow-soft text-center">
        <h2 className="text-2xl font-semibold mb-3">Sprawdź swoją skrzynkę</h2>
        <p className="text-muted-foreground mb-6">
          Wysłaliśmy link aktywacyjny na <strong>{sentToEmail}</strong>.
          Kliknij go, aby aktywować konto i zalogować się.
        </p>
        <Link href="/login" className="text-primary hover:underline">
          Wróć do logowania →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Smoke test**

In production:
1. Sign up with a real email you can check
2. Confirm the "Sprawdź swoją skrzynkę" screen appears
3. Open the inbox, click the verification link
4. Confirm it redirects to `app.shoppalyzer.com` and you're logged in

- [ ] **Step 5: Commit**

```bash
git add src/app/\(auth\)/signup/page.tsx
git commit -m "feat(auth): show 'check your email' screen after signup"
```

---

### Task 13: Terms of Service + Privacy Policy pages

**Files:**
- Create: `src/app/terms/page.tsx`
- Create: `src/app/privacy/page.tsx`
- Modify: `src/app/(auth)/login/page.tsx` (footer links)
- Modify: `src/app/(auth)/signup/page.tsx` (footer links)

- [ ] **Step 1: Create Terms page**

Create `src/app/terms/page.tsx`:

```tsx
export const metadata = { title: 'Regulamin – Shoppalyzer' };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl py-12 px-6 prose prose-slate">
      <h1>Regulamin Shoppalyzer</h1>
      <p>Ostatnia aktualizacja: 18 maja 2026</p>

      <h2>1. Postanowienia ogólne</h2>
      <p>
        Shoppalyzer („Usługa") to platforma analityczna dla sprzedawców na Allegro.pl, dostępna pod adresem
        app.shoppalyzer.com. Operatorem usługi jest [NAZWA FIRMY], z siedzibą w [ADRES], NIP: [NIP].
      </p>

      <h2>2. Zasady korzystania</h2>
      <p>
        Korzystając z Usługi, użytkownik zobowiązuje się do przestrzegania niniejszego Regulaminu oraz powszechnie
        obowiązujących przepisów prawa. Zabronione jest wykorzystywanie Usługi do celów niezgodnych z prawem,
        w tym do nadużyć wobec serwisów trzecich.
      </p>

      <h2>3. Konto i dane</h2>
      <p>
        Rejestracja konta wymaga podania adresu e-mail. Hasło użytkownika jest przechowywane w formie zaszyfrowanej.
        Dane analiz przechowywane są na serwerach Supabase w Unii Europejskiej.
      </p>

      <h2>4. Limity i plan darmowy</h2>
      <p>
        Plan darmowy obejmuje 1 analizę miesięcznie. Limity są resetowane na początku każdego okresu rozliczeniowego.
        Po przekroczeniu limitu użytkownik musi wybrać plan płatny (gdy zostanie udostępniony).
      </p>

      <h2>5. Odpowiedzialność</h2>
      <p>
        Usługa jest dostarczana „as-is". Rekomendacje generowane przez algorytm mają charakter informacyjny i nie
        stanowią porady inwestycyjnej. Operator nie ponosi odpowiedzialności za decyzje biznesowe podjęte na ich podstawie.
      </p>

      <h2>6. Zmiany regulaminu</h2>
      <p>
        Regulamin może być aktualizowany. O istotnych zmianach użytkownicy zostaną poinformowani na adres e-mail
        powiązany z kontem.
      </p>

      <h2>7. Kontakt</h2>
      <p>Pytania i reklamacje: <a href="mailto:hello@shoppalyzer.com">hello@shoppalyzer.com</a></p>
    </div>
  );
}
```

- [ ] **Step 2: Create Privacy page**

Create `src/app/privacy/page.tsx`:

```tsx
export const metadata = { title: 'Polityka prywatności – Shoppalyzer' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl py-12 px-6 prose prose-slate">
      <h1>Polityka prywatności</h1>
      <p>Ostatnia aktualizacja: 18 maja 2026</p>

      <h2>1. Administrator danych</h2>
      <p>
        Administratorem danych osobowych jest [NAZWA FIRMY], z siedzibą w [ADRES], NIP: [NIP].
        Kontakt: <a href="mailto:hello@shoppalyzer.com">hello@shoppalyzer.com</a>.
      </p>

      <h2>2. Zakres zbieranych danych</h2>
      <ul>
        <li>Adres e-mail (przy rejestracji)</li>
        <li>Hasło (przechowywane w formie zaszyfrowanej)</li>
        <li>Historia analiz (linki do produktów, wyniki, znaczniki czasu)</li>
        <li>Adres IP i informacje techniczne przeglądarki (logi serwera, Sentry — błędy aplikacji)</li>
      </ul>

      <h2>3. Cel przetwarzania</h2>
      <p>
        Dane wykorzystywane są wyłącznie do świadczenia Usługi (autoryzacja, prezentacja historii analiz,
        wsparcie techniczne) oraz analiz bezpieczeństwa.
      </p>

      <h2>4. Podstawa prawna</h2>
      <p>
        Przetwarzanie odbywa się na podstawie art. 6 ust. 1 lit. b RODO (umowa o świadczenie usług)
        oraz art. 6 ust. 1 lit. f RODO (prawnie uzasadniony interes administratora — bezpieczeństwo).
      </p>

      <h2>5. Podmioty przetwarzające</h2>
      <ul>
        <li>Supabase Inc. (hosting bazy danych i autoryzacja, region EU)</li>
        <li>Vercel Inc. (hosting frontendu)</li>
        <li>Fly.io Inc. (hosting workera, region waw — Warszawa)</li>
        <li>Sentry (monitoring błędów, dane techniczne)</li>
        <li>Firecrawl Inc. (pobieranie publicznych stron Allegro)</li>
      </ul>

      <h2>6. Czas przechowywania</h2>
      <p>Dane konta przechowywane są do momentu usunięcia konta przez użytkownika lub na jego wyraźne żądanie.</p>

      <h2>7. Prawa użytkownika</h2>
      <p>
        Użytkownikowi przysługuje prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania,
        przenoszenia, sprzeciwu, oraz wniesienia skargi do PUODO. Aby skorzystać z tych praw, należy napisać na
        <a href="mailto:hello@shoppalyzer.com"> hello@shoppalyzer.com</a>.
      </p>

      <h2>8. Pliki cookies</h2>
      <p>
        Aplikacja używa wyłącznie technicznie niezbędnych plików cookies (sesja autoryzacyjna). Nie używamy
        cookies marketingowych ani trackerów reklamowych.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add footer links to login + signup**

In both `src/app/(auth)/login/page.tsx` and `src/app/(auth)/signup/page.tsx`, find the bottom of the page JSX. Just before the final closing tag of the outer `<div>`, add:

```tsx
<p className="mt-8 text-center text-xs text-muted-foreground">
  Klikając „{/* "Zaloguj się" or "Utwórz konto" depending on file */}" akceptujesz{' '}
  <Link href="/terms" className="underline hover:text-foreground">Regulamin</Link>
  {' '}oraz{' '}
  <Link href="/privacy" className="underline hover:text-foreground">Politykę prywatności</Link>.
</p>
```

- [ ] **Step 4: Smoke test**

Open `app.shoppalyzer.com/terms` and `/privacy` — both should render. Click the links from login/signup pages — they should navigate correctly.

- [ ] **Step 5: Replace placeholders**

Tell the user: search both files for `[NAZWA FIRMY]`, `[ADRES]`, `[NIP]` and replace with actual values. This step is gated on the user providing legal entity details.

- [ ] **Step 6: Commit**

```bash
git add src/app/terms/page.tsx src/app/privacy/page.tsx src/app/\(auth\)/login/page.tsx src/app/\(auth\)/signup/page.tsx
git commit -m "feat: add Terms and Privacy pages, link from auth pages"
```

---

### Task 14: Marketing site CTA hookup

**Files (in a DIFFERENT repo: `Shoppalyzer-Redesign`):**
- Modify: `Shoppalyzer-Redesign/src/components/Navbar.tsx`
- Modify: `Shoppalyzer-Redesign/src/components/FinalCTA.tsx`

- [ ] **Step 1: Open the marketing repo**

Switch context:

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\Shoppalyzer-Redesign"
```

- [ ] **Step 2: Find the existing CTA handlers**

```bash
grep -rn "openWaitlist\|onClick.*waitlist" src/components/Navbar.tsx src/components/FinalCTA.tsx
```

- [ ] **Step 3: Replace `openWaitlist()` calls in `Navbar.tsx`**

Replace the "Zaloguj się" button's `onClick={openWaitlist}` (or similar) with `<a href="https://app.shoppalyzer.com/login">Zaloguj się</a>`.

If there are two CTAs (sign-in + sign-up), the sign-up one should go to `/signup`.

- [ ] **Step 4: Replace in `FinalCTA.tsx`**

Same pattern: the primary CTA should now be:

```tsx
<a href="https://app.shoppalyzer.com/signup" className="<existing button classes>">
  Zacznij za darmo →
</a>
```

- [ ] **Step 5: Smoke test**

Run the marketing site locally:

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\Shoppalyzer-Redesign"
npm run dev
```

Open in browser, click each CTA, confirm it navigates to `app.shoppalyzer.com/login` and `/signup` respectively (which now redirect to localhost since we're testing; in production these point to the live app).

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\WojciechRudnicki\Claude_code\Shoppalyzer-Redesign"
git add src/components/Navbar.tsx src/components/FinalCTA.tsx
git commit -m "feat: route landing-page CTAs to app.shoppalyzer.com auth"
```

---

## Phase 5 — Production Smoke Test

### Task 15: 12-step end-to-end verification on production

**Files:** None. This is purely a manual verification step.

- [ ] **Step 1: Open incognito browser, navigate to `https://app.shoppalyzer.com/signup`**

Expected: signup page renders, no console errors.

- [ ] **Step 2: Sign up with a fresh email** (e.g. `test+launch@yourdomain.com`)

Expected: redirected to "Sprawdź swoją skrzynkę" confirmation screen.

- [ ] **Step 3: Open the inbox, click the verification link**

Expected: redirects to `app.shoppalyzer.com`, you're signed in, on the dashboard.

- [ ] **Step 4: Confirm quota bar shows `FREE · 0 / 1`**

- [ ] **Step 5: Paste the Sony URL into the analysis input**

`https://allegro.pl/oferty-produktu/sluchawki-bezprzewodowe-wokoluszne-sony-wh-1000xm5-e120b95a-1e21-4fac-8c84-fead7a8769ba?stan=nowe`

- [ ] **Step 6: Click "Analizuj →"**

Expected: redirects to `/dashboard/queries/<id>`, step tracker shows step 1 spinning.

- [ ] **Step 7: Watch the step tracker advance**

Expected: ~15–25s total. All 4 steps tick through, results page renders.

- [ ] **Step 8: Confirm results data**

Expected:
- Archetype badge: `VOLUME DRIVEN`
- Confidence: `HIGH`
- Price range: shows min–max in zł
- Sellers count: ~60
- Top 3 sellers listed with recommendations

- [ ] **Step 9: Refresh `/api/v1/me` via the dashboard**

Expected: quota bar updates to `1 / 1` (or `1 / N` if a higher limit was set for this account).

- [ ] **Step 10: Sign out, sign back in**

Expected: history shows 1 completed analysis. Clicking it loads the same results.

- [ ] **Step 11: Check Sentry dashboard**

Open both Sentry projects. Expected: zero errors during the smoke test.

- [ ] **Step 12: Check Fly.io logs**

```bash
fly logs -a shoppalyzer-worker
```

Expected: one full sequence from `[start]` to `[completed] ✓ Done`, no warnings.

---

## Done!

If all 12 smoke-test steps pass, the deployment is complete. Shoppalyzer is live at `https://app.shoppalyzer.com`, fully autonomous, costing $0/month + $12/year for the domain.
