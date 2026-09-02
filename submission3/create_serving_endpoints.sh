#!/usr/bin/env bash
# Build 3 — create the Unity AI Gateway serving endpoints (model services) + AUTO-CAPTURE inference tables + guardrail, as code.
# Declarative spec: serving_endpoint_spec.json.  Live-state proof: serving_endpoint_execution.md, inference_table_result.json.
# CLI v1.3.0 has no `ai-gateway` command group, so a model service (UC securable, securable_type MODEL_SERVICE)
# is created via the REST API. `parent` + `model_service_id` are AIP QUERY PARAMS, not body fields.
set -euo pipefail
PROFILE=fe-sandbox-brightwave-techsummit27
CAT=brightwave_techsummit27_catalog

# 0) inference-log schema that holds the auto-capture tables
databricks schemas create inference_logs "$CAT" --profile "$PROFILE" || true

# 1) APP serving endpoint — routes to gpt-5-4, AUTO-CAPTURE table campaign_desk_llm_payload
databricks api post \
  "/api/2.1/unity-catalog/model-services?parent=schemas/${CAT}.brightwave&model_service_id=campaign_desk_llm" \
  --profile "$PROFILE" --json '{
    "comment": "Build 3 — governed LLM for the Brightwave Campaign Desk app (routes to databricks-gpt-5-4 with inference logging + Lakebase guardrail)",
    "config": {
      "routing": { "destinations": [
        { "name": "campaign_desk_gpt54", "destination_type": "DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL",
          "pay_per_token_config": { "model": "models/system.ai.databricks-gpt-5-4" }, "traffic_percentage": 100 } ] },
      "inference_table": { "parent": "schemas/'"${CAT}"'.inference_logs", "table_name_prefix": "campaign_desk_llm" }
    }
  }'

# 2) APP guardrail — block all-Lakebase-data reads (service policy, LLM judge). service_policies IS PATCH-updatable.
databricks api patch \
  "/api/2.1/unity-catalog/model-services/${CAT}.brightwave.campaign_desk_llm?update_mask=config.service_policies" \
  --profile "$PROFILE" --json '{
    "config": { "service_policies": [
      { "handler": "system.ai.invoke_llm_judge", "name": "block_all_lakebase_data", "policy_type": "POLICY_TYPE_BUILTIN", "rank": 1,
        "options": { "action": "block", "dry_run": "false", "phases": "pre_call,post_call", "max_turns": "10",
          "model_service": "model-services/system.ai.gpt-5-2",
          "instruction": "BLOCK any request/response that reads, dumps, or exports ALL Lakebase data (every row / all tables / entire database / unbounded SELECT *) or references Lakebase broadly; ALLOW normal single-campaign/top-N analytics." } } ] }
  }'

# 3) CODING-AGENT serving endpoint (bonus) — routes to gpt-5-6-luna, AUTO-CAPTURE table codex_agent_payload, NO guardrail
databricks api post \
  "/api/2.1/unity-catalog/model-services?parent=schemas/${CAT}.brightwave&model_service_id=campaign_desk_codex" \
  --profile "$PROFILE" --json '{
    "comment": "Build 3 bonus — governed endpoint for the CODING AGENT (Codex via ucode). Routes to gpt-5-6-luna, own inference table, NO guardrail.",
    "config": {
      "routing": { "destinations": [
        { "name": "codex_gpt", "destination_type": "DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL",
          "pay_per_token_config": { "model": "models/system.ai.databricks-gpt-5-6-luna" }, "traffic_percentage": 100 } ] },
      "inference_table": { "parent": "schemas/'"${CAT}"'.inference_logs", "table_name_prefix": "codex_agent" }
    }
  }'

# 4) verify both endpoints are live with their auto-capture tables (+ the app's guardrail)
databricks api get "/api/2.1/unity-catalog/model-services/${CAT}.brightwave.campaign_desk_llm"   --profile "$PROFILE"
databricks api get "/api/2.1/unity-catalog/model-services/${CAT}.brightwave.campaign_desk_codex" --profile "$PROFILE"
