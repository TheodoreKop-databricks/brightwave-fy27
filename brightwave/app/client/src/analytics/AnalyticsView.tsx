/**
 * Analytics — warehouse-backed charts for Brightwave Campaign Desk.
 *
 * Live SQL-warehouse queries against the Delta lakehouse.
 * Charts: worst underperformers, performance mix by channel, action recommendations.
 */
import { useEffect, useState } from 'react';
import { BarChart } from '@databricks/appkit-ui/react';
import { fetchWarehouse, type Warehouse } from '@/lib/api';
import { BRAND_PALETTE } from '@/lib/brand';
import { RtPitch } from '@/architecture/RtPitch';

/**
 * Fetch chart rows from the server's /api/charts/<key> route.
 */
function useChartData<T = Record<string, unknown>>(key: string): {
  data: T[] | null;
  error: string | null;
  isLoading: boolean;
} {
  const [state, setState] = useState<{
    data: T[] | null;
    error: string | null;
    isLoading: boolean;
  }>({ data: null, error: null, isLoading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, isLoading: true });
    fetch(`/api/charts/${key}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body.data as T[];
      })
      .then((data) => alive && setState({ data, error: null, isLoading: false }))
      .catch(
        (e) =>
          alive &&
          setState({ data: null, error: String(e?.message ?? e), isLoading: false }),
      );
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

export function AnalyticsView() {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setWarehouse).catch(console.error);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-6 sm:space-y-10">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Campaign Analytics
          </div>
          <h1 className="display text-4xl font-semibold tracking-tight text-foreground mb-2">
            Campaign performance patterns.
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Live queries against the SQL warehouse — see where the winners are
            concentrated, where the opportunities lie, and what the model recommends.
          </p>
        </div>

        <RtPitch
          warehouse={
            warehouse?.name
              ? { name: warehouse.name, state: warehouse.state ?? null }
              : null
          }
          latencyMs={null}
        />

        {/* Top row: worst underperformers + performance mix */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <ChartCard
            title="Worst underperformers by recoverable spend"
            scope="Top 20"
            className="lg:col-span-3"
          >
            <ChartData chartKey="worst_underperformers" height={280}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="campaign_id"
                  yKey="recoverable_spend_usd"
                  colors={[BRAND_PALETTE[4]]}
                  height={280}
                />
              )}
            </ChartData>
          </ChartCard>

          <ChartCard
            title="Performance mix by channel"
            scope="All campaigns"
            className="lg:col-span-2"
          >
            <ChartData chartKey="perf_mix_by_channel" height={280}>
              {(rows) => (
                <BarChart
                  data={rows}
                  xKey="channel"
                  yKey="campaign_count"
                  colors={[BRAND_PALETTE[0]]}
                  height={280}
                />
              )}
            </ChartData>
          </ChartCard>
        </div>

        {/* Action recommendations mix */}
        <ChartCard title="Recommended action mix" scope="By predicted net value">
          <ChartData chartKey="action_mix" height={260}>
            {(rows) => (
              <BarChart
                data={rows}
                xKey="recommended_action"
                yKey="total_net_value_usd"
                colors={[BRAND_PALETTE[1]]}
                height={260}
              />
            )}
          </ChartData>
        </ChartCard>
      </div>
    </div>
  );
}

/**
 * Card wrapper for charts with title + scope.
 */
function ChartCard({
  title,
  scope,
  className,
  children,
}: {
  title: string;
  scope?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-card overflow-hidden ${className ?? ''}`}
    >
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {scope && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {scope}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/**
 * Chart data fetcher with loading/error/empty states.
 */
function ChartData({
  chartKey,
  height,
  children,
}: {
  chartKey: string;
  height: number;
  children: (rows: Record<string, unknown>[]) => React.ReactNode;
}) {
  const { data, error, isLoading } = useChartData(chartKey);
  const center = `flex items-center justify-center text-sm`;
  if (error) {
    return (
      <div className={`${center} text-destructive`} style={{ height }}>
        Error loading chart: {error}
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        Loading…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={`${center} text-muted-foreground`} style={{ height }}>
        No data.
      </div>
    );
  }
  return <>{children(data)}</>;
}
