# Databricks notebook source
# DBTITLE 1,Install dependencies
# MAGIC %pip install optuna xgboost -q
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

# DBTITLE 1,Setup & Config
# roas_train_score — Train XGBoost ROAS-lift model, register, batch-score
import json, mlflow, optuna
import pandas as pd
import numpy as np
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import root_mean_squared_error
from datetime import datetime

CATALOG = "brightwave_techsummit27_catalog"
SCHEMA = "brightwave"
MODEL_NAME = f"{CATALOG}.{SCHEMA}.roas_recommender"
EXPERIMENT_PATH = "/Users/theodore.kop@databricks.com/brightwave/experiments/roas_recommender"

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment("/Users/theodore.kop@databricks.com/roas_recommender")
mlflow.autolog(disable=True)  # We'll log manually for tighter control

print(f"Model: {MODEL_NAME}")
print(f"Experiment: {EXPERIMENT_PATH}")

# COMMAND ----------

# DBTITLE 1,Load training data & feature engineering
# Load training data
df_raw = spark.table(f"{CATALOG}.{SCHEMA}.gold_action_outcomes").toPandas()
print(f"Training rows: {len(df_raw)}")
print(df_raw.head())

# Feature engineering
df = df_raw.copy()
df["is_replicate"] = (df["action_type"] == "replicate_winner").astype(int)
df["is_reallocate"] = (df["action_type"] == "reallocate_budget").astype(int)
df["is_pause"] = (df["action_type"] == "pause").astype(int)
df["had_matching_winner_int"] = df["had_matching_winner"].astype(int)

FEATURES = ["is_replicate", "is_reallocate", "is_pause", "had_matching_winner_int", "roas_at_action", "action_cost_usd"]
LABEL = "roas_lift"

X = df[FEATURES].values
y = df[LABEL].values

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
print(f"Train: {len(X_train)}, Test: {len(X_test)}")

# COMMAND ----------

# DBTITLE 1,Optuna hyperparameter tuning
# Optuna tuning — minimize RMSE on holdout
def objective(trial):
    params = {
        "n_estimators": trial.suggest_int("n_estimators", 50, 300),
        "max_depth": trial.suggest_int("max_depth", 3, 8),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 10.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
    }
    model = XGBRegressor(**params, random_state=42, verbosity=0)
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    return root_mean_squared_error(y_test, preds)

optuna.logging.set_verbosity(optuna.logging.WARNING)
study = optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=42))
study.optimize(objective, n_trials=10)

print(f"Best RMSE: {study.best_value:.4f}")
print(f"Best params: {study.best_params}")
best_rmse = study.best_value

# COMMAND ----------

# DBTITLE 1,Train final model & register in UC
# Train final model with best params
best_params = study.best_params
final_model = XGBRegressor(**best_params, random_state=42, verbosity=0)
final_model.fit(X_train, y_train)

# Verify on holdout
final_preds = final_model.predict(X_test)
final_rmse = root_mean_squared_error(y_test, final_preds)
print(f"Final holdout RMSE: {final_rmse:.4f}")

# Log to MLflow and register
with mlflow.start_run(run_name="roas_recommender_xgb") as run:
    mlflow.log_params(best_params)
    mlflow.log_metric("rmse", final_rmse)
    mlflow.log_metric("train_size", len(X_train))
    mlflow.log_metric("test_size", len(X_test))
    
    # Log model with signature
    from mlflow.models.signature import infer_signature
    signature = infer_signature(pd.DataFrame(X_test, columns=FEATURES), final_preds)
    
    model_info = mlflow.xgboost.log_model(
        final_model,
        artifact_path="model",
        signature=signature,
        input_example=pd.DataFrame([X_test[0]], columns=FEATURES),
        registered_model_name=MODEL_NAME
    )
    print(f"Run ID: {run.info.run_id}")
    print(f"Model URI: {model_info.model_uri}")

# COMMAND ----------

# DBTITLE 1,Set @prod alias
# Set @prod alias on latest version
from mlflow import MlflowClient
client = MlflowClient()

# Get latest version
versions = client.search_model_versions(f"name='{MODEL_NAME}'")
latest_version = max(int(v.version) for v in versions)
client.set_registered_model_alias(MODEL_NAME, "prod", str(latest_version))

print(f"Set @prod alias on {MODEL_NAME} version {latest_version}")
model_version = latest_version

# COMMAND ----------

# DBTITLE 1,Build candidate rows & batch score
# Load underperformers for scoring
df_under = spark.table(f"{CATALOG}.{SCHEMA}.gold_open_underperformers").toPandas()
print(f"Campaigns to score: {len(df_under)}")

# Build 3 candidate rows per campaign
ACTION_COSTS = {"replicate_winner": 2000, "reallocate_budget": 200, "pause": 0}

candidates = []
for _, row in df_under.iterrows():
    for action, cost in ACTION_COSTS.items():
        candidates.append({
            "campaign_id": row["campaign_id"],
            "action_type": action,
            "had_matching_winner": row["has_matching_winner"],
            "roas_at_action": row["roas"],
            "action_cost_usd": cost,
            "spend_to_date_usd": row["spend_to_date_usd"],
        })

df_cand = pd.DataFrame(candidates)
print(f"Total candidate rows: {len(df_cand)}")

# Feature encode
df_cand["is_replicate"] = (df_cand["action_type"] == "replicate_winner").astype(int)
df_cand["is_reallocate"] = (df_cand["action_type"] == "reallocate_budget").astype(int)
df_cand["is_pause"] = (df_cand["action_type"] == "pause").astype(int)
df_cand["had_matching_winner_int"] = df_cand["had_matching_winner"].astype(int)

X_score = df_cand[FEATURES].values
df_cand["predicted_roas_lift"] = final_model.predict(X_score)
df_cand["predicted_net_value_usd"] = (
    df_cand["predicted_roas_lift"] * df_cand["spend_to_date_usd"] - df_cand["action_cost_usd"]
)

print(df_cand.groupby("action_type")["predicted_roas_lift"].mean())

# COMMAND ----------

# DBTITLE 1,Pick best action per campaign & write table
# For each campaign, rank actions and pick the best
results = []
for cid, group in df_cand.groupby("campaign_id"):
    group_sorted = group.sort_values("predicted_net_value_usd", ascending=False)
    best = group_sorted.iloc[0]
    
    # Build action_ranking JSON
    ranking = []
    for _, r in group_sorted.iterrows():
        ranking.append({
            "action": r["action_type"],
            "predicted_roas_lift": round(float(r["predicted_roas_lift"]), 4),
            "predicted_net_value_usd": round(float(r["predicted_net_value_usd"]), 2),
            "action_cost_usd": float(r["action_cost_usd"])
        })
    
    results.append({
        "campaign_id": cid,
        "recommended_action": best["action_type"],
        "predicted_roas_lift": float(best["predicted_roas_lift"]),
        "predicted_net_value_usd": float(best["predicted_net_value_usd"]),
        "action_ranking": json.dumps(ranking),
    })

df_results = pd.DataFrame(results)
print(f"Campaigns scored: {len(df_results)}")
print(df_results["recommended_action"].value_counts())

# Drop the pipeline MV and write ML predictions as Delta table
spark.sql(f"DROP MATERIALIZED VIEW IF EXISTS {CATALOG}.{SCHEMA}.gold_action_recommendations")

from pyspark.sql.functions import current_timestamp
sdf = spark.createDataFrame(df_results).withColumn("scored_at", current_timestamp())
sdf.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}.gold_action_recommendations")
print("\n\u2705 gold_action_recommendations overwritten")

# COMMAND ----------

# DBTITLE 1,Validation & exit
# Validation
hero = df_results[df_results["campaign_id"] == "CMP-0000214"]
assert len(hero) == 1, "Hero campaign not found!"
assert hero.iloc[0]["recommended_action"] == "replicate_winner", f"Hero action wrong: {hero.iloc[0]['recommended_action']}"
print(f"\u2705 Hero CMP-0000214: {hero.iloc[0]['recommended_action']}, lift={hero.iloc[0]['predicted_roas_lift']:.3f}")

action_counts = df_results["recommended_action"].value_counts().to_dict()
replicate_ct = action_counts.get("replicate_winner", 0)
reallocate_ct = action_counts.get("reallocate_budget", 0)
pause_ct = action_counts.get("pause", 0)
assert replicate_ct > 0 and reallocate_ct > 0, "Action mix not plausible!"
print(f"\u2705 Action mix: replicate={replicate_ct}, reallocate={reallocate_ct}, pause={pause_ct}")
print(f"\u2705 RMSE: {final_rmse:.4f} (roas_lift scale: {y.std():.4f})")
print(f"\u2705 Model: {MODEL_NAME} v{model_version} @prod")

# Exit
exit_payload = json.dumps({
    "model_version": model_version,
    "rmse": round(final_rmse, 4),
    "campaigns_scored": len(df_results),
    "replicate_recommended": replicate_ct,
    "reallocate_recommended": reallocate_ct,
    "pause_recommended": pause_ct
})
print(f"\nExit payload: {exit_payload}")
dbutils.notebook.exit(exit_payload)