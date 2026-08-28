-- ============================================================================
-- BUILD 1 — Modeled operational schema (Lakebase Postgres, schema "app")
-- ============================================================================
-- This is the WRITABLE operational schema, distinct from the read-only
-- synced.* Unity Catalog mirror. It models the Campaign Desk domain as related
-- tables with primary keys and foreign keys:
--
--   conversations 1───* messages 1───* feedback          (chat/assist domain)
--   campaign_actions_app 1───* workflow_events           (action/decision domain)
--   creatives_search                                     (searchable creative catalog)
--
-- Reproducible DDL for brightwave-campaign-desk / brightwave_lakebase_tkop.
-- Matches the live production branch (verified via information_schema).

CREATE SCHEMA IF NOT EXISTS app;

-- ── Action / decision domain ────────────────────────────────────────────────

-- Agent-proposed → approved → committed campaign actions (the write-back target).
CREATE TABLE IF NOT EXISTS app.campaign_actions_app (
  id                  uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         text                     NOT NULL,
  action_type         text                     NOT NULL,          -- replicate_winner / reallocate_budget / pause
  target_campaign_id  text,
  drafted_brief       text,
  predicted_roas_lift double precision,
  status              text                     NOT NULL DEFAULT 'proposed',
  approved_by         text,
  audit_trail         jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz              NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  priority_score      double precision                            -- added by the coding agent on dev-tkop, promoted to prod
);

-- Append-only event log: scoring triggers + human decisions.
CREATE TABLE IF NOT EXISTS app.workflow_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text        NOT NULL,                              -- scoring_trigger / decision
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        text,                                             -- system:job or a user email
  campaign_id  text,
  action_id    uuid,                                             -- FK → campaign_actions_app.id
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_workflow_events_action
    FOREIGN KEY (action_id) REFERENCES app.campaign_actions_app(id)
);

-- ── Chat / assist domain ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app.conversations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text        NOT NULL,
  title      text        NOT NULL,
  kind       text        NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL,                           -- FK → conversations.id
  role            text        NOT NULL,
  content         text        NOT NULL,
  position        integer     NOT NULL,
  trace_id        text,
  thinking        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error           text,
  canceled        boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES app.conversations(id)
);

CREATE TABLE IF NOT EXISTS app.feedback (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id           uuid        NOT NULL,                      -- FK → messages.id
  user_email           text        NOT NULL,
  value                text        NOT NULL,
  rationale            text,
  trace_id             text,
  mlflow_assessment_id text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_feedback_message
    FOREIGN KEY (message_id) REFERENCES app.messages(id)
);

-- ── Searchable creative catalog (seeded from read-only synced.creatives) ──────
CREATE TABLE IF NOT EXISTS app.creatives_search (
  creative_id    text PRIMARY KEY,
  creative_name  text,
  creative_type  text,
  angle          text,
  description    text,
  search_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('english',
                   coalesce(description,'') || ' ' || coalesce(creative_name,'') || ' ' || coalesce(angle,''))) STORED,
  description_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(description,''))) STORED
);

-- Lakebase Search — BM25 full-text index (extension: lakebase_text).
CREATE INDEX IF NOT EXISTS creatives_search_bm25
  ON app.creatives_search USING lakebase_bm25 (search_tsv);
-- Hybrid half (vector ANN) is added in search_hybrid.sql.
