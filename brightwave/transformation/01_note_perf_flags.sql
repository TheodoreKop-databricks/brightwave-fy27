-- note_perf_flags: ai_classify dedup showcase.
-- Classify each DISTINCT review note once, then silver_perf joins back.

CREATE OR REFRESH MATERIALIZED VIEW note_perf_flags
AS
SELECT
  review_note_text,
  ai_classify(review_note_text, ARRAY('winner', 'underperformer', 'healthy')) AS perf_signal
FROM (
  SELECT DISTINCT review_note_text
  FROM read_files('/Volumes/${catalog}/${schema}/raw_data/perf_snapshots/')
  WHERE review_note_text IS NOT NULL
)
