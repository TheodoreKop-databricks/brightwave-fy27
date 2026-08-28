# Promotion Proof: dev-tkop → production

## Lakebase promotion
- Migration `001_add_priority_score.sql` applied to **production** branch
- Timestamp: 2026-08-28T20:32:xx UTC
- Endpoint: `ep-delicate-mountain-d8kizg3e.database.us-east-2.cloud.databricks.com`

## Verification on production
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = 'campaign_actions_app'
  AND column_name = 'priority_score';
```

| column_name | data_type |
|---|---|
| priority_score | double precision |

✅ Column exists on production.

## Git merge
- Branch `dev-tkop` merged to `main`
- Commit message includes authorship trailer: `Authored-by: Genie-Code-Agent <theodore.kop@databricks.com>`

## Summary
| Step | Branch | Status |
|------|--------|--------|
| Create Lakebase dev branch | dev-tkop | ✅ |
| Apply ALTER TABLE | dev-tkop | ✅ |
| Seed rows | dev-tkop | ✅ |
| Validate priority_score | dev-tkop | ✅ |
| Apply ALTER TABLE (promote) | production | ✅ |
| Git merge dev-tkop → main | main | ✅ |
