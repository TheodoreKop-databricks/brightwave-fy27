/**
 * KPI cards for the Campaign Desk.
 * - Recoverable spend ($, red tint)
 * - Underperformers (count, red tint)
 * - ROAS gap (winner avg vs underperformer avg, neutral)
 */
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import { Skeleton } from '@databricks/appkit-ui/react';
import type { DeskKpis } from '@/shared/types';

interface KpiCardsProps {
  kpis: DeskKpis | null;
  loading: boolean;
}

export function KpiCards({ kpis, loading }: KpiCardsProps) {
  const recoverPulse = usePulseOnChange(kpis?.recoverableSpendUsd ?? 0);
  const countPulse = usePulseOnChange(kpis?.underperformerCountOpen ?? 0);
  const roasGapPulse = usePulseOnChange(
    (kpis?.avgWinnerRoas ?? 0) - (kpis?.avgUnderperformerRoas ?? 0),
  );

  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Recoverable Spend */}
      <div
        className={`rounded-lg border border-border bg-card p-4 transition-all ${recoverPulse ? 'ring-2 ring-destructive/30' : ''}`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-destructive mb-2">
          Recoverable Spend
        </div>
        <div className="text-3xl font-bold text-foreground">
          ${(kpis.recoverableSpendUsd / 1e6).toFixed(1)}M
        </div>
      </div>

      {/* Underperformer Count */}
      <div
        className={`rounded-lg border border-border bg-card p-4 transition-all ${countPulse ? 'ring-2 ring-destructive/30' : ''}`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-destructive mb-2">
          Underperformers (Open)
        </div>
        <div className="text-3xl font-bold text-foreground">
          {kpis.underperformerCountOpen}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          of {kpis.underperformerCount} total
        </div>
      </div>

      {/* ROAS Gap */}
      <div
        className={`rounded-lg border border-border bg-card p-4 transition-all ${roasGapPulse ? 'ring-2 ring-primary/30' : ''}`}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2">
          ROAS Gap
        </div>
        <div className="text-3xl font-bold text-foreground">
          {kpis.avgWinnerRoas && kpis.avgUnderperformerRoas
            ? (kpis.avgWinnerRoas - kpis.avgUnderperformerRoas).toFixed(2)
            : '—'}
          x
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {kpis.avgWinnerRoas ? `Winners: ${kpis.avgWinnerRoas.toFixed(2)}x` : '—'} /{' '}
          {kpis.avgUnderperformerRoas
            ? `Underperformers: ${kpis.avgUnderperformerRoas.toFixed(2)}x`
            : '—'}
        </div>
      </div>
    </div>
  );
}
