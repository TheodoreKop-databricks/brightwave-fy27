-- ============================================================================
-- Build 2 · Assist — creative retrieval runs on the BUILD-1 LAKEBASE SEARCH INDEX
-- ============================================================================
-- The app's `search_creatives` agent tool does NOT use a separate/external
-- search store. It queries the Lakebase Search BM25 index created in Build 1:
--
--     table  : app.creatives_search        (400 creatives, synced descriptions)
--     index  : app.creatives_search_bm25   (index type = lakebase_bm25, on search_tsv tsvector)
--
-- Source of truth (verbatim): brightwave/app/server/db/queries/campaigns.ts
--   → export async function searchCreatives(db, query, limit = 5)
-- Called by the agent tool `search_creatives` in
--   brightwave/app/server/agent/campaigndesk.ts.
--
-- Index type confirmed live:
--   SELECT c.relname, am.amname FROM pg_class c JOIN pg_am am ON am.oid=c.relam ...
--     creatives_search_bm25 | lakebase_bm25
-- ============================================================================

-- (1) How the index was created in Build 1 (Lakebase Search / BM25 over the tsvector):
--     CREATE INDEX creatives_search_bm25
--       ON app.creatives_search USING lakebase_bm25 (search_tsv);
--   (search_tsv is a tsvector built from creative_name + angle + description.)

-- (2) The exact query the app runs for every search_creatives call.
--     `<@>` is the Lakebase BM25 distance operator; to_bm25query(..., '<idx>'::regclass)
--     binds the query to THIS index; ORDER BY ... ASC ranks best matches first
--     (the operator returns a negated BM25 score, so smallest = most relevant).
SELECT creative_id, creative_name, creative_type, angle, description,
       (search_tsv <@> to_bm25query(to_tsvector('english', :q), 'app.creatives_search_bm25'::regclass)) AS score
FROM   app.creatives_search
ORDER  BY search_tsv <@> to_bm25query(to_tsvector('english', :q), 'app.creatives_search_bm25'::regclass) ASC
LIMIT  :limit;   -- :q = 'testimonial social apparel gen_z', :limit = 6

-- (3) EXPLAIN proves retrieval is served BY THE INDEX (not a seq scan / separate store):
--     Limit
--       ->  Index Scan using creatives_search_bm25 on creatives_search
--             Order By: (search_tsv <@> '("''social'':2 ''testimoni'':1",app.creatives_search_bm25)'::bm25query_tsvector)
--
-- Live ranked output for this query is captured in search_result.json.
