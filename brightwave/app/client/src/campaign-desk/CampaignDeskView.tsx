/**
 * Campaign Desk — the primary write surface for Brightwave.
 *
 * The CMO's interface for managing underperforming campaigns, finding winners,
 * and replicating successful patterns across underperformers.
 *
 * Structure:
 *   - Hero header + "Ask the assistant" banner
 *   - 3 KPI cards (recoverable spend, underperformer count, ROAS gap)
 *   - ROAS × spend scatter (hero visual)
 *   - Queue table (underperformers, tabs, filters, search, sort)
 *   - Detail drawer (campaign tab, matching winner, actions, creative search)
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Sparkles } from 'lucide-react';
import {
  fetchKpis,
  fetchScatter,
  fetchQueue,
  fetchFilters,
} from '@/lib/campaigns';
import { useSession } from '@/lib/api';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import type {
  DeskKpis,
  ScatterPoint,
  QueueRow,
  CampaignFilters as CampaignFiltersType,
} from '@/shared/types';

import { KpiCards } from './KpiCards';
import { ScatterChart } from './ScatterChart';
import { QueueTable } from './QueueTable';
import { CampaignDrawer } from './CampaignDrawer';

const BANNER_PROMPT = `Why is CMP-0000214 underperforming compared to our winners? What patterns make the winners successful? How should I replicate those patterns across the underperformer cluster?`;

type QueueStatus = 'all' | 'underperformers' | 'has_winner' | 'no_match' | 'action_taken';
type SortBy = 'recoverable' | 'roas' | 'spend';

export function CampaignDeskView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const campaignFromUrl = searchParams.get('campaign') ?? '';

  // Filter state
  const [status, setStatus] = useState<QueueStatus>(
    (searchParams.get('status') as QueueStatus) ?? 'all',
  );
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<string | null>(
    searchParams.get('channel') ?? null,
  );
  const [category, setCategory] = useState<string | null>(
    searchParams.get('category') ?? null,
  );
  const [sort, setSort] = useState<SortBy>(
    (searchParams.get('sort') as SortBy) ?? 'recoverable',
  );

  // Data state
  const [kpis, setKpis] = useState<DeskKpis | null>(null);
  const [scatter, setScatter] = useState<ScatterPoint[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [filters, setFilters] = useState<CampaignFiltersType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    campaignFromUrl || null,
  );
  const [drawerOpen, setDrawerOpen] = useState(!!campaignFromUrl);

  useSession();

  // Sync all filters → URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string | null) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete('status', status === 'all' ? null : status);
    setOrDelete('channel', channel);
    setOrDelete('category', category);
    setOrDelete('sort', sort === 'recoverable' ? null : sort);
    setOrDelete('campaign', selectedCampaignId);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channel, category, sort, selectedCampaignId]);

  // Update state when URL changes
  useEffect(() => {
    const urlStatus = (searchParams.get('status') as QueueStatus) ?? 'all';
    if (urlStatus !== status) setStatus(urlStatus);
    const urlChannel = searchParams.get('channel');
    if (urlChannel !== channel) setChannel(urlChannel);
    const urlCategory = searchParams.get('category');
    if (urlCategory !== category) setCategory(urlCategory);
    const urlSort = (searchParams.get('sort') as SortBy) ?? 'recoverable';
    if (urlSort !== sort) setSort(urlSort);
    const urlCampaign = searchParams.get('campaign');
    if (urlCampaign !== selectedCampaignId) setSelectedCampaignId(urlCampaign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Global data (KPI cards + scatter + filter chips) — independent of the queue
  // tabs/search, so fetch it once on mount and again only when the agent writes.
  async function reloadGlobal() {
    try {
      const [k, s, f] = await Promise.all([fetchKpis(), fetchScatter(), fetchFilters()]);
      setKpis(k);
      setScatter(s);
      setFilters(f);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // The queue reacts to tabs / filters / search only — no need to refetch the
  // 2000-point scatter on every keystroke.
  async function reloadQueue() {
    setLoading(true);
    try {
      const q = await fetchQueue({
        status: status === 'all' ? undefined : status,
        search: search || undefined,
        channel: channel ?? undefined,
        category: category ?? undefined,
        sort,
      });
      setQueue(q);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadGlobal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced queue reload on filter/search change (300ms when typing).
  useEffect(() => {
    const t = setTimeout(() => void reloadQueue(), search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channel, category, sort, search]);

  // Subscribe to dataMutated (agent writes) — refresh both global + queue.
  useEffect(() => {
    return dataMutated.subscribe(() => {
      void reloadGlobal();
      void reloadQueue();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCampaign = useMemo(
    () => queue.find((c) => c.campaignId === selectedCampaignId) || null,
    [queue, selectedCampaignId],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-8">
        {/* Header */}
        <section className="space-y-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Replicate what's working, while the quarter's still in play.
            </h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">
              Every green campaign is a pattern to copy. Every red one is budget leaking
              that a winner's playbook could rescue.
            </p>
          </div>

          {/* Ask the assistant banner */}
          <button
            onClick={() => dockController.openAndSend(BANNER_PROMPT)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-muted/50 hover:bg-muted transition-colors group"
          >
            <Sparkles className="size-5 text-accent shrink-0 group-hover:animate-pulse" />
            <span className="text-sm text-foreground font-medium">
              Ask why a campaign is winning and how to replicate it across the ones that aren't
            </span>
          </button>
        </section>

        {/* KPI Cards */}
        <section>
          <KpiCards kpis={kpis} loading={loading} />
        </section>

        {/* Scatter Chart */}
        <section>
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                ROAS × Spend by Campaign
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Green = winner, Red = underperformer, Blue = steady, Gray = paused
              </p>
            </div>
            <ScatterChart
              data={scatter}
              selectedCampaignId={selectedCampaignId}
              onSelectCampaign={(id) => {
                setSelectedCampaignId(id);
                setDrawerOpen(true);
              }}
              loading={loading}
            />
          </div>
        </section>

        {/* Queue Table */}
        <section>
          <QueueTable
            rows={queue}
            filters={filters}
            status={status}
            onStatusChange={setStatus}
            search={search}
            onSearchChange={setSearch}
            channel={channel}
            onChannelChange={setChannel}
            category={category}
            onCategoryChange={setCategory}
            sort={sort}
            onSortChange={setSort}
            selectedCampaignId={selectedCampaignId}
            onSelectCampaign={(id) => {
              setSelectedCampaignId(id);
              setDrawerOpen(true);
            }}
            loading={loading}
            error={error}
          />
        </section>
      </div>

      {/* Detail Drawer */}
      {selectedCampaign && (
        <CampaignDrawer
          campaignId={selectedCampaignId!}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
        />
      )}
    </div>
  );
}
