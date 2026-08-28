-- BUILD 1 · EVIDENCE #6 (hybrid) — Lakebase Search: full-text + vector, fused
-- ============================================================================
-- HYBRID search over the operational text column app.creatives_search.description:
--   • Full-text half : lakebase_bm25 index on the search_tsv tsvector (lakebase_text ext)
--   • Vector half    : lakebase_ann index on embedding vector(1024) (lakebase_vector ext),
--                      embeddings from the databricks-gte-large-en serving endpoint
--   • Fusion         : Reciprocal Rank Fusion (RRF, k=60) over the two ranked lists
--
-- Setup (see operational_schema.sql + set-embeddings step):
--   ALTER TABLE app.creatives_search ADD COLUMN embedding vector(1024);
--   -- populate embedding via databricks-gte-large-en over description (400 rows)
--   CREATE INDEX creatives_search_ann  ON app.creatives_search USING lakebase_ann  (embedding vector_cosine_ops);
--   CREATE INDEX creatives_search_bm25 ON app.creatives_search USING lakebase_bm25 (search_tsv);
--
-- :q    = natural-language query text  = 'high-trust social video to win back gen-z apparel shoppers'
-- :qvec = the same query embedded by databricks-gte-large-en (1024-dim vector literal):
--   databricks api post /serving-endpoints/databricks-gte-large-en/invocations \
--     --json '{"input":[:q]}'   ->  data[0].embedding
-- Run on the production branch; results in search_hybrid_result.json.

WITH bm25 AS (       -- full-text ranked list (lakebase_bm25)
  SELECT creative_id,
         ROW_NUMBER() OVER (ORDER BY search_tsv <@>
           to_bm25query(to_tsvector('english', :q), 'app.creatives_search_bm25'::regclass) ASC) AS r
  FROM app.creatives_search
  ORDER BY r LIMIT 40
),
ann AS (             -- vector ANN ranked list (lakebase_ann, cosine)
  SELECT creative_id,
         ROW_NUMBER() OVER (ORDER BY embedding <=> :qvec::vector ASC) AS r
  FROM app.creatives_search
  ORDER BY r LIMIT 40
)
SELECT cs.creative_id, cs.creative_name, cs.creative_type, cs.angle,
       b.r AS bm25_rank, a.r AS vector_rank,
       ROUND((COALESCE(1.0/(60+b.r),0) + COALESCE(1.0/(60+a.r),0))::numeric, 6) AS rrf_score
FROM   app.creatives_search cs
LEFT JOIN bm25 b ON b.creative_id = cs.creative_id
LEFT JOIN ann  a ON a.creative_id = cs.creative_id
WHERE  b.r IS NOT NULL OR a.r IS NOT NULL
ORDER  BY rrf_score DESC
LIMIT  8;
