#!/usr/bin/env bash
# ============================================================================
# BUILD 1 — Sync defined as CODE (reproducible), not UI-only.
# ============================================================================
# Forward sync: Unity Catalog Delta (gold_*) -> Lakebase Postgres synced.* mirror.
#
# NOTE on tooling: for Lakebase *Autoscaling* projects, synced tables are NOT yet
# supported by DAB (`postgres_synced_tables`) or the Terraform
# `databricks_synced_database_table` resource (that maps to the Provisioned API).
# The supported, scriptable path is the CLI `create-synced-table` — captured here
# as code so the sync is reproducible. The REVERSE sync (Postgres -> UC Delta) IS
# defined as Terraform in lakebase_cdf.tf.
#
# Run:  DATABRICKS_CONFIG_PROFILE=fe-sandbox-brightwave-techsummit27 bash sync_as_code.sh
# Live ONLINE status of these tables is captured in synced_status.json.

set -euo pipefail
PROFILE="${DATABRICKS_CONFIG_PROFILE:-fe-sandbox-brightwave-techsummit27}"
SRC_CATALOG="brightwave_techsummit27_catalog"
SRC_SCHEMA="brightwave"
# storage_catalog MUST be a storage-backed regular catalog (NOT the storage-less
# Lakebase catalog) — the DLT pipeline writes its event log there.
STORAGE_CATALOG="brightwave_techsummit27_catalog"
STORAGE_SCHEMA="pipeline_meta"

# synced_table_id  |  source gold/raw table  |  primary key
create_synced () {
  local ID="$1" SRC="$2" PK="$3"
  databricks postgres create-synced-table "brightwave_lakebase_tkop.synced.${ID}" \
    --profile "$PROFILE" --json "$(cat <<JSON
{
  "spec": {
    "source_table_full_name": "${SRC_CATALOG}.${SRC_SCHEMA}.${SRC}",
    "primary_key_columns": ["${PK}"],
    "scheduling_policy": "TRIGGERED",
    "new_pipeline_spec": {
      "storage_catalog": "${STORAGE_CATALOG}",
      "storage_schema": "${STORAGE_SCHEMA}"
    }
  }
}
JSON
)"
}

create_synced "campaign_position"      "gold_campaign_position"      "campaign_id"
create_synced "creatives"              "raw_creatives"               "creative_id"
create_synced "open_underperformers"   "gold_open_underperformers"   "campaign_id"
create_synced "action_recommendations" "gold_action_recommendations" "campaign_id"

echo "Submitted 4 synced-table creates. Poll with: databricks postgres get-synced-table synced_tables/brightwave_lakebase_tkop.synced.<table>"
