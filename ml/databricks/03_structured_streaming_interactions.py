# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # ⚡ PySpark Structured Streaming: Real-Time Telemetry Pipeline
# MAGIC **Personalized Real-Time Movie Intelligence Platform**
# MAGIC
# MAGIC Consumes real-time user interaction events with:
# MAGIC - 10-minute event-time watermarking to handle late-arriving clicks
# MAGIC - Deduplication across `(user_id, movie_id, event_type, occurred_at)`
# MAGIC - Trigger Once or AvailableNow mode (cost-optimized: run for 1 min then stop to save trial credits!)

# COMMAND ----------
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, IntegerType, StringType, StructField, StructType, TimestampType

interaction_event_schema = StructType([
    StructField("id", StringType(), False),
    StructField("user_id", StringType(), False),
    StructField("movie_id", IntegerType(), False),
    StructField("event_type", StringType(), False),
    StructField("value", DoubleType(), True),
    StructField("source", StringType(), True),
    StructField("occurred_at", TimestampType(), False),
])

STREAM_SOURCE_PATH = "/FileStore/movie_platform_lakehouse/stream_incoming"
CHECKPOINT_PATH = "/FileStore/movie_platform_lakehouse/checkpoints/streaming_events"
SILVER_INTERACTIONS_PATH = "/FileStore/movie_platform_lakehouse/silver/interactions"

# Read streaming JSON stream
df_stream = (
    spark.readStream
    .schema(interaction_event_schema)
    .json(STREAM_SOURCE_PATH)
    .withWatermark("occurred_at", "10 minutes")
    .dropDuplicates(["user_id", "movie_id", "event_type", "occurred_at"])
)

# Cost-conscious streaming write: uses trigger(availableNow=True) so it processes all pending events and halts
query = (
    df_stream.writeStream
    .format("delta")
    .outputMode("append")
    .option("checkpointLocation", CHECKPOINT_PATH)
    .trigger(availableNow=True)
    .start(SILVER_INTERACTIONS_PATH)
)

query.awaitTermination()
print("Streaming batch processed and committed to Delta Lake!")
