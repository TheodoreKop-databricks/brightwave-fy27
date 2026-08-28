#!/usr/bin/env bash
# ============================================================================
# BUILD 1 — Lakebase branch creation captured as CODE (+ scale-to-zero config)
# ============================================================================
# Two branch uses off the production root branch:
#   1. dev-tkop          — development iteration (coding-agent schema change)
#   2. forecast-scenario — throwaway forecasting branch (TTL 7 days)
#
# Run:  DATABRICKS_CONFIG_PROFILE=fe-sandbox-brightwave-techsummit27 bash create_branches.sh
# Live state (both READY) captured in branches_result.json.

set -euo pipefail
PROFILE="${DATABRICKS_CONFIG_PROFILE:-fe-sandbox-brightwave-techsummit27}"
PROJ="brightwave-campaign-desk"
ROOT="projects/${PROJ}/branches/production"

# 0) Git — the development branch off main (named dev-tkop). Committed, iterated,
#    then merged back to main after the change was promoted (see git_history.txt).
git checkout -b dev-tkop main

# 1) Development branch — permanent, for iterating on schema/data changes.
databricks postgres create-branch "projects/${PROJ}" dev-tkop --profile "$PROFILE" \
  --json "{\"spec\":{\"source_branch\":\"${ROOT}\",\"no_expiry\":true}}"

# 2) Throwaway forecasting branch — copy-on-write, auto-expires after 7 days,
#    so a what-if scenario costs nothing to keep around.
databricks postgres create-branch "projects/${PROJ}" forecast-scenario --profile "$PROFILE" \
  --json "{\"spec\":{\"source_branch\":\"${ROOT}\",\"ttl\":\"604800s\"}}"

# ── Scale-to-zero / cost: lower the autoscaling floor to 0.5 CU on the branch
#    endpoints so idle branches cost close to nothing. (Autoscaling endpoints
#    also SUSPEND to zero compute after the branch's idle suspend_timeout.)
for BR in dev-tkop forecast-scenario; do
  databricks postgres update-endpoint \
    "projects/${PROJ}/branches/${BR}/endpoints/primary" spec.autoscaling_limit_min_cu \
    --json '{"spec":{"autoscaling_limit_min_cu":0.5}}' --profile "$PROFILE"
done

echo "Branches created and scaled down. Verify: databricks postgres list-branches projects/${PROJ}"
