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
      try {
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
        } else {
          console.error('[QuotaBar] /api/v1/me returned', res.status);
        }
      } catch (err) {
        console.error('[QuotaBar] Failed to load quota', err);
      }
    }
    load();
  }, []);

  if (!quota) return null;

  const pct = quota.monthly_queries_limit > 0
    ? Math.min((quota.monthly_queries_used / quota.monthly_queries_limit) * 100, 100)
    : 0;
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
