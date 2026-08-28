# Operational schema — EXECUTION evidence (it ran)

Live proof that the modeled operational schema in `operational_schema.sql` actually ran on the
Lakebase **production** branch (`brightwave-campaign-desk` / `brightwave_lakebase_tkop`). This is
a runnable transcript: each command is followed by its real output from the running database.

---

## 1. Re-run the schema DDL idempotently — tables already exist (so it ran before)

```console
$ databricks psql --project brightwave-campaign-desk --branch production -- \
      -d brightwave_lakebase_tkop -e -f operational_schema.sql

CREATE SCHEMA
psql:operational_schema.sql:34: NOTICE:  relation "campaign_actions_app" already exists, skipping
CREATE TABLE
psql:operational_schema.sql:52: NOTICE:  relation "workflow_events" already exists, skipping
CREATE TABLE
psql:operational_schema.sql:63: NOTICE:  relation "conversations" already exists, skipping
CREATE TABLE
psql:operational_schema.sql:80: NOTICE:  relation "messages" already exists, skipping
CREATE TABLE
psql:operational_schema.sql:86: NOTICE:  relation "feedback" already exists, skipping
CREATE TABLE
psql:operational_schema.sql:98: NOTICE:  relation "creatives_search" already exists, skipping
CREATE TABLE
psql:operational_schema.sql:102: NOTICE:  relation "creatives_search_bm25" already exists, skipping
CREATE INDEX
```
Every `CREATE TABLE`/`CREATE INDEX` reports **"already exists, skipping"** — the objects are live.

---

## 2. `\d` describe the live tables — columns, primary keys, and foreign keys exist

```console
$ \d app.campaign_actions_app
                             Table "app.campaign_actions_app"
       Column        |           Type           | Nullable |      Default
---------------------+--------------------------+----------+-------------------
 id                  | uuid                     | not null | gen_random_uuid()
 campaign_id         | text                     | not null |
 action_type         | text                     | not null |
 ... (target_campaign_id, drafted_brief, predicted_roas_lift, status, approved_by, audit_trail,
      created_at, decided_at) ...
 priority_score      | double precision         |          |      -- added by the coding agent, promoted
Indexes:
    "campaign_actions_app_pkey" PRIMARY KEY, btree (id)
Referenced by:
    TABLE "app.workflow_events" CONSTRAINT "fk_workflow_events_action" FOREIGN KEY (action_id) REFERENCES app.campaign_actions_app(id)

$ \d app.workflow_events
Indexes:
    "workflow_events_pkey" PRIMARY KEY, btree (id)
Foreign-key constraints:
    "fk_workflow_events_action" FOREIGN KEY (action_id) REFERENCES app.campaign_actions_app(id)

$ \d app.messages
Indexes:
    "messages_pkey" PRIMARY KEY, btree (id)
Foreign-key constraints:
    "messages_conversation_id_conversations_id_fk" FOREIGN KEY (conversation_id) REFERENCES app.conversations(id) ON DELETE CASCADE
Referenced by:
    TABLE "app.feedback" CONSTRAINT "feedback_message_id_messages_id_fk" FOREIGN KEY (message_id) REFERENCES app.messages(id) ON DELETE CASCADE

$ \d app.feedback
Indexes:
    "feedback_pkey" PRIMARY KEY, btree (id)
Foreign-key constraints:
    "feedback_message_id_messages_id_fk" FOREIGN KEY (message_id) REFERENCES app.messages(id) ON DELETE CASCADE

$ \d app.conversations
Indexes:
    "conversations_pkey" PRIMARY KEY, btree (id)
Referenced by:
    TABLE "app.messages" CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY (conversation_id) REFERENCES app.conversations(id) ON DELETE CASCADE
```

**Modeled domain (live relationships):**
```
conversations 1───* messages 1───* feedback          (assist domain,  ON DELETE CASCADE)
campaign_actions_app 1───* workflow_events            (action/decision domain)
creatives_search                                      (searchable catalog, PK creative_id)
```

---

## 3. The tables hold data (the schema is in use)

```console
$ SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='app' ORDER BY relname;
```
| table | rows |
|-------|------|
| campaign_actions_app | 5 |
| conversations | 4 |
| creatives_search | 400 |
| feedback | 1 |
| messages | 28 |
| workflow_events | 4 |

Machine-readable constraint/row snapshot: `operational_schema_result.json` and `writable_tables_result.json`.
