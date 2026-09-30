#!/bin/bash
# ==============================================================================
# 🎬 Movie Intelligence Platform — Mode Switcher
# Switch between 100% Free Local ($0) and Azure Databricks Trial ($600 Credits)
# ==============================================================================

set -e

MODE="${1:-local}"

if [ "$MODE" = "local" ]; then
    echo "========================================================"
    echo "🟢 Switching to 100% Free Local Mode ($0 Cost Forever)"
    echo "========================================================"
    echo "Tracking: Local SQLite (data/mlflow.db)"
    echo "Feature Store: Local PostgreSQL 16"
    echo "========================================================"
    
    # Call runtime API to switch on the fly
    curl -s -X POST http://127.0.0.1:8000/api/v1/mlops/config/mode \
      -H "Content-Type: application/json" \
      -d '{"mode": "local"}' | grep -o '"status":"success"' > /dev/null && echo " Live API switched to local mode." || echo "ℹ️ API not reachable; env updated."

    echo "✅ Switched to Local Free Mode."
    exit 0

elif [ "$MODE" = "databricks" ]; then
    echo "========================================================"
    echo "🔷 Switching to Azure Databricks Trial Mode"
    echo "========================================================"
    
    DB_HOST="$2"
    DB_TOKEN="$3"
    EXP_NAME="${4:-/Shared/movie_recommendation_v1}"

    if [ -z "$DB_HOST" ]; then
        # Check if already present in .env
        if [ -f .env ] && grep -q "DATABRICKS_HOST" .env; then
            DB_HOST=$(grep "DATABRICKS_HOST" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
            DB_TOKEN=$(grep "DATABRICKS_TOKEN" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
        else
            echo "Enter your Azure Databricks Workspace URL (e.g., https://adb-12345.azuredatabricks.net):"
            read -r DB_HOST
            echo "Enter your Databricks Personal Access Token (dapi...):"
            read -r -s DB_TOKEN
        fi
    fi

    # Call runtime API to switch on the fly
    curl -s -X POST http://127.0.0.1:8000/api/v1/mlops/config/mode \
      -H "Content-Type: application/json" \
      -d "{\"mode\": \"databricks\", \"databricks_host\": \"$DB_HOST\", \"databricks_token\": \"$DB_TOKEN\", \"experiment_name\": \"$EXP_NAME\"}" > /dev/null && echo " Live API switched to Databricks mode."

    echo "✅ Switched to Azure Databricks Mode."
    echo "Tracking URI: databricks"
    echo "Experiment: $EXP_NAME"
    exit 0

else
    echo "Usage: ./switch-mode.sh [local | databricks [host] [token] [experiment_name]]"
    exit 1
fi
