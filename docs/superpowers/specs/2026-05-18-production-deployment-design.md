# Shoppalyzer Production Deployment — Design Spec

## Goal

Move the full Shoppalyzer stack (Next.js app + scrape worker) from local-only to publicly accessible at `app.shoppalyzer.com`. End state: anyone can sign up, paste an Allegro product URL, and see a completed analysis with recommendations — all without anything running on a developer laptop.

## Scope

**In scope (this spec):**
- Deploy Next.js frontend + API routes to Vercel
- Deploy scrape worker to Fly.io (free tier)
- Custom domain wiring (`app.shoppalyzer.com`)
- Production secrets management (env vars, Firecrawl key pool)
- Pre-launch hardening: email verification, Terms/Privacy pages, Sentry error tracking
- Smoke test of the full end-to-end flow on production

**Out of scope (defer to a separate spec):**
- Batch CSV upload
- PDF report generation
- Allegro REST API integration
- Stripe / paid plans
- Marketing landing page integration (the existing Shoppalyzer-Redesign marketing site already exists; only the CTA buttons need to point at `/login` and `/signup`)
- Mobile responsive polish
- Password reset flow
- Multi-language support beyond Polish

## Architecture After Deployment

```
                          USER
                           │
                           ▼
                  app.shoppalyzer.com
                           │
                           ▼
            ┌──────────────────────────────┐
            │   VERCEL (frontend + API)    │
            │   • Next.js 14 App Router    │
            │   • Auto-deploy from GitHub  │
            │   • Free tier                │
            └──────┬────────────────┬──────┘
                   │                │
                   │ Supabase JS   │ Sentry SDK
                   ▼                ▼
       ┌─────────────────┐   ┌──────────────┐
       │    SUPABASE     │   │   SENTRY     │
       │  Postgres+Auth  │   │  errors      │
       │  (already live) │   │  free tier   │
       └────────▲────────┘   └──────────────┘
                │
                │ service_role key
                │
       ┌────────┴────────────────┐
       │  FLY.IO (worker)         │
       │  • npm run worker        │
       │  • free shared-CPU VM    │
       │  • auto-restart on crash │
       └────────┬─────────────────┘
                │
                ▼
       ┌──────────────────┐
       │   FIRECRAWL      │
       │   9-key pool     │
       └──────────────────┘
```

## Part 1 — GitHub Repo Setup

The repo is currently local-only at `C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend`. Vercel deploys from Git directly; Fly.io can also pull from Git or use local Docker context — we'll wire it to deploy from the same GitHub repo for consistency. Either way, we need a remote.

**Steps:**
1. Create a private GitHub repo `shoppalyzer-backend` (org or personal account)
2. Add it as a remote: `git remote add origin <url>`
3. Push: `git push -u origin master`
4. Verify `.gitignore` covers: `.env.local`, `.env*.local`, `node_modules/`, `.next/`, `.firecrawl/`, `tsconfig.tsbuildinfo`, `e2e-jwt.txt`

**Files to confirm are NOT committed:**
- Any `.env*` file containing real keys
- `firecrawl-keys.json` (lives at `~/.shoppalyzer/`, not in repo)
- The `.firecrawl/` working directory

If any secrets have been committed before, rotate them (Supabase: regenerate `SUPABASE_SERVICE_ROLE_KEY` in dashboard; Firecrawl: revoke and replace via the existing pool tooling).

## Part 2 — Vercel Frontend Deployment

**Setup steps:**
1. Sign in to Vercel with GitHub
2. Import the `shoppalyzer-backend` repo
3. Framework preset: Next.js (auto-detected)
4. Root directory: leave as `./`
5. Build command: leave default (`next build`)
6. Set environment variables (Production scope):
   - `NEXT_PUBLIC_SUPABASE_URL=https://tleuuotfiuvqqyulblhk.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<the existing publishable key>`
   - `SUPABASE_SERVICE_ROLE_KEY=<the existing service key>`
   - `NEXT_PUBLIC_SENTRY_DSN=<from Sentry, added in Part 6>`
7. Deploy → verify the `*.vercel.app` URL renders the login page
8. Test signup → ensure user lands on dashboard (worker doesn't exist yet so analyses will sit `queued`)

**Things to verify in production build:**
- `cache: 'no-store'` is still applied to Supabase client (the fix from earlier today)
- Middleware properly refreshes session cookies
- `/api/v1/me` returns 401 without auth, 200 with auth

## Part 3 — Custom Domain

**Steps:**
1. Buy `shoppalyzer.com` from a registrar (Namecheap, Cloudflare Registrar, or whoever)
2. In Vercel project settings → Domains → add `app.shoppalyzer.com`
3. Vercel provides a CNAME target like `cname.vercel-dns.com`
4. Add the CNAME record at the registrar
5. Wait for DNS propagation (usually <10 min)
6. SSL cert auto-issued by Vercel via Let's Encrypt

Apex domain (`shoppalyzer.com`) can either:
- Redirect to `app.shoppalyzer.com` (Vercel handles this automatically), OR
- Point to the existing marketing site if there is one (deferred to that site's spec)

## Part 4 — Fly.io Worker Deployment

The worker is a long-running Node process (polls Supabase every 10s). It can't run on Vercel's serverless functions because they time out after 60s.

Fly.io's always-free allowance includes 3 shared-CPU VMs at 256 MB RAM — more than enough for this worker (the worker is I/O bound, idle most of the time waiting for Firecrawl responses).

**Setup steps:**
1. Install the Fly CLI: `iwr https://fly.io/install.ps1 -useb | iex` (PowerShell) or `curl -L https://fly.io/install.sh | sh`
2. `fly auth signup` (no credit card required for the free tier, but Fly may ask for one to prevent abuse — declining usually still works)
3. From the repo root: `fly launch --no-deploy` — answer the prompts:
   - App name: `shoppalyzer-worker`
   - Region: `waw` (Warsaw — closest to Supabase EU + Allegro)
   - Postgres: no
   - Redis: no
   - Deploy now: no
4. Edit the generated `fly.toml`:
   - Set `[processes]` to `worker = "npm run worker"` (no HTTP service needed)
   - Remove `[http_service]` block (we have no HTTP endpoint)
   - Set VM size: `[[vm]] size = "shared-cpu-1x" memory = "256mb"`
   - Ensure `auto_stop_machines = false` (we need the worker always running, not on-demand)
5. Add a `Dockerfile` (Fly needs one for Node apps):
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --omit=dev
   COPY . .
   CMD ["npm", "run", "worker"]
   ```
6. Set secrets via the CLI (these become env vars in the running VM):
   ```
   fly secrets set NEXT_PUBLIC_SUPABASE_URL=...
   fly secrets set NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   fly secrets set SUPABASE_SERVICE_ROLE_KEY=...
   fly secrets set FIRECRAWL_API_KEYS=<comma-separated>
   ```
7. Deploy: `fly deploy`
8. Verify logs: `fly logs` should show `[worker] [startup] ✓ Supabase connection OK`

### Firecrawl key pool — load from env, not from disk

Today the worker reads keys from `~/.shoppalyzer/firecrawl-keys.json`. In production there's no home directory persistence on Fly.io VMs. We need to refactor `firecrawl-pool.js` (or its consumer) to:

- Check for `FIRECRAWL_API_KEYS` env var first (comma-separated string)
- If present, build the in-memory pool from that
- Persist credit usage to a small Supabase table (`firecrawl_key_usage`) so it survives restarts

**Decision: persist to Supabase.** Reasoning: Fly.io VMs can restart at any time, container filesystem is ephemeral, and we already have Postgres. Add migration `0003_firecrawl_usage.sql`:

```sql
CREATE TABLE firecrawl_key_usage (
  key_name TEXT PRIMARY KEY,
  credits_used INT NOT NULL DEFAULT 0,
  monthly_limit INT NOT NULL DEFAULT 1000,
  exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  exhausted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Refactor `firecrawl-pool.js` (currently in `shoppalyzer-tools/`) into a TypeScript module at `src/lib/firecrawl-pool.ts` consumed by `src/workers/scrape-worker.ts`. Behaviour stays identical; only the storage layer changes.

## Part 5 — Auth Hardening

### Email verification

Currently disabled in Supabase Auth (turned off for testing). Turn back on:

1. Supabase dashboard → Authentication → Providers → Email
2. Enable "Confirm email"
3. Customize the email template (subject line in Polish, link to `app.shoppalyzer.com`)
4. The current `/signup` flow already handles the redirect after sign-up; Supabase will send the verification email automatically

**Frontend change:** after successful `signUp()`, instead of `router.push('/dashboard')`, show a "Check your email" screen with the user's email address. The dashboard middleware will redirect unverified users back to login anyway, so this is a UX improvement, not a security one.

### Forgot password

Out of scope. If a user forgets their password they email support. We'll add this later. Alternative: turn off password auth entirely and use magic-link signup. Decision: keep password auth, defer forgot-password page.

## Part 6 — Error Tracking with Sentry

1. Sign up at sentry.io (free tier: 5k events/month)
2. Create two projects:
   - `shoppalyzer-web` (Next.js — frontend + API)
   - `shoppalyzer-worker` (Node)
3. Install `@sentry/nextjs` in the main app, `@sentry/node` in the worker
4. Run `npx @sentry/wizard@latest -i nextjs` for auto-config
5. Add DSN env vars to Vercel + Fly.io (`fly secrets set NEXT_PUBLIC_SENTRY_DSN=...`)
6. Wrap worker's `processQuery()` in `Sentry.captureException` on errors

**Minimum coverage:**
- Uncaught exceptions in API routes
- Worker job failures (already logged, just forward to Sentry)
- Frontend unhandled promise rejections

Not required for launch but very useful: source maps upload, performance tracing.

## Part 7 — Legal Pages (Terms + Privacy)

Polish law (and EU GDPR) requires public-facing services to display a privacy policy and terms of service. Two static Next.js pages:

- `/terms` — `src/app/terms/page.tsx`
- `/privacy` — `src/app/privacy/page.tsx`

Content: standard SaaS boilerplate adapted to Shoppalyzer's reality (we collect email + analysis history, store on Supabase EU region, no third-party tracking beyond Sentry). Generated from a template — about 1 hour of work.

Link to both from the login + signup pages footer.

## Part 8 — Marketing Site Hookup

The existing Shoppalyzer-Redesign marketing site has CTAs that currently open a waitlist modal. Two files to update:

- `Shoppalyzer-Redesign/src/components/Navbar.tsx` — "Zaloguj się" button → `https://app.shoppalyzer.com/login`
- `Shoppalyzer-Redesign/src/components/FinalCTA.tsx` — primary CTA → `https://app.shoppalyzer.com/signup`

These changes happen in the marketing repo, not the backend repo. Captured here only as a checklist item for full end-to-end-on-the-web verification.

## Part 9 — Smoke Test on Production

End-to-end test, performed manually after every part is deployed:

1. Open incognito browser, navigate to `app.shoppalyzer.com/signup`
2. Sign up with a fresh email
3. Verify email arrived, click confirmation link
4. Sign in → redirected to dashboard, quota shows `FREE · 0 / 1`
5. Paste the Sony WH-1000XM5 product URL (known to work)
6. Click "Analizuj →" → redirected to `/dashboard/queries/[id]`
7. Watch the step tracker advance through all 4 steps
8. Verify results page renders: archetype VOLUME_DRIVEN, ~60 sellers, recommendations
9. Confirm `monthly_queries_used` ticked to 1 in `/api/v1/me`
10. Sign out, sign back in → see the completed analysis in history
11. Check Sentry dashboard — no errors logged
12. Check Fly.io worker logs (`fly logs`) — completed analysis end-to-end without warnings

## Cost Summary

| Service | Tier | Cost |
|---|---|---|
| Vercel | Hobby | $0 |
| Fly.io | shared-cpu free allowance | $0 |
| Supabase | Free | $0 |
| Sentry | Developer | $0 |
| Firecrawl | 9× Free tier | $0 |
| Domain | Annual | ~$12/year |
| **Total operational** | | **$0/month + $12/year** |

## Out of Scope (defer)

- Stripe billing / paid plans
- Forgot password flow
- Mobile-responsive polish
- Allegro OAuth seller import
- PDF report generation
- Batch CSV upload
- Recurring monitors
- AI-generated playbook summaries
- Multi-region database failover
- Backup/restore procedures (Supabase free tier does daily backups automatically — sufficient for now)

## Testing

- Unit tests: existing Vitest suite must pass before any deploy (`npm test`)
- Build verification: `npm run build` succeeds locally before Vercel deploy
- Smoke test: the 12-step manual flow in Part 9
- No new automated tests required for this spec — deployment is intrinsically manual

## File Count Estimate

| Area | New/Modified files |
|---|---|
| Firecrawl pool refactor (TS, env-driven) | 2 (new `src/lib/firecrawl-pool.ts`, modified worker) |
| Supabase migration for usage table | 1 (`supabase/migrations/0003_firecrawl_usage.sql`) |
| Terms + Privacy pages | 2 |
| Signup confirmation screen | 1 (modify existing signup page) |
| Sentry config | 3 (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` — auto-generated) |
| Vercel + Fly.io config files | 2 (`fly.toml`, `Dockerfile`) |
| **Total** | **~12 files** |
