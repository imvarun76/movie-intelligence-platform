# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # 📊 Databricks Feature Store Integration
# MAGIC **Personalized Real-Time Movie Intelligence Platform**
# MAGIC
# MAGIC Demonstrates registering and querying feature tables in Databricks Feature Store:
# MAGIC - `user_features`: rolling interaction velocities, preferred genres, cold start status.
# MAGIC - `movie_features`: decayed popularity, Bayesian score, primary genre.
# MAGIC - Supports point-in-time time-travel lookups to prevent data leakage during training!

# COMMAND ----------
from pyspark.sql import functions as F
from databricks.feature_engineering import FeatureEngineeringClient

fe = FeatureEngineeringClient()

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Compute User Feature Set
# COMMAND ----------
spark.sql("USE movie_lakehouse")

user_features_df = spark.sql("""
    SELECT 
        user_id,
        count(1) AS interaction_count,
        CASE 
            WHEN count(1) = 0 THEN 'new'
            WHEN count(1) <= 15 THEN 'sparse'
            ELSE 'mature'
        END AS cold_start_tier,
        round(count(CASE WHEN occurred_at >= date_sub(current_timestamp(), 7) THEN 1 END) / 7.0, 3) AS rolling_7d_velocity,
        current_timestamp() AS feature_timestamp
    FROM movie_lakehouse.silver_interactions
    GROUP BY user_id
""")

# Register in Databricks Feature Store
try:
    fe.create_table(
        name="movie_lakehouse.user_features",
        primary_keys=["user_id"],
        timestamp_keys="feature_timestamp",
        df=user_features_df,
        description="Real-time user engagement features and cold-start tiers"
    )
    print("Created Feature Store table: movie_lakehouse.user_features")
except Exception as e:
    print(f"Table exists or updated via write_table: {e}")
    fe.write_table(
        name="movie_lakehouse.user_features",
        df=user_features_df,
        mode="merge"
    )

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. Compute Movie Feature Set
# COMMAND ----------

movie_features_df = spark.sql("""
    SELECT
        movie_id,
        bayesian_weighted_rating AS bayesian_quality_score,
        round(popularity * exp(-0.05 * greatest(0, year(current_date()) - release_year)), 3) AS popularity_decayed,
        current_timestamp() AS feature_timestamp
    FROM movie_lakehouse.silver_movies
""")

try:
    fe.create_table(
        name="movie_lakehouse.movie_features",
        primary_keys=["movie_id"],
        timestamp_keys="feature_timestamp",
        df=movie_features_df,
        description="Movie quality and decayed popularity feature dimensions"
    )
    print("Created Feature Store table: movie_lakehouse.movie_features")
except Exception as e:
    fe.write_table(
        name="movie_lakehouse.movie_features",
        df=movie_features_df,
        mode="merge"
    )

print("Databricks Feature Store tables synchronized.")
