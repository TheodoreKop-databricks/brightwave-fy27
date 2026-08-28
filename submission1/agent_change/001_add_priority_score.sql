-- Migration: 001_add_priority_score
-- Author: theodore.kop@databricks.com (via Genie Code agent)
-- Date: 2026-08-28
-- Target: brightwave-campaign-desk / brightwave_lakebase_tkop / app.campaign_actions_app
-- Description: Add priority_score column to rank agent-proposed actions by urgency/impact.

ALTER TABLE app.campaign_actions_app
  ADD COLUMN IF NOT EXISTS priority_score DOUBLE PRECISION;

COMMENT ON COLUMN app.campaign_actions_app.priority_score IS
  'Agent-computed priority score (0-1) combining predicted ROAS lift, spend at risk, and time sensitivity.';
