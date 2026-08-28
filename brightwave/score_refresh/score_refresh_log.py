# Databricks notebook source
# ---------------------------------------------------------------------------
# Brightwave — score-refresh trigger task (Build 2, table-update trigger).
#
# Invoked ONLY when gold_campaign_position or gold_action_recommendations
# actually commit new data (the Job's table_update trigger — event-driven, idle
# when nothing changed). Each firing means "data changed -> re-scored", so this
# task:
#   1. (best-effort) refreshes the managed Lakebase synced tables so the app's
#      reads reflect the new gold data,
#   2. computes the scoring counts from gold,
#   3. logs ONE `scoring_trigger` row into app.workflow_events (the state /
#      observability table) with those counts.
#
# Lakebase auth: POST /api/2.0/postgres/credentials { endpoint } -> { token };
# the token is the Postgres password (OAuth, ~1h). No PGPASSWORD stored.
# ---------------------------------------------------------------------------
import json
import psycopg
from databricks.sdk import WorkspaceClient

dbutils.widgets.text("catalog", "brightwave_techsummit27_catalog")
dbutils.widgets.text("schema", "brightwave")
dbutils.widgets.text("pghost", "ep-delicate-mountain-d8kizg3e.database.us-east-2.cloud.databricks.com")
dbutils.widgets.text("pgdatabase", "brightwave_lakebase_tkop")
dbutils.widgets.text("pguser", "")  # Postgres role; defaults to the run-as identity
dbutils.widgets.text("lakebase_endpoint", "projects/brightwave-campaign-desk/branches/production/endpoints/primary")
dbutils.widgets.text("synced_pipeline_id", "")  # optional: managed synced-table refresh pipeline

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
pghost = dbutils.widgets.get("pghost")
pgdatabase = dbutils.widgets.get("pgdatabase")
pguser = dbutils.widgets.get("pguser").strip()
endpoint = dbutils.widgets.get("lakebase_endpoint")
pipeline_id = dbutils.widgets.get("synced_pipeline_id").strip()

w = WorkspaceClient()
if not pguser:
    pguser = w.current_user.me().user_name

# 1) Best-effort refresh of the managed synced tables (skipped if no pipeline id).
if pipeline_id:
    try:
        w.pipelines.start_update(pipeline_id=pipeline_id)
        print(f"[score_refresh] triggered synced-table pipeline {pipeline_id}")
    except Exception as e:  # noqa: BLE001
        print(f"[score_refresh] synced-table refresh skipped: {e}")
else:
    print("[score_refresh] no synced_pipeline_id supplied — relying on the managed sync")

# 2) Scoring counts from gold (the 'data changed -> re-scored' signal).
cp = f"{catalog}.{schema}.gold_campaign_position"
r = spark.sql(
    f"SELECT COUNT(*) AS c, "
    f"       COUNT_IF(perf_band='underperformer') AS u, "
    f"       COUNT_IF(perf_band='winner') AS wn "
    f"FROM {cp}"
).first()
payload = {
    "campaigns_scored": int(r["c"]),
    "underperformers_flagged": int(r["u"]),
    "winners": int(r["wn"]),
}
print("[score_refresh] counts:", payload)

# 3) Log the scoring_trigger event into Lakebase app.workflow_events.
cred = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": endpoint})
token = cred["token"]

with psycopg.connect(
    host=pghost, dbname=pgdatabase, user=pguser, password=token, sslmode="require"
) as conn:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO app.workflow_events (event_type, actor, payload) "
            "VALUES (%s, %s, %s::jsonb)",
            ("scoring_trigger", "system:job", json.dumps(payload)),
        )
    conn.commit()

print("[score_refresh] inserted scoring_trigger row into app.workflow_events")
