# Shoppalyzer Backend

Backend for the Shoppalyzer competitive intelligence platform. Customer-facing flow:

```
User pastes Allegro URL or uploads CSV
   ↓
We resolve EAN + product page (Step 0.5 of the scraper runbook)
   ↓
Background worker scrapes the offers aggregator
   ↓
Analysis engine classifies archetype + generates per-seller recommendations
   ↓
Dashboard renders results · user can download editorial PDF
   ↓
Optional: set up recurring monitor for the same product
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| API framework | Next.js 14 App Router | Same project hosts API and dashboard frontend; familiar for the team |
| Language | TypeScript everywhere | Type contracts shared between server + client |
| Database | Postgres (Supabase) | Free tier covers MVP; built-in auth + storage + row-level security |
| Auth | Supabase Auth | Email magic link + Google OAuth ready out of the box |
| Background jobs | Node.js worker (long-running process) | Scrapes take 30s-3min; not feasible inside an HTTP request |
| Scrape transport | Firecrawl via `firecrawl-pool` | 6-key rotation already built, see `../shoppalyzer-tools/` |
| Storage | Supabase Storage | Cached HTML, generated PDFs |
| Validation | Zod | Validate API payloads and Firecrawl responses |
| PDF generation | Puppeteer + pdf-lib | Reuses the editorial PDF approach already documented |

---

## Directory layout

```
shoppalyzer-backend/
├── package.json
├── tsconfig.json
├── README.md (this file)
│
├── src/
│   ├── app/api/                Next.js App Router API routes
│   │   ├── v1/queries/         POST submit, GET list
│   │   │   └── [id]/           GET detail, /pdf POST
│   │   ├── v1/queries/batch/   POST CSV upload
│   │   ├── v1/monitors/        recurring scrapes CRUD
│   │   └── v1/me/              user profile
│   │
│   ├── lib/                    Shared server utilities
│   │   ├── supabase.ts         Supabase client (admin + user variants)
│   │   ├── firecrawl-pool.ts   Wrapper around ../shoppalyzer-tools/firecrawl-pool.js
│   │   ├── auth.ts             Helper to extract user from request
│   │   └── validators.ts       Zod schemas for API payloads
│   │
│   ├── workers/
│   │   ├── scrape-worker.js    Pulls queued queries, runs the pipeline
│   │   ├── steps/              Each step of the scraping pipeline
│   │   │   ├── discover.js     Find EAN / product page
│   │   │   ├── scrape.js       Hit the offers aggregator
│   │   │   ├── parse.js        Parse HTML to JSON
│   │   │   └── analyze.js      Run recommendation engine
│   │   └── pdf-renderer.js     Generates editorial PDFs on demand
│   │
│   └── types/
│       └── api.ts              API contract (frontend + backend agreement)
│
├── supabase/
│   ├── migrations/
│   │   └── 0001_initial.sql    Database schema
│   └── seed.sql                (later) Test data
│
└── docs/                       Design docs, architecture decisions, runbooks
```

---

## Customer journey (MVP)

### 1. Sign up
- User lands on Shoppalyzer landing page
- Clicks "Analyze my offer"
- Provides email → magic link sent via Supabase Auth
- First login auto-creates a `profiles` row (free tier, 1 query/month)

### 2. Submit a query
- Single-mode: paste Allegro offer URL → `POST /api/v1/queries`
- Batch mode: upload CSV with columns `[product_url, seller_ref]` → `POST /api/v1/queries/batch`
- API returns `query_id` and current status (`queued`)
- User sees "Working on it..." with progress indicators

### 3. Background work
- Worker polls `queries` table for `status='queued'`
- Picks one, transitions to `discovering` → `scraping` → `parsing` → `analyzing` → `completed`
- All scrapes go through the Firecrawl pool (auto-rotates the 6 keys)
- Worker writes to `offers` and `analyses` tables as it goes

### 4. View results
- User refreshes dashboard or polls `GET /api/v1/queries/:id`
- When `status='completed'`, dashboard renders:
  - Archetype + confidence
  - Market summary (price range, sellers, etc.)
  - User's own seller verdict (if they identified their listing)
  - Per-seller recommendations table
  - "Three viable strategies" callout

### 5. Download PDF
- User clicks "Download report" → `POST /api/v1/queries/:id/pdf`
- Worker generates editorial PDF (using the existing `generate-pdf.js` approach)
- Returns signed URL valid for 7 days

### 6. (Optional) Set up monitoring
- User adds product to watchlist → `POST /api/v1/monitors`
- Daily cron job picks up due monitors, runs the same pipeline
- Alerts via email when archetype/tier changes meaningfully

---

## Data model (high level)

```
profiles ←─┐
           │ user_id
           │
queries ←──┤
   ↓       │
   └── offers, scrape_jobs, analyses, pdf_artifacts
           │
monitors ──┘
```

See `supabase/migrations/0001_initial.sql` for full schema with RLS policies.

---

## API contract

Defined in `src/types/api.ts`. Highlights:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/queries` | Submit a single product for analysis |
| `POST /api/v1/queries/batch` | Submit a CSV portfolio (5-200 products) |
| `GET /api/v1/queries` | List user's queries (paginated, filtered by status) |
| `GET /api/v1/queries/:id` | Read full detail of one query + analysis |
| `POST /api/v1/queries/:id/pdf` | Generate editorial PDF report |
| `POST /api/v1/monitors` | Create a recurring re-scrape monitor |
| `GET /api/v1/monitors` | List user's active monitors |
| `GET /api/v1/me` | Current user profile + plan + usage |

All responses use shapes from `src/types/api.ts`. All errors follow the `ApiError` shape.

---

## Environment configuration

`.env.local` (not committed) — copy from `.env.example`:

```
# Database
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres

# Supabase
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # server-only, never expose to client

# Firecrawl pool — auto-detected from ~/.shoppalyzer/firecrawl-keys.json
# (No env var needed; the pool reads its own config)

# Email (Resend)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=reports@shoppalyzer.com

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

---

## Development workflow

```bash
# 1. Install
npm install

# 2. Set up database (one-time)
#    Option A — Supabase: paste supabase/migrations/0001_initial.sql into SQL editor
#    Option B — Local Postgres: psql $DATABASE_URL -f supabase/migrations/0001_initial.sql

# 3. Run dev server (API + frontend on http://localhost:3000)
npm run dev

# 4. In a separate terminal, run the scrape worker
npm run worker
```

The worker runs in a loop, polling for queued queries every 5s and processing them.

---

## Deployment plan (when we get there)

| Component | Where | How |
|---|---|---|
| Next.js API + frontend | Vercel | `git push` → auto-deploy |
| Scrape worker | Railway / Fly.io | Long-running Node process (Vercel functions time out at 10s) |
| Database | Supabase | Hosted Postgres + auth + storage |
| Email | Resend | Transactional emails |
| Cron jobs (monitors) | Vercel Cron | Calls a worker endpoint daily |

Estimated monthly cost for first 100 users: $0 (all free tiers) → $25 (Supabase Pro when paused-after-7-days becomes annoying) → ~$50 (add Railway for worker).

---

## What's NOT in scope for MVP

- Multi-tenant teams (single-user accounts only)
- Stripe / billing (free + manual upgrade for now)
- Custom branding on PDF reports
- API access for third-party developers
- LLM-generated recommendation narratives (we use the deterministic rule-engine output for now)
- Allegro Ads campaign management (we only recommend, we don't execute)

---

## Open questions to resolve before building endpoints

1. **What happens if Allegro changes its DOM structure mid-scrape?** Right now the worker fails and the user sees an error. Need a "stale parser" detection + alert path.
2. **EAN discovery autonomous mode** — when the user gives us a product URL without an EAN, do we web-search for it (free) or scrape the product page (10 credits)? Current scraper falls back to the latter.
3. **Rate limits on the Firecrawl pool side** — 6 keys × 1000 credits = 6000/month. Each query uses ~50-100 credits. That's ~60-120 queries/month at our current rate. Need to either upgrade keys or be selective about who gets a full scrape.
4. **CSV format and validation** — what columns do we require? `product_url` only, or `product_url` + `seller_name` + `current_price`? More columns = more context for recommendations.
