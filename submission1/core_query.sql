-- BUILD 1 · EVIDENCE #7 — the query that answers the business question
-- ============================================================================
-- "For the 5 active underperformers with the most recoverable spend, what is the
--  model's recommended action, the predicted ROAS lift, and the matching winner?"
--
-- Joins three synced Unity Catalog tables in Lakebase on campaign_id. Run on the
-- production branch of brightwave-campaign-desk / brightwave_lakebase_tkop:
--   databricks psql --project brightwave-campaign-desk --branch production -- \
--       -d brightwave_lakebase_tkop -f core_query.sql
-- Returned rows in core_query_result.json.

SELECT cp.campaign_id,
       cp.campaign_name,
       cp.channel,
       cp.category,
       ROUND(cp.spend_to_date_usd::numeric, 2)      AS spend_to_date_usd,
       ROUND(cp.recoverable_spend_usd::numeric, 2)  AS recoverable_spend_usd,
       ar.recommended_action,
       ROUND(ar.predicted_roas_lift::numeric, 4)    AS predicted_roas_lift,
       ou.matching_winner_campaign_id,
       ou.matching_winner_roas
FROM   synced.campaign_position       cp
JOIN   synced.open_underperformers    ou ON cp.campaign_id = ou.campaign_id
JOIN   synced.action_recommendations  ar ON cp.campaign_id = ar.campaign_id
WHERE  cp.perf_band = 'underperformer'
  AND  cp.status    = 'active'
ORDER  BY cp.recoverable_spend_usd DESC
LIMIT  5;
