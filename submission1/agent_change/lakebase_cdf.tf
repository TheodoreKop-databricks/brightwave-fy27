# Lakebase CDF (Lakehouse Sync) — Reverse ETL from Postgres app schema to Delta
# Authored-by: Genie-Code-Agent <theodore.kop@databricks.com>
# Date: 2026-08-28

resource "databricks_postgres_cdf_config" "app_reverse_sync" {
  parent          = "projects/brightwave-campaign-desk/branches/production/databases/db-rdqm-ocqwpsc3po"
  cdf_config_id   = "app"
  postgres_schema = "app"
  catalog         = "brightwave_techsummit27_catalog"
  schema          = "lakebase_cdc"
}

# Prerequisites (applied via SQL before this resource):
#   ALTER TABLE app.campaign_actions_app REPLICA IDENTITY FULL;
#   ALTER TABLE app.conversations        REPLICA IDENTITY FULL;
#   ALTER TABLE app.messages             REPLICA IDENTITY FULL;
#   ALTER TABLE app.feedback             REPLICA IDENTITY FULL;
#
# Target schema must exist:
#   CREATE SCHEMA IF NOT EXISTS brightwave_techsummit27_catalog.lakebase_cdc;
#
# Catalog must have a managed storage location (not metastore default):
#   Storage Root: s3://brightwave-techsummit27-ext-s3-332745928618-vld1m3/
