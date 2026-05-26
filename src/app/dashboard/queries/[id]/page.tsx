'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  QueryDetail,
  AnalysisResult,
  QueryStatus,
  PromoteDecision,
} from '@/types/api';

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

function RecommendChip({ decision }: { decision: PromoteDecision }) {
  const map: Record<string, { label: string; className: string }> = {
    PROMOTE:       { label: 'Promuj',       className: 'bg-success-soft text-success border-success/20' },
    TEST_PROMOTE:  { label: 'Testuj',       className: 'bg-warning-soft text-warning-foreground border-warning/20' },
    HOLD:          { label: 'Trzymaj',      className: 'bg-muted text-muted-foreground border-border' },
    AVOID:         { label: 'Unikaj',       className: 'bg-danger-soft text-danger border-danger/20' },
    DONT_PROMOTE:  { label: 'Nie promuj',   className: 'bg-muted text-muted-foreground border-border' },
    STOP_PROMOTE:  { label: 'Zatrzymaj',    className: 'bg-danger-soft text-danger border-danger/20' },
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

function ResultsView({ query }: { query: QueryDetail & { result: AnalysisResult } }) {
  const [showAll, setShowAll] = useState(false);
  const r = query.result;
  const top3 = r.recommendations.slice(0, 3);
  const displayedRecs = showAll ? r.recommendations : top3;

  const confidenceClass = {
    HIGH:   'bg-success-soft text-success border-success/20',
    MEDIUM: 'bg-warning-soft text-warning-foreground border-warning/20',
    LOW:    'bg-danger-soft text-danger border-danger/20',
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

export default function QueryPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [query, setQuery] = useState<QueryDetail | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Get auth token once
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return; }
      setToken(session.access_token);
    });
  }, [router]);

  const fetchQuery = useCallback(async (t: string) => {
    try {
      const res = await fetch(`/api/v1/queries/${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) { router.push('/login'); return; }
      if (res.status === 404) { router.push('/dashboard'); return; }
      if (res.ok) {
        const data = await res.json();
        setQuery(data);
      } else {
        console.error('[QueryPage] fetchQuery returned', res.status);
      }
    } catch (err) {
      console.error('[QueryPage] fetchQuery failed', err);
    }
  }, [id, router]);

  // Fetch + poll — stops automatically when terminal status is reached
  useEffect(() => {
    if (!token) return;

    const terminal = query?.status === 'completed' || query?.status === 'failed';
    if (terminal) return; // already done, don't set up polling or re-fetch

    // Fetch now + every 2s
    fetchQuery(token);
    const interval = setInterval(() => fetchQuery(token), 2000);
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

  // At this point status === 'completed' and result must be present
  return <ResultsView query={query as QueryDetail & { result: AnalysisResult }} />;
}
