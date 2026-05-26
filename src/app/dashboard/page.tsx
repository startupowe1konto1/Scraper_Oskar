'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

function statusBadgeClass(status: QueryStatus): string {
  if (status === 'completed') return 'bg-success-soft text-success border-success/20';
  if (status === 'failed') return 'bg-danger-soft text-danger border-danger/20';
  return 'bg-warning-soft text-warning-foreground border-warning/20';
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

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(searchParams.get('retry') ?? '');
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
      const data = await res.json().catch(() => ({}));
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
                  className={cn('ml-3 shrink-0 text-[10px] font-semibold border', statusBadgeClass(q.status))}
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

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
