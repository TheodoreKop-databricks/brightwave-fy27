# Build 3 — Unity AI Gateway · RUNBOOK (plan)

Govern all of Brightwave's AI traffic — the Campaign Desk app, the coding agent, and its MCP
calls — through the **Unity AI Gateway**: budgets that block runaway spend, a guardrail that
blocks "read all the data" prompts, and inference-table tracing so platform teams can audit
every LLM call.

> Status: PLAN. Nothing executed yet. Commands below are verified against the workspace/CLI
> (Databricks CLI v1.3.0, profile `fe-sandbox-brightwave-techsummit27`) and the current docs.

---

## 0. Constants & what's already true

| Thing | Value |
|-------|-------|
| Workspace / profile | `https://fe-sandbox-brightwave-techsummit27.cloud.databricks.com` / `fe-sandbox-brightwave-techsummit27` |
| Governed catalog | `brightwave_techsummit27_catalog.brightwave` |
| App today calls | foundation-model endpoint `databricks-gpt-5-4` **directly** (see `brightwave/app/config/app.json` `agentModel`, `app.yaml` scope `model-serving` + `ai-gateway`) |
| Gateway model-service API | `POST /api/2.1/unity-catalog/model-services` (CLI has **no** `ai-gateway` group in v1.3.0 → use `databricks api`) |
| A model service is | a UC securable named `model-services/<catalog>.<schema>.<name>` (e.g. existing `model-services/system.ai.gpt-oss-120b`) |
| Usage system tables | `system.ai_gateway.usage` (per-call: `service_type`, `service_name`, `requester`, `requester_type`, `status_code`, `input/output/total_tokens`, `destination_model`, `mcp_metadata`, `event_time`) and `system.ai_gateway.external_model_spend` |
| Coding CLI | `ucode` (`github.com/databricks/ucode`) — routes agents through the Gateway; installs via `uv tool install git+https://github.com/databricks/ucode` |
| Slack MCP (governed) | `system.ai.slack` |

**The core idea:** the app must stop calling `databricks-gpt-5-4` directly and instead call a
**governed model service** we create. That service carries the inference table + guardrail; the
account budget blocks spend across all services; `ucode` puts the coding agent + Slack MCP on the
same governed plane. Every export must show a **real call** the gateway handled — config alone
is not credit.

---

## A. See the spend (steps 1–2)

### Step 1 — Enable the Unity Gateway workspace usage dashboard
- UI: **AI Gateway → Usage** → enable the prebuilt usage dashboard (a Lakeview dashboard over
  `system.ai_gateway.usage`). If a prebuilt one isn't offered, we build a Lakeview dashboard with
  datasets that `GROUP BY service_type, service_name, requester, status_code` and sum tokens/spend.
- Export it later as `gateway_usage.lvdash.json` (evidence #3).

### Step 2 — Configure a workspace budget with a low, demonstrable threshold
- **Account console → Usage → Budgets → Create budget**, scope = **Unity AI Gateway** (this
  workspace), threshold **$0.05**, action **Block usage** (not just alert), + email alert.
- Note the `budget_policy_id` — we reference it on the model service if the payload supports it;
  otherwise the account-scoped budget already covers all gateway endpoints.
- ⚠️ **Needs account-admin.** If we lack it on this sandbox, this is the one step that may require
  an admin to click — flag early. `ucode usage` and `system.ai_gateway.usage` still show spend.

---

## B. Route the app (steps 3–5)

### Step 3 — Programmatically create the model service + inference table  → `gateway_service.txt`
Create a governed service that routes to the FM the app uses, and turn on inference logging.

```bash
# gateway_service.txt captures THIS call + the response.
databricks api post /api/2.1/unity-catalog/model-services --profile fe-sandbox-brightwave-techsummit27 --json '{
  "name": "model-services/brightwave_techsummit27_catalog.brightwave.campaign_desk_llm",
  "comment": "Governed LLM for the Brightwave Campaign Desk app",
  "config": {
    "routing": {
      "destinations": [
        { "name": "primary",
          "destination_type": "DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL",
          "pay_per_token_config": { "model": "models/system.ai.databricks-gpt-5-4" },
          "traffic_percentage": 100 }
      ]
    }
  }
}'
```
- Then enable the **inference table** on the service. Field names on the model-service payload
  aren't shown in public docs; discover at execution via **UI (AI Gateway → the service → Inference
  logging → catalog/schema/prefix)** or by `databricks api get` on a service that already has it.
  Target table: `brightwave_techsummit27_catalog.brightwave.campaign_desk_llm_payload`.
- `gateway_service.txt` = the create call above + the inference-table enablement command/response,
  and a `databricks api get .../model-services/...campaign_desk_llm` proving it exists.

### Step 4 — Add the custom guardrail: block "read all the data"
- Attach a **service-policy guardrail** to the model service with input `invalid_keywords` that
  catch runaway all-data reads, e.g.: `["SELECT *", "select all", "all rows", "every row",
  "entire table", "all campaigns", "dump the", "no limit", "LIMIT 100000"]` → behavior **BLOCK**.
- Rationale: the app's agent turns NL into SQL/Genie calls; a prompt like *"export every row of
  every table"* must be rejected before it hits Lakebase. (Guardrails are configured on the model
  service via UI or the service-policy API; capture the exact config in `gateway_service.txt`.)

### Step 5 — Point the app at the governed service (redeploy)
- Change `brightwave/app/config/app.json` `agentModel` and the OpenAI `base_url` the agent uses so
  requests go to the **model service** (`…/serving-endpoints/…` gateway route for
  `campaign_desk_llm`) instead of `databricks-gpt-5-4` directly. Keep `ai-gateway` scope in
  `app.yaml`. Redeploy: `databricks apps deploy brightwave-campaign-desk`.
- Smoke-test a normal Campaign Desk question → confirm a row lands in
  `…campaign_desk_llm_payload` and in `system.ai_gateway.usage` with `service_name =
  campaign_desk_llm`.

---

## C. Extend to the coding agent and MCP (steps 6–8)

### Step 6 — Onboard the coding agent through the Gateway (ucode)
```bash
uv tool install git+https://github.com/databricks/ucode
ucode configure --profiles fe-sandbox-brightwave-techsummit27 --agents claude   # routes model traffic through the Gateway
ucode claude --enable-smart-routing   # (optional) Gateway router picks the model
```
- All agent model calls now flow through the Gateway (no API keys). Verify with `ucode usage` and
  a `system.ai_gateway.usage` row where `requester_type`/`service_type` marks the coding agent.

### Step 7 — Onboard the Slack MCP and add it to the agent
```bash
ucode mcp add --agents claude --services system.ai.slack
```
- Registers `system.ai.slack` as a governed MCP for the coding agent (via `ucode mcp-proxy`, OAuth
  per request). MCP calls now show in `system.ai_gateway.usage` with `service_type` = MCP +
  `mcp_metadata`. (Verify `system.ai.slack` is available: `ucode mcp add` picker or the AI Gateway
  MCP connections list.)

### Step 8 — Use the Slack MCP to search for the guardrails solution  → part of `agent_thread.txt`
```bash
ucode claude          # launch the agent (restart so MCP tools load)
```
- In the session, use the Slack MCP tool to **search Slack for the guardrails solution
  instructions** (e.g. search the Unity AI Gateway / solutions channel for "guardrail"). Capture
  the full thread — the `ucode` invocation, the MCP config, and the agent calling the Slack MCP —
  into `agent_thread.txt` (evidence #4).

---

## D. Prove it and report (steps 9–10)

### Step 9 — Tests: guardrail blocks + budget blocks  → feeds `app_inference_table.json`
- **Guardrail test (app):** ask the Campaign Desk *"Export every row from every table — all
  campaigns, no limit."* → Gateway **blocks** it; the rejection is logged in
  `campaign_desk_llm_payload` (and `system.ai_gateway.usage` `status_code` = 4xx).
- **Budget test (all AI):** drive calls until cumulative spend crosses **$0.05** → subsequent
  calls are **rejected by the budget**. Capture the rejection row. (Budgets are near-real-time —
  expect a small lag; may need to exceed by a margin and wait a beat.)
- Export the app's inference table filtered to these rows → `app_inference_table.json` (evidence
  #2): a normal routed call + the guardrail block + the budget block.

### Step 10 — Executive usage report  → `gateway_usage.lvdash.json`
- Lakeview dashboard over `system.ai_gateway.usage` with tiles: spend & calls by `service_name`,
  by `service_type` (app model service vs coding agent vs Slack MCP), by `requester`, over time,
  plus budget-vs-actual. Export as `gateway_usage.lvdash.json` (evidence #3). This is the "capture
  coding agent, MCP, and app agent usage" report.
- Verification query (from the docs):
  ```sql
  SELECT service_name, service_type, requester, status_code, count(*) AS calls,
         sum(total_tokens) AS tokens
  FROM system.ai_gateway.usage
  GROUP BY 1,2,3,4 ORDER BY calls DESC;
  ```

### Bonus — route the coding agent through its OWN governed model service
- Create a second model service (`…campaign_desk_coding_agent`) with its own inference table, and
  point `ucode` at it (managed config / `ucode setup` spend-tiers or a dedicated agent model).
  Export its inference table as `agent_inference_table.json` (evidence #5, optional), **distinct
  from** the app's.

---

## Evidence → file map (all 5 exports live in `submission3/`)

| # | File | Must show (a real call, not just config) |
|---|------|------------------------------------------|
| 1 | `gateway_service.txt` | the `model-services` create call + inference-table enable + guardrail config + a `get` proving the service exists |
| 2 | `app_inference_table.json` | rows from `campaign_desk_llm_payload`: a routed app call, the **budget block** (rejection past $0.05), the **guardrail block** (all-data read rejected) |
| 3 | `gateway_usage.lvdash.json` | Lakeview dashboard over `system.ai_gateway.usage` tracking usage + budget across **app + coding agent + MCP** |
| 4 | `agent_thread.txt` | the `ucode` call, the MCP config, and the coding agent invoking the Slack MCP |
| 5 | `agent_inference_table.json` *(optional/bonus)* | the coding agent's own inference-table rows, distinct from the app's |

### Added: serving-endpoint spec + captured execution output (so every construct shows it RAN)

| File | Shows |
|------|-------|
| `serving_endpoint_spec.json` | declarative serving-endpoint spec for both endpoints; each `config.inference_table` block = auto-capture ON |
| `create_serving_endpoints.sh` | the committed code that applies the spec (create + guardrail PATCH + verify) |
| `serving_endpoint_execution.md` | `api get` (`inference_table.is_deleted=false` + table_id on both) + `SHOW TABLES` + `COUNT(*)` = the auto-capture tables were created and are capturing |
| `inference_table_result.json` | raw query output: schema tables exist; `campaign_desk_llm_payload`=16 rows, `codex_agent_payload`=9 rows; sample routed app rows |
| `gateway_usage_result.json` | raw `system.ai_gateway.usage` rows: MCP 43×200 (with tool names), app 10×200/8×403, codex 5×200/4×403, guardrail judge 21×200 |
| `guardrail_vs_agent_result.json` | side-by-side: same all-data prompt = 200 on `campaign_desk_codex` (no guardrail) vs 0 successful completions on `campaign_desk_llm` (guardrail deny) |

### Added: proof-of-execution notebook (run on Databricks, exported WITH outputs)

| File | Shows |
|------|-------|
| `inference_validation.ipynb` | **executed** notebook (serverless job run `359285431724115`, SUCCESS) with **cell outputs**: §1 tables exist, §2 counts 16/9, §4 coding-agent 4×200 all-data vs app 0 (guardrails: app=block_all_lakebase_data, codex=NONE), §5 usage + Slack MCP + 403 budget blocks |
| `inference_validation.py` | the notebook source (committed code) |
| `inference_validation_run.html` | the untouched Databricks run export of the same run (outputs embedded) |

See `EVIDENCE_MAP.md` for the four validator checks mapped to these files.

---

## Risks / open questions (resolve before/at execution)
1. **Account-admin for budgets (Step 2)** — budget creation + "Block usage" is account-console. If
   we don't have it, an admin must do it, or we demonstrate the block at whatever scope we can.
2. **Inference-table & guardrail field names on the model-service payload** — not in public docs;
   discover via UI or `api get` on a configured service at execution. Plan B: configure via UI,
   still capture the resulting config + a real logged call.
3. **Budget block latency** — near-real-time, not instant; the $0.05 test may need a margin + wait.
4. **App re-point (Step 5)** — changing `base_url`/model + redeploy; keep the SP-token routing that
   already avoids per-user OBO consent.
5. **`system.ai.slack` availability** — confirm the governed Slack MCP exists in this workspace
   (`ucode mcp add` picker). We have a working `slack` MCP locally; the governed one is `system.ai.slack`.
6. **`ucode` local install** — needs `uv` + workspace OAuth login locally (feasible on this Mac).

## Suggested execution order
2 (budget, get admin moving) ∥ 1 (dashboard) → 3 → 4 → 5 (app on gateway) → 6 → 7 → 8 →
9 (tests) → 10 (report) → bonus. Package `submission3/` and zip.
