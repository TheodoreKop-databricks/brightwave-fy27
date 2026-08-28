import { sql } from 'drizzle-orm';
import type { AppDb } from './index.js';

/**
 * Brightwave Campaign Desk — writable-state reset.
 *
 * > Build 2 change: the read-only mirrors are now Build-1 **managed Lakebase
 * > Synced Tables** in the `synced` schema (already ONLINE with data). The app
 * > SELECTs from `synced.*` and NEVER writes them (the app SP is granted
 * > SELECT only), so there is NO boot-time Delta→Lakebase mirror anymore — the
 * > managed sync (refreshed by the table-update Job) owns their contents.
 *
 * The app writes ONLY `app.*`. "Reset demo" therefore truncates the app's own
 * writable tables (chat state + the action/audit table + workflow_events) so
 * campaigns return to their original synced position with every agent write
 * wiped — the synced.* mirrors are untouched (and cannot be truncated anyway).
 */
export async function resetWritableTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.campaign_actions_app RESTART IDENTITY CASCADE`);
    // workflow_events (added in Layer 1) — truncate if present so a reset also
    // clears the observability trail. IF EXISTS keeps this safe pre-Layer-1.
    await tx.execute(
      sql`DO $$ BEGIN IF to_regclass('app.workflow_events') IS NOT NULL THEN TRUNCATE TABLE app.workflow_events RESTART IDENTITY CASCADE; END IF; END $$;`,
    );
  });
}
