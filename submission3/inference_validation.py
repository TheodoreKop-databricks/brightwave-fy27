# Databricks notebook source
# MAGIC %md
# MAGIC # Build 3 — Unity AI Gateway: inference-table & guardrail validation
# MAGIC
# MAGIC This notebook is the **execution proof** for Build 3. Running it against the live workspace shows that:
# MAGIC 1. the inference-log **catalog/schema + both auto-capture inference tables** were created and are capturing (not just declared as code);
# MAGIC 2. **[bonus]** the coding agent's endpoint is **NOT bound by the app's `block_all_lakebase_data` guardrail** — the same all-data prompt succeeds on the coding agent's table but is blocked on the app's.
# MAGIC
# MAGIC Everything below runs read-only SQL against Unity Catalog + `system.ai_gateway.usage` (no AI Gateway model calls, so the $0.05 budget block does not affect it). Export this notebook **with cell outputs** as the committed evidence.

# COMMAND ----------

CAT = "brightwave_techsummit27_catalog"
WS  = "7474647541759877"
APP_TABLE   = f"{CAT}.inference_logs.campaign_desk_llm_payload"   # app endpoint  (guardrail: block_all_lakebase_data)
CODEX_TABLE = f"{CAT}.inference_logs.codex_agent_payload"         # coding-agent endpoint (NO guardrail)
print("App endpoint inference table  :", APP_TABLE)
print("Coding-agent inference table  :", CODEX_TABLE)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Catalog + inference tables created by committed code — they EXIST
# MAGIC (`serving_endpoint_spec.json` / `create_serving_endpoints.sh` declared them; this proves the gateway auto-created them.)

# COMMAND ----------

display(spark.sql(f"SHOW TABLES IN {CAT}.inference_logs"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Both auto-capture tables are actively CAPTURING (row counts > 0)

# COMMAND ----------

display(spark.sql(f"""
  SELECT 'campaign_desk_llm_payload (app)'      AS inference_table, COUNT(*) AS captured_rows FROM {APP_TABLE}
  UNION ALL
  SELECT 'codex_agent_payload (coding agent)'   AS inference_table, COUNT(*) AS captured_rows FROM {CODEX_TABLE}
  ORDER BY inference_table
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Sample auto-captured rows from the APP endpoint (real routed calls to gpt-5.4)

# COMMAND ----------

display(spark.sql(f"""
  SELECT event_time, status_code, latency_ms, destination_model, api_type,
         substring(request, 1, 150) AS request_head
    FROM {APP_TABLE}
   WHERE status_code = 200
   ORDER BY event_time
   LIMIT 5
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. [BONUS] Coding agent is NOT bound by the app's all-data guardrail — the two tables side by side
# MAGIC
# MAGIC The exact same *"export EVERY row from EVERY table … dump the entire database"* prompt:
# MAGIC - **coding agent endpoint (`campaign_desk_codex`, no guardrail)** → logged at **status 200** (processed, not blocked)
# MAGIC - **app endpoint (`campaign_desk_llm`, guardrail on)** → **0 successful all-data completions** (guardrail denies it pre-call, so it never reaches the model / the table)

# COMMAND ----------

# Note the OUTER parentheses: keeps the OR-group intact when combined with `AND status_code = 200` below.
ALLDATA = ("(lower(request) LIKE '%every row%' OR lower(request) LIKE '%entire database%' "
           "OR lower(request) LIKE '%dump the entire%' OR lower(request) LIKE '%all rows from every%')")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 4a. Coding agent — the all-data read SUCCEEDED (status 200, no guardrail block)

# COMMAND ----------

display(spark.sql(f"""
  SELECT event_time, status_code,
         substring(request,  1, 220) AS all_data_prompt,
         substring(response, 1, 220) AS response_head,
         (response LIKE '%databricks_service_policy%' OR response LIKE '%content_filter%') AS blocked_by_guardrail
    FROM {CODEX_TABLE}
   WHERE {ALLDATA}
   ORDER BY event_time
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 4b. Side-by-side count — coding agent all-data SUCCEEDS, app all-data NEVER completes

# COMMAND ----------

display(spark.sql(f"""
  SELECT
    (SELECT COUNT(*) FROM {CODEX_TABLE} WHERE {ALLDATA} AND status_code = 200) AS coding_agent_all_data_succeeded_200,
    (SELECT COUNT(*) FROM {APP_TABLE}   WHERE {ALLDATA} AND status_code = 200) AS app_all_data_succeeded_200
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 4c. Why: the guardrail is bound to the APP endpoint only (coding agent has none)

# COMMAND ----------

from databricks.sdk import WorkspaceClient
w = WorkspaceClient()
for svc in ["campaign_desk_llm", "campaign_desk_codex"]:
    r = w.api_client.do("GET", f"/api/2.1/unity-catalog/model-services/{CAT}.brightwave.{svc}")
    pols = [p.get("name") for p in r.get("config", {}).get("service_policies", [])]
    role = "APP" if svc == "campaign_desk_llm" else "CODING AGENT"
    print(f"{role:12s}  {svc:20s}  guardrails = {pols if pols else 'NONE'}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Gateway usage — every surface handled real calls (app, coding agent, guardrail judge, Slack MCP) + budget block

# COMMAND ----------

display(spark.sql(f"""
  SELECT service_type, service_name, status_code,
         COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS total_tokens,
         MIN(event_time) AS first_seen, MAX(event_time) AS last_seen
    FROM system.ai_gateway.usage
   WHERE workspace_id = '{WS}'
   GROUP BY service_type, service_name, status_code
   ORDER BY service_type, calls DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5a. Governed Slack MCP tool calls (proves the MCP was actually used)

# COMMAND ----------

display(spark.sql(f"""
  SELECT event_time, status_code,
         mcp_metadata.tool_name  AS tool,
         mcp_metadata.server_type AS server_type
    FROM system.ai_gateway.usage
   WHERE workspace_id = '{WS}'
     AND service_type = 'MCP_SERVICE' AND service_name = 'system.ai.slack'
     AND mcp_metadata.tool_name IS NOT NULL AND mcp_metadata.tool_name <> ''
   ORDER BY event_time
   LIMIT 15
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5b. Budget block — HTTP 403 across BOTH endpoints once the $0.05 cap crossed

# COMMAND ----------

display(spark.sql(f"""
  SELECT event_time, service_name, status_code, url
    FROM system.ai_gateway.usage
   WHERE workspace_id = '{WS}' AND status_code = 403
     AND service_type = 'MODEL_SERVICE' AND service_name LIKE 'brightwave%'
   ORDER BY event_time
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC **Result:** the catalog + both auto-capture inference tables exist and are populated (§1–3); the coding agent's
# MAGIC endpoint processes the all-data prompt that the app's guardrail blocks (§4); and every gateway surface — including
# MAGIC the governed Slack MCP — handled real calls, with the $0.05 budget enforced as 403s (§5). This notebook's executed
# MAGIC cell outputs are the committed proof-of-execution.
