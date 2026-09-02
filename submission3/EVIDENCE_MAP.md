# Build 3 — Evidence Map (Brightwave · Unity AI Gateway)

All of Brightwave's AI traffic — the **Campaign Desk app**, the **coding agent** (Codex via ucode),
and the **Slack MCP** — is governed through the **Unity AI Gateway**: a $0.05 block-usage budget,
a guardrail that blocks all-Lakebase-data reads, and inference-table tracing on every model call.
Every export below is paired with **captured execution output** (real rows from the inference tables
and from `system.ai_gateway.usage`), not just configuration.

| # | Required export | File(s) | Proves (with captured execution output) |
|---|-----------------|---------|-----------------------------------------|
| 1 | Serving-endpoint spec + inference-table (auto-capture), as code | `serving_endpoint_spec.json`, `create_serving_endpoints.sh` | Declarative spec for both serving endpoints; each `config.inference_table` block turns on auto-capture |
| 1e | …proof it RAN | `serving_endpoint_execution.md`, `inference_table_result.json` | `api get` shows `inference_table.is_deleted=false` + table_id on both; `SHOW TABLES` + `COUNT(*)` (16 / 9) prove the tables were auto-created and are capturing |
| 2 | App inference table — routed calls + budget block + guardrail block | `app_inference_table.json` | Routed 200s logged to `campaign_desk_llm_payload`; guardrail deny; budget block; **§4 cross-checks all of it against `system.ai_gateway.usage` (10×200, 8×403, judge fired 21×)** |
| 3 | Gateway usage dashboard across app + coding agent + MCP | `gateway_usage.lvdash.json` | Published Lakeview dashboard over `system.ai_gateway.usage` — app, coding agent (shared + own), Slack MCP, guardrail judge; references the $0.05 budget |
| 3e | …the usage rows behind the dashboard | `gateway_usage_result.json` | Real aggregate + detail rows: MCP 43×200, app 10×200/8×403, codex 5×200/4×403, judge 21×200 |
| 4 | Coding-agent thread: ucode + MCP config + agent calling Slack MCP | `agent_thread.txt` | `ucode configure` + `ucode configure mcp --services system.ai.slack`; **EXECUTION EVIDENCE section embeds the real MCP tool-call rows** (`slack_search_public_and_private`, `slack_read_thread`, 43×200) |
| 5 | [BONUS] Coding agent's own inference table, distinct from app's | `agent_inference_table.json`, `guardrail_vs_agent_result.json` | Codex routed through its own endpoint `campaign_desk_codex` (own table `codex_agent_payload`, NO guardrail); the all-data prompt the app blocks logs at **200** here — side-by-side query proof |
| 1s | Model-service create script + working call | `gateway_service.txt` | `POST …/model-services` create + guardrail PATCH + a real routed call |

## Proof-of-execution NOTEBOOK (run on Databricks, exported WITH cell outputs)

`inference_validation.ipynb` — a Databricks notebook **executed as a real serverless job run**
(job `359285431724115`, task run `706954360863574`, `result_state=SUCCESS`) and exported **with its
cell outputs**. `inference_validation.py` is the notebook source; `inference_validation_run.html` is the
untouched Databricks run export (same run; outputs embedded in the `DATABRICKS_NOTEBOOK_MODEL` blob).
The notebook's rendered outputs prove — in one executed artifact — every check below:

- §1 `SHOW TABLES` → the inference-log schema + both auto-capture tables exist.
- §2 counts → `campaign_desk_llm_payload`=16, `codex_agent_payload`=9 (tables are capturing).
- §4a → the coding agent's 4 all-data reads logged at **status 200, blocked_by_guardrail=False**.
- §4b → `coding_agent_all_data_succeeded_200 = 4` vs `app_all_data_succeeded_200 = 0`.
- §4c → `APP campaign_desk_llm guardrails = ['block_all_lakebase_data']` vs `CODING AGENT campaign_desk_codex guardrails = NONE`.
- §5/5a/5b → gateway usage per surface, Slack MCP tool calls, and the 403 budget blocks.

## The four validator checks → where the execution evidence now lives

- **"The serving-endpoint spec enables the inference table (auto-capture)"** → `serving_endpoint_spec.json` + `create_serving_endpoints.sh` (the spec/construct) **and** `serving_endpoint_execution.md` + **`inference_validation.ipynb` §1–2** (`SHOW TABLES`, `COUNT(*)` run with outputs) + `inference_table_result.json`.
- **"Catalog and inference table created by committed code"** → **`inference_validation.ipynb` §1–2 (executed notebook with outputs)** — the schema + both `_payload` tables exist and hold 16 / 9 rows; also `inference_table_result.json`.
- **"The submission thread shows the governed Slack MCP was used"** → `agent_thread.txt` EXECUTION EVIDENCE section + **`inference_validation.ipynb` §5a** + `gateway_usage_result.json`: 43×200 MCP calls with real tool names (`slack_search_public_and_private`, `slack_read_thread`), `server_type=SYSTEM`.
- **"The agent's inference table shows it is not bound by the app's all-data guardrail"** → **`inference_validation.ipynb` §4a/4b/4c (executed, with outputs)**: identical all-data prompt = **4×200 on `campaign_desk_codex`** (guardrails=NONE) vs **0 successful completions on `campaign_desk_llm`** (guardrails=block_all_lakebase_data); also `guardrail_vs_agent_result.json` + `agent_inference_table.json` §execution_evidence.

## The governance story (technical requirements)
- **Budget blocks calls exceeding $x** — `brightwave-techsummit27-tkop`, **$0.05**, `BLOCK_USAGE`, workspace-scoped. Live proof: 12 × HTTP 403 in `system.ai_gateway.usage` across **both** the app and coding-agent endpoints (`gateway_usage_result.json`), after real 200s on the same services (before/after).
- **Guardrail prevents all Lakebase data being read** — `block_all_lakebase_data` (LLM-judge service policy) on the app's endpoint; the judge (`system.ai.gpt-5-2`) fired 21×; 0 successful all-data completions in the app table.
- **Inference-table tracing for all LLM calls** — `inference_logs.campaign_desk_llm_payload` (app) + `inference_logs.codex_agent_payload` (coding agent); plus account-wide `system.ai_gateway.usage`.
- **Extend governance to the coding agent + MCP** — ucode routes Codex model calls through the gateway; the Slack MCP (`system.ai.slack`) is proxied through `/ai-gateway/mcp-services/system.ai.slack`. Both appear in `system.ai_gateway.usage`.
- **[Bonus] Coding agent on its own governed endpoint** — `campaign_desk_codex` with its own inference table and **no** app guardrail (distinct governance).

## Live resources
- Serving endpoints (model services): `…brightwave.campaign_desk_llm` (app, id `a3cf8e52…`), `…brightwave.campaign_desk_codex` (coding agent, id `18888418…`)
- Auto-capture inference tables: `…inference_logs.campaign_desk_llm_payload` (16 rows), `…inference_logs.codex_agent_payload` (9 rows)
- Budget: `brightwave-techsummit27-tkop` (id `fb753278-c203-4d0b-8e26-88cf797e2ca6`), $0.05, BLOCK_USAGE
- Dashboard: "Brightwave Unity AI Gateway - Exec Usage" (id `01f1a343a6e713799239ee9edcd04886`)
- Deployed app routes its agent model through the gateway (`agentModel=…campaign_desk_llm`, `baseURL=…/ai-gateway/openai/v1`)

Supporting: `RUNBOOK.md` (the plan/narrative).
