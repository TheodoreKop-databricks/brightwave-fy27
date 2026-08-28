-- BUILD 1 · EVIDENCE #4 (second branch use) — forecasting scenario
-- ============================================================================
-- Run on the THROWAWAY forecast-scenario branch (copy-on-write off production,
-- TTL 7 days). Writes are isolated from production. Portfolio what-if: if we
-- replicate the matching winner across every active underperformer that has one
-- (and reallocate the rest), what is the projected recovered value?
--
--   databricks psql --project brightwave-campaign-desk --branch forecast-scenario -- \
--       -d brightwave_lakebase_tkop -f forecast_scenario.sql
-- Result in branches_result.json → forecast_scenario_result.

CREATE SCHEMA IF NOT EXISTS scenario;

DROP TABLE IF EXISTS scenario.replicate_all_forecast;
CREATE TABLE scenario.replicate_all_forecast AS
SELECT ar.recommended_action,
       count(*)                                                        AS campaigns,
       ROUND(SUM(cp.recoverable_spend_usd)::numeric, 2)                AS total_recoverable_spend,
       ROUND(AVG(ar.predicted_roas_lift)::numeric, 4)                  AS avg_predicted_roas_lift,
       ROUND(SUM(cp.recoverable_spend_usd * ar.predicted_roas_lift)::numeric, 2) AS projected_recovered_value
FROM   synced.campaign_position       cp
JOIN   synced.open_underperformers    ou ON cp.campaign_id = ou.campaign_id
JOIN   synced.action_recommendations  ar ON cp.campaign_id = ar.campaign_id
WHERE  cp.perf_band = 'underperformer'
  AND  cp.status    = 'active'
GROUP  BY ar.recommended_action;

SELECT * FROM scenario.replicate_all_forecast ORDER BY projected_recovered_value DESC;
