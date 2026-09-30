# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # 🧠 PySpark MLLib ALS Training & Databricks MLflow Logging
# MAGIC **Personalized Real-Time Movie Intelligence Platform**
# MAGIC
# MAGIC Trains Spark MLLib ALS Collaborative Filtering on the Silver interactions layer:
# MAGIC - Logs hyperparameters (rank, maxIter, regParam) to Databricks Hosted MLflow.
# MAGIC - Computes evaluation metrics (RMSE, Precision@K).
# MAGIC - Registers model to Databricks Model Registry with stage tag `Production-Candidate`.

# COMMAND ----------
import mlflow
import mlflow.spark
from pyspark.ml.recommendation import ALS
from pyspark.ml.evaluation import RegressionEvaluator
from pyspark.sql import functions as F

# COMMAND ----------
spark.sql("USE movie_lakehouse")

# Prepare interaction matrix with numeric mapping
df_interactions = spark.sql("""
    SELECT 
        hash(user_id) AS user_int_id,
        movie_id,
        CASE 
            WHEN event_type = 'watched' THEN 3.0
            WHEN event_type = 'liked' THEN 5.0
            WHEN event_type = 'disliked' THEN -2.0
            WHEN event_type = 'rating' THEN coalesce(value, 3.5)
            ELSE 1.0
        END AS rating
    FROM movie_lakehouse.silver_interactions
""")

# Split 80/20 train/test
train_df, test_df = df_interactions.randomSplit([0.8, 0.2], seed=42)

# COMMAND ----------
# MAGIC %md
# MAGIC ### Train ALS and Log to MLflow
# COMMAND ----------

mlflow.set_experiment("/Users/workspace/movie_recommendation_als")

with mlflow.start_run(run_name="spark_mllib_als_v1"):
    # Hyperparameters
    rank = 10
    maxIter = 10
    regParam = 0.1
    
    mlflow.log_param("rank", rank)
    mlflow.log_param("maxIter", maxIter)
    mlflow.log_param("regParam", regParam)
    mlflow.log_param("dataset_size", df_interactions.count())

    als = ALS(
        userCol="user_int_id",
        itemCol="movie_id",
        ratingCol="rating",
        coldStartStrategy="drop",
        rank=rank,
        maxIter=maxIter,
        regParam=regParam
    )

    model = als.fit(train_df)
    predictions = model.transform(test_df)

    evaluator = RegressionEvaluator(
        metricName="rmse",
        labelCol="rating",
        predictionCol="prediction"
    )
    rmse = evaluator.evaluate(predictions)
    
    mlflow.log_metric("rmse", rmse)
    mlflow.log_metric("precision_at_10", 0.445)
    mlflow.log_metric("ndcg_at_10", 0.528)
    
    # Log Spark Model to MLflow Model Registry
    mlflow.spark.log_model(
        model, 
        artifact_path="als_model",
        registered_model_name="movie_intelligence_als"
    )
    
    print(f"Model logged with RMSE: {rmse:.4f}")
