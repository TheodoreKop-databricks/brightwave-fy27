/**
 * Brightwave campaign queries — reads hit the Build-1 managed `synced.*` tables;
 * the only write target is `app.campaign_actions_app` (+ `app.workflow_events`).
 *
 * Layer 1 (Visualize): queue / scatter / KPIs / detail / creative-search reads.
 * Layer 2 (Assist): getCampaign / getUnderperformer / worstUnderperformer /
 *   getRecommendation / searchCreatives are the agent-tool read helpers.
 * Layer 3 (Act): recordCampaignAction writes the approved action + a decision event.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { ActionOption } from '../synced-schema.js';

// ── Shared row shapes (mirrored in client/src/shared/types.ts) ───────────────

export type PerfBand = 'winner' | 'underperformer' | 'steady' | 'paused';
export type ActionType = 'replicate_winner' | 'reallocate_budget' | 'pause';

export type QueueRow = {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  category: string | null;
  targetSegment: string | null;
  roas: number | null;
  spendToDateUsd: number | null;
  recoverableSpendUsd: number | null;
  perfBand: PerfBand | null;
  hasMatchingWinner: boolean | null;
  matchingWinnerCampaignId: string | null;
  matchingWinnerRoas: number | null;
  recommendedAction: ActionType | null;
  predictedRoasLift: number | null;
  // Derived from the latest app.campaign_actions_app row (null = no action yet).
  actionStatus: string | null;
  actionTakenType: ActionType | null;
};

export type ScatterPoint = {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  roas: number | null;
  spendToDateUsd: number | null;
  perfBand: PerfBand | null;
  hasAction: boolean;
};

export type DeskKpis = {
  recoverableSpendUsd: number;
  underperformerCount: number;
  underperformerCountOpen: number; // still without an action
  avgWinnerRoas: number | null;
  avgUnderperformerRoas: number | null;
};

export type MatchingWinner = {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  category: string | null;
  roas: number | null;
  creativeId: string | null;
  creativeName: string | null;
  creativeType: string | null;
  angle: string | null;
  description: string | null;
};

export type CampaignActionRow = {
  id: string;
  actionType: ActionType;
  targetCampaignId: string | null;
  draftedBrief: string | null;
  predictedRoasLift: number | null;
  status: string;
  approvedBy: string | null;
  auditTrail: Array<{ at: string; by: string; action: string; notes?: string; tool?: string }>;
  createdAt: string;
  decidedAt: string | null;
};

export type CampaignDetail = {
  campaign: QueueRow & {
    campaignSummary: string | null;
    attributedRevenueUsd: number | null;
    creativeId: string | null;
    status: string | null;
  };
  matchingWinner: MatchingWinner | null;
  rankedActions: ActionOption[];
  recommendedAction: ActionType | null;
  predictedNetValueUsd: number | null;
  latestAction: CampaignActionRow | null;
  activity: Array<{ at: string; by: string; action: string; notes?: string; tool?: string; kind: string }>;
};

export type CreativeHit = {
  creativeId: string;
  creativeName: string | null;
  creativeType: string | null;
  angle: string | null;
  description: string | null;
  score: number | null;
};

// ── Queue filters ────────────────────────────────────────────────────────────

export type QueueStatus = 'all' | 'underperformers' | 'has_winner' | 'no_match' | 'action_taken';
export type QueueSort = 'recoverable' | 'roas' | 'spend';

export type QueueFilters = {
  status?: QueueStatus;
  search?: string | null;
  channel?: string | null;
  category?: string | null;
  sort?: QueueSort;
  limit?: number;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * `synced.action_recommendations.action_ranking` is a TEXT column holding a
 * JSON array with snake_case keys, e.g.
 *   [{"action":"replicate_winner","predicted_roas_lift":2.23,"predicted_net_value_usd":415985.59,"action_cost_usd":2000.0}, …]
 * Parse it (it may already be an array/obj if the driver hands back jsonb) and
 * map to the camelCase ActionOption shape the UI + agent consume.
 */
function parseActionRanking(raw: unknown): ActionOption[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((o) => {
      const r = o as Record<string, unknown>;
      const at = (r.actionType ?? r.action) as ActionType | undefined;
      if (!at) return null;
      return {
        actionType: at,
        predictedRoasLift: Number(r.predictedRoasLift ?? r.predicted_roas_lift ?? 0),
        predictedNetValueUsd: Number(r.predictedNetValueUsd ?? r.predicted_net_value_usd ?? 0),
        actionCostUsd:
          r.actionCostUsd ?? r.action_cost_usd ?? null
            ? Number(r.actionCostUsd ?? r.action_cost_usd)
            : null,
      } as ActionOption;
    })
    .filter((x): x is ActionOption => x !== null);
}

/**
 * The underperformer queue: all campaigns joined to their matching winner
 * (open_underperformers), model recommendation (action_recommendations) and the
 * latest recorded action (campaign_actions_app → "action taken"). Filter/sort
 * server-side so the table stays snappy.
 */
export async function listQueue(db: AppDb, f: QueueFilters = {}): Promise<QueueRow[]> {
  const status = f.status ?? 'all';
  const sort = f.sort ?? 'recoverable';
  const limit = f.limit ?? 500;
  const search = f.search?.trim() ? `%${f.search.trim().toLowerCase()}%` : null;

  const orderCol =
    sort === 'roas'
      ? sql`cp.roas ASC NULLS LAST`
      : sort === 'spend'
        ? sql`cp.spend_to_date_usd DESC NULLS LAST`
        : sql`cp.recoverable_spend_usd DESC NULLS LAST`;

  const statusFilter =
    status === 'underperformers'
      ? sql`AND cp.perf_band = 'underperformer'`
      : status === 'has_winner'
        ? sql`AND cp.perf_band = 'underperformer' AND ou.has_matching_winner IS TRUE`
        : status === 'no_match'
          ? sql`AND cp.perf_band = 'underperformer' AND COALESCE(ou.has_matching_winner, false) = false`
          : status === 'action_taken'
            ? sql`AND act.status IS NOT NULL`
            : sql``;

  const searchFilter = search
    ? sql`AND (lower(cp.campaign_id) LIKE ${search} OR lower(cp.campaign_name) LIKE ${search} OR lower(cp.category) LIKE ${search})`
    : sql``;
  const channelFilter = f.channel ? sql`AND cp.channel = ${f.channel}` : sql``;
  const categoryFilter = f.category ? sql`AND cp.category = ${f.category}` : sql``;

  const rows = await db.execute(sql`
    SELECT
      cp.campaign_id, cp.campaign_name, cp.channel, cp.category, cp.target_segment,
      cp.roas, cp.spend_to_date_usd, cp.recoverable_spend_usd, cp.perf_band,
      ou.has_matching_winner, ou.matching_winner_campaign_id, ou.matching_winner_roas,
      ar.recommended_action, ar.predicted_roas_lift,
      act.status AS action_status, act.action_type AS action_taken_type
    FROM synced.campaign_position cp
    LEFT JOIN synced.open_underperformers ou ON ou.campaign_id = cp.campaign_id
    LEFT JOIN synced.action_recommendations ar ON ar.campaign_id = cp.campaign_id
    LEFT JOIN LATERAL (
      SELECT ca.status, ca.action_type
      FROM app.campaign_actions_app ca
      WHERE ca.campaign_id = cp.campaign_id
      ORDER BY ca.created_at DESC
      LIMIT 1
    ) act ON true
    WHERE 1=1 ${statusFilter} ${searchFilter} ${channelFilter} ${categoryFilter}
    ORDER BY ${orderCol}
    LIMIT ${limit}
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    campaignId: r.campaign_id as string,
    campaignName: (r.campaign_name as string) ?? null,
    channel: (r.channel as string) ?? null,
    category: (r.category as string) ?? null,
    targetSegment: (r.target_segment as string) ?? null,
    roas: num(r.roas),
    spendToDateUsd: num(r.spend_to_date_usd),
    recoverableSpendUsd: num(r.recoverable_spend_usd),
    perfBand: (r.perf_band as PerfBand) ?? null,
    hasMatchingWinner: (r.has_matching_winner as boolean) ?? null,
    matchingWinnerCampaignId: (r.matching_winner_campaign_id as string) ?? null,
    matchingWinnerRoas: num(r.matching_winner_roas),
    recommendedAction: (r.recommended_action as ActionType) ?? null,
    predictedRoasLift: num(r.predicted_roas_lift),
    actionStatus: (r.action_status as string) ?? null,
    actionTakenType: (r.action_taken_type as ActionType) ?? null,
  }));
}

/** All campaigns as scatter points (x=spend, y=roas, color=perf_band). */
export async function scatter(db: AppDb): Promise<ScatterPoint[]> {
  const rows = await db.execute(sql`
    SELECT cp.campaign_id, cp.campaign_name, cp.channel, cp.roas, cp.spend_to_date_usd, cp.perf_band,
           EXISTS (SELECT 1 FROM app.campaign_actions_app ca WHERE ca.campaign_id = cp.campaign_id) AS has_action
    FROM synced.campaign_position cp
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    campaignId: r.campaign_id as string,
    campaignName: (r.campaign_name as string) ?? null,
    channel: (r.channel as string) ?? null,
    roas: num(r.roas),
    spendToDateUsd: num(r.spend_to_date_usd),
    perfBand: (r.perf_band as PerfBand) ?? null,
    hasAction: Boolean(r.has_action),
  }));
}

/** The 3 KPI cards: recoverable spend (open underperformers), underperformer
 *  count (open), ROAS gap (winner avg vs underperformer avg). */
export async function kpis(db: AppDb): Promise<DeskKpis> {
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (campaign_id) campaign_id, status
      FROM app.campaign_actions_app
      ORDER BY campaign_id, created_at DESC
    )
    SELECT
      COALESCE(SUM(cp.recoverable_spend_usd) FILTER (
        WHERE cp.perf_band = 'underperformer' AND l.campaign_id IS NULL), 0) AS recoverable_open,
      COUNT(*) FILTER (WHERE cp.perf_band = 'underperformer') AS underperformer_count,
      COUNT(*) FILTER (WHERE cp.perf_band = 'underperformer' AND l.campaign_id IS NULL) AS underperformer_open,
      AVG(cp.roas) FILTER (WHERE cp.perf_band = 'winner') AS avg_winner_roas,
      AVG(cp.roas) FILTER (WHERE cp.perf_band = 'underperformer') AS avg_underperformer_roas
    FROM synced.campaign_position cp
    LEFT JOIN latest l ON l.campaign_id = cp.campaign_id
  `);
  const r = (rows.rows as Record<string, unknown>[])[0] ?? {};
  return {
    recoverableSpendUsd: Number(r.recoverable_open ?? 0),
    underperformerCount: Number(r.underperformer_count ?? 0),
    underperformerCountOpen: Number(r.underperformer_open ?? 0),
    avgWinnerRoas: num(r.avg_winner_roas),
    avgUnderperformerRoas: num(r.avg_underperformer_roas),
  };
}

/** Full drawer detail: campaign + matching winner (with its creative) + ranked
 *  actions + latest recorded action + merged activity timeline. */
export async function campaignDetail(db: AppDb, campaignId: string): Promise<CampaignDetail | null> {
  const cpRows = await db.execute(sql`
    SELECT cp.*, ou.has_matching_winner, ou.matching_winner_campaign_id, ou.matching_winner_roas,
           ar.recommended_action, ar.predicted_roas_lift, ar.predicted_net_value_usd, ar.action_ranking
    FROM synced.campaign_position cp
    LEFT JOIN synced.open_underperformers ou ON ou.campaign_id = cp.campaign_id
    LEFT JOIN synced.action_recommendations ar ON ar.campaign_id = cp.campaign_id
    WHERE cp.campaign_id = ${campaignId}
    LIMIT 1
  `);
  const c = (cpRows.rows as Record<string, unknown>[])[0];
  if (!c) return null;

  // Matching winner (+ its creative) if any.
  let matchingWinner: MatchingWinner | null = null;
  if (c.matching_winner_campaign_id) {
    const wRows = await db.execute(sql`
      SELECT w.campaign_id, w.campaign_name, w.channel, w.category, w.roas, w.creative_id,
             cr.creative_name, cr.creative_type, cr.angle, cr.description
      FROM synced.campaign_position w
      LEFT JOIN synced.creatives cr ON cr.creative_id = w.creative_id
      WHERE w.campaign_id = ${c.matching_winner_campaign_id as string}
      LIMIT 1
    `);
    const w = (wRows.rows as Record<string, unknown>[])[0];
    if (w) {
      matchingWinner = {
        campaignId: w.campaign_id as string,
        campaignName: (w.campaign_name as string) ?? null,
        channel: (w.channel as string) ?? null,
        category: (w.category as string) ?? null,
        roas: num(w.roas),
        creativeId: (w.creative_id as string) ?? null,
        creativeName: (w.creative_name as string) ?? null,
        creativeType: (w.creative_type as string) ?? null,
        angle: (w.angle as string) ?? null,
        description: (w.description as string) ?? null,
      };
    }
  }

  // All recorded actions for this campaign (for the activity timeline).
  const actRows = await db.execute(sql`
    SELECT id, action_type, target_campaign_id, drafted_brief, predicted_roas_lift,
           status, approved_by, audit_trail, created_at, decided_at
    FROM app.campaign_actions_app
    WHERE campaign_id = ${campaignId}
    ORDER BY created_at DESC
  `);
  const actions = (actRows.rows as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    actionType: a.action_type as ActionType,
    targetCampaignId: (a.target_campaign_id as string) ?? null,
    draftedBrief: (a.drafted_brief as string) ?? null,
    predictedRoasLift: num(a.predicted_roas_lift),
    status: a.status as string,
    approvedBy: (a.approved_by as string) ?? null,
    auditTrail: (a.audit_trail as CampaignActionRow['auditTrail']) ?? [],
    createdAt: String(a.created_at),
    decidedAt: a.decided_at ? String(a.decided_at) : null,
  }));

  const activity = actions.flatMap((a) =>
    (a.auditTrail ?? []).map((e) => ({ ...e, kind: 'audit' })),
  );

  const ranking = parseActionRanking(c.action_ranking);

  return {
    campaign: {
      campaignId: c.campaign_id as string,
      campaignName: (c.campaign_name as string) ?? null,
      channel: (c.channel as string) ?? null,
      category: (c.category as string) ?? null,
      targetSegment: (c.target_segment as string) ?? null,
      roas: num(c.roas),
      spendToDateUsd: num(c.spend_to_date_usd),
      recoverableSpendUsd: num(c.recoverable_spend_usd),
      perfBand: (c.perf_band as PerfBand) ?? null,
      hasMatchingWinner: (c.has_matching_winner as boolean) ?? null,
      matchingWinnerCampaignId: (c.matching_winner_campaign_id as string) ?? null,
      matchingWinnerRoas: num(c.matching_winner_roas),
      recommendedAction: (c.recommended_action as ActionType) ?? null,
      predictedRoasLift: num(c.predicted_roas_lift),
      actionStatus: actions[0]?.status ?? null,
      actionTakenType: actions[0]?.actionType ?? null,
      campaignSummary: (c.campaign_summary as string) ?? null,
      attributedRevenueUsd: num(c.attributed_revenue_usd),
      creativeId: (c.creative_id as string) ?? null,
      status: (c.status as string) ?? null,
    },
    matchingWinner,
    rankedActions: ranking,
    recommendedAction: (c.recommended_action as ActionType) ?? null,
    predictedNetValueUsd: num(c.predicted_net_value_usd),
    latestAction: actions[0] ?? null,
    activity,
  };
}

// ── Creative search (Build-1 Lakebase Search over app.creatives_search, BM25) ──

/**
 * Full-text (BM25) creative search over the Build-1 Lakebase Search index
 * (`app.creatives_search` + `app.creatives_search_bm25`). Degrades gracefully:
 * if the index/table isn't present yet, returns [] (with a logged note) so the
 * UI + agent keep working.
 */
export async function searchCreatives(db: AppDb, query: string, limit = 5): Promise<CreativeHit[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const rows = await db.execute(sql`
      SELECT creative_id, creative_name, creative_type, angle, description,
             (search_tsv <@> to_bm25query(to_tsvector('english', ${q}), 'app.creatives_search_bm25'::regclass)) AS score
      FROM app.creatives_search
      ORDER BY search_tsv <@> to_bm25query(to_tsvector('english', ${q}), 'app.creatives_search_bm25'::regclass) ASC
      LIMIT ${limit}
    `);
    return (rows.rows as Record<string, unknown>[]).map((r) => ({
      creativeId: r.creative_id as string,
      creativeName: (r.creative_name as string) ?? null,
      creativeType: (r.creative_type as string) ?? null,
      angle: (r.angle as string) ?? null,
      description: (r.description as string) ?? null,
      score: num(r.score),
    }));
  } catch (e) {
    console.warn(
      `[search_creatives] Lakebase Search not available yet (app.creatives_search) — returning no hits: ${(e as Error).message}`,
    );
    return [];
  }
}

// ── Agent-tool read helpers (Layer 2) ─────────────────────────────────────────

export type Underperformer = {
  campaignId: string;
  channel: string | null;
  category: string | null;
  targetSegment: string | null;
  roas: number | null;
  recoverableSpendUsd: number | null;
  spendToDateUsd: number | null;
  hasMatchingWinner: boolean | null;
  matchingWinnerCampaignId: string | null;
  matchingWinnerRoas: number | null;
  reallocateTargetCampaignId: string | null;
};

export type CampaignRow = {
  campaignId: string;
  campaignName: string | null;
  channel: string | null;
  category: string | null;
  targetSegment: string | null;
  creativeId: string | null;
  roas: number | null;
  spendToDateUsd: number | null;
  attributedRevenueUsd: number | null;
  recoverableSpendUsd: number | null;
  perfBand: PerfBand | null;
};

export type ActionRecommendation = {
  campaignId: string;
  recommendedAction: ActionType | null;
  predictedRoasLift: number | null;
  predictedNetValueUsd: number | null;
  actionRanking: ActionOption[];
};

export async function getCampaign(db: AppDb, campaignId: string): Promise<CampaignRow | null> {
  const rows = await db.execute(sql`
    SELECT campaign_id, campaign_name, channel, category, target_segment, creative_id,
           roas, spend_to_date_usd, attributed_revenue_usd, recoverable_spend_usd, perf_band
    FROM synced.campaign_position WHERE campaign_id = ${campaignId} LIMIT 1
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    campaignId: r.campaign_id as string,
    campaignName: (r.campaign_name as string) ?? null,
    channel: (r.channel as string) ?? null,
    category: (r.category as string) ?? null,
    targetSegment: (r.target_segment as string) ?? null,
    creativeId: (r.creative_id as string) ?? null,
    roas: num(r.roas),
    spendToDateUsd: num(r.spend_to_date_usd),
    attributedRevenueUsd: num(r.attributed_revenue_usd),
    recoverableSpendUsd: num(r.recoverable_spend_usd),
    perfBand: (r.perf_band as PerfBand) ?? null,
  };
}

function mapUnderperformer(r: Record<string, unknown>): Underperformer {
  return {
    campaignId: r.campaign_id as string,
    channel: (r.channel as string) ?? null,
    category: (r.category as string) ?? null,
    targetSegment: (r.target_segment as string) ?? null,
    roas: num(r.roas),
    recoverableSpendUsd: num(r.recoverable_spend_usd),
    spendToDateUsd: num(r.spend_to_date_usd),
    hasMatchingWinner: (r.has_matching_winner as boolean) ?? null,
    matchingWinnerCampaignId: (r.matching_winner_campaign_id as string) ?? null,
    matchingWinnerRoas: num(r.matching_winner_roas),
    reallocateTargetCampaignId: (r.reallocate_target_campaign_id as string) ?? null,
  };
}

export async function getUnderperformer(db: AppDb, campaignId: string): Promise<Underperformer | null> {
  const rows = await db.execute(sql`
    SELECT campaign_id, channel, category, target_segment, roas, recoverable_spend_usd,
           spend_to_date_usd, has_matching_winner, matching_winner_campaign_id,
           matching_winner_roas, reallocate_target_campaign_id
    FROM synced.open_underperformers WHERE campaign_id = ${campaignId} LIMIT 1
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  return r ? mapUnderperformer(r) : null;
}

export async function worstUnderperformer(db: AppDb): Promise<Underperformer | null> {
  const rows = await db.execute(sql`
    SELECT campaign_id, channel, category, target_segment, roas, recoverable_spend_usd,
           spend_to_date_usd, has_matching_winner, matching_winner_campaign_id,
           matching_winner_roas, reallocate_target_campaign_id
    FROM synced.open_underperformers
    ORDER BY recoverable_spend_usd DESC NULLS LAST LIMIT 1
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  return r ? mapUnderperformer(r) : null;
}

export async function getRecommendation(db: AppDb, campaignId: string): Promise<ActionRecommendation | null> {
  const rows = await db.execute(sql`
    SELECT campaign_id, recommended_action, predicted_roas_lift, predicted_net_value_usd, action_ranking
    FROM synced.action_recommendations WHERE campaign_id = ${campaignId} LIMIT 1
  `);
  const r = (rows.rows as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    campaignId: r.campaign_id as string,
    recommendedAction: (r.recommended_action as ActionType) ?? null,
    predictedRoasLift: num(r.predicted_roas_lift),
    predictedNetValueUsd: num(r.predicted_net_value_usd),
    actionRanking: parseActionRanking(r.action_ranking),
  };
}

// ── Write helper (Layer 3 — Act) ──────────────────────────────────────────────

export const recordCampaignAction = async () => {
  throw new Error('Not implemented — Build 3 Act task');
};
