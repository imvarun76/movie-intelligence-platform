"""
Feature Store Sync Script (Phase 6 MLOps).
Computes features for all 442 movies and users in PostgreSQL.
"""

import asyncio
import os
import sys

# Ensure root directory is on PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.app.db import async_session_factory
from backend.app.mlops.feature_store import FeatureStoreService


async def main():
    print("Initiating full Feature Store sync...")
    async with async_session_factory() as session:
        res = await FeatureStoreService.sync_all_features(session)
        print(f"Feature Store sync successful! Result: {res}")


if __name__ == "__main__":
    asyncio.run(main())
