# Shoppalyzer Dashboard + Quota Enforcement — Design Spec

## Goal

Build a Next.js dashboard for Allegro sellers on top of the existing Phase 2b API, and add quota enforcement to `POST /api/v1/queries`. The dashboard lets users log in, submit Allegro URLs for analysis, watch live progress, and read insight-led results. Quota gates prevent over-use on the free tier.

## Architecture

**Two independent sub-deliverables, built in order:**

1. **Quota gate** — pure backend change to `POST /api/v1/queries` + extend `GET /api/v1/me`. No frontend dependency.
2. **Frontend** — Next.js App Router pages + design system migration. Depends on the quota gate being in place.

**Tech additions to the backend repo:**
- Tailwind CSS (already in `Shoppalyzer-Redesign`, add to backend app)
- shadcn/ui component library (copy from `Shoppalyzer-Redesign`)
- Geist font (via `next/font/google`)
- Lucide React (icons)

**No new infrastructure.** Auth stays in Supabase. No Stripe. No additional backend services.

---

## Part 1: Quota Gate

### `POST /api/v1/queries` — quota check

Before `insertQuery` is called, fetch the user's profile and check their limit:

```typescript
const profile = await db
  .from('profiles')
  .select('monthly_queries_used, monthly_queries_limit')
  .eq('id', user.id)
  .single();

if (profile.data.monthly_queries_used >= profile.data.monthly_queries_limit) {
  return NextResponse.json(
    { error: { code: 'QUOTA_EXCEEDED', message: 'Monthly analysis limit reached. Upgrade to continue.' } },
    { status: 429 }
  );
}
```

### `GET /api/v1/me` — extend response

Add quota + plan fields to the existing response:

```typescript
{
  id: string;
  email: string;
  monthly_queries_used: number;
  monthly_queries_limit: number;
  plan: 'free' | 'pro';          // derived: limit <= 10 → 'free', else 'pro'
}
```

Plan derivation: `limit <= 1 ? 'free' : 'pro'`. No `plan` column in the DB — computed at read time.

### Error response shape (429)

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Monthly analysis limit reached. Upgrade to continue."
  }
}
```

---

## Part 2: Design System Migration

Copy from `../Shoppalyzer-Redesign/src/` into the backend app:

| Source | Destination | What it is |
|--------|-------------|-----------|
| `index.css` (CSS vars block) | `src/app/globals.css` | All design tokens (colors, shadows, radius, gradients) |
| `tailwind.config.ts` | `tailwind.config.ts` | Full token mapping |
| `components/ui/` | `src/components/ui/` | shadcn component library |
| `lib/utils.ts` | `src/lib/utils.ts` | `cn()` helper (tailwind-merge + clsx) |

**Fonts:** Load Geist via `next/font/google` in `layout.tsx`. Apply to `<body>`.

**Install packages:** `tailwindcss`, `postcss`, `autoprefixer`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss-animate`, `@supabase/ssr`.

---

## Part 3: Pages + Routes

### Route structure

```
src/app/
├── layout.tsx                    ← root layout (font, globals.css)
├── (auth)/
│   ├── login/page.tsx            ← /login
│   └── signup/page.tsx           ← /signup
└── dashboard/
    ├── layout.tsx                ← sidebar shell (auth-gated)
    ├── page.tsx                  ← /dashboard (submit + history)
    └── queries/
        └── [id]/page.tsx         ← /dashboard/queries/:id (results)
```

### Auth guard

`dashboard/layout.tsx` reads the Supabase session server-side via `@supabase/ssr`. If no session → `redirect('/login')`.

Login/signup pages redirect to `/dashboard` if already authenticated.

---

## Part 4: Page Designs

### `/login` and `/signup`

Centered card, 400px wide, brand logo above.

**Login fields:** Email, Password, "Zaloguj się" button (primary navy).
**Below form:** "Nie masz konta? Zarejestruj się →" link.

**Signup fields:** Email, Password, "Utwórz konto" button.
**Below form:** "Masz już konto? Zaloguj się →" link.

**Error handling:** Show inline error below the form (invalid credentials, email taken, etc.).

**Google OAuth:** Reserved slot — a disabled "Kontynuuj z Google" button with "Wkrótce" badge. Not wired up.

---

### Dashboard shell — `dashboard/layout.tsx`

```
┌─ Topbar ──────────────────────────────────────────────────┐
│  [logo]                              [user email] [avatar] │
├─ Sidebar (220px) ───┬─ Main (flex-1) ────────────────────┤
│                     │                                      │
│  Analizy       ←active                                     │
│  Konto                                                     │
│                     │                                      │
│  ── quota ──────    │                                      │
│  FREE               │                                      │
│  ████░░░░░░ 3/10    │                                      │
│  [Ulepsz plan →]    │                                      │
└─────────────────────┴────────────────────────────────────-─┘
```

**Quota bar component (`QuotaBar`):**
- Fetches from `GET /api/v1/me` on mount
- Progress bar: `used / limit` width, navy fill
- Label: `FREE · 0 / 1` or `PRO · 45 / 100`
- "Ulepsz plan →" button: plain link, `href="mailto:hello@shoppalyzer.com?subject=Upgrade"` for now
- At ≥ 80% usage: bar turns amber (`warning` token)
- At 100%: bar turns red (`danger` token), button becomes more prominent

---

### `/dashboard` — submit + history

**Submit card (top):**
```
┌─────────────────────────────────────────────────────┐
│  Nowa analiza                                        │
│  [  https://allegro.pl/oferta/...              ]    │
│                                           [Analizuj →] │
└─────────────────────────────────────────────────────┘
```
- Input accepts any URL or EAN (no client-side validation beyond non-empty)
- `input_type` is detected client-side before sending:
  - Contains `allegro.pl/oferta/` → `'allegro_url'`
  - Contains `allegro.pl/oferty-produktu/` or `allegro.pl/produkt/` → `'product_url'`
  - Matches 8–13 digit EAN pattern → `'ean'`
  - Anything else → `'allegro_url'` (fallback, worker will fail gracefully)
- On `429` from API: show quota exceeded banner, disable button
- On success: `router.push('/dashboard/queries/' + id)`

**History list (below submit):**
- Calls `GET /api/v1/queries?limit=20`
- Each row: product URL (truncated), status badge, `created_at` relative time, clickable
- Status badge colors: `queued/discovering/scraping/parsing/analyzing` → amber, `completed` → green, `failed` → red
- Empty state: "Nie masz jeszcze żadnych analiz. Wklej link powyżej, żeby zacząć."

---

### `/dashboard/queries/[id]` — results page

#### While `status !== 'completed' && status !== 'failed'`

Poll `GET /api/v1/queries/:id` every 2 seconds.

**Live step tracker:**

```
Trwa analiza produktu

  ✓  Znaleziono stronę porównania       (status: scraping, parsing, analyzing, or completed)
  ✓  Pobrano dane ze strony             (status: parsing, analyzing, or completed)
  ⟳  Parsowanie ofert sprzedawców...   (status: parsing — spinning ring)
  ○  Silnik rekomendacji               (status: analyzing — greyed)
```

Step visibility rules:
| Step shown as done (✓) | When `status` is... |
|---|---|
| Discovering | scraping, parsing, analyzing, completed |
| Scraping | parsing, analyzing, completed |
| Parsing | analyzing, completed |
| Analyzing | completed |

Current step (⟳): whichever step maps to the current `status`.

On `failed`: show error card with `error.message` and a "Spróbuj ponownie" button that re-submits the same URL.

#### When `status === 'completed'`

**1. Header bar**
Product URL (monospace, truncated) + archetype badge (navy pill) + confidence badge (green/amber/red).

**2. Main insight card**
Left border in `success` green. Title: "Główna rekomendacja". Body: `result.archetype.playbook_summary`.

**3. Three stat cards (grid)**
- Zakres cen: `price_min – price_max zł`
- Sprzedawcy: `total_offers`
- Sprzedaż 30d: `total_visible_sales_30d` (success color)

**4. Top 3 sellers**
Ranked #1/#2/#3. Each row: rank badge, seller name, price, recommendation chip.

Recommendation chip colors:
- `PROMOTE` → success green
- `TEST_PROMOTE` → warning amber
- `HOLD` → muted grey
- `AVOID` → danger red

**5. "Pokaż wszystkich X sprzedawców" toggle**
Expands to a full table with columns: Rank, Sprzedawca, Cena, Ocena %, Rekomendacja, Wynik.
Sortable by price and score (client-side, no API call).

---

## Part 5: Auth Implementation

Use `@supabase/ssr` for server-side session handling in Next.js App Router.

**Client:** `src/lib/supabase/client.ts` — `createBrowserClient()`
**Server:** `src/lib/supabase/server.ts` — `createServerClient()` with cookie handling

Login flow:
1. `supabase.auth.signInWithPassword({ email, password })`
2. On success → `router.push('/dashboard')`
3. On error → display `error.message` below form

Signup flow:
1. `supabase.auth.signUp({ email, password })`
2. On success → `router.push('/dashboard')`
3. On error → display `error.message` below form

Sign out: button in sidebar footer → `supabase.auth.signOut()` → `router.push('/login')`

---

## Out of Scope

- Stripe / billing integration (upgrade button → mailto for now)
- Google OAuth (button exists but is disabled + "Wkrótce" badge)
- Mobile-responsive polish (structure works on mobile, not optimized)
- Email verification UI (Supabase sends the email, no custom page)
- Password reset flow
- Dark mode

---

## Testing

- Quota gate: unit test in `store.test.ts` or route test — `429` when `used >= limit`, `201` when under
- Auth guard: redirect to `/login` when no session cookie
- Quota bar: renders correct `used/limit` values and amber/red states at thresholds
- Manual E2E: submit URL → watch step tracker → see results page

---

## File Count Estimate

| Area | New files |
|------|-----------|
| Design system (tokens, shadcn copy) | ~30 (UI components) |
| Auth pages | 2 |
| Dashboard pages | 3 |
| Supabase SSR helpers | 2 |
| QuotaBar component | 1 |
| API changes (quota gate, me route) | 2 |
| **Total** | **~40** |
