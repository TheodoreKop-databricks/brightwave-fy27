-- gold_open_underperformers: active underperformers with matching-winner context
-- Used by: ROAS-lift model scoring input, app campaign queue

CREATE OR REFRESH MATERIALIZED VIEW gold_open_underperformers AS
WITH underperformers AS (
  SELECT * FROM LIVE.gold_campaign_position
  WHERE perf_band = 'underperformer'
),
winners AS (
  SELECT * FROM LIVE.gold_campaign_position
  WHERE perf_band = 'winner'
),
matching AS (
  SELECT
    u.campaign_id,
    w.campaign_id AS matching_winner_campaign_id,
    w.roas AS matching_winner_roas,
    w.creative_id AS matching_winner_creative_id,
    ROW_NUMBER() OVER (PARTITION BY u.campaign_id ORDER BY w.roas DESC) AS rn
  FROM underperformers u
  JOIN winners w
    ON u.category = w.category
    AND u.target_segment = w.target_segment
),
top_winner AS (
  SELECT campaign_id,
    ROW_NUMBER() OVER (ORDER BY roas DESC) AS wrn
  FROM winners
)
SELECT
  u.campaign_id,
  u.campaign_name,
  u.channel,
  u.category,
  u.target_segment,
  u.creative_id,
  u.roas,
  u.spend_to_date_usd,
  u.recoverable_spend_usd,
  CASE WHEN m.matching_winner_campaign_id IS NOT NULL THEN true ELSE false END AS has_matching_winner,
  m.matching_winner_campaign_id,
  m.matching_winner_roas,
  m.matching_winner_creative_id,
  tw.campaign_id AS reallocate_target_campaign_id
FROM underperformers u
LEFT JOIN matching m
  ON u.campaign_id = m.campaign_id AND m.rn = 1
CROSS JOIN (SELECT campaign_id FROM top_winner WHERE wrn = 1) tw
