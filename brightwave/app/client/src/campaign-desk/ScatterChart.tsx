/**
 * ROAS × spend scatter — the Campaign Desk hero visual.
 *   x = spend to date, y = ROAS, size ∝ spend, color by perf_band
 *   (green winner / red underperformer / steel steady / grey paused).
 * CMP-0000214 is highlighted as the zoom target; clicking a point filters the queue.
 *
 * Rendered the idiomatic Recharts way: ONE <Scatter> series per band (each a
 * flat fill), a <ZAxis> driving bubble size, animation off, and steady/paused
 * down-sampled so the "background" clusters stay light. (The previous version
 * passed a shape that re-rendered every point for every datum — millions of
 * nodes — which hung the page and drew nothing.)
 */
import { useMemo } from 'react';
import { Skeleton } from '@databricks/appkit-ui/react';
import {
  ScatterChart as RechartsScatter,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ScatterPoint } from '@/shared/types';

interface ScatterChartProps {
  data: ScatterPoint[];
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string) => void;
  loading: boolean;
}

const ZOOM_TARGET = 'CMP-0000214';

const PERF_BAND_COLORS: Record<string, string> = {
  winner: 'var(--success)',
  underperformer: 'var(--destructive)',
  steady: '#4F7CE3',
  paused: '#9CA3AF',
};
const BAND_ORDER: Array<keyof typeof PERF_BAND_COLORS> = [
  'steady',
  'paused',
  'winner',
  'underperformer',
];
// Keep all winners + underperformers (the story), sample the background bands.
const SAMPLE_CAP: Record<string, number> = { steady: 150, paused: 60, winner: 9999, underperformer: 9999 };

type Row = ScatterPoint & { x: number; y: number; z: number };

export function ScatterChart({ data, selectedCampaignId, onSelectCampaign, loading }: ScatterChartProps) {
  const byBand = useMemo(() => {
    const groups: Record<string, Row[]> = { winner: [], underperformer: [], steady: [], paused: [] };
    for (const p of data) {
      if (p.spendToDateUsd == null || p.roas == null) continue;
      const band = (p.perfBand ?? 'steady') as string;
      (groups[band] ?? groups.steady).push({
        ...p,
        x: p.spendToDateUsd,
        y: p.roas,
        z: p.spendToDateUsd,
      });
    }
    for (const b of Object.keys(groups)) {
      const cap = SAMPLE_CAP[b] ?? 9999;
      if (groups[b].length > cap) {
        const step = groups[b].length / cap;
        groups[b] = Array.from({ length: cap }, (_, i) => groups[b][Math.floor(i * step)]);
      }
    }
    return groups;
  }, [data]);

  const zoomTarget = useMemo(
    () =>
      data
        .filter((p) => p.campaignId === ZOOM_TARGET && p.spendToDateUsd != null && p.roas != null)
        .map((p) => ({ ...p, x: p.spendToDateUsd as number, y: p.roas as number, z: p.spendToDateUsd as number })),
    [data],
  );

  if (loading) return <Skeleton className="h-80 w-full" />;

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) => {
    const point = active && payload?.[0]?.payload;
    if (!point) return null;
    return (
      <div className="rounded-md border border-border bg-card p-2 text-xs shadow-md">
        <div className="font-semibold text-foreground">{point.campaignName || point.campaignId}</div>
        <div className="text-muted-foreground">ROAS: {point.roas?.toFixed(2)}x</div>
        <div className="text-muted-foreground">Spend: ${((point.spendToDateUsd ?? 0) / 1e6).toFixed(2)}M</div>
        <div className="text-muted-foreground capitalize">{point.perfBand || 'unknown'}</div>
      </div>
    );
  };

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsScatter margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
          <XAxis
            type="number"
            dataKey="x"
            name="Spend"
            domain={[0, 'dataMax']}
            tickFormatter={(v: number) => `$${(v / 1e6).toFixed(1)}M`}
            label={{ value: 'Spend to date', position: 'insideBottomRight', offset: -8 }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="ROAS"
            tickFormatter={(v: number) => `${v.toFixed(1)}x`}
            label={{ value: 'ROAS', angle: -90, position: 'insideLeft' }}
            tick={{ fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="z" range={[30, 320]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} isAnimationActive={false} />
          {BAND_ORDER.map((band) => (
            <Scatter
              key={band}
              name={band}
              data={byBand[band]}
              fill={PERF_BAND_COLORS[band]}
              fillOpacity={0.62}
              isAnimationActive={false}
              onClick={(pt: unknown) => {
                const id = (pt as { campaignId?: string })?.campaignId;
                if (id) onSelectCampaign(id);
              }}
              style={{ cursor: 'pointer' }}
            >
              {byBand[band].map((p) => (
                <Cell
                  key={p.campaignId}
                  stroke={selectedCampaignId === p.campaignId ? 'var(--foreground)' : 'transparent'}
                  strokeWidth={selectedCampaignId === p.campaignId ? 2 : 0}
                />
              ))}
            </Scatter>
          ))}
          {/* CMP-0000214 — the zoom target, always ringed on top. */}
          {zoomTarget.length > 0 && (
            <Scatter
              name="CMP-0000214"
              data={zoomTarget}
              fill={PERF_BAND_COLORS.underperformer}
              isAnimationActive={false}
              shape="circle"
              onClick={() => onSelectCampaign(ZOOM_TARGET)}
              style={{ cursor: 'pointer' }}
            >
              <Cell stroke="var(--foreground)" strokeWidth={2.5} />
            </Scatter>
          )}
        </RechartsScatter>
      </ResponsiveContainer>
    </div>
  );
}
