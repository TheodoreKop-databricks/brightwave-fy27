-- Pipeline table: gold_action_outcomes (training data for ROAS model)

CREATE OR REFRESH
  MATERIALIZED VIEW gold_action_outcomes
AS
  SELECT action_id, campaign_id, action_type, had_matching_winner,
         roas_at_action, action_cost_usd, roas_lift, revenue_impact_usd
  FROM LIVE.silver_actions
