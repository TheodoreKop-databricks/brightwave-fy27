# Build 1 · Lakebase — Runbook & Evidence Plan (Brightwave)

Standalone plan for the **Build 1 (Lakebase)** milestone of the Tech Summit FY27 AI Customer
Challenge. Execution is driven by **Genie Code** in the workspace; this repo holds the as-code
artifacts (Terraform, migrations) and the collected evidence under `submission1/`.

> The validator scores Build 1 against the `submission1/` folder only. Zip `submission1/` and upload.

---

## 0. Constants

| Name | Value |
|---|---|
| CLI profile | `fe-sandbox-brightwave-techsummit27` |
| Workspace | `https://fe-sandbox-brightwave-techsummit27.cloud.databricks.com/` |
| Source catalog.schema (governed UC data, pre-work complete) | `brightwave_techsummit27_catalog.brightwave` |
| Lakebase project id | `brightwave-campaign-desk` |
| Lakebase branch (auto-created) | `production` |
| Lakebase UC catalog (registered) | `brightwave_lakebase_tkop` (UC registration of the Lakebase Postgres DB) |
| Postgres database | `databricks_postgres` (default) |
| Read-only synced schema (Postgres) | `synced` |
| Writable app schema (Postgres) | `app` |
| Reverse-sync (CDF) destination (UC) | `brightwave_techsummit27_catalog.lakebase_cdc` |
| Pipeline-metadata storage (UC, regular catalog) | `brightwave_techsummit27_catalog.pipeline_meta` |
| Lakebase dev branch | `dev-tkop` |
| Git dev branch | `dev-tkop` |

---

## 1. Architecture — one project, two schemas (a related model, not a flat dump)

| Postgres object | Kind | Source / purpose | Evidence |
|---|---|---|---|
| `synced.campaign_position` | synced (read-only) | ← `gold_campaign_position` (PK `campaign_id`) | #2, #7 |
| `synced.creatives` | synced (read-only) | ← `raw_creatives` (PK `creative_id`, searchable `description`) | #6 |
| `synced.open_underperformers` | synced (read-only) | ← `gold_open_underperformers` (PK `campaign_id`) | #7 |
| `synced.action_recommendations` | synced (read-only) | ← `gold_action_recommendations` (PK `campaign_id`) | #7 |
| `app.campaign_actions_app` | **writable** | approved actions + audit; keys `campaign_id`/`creative_id` relate it to the synced tables | #3, #4, #5 |
| `app.conversations` / `messages` / `feedback` | writable | chat state (see `app/server/db/schema.ts`) | — |
| **Lakebase CDF** on schema `app` | reverse sync → Delta | → `…lakebase_cdc.lb_campaign_actions_app_history` (SCD2 + `_pg_*` cols) | #3 |
| **Lakebase Search** index on `synced.creatives.description` | hybrid vector+text | NL creative retrieval | #6 |
| dev branch `dev-tkop` off `production` | Lakebase branch | safe iteration → promote | #4, #5 |

Writable state lives in `app`; synced mirrors in `synced`. CDF is **schema-level**, so enabling it on
`app` reverse-syncs only the writable action/audit/chat data — exactly what should stream back.

---

## 2. Prerequisites (do first)

1. **Beta previews ON** — Lakebase **Search** and **CDF** are Beta; a workspace admin enables them on
   the **Previews** page. Confirm before building.
2. **Autoscaling, not Provisioned** — use the `databricks postgres` CLI group / `databricks_postgres_*`
   Terraform resources. Branching (required by the challenge) only exists on Autoscaling.
3. **Destination catalog must NOT use default storage** — CDF rejects default-storage catalogs. Confirm
   `brightwave_techsummit27_catalog` has an explicit managed location, or point CDF at one that does.
4. **Postgres 16/17/18** (default 17) — required for CDF. Writable tables must be in `databricks_postgres`.

---

## 3. Reverse sync is CODE (resolved)

The native reverse sync is now **Lakebase CDF**, configurable as code — no UI-only step. Use the
Terraform resource **`databricks_postgres_cdf_config`** (confirmed in the provider):

```hcl
resource "databricks_postgres_cdf_config" "app_state" {
  parent          = "projects/brightwave-campaign-desk/branches/production/databases/databricks_postgres"
  postgres_schema = "app"                              # source Postgres schema (all its tables)
  catalog         = "brightwave_techsummit27_catalog"  # MUST NOT be default-storage — confirm
  schema          = "lakebase_cdc"                     # destination UC schema for lb_*_history
}
```

- Output tables: `lb_<table>_history` with `_pg_change_type` (`insert`/`delete`/`update_preimage`/
  `update_postimage`), `_pg_lsn`, `_pg_xid`, `_timestamp`, `_sort_by`. Batched ~15s.
- Prereq: `ALTER TABLE app.<table> REPLICA IDENTITY FULL;` on every table in `app`.
- Immutable after creation (changing catalog/schema/source requires resource replacement).
- Also available via the Postgres REST API / SDK if you prefer; Terraform is the cleanest "as code" artifact.

**Recommended as-code split:** Terraform for the Lakebase infra where resources exist (project, branch,
database, `databricks_postgres_cdf_config`); `databricks postgres create-synced-table` CLI for the forward
synced tables (known-good on Autoscaling). Have Genie confirm whether `databricks_postgres_synced_table`
exists in the installed provider version and prefer it if so, for a single Terraform artifact. Commit
everything to git.

---

## 4. Steps → actions → evidence

`export DATABRICKS_CONFIG_PROFILE=fe-sandbox-brightwave-techsummit27`

### Step 0 — Provision + connect → evidence #1
```bash
databricks postgres create-project brightwave-campaign-desk \
  --json '{"spec":{"display_name":"Brightwave Campaign Desk"}}'
databricks postgres list-branches  projects/brightwave-campaign-desk           # confirm branch id "production"
databricks postgres list-endpoints projects/brightwave-campaign-desk/branches/production
databricks postgres create-catalog brightwave_lakebase_tkop \
  --json '{"spec":{"postgres_database":"databricks_postgres","branch":"projects/brightwave-campaign-desk/branches/production"}}'
# connectivity check → instance.txt
databricks psql --project brightwave-campaign-desk -- -c "SELECT version();"
```
Fallback if `databricks psql` is unavailable: `get-endpoint` → `generate-database-credential` → `psql "host=<HOST> user=<USER> dbname=databricks_postgres sslmode=require"`.

### Step 1 — Forward sync ≥1 governed UC table + writable schema → evidence #2
```bash
databricks postgres create-synced-table brightwave_lakebase_tkop.synced.campaign_position \
  --json '{"spec":{"source_table_full_name":"brightwave_techsummit27_catalog.brightwave.gold_campaign_position",
  "primary_key_columns":["campaign_id"],"scheduling_policy":"SNAPSHOT",
  "branch":"projects/brightwave-campaign-desk/branches/production","postgres_database":"databricks_postgres",
  "create_database_objects_if_missing":true,
  "new_pipeline_spec":{"storage_catalog":"brightwave_techsummit27_catalog","storage_schema":"pipeline_meta"}}}'
# repeat: raw_creatives (PK creative_id), gold_open_underperformers (PK campaign_id), gold_action_recommendations (PK campaign_id)
```
> ⚠️ **`storage_catalog` is load-bearing.** It MUST be a regular catalog **with a storage root**
> (`brightwave_techsummit27_catalog` → `s3://…`), NOT the Lakebase catalog `brightwave_lakebase_tkop`
> (a MANAGED_ONLINE_CATALOG with no storage). Omit/mis-set it and the pipeline falls back to the (empty)
> metastore root and fails: `UNITY_CATALOG_INITIALIZATION_FAILED: Metastore storage root URL does not exist`.
> Create the metadata schema first: `CREATE SCHEMA IF NOT EXISTS brightwave_techsummit27_catalog.pipeline_meta;`

**Verify each sync is real, not failed:** `databricks postgres get-synced-table
"synced_tables/brightwave_lakebase_tkop.synced.campaign_position"` → state must be `ONLINE`
(not `SYNCED_TABLE_OFFLINE_FAILED`). **A manual psycopg2 dump is NOT a synced table** and risks evidence #2
+ breaks Build 2's table-update trigger (nothing to refresh).

Then a committed SQL migration creates schema `app` + `campaign_actions_app` (shape per
`specifications/app/03_DATA_MODEL.md`) and `ALTER TABLE app.campaign_actions_app REPLICA IDENTITY FULL;`
(also on any other `app` table CDF will cover). Query the synced table → `synced_table.sql` +
`synced_table_result.json` (non-empty).

### Step 2 — Branch off main → evidence #4
```bash
databricks postgres create-branch projects/brightwave-campaign-desk dev-tkop \
  --json '{"spec":{"source_branch":"projects/brightwave-campaign-desk/branches/production","no_expiry":true}}'
git checkout -b dev-tkop     # git branch (evidence #8 is about the code branch; Step 2 here is the Lakebase branch)
```
Record both branch names + the changes made on them in `branch.txt`.

### Step 3 — Agentic change on a branch → verify → promote → evidence #5, #4, #8
Coding agent adds `priority_score DOUBLE` to `app.campaign_actions_app` via a migration on the git +
Lakebase dev branches, seeds sample rows, runs a validation query, confirms the app still boots against
`dev-tkop`, then **merges git → main** and applies the migration to the `production` Lakebase branch.
Commit with a visible authorship trailer (`Co-authored-by:` / `Author:`). Save the diff/migration to
`submission1/agent_change/`, plus the validation-query result and promotion proof.

### (Reverse sync) — Lakebase CDF as code → evidence #3
Apply the `databricks_postgres_cdf_config` Terraform (§3). Then INSERT/UPDATE a few
`app.campaign_actions_app` rows, wait ~20s, and sample
`brightwave_techsummit27_catalog.lakebase_cdc.lb_campaign_actions_app_history` → `reverse_sync_sample.json`
(show the SCD2 rows + `_pg_*` columns).

### Step 4 — Lakebase Search over a text column → evidence #6
```sql
CREATE EXTENSION IF NOT EXISTS vector;           -- pgvector FIRST
CREATE EXTENSION IF NOT EXISTS lakebase_vector;  -- needs vector
CREATE EXTENSION IF NOT EXISTS lakebase_text;
```
Then build the hybrid Search index on `synced.creatives.description` (exact index/query DDL from the
current Lakebase Search docs — beta) and run an NL query, e.g. *"high-energy social lifestyle creative for
gen-Z apparel"*. If a Search index can't be created on a read-only synced table, seed a writable
`app.creatives_search` from `synced.creatives` and index that. Save `search_query.txt` + `search_result.json`.

### Step 5 — Representative domain query → evidence #7
Multi-table question over the synced data, e.g. *"For the 5 active underperformers with the most
recoverable spend, what is the recommended action, predicted ROAS lift, and matching winner to
replicate?"* — join `synced.campaign_position` + `synced.open_underperformers` +
`synced.action_recommendations`. Save `core_question.txt` + `core_query.sql` + `core_query_result.json`.

---

## 5. Genie Code prompts (paste in order)

**① Provision + forward sync + writable schema**
> Read `app/APP_WORKSHOP.md` §"Build 1 (Lakebase)" and `specifications/app/03_DATA_MODEL.md`. Stand up a
> **Lakebase Autoscaling** project `brightwave-campaign-desk` (Postgres 17), register it as UC catalog
> `brightwave_lakebase_tkop`, and create **managed UC synced tables** (SNAPSHOT) into a `synced` Postgres schema from
> these `brightwave_techsummit27_catalog.brightwave` tables: `gold_campaign_position` (PK campaign_id),
> `raw_creatives` (PK creative_id), `gold_open_underperformers` (PK campaign_id),
> `gold_action_recommendations` (PK campaign_id). Then create a writable Postgres schema `app` with
> `campaign_actions_app` exactly as modeled in `03_DATA_MODEL.md` plus the chat-state tables, as a
> committed SQL migration. Run `SELECT version();` and `SELECT … LIMIT 20` on `synced.campaign_position`;
> save both. Use `databricks postgres create-synced-table` for Autoscaling — do NOT use DABs
> `synced_database_tables` (that's the Provisioned API). **Each create-synced-table MUST set
> `new_pipeline_spec.storage_catalog=brightwave_techsummit27_catalog` + `storage_schema=pipeline_meta`** — a
> catalog WITH a storage root, NEVER the Lakebase catalog `brightwave_lakebase_tkop` (which has none, causing
> "Metastore storage root URL does not exist"). Create that schema first, verify each synced table reaches
> state `ONLINE` (a manual psycopg2 dump does NOT count), and set `REPLICA IDENTITY FULL` on the `app` tables.

**② Branch + agent change + promote**
> Create a Lakebase dev branch `dev-tkop` off `production` and a git branch `dev-tkop`. On both, add a
> `priority_score DOUBLE` column to `app.campaign_actions_app` via a new SQL migration, seed a couple of
> sample rows, run a validation query proving the column exists and is populated, and confirm the app still
> boots against `dev-tkop`. Then merge the git branch to `main` and apply the migration to the `production`
> Lakebase branch. Commit with a visible authorship trailer. Save the migration/diff, the validation
> result, and proof of promotion under `submission1/agent_change/`.

**③ Reverse sync (Lakebase CDF as code)**
> Set `REPLICA IDENTITY FULL` on every table in the `app` schema. Configure **Lakebase CDF** as code with
> the Terraform resource `databricks_postgres_cdf_config`:
> `parent = projects/brightwave-campaign-desk/branches/production/databases/databricks_postgres`,
> `postgres_schema = "app"`, `catalog = "brightwave_techsummit27_catalog"`, `schema = "lakebase_cdc"`.
> Confirm the destination catalog does NOT use default storage (else pick one with a managed location).
> Commit the `.tf` and apply. Then INSERT and UPDATE a few `app.campaign_actions_app` rows, wait ~20s, and
> sample `brightwave_techsummit27_catalog.lakebase_cdc.lb_campaign_actions_app_history` — show the SCD2 rows
> and the `_pg_change_type / _pg_lsn / _pg_xid / _timestamp / _sort_by` columns. Save as
> `reverse_sync_sample.json`.

**④ Lakebase Search**
> Enable Lakebase Search on `synced.creatives.description`. Run `CREATE EXTENSION IF NOT EXISTS vector;`
> then `CREATE EXTENSION IF NOT EXISTS lakebase_vector;` and `CREATE EXTENSION IF NOT EXISTS lakebase_text;`.
> Using the current Lakebase Search docs for the exact hybrid (vector + full-text) index and query syntax,
> build the index over the creative `description` and run a natural-language query like *"high-energy social
> lifestyle creative for gen-Z apparel"*. If a Search index can't be created on a read-only synced table,
> create a writable `app.creatives_search` seeded from `synced.creatives` and index that. Save the query and
> the returned records.

**⑤ Domain question**
> Write one SQL query over the synced Lakebase tables answering: *"For the 5 active underperformers with the
> most recoverable spend, what is the model's recommended action, the predicted ROAS lift, and the matching
> winner to replicate?"* Join `synced.campaign_position`, `synced.open_underperformers`, and
> `synced.action_recommendations`. Save the question, the query, and the returned rows.

---

## 6. `submission1/` evidence checklist

| # | File(s) | Step | Status |
|---|---|---|---|
| 1 | `instance.txt` — project/instance name + `SELECT version()` output | 0 | ☐ |
| 2 | `synced_table.sql` + `synced_table_result.json` (non-empty) | 1 | ☐ |
| 3 | `reverse_sync_sample.json` — SCD2 rows + `_pg_*` metadata columns | CDF | ☐ |
| 4 | `branch.txt` — Lakebase **and** git dev-branch names + changes | 2/3 | ☐ |
| 5 | `agent_change/` — diff/migration + authorship + validation result + promotion proof | 3 | ☐ |
| 6 | `search_query.txt` + `search_result.json` | 4 | ☐ |
| 7 | `core_question.txt` + `core_query.sql` + `core_query_result.json` | 5 | ☐ |
| 8 | `git_history.txt` — `git log --graph --oneline --decorate --all` (branch + merge) | 3 | ☐ |

**Package:** `cd <repo-root> && zip -r submission1.zip submission1` → upload.

---

## 7. Verification (Claude Code, via CLI profile)

As each artifact lands, paste it here and it will be validated against the spec (same SQL-API path used to
verify the 01–04 pre-work), then the verified file dropped into `submission1/`. Spot checks:
- **#2** synced-table result non-empty and matches the Delta source row for a known campaign (e.g. CMP-0000214).
- **#3** history table shows distinct `_pg_change_type` values (`insert` + `update_postimage`) after an UPDATE.
- **#5** authorship trailer present; validation query shows the new column populated; merge commit exists.
- **#6** NL query returns creatives whose `description` matches the intent.
- **#7** join returns 5 rows incl. CMP-0000214 with `recommended_action = replicate_winner`.
- **#8** graph shows `dev-tkop` branching off `main` and a merge commit back.
