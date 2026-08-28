# Validation: dev-tkop branch — priority_score column

## Lakebase branch
- Project: `brightwave-campaign-desk`
- Branch: `dev-tkop`
- Endpoint: `ep-restless-tooth-d8b0vmys.database.us-east-2.cloud.databricks.com`

## Migration applied
```sql
ALTER TABLE app.campaign_actions_app
  ADD COLUMN IF NOT EXISTS priority_score DOUBLE PRECISION;
```

## Seed data inserted
```sql
INSERT INTO app.campaign_actions_app (campaign_id, action_type, target_campaign_id, drafted_brief, predicted_roas_lift, status, priority_score, audit_trail)
VALUES
  ('CMP-0000214', 'replicate_winner', 'CMP-0000634', '...', 2.234, 'proposed', 0.92, ...),
  ('CMP-0000610', 'reallocate_budget', 'CMP-0000501', '...', 0.85, 'proposed', 0.67, ...);
```

## Validation query result
```
SELECT id, campaign_id, action_type, predicted_roas_lift, status, priority_score, created_at
FROM app.campaign_actions_app ORDER BY priority_score DESC;
```

| id | campaign_id | action_type | predicted_roas_lift | status | priority_score | created_at |
|----|-------------|-------------|---------------------|--------|----------------|------------|
| 6b223564-... | CMP-0000214 | replicate_winner | 2.234 | proposed | **0.92** | 2026-08-28T20:30:37Z |
| d4dff09d-... | CMP-0000610 | reallocate_budget | 0.85 | proposed | **0.67** | 2026-08-28T20:30:37Z |
| c6021f0f-... | CMP-0000214 | replicate_winner | 2.2343 | approved | NULL | 2026-08-28T18:49:43Z |
| f749881e-... | CMP-0000214 | replicate_winner | 2.2343 | approved | NULL | 2026-08-28T19:21:56Z |
| d2b99d39-... | CMP-0001141 | reallocate_budget | 0.8899 | approved | NULL | 2026-08-28T19:27:04Z |

## Conclusion
- ✅ `priority_score` column exists on dev branch
- ✅ New rows have priority_score populated (0.92, 0.67)
- ✅ Existing rows have NULL (backward compatible)
- ✅ Production branch unaffected (still 11 columns, no priority_score)
