-- BUILD 1 · EVIDENCE #2 — query against a synced Unity Catalog table
-- ============================================================================
-- synced.campaign_position is a Lakebase SYNCED TABLE: a read-only Postgres
-- mirror of the Unity Catalog Delta table
--   brightwave_techsummit27_catalog.brightwave.gold_campaign_position
-- kept current by a Lakebase synced-table pipeline (UC Delta -> Postgres).
--
-- Run on the production branch of brightwave-campaign-desk / brightwave_lakebase_tkop:
--   databricks psql --project brightwave-campaign-desk --branch production -- \
--       -d brightwave_lakebase_tkop -f synced_table.sql
--
-- The hero pair: the underperformer (CMP-0000214) and its matching winner
-- (CMP-0000634) — same gen_z apparel audience, different channel+creative.
-- Returned rows in synced_table_result.json (non-empty).

SELECT campaign_id,
       campaign_name,
       channel,
       category,
       target_segment,
       ROUND(roas::numeric, 2)               AS roas,
       ROUND(spend_to_date_usd::numeric, 2)  AS spend_to_date_usd,
       perf_band
FROM   synced.campaign_position
WHERE  campaign_id IN ('CMP-0000214', 'CMP-0000634')
ORDER  BY roas DESC;
