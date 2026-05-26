# Dashboard + Quota Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quota enforcement test, then build the full Shoppalyzer dashboard — login/signup, sidebar shell, submit form, history list, and insight-led results page — using the existing Shoppalyzer Design System v2.

**Architecture:** The quota gate already exists in `POST /api/v1/queries` (returns 402 when `monthly_queries_used >= monthly_queries_limit`). The frontend is a Next.js App Router app in the same repo, using Supabase SSR for session management and the design tokens + shadcn components copied from `../Shoppalyzer-Redesign`. The worker and API routes are unchanged.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS, shadcn/ui (copied from redesign), `@supabase/ssr`, Lucide React, Geist font.

---

## File Map

**New files — backend:**
- `src/app/api/v1/__tests__/quota.test.ts` — quota gate unit test

**New files — design system:**
- `tailwind.config.ts` — Shoppalyzer design tokens
- `postcss.config.js` — Tailwind + autoprefixer
- `src/app/globals.css` — CSS custom properties + Tailwind directives
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- `src/components/ui/button.tsx` — shadcn Button
- `src/components/ui/card.tsx` — shadcn Card
- `src/components/ui/input.tsx` — shadcn Input
- `src/components/ui/label.tsx` — shadcn Label
- `src/components/ui/badge.tsx` — shadcn Badge
- `src/components/ui/progress.tsx` — shadcn Progress
- `src/components/ui/separator.tsx` — shadcn Separator
- `src/components/ui/skeleton.tsx` — shadcn Skeleton

**New files — auth infra:**
- `src/lib/supabase/client.ts` — `createClient()` for browser
- `src/lib/supabase/server.ts` — `createClient()` for server components
- `src/middleware.ts` — session refresh on every request
- `public/shoppalyzer-logo.svg` — logo asset (copy from redesign)

**New files — pages + components:**
- `src/app/(auth)/layout.tsx` — centered auth card wrapper
- `src/app/(auth)/login/page.tsx` — login form
- `src/app/(auth)/signup/page.tsx` — signup form
- `src/components/DashboardShell.tsx` — sidebar + topbar (client component)
- `src/components/QuotaBar.tsx` — quota display in sidebar (client component)
- `src/app/dashboard/layout.tsx` — auth guard + shell wrapper (server component)
- `src/app/dashboard/page.tsx` — submit form + history list
- `src/app/dashboard/queries/[id]/page.tsx` — step tracker + results

**Modified files:**
- `src/app/layout.tsx` — add Geist font + import globals.css
- `package.json` — add new dependencies

---

## Task 1: Install packages + configure Tailwind

**Files:**
- Modify: `package.json`
- Create: `postcss.config.js`
- Create: `tailwind.config.ts`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Install dependencies**

```bash
cd C:\Users\WojciechRudnicki\Claude_code\shoppalyzer-backend
npm install tailwindcss postcss autoprefixer clsx tailwind-merge lucide-react tailwindcss-animate @supabase/ssr class-variance-authority
```

Expected: packages installed, no peer dep errors.

- [ ] **Step 2: Create `postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.5rem', md: '2rem' },
      screens: { '2xl': '1320px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        'brand-navy': 'hsl(var(--brand-navy))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          muted: 'hsl(var(--surface-muted))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        'accent-brand': {
          DEFAULT: 'hsl(var(--accent-brand))',
          foreground: 'hsl(var(--accent-brand-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: 'hsl(var(--danger-foreground))',
          soft: 'hsl(var(--danger-soft))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        medium: 'var(--shadow-medium)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

- [ ] **Step 4: Create `src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --primary: 207 58% 28%;
    --primary-foreground: 0 0% 100%;
    --primary-soft: 207 58% 96%;

    --accent-brand: 25 80% 56%;
    --accent-brand-foreground: 0 0% 100%;

    --success: 153 65% 39%;
    --success-foreground: 0 0% 100%;
    --success-soft: 153 65% 96%;

    --warning: 38 92% 50%;
    --warning-foreground: 30 60% 18%;
    --warning-soft: 38 92% 96%;

    --danger: 0 70% 52%;
    --danger-foreground: 0 0% 100%;
    --danger-soft: 0 70% 97%;

    --brand-navy: 207 64% 18%;

    --background: 40 28% 98%;
    --foreground: 207 64% 14%;

    --surface: 0 0% 100%;
    --surface-muted: 40 18% 96%;

    --card: 0 0% 100%;
    --card-foreground: 207 64% 14%;

    --secondary: 40 18% 95%;
    --secondary-foreground: 207 64% 14%;

    --muted: 40 14% 94%;
    --muted-foreground: 207 14% 42%;

    --accent: 207 58% 96%;
    --accent-foreground: 207 58% 28%;

    --destructive: 0 70% 52%;
    --destructive-foreground: 0 0% 100%;

    --border: 40 14% 88%;
    --input: 40 14% 92%;
    --ring: 207 58% 28%;

    --radius: 0.625rem;

    --shadow-soft: 0 1px 2px hsl(207 64% 14% / 0.04), 0 4px 12px -4px hsl(207 64% 14% / 0.06);
    --shadow-medium: 0 4px 16px -4px hsl(207 64% 14% / 0.08), 0 12px 32px -8px hsl(207 64% 14% / 0.10);

    --gradient-card: linear-gradient(180deg, hsl(0 0% 100%), hsl(40 18% 98%));
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    -webkit-font-smoothing: antialiased;
  }
}
```

- [ ] **Step 5: Update `src/app/layout.tsx` to load Geist font and import globals.css**

```tsx
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shoppalyzer · Allegro Competitive Intelligence',
  description: 'Stop guessing what your competitors are doing on Allegro.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Install Geist font package**

```bash
npm install geist
```

- [ ] **Step 7: Verify the dev server starts without errors**

```bash
npm run dev
```

Expected: `✓ Ready in ~3s` on port 3000 (or 3001). No Tailwind errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json postcss.config.js tailwind.config.ts src/app/globals.css src/app/layout.tsx
git commit -m "feat: install Tailwind + design tokens from Shoppalyzer Design System v2"
```

---

## Task 2: Copy shadcn UI components + utils

**Files:**
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/progress.tsx`
- Create: `src/components/ui/separator.tsx`
- Create: `src/components/ui/skeleton.tsx`

- [ ] **Step 1: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Copy 8 shadcn components from the redesign repo**

Run these 8 copy commands exactly:

```bash
cp "../Shoppalyzer-Redesign/src/components/ui/button.tsx"    "src/components/ui/button.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/card.tsx"      "src/components/ui/card.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/input.tsx"     "src/components/ui/input.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/label.tsx"     "src/components/ui/label.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/badge.tsx"     "src/components/ui/badge.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/progress.tsx"  "src/components/ui/progress.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/separator.tsx" "src/components/ui/separator.tsx"
cp "../Shoppalyzer-Redesign/src/components/ui/skeleton.tsx"  "src/components/ui/skeleton.tsx"
```

These files import from `@/lib/utils` — that alias is already configured in `tsconfig.json`.

- [ ] **Step 3: Copy logo asset**

```bash
cp "../Shoppalyzer-Redesign/public/shoppalyzer-logo.svg" "public/shoppalyzer-logo.svg"
```

- [ ] **Step 4: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/components/ui/ public/shoppalyzer-logo.svg
git commit -m "feat: add shadcn UI components and utils from Shoppalyzer Design System"
```

---

## Task 3: Quota gate unit test

**Files:**
- Create: `src/app/api/v1/__tests__/quota.test.ts`

The quota gate already exists in `src/app/api/v1/queries/route.ts` lines 37–45. This task writes a test to lock in its behavior.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/v1/__tests__/quota.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth — controls what user the route sees
vi.mock('@/lib/auth', () => ({
  currentUser: vi.fn(),
}));

// Mock store — prevents real DB writes
vi.mock('@/lib/store', () => ({
  insertQuery: vi.fn(),
}));

// Mock allegro parser — always returns a valid URL
vi.mock('@/lib/allegro', () => ({
  parseAllegroInput: vi.fn(() => ({
    kind: 'allegro_url',
    normalized_url: 'https://allegro.pl/oferta/test-123',
    ean: undefined,
  })),
  inputTypeFromKind: vi.fn(() => 'allegro_url'),
}));

const { POST } = await import('@/app/api/v1/queries/route');
const { currentUser } = await import('@/lib/auth');
const { insertQuery } = await import('@/lib/store');

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/v1/queries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/queries — quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 402 when monthly_queries_used >= monthly_queries_limit', async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      plan: 'free',
      created_at: '2026-01-01T00:00:00Z',
      monthly_queries_used: 1,
      monthly_queries_limit: 1,
    });

    const res = await POST(makeRequest({ input: 'https://allegro.pl/oferta/x', input_type: 'auto' }));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
    expect(insertQuery).not.toHaveBeenCalled();
  });

  test('returns 201 when monthly_queries_used < monthly_queries_limit', async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      plan: 'pro',
      created_at: '2026-01-01T00:00:00Z',
      monthly_queries_used: 0,
      monthly_queries_limit: 100,
    });

    vi.mocked(insertQuery).mockResolvedValue({
      id: 'query-abc',
      user_id: 'user-1',
      status: 'queued',
      input: 'https://allegro.pl/oferta/x',
      input_type: 'allegro_url',
      created_at: '2026-05-17T00:00:00Z',
      resolved: {},
    } as never);

    const res = await POST(makeRequest({ input: 'https://allegro.pl/oferta/x', input_type: 'auto' }));

    expect(res.status).toBe(201);
    expect(insertQuery).toHaveBeenCalledOnce();
  });

  test('free user with 0 used and limit 1 can submit once', async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: 'user-2',
      email: 'free@test.com',
      plan: 'free',
      created_at: '2026-01-01T00:00:00Z',
      monthly_queries_used: 0,
      monthly_queries_limit: 1,
    });

    vi.mocked(insertQuery).mockResolvedValue({
      id: 'query-xyz',
      user_id: 'user-2',
      status: 'queued',
      input: 'https://allegro.pl/oferta/x',
      input_type: 'allegro_url',
      created_at: '2026-05-17T00:00:00Z',
      resolved: {},
    } as never);

    const res = await POST(makeRequest({ input: 'https://allegro.pl/oferta/x', input_type: 'auto' }));

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (or pass if gate already works)**

```bash
npx vitest run src/app/api/v1/__tests__/quota.test.ts --reporter=verbose
```

Expected: all 3 tests pass (the gate is already implemented). If any fail, the quota gate has a bug — check `src/app/api/v1/queries/route.ts` lines 37–45.

- [ ] **Step 3: Run full test suite to verify nothing is broken**

```bash
npx vitest run --reporter=verbose
```

Expected: all tests pass (previous 33 + 3 new = 36 total).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/__tests__/quota.test.ts
git commit -m "test: add quota gate unit tests (402 when limit reached, 201 when under)"
```

---

## Task 4: Supabase SSR helpers + auth middleware

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/middleware.ts`

- [ ] **Step 1: Create `src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Create `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Create `src/middleware.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session — required for SSR auth to work
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

- [ ] **Step 4: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/ src/middleware.ts
git commit -m "feat: add Supabase SSR client helpers and auth middleware"
```

---

## Task 5: Auth pages (login + signup)

**Files:**
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/signup/page.tsx`

- [ ] **Step 1: Create `src/app/(auth)/layout.tsx`**

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shoppalyzer-logo.svg" alt="Shoppalyzer" className="h-9" />
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(auth)/login/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  }

  return (
    <Card className="shadow-medium">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Zaloguj się</CardTitle>
        <CardDescription>Wprowadź dane, aby uzyskać dostęp do dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jan@firma.pl"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Hasło</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logowanie...' : 'Zaloguj się'}
          </Button>
          <Button type="button" variant="outline" className="w-full opacity-50 cursor-not-allowed" disabled>
            Kontynuuj z Google
            <span className="ml-2 text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm">
              Wkrótce
            </span>
          </Button>
        </form>
        <p className="text-sm text-center text-muted-foreground mt-6">
          Nie masz konta?{' '}
          <Link href="/signup" className="text-primary hover:underline font-medium">
            Zarejestruj się →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create `src/app/(auth)/signup/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  }

  return (
    <Card className="shadow-medium">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Utwórz konto</CardTitle>
        <CardDescription>Zacznij analizować konkurencję na Allegro.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jan@firma.pl"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Hasło</Label>
            <Input
              id="password"
              type="password"
              placeholder="minimum 6 znaków"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Tworzenie konta...' : 'Utwórz konto'}
          </Button>
        </form>
        <p className="text-sm text-center text-muted-foreground mt-6">
          Masz już konto?{' '}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Zaloguj się →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Manually test login page renders**

Start dev server (`npm run dev`), open `http://localhost:3001/login`.  
Expected: centered card with logo, email + password fields, "Zaloguj się" button, Google button with "Wkrótce" badge.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(auth\)/
git commit -m "feat: add login and signup pages with Supabase auth"
```

---

## Task 6: QuotaBar component + dashboard shell

**Files:**
- Create: `src/components/QuotaBar.tsx`
- Create: `src/components/DashboardShell.tsx`
- Create: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: Create `src/components/QuotaBar.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface QuotaData {
  monthly_queries_used: number;
  monthly_queries_limit: number;
  plan: string;
}

export function QuotaBar() {
  const [quota, setQuota] = useState<QuotaData | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/v1/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQuota({
          monthly_queries_used: data.monthly_queries_used,
          monthly_queries_limit: data.monthly_queries_limit,
          plan: data.plan,
        });
      }
    }
    load();
  }, []);

  if (!quota) return null;

  const pct = Math.min((quota.monthly_queries_used / quota.monthly_queries_limit) * 100, 100);
  const isWarning = pct >= 80 && pct < 100;
  const isDepleted = pct >= 100;

  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-[10px] font-semibold uppercase tracking-wider',
          isDepleted ? 'text-danger' : isWarning ? 'text-warning-foreground' : 'text-muted-foreground',
        )}>
          {quota.plan === 'free' ? 'FREE' : 'PRO'}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {quota.monthly_queries_used} / {quota.monthly_queries_limit}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          'h-1.5',
          isDepleted ? '[&>div]:bg-danger' : isWarning ? '[&>div]:bg-warning' : '[&>div]:bg-primary',
        )}
      />
      {isDepleted && (
        <p className="text-[10px] text-danger font-medium">Limit miesięczny wyczerpany</p>
      )}
      <a
        href="mailto:hello@shoppalyzer.com?subject=Upgrade%20plan"
        className={cn(
          'block text-center text-xs font-medium py-1.5 rounded-md transition-colors',
          isDepleted
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'text-primary hover:text-primary/80',
        )}
      >
        Ulepsz plan →
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/DashboardShell.tsx`**

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BarChart2, User, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { QuotaBar } from './QuotaBar';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Analizy', icon: BarChart2 },
  { href: '/dashboard/account', label: 'Konto', icon: User },
];

export function DashboardShell({ children, userEmail }: { children: React.ReactNode; userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Topbar */}
      <header className="h-14 border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between px-6">
        <span className="font-bold text-brand-navy tracking-tight">shoppalyzer</span>
        <span className="text-sm text-muted-foreground">{userEmail}</span>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[220px] border-r border-border bg-white/60 flex flex-col py-4 px-3 shrink-0">
          <nav className="space-y-0.5 flex-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === href || (href === '/dashboard' && pathname.startsWith('/dashboard/queries'))
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto space-y-2 pt-4 border-t border-border">
            <QuotaBar />
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Wyloguj się
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-6 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/dashboard/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DashboardShell } from '@/components/DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <DashboardShell userEmail={user.email ?? ''}>
      {children}
    </DashboardShell>
  );
}
```

- [ ] **Step 4: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Manually verify the shell renders**

Start dev server, log in at `/login`, check that `/dashboard` shows the sidebar, quota bar, and sign out button.

- [ ] **Step 6: Commit**

```bash
git add src/components/QuotaBar.tsx src/components/DashboardShell.tsx src/app/dashboard/layout.tsx
git commit -m "feat: add dashboard shell with sidebar, quota bar, and auth guard"
```

---

## Task 7: Dashboard main page (submit form + history list)

**Files:**
- Create: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/page.tsx`**

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type QueryStatus = 'queued' | 'discovering' | 'scraping' | 'parsing' | 'analyzing' | 'completed' | 'failed';

interface QueryRow {
  id: string;
  status: QueryStatus;
  input: string;
  created_at: string;
  resolved?: { product_url?: string };
}

function detectInputType(value: string): 'allegro_url' | 'product_url' | 'ean' {
  if (/allegro\.pl\/oferty-produktu\/|allegro\.pl\/produkt\//.test(value)) return 'product_url';
  if (/allegro\.pl\/oferta\//.test(value)) return 'allegro_url';
  if (/^\d{8,13}$/.test(value.trim())) return 'ean';
  return 'allegro_url';
}

function statusBadgeVariant(status: QueryStatus) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'destructive';
  return 'warning';
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'przed chwilą';
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h temu`;
  return `${Math.floor(hrs / 24)} dni temu`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('/api/v1/queries?limit=20', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setQueries(data.queries ?? []);
      setTotal(data.total ?? 0);
    }
    setLoadingHistory(false);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    setQuotaExceeded(false);

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }

    const res = await fetch('/api/v1/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ input: url.trim(), input_type: detectInputType(url.trim()) }),
    });

    setSubmitting(false);

    if (res.status === 402) {
      setQuotaExceeded(true);
      return;
    }

    if (!res.ok) {
      const data = await res.json();
      setSubmitError(data.error?.message ?? 'Nieznany błąd. Spróbuj ponownie.');
      return;
    }

    const data = await res.json();
    router.push(`/dashboard/queries/${data.query.query_id}`);
  }

  const statusLabel: Record<QueryStatus, string> = {
    queued: 'W kolejce',
    discovering: 'Odkrywanie',
    scraping: 'Pobieranie',
    parsing: 'Parsowanie',
    analyzing: 'Analiza',
    completed: 'Gotowe',
    failed: 'Błąd',
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy tracking-tight">Analizy</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Wklej link do produktu lub oferty na Allegro.
        </p>
      </div>

      {/* Submit card */}
      <Card className="shadow-soft">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nowa analiza</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              type="text"
              placeholder="https://allegro.pl/oferta/..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="flex-1"
              disabled={submitting || quotaExceeded}
            />
            <Button type="submit" disabled={submitting || !url.trim() || quotaExceeded}>
              {submitting ? 'Wysyłanie...' : 'Analizuj →'}
            </Button>
          </form>
          {submitError && (
            <p className="text-sm text-destructive mt-2">{submitError}</p>
          )}
          {quotaExceeded && (
            <div className="mt-3 rounded-lg bg-danger-soft border border-danger/20 px-3 py-2.5 text-sm text-danger font-medium">
              Limit miesięczny wyczerpany.{' '}
              <a href="mailto:hello@shoppalyzer.com?subject=Upgrade%20plan" className="underline">
                Ulepsz plan →
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Historia {total > 0 && <span className="text-muted-foreground font-normal">({total})</span>}
          </h2>
        </div>

        {loadingHistory ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 rounded-lg bg-surface-muted animate-pulse" />
            ))}
          </div>
        ) : queries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nie masz jeszcze żadnych analiz. Wklej link powyżej, żeby zacząć.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden bg-white">
            {queries.map((q, i) => (
              <button
                key={q.id}
                onClick={() => router.push(`/dashboard/queries/${q.id}`)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-muted transition-colors',
                  i > 0 && 'border-t border-border/60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {q.resolved?.product_url ?? q.input}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{relativeTime(q.created_at)}</p>
                </div>
                <Badge
                  variant={statusBadgeVariant(q.status) as 'default'}
                  className={cn(
                    'ml-3 shrink-0 text-[10px] font-semibold',
                    q.status === 'completed' && 'bg-success-soft text-success border-success/20',
                    q.status === 'failed' && 'bg-danger-soft text-danger border-danger/20',
                    !['completed', 'failed'].includes(q.status) && 'bg-warning-soft text-warning-foreground border-warning/20',
                  )}
                >
                  {statusLabel[q.status]}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Manually test the page**

Log in, navigate to `/dashboard`. Verify:
- Submit form renders with input + button
- Submitting a real Allegro URL redirects to `/dashboard/queries/:id`
- History list loads past queries from the API
- Empty state shows when no queries exist

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: add dashboard main page with submit form and history list"
```

---

## Task 8: Results page (step tracker + insight view)

**Files:**
- Create: `src/app/dashboard/queries/[id]/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/queries/[id]/page.tsx`**

```tsx
'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── Types (mirrors API response) ────────────────────────────────────────────

type QueryStatus = 'queued' | 'discovering' | 'scraping' | 'parsing' | 'analyzing' | 'completed' | 'failed';

interface QueryResult {
  id: string;
  status: QueryStatus;
  status_message?: string;
  input: string;
  resolved: { product_url?: string; product_name?: string };
  error?: { code: string; message: string };
  result?: {
    market: {
      price_min: number;
      price_max: number;
      price_median: number;
      total_offers: number;
      total_visible_sales_30d: number;
    };
    archetype: {
      archetype: string;
      confidence: 'LOW' | 'MEDIUM' | 'HIGH';
      reasoning: string;
      playbook_summary: string;
    };
    offers: Array<{
      id: string;
      seller: string;
      price: number;
      recommend_pct?: number;
      sold_recent: number;
      badges: { smart: boolean; super_seller: boolean; top_offer: boolean };
    }>;
    recommendations: Array<{
      seller: string;
      scorecard: { score: number };
      promote_recommendation: { decision: string; reasoning: string };
      tier: { label: string };
    }>;
  };
}

// ─── Step tracker ─────────────────────────────────────────────────────────────

const STEPS: { label: string; sublabel: string; doneWhen: QueryStatus[] }[] = [
  {
    label: 'Znaleziono stronę porównania',
    sublabel: 'Odkrywanie URL agregacji ofert',
    doneWhen: ['scraping', 'parsing', 'analyzing', 'completed'],
  },
  {
    label: 'Pobrano dane ze strony',
    sublabel: 'Scrapowanie Allegro',
    doneWhen: ['parsing', 'analyzing', 'completed'],
  },
  {
    label: 'Parsowanie ofert sprzedawców',
    sublabel: 'Odczytywanie danych ofert',
    doneWhen: ['analyzing', 'completed'],
  },
  {
    label: 'Silnik rekomendacji',
    sublabel: 'Obliczanie archetypów i wyników',
    doneWhen: ['completed'],
  },
];

const STATUS_STEP: Record<QueryStatus, number> = {
  queued: 0,
  discovering: 0,
  scraping: 1,
  parsing: 2,
  analyzing: 3,
  completed: 4,
  failed: -1,
};

function StepTracker({ status }: { status: QueryStatus }) {
  const currentStep = STATUS_STEP[status] ?? 0;
  return (
    <Card className="shadow-soft max-w-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Trwa analiza produktu</CardTitle>
        <p className="text-sm text-muted-foreground">Zazwyczaj zajmuje około 10 sekund.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {STEPS.map((step, i) => {
          const isDone = step.doneWhen.includes(status);
          const isActive = i === currentStep && !isDone;
          const isPending = !isDone && !isActive;
          return (
            <div key={i} className={cn('flex items-start gap-3', isPending && 'opacity-40')}>
              <div className={cn(
                'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                isDone && 'bg-success text-success-foreground',
                isActive && 'border-2 border-primary',
                isPending && 'border-2 border-border',
              )}>
                {isDone && '✓'}
                {isActive && (
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-primary border-t-transparent animate-spin block" />
                )}
              </div>
              <div>
                <p className={cn('text-sm font-medium', isActive && 'text-primary')}>
                  {step.label}{isActive && '...'}
                </p>
                {(isDone || isActive) && (
                  <p className="text-xs text-muted-foreground">{step.sublabel}</p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Recommendation chip ──────────────────────────────────────────────────────

function RecommendChip({ decision }: { decision: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PROMOTE:       { label: 'Promuj',    className: 'bg-success-soft text-success border-success/20' },
    TEST_PROMOTE:  { label: 'Testuj',    className: 'bg-warning-soft text-warning-foreground border-warning/20' },
    HOLD:          { label: 'Trzymaj',   className: 'bg-muted text-muted-foreground border-border' },
    AVOID:         { label: 'Unikaj',    className: 'bg-danger-soft text-danger border-danger/20' },
    DONT_PROMOTE:  { label: 'Nie promuj',className: 'bg-muted text-muted-foreground border-border' },
    STOP_PROMOTE:  { label: 'Zatrzymaj', className: 'bg-danger-soft text-danger border-danger/20' },
    OPTIONAL:      { label: 'Opcjonalnie', className: 'bg-muted text-muted-foreground border-border' },
  };
  const cfg = map[decision] ?? { label: decision, className: 'bg-muted text-muted-foreground border-border' };
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded border', cfg.className)}>
      {cfg.label}
    </span>
  );
}

// ─── Results view ─────────────────────────────────────────────────────────────

function ResultsView({ query }: { query: QueryResult }) {
  const [showAll, setShowAll] = useState(false);
  const r = query.result!;
  const top3 = r.recommendations.slice(0, 3);
  const displayedRecs = showAll ? r.recommendations : top3;

  const confidenceClass = {
    HIGH: 'bg-success-soft text-success border-success/20',
    MEDIUM: 'bg-warning-soft text-warning-foreground border-warning/20',
    LOW: 'bg-danger-soft text-danger border-danger/20',
  }[r.archetype.confidence] ?? '';

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-muted-foreground truncate max-w-xs">
          {query.resolved.product_url ?? query.input}
        </span>
        <Badge className="bg-primary text-primary-foreground border-0 font-bold text-[11px] shrink-0">
          {r.archetype.archetype.replace(/_/g, ' ')}
        </Badge>
        <Badge className={cn('border text-[10px] font-semibold shrink-0', confidenceClass)}>
          {r.archetype.confidence}
        </Badge>
      </div>

      {/* Main insight card */}
      <Card className="border-l-4 border-l-success shadow-soft">
        <CardContent className="pt-4">
          <p className="text-[10px] uppercase tracking-wider text-success font-semibold mb-1">
            Główna rekomendacja
          </p>
          <p className="text-sm text-foreground font-medium leading-relaxed">
            {r.archetype.playbook_summary}
          </p>
          {r.archetype.reasoning && (
            <p className="text-xs text-muted-foreground mt-2">{r.archetype.reasoning}</p>
          )}
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="shadow-soft">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Zakres cen</p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {r.market.price_min}–{r.market.price_max} <span className="text-sm font-normal">zł</span>
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Sprzedawcy</p>
            <p className="text-lg font-bold text-primary tabular-nums">{r.market.total_offers}</p>
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Sprzedaż 30d</p>
            <p className="text-lg font-bold text-success tabular-nums">
              {r.market.total_visible_sales_30d}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Seller list */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">
          {showAll ? 'Wszyscy sprzedawcy' : 'Top 3 sprzedawcy'}
        </h2>
        <Card className="shadow-soft overflow-hidden">
          {displayedRecs.map((rec, i) => (
            <div
              key={rec.seller + i}
              className={cn(
                'flex items-center gap-3 px-4 py-3',
                i > 0 && 'border-t border-border/60',
              )}
            >
              <span className={cn(
                'w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0',
                i === 0 ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-muted-foreground',
              )}>
                {i + 1}
              </span>
              <span className="flex-1 text-sm font-medium text-foreground truncate">{rec.seller}</span>
              <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                {r.offers.find(o => o.seller === rec.seller)?.price ?? '—'} zł
              </span>
              <RecommendChip decision={rec.promote_recommendation.decision} />
            </div>
          ))}
        </Card>
        {r.recommendations.length > 3 && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="w-full text-center text-sm text-primary hover:text-primary/80 font-medium py-3 transition-colors"
          >
            {showAll
              ? 'Pokaż mniej ↑'
              : `Pokaż wszystkich ${r.recommendations.length} sprzedawców ↓`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QueryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [query, setQuery] = useState<QueryResult | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Get auth token once
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return; }
      setToken(session.access_token);
    });
  }, [router]);

  const fetchQuery = useCallback(async (t: string) => {
    const res = await fetch(`/api/v1/queries/${id}`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.status === 404) { router.push('/dashboard'); return; }
    if (res.ok) setQuery(await res.json());
  }, [id, router]);

  // Initial fetch + polling while not terminal
  useEffect(() => {
    if (!token) return;
    fetchQuery(token);
    const terminal = (s?: string) => s === 'completed' || s === 'failed';
    if (terminal(query?.status)) return;
    const interval = setInterval(() => {
      fetchQuery(token).then(() => {
        if (terminal(query?.status)) clearInterval(interval);
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [token, fetchQuery, query?.status]);

  if (!query) {
    return (
      <div className="max-w-lg space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.status === 'failed') {
    return (
      <div className="max-w-md">
        <Card className="border-l-4 border-l-danger shadow-soft">
          <CardContent className="pt-4 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-danger font-semibold">Analiza nieudana</p>
            <p className="text-sm text-foreground">{query.error?.message ?? 'Nieznany błąd.'}</p>
            <button
              onClick={() => router.push(`/dashboard?retry=${encodeURIComponent(query.input)}`)}
              className="text-sm text-primary hover:underline font-medium"
            >
              Spróbuj ponownie →
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (query.status !== 'completed') {
    return <StepTracker status={query.status} />;
  }

  return <ResultsView query={query} />;
}
```

- [ ] **Step 2: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run --reporter=verbose
```

Expected: 36 tests pass (33 original + 3 quota gate).

- [ ] **Step 4: Manually test the full E2E flow**

1. Go to `http://localhost:3001/login`, log in with `e2e@shoppalyzer.test` / `E2eTestPass99!`
2. Paste `https://allegro.pl/oferta/apple-airpods-pro-usb-c-2-generacja-16893889737`, click "Analizuj"
3. Watch the step tracker progress through discovering → scraping → parsing → analyzing → completed
4. Verify the results page shows: archetype badge, main insight card, 3 stat cards, top 3 sellers, "Pokaż wszystkich 61" button

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/queries/
git commit -m "feat: add results page with live step tracker and insight-led analysis view"
```

---

## Final: run all tests and verify

- [ ] **Run full test suite**

```bash
npx vitest run --reporter=verbose
```

Expected: 36 tests pass.

- [ ] **TypeScript final check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Final commit (update page.tsx root + remove mock mode notice)**

Update `src/app/page.tsx` to redirect to `/dashboard`:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
```

```bash
git add src/app/page.tsx
git commit -m "feat: redirect root to /dashboard — dashboard is the entry point"
```
