import type { Application } from 'express';
import { resetWritableTables } from '../db/sync.js';
import type { AppDb } from '../db/index.js';

/**
 * Demo-only admin routes. /api/admin/reset wipes the app-owned WRITABLE tables
 * (chat state + campaign_actions_app + workflow_events) — click it between
 * demos to start clean. The read-only `synced.*` mirrors are managed Lakebase
 * Synced Tables (Build 1) and are never touched here.
 */
export function registerAdminRoutes(
  app: Application,
  // `data` is accepted for call-site compatibility but unused — there is no
  // Delta re-mirror in Build 2 (synced.* is managed).
  deps: { db: AppDb; data?: unknown },
): void {
  const { db } = deps;
  app.post('/api/admin/reset', async (_req, res) => {
    await resetWritableTables(db);
    res.json({ ok: true });
  });
}
