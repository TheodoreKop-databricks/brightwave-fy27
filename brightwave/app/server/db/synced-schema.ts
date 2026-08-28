import {
  text,
  timestamp,
  doublePrecision,
  jsonb,
  pgSchema,
  index,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Build-1 managed synced schema, `synced.*` — READ-ONLY from the app.
 *
 * These are Lakebase Synced Tables (managed continuous/triggered Delta→Lakebase
 * replication with UC governance), already ONLINE with data. The app SELECTs
 * from them and NEVER writes them (the app SP is granted SELECT only). There is
 * NO boot-time Delta→Lakebase mirror — the managed sync owns their contents; a
 * Databricks table-update Job refreshes them (Layer 1).
 *
 * IMPORTANT — this file is DELIBERATELY separate from `schema.ts`, which is the
 * ONLY file `drizzle.config.ts` points at. drizzle-kit `generate` emits DDL for
 * every table it sees, and its `schemaFilter` does NOT apply to `generate` — so
 * keeping these managed tables out of the migration source is what prevents
 * runMigrations() from trying to CREATE (or index) the read-only managed tables
 * it has no privilege to touch. They live here purely for query typing.
 */
export const syncedSchema = pgSchema('synced');

// `gold_campaign_position` — one row per campaign. The Campaign Desk reads
// this for live position + performance band data.
export const campaignPosition = syncedSchema.table(
  'campaign_position',
  {
    id: text('id').primaryKey(), // campaign_id
    campaignId: text('campaign_id').notNull(),
    campaignName: text('campaign_name'),
    channel: text('channel'),
    category: text('category'),
    targetSegment: text('target_segment'),
    creativeId: text('creative_id'),
    campaignSummary: text('campaign_summary'),
    status: text('status'),
    roas: doublePrecision('roas'),
    spendToDateUsd: doublePrecision('spend_to_date_usd'),
    attributedRevenueUsd: doublePrecision('attributed_revenue_usd'),
    perfSignal: text('perf_signal'),
    recoverableSpendUsd: doublePrecision('recoverable_spend_usd'),
    // winner / underperformer / steady / paused
    perfBand: text('perf_band', {
      enum: ['winner', 'underperformer', 'steady', 'paused'],
    }),
  },
  (t) => [
    index('campaign_position_band_idx').on(t.perfBand),
    index('campaign_position_id_idx').on(t.campaignId),
  ],
);

// `gold_open_underperformers` — underperformers + candidate winners.
export const openUnderperformers = syncedSchema.table(
  'open_underperformers',
  {
    id: text('id').primaryKey(), // campaign_id
    campaignId: text('campaign_id').notNull(),
    channel: text('channel'),
    category: text('category'),
    targetSegment: text('target_segment'),
    roas: doublePrecision('roas'),
    recoverableSpendUsd: doublePrecision('recoverable_spend_usd'),
    spendToDateUsd: doublePrecision('spend_to_date_usd'),
    hasMatchingWinner: boolean('has_matching_winner'),
    matchingWinnerCampaignId: text('matching_winner_campaign_id'),
    matchingWinnerRoas: doublePrecision('matching_winner_roas'),
    reallocateTargetCampaignId: text('reallocate_target_campaign_id'),
  },
  (t) => [index('open_underperformers_campaign_idx').on(t.campaignId)],
);

// Read-only mirror of the ML model's batch recommendations
// (`gold_action_recommendations`). The agent's `rank_actions` tool reads this.
export const actionRecommendations = syncedSchema.table(
  'action_recommendations',
  {
    id: text('id').primaryKey(), // campaign_id
    campaignId: text('campaign_id').notNull(),
    recommendedAction: text('recommended_action', {
      enum: ['replicate_winner', 'reallocate_budget', 'pause'],
    }),
    predictedRoasLift: doublePrecision('predicted_roas_lift'),
    predictedNetValueUsd: doublePrecision('predicted_net_value_usd'),
    // All three options with predicted ROAS lift + net value.
    actionRanking: jsonb('action_ranking').$type<ActionOption[]>().notNull().default([]),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
  },
  (t) => [index('recommendations_campaign_idx').on(t.campaignId)],
);

// `raw_creatives` — campaign creative catalog (name + description).
// Searchable `description` is indexed by Lakebase Search for `search_creatives`.
export const creatives = syncedSchema.table(
  'creatives',
  {
    id: text('id').primaryKey(), // creative_id
    creativeId: text('creative_id').notNull(),
    creativeName: text('creative_name'),
    creativeType: text('creative_type'),
    angle: text('angle'),
    // Searchable description (indexed by Lakebase Search).
    description: text('description'),
    isActive: boolean('is_active'),
  },
  (t) => [index('creatives_type_idx').on(t.creativeType)],
);

/** One option in the ML model's ranked action list (on
 *  `action_recommendations.action_ranking`). */
export type ActionOption = {
  actionType: 'replicate_winner' | 'reallocate_budget' | 'pause';
  predictedRoasLift: number;
  predictedNetValueUsd: number;
};
