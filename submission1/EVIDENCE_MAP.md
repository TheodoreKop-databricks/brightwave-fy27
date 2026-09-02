# Build 1 — Evidence Map (Brightwave · Lakebase)

Lakebase instance **brightwave-campaign-desk** (Postgres DB `brightwave_lakebase_tkop`)
serving Brightwave campaign data to the Campaign Desk app. This maps each of the 8
required exports to the file that proves it. Every export was regenerated from the
**live** system on 2026-08-28.

| # | Required export | File(s) | Proves |
|---|-----------------|---------|--------|
| 1 | Lakebase instance name + connectivity check | `lakebase_instance.txt` | Instance/branches/endpoints + `SELECT version()` → PostgreSQL 17.11 |
| 2 | Query against the synced UC table + non-empty rows | `synced_table.sql`, `synced_table_result.json` | Read from `synced.campaign_position` (mirror of `…gold_campaign_position`); 2 rows (CMP-0000214 underperformer + CMP-0000634 winner) |
| 3 | Reverse-synced UC Delta sample (SCD2 + system metadata cols) | `reverse_sync_sample.json`, `lakebase_cdf.tf` | `lakebase_cdc.lb_campaign_actions_app_history`: 7 rows, change types insert/update_preimage/update_postimage, `_pg_change_type/_pg_lsn/_pg_xid/_timestamp/_sort_by`; the promoted `priority_score` flows through |
| 4 | Dev branch (off root) + changes made on it | `branch.txt` | Lakebase branch `dev-tkop` off `production`: ALTER TABLE (priority_score) + seed + isolated validation |
| 5 | Coding-agent change (diff/migration) + authorship + validation + promotion | `agent_change/001_add_priority_score.sql`, `agent_change/migration_commit.txt`, `agent_change/validation_dev_branch.md`, `agent_change/promotion_proof.md` | Migration file with `Author:` trailer; git commit `cb56838` w/ authorship; validation result (0.92/0.67); promotion to production verified live |
| 6 | Lakebase Search NL query + records | `search_query.txt`, `search_result.json` | BM25 over the `creatives_search_bm25` index (`lakebase_text` ext); NL "lifestyle aspirational social creative for gen z apparel…" → 8 lifestyle creatives with scores |
| 7 | Business question + query + correct result | `core_question.txt`, `core_query.sql`, `core_query_result.json` | Top-5 underperformers by recoverable spend across 3 synced tables → recommended action + predicted lift + matching winner |
| 8 | Git history (`git log --graph --oneline --decorate --all`) | `git_history.txt` | `dev-tkop` off `main` and the merge (`690f07a` / `bff0431`) that promoted the change |

Supporting: `RUNBOOK.md` (the build narrative + step-by-step).

## Deeper Lakebase coverage (round 2)
Closing the validator's "where to focus next" items — each with a build construct **and**
execution evidence in this folder.

| Focus item | Construct (code) | Execution evidence |
|------------|------------------|--------------------|
| Operational schema modeled for the domain (related tables + keys) | `operational_schema.sql` — 6 tables, PKs, 3 FKs (conversations→messages→feedback; campaign_actions_app←workflow_events) | **`operational_schema_validation.ipynb`** — a Databricks notebook **executed as a real serverless job** (result_state=SUCCESS) that connects to Lakebase Postgres and prints, with cell outputs: §1 the 6 `app.*` tables, §2 their primary keys, §3 the 3 foreign keys wiring the domain, §4 the per-table column model, §5 live row counts. Source: `operational_schema_validation.py`; untouched Databricks run export: `operational_schema_validation_run.html`. Also `operational_schema_execution.md` (psql `\d` transcript), `operational_schema_result.json`, `writable_tables_result.json` |
| Separate writable Postgres tables (distinct from read-only synced.*) ran | `operational_schema.sql` | `writable_tables_result.json` — 6 app.* tables with row counts + sample |
| Sync defined as code (not UI-only) | `sync_as_code.sh` (forward UC→PG synced tables), `lakebase_cdf.tf` (reverse PG→UC Terraform) | `synced_status.json` — 4 synced tables ONLINE |
| Dev branch off main named + creation in code | `branch.txt` (names dev-tkop off main + inline git & Lakebase create calls), `create_branches.sh` (`git checkout -b dev-tkop main` + `create-branch`) | `git_history.txt` (dev-tkop off main + merge), `branches_result.json` (dev-tkop READY) |
| Both branch uses (dev iteration + throwaway forecast) | `create_branches.sh`, `forecast_scenario.sql` | `branches_result.json` (isolation proof: scenario schema on forecast branch, not prod) + forecast result |
| Scale-to-zero so idle branches cost ~nothing | `create_branches.sh` (autoscaling floor 0.5 CU) | `scale_to_zero_config.json` — per-branch min/max CU + suspend timeout |
| Hybrid Lakebase Search (vector + full-text) over a text column | `search_hybrid.sql` — lakebase_bm25 + lakebase_ann, RRF fusion | `search_hybrid_result.json` — dual bm25_rank + vector_rank, ANN index-scan EXPLAIN |


## The through-line
The coding agent added `priority_score` on the **dev-tkop** Lakebase branch (#4/#5),
it was **promoted to production** (#5), and the reverse-sync CDF then carried that same
new column into the **Unity Catalog** SCD2 history table (#3) — a full round trip:
UC → synced Postgres (#2) → dev branch change (#4/#5) → production → back to UC Delta (#3).
