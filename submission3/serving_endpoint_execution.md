# Build 3 — serving-endpoint spec: execution evidence (auto-capture inference tables ran)

**Spec (as code):** `serving_endpoint_spec.json` · **Apply script:** `create_serving_endpoints.sh`
**Captured:** 2026-08-29 · workspace `fe-sandbox-brightwave-techsummit27` · profile `fe-sandbox-brightwave-techsummit27`

The spec declares two Unity AI Gateway serving endpoints, each with an `inference_table` block that turns on
**automatic inference-table capture**. This file proves the spec is live and the tables were auto-created and
are capturing — not just declared. Raw query output: `inference_table_result.json`.

---

## 1. Both serving endpoints are LIVE with auto-capture enabled

```
$ databricks api get /api/2.1/unity-catalog/model-services/brightwave_techsummit27_catalog.brightwave.campaign_desk_llm
  name:                 model-services/brightwave_techsummit27_catalog.brightwave.campaign_desk_llm
  id:                   a3cf8e52-af3d-443b-b60f-3825db7addb2
  create_time:          2026-08-28T23:02:22.667Z   (created_by theodore.kop@databricks.com)
  config.routing:       campaign_desk_gpt54 -> models/system.ai.databricks-gpt-5-4  (100%)
  config.inference_table.is_deleted:   false                       <-- AUTO-CAPTURE ACTIVE
  config.inference_table.table:        tables/brightwave_techsummit27_catalog.inference_logs.campaign_desk_llm_payload
  config.inference_table.table_id:     2d110da3-d0d9-4ea0-acd5-943d1b93cb9f
  config.service_policies:             [ block_all_lakebase_data (system.ai.invoke_llm_judge, action=block) ]

$ databricks api get /api/2.1/unity-catalog/model-services/brightwave_techsummit27_catalog.brightwave.campaign_desk_codex
  name:                 model-services/brightwave_techsummit27_catalog.brightwave.campaign_desk_codex
  id:                   18888418-5281-4783-9cc0-5065809773d7
  create_time:          2026-08-29T00:59:40.936Z
  config.routing:       codex_gpt -> models/system.ai.databricks-gpt-5-6-luna  (100%)
  config.inference_table.is_deleted:   false                       <-- AUTO-CAPTURE ACTIVE
  config.inference_table.table:        tables/brightwave_techsummit27_catalog.inference_logs.codex_agent_payload
  config.inference_table.table_id:     2f0ac1ea-5f11-4b46-9b88-24af5c93c7a3
  config.service_policies:             []                          <-- NO guardrail (distinct governance)
```

`is_deleted: false` on `config.inference_table` = the auto-capture table is provisioned and active for each endpoint.

## 2. The catalog/schema + both auto-capture tables exist (created by the committed spec)

```
$ SHOW TABLES IN brightwave_techsummit27_catalog.inference_logs;
  inference_logs   campaign_desk_llm_payload   false     <-- app endpoint's auto-capture table
  inference_logs   codex_agent_payload         false     <-- coding-agent endpoint's auto-capture table
  inference_logs   coding_agent_payload        false     (superseded first attempt; kept for history)
```

## 3. The tables are actively CAPTURING (row counts > 0)

```
$ SELECT COUNT(*) FROM brightwave_techsummit27_catalog.inference_logs.campaign_desk_llm_payload;   -> 16
$ SELECT COUNT(*) FROM brightwave_techsummit27_catalog.inference_logs.codex_agent_payload;         ->  9
```

## 4. Sample auto-captured rows from the app endpoint (real routed calls to gpt-5.4)

```
event_time                 status  latency_ms  destination_model   request (head)                                                        response.model
2026-08-28 23:04:09.724    200     2644        campaign_desk_gpt54 "which Brightwave campaign is the hero underperformer ..."             gpt-5.4-2026-03-05
2026-08-28 23:07:20.434    200     2126        campaign_desk_gpt54 "why social+testimonial creative beats display for gen_z apparel ..." gpt-5.4-2026-03-05
2026-08-28 23:07:24.001    200     1933        campaign_desk_gpt54 "good next action for an underperforming campaign with a winner ..."  gpt-5.4-2026-03-05
2026-08-28 23:07:27.502    200     1734        campaign_desk_gpt54 "one KPI a CMO should watch for return on ad spend ..."               gpt-5.4-2026-03-05
```

Every column above is the auto-capture schema written by the gateway (`event_time, request_id, status_code,
latency_ms, request, response, destination_model, api_type, requester, …`) — the app writes no logs itself.

**Conclusion:** the serving-endpoint spec (`serving_endpoint_spec.json`, applied by `create_serving_endpoints.sh`)
enables the auto-capture inference table, and the tables exist and are populated with real handled calls.
