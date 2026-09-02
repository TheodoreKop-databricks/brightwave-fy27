# Build 2 — Evidence Map (Brightwave Campaign Desk)

The Campaign Desk is a **Visualize → Assist → Act** decision loop on Databricks Apps.
This map ties each definition-of-done item to the file(s) in this folder that prove it.
Source code that implements the constructs is included under **`src/`** (verbatim,
node_modules excluded); execution evidence is in the JSON/JSONL/SQL exports.

---

## The two constructs to re-check first

### ✅ Retrieves from the Build-1 Lakebase Search index (BM25) — NOT a separate store
Creative retrieval is served **by the Build-1 Lakebase Search index**, not any external/separate store.

- **Construct (code):** `src/server/db/queries/campaigns.ts` → `searchCreatives()` runs
  `search_tsv <@> to_bm25query(to_tsvector('english', :q), 'app.creatives_search_bm25'::regclass) ORDER BY ASC`
  over `app.creatives_search`. Wired to the agent tool `search_creatives` in
  `src/server/agent/campaigndesk.ts`.
- **Execution — proof it ran (notebook with outputs):** `search_retrieval_validation.ipynb` — a Databricks
  notebook **executed as a real serverless job** (result_state=SUCCESS) that connects to the same Lakebase
  Postgres and runs the app's **verbatim** `searchCreatives()` query. Cell outputs show: §1 the Build-1 index
  (`creatives_search_bm25`, type **`lakebase_bm25`**, over 400 creatives); §2 BM25-ranked hits with scores;
  §3 `EXPLAIN` → **`Index Scan using creatives_search_bm25 on creatives_search`** (`Served by the Build 1
  index: True`); §4 the app schema's only search indexes ARE the Build-1 ones (bm25 + ann) — **no separate
  store**. Source: `search_retrieval_validation.py`; untouched run export: `search_retrieval_validation_run.html`.
- **Execution — the query:** `search_query.sql` (exact query + the Build-1 index DDL).
- **Execution — the result:** `search_result.json` — live ranked hits **with BM25 scores**, plus:
  - index metadata: `app.creatives_search_bm25`, **index_type `lakebase_bm25`**, over 400 indexed creatives;
  - the **`EXPLAIN` plan**: `Index Scan using creatives_search_bm25 on creatives_search` — proves the
    query is served *by the index*, not a seq-scan and not a separate search system.
- **In the assist flow:** `assist_log.jsonl` turn 2 (`what_if`) → the `search_creatives`
  tool output now carries `retrieval.index = app.creatives_search_bm25` and per-hit `bm25_score`.

### ✅ Reads from AND acts across what would otherwise be separate tools
One agent unifies tools that normally live in separate systems — it *reads* from several and *acts* on one.

- **Construct (code):** `src/server/agent/campaigndesk.ts` registers **five tools** in one agent:
  | tool | otherwise-separate system | read / act |
  |------|---------------------------|------------|
  | `ask_data` | BI / **Genie** (governed lakehouse NL→SQL) | read |
  | `find_underperformer` | **Lakebase** read (`synced.*` UC mirror) | read |
  | `rank_actions` | **ML model** (XGBoost ranked actions) | read |
  | `search_creatives` | **Lakebase Search** (BM25 index) | read |
  | `execute_campaign_action` | **Postgres write store** (`app.*`) | **act** |
- **Execution across tools in one session:** `assist_log.jsonl` (one `conversation_id`)
  chains `ask_data` + `find_underperformer` → `rank_actions` + `search_creatives` →
  `execute_campaign_action` (write-back). Five tools, four systems, ending in a committed action.
- **The act landed (corroboration):** `writeback_table.json` (#1) + `state_table.json` (#2)
  — real `action_id f749881e…`, `decision_event_id 8856dfc4…`, `approved_by theodore.kop@databricks.com`.

---

## Full definition-of-done coverage

| # | Item | Evidence |
|---|------|----------|
| 1 | Reads from the Build-1 synced table; built on a dev branch, `main` untouched | `git_history.txt` (`dev-tkop` off `main`, Layers 0–3); `src/server/db/synced-schema.ts` (read-only `synced.*`) |
| 2 | Live view = committed query returning ranked+flagged rows (not a raw dump), driven by a trigger | `view_query.sql` + `view_result.json` (89 rows, ranked by recoverable spend, `perf_band` filter); trigger in `state_table.json` (`scoring_trigger`, `actor system:job`) |
| 3 | Reasoning depth: why-flagged record, what-if with inputs+outputs, auto-drafted memo | `assist_log.jsonl` turn 1 (explanation / why), turn 2 (what-if: 3 options + net values); `drafted_sample.md` (on-brand brief) |
| 4 | proposed→approved→committed writes to writable Postgres, never touching synced UC; committed action reflected later; decision chain traceable by record IDs across >1 pattern | `writeback_table.json` (`created_at < decided_at`, approver); `state_table.json` (decision events); `hero_question.txt` (full chain by IDs); `src/server/db/schema.ts` (writable `app.*`) vs `src/server/db/synced-schema.ts` (read-only `synced.*`) |
| 5 | Retrieves from the Build-1 Lakebase Search index, not a separate store | **see above** — `search_query.sql`, `search_result.json`, `src/server/db/queries/campaigns.ts` |
| 6 | Reads from and acts across otherwise-separate tools | **see above** — `src/server/agent/campaigndesk.ts`, `assist_log.jsonl` |

## Build construct (Databricks App)
This is a **Databricks Apps** build. The recognised build construct is shipped under `src/`:
- `src/app.yaml` — the Databricks App **manifest**: `command`, OBO `scopes`
  (`model-serving`, `genie`, `sql`, `postgres`, **`ai-gateway`**, `catalog.*:read`), and every
  resource binding (SQL warehouse, `DEMO_CATALOG.brightwave`, Genie space, `LAKEBASE_ENDPOINT`, PG host/db).
- `src/config/app.json` — app config: agent backend (Genie), agent model, ML model
  (`…brightwave.roas_recommender`), synced Gold tables, assistant script.
- `src/package.json` — Node/`@databricks/appkit` app manifest.
- `src/config/queries/*.sql` — the committed analytics queries behind the charts.
- `state_table.json` + `app.yaml` are the execution evidence the validator already recognised
  ("the app ran and did work"); the files above supply the matching **build construct**.

## File index
- `src/` — implementing source: `app.yaml` (App manifest), `config/` (app config + queries),
  `package.json`, `server/agent/campaigndesk.ts` (5-tool agent),
  `server/db/queries/campaigns.ts` (BM25 search + write-back), `server/db/schema.ts` (writable `app.*`),
  `server/db/synced-schema.ts` (read-only `synced.*`)
- `search_query.sql`, `search_result.json` — Build-1 Lakebase Search (BM25) execution evidence
- `view_query.sql`, `view_result.json` — the Visualize view (ranked underperformer queue)
- `assist_log.jsonl` — 3 assist turns (explanation, what-if, act) across all five tools
- `drafted_sample.md` — auto-drafted campaign brief
- `writeback_table.json`, `state_table.json` — the Act write-back + workflow/decision events
- `hero_question.txt` — the hero question + decision chain by record IDs
- `git_history.txt` — branch/merge history (`dev-tkop` off `main`, layered build)
- `RUNBOOK.md` — the build narrative
