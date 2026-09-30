# 🚀 Databricks & Azure Trial Architecture & Credit Preservation Guide

This guide explains how to run the **Movie Intelligence Platform** using **either the 100% Free Option** or by taking advantage of your **Azure ($200)** and **Databricks ($400) 15-day Trial Credits** with zero risk of running out of credits.

---

## ⚖️ Path Comparison: Free Local vs. Databricks/Azure Trial

| Feature | Path A: 100% Free Option (Active Default) | Path B: Azure Databricks Trial ($600 Credits) |
| :--- | :--- | :--- |
| **Cost** | **$0.00 Forever** | Free within trial credits (~$0.25 - $1.00 total consumption) |
| **Hosting** | Local Docker + FastAPI + Vite | Azure Databricks Workspace + ADLS Gen2 Storage |
| **Feature Store** | PostgreSQL 16 + Real-Time Upsert Service | Databricks Feature Store (`databricks.feature_engineering`) |
| **Lakehouse Architecture** | Bronze/Silver/Gold Relational DB + JSONB | Medallion Delta Lake with Z-ORDER Optimization |
| **Streaming** | Async FastAPI event stream + Watermarking | PySpark Structured Streaming with Event-Time Watermarks |
| **MLflow Tracking** | Local SQLite (`sqlite:///data/mlflow.db`) + File Store | Databricks Hosted Managed MLflow + Model Registry |
| **Recommended For** | **Daily development, local testing, offline workflows** | **Portfolio showcase, resume proof, enterprise scaling** |

---

## 🛡️ Critical Credit Preservation Guardrails (Read Before Launching)

To ensure your $400 Databricks and $200 Azure credits remain safe across the full 15 days, **strictly follow these compute rules**:

1. **Compute Type**: Select **Single-Node** (Driver only, 0 Workers). Do **NOT** launch multi-node clusters.
2. **Node Size**:
   - Azure: `Standard_D4ds_v5` (4 cores, 16 GB RAM) or `Standard_DS3_v2`
   - Cost: **~$0.18 - $0.24 per hour**
3. **Auto-Termination**: Set to **`10 minutes`** (Databricks will automatically stop the cluster if idle, ensuring you never get billed when stepping away).
4. **Databricks Runtime**: `14.3 LTS (Scala 2.12, Spark 3.5.0)` or `15.4 LTS ML` (includes PyTorch, Scikit-Learn, and MLflow pre-installed).

> [!TIP]
> Running all 4 showcase notebooks on a Single-Node cluster takes under 8 minutes, consuming **less than $0.05 of credits** per run!

---

## 📦 Ready-to-Run Databricks Notebooks

The `ml/databricks/` directory contains complete, standalone PySpark notebooks ready to import into your Databricks workspace:

| Notebook | Purpose |
| :--- | :--- |
| [`01_delta_lakehouse_pipeline.py`](file:///Users/varunmishra/Projects/movie-intelligence-platform/ml/databricks/01_delta_lakehouse_pipeline.py) | Ingests Bronze raw TMDB data, cleans Silver layer, builds Gold aggregate with Z-ORDER. |
| [`02_databricks_feature_store.py`](file:///Users/varunmishra/Projects/movie-intelligence-platform/ml/databricks/02_databricks_feature_store.py) | Registers `movie_features` & `user_features` in the Databricks Feature Store. |
| [`03_structured_streaming_interactions.py`](file:///Users/varunmishra/Projects/movie-intelligence-platform/ml/databricks/03_structured_streaming_interactions.py) | Stream processing with 10-minute watermarks & `trigger(availableNow=True)` for 0 idle costs. |
| [`04_mlflow_model_training.py`](file:///Users/varunmishra/Projects/movie-intelligence-platform/ml/databricks/04_mlflow_model_training.py) | Trains Spark MLLib ALS Collaborative Filtering and registers to Databricks Model Registry. |

---

## 🛠️ Step-by-Step Setup on Azure Databricks

### Step 1: Create Azure Databricks Workspace
1. In the [Azure Portal](https://portal.azure.com/), search for **Azure Databricks**.
2. Click **Create** -> Select your Trial Subscription.
3. Pricing Tier: Choose **Premium (14-Days Free Trial)**.
4. Click **Review + Create**. (Takes ~2-3 minutes).

### Step 2: Create Cost-Controlled Single-Node Cluster
1. Open your Databricks Workspace.
2. In the sidebar, navigate to **Compute** -> **Create compute**.
3. Configure the cluster:
   - **Policy**: `Personal Compute` or `Unrestricted`
   - **Performance**: Select **Single node**
   - **Node Type**: `Standard_D4ds_v5` (or any 4-core node)
   - **Auto-Termination**: Set **Terminate after `10` minutes of inactivity**
4. Click **Create compute**.

### Step 3: Import the Notebooks
1. In the sidebar, navigate to **Workspace** -> **Users** -> Your Username.
2. Click the three dots `...` -> **Import**.
3. Choose **File** and drag-and-drop the 4 files from `ml/databricks/`.
4. Open `01_delta_lakehouse_pipeline.py` and click **Run All**.

---

## 🔗 (Optional) Connecting Databricks Hosted MLflow to Local App

If you want your local FastAPI app to log experiments directly into Databricks Hosted MLflow:

1. In Databricks, click your user profile (top right) -> **Settings** -> **Developer** -> **Access tokens** -> **Generate new token**.
2. In your local project directory, update `.env`:
   ```bash
   DATABRICKS_HOST="https://adb-<workspace-id>.azuredatabricks.net"
   DATABRICKS_TOKEN="dapi..."
   MLFLOW_TRACKING_URI="databricks"
   MLFLOW_EXPERIMENT_NAME="/Users/your-email/movie_recommendation_v1"
   ```
3. Restart FastAPI:
   ```bash
   pkill -f "uvicorn backend.app.main" 2>/dev/null
   backend/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --env-file .env
   ```
4. All local evaluation runs and A/B test metrics will automatically sync directly into your Azure Databricks MLflow UI!
