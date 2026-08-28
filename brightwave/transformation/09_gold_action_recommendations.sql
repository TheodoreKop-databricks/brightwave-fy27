-- Pipeline heuristic: rank replicate_winner / reallocate_budget / pause per underperformer
-- net_value = roas_lift x spend_to_date - action_cost; recommended_action = argmax
-- replicate_winner wins when a matching winner exists (hero CMP-0000214 case)

CREATE OR REFRESH
  MATERIALIZED VIEW gold_action_recommendations
AS
WITH portfolio_top AS (
  SELECT MAX(roas) AS portfolio_top_roas
  FROM LIVE.gold_campaign_position
  WHERE perf_band = 'winner'
),
candidates AS (
  SELECT
    u.campaign_id,
    u.roas,
    u.spend_to_date_usd,
    u.has_matching_winner,
    u.matching_winner_roas,
    pt.portfolio_top_roas,
    -- replicate_winner lift
    CASE WHEN u.has_matching_winner
      THEN (u.matching_winner_roas - u.roas) * 0.6
      ELSE 0.1
    END AS replicate_lift,
    2000.0 AS replicate_cost,
    -- reallocate_budget lift
    (pt.portfolio_top_roas - u.roas) * 0.5 AS reallocate_lift,
    200.0 AS reallocate_cost,
    -- pause: zero lift, zero cost
    0.0 AS pause_lift,
    0.0 AS pause_cost
  FROM LIVE.gold_open_underperformers u
  CROSS JOIN portfolio_top pt
),
scored AS (
  SELECT *,
    replicate_lift * spend_to_date_usd - replicate_cost AS replicate_net,
    reallocate_lift * spend_to_date_usd - reallocate_cost AS reallocate_net,
    pause_lift * spend_to_date_usd - pause_cost AS pause_net
  FROM candidates
)
SELECT
  campaign_id,
  CASE
    WHEN replicate_net >= reallocate_net AND replicate_net >= pause_net THEN 'replicate_winner'
    WHEN reallocate_net >= pause_net THEN 'reallocate_budget'
    ELSE 'pause'
  END AS recommended_action,
  CASE
    WHEN replicate_net >= reallocate_net AND replicate_net >= pause_net THEN ROUND(replicate_lift, 4)
    WHEN reallocate_net >= pause_net THEN ROUND(reallocate_lift, 4)
    ELSE ROUND(pause_lift, 4)
  END AS predicted_roas_lift,
  CASE
    WHEN replicate_net >= reallocate_net AND replicate_net >= pause_net THEN ROUND(replicate_net, 2)
    WHEN reallocate_net >= pause_net THEN ROUND(reallocate_net, 2)
    ELSE ROUND(pause_net, 2)
  END AS predicted_net_value_usd,
  CONCAT('[',
    '{"action":"replicate_winner","roas_lift":', CAST(ROUND(replicate_lift,4) AS STRING),
    ',"net_value":', CAST(ROUND(replicate_net,2) AS STRING), ',"cost":2000},',
    '{"action":"reallocate_budget","roas_lift":', CAST(ROUND(reallocate_lift,4) AS STRING),
    ',"net_value":', CAST(ROUND(reallocate_net,2) AS STRING), ',"cost":200},',
    '{"action":"pause","roas_lift":', CAST(ROUND(pause_lift,4) AS STRING),
    ',"net_value":', CAST(ROUND(pause_net,2) AS STRING), ',"cost":0}]'
  ) AS action_ranking,
  current_timestamp() AS scored_at
FROM scored
