/**
 * Queue table for underperformers.
 * Tabs: All / Underperformers / Has matching winner / No match / Action taken
 * Filters: search, channel, category
 * Sort: recoverable spend, ROAS, spend to date
 * Columns: Campaign | Channel | Category | ROAS | Matching winner? | Recoverable spend | Action | Status
 */
import { Input } from '@databricks/appkit-ui/react';
import { Badge } from '@databricks/appkit-ui/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { X } from 'lucide-react';
import type { QueueRow, CampaignFilters as CampaignFiltersType, ActionType } from '@/shared/types';

interface QueueTableProps {
  rows: QueueRow[];
  filters: CampaignFiltersType | null;
  status: 'all' | 'underperformers' | 'has_winner' | 'no_match' | 'action_taken';
  onStatusChange: (status: 'all' | 'underperformers' | 'has_winner' | 'no_match' | 'action_taken') => void;
  search: string;
  onSearchChange: (search: string) => void;
  channel: string | null;
  onChannelChange: (channel: string | null) => void;
  category: string | null;
  onCategoryChange: (category: string | null) => void;
  sort: 'recoverable' | 'roas' | 'spend';
  onSortChange: (sort: 'recoverable' | 'roas' | 'spend') => void;
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string) => void;
  loading: boolean;
  error: string | null;
}

const TAB_LABELS: Record<
  'all' | 'underperformers' | 'has_winner' | 'no_match' | 'action_taken',
  string
> = {
  all: 'All',
  underperformers: 'Underperformers',
  has_winner: 'Has Winner',
  no_match: 'No Match',
  action_taken: 'Action Taken',
};

const ACTION_LABELS: Record<ActionType, string> = {
  replicate_winner: 'Replicate',
  reallocate_budget: 'Reallocate',
  pause: 'Pause',
};

export function QueueTable({
  rows,
  filters,
  status,
  onStatusChange,
  search,
  onSearchChange,
  channel,
  onChannelChange,
  category,
  onCategoryChange,
  sort,
  onSortChange,
  selectedCampaignId,
  onSelectCampaign,
  loading,
  error,
}: QueueTableProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      {/* Tabs */}
      <Tabs value={status} onValueChange={(v) => onStatusChange(v as any)}>
        <TabsList>
          {(
            ['all', 'underperformers', 'has_winner', 'no_match', 'action_taken'] as const
          ).map((s) => (
            <TabsTrigger key={s} value={s}>
              {TAB_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Filters & Search */}
        <div className="mt-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Input
              placeholder="Search campaign ID or name…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="flex-1 min-w-0"
            />
            <div className="flex gap-2 flex-wrap">
              {filters?.channels && filters.channels.length > 0 && (
                <select
                  value={channel ?? ''}
                  onChange={(e) => onChannelChange(e.target.value || null)}
                  className="px-3 py-2 rounded-md border border-border bg-background text-sm"
                >
                  <option value="">All channels</option>
                  {filters.channels.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              {filters?.categories && filters.categories.length > 0 && (
                <select
                  value={category ?? ''}
                  onChange={(e) => onCategoryChange(e.target.value || null)}
                  className="px-3 py-2 rounded-md border border-border bg-background text-sm"
                >
                  <option value="">All categories</option>
                  {filters.categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={sort}
                onChange={(e) => onSortChange(e.target.value as any)}
                className="px-3 py-2 rounded-md border border-border bg-background text-sm"
              >
                <option value="recoverable">Sort by Recoverable</option>
                <option value="roas">Sort by ROAS</option>
                <option value="spend">Sort by Spend</option>
              </select>
            </div>
          </div>

          {/* Active filters */}
          {(channel || category) && (
            <div className="flex gap-2 flex-wrap">
              {channel && (
                <Badge variant="secondary" className="flex items-center gap-1 pr-1">
                  {channel}
                  <button
                    onClick={() => onChannelChange(null)}
                    className="ml-1 hover:bg-black/10 rounded px-1"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
              {category && (
                <Badge variant="secondary" className="flex items-center gap-1 pr-1">
                  {category}
                  <button
                    onClick={() => onCategoryChange(null)}
                    className="ml-1 hover:bg-black/10 rounded px-1"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}
        </div>

        <TabsContent value={status} className="mt-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                    Campaign
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                    Channel
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                    Category
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">
                    ROAS
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                    Winner?
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">
                    Recoverable
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                    Action
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No campaigns found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.campaignId}
                      onClick={() => onSelectCampaign(row.campaignId)}
                      className={`border-b border-border hover:bg-muted/50 transition-colors cursor-pointer ${
                        selectedCampaignId === row.campaignId ? 'bg-muted/70' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-medium text-foreground">
                        <div className="font-semibold">{row.campaignId}</div>
                        <div className="text-xs text-muted-foreground">{row.campaignName}</div>
                      </td>
                      <td className="py-3 px-4 text-foreground">{row.channel || '—'}</td>
                      <td className="py-3 px-4 text-foreground">{row.category || '—'}</td>
                      <td className="py-3 px-4 text-right font-mono text-foreground">
                        {row.roas?.toFixed(2) || '—'}x
                      </td>
                      <td className="py-3 px-4">
                        {row.hasMatchingWinner ? (
                          <Badge variant="secondary" className="text-xs">
                            {row.matchingWinnerCampaignId}
                            {row.matchingWinnerRoas && (
                              <span className="ml-1">
                                ({row.matchingWinnerRoas.toFixed(2)}x)
                              </span>
                            )}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-foreground">
                        ${((row.recoverableSpendUsd ?? 0) / 1e6).toFixed(1)}M
                      </td>
                      <td className="py-3 px-4">
                        {row.recommendedAction ? (
                          <Badge variant="secondary" className="text-xs bg-info-subtle text-info-subtle-foreground">
                            {ACTION_LABELS[row.recommendedAction]}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {row.actionTakenType
                          ? `Taken: ${ACTION_LABELS[row.actionTakenType]}`
                          : row.actionStatus || 'Open'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
