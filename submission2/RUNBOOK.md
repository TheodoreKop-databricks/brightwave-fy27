# Build 2 · Databricks Apps — Runbook & Evidence Plan (Brightwave Campaign Desk)

Plan for **Build 2 (Databricks Apps)** of the Tech Summit FY27 AI Customer Challenge. The app is the
**Visualize → Assist → Act** decision loop over the Build-1 Lakebase data. Execution is driven by
**Genie Code** in the workspace; **Claude Code (CLI profile)** verifies each artifact and assembles
`submission2/`.

> Validator scores Build 2 against the `submission2/` folder only. Zip `submission2/` and upload.
> **Decisions locked:** trigger = **table-update** Databricks Job · client = **full polish** per `01_OPERATIONS.md`.

---

## 0. Constants

| Name | Value |
|---|---|
| CLI profile | `fe-sandbox-brightwave-techsummit27` |
| Databricks App name | `brightwave-campaign-desk` |
| Lakebase project (Build 1) | `brightwave-campaign-desk` — branches `production` (demo) + `dev-tkop` (build) |
| Lakebase UC catalog (Build 1) | `brightwave_lakebase_tkop` |
| Read-only synced schema (Postgres) | `synced` (campaign_position, creatives, open_underperformers, action_recommendations) |
| Writable app schema (Postgres) | `app` (campaign_actions_app, **workflow_events**, conversations/messages/feedback) |
| Source catalog.schema (governed UC data) | `brightwave_techsummit27_catalog.brightwave` |
| Agent model | `databricks-gpt-5-4` (Responses-API baseline; **not** an Anthropic endpoint — those 400 on `/responses`) |
| Genie space (`ask_data`) | `01f1a26fadc51614a203f762ffb368d4` |
| AI/BI dashboard (embed) | `01f1a26fed4516b98df68d6ff9e84d65` |
| SQL warehouse | `01083f0176292242` |
| Lakebase Search index (Build 1) | hybrid index over `synced.creatives.description` |
| git dev branch | `dev-tkop` — commit **layer-by-layer**, merge to `main` to demo |
| Trigger | Databricks Job (DABs) with **table-update** trigger on `gold_campaign_position` + `gold_action_recommendations` |

---

## 1. What ships vs. what we build

| Piece | State | Build 2 work |
|---|---|---|
| Plumbing (OBO, MLflow, SSE, chat dock, migrations) | ✅ ships | — |
| `ask_data` (Genie) tool | ✅ ships | point at the Genie space |
| **Visualize** client surface | ❌ still LuxeBeauty **returns** UI | **full rekey → Campaign Desk** |
| `find_underperformer`, `rank_actions`, `search_creatives` | ⛔ stubs (throw) | **implement (Assist)** |
| `execute_campaign_action` | ⛔ stub (throw) | **implement (Act)** |
| Data reads via boot-time `sync.ts` mirror | ✅ ships | **repoint to Build-1 `synced.*` tables** |
| **Trigger + `app.workflow_events` (observability)** | ❌ absent | **new (challenge-specific)** |

---

## 2. Architecture & the closed loop

- **Read** the Build-1 managed synced tables (`synced.*`) — never the app's own re-mirror, never write them.
- **Write** only to `app.*`: `campaign_actions_app` (actions/audit) and `workflow_events` (state/observability).
- **Loop:** the trigger **surfaces** (flags on a live view) → the agent **prescribes** (ranked action + why + what-if + drafted brief) → a person **approves** → the app **acts** (writes to Postgres) → the next read reflects it (closed loop). That's "a decision, not a dashboard" (requirement #4).

**`app.workflow_events`** (the state/observability table — evidence #2):
```sql
CREATE TABLE IF NOT EXISTS app.workflow_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,               -- 'scoring_trigger' | 'decision'
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor       text,                         -- 'system:job' (trigger) | approver email (decision)
  campaign_id text,                          -- set on decisions
  action_id   uuid,                          -- links to app.campaign_actions_app.id (decisions)
  payload     jsonb NOT NULL DEFAULT '{}',   -- trigger: {campaigns_scored, underperformers_flagged, winners}; decision: {action_type, predicted_roas_lift}
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.workflow_events REPLICA IDENTITY FULL;   -- Build-1 CDF is schema-level on `app`, so this streams to UC too
```

---

## 3. The trigger — table-update Job (event-driven, low-latency, idle when nothing changed)

Fires **only when the gold scoring tables actually commit new data** (not on a clock, not always-on). Job task
refreshes the Lakebase synced tables and logs a `scoring_trigger` event. Defined as code in DABs:

```yaml
# resources/score_refresh.job.yml
resources:
  jobs:
    brightwave_score_refresh:
      name: "[Brightwave] Score refresh -> workflow_events (table-update trigger)"
      trigger:
        table_update:
          table_names:
            - brightwave_techsummit27_catalog.brightwave.gold_campaign_position
            - brightwave_techsummit27_catalog.brightwave.gold_action_recommendations
          condition: ANY_UPDATED                 # verify exact field names against current Jobs/DABs docs
          min_time_between_triggers_seconds: 60
          wait_after_last_change_seconds: 30
      tasks:
        - task_key: refresh_synced                # re-snapshot the SNAPSHOT synced tables
          pipeline_task:
            pipeline_id: ${SYNCED_TABLE_PIPELINE_ID}
        - task_key: log_event
          depends_on: [{ task_key: refresh_synced }]
          notebook_task:
            notebook_path: ../transformation/score_refresh_log.py
          environment_key: default
      environments:
        - environment_key: default
          spec: { client: "4", dependencies: ["databricks-sdk", "psycopg[binary]"] }
```
`score_refresh_log.py` queries gold for the counts, connects to Lakebase (`generate-database-credential` → psycopg),
and `INSERT`s one `scoring_trigger` row into `app.workflow_events`. Latency ≈ tens of seconds after gold commits;
zero compute when nothing changed. Each firing is a meaningful "data changed → re-scored" event in `state_table.json`.

> If you'd ever want true real-time, switch synced tables to CONTINUOUS (~15s) — but that's always-on, which we deliberately avoided.

---

## 4. Layers → actions → evidence

`export DATABRICKS_CONFIG_PROFILE=fe-sandbox-brightwave-techsummit27`

### Layer 0 — Wire + deploy (deploy-first for SP schema ownership)
- Config: `GENIE_SPACE_ID`, `DASHBOARD_ID`, `WAREHOUSE_ID=01083f0176292242`, `DEMO_CATALOG=brightwave_techsummit27_catalog`,
  `DEMO_SCHEMA=brightwave`, `agentModel=databricks-gpt-5-4`; Lakebase project `brightwave-campaign-desk` branch `dev-tkop`.
- Repoint `server/db` reads to `synced.*`; keep writes in `app.*`.
- `databricks apps deploy brightwave-campaign-desk`, then **grant the app SP**:
  ```sql
  GRANT USAGE ON SCHEMA synced TO "<SP_CLIENT_ID>";
  GRANT SELECT ON ALL TABLES IN SCHEMA synced TO "<SP_CLIENT_ID>";
  GRANT USAGE, CREATE ON SCHEMA app TO "<SP_CLIENT_ID>";
  GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO "<SP_CLIENT_ID>";
  ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO "<SP_CLIENT_ID>";
  ```
  (SP client id from `databricks apps get brightwave-campaign-desk`.) **#1 Lakebase permission gotcha** — deploy before running locally.

### Layer 1 — Visualize (+ trigger + state) → evidence #2, #3
Full-polish Campaign Desk per `specifications/app/01_OPERATIONS.md`: header + "Ask the assistant" banner; **3 KPI cards**
(Recoverable spend / Underperformers / ROAS gap); the **ROAS×spend scatter** (color by `perf_band`, size by spend,
CMP-0000214 the zoom target); **underperformer queue** (status tabs All/Underperformers/Has matching winner/No match/
Action taken; search; channel+category filters; sortable by recoverable spend / ROAS / spend; columns campaign / channel /
category / ROAS / matching-winner / recoverable spend / recommended-action badge / status); **detail drawer** (Campaign tab
with matching winner + ranked actions + Approve/Override + **creative-search box** → Build-1 Lakebase Search; Trend tab ROAS
sparkline; Activity tab timeline). Rewrite `HomeView.tsx` copy (Priya persona, headline, situation, goal, starter chips,
featured action). Rekey `config/queries/*.sql` per `02_ANALYTICS.md` (`roas_trend`, `worst_underperformers`,
`perf_mix_by_channel`, `action_mix`) and update `AnalyticsView.tsx` `queryKey`s. Add `app.workflow_events` +
`REPLICA IDENTITY FULL`. Add the table-update Job (§3). Save the queue query → `view_query.sql`; its rows → `view_result.json`.

### Layer 2 — Assist → evidence #4, #5
Implement `find_underperformer`, `rank_actions`, `search_creatives` per `app/APP_WORKSHOP.md` §Layer 2.
**`search_creatives` queries the Build-1 Lakebase Search index over `synced.creatives.description`** — not a separate
vector store. Agent: explain why CMP-0000214 is flagged, what-if from `action_ranking`, draft the on-brand brief grounded
on Search hits. Run one **explanation** + one **what-if** turn → `assist_log.jsonl` (request + model response). Save the
brief → `drafted_sample.md`.

### Layer 3 — Act → evidence #1 (+ closes loop, adds decision to #2)
Implement `execute_campaign_action` per `app/APP_WORKSHOP.md` §Layer 3: after approval, one transaction writes
`app.campaign_actions_app` (status `proposed`→`approved`, `approved_by`=OBO email, `drafted_brief`, `predicted_roas_lift`,
`created_at`, `decided_at`) **and** inserts a `decision` row into `app.workflow_events`. Keep the approval gate. Verify the
closed loop (dataMutated → desk refetches → CMP-0000214 flips to "action taken", underperformer KPI ticks down). Export
`app.campaign_actions_app` → `writeback_table.json`; `app.workflow_events` → `state_table.json`. Write `hero_question.txt`.
Merge `dev-tkop` → `main`; export `git_history.txt`.

---

## 5. Genie Code prompts (paste per layer)

**⓪ Wire + deploy**
> In `app/`, wire the bootstrap to Build 1: set `GENIE_SPACE_ID=01f1a26fadc51614a203f762ffb368d4`,
> `DASHBOARD_ID=01f1a26fed4516b98df68d6ff9e84d65`, `WAREHOUSE_ID=01083f0176292242`,
> `DEMO_CATALOG=brightwave_techsummit27_catalog`, `DEMO_SCHEMA=brightwave`, `agentModel=databricks-gpt-5-4`. Point Lakebase
> at project `brightwave-campaign-desk` branch `dev-tkop`. Change the data reads in `server/db` to use the Build-1 managed
> synced tables in Postgres schema `synced` (campaign_position, creatives, open_underperformers, action_recommendations)
> instead of re-mirroring via `sync.ts`; keep all writes in schema `app`. Deploy to Databricks Apps, then grant the app's
> service principal `SELECT` on `synced` and `USAGE/CREATE/SELECT/INSERT/UPDATE` on `app`. Confirm it boots and reads
> `campaign_position`. Commit "Layer 0: wire + deploy".

**① Visualize + trigger + state**
> Layer 1 — Visualize, full polish per `specifications/app/01_OPERATIONS.md`. Rekey the client from the returns template to
> a Campaign Desk: header + "Ask the assistant" banner; 3 KPI cards (recoverable spend, underperformers, ROAS gap); a
> ROAS×spend scatter colored by `perf_band` (size by spend, CMP-0000214 as the zoom target); an underperformer queue with
> status tabs (All / Underperformers / Has matching winner / No match / Action taken), search, channel+category filters,
> sortable by recoverable spend / ROAS / spend, columns campaign / channel / category / ROAS / matching-winner / recoverable
> spend / recommended-action badge / status; and a detail drawer with a Campaign tab (matching winner + ranked actions +
> Approve/Override + a creative-search box wired to the Build-1 Lakebase Search index), a Trend tab (ROAS sparkline), and an
> Activity tab (timeline). Rewrite `HomeView.tsx` (Priya persona, headline, situation, goal, starter chips, featured action).
> Rekey `config/queries/*.sql` per `02_ANALYTICS.md` and update `AnalyticsView.tsx`. All reads hit the Build-1 `synced.*`
> tables. Add a writable `app.workflow_events` table (id, event_type, occurred_at, actor, campaign_id, action_id, payload
> jsonb, created_at) and `ALTER TABLE app.workflow_events REPLICA IDENTITY FULL`. Add a Databricks Job as code in DABs with a
> **table-update trigger** on `brightwave_techsummit27_catalog.brightwave.gold_campaign_position` and
> `gold_action_recommendations` (NOT a cron): when they commit, refresh the Lakebase synced tables and insert a
> `scoring_trigger` row into `app.workflow_events` with counts (campaigns scored, underperformers flagged, winners). Save the
> queue query as `view_query.sql` and its rows as `view_result.json`. Deploy. Commit "Layer 1: Visualize + trigger + state".

**② Assist**
> Layer 2 — Assist. Implement `find_underperformer`, `rank_actions`, and `search_creatives` in
> `server/agent/campaigndesk.ts` per `app/APP_WORKSHOP.md` §Layer 2. `search_creatives` MUST query the **Build-1 Lakebase
> Search index** over `synced.creatives.description` (hybrid), not a separate vector store. Make the agent explain why
> CMP-0000214 is flagged, support a what-if from `action_ranking`, and draft an on-brand campaign brief grounded on the
> Search results. Run two chat turns — an explanation ("why is CMP-0000214 underperforming and what's winning?") and a
> what-if ("what if we replicate the winner — projected lift and net value?") — and export both to `assist_log.jsonl`
> (request + model response). Save the drafted brief as `drafted_sample.md`. Deploy. Commit "Layer 2: Assist".

**③ Act**
> Layer 3 — Act. Implement `execute_campaign_action` per `app/APP_WORKSHOP.md` §Layer 3: after human approval, in one
> transaction write the approved action to `app.campaign_actions_app` (status proposed→approved, `approved_by` from OBO
> `userEmail`, `drafted_brief`, `predicted_roas_lift`, `created_at`, `decided_at`) AND insert a `decision` event into
> `app.workflow_events` (actor=approver, campaign_id, action_id, payload {action_type, predicted_roas_lift}). Keep the
> approval gate. Verify the closed loop: after approval the desk refetches and CMP-0000214 flips to "action taken" with the
> underperformer KPI ticking down. Export `app.campaign_actions_app` → `writeback_table.json` and `app.workflow_events` →
> `state_table.json`. Write `hero_question.txt` with the hero question and the linked record IDs (CMP-0000214 → matching
> winner → recommended_action → campaign_actions_app.id / approved_by → workflow_events decision id). Deploy. Commit
> "Layer 3: Act", merge `dev-tkop` → `main`, and export `git log --graph --oneline --decorate --all` to `git_history.txt`.

---

## 6. `submission2/` evidence checklist

| # | File | Layer | Status |
|---|---|---|---|
| 1 | `writeback_table.json` — action, approval status + approver, created + committed timestamps | Act | ☐ |
| 2 | `state_table.json` — `workflow_events`: trigger events + decisions + timestamps | Visualize + Act | ☐ |
| 3 | `view_query.sql` + `view_result.json` | Visualize | ☐ |
| 4 | `assist_log.jsonl` — ≥1 explanation + ≥1 what-if (request + response) | Assist | ☐ |
| 5 | `drafted_sample.md` | Assist | ☐ |
| 6 | `hero_question.txt` — hero Q + linked record IDs (decision chain) | Act | ☐ |
| 7 | `git_history.txt` — layer-by-layer on `dev-tkop` off `main` | all | ☐ |

**Package:** `cd <repo-root> && zip -r submission2.zip submission2` → upload.

---

## 7. Dependencies & sequencing

- **Build-1 Lakebase Search** (Step 4) must exist before Layer 2 `search_creatives`.
- **Build against `dev-tkop`** (Lakebase + git); **demo from `production`/`main`**.
- **Deploy per layer**, commit per layer — the git history is graded for the layer-by-layer build (evidence #7).
- **Agent model = `databricks-gpt-5-4`** only (Anthropic endpoints 400 on the Responses passthrough). Build 3 fronts this endpoint with Unity AI Gateway.

## 8. Verification (Claude Code, via CLI profile)

As each artifact lands, paste it here for validation against the spec, then it's dropped into `submission2/`:
- **#3** view query returns the ranked queue with CMP-0000214 flagged `underperformer`, sorted by recoverable spend.
- **#2** `workflow_events` shows both a `scoring_trigger` row (from the Job) and a `decision` row (from the approval), timestamped.
- **#1** `campaign_actions_app` row has `status=approved`, an approver email, and `created_at` < `decided_at`.
- **#4** `assist_log.jsonl` has one explanation turn and one what-if turn, each with request + model response.
- **#6** the record IDs in `hero_question.txt` resolve across #1/#2/#3 (CMP-0000214 → winner → action_id → decision event).
- **#7** graph shows Layer 0→1→2→3 commits on `dev-tkop` and the merge to `main`.
