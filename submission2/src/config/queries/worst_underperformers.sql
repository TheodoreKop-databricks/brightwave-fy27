-- Worst underperformers by recoverable spend — the biggest budget leaks.
-- CMP-0000214 sits near the top of this list.
--
-- Portable table refs: IDENTIFIER(:catalog||'.'||:schema||'.table'); server/routes/charts.ts
-- binds :catalog/:schema from env at runtime, and the type-generator samples the
-- @param values below at DESCRIBE time.
-- @param catalog = brightwave_techsummit27_catalog
-- @param schema = brightwave
SELECT
  campaign_id,
  channel,
  category,
  roas,
  recoverable_spend_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_campaign_position')
WHERE perf_band = 'underperformer'
ORDER BY recoverable_spend_usd DESC
LIMIT 20
