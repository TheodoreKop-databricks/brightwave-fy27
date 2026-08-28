-- Brightwave Campaign Desk — underperformer queue (Build 2, Visualize layer).
--
-- The live view behind the Campaign Desk queue. Reads the Build-1 managed
-- read-only synced tables (synced.*), LEFT JOINs each underperformer to its
-- matching winner (open_underperformers) and the model's ranked recommendation
-- (action_recommendations), and derives the live "action taken" status from the
-- app's own writable table (app.campaign_actions_app) via a LATERAL "latest
-- action per campaign" join. Ordered by recoverable spend so the biggest budget
-- leaks surface first — CMP-0000214 sits near the top, flagged `underperformer`.
--
-- (Served by GET /api/campaigns/queue → server/db/queries/campaigns.ts:listQueue.)

SELECT
  cp.campaign_id,
  cp.campaign_name,
  cp.channel,
  cp.category,
  cp.roas,
  cp.spend_to_date_usd,
  cp.recoverable_spend_usd,
  cp.perf_band,
  ou.has_matching_winner,
  ou.matching_winner_campaign_id,
  ou.matching_winner_roas,
  ar.recommended_action,
  ar.predicted_roas_lift,
  act.status      AS action_status,      -- NULL until an action is recorded
  act.action_type AS action_taken_type
FROM synced.campaign_position cp
LEFT JOIN synced.open_underperformers   ou ON ou.campaign_id = cp.campaign_id
LEFT JOIN synced.action_recommendations ar ON ar.campaign_id = cp.campaign_id
LEFT JOIN LATERAL (
  SELECT ca.status, ca.action_type
  FROM app.campaign_actions_app ca
  WHERE ca.campaign_id = cp.campaign_id
  ORDER BY ca.created_at DESC
  LIMIT 1
) act ON true
WHERE cp.perf_band = 'underperformer'
ORDER BY cp.recoverable_spend_usd DESC NULLS LAST;
