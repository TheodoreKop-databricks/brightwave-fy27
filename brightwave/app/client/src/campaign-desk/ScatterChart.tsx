/**
 * ROAS × spend scatter chart.
 * x = spendToDateUsd, y = roas
 * color by perfBand (green=winner, red=underperformer, blue=steady, grey=paused)
 * size by spend
 */
import { Skeleton } from '@databricks/appkit-ui/react';
import { ScatterChart as RechartsScatter, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ScatterPoint } from '@/shared/types';

interface ScatterChartProps {
  data: ScatterPoint[];
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string) => void;
  loading: boolean;
}

const PERF_BAND_COLORS: Record<string, string> = {
  winner: 'var(--success)',
  underperformer: 'var(--destructive)',
  steady: '#4F7CE3',
  paused: '#9CA3AF',
};

export function ScatterChart({
  data,
  selectedCampaignId,
  onSelectCampaign,
  loading,
}: ScatterChartProps) {
  if (loading) {
    return <Skeleton className="h-80 w-full" />;
  }

  // Prepare data for Recharts
  const chartData = data
    .filter((p) => p.spendToDateUsd != null && p.roas != null)
    .map((p) => ({
      ...p,
      x: p.spendToDateUsd,
      y: p.roas,
      color:
        PERF_BAND_COLORS[p.perfBand ?? 'steady'] ||
        getComputedStyle(document.documentElement).getPropertyValue('--chart-3'),
      // Size proportional to spend, min 60px, max 200px
      size: Math.max(60, Math.min(200, (p.spendToDateUsd ?? 0) / 50000)),
    }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload?.[0]?.payload) {
      const point = payload[0].payload;
      return (
        <div className="rounded-md border border-border bg-card p-2 text-xs shadow-md">
          <div className="font-semibold text-foreground">
            {point.campaignName || point.campaignId}
          </div>
          <div className="text-muted-foreground">
            ROAS: {point.roas?.toFixed(2)}x
          </div>
          <div className="text-muted-foreground">
            Spend: ${(point.spendToDateUsd / 1e6).toFixed(1)}M
          </div>
          <div className="text-muted-foreground capitalize">
            {point.perfBand || 'unknown'}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsScatter
          margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
          onClick={(e: any) => {
            if (e?.payload?.campaignId) {
              onSelectCampaign(e.payload.campaignId);
            }
          }}
        >
          <XAxis
            type="number"
            dataKey="x"
            name="Spend ($M)"
            label={{ value: 'Spend to Date ($M)', position: 'insideBottomRight', offset: -5 }}
            tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="ROAS"
            label={{ value: 'ROAS', angle: -90, position: 'insideLeft' }}
            tickFormatter={(v) => `${v.toFixed(1)}x`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter
            name="Campaigns"
            data={chartData}
            fill="#8884d8"
            shape={
              <g>
                {chartData.map((point, idx) => (
                  <circle
                    key={idx}
                    cx={0}
                    cy={0}
                    r={Math.sqrt(point.size)}
                    fill={point.color}
                    fillOpacity={selectedCampaignId === point.campaignId ? 1 : 0.6}
                    stroke={
                      selectedCampaignId === point.campaignId ? 'var(--foreground)' : 'none'
                    }
                    strokeWidth={2}
                    style={{ cursor: 'pointer', transition: 'opacity 200ms' }}
                    onClick={() => onSelectCampaign(point.campaignId)}
                  />
                ))}
              </g>
            }
          />
        </RechartsScatter>
      </ResponsiveContainer>
    </div>
  );
}
