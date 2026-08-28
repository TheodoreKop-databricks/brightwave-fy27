-- Performance mix by channel — campaign count per channel × perf_band.
-- Tells the "social carries winners, display carries underperformers" story.
-- @param catalog = brightwave_techsummit27_catalog
-- @param schema = brightwave
SELECT
  channel,
  perf_band,
  COUNT(*) AS campaign_count
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_campaign_position')
WHERE channel IS NOT NULL AND perf_band IS NOT NULL
GROUP BY channel, perf_band
ORDER BY channel, perf_band
