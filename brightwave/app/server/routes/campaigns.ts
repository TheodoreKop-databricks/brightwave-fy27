/**
 * Brightwave Campaign Desk REST routes (Layer 1 — Visualize).
 *
 * Reads the Build-1 managed `synced.*` tables (via server/db/queries/campaigns.ts)
 * and derives live "action taken" state from `app.campaign_actions_app`.
 */
import type { Application } from 'express';
import { sql } from 'drizzle-orm';
import type { AppDb } from '../db/index.js';
import {
  listQueue,
  scatter,
  kpis,
  campaignDetail,
  searchCreatives,
  type QueueStatus,
  type QueueSort,
} from '../db/queries/campaigns.js';

export function registerCampaignRoutes(app: Application, deps: { db: AppDb }): void {
  const { db } = deps;

  app.get('/api/campaigns/queue', async (req, res) => {
    const rows = await listQueue(db, {
      status: (req.query.status as QueueStatus) || 'all',
      search: (req.query.search as string) || null,
      channel: (req.query.channel as string) || null,
      category: (req.query.category as string) || null,
      sort: (req.query.sort as QueueSort) || 'recoverable',
    });
    res.json(rows);
  });

  app.get('/api/campaigns/scatter', async (_req, res) => {
    res.json(await scatter(db));
  });

  app.get('/api/campaigns/kpis', async (_req, res) => {
    res.json(await kpis(db));
  });

  // Distinct channels + categories for the filter chips.
  app.get('/api/campaigns/filters', async (_req, res) => {
    const ch = await db.execute(
      sql`SELECT DISTINCT channel FROM synced.campaign_position WHERE channel IS NOT NULL ORDER BY 1`,
    );
    const cat = await db.execute(
      sql`SELECT DISTINCT category FROM synced.campaign_position WHERE category IS NOT NULL ORDER BY 1`,
    );
    res.json({
      channels: (ch.rows as Record<string, unknown>[]).map((r) => r.channel as string),
      categories: (cat.rows as Record<string, unknown>[]).map((r) => r.category as string),
    });
  });

  // Creative search (Build-1 Lakebase Search / BM25). Placed before the :id
  // route is fine (distinct prefix), but keep it explicit.
  app.get('/api/creatives/search', async (req, res) => {
    const q = (req.query.q as string) || '';
    const limit = Math.min(Number(req.query.limit) || 5, 25);
    res.json(await searchCreatives(db, q, limit));
  });

  app.get('/api/campaigns/:id', async (req, res) => {
    const detail = await campaignDetail(db, req.params.id);
    if (!detail) {
      res.status(404).json({ error: `campaign ${req.params.id} not found` });
      return;
    }
    res.json(detail);
  });
}
