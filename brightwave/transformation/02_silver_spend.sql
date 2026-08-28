-- silver_spend: per campaign x day spend + conversions denormalized
-- Joins ad_spend, conversions, campaigns. Daily ROAS = revenue / spend.

CREATE OR REFRESH MATERIALIZED VIEW silver_spend AS
SELECT
  s.campaign_id,
  s.spend_date,
  s.spend_usd,
  s.impressions,
  s.clicks,
  c.conversions,
  c.revenue_usd,
  ROUND(c.revenue_usd / NULLIF(s.spend_usd, 0), 2) AS daily_roas,
  cam.campaign_name,
  cam.channel,
  cam.category,
  cam.target_segment,
  cam.creative_id,
  cam.status
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/ad_spend/') s
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/conversions/') c
  ON s.campaign_id = c.campaign_id AND s.spend_date = c.conv_date
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/campaigns/') cam
  ON s.campaign_id = cam.campaign_id
