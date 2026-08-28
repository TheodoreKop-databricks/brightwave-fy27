-- Silver actions: historical campaign actions enriched with campaign attributes

CREATE OR REFRESH MATERIALIZED VIEW silver_actions
AS
SELECT
  a.action_id,
  a.campaign_id,
  a.action_type,
  a.had_matching_winner,
  a.roas_at_action,
  a.initiated_date,
  a.action_cost_usd,
  a.roas_lift,
  a.revenue_impact_usd,
  cam.channel,
  cam.category,
  cam.target_segment
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/campaign_actions/') a
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/campaigns/') cam
  ON a.campaign_id = cam.campaign_id
