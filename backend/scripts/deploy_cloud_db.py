"""
Cloud Database Provisioning & Seeder Script (ShowDyme).

Runs on a remote cloud PostgreSQL instance (Neon.tech, Supabase, or Render):
1. Verifies database connectivity.
2. Applies Alembic migrations (creates movies, interactions, feature store tables).
3. Ingests all 442 movies into the cloud database with embeddings & metadata.
4. Computes initial feature store rows for all movies.

Usage:
  PYTHONPATH=. backend/.venv/bin/python backend/scripts/deploy_cloud_db.py "postgresql+psycopg://user:pass@host/db?sslmode=require"
"""

import asyncio
import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))


def run_alembic(db_url: str):
    print("⏳ Running Alembic migrations on cloud database...")
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    res = subprocess.run(["alembic", "upgrade", "head"], env=env, capture_output=True, text=True)
    if res.returncode != 0:
        print("Alembic error:", res.stderr)
        sys.exit(1)
    print(" Alembic migrations applied successfully.")


async def main():
    if len(sys.argv) > 1:
        cloud_url = sys.argv[1]
    else:
        cloud_url = os.getenv("DATABASE_URL", "")

    if not cloud_url:
        print("❌ Error: Please provide a cloud DATABASE_URL argument or set DATABASE_URL environment variable.")
        sys.exit(1)

    # Ensure postgresql+psycopg scheme
    if cloud_url.startswith("postgres://"):
        cloud_url = cloud_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif cloud_url.startswith("postgresql://") and "+psycopg" not in cloud_url:
        cloud_url = cloud_url.replace("postgresql://", "postgresql+psycopg://", 1)

    print(f" Connecting to Cloud Database: {cloud_url.split('@')[-1]}")
    os.environ["DATABASE_URL"] = cloud_url

    # 1. Run migrations
    run_alembic(cloud_url)

    # 2. Ingest catalog
    print("⏳ Ingesting movie catalog to cloud database...")
    from backend.scripts.expand_catalog import run_expansion
    await run_expansion()

    # 3. Compute feature store
    print("⏳ Computing Feature Store rows for all movies...")
    from backend.app.db import async_session_factory
    from backend.app.mlops.feature_store import FeatureStoreService

    async with async_session_factory() as session:
        result = await FeatureStoreService.sync_all_features(session)
        print(f" Feature Store sync complete: {result}")

    print("\n🎉 Cloud Database is fully seeded and ready for production serving!")


if __name__ == "__main__":
    asyncio.run(main())
