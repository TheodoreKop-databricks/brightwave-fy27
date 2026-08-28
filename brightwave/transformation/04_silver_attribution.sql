-- Silver attribution: latest modeled contribution per campaign

CREATE OR REFRESH MATERIALIZED VIEW silver_attribution AS
SELECT campaign_id, as_of_date, attributed_revenue_usd, incrementality_score, attribution_model
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY as_of_date DESC) AS rn
  FROM read_files('/Volumes/${catalog}/${schema}/raw_data/attribution/')
)
WHERE rn = 1
