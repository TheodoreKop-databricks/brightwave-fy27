import {
  text,
  timestamp,
  uuid,
  integer,
  doublePrecision,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*` — Brightwave Campaign Desk.
 *
 * Three groups (this is the Build-1 answer key: synced READ-ONLY mirrors +
 * ONE writable operational table):
 *   1. Chat state      (conversations, messages, feedback) — REUSE AS-IS.
 *                      Every use case has chat. The `thinking` + `error`
 *                      jsonb/text columns on `messages` make conversations
 *                      reload-safe with full reasoning trails preserved.
 *   2. Synced mirror   (campaign_position, open_underperformers,
 *                      action_recommendations, creatives) — READ-ONLY copies
 *                      of the Gold/raw Delta tables that `db/sync.ts` pulls
 *                      at boot. In production these are Lakebase Synced Tables
 *                      (the manual sync is the demo stand-in). The app SELECTs
 *                      from them for sub-ms per-campaign reads; never writes.
 *   3. Write-surface   `campaign_actions_app` — the ONLY table the app writes. A
 *                      UC synced table is read-only in Postgres, so the
 *                      Act layer records approved actions here. Append-only
 *                      `audit_trail` JSONB makes each action row a standalone
 *                      timeline the drawer Activity tab renders.
 *
 * Why Lakebase: transactional Postgres semantics sitting next to the
 * lakehouse, with Unity Catalog governance. Lets the app do real
 * transactional writes while the analytics layer still queries Delta.
 */
export const appSchema = pgSchema('app');

// NOTE: the READ-ONLY managed synced tables (`synced.campaign_position`,
// `open_underperformers`, `action_recommendations`, `creatives`) live in
// `./synced-schema.ts` — deliberately NOT in this file, because this file is
// the ONLY one `drizzle.config.ts` points at and drizzle-kit `generate` would
// otherwise emit CREATE/INDEX DDL for those managed tables (which the app has
// no privilege to touch). Import them from `./synced-schema.js` for queries.

// ============================================================================
// Chat state
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    // 'default' for regular chats, 'demo_dock' for the floating dock's
    // persistent conversation (one per user).
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    // Captured reasoning steps (tool calls, outputs, intermediate messages)
    // for assistant messages. Shape matches client's ThinkingEvent union.
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    // If the agent run failed, the error message is persisted here so a
    // page reload still shows what went wrong (instead of an empty bubble).
    error: text('error'),
    // True when the turn was stopped by the user (Stop button or page
    // navigation away from an in-flight stream). The assistant's partial
    // streamed content is still kept in `content` for context; the UI
    // renders a "Canceled by the user" banner below it.
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Unique on (conversation_id, position) so the `SELECT MAX + 1` race in
    // appendMessage surfaces as a constraint error (caller retries) instead
    // of silently inserting two messages at the same position — which
    // would break the on-reload ordering. Doubles as the lookup index.
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Writable operational table (the app writes here — Build-1 writable table)
//
// `campaign_actions_app` is the ONLY table the app writes. An approved campaign
// action (action + drafted brief) inserts/updates a row here. The Campaign Desk
// derives a campaign's live state by LEFT JOIN-ing `campaign_position` → its
// latest `campaign_actions_app` row (so "action taken" status comes from the
// writable table, and the read-only synced position is never mutated). The
// append-only `audit_trail` makes each row a standalone timeline for the drawer
// Activity tab.
// ============================================================================

export const campaignActions = appSchema.table(
  'campaign_actions_app',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: text('campaign_id').notNull(),
    // replicate_winner / reallocate_budget / pause
    actionType: text('action_type', {
      enum: ['replicate_winner', 'reallocate_budget', 'pause'],
    }).notNull(),
    // The winner replicated or the reallocation target (nullable — for pause).
    targetCampaignId: text('target_campaign_id'),
    // The campaign brief the agent drafted.
    draftedBrief: text('drafted_brief'),
    predictedRoasLift: doublePrecision('predicted_roas_lift'),
    // proposed / approved / executed / overridden
    status: text('status', {
      enum: ['proposed', 'approved', 'executed', 'overridden'],
    })
      .notNull()
      .default('proposed'),
    // OBO-stamped viewing user's email.
    approvedBy: text('approved_by'),
    // Append-only audit trail. Each entry: { at, by, action, notes?, tool? }
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('campaign_actions_campaign_idx').on(t.campaignId),
    index('campaign_actions_created_idx').on(t.createdAt),
  ],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

// `ActionOption` (the ML ranked-action shape) lives in ./synced-schema.ts
// alongside the `action_recommendations` table that carries it.

export type AuditEntry = {
  at: string;
  by: string;
  action:
    | 'proposed'
    | 'approved'
    | 'executed'
    | 'declined'
    | 'note'
    | 'rejected'
    | 'escalated'
    | 'email_sent';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
