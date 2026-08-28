# Promotion Proof: priority_score migration — dev-tkop → production

The coding-agent's change (`001_add_priority_score.sql`) was developed and validated on
the Lakebase **dev-tkop** branch, then **promoted to production**. Verified live.

## 1. Lakebase promotion (dev-tkop → production)
The migration was applied to the **production** branch after validation on dev-tkop.

Live verification on production (2026-08-28):
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='app' AND table_name='campaign_actions_app'
  AND column_name='priority_score';
```
| column_name | data_type |
|---|---|
| priority_score | double precision |

✅ Column present on **production** (`ep-delicate-mountain-d8kizg3e…`).
✅ Column also present on **dev-tkop** (`ep-restless-tooth-d8b0vmys…`) where it was first built.

## 2. Git promotion (dev-tkop → main)
The migration is committed with authorship, and the branch was merged to `main`:

| commit | subject | role |
|--------|---------|------|
| `cb56838` | feat: add priority_score column to campaign_actions_app | the agent change (adds `agent_change/001_add_priority_score.sql`) |
| `690f07a` | Merge branch 'dev-tkop' into main | merge |
| `bff0431` | merge: dev-tkop -> main (priority_score migration) | promotion merge |

Authorship trailer on the migration commit (see `migration_commit.txt`):
```
Author: theodore.kop@databricks.com <theodore.kop@databricks.com>
Authored-by: Genie-Code-Agent <theodore.kop@databricks.com>
```
Full graph in `../git_history.txt` (`git log --graph --oneline --decorate --all`) shows
`dev-tkop` off `main` and the merge that promoted the change.

## Summary
| Step | Branch | Status |
|------|--------|--------|
| Create Lakebase dev branch | dev-tkop | ✅ |
| Apply ALTER TABLE + seed | dev-tkop | ✅ |
| Validate priority_score (isolated) | dev-tkop | ✅ (0.92, 0.67) |
| Promote ALTER TABLE | production | ✅ (verified live) |
| Commit migration w/ authorship | dev-tkop | ✅ (cb56838) |
| Merge dev-tkop → main | main | ✅ (690f07a / bff0431) |
| Reverse-sync sees the new column | UC (lakebase_cdc) | ✅ (priority_score flows into lb_*_history) |
