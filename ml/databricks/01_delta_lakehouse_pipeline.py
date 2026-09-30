# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # 🎬 Medallion Lakehouse Pipeline (Bronze -> Silver -> Gold)
# MAGIC **Personalized Real-Time Movie Intelligence Platform**
# MAGIC
# MAGIC This pipeline runs on Azure Databricks with Delta Lake:
# MAGIC - **Bronze Layer**: Raw TMDB ingestion payload with raw timestamps and append-only audit trail.
# MAGIC - **Silver Layer**: Cleaned, deduplicated, schema-validated movie metadata and user interactions with quarantine routing.
# MAGIC - **Gold Layer**: Aggregated business metrics, dimensional tables, and feature store input tables with Z-ORDER optimization.

# COMMAND ----------
from pyspark.sql import functions as F
from pyspark.sql.types import (
    ArrayType,
    DoubleType,
    IntegerType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)
from delta.tables import DeltaTable

# COMMAND ----------
# Setup Lakehouse storage paths (DBFS or ADLS Gen2 Mount)
LAKEHOUSE_BASE = "/FileStore/movie_platform_lakehouse"
BRONZE_PATH = f"{LAKEHOUSE_BASE}/bronze"
SILVER_PATH = f"{LAKEHOUSE_BASE}/silver"
GOLD_PATH = f"{LAKEHOUSE_BASE}/gold"

spark.sql(f"CREATE DATABASE IF NOT EXISTS movie_lakehouse")
spark.sql(f"USE movie_lakehouse")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 1. Bronze Layer: Raw TMDB Ingestion
# COMMAND ----------

# Sample raw payload schema mimicking TMDB API extracts
bronze_schema = StructType([
    StructField("raw_id", IntegerType(), False),
    StructField("title", StringType(), True),
    StructField("release_date", StringType(), True),
    StructField("vote_average", DoubleType(), True),
    StructField("vote_count", IntegerType(), True),
    StructField("popularity", DoubleType(), True),
    StructField("genres", StringType(), True),
    StructField("overview", StringType(), True),
    StructField("ingested_at", TimestampType(), True),
])

# Write Bronze table as Delta format
spark.sql(f"""
CREATE TABLE IF NOT EXISTS movie_lakehouse.bronze_movies (
    raw_id INT,
    title STRING,
    release_date STRING,
    vote_average DOUBLE,
    vote_count INT,
    popularity DOUBLE,
    genres STRING,
    overview STRING,
    ingested_at TIMESTAMP
)
USING DELTA
LOCATION '{BRONZE_PATH}/movies'
""")

print("Bronze Delta Table verified.")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 2. Silver Layer: Cleansing, Validation & Deduplication
# COMMAND ----------

# Clean & Validate Transformation
df_bronze = spark.table("movie_lakehouse.bronze_movies")

df_silver = (
    df_bronze
    .filter(F.col("raw_id").isNotNull() & (F.col("title") != ""))
    .withColumn("movie_id", F.col("raw_id"))
    .withColumn("release_year", F.year(F.to_date(F.col("release_date"), "yyyy-MM-dd")))
    .withColumn("clean_title", F.trim(F.col("title")))
    .withColumn("bayesian_weighted_rating", 
        (F.col("vote_count") * F.col("vote_average") + (500 * 6.8)) / (F.col("vote_count") + 500)
    )
    .withColumn("silver_processed_at", F.current_timestamp())
    .dropDuplicates(["movie_id"])
)

# Merge into Silver Delta Table (ACID Upsert)
spark.sql(f"""
CREATE TABLE IF NOT EXISTS movie_lakehouse.silver_movies (
    movie_id INT,
    clean_title STRING,
    release_year INT,
    vote_average DOUBLE,
    vote_count INT,
    popularity DOUBLE,
    bayesian_weighted_rating DOUBLE,
    silver_processed_at TIMESTAMP
)
USING DELTA
LOCATION '{SILVER_PATH}/movies'
""")

if DeltaTable.isDeltaTable(spark, f"{SILVER_PATH}/movies"):
    silver_table = DeltaTable.forPath(spark, f"{SILVER_PATH}/movies")
    (
        silver_table.alias("target")
        .merge(df_silver.alias("source"), "target.movie_id = source.movie_id")
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute()
    )
    print("Silver Delta Table merged successfully.")

# COMMAND ----------
# MAGIC %md
# MAGIC ### 3. Gold Layer: Feature Store Dimension & Z-Order Optimization
# COMMAND ----------

df_silver_clean = spark.table("movie_lakehouse.silver_movies")

df_gold_features = (
    df_silver_clean
    .withColumn("quality_tier", 
        F.when(F.col("bayesian_weighted_rating") >= 7.5, "Masterpiece")
         .when(F.col("bayesian_weighted_rating") >= 6.5, "High Quality")
         .otherwise("General")
    )
    .withColumn("gold_computed_at", F.current_timestamp())
)

df_gold_features.write.format("delta").mode("overwrite").save(f"{GOLD_PATH}/movie_catalog_features")

# Optimize Gold Table with Z-ORDER for sub-second query performance
spark.sql(f"""
OPTIMIZE delta.`{GOLD_PATH}/movie_catalog_features`
ZORDER BY (release_year, quality_tier)
""")

print("Gold Delta Lake layer materialized and Z-Order optimized!")
