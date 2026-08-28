-- Silver perf: campaign performance snapshot with creative + ai_classify signal

CREATE OR REFRESH MATERIALIZED VIEW silver_perf AS
SELECT
  p.campaign_id, p.snapshot_date, p.roas, p.spend_to_date_usd, p.review_note_text,
  cam.campaign_name, cam.channel, cam.category, cam.target_segment,
  cam.creative_id, cam.status, cam.campaign_summary,
  cr.creative_type, cr.angle AS creative_angle, cr.description AS creative_description,
  npf.perf_signal
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/perf_snapshots/') p
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/campaigns/') cam
  ON p.campaign_id = cam.campaign_id
LEFT JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/creatives/') cr
  ON cam.creative_id = cr.creative_id
LEFT JOIN LIVE.note_perf_flags npf
  ON p.review_note_text = npf.review_note_text
