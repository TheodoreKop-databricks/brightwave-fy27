/**
 * REST helpers for the Brightwave Campaign Desk domain.
 * Fetch wrappers for KPIs, scatter, queue, filters, campaign detail, and creative search.
 */
import { okOrThrow } from './api';
import type {
  DeskKpis,
  ScatterPoint,
  QueueRow,
  CampaignFilters,
  CampaignDetail,
  CreativeHit,
} from '@/shared/types';

export async function fetchKpis(): Promise<DeskKpis> {
  const res = await okOrThrow(
    await fetch('/api/campaigns/kpis'),
    '/api/campaigns/kpis',
  );
  return res.json();
}

export async function fetchScatter(): Promise<ScatterPoint[]> {
  const res = await okOrThrow(
    await fetch('/api/campaigns/scatter'),
    '/api/campaigns/scatter',
  );
  return res.json();
}

export async function fetchQueue(filters: {
  status?: 'all' | 'underperformers' | 'has_winner' | 'no_match' | 'action_taken';
  search?: string;
  channel?: string;
  category?: string;
  sort?: 'recoverable' | 'roas' | 'spend';
} = {}): Promise<QueueRow[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.search) qs.set('search', filters.search);
  if (filters.channel) qs.set('channel', filters.channel);
  if (filters.category) qs.set('category', filters.category);
  if (filters.sort) qs.set('sort', filters.sort);
  const res = await okOrThrow(
    await fetch(`/api/campaigns/queue?${qs}`),
    '/api/campaigns/queue',
  );
  return res.json();
}

export async function fetchFilters(): Promise<CampaignFilters> {
  const res = await okOrThrow(
    await fetch('/api/campaigns/filters'),
    '/api/campaigns/filters',
  );
  return res.json();
}

export async function fetchCampaignDetail(campaignId: string): Promise<CampaignDetail> {
  const res = await okOrThrow(
    await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`),
    `/api/campaigns/${campaignId}`,
  );
  return res.json();
}

export async function searchCreatives(
  q: string,
  limit = 10,
): Promise<CreativeHit[]> {
  const qs = new URLSearchParams();
  qs.set('q', q);
  qs.set('limit', String(limit));
  const res = await okOrThrow(
    await fetch(`/api/creatives/search?${qs}`),
    '/api/creatives/search',
  );
  return res.json();
}
