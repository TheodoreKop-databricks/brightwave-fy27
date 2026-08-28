/**
 * Campaign detail drawer (right slide-over ~60%).
 * Tabs:
 *   - Campaign: detail grid, matching winner, ranked actions, creative search
 *   - Trend: sparkline of ROAS
 *   - Activity: timeline of audit trail + actions
 */
import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '@databricks/appkit-ui/react';
import { Button } from '@databricks/appkit-ui/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@databricks/appkit-ui/react';
import { Input } from '@databricks/appkit-ui/react';
import { Skeleton } from '@databricks/appkit-ui/react';
import { fetchCampaignDetail, searchCreatives } from '@/lib/campaigns';
import { dockController } from '@/chat/dockController';
import type { CampaignDetail, CreativeHit, ActionType } from '@/shared/types';

interface CampaignDrawerProps {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACTION_LABELS: Record<ActionType, string> = {
  replicate_winner: 'Replicate Winner',
  reallocate_budget: 'Reallocate Budget',
  pause: 'Pause Campaign',
};

export function CampaignDrawer({ campaignId, open, onOpenChange }: CampaignDrawerProps) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creativesSearch, setCreativesSearch] = useState('');
  const [creativeResults, setCreativeResults] = useState<CreativeHit[]>([]);
  const [searchingCreatives, setSearchingCreatives] = useState(false);

  // Fetch detail when drawer opens or campaignId changes
  useEffect(() => {
    if (!open) return;

    async function load() {
      setLoading(true);
      try {
        const d = await fetchCampaignDetail(campaignId);
        setDetail(d);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [campaignId, open]);

  // Search creatives
  useEffect(() => {
    if (!creativesSearch.trim()) {
      setCreativeResults([]);
      return;
    }

    async function search() {
      setSearchingCreatives(true);
      try {
        const results = await searchCreatives(creativesSearch, 10);
        setCreativeResults(results);
      } catch (e) {
        console.error('Creative search failed:', e);
      } finally {
        setSearchingCreatives(false);
      }
    }

    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [creativesSearch]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {detail?.campaign.campaignName || detail?.campaign.campaignId || 'Campaign'}
          </SheetTitle>
          <SheetClose />
        </SheetHeader>

        {error && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading || !detail ? (
          <div className="mt-4 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="campaign" className="mt-6">
            <TabsList>
              <TabsTrigger value="campaign">Campaign</TabsTrigger>
              <TabsTrigger value="trend">Trend</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* Campaign Tab */}
            <TabsContent value="campaign" className="space-y-6 mt-4">
              {/* Detail Grid */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Campaign Details</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DetailRow label="Campaign ID" value={detail.campaign.campaignId} />
                  <DetailRow
                    label="Channel"
                    value={detail.campaign.channel || '—'}
                  />
                  <DetailRow
                    label="Category"
                    value={detail.campaign.category || '—'}
                  />
                  <DetailRow
                    label="Target Segment"
                    value={detail.campaign.targetSegment || '—'}
                  />
                  <DetailRow
                    label="ROAS"
                    value={
                      detail.campaign.roas ? `${detail.campaign.roas.toFixed(2)}x` : '—'
                    }
                  />
                  <DetailRow
                    label="Spend to Date"
                    value={
                      detail.campaign.spendToDateUsd
                        ? `$${(detail.campaign.spendToDateUsd / 1e6).toFixed(1)}M`
                        : '—'
                    }
                  />
                  <DetailRow
                    label="Recoverable Spend"
                    value={
                      detail.campaign.recoverableSpendUsd
                        ? `$${(detail.campaign.recoverableSpendUsd / 1e6).toFixed(1)}M`
                        : '—'
                    }
                  />
                  <DetailRow label="Status" value={detail.campaign.status || '—'} />
                </div>
              </div>

              {/* Matching Winner */}
              {detail.matchingWinner && (
                <div className="space-y-3 rounded-lg border border-border p-3 bg-success-subtle/10">
                  <h3 className="text-sm font-semibold text-foreground">Matching Winner</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <DetailRow
                      label="Campaign"
                      value={detail.matchingWinner.campaignName || detail.matchingWinner.campaignId}
                    />
                    <DetailRow
                      label="ROAS"
                      value={`${detail.matchingWinner.roas?.toFixed(2) || '—'}x`}
                    />
                    <DetailRow
                      label="Channel"
                      value={detail.matchingWinner.channel || '—'}
                    />
                    <DetailRow
                      label="Category"
                      value={detail.matchingWinner.category || '—'}
                    />
                    <DetailRow
                      label="Creative Name"
                      value={detail.matchingWinner.creativeName || '—'}
                    />
                    <DetailRow
                      label="Creative Type"
                      value={detail.matchingWinner.creativeType || '—'}
                    />
                  </div>
                  {detail.matchingWinner.description && (
                    <p className="text-xs text-muted-foreground italic">
                      {detail.matchingWinner.description}
                    </p>
                  )}
                </div>
              )}

              {/* Ranked Actions */}
              {detail.rankedActions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Recommended Actions
                  </h3>
                  <div className="space-y-2">
                    {detail.rankedActions.map((action, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border p-3 bg-muted/30 text-sm"
                      >
                        <div className="font-medium text-foreground mb-1">
                          {ACTION_LABELS[action.actionType]}
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Predicted ROAS lift: +{action.predictedRoasLift.toFixed(2)}x
                          {' | '}
                          Net value: ${(action.predictedNetValueUsd / 1e6).toFixed(1)}M
                        </div>
                        <Button
                          size="sm"
                          onClick={() =>
                            dockController.openAndSend(
                              `I want to ${ACTION_LABELS[action.actionType].toLowerCase()} campaign ${detail.campaign.campaignId}. Can you draft the brief?`,
                            )
                          }
                        >
                          Approve & Draft
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Creative Search */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Find the Winning Creative to Replicate
                </h3>
                <Input
                  placeholder="Search by name, type, angle…"
                  value={creativesSearch}
                  onChange={(e) => setCreativesSearch(e.target.value)}
                  className="text-sm"
                />
                {creativeResults.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {creativeResults.map((creative) => (
                      <div
                        key={creative.creativeId}
                        className="rounded-md border border-border p-2 text-xs bg-muted/30"
                      >
                        <div className="font-medium text-foreground">
                          {creative.creativeName || creative.creativeId}
                        </div>
                        {creative.creativeType && (
                          <div className="text-muted-foreground">
                            Type: {creative.creativeType}
                          </div>
                        )}
                        {creative.angle && (
                          <div className="text-muted-foreground">Angle: {creative.angle}</div>
                        )}
                        {creative.description && (
                          <p className="text-muted-foreground italic mt-1">
                            {creative.description}
                          </p>
                        )}
                        {creative.score && (
                          <div className="text-muted-foreground mt-1">
                            Score: {creative.score.toFixed(2)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {creativesSearch && creativeResults.length === 0 && !searchingCreatives && (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    No creatives found.
                  </div>
                )}
                {searchingCreatives && (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Searching…
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Trend Tab */}
            <TabsContent value="trend" className="space-y-4 mt-4">
              <div className="rounded-lg border border-border p-4 bg-muted/30 text-sm text-muted-foreground">
                <div className="font-semibold text-foreground mb-2">ROAS Trend</div>
                <p>
                  Comparing {detail.campaign.campaignName || detail.campaign.campaignId} (current:{' '}
                  {detail.campaign.roas?.toFixed(2) || '—'}x) vs{' '}
                  {detail.matchingWinner?.campaignName || 'winner'} (
                  {detail.matchingWinner?.roas?.toFixed(2) || '—'}x)
                </p>
                {/* Sparkline would go here if history data is available */}
                <p className="mt-2 text-xs">
                  Per-campaign history not yet available. Consider this gap as the immediate
                  opportunity for replication.
                </p>
              </div>
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="space-y-4 mt-4">
              {detail.activity.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No activity yet.
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {detail.activity
                    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                    .map((entry, i) => (
                      <div key={i} className="border-l-2 border-border pl-3 pb-3">
                        <div className="text-xs font-semibold text-foreground">
                          {entry.action}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          by {entry.by} · {new Date(entry.at).toLocaleString()}
                        </div>
                        {entry.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            {entry.notes}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.05em] mb-0.5">
        {label}
      </div>
      <div className="text-foreground font-medium break-words">{value}</div>
    </div>
  );
}
