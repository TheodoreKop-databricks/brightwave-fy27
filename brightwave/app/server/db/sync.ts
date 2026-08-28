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
  // DELETE (not TRUNCATE): the app SP has DELETE granted on app.*, but TRUNCATE
  // requires table ownership (which the SP lacks on this shared Lakebase). FK
  // order: feedback → messages → conversations; the two action tables stand alone.
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM app.feedback`);
    await tx.execute(sql`DELETE FROM app.messages`);
    await tx.execute(sql`DELETE FROM app.conversations`);
    await tx.execute(sql`DELETE FROM app.campaign_actions_app`);
    await tx.execute(
      sql`DO $$ BEGIN IF to_regclass('app.workflow_events') IS NOT NULL THEN DELETE FROM app.workflow_events; END IF; END $$;`,
    );
  });
}
