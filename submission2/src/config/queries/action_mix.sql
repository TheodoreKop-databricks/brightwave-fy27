-- Recommended-action mix — how the model's ranked plays distribute, and the
-- total net value on the table (replicate_winner / reallocate_budget / pause).
-- @param catalog = brightwave_techsummit27_catalog
-- @param schema = brightwave
SELECT
  recommended_action,
  COUNT(*) AS campaign_count,
  SUM(predicted_net_value_usd) AS total_predicted_net_value_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_action_recommendations')
WHERE recommended_action IS NOT NULL
GROUP BY recommended_action
ORDER BY total_predicted_net_value_usd DESC
