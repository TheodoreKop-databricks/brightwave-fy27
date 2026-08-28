-- gold_campaign_position: the coherence spine
-- One row per campaign reflecting the CURRENT snapshot position
-- Dashboard, metric view, Genie, and the app all consume this table

CREATE OR REFRESH MATERIALIZED VIEW gold_campaign_position AS
WITH latest_perf AS (
  SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY snapshot_date DESC) AS rn
    FROM LIVE.silver_perf
  ) WHERE rn = 1
),
spend_rollup AS (
  SELECT campaign_id, SUM(spend_usd) AS total_spend_usd
  FROM LIVE.silver_spend
  GROUP BY campaign_id
)
SELECT
  p.campaign_id,
  p.campaign_name,
  p.channel,
  p.category,
  p.target_segment,
  p.creative_id,
  p.creative_angle,
  p.campaign_summary,
  p.status,
  p.roas,
  COALESCE(s.total_spend_usd, p.spend_to_date_usd) AS spend_to_date_usd,
  COALESCE(a.attributed_revenue_usd, 0) AS attributed_revenue_usd,
  COALESCE(a.incrementality_score, 0) AS incrementality_score,
  p.perf_signal,
  CASE
    WHEN p.status = 'paused' THEN 'paused'
    WHEN p.roas >= 3.0 THEN 'winner'
    WHEN p.roas < 1.5 AND p.status = 'active' THEN 'underperformer'
    ELSE 'steady'
  END AS perf_band,
  CASE
    WHEN p.roas < 1.5 AND p.status = 'active'
      THEN COALESCE(s.total_spend_usd, p.spend_to_date_usd)
    ELSE 0
  END AS recoverable_spend_usd
FROM latest_perf p
LEFT JOIN spend_rollup s ON p.campaign_id = s.campaign_id
LEFT JOIN LIVE.silver_attribution a ON p.campaign_id = a.campaign_id
