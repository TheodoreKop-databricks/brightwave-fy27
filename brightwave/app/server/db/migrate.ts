import { sql } from 'drizzle-orm';
import type { AppDb } from './index.js';

/**
 * Ensure the app's writable `app.*` schema exists — idempotent Lakebase DDL,
 * NO ORM migrator.
 *
 * Build 1 already provisions the Lakebase `app` schema + its base tables, and
 * this app owns `app.*` (adding `workflow_events`). We deliberately do NOT run
 * drizzle-kit migrations: the migrator writes a journal into a `drizzle` schema
 * that, on this shared Lakebase, the app service principal can't create objects
 * in — so it 42501'd on boot even though every table already existed. Instead we
 * just run `CREATE ... IF NOT EXISTS` for each app table on every boot: safe,
 * idempotent, creates only what's missing (e.g. `workflow_events` on a DB that
 * predates it), never drops or rewrites existing data.
 *
 * Drizzle is still the query ORM — `server/db/schema.ts` remains the typed
 * source of truth; the DDL here mirrors it. When the app needs a new table or
 * column, add it to schema.ts AND to the idempotent DDL below (or ALTER it in
 * Lakebase directly). The function name is kept (`runMigrations`) so the boot
 * sequence in server.ts is unchanged.
 */
export async function runMigrations(db: AppDb): Promise<void> {
  // Schema — no-op if it exists (the SP has CREATE ON DATABASE).
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS app`);

  // Chat state.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email text NOT NULL,
      title text NOT NULL,
      kind text NOT NULL DEFAULT 'default',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS conversations_user_idx ON app.conversations (user_email, updated_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS conversations_kind_idx ON app.conversations (user_email, kind)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      position integer NOT NULL,
      trace_id text,
      thinking jsonb NOT NULL DEFAULT '[]'::jsonb,
      error text,
      canceled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  // Unique (conversation_id, position) — turns the SELECT MAX(position)+1 race
  // in appendMessage into a 23505 the caller retries (see schema.ts).
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS messages_convo_pos_uq ON app.messages (conversation_id, position)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.feedback (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id uuid NOT NULL REFERENCES app.messages(id) ON DELETE CASCADE,
      user_email text NOT NULL,
      value text NOT NULL,
      rationale text,
      trace_id text,
      mlflow_assessment_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS feedback_message_idx ON app.feedback (message_id)`);

  // Writable operational table (the Act layer's target).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.campaign_actions_app (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id text NOT NULL,
      action_type text NOT NULL,
      target_campaign_id text,
      drafted_brief text,
      predicted_roas_lift double precision,
      status text NOT NULL DEFAULT 'proposed',
      approved_by text,
      audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS campaign_actions_campaign_idx ON app.campaign_actions_app (campaign_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS campaign_actions_created_idx ON app.campaign_actions_app (created_at)`);

  // Observability / state table (Build-2 challenge).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app.workflow_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor text,
      campaign_id text,
      action_id uuid,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS workflow_events_type_idx ON app.workflow_events (event_type, occurred_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS workflow_events_campaign_idx ON app.workflow_events (campaign_id)`);

  // REPLICA IDENTITY FULL for the Build-1 schema-level CDF on `app`. Tolerant:
  // on the deployed SP a table may be owned by the dev user (already set FULL),
  // and ALTER requires ownership — a failure is benign, so log + continue.
  for (const t of ['conversations', 'messages', 'feedback', 'campaign_actions_app', 'workflow_events']) {
    try {
      await db.execute(sql.raw(`ALTER TABLE app.${t} REPLICA IDENTITY FULL`));
    } catch (e) {
      console.warn(
        `[schema] REPLICA IDENTITY FULL on app.${t} skipped (${(e as Error).message.split('\n')[0]})`,
      );
    }
  }
}
