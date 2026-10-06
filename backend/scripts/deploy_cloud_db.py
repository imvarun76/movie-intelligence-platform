"""
Cloud Database Provisioning & Seeder Script (ShowDyme).

Runs on a remote cloud PostgreSQL instance (Neon.tech, Supabase, or Render):
1. Verifies database connectivity.
2. Applies Alembic migrations (creates movies, interactions, feature store tables).
3. Ingests all 442 movies into the cloud database with full metadata.
4. Seeds baseline users & interactions.
5. Computes initial feature store rows for all movies.

Usage:
  PYTHONPATH=. backend/.venv/bin/python backend/scripts/deploy_cloud_db.py "<NEON_CONNECTION_STRING>"
"""

import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def get_direct_db_url(url: str) -> str:
    """Ensure url has postgresql+psycopg scheme and uses direct endpoint (not -pooler) for DDL migrations."""
    clean = url.strip()
    if clean.startswith("postgres://"):
        clean = clean.replace("postgres://", "postgresql+psycopg://", 1)
    elif clean.startswith("postgresql://") and "+psycopg" not in clean:
        clean = clean.replace("postgresql://", "postgresql+psycopg://", 1)
    return clean


def run_alembic(db_url: str):
    print("⏳ Running Alembic migrations on cloud database...")
    env = os.environ.copy()
    
    # Use direct host (without -pooler) for Alembic DDL if Neon pooler is in URL
    migration_url = db_url.replace("-pooler.", ".")
    env["DATABASE_URL"] = migration_url
    env["PYTHONPATH"] = str(PROJECT_ROOT)

    alembic_bin = str(PROJECT_ROOT / "backend/.venv/bin/alembic")
    if not os.path.exists(alembic_bin):
        alembic_bin = "alembic"

    res = subprocess.run(
        [alembic_bin, "upgrade", "head"],
        env=env,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        print("❌ Alembic error:\n", res.stderr)
        sys.exit(1)
    print("✅ Alembic migrations applied successfully to head.")


async def seed_neon(db_url: str):
    os.environ["DATABASE_URL"] = db_url
    
    # Import SQLAlchemy async dependencies after setting DATABASE_URL
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import select, func, text
    from backend.app.models.movie import Movie
    from backend.app.models.movie_external_id import MovieExternalID
    from backend.app.models.user import User
    from backend.app.catalog_sync import sync_catalog_from_seed
    from backend.app.mlops.feature_store import FeatureStoreService

    engine = create_async_engine(db_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print("\n⏳ [Step 1/3] Ingesting all 1,651 curated movies from catalog seed to Cloud DB...")
    res = await sync_catalog_from_seed(session_factory=session_factory)
    print(f"✅ Catalog Seed Finished: {res.get('inserted')} movies inserted, {res.get('updated')} existing.")

    print("\n⏳ [Step 2/3] Seeding demo benchmark users and interactions...")
    async with session_factory() as session:
        # Check if users already exist
        u_count = (await session.execute(select(func.count(User.id)))).scalar()
        if u_count == 0:
            user_ids = [
                uuid.UUID("11111111-1111-1111-1111-111111111111"),
                uuid.UUID("22222222-2222-2222-2222-222222222222"),
                uuid.UUID("33333333-3333-3333-3333-333333333333"),
                uuid.UUID("44444444-4444-4444-4444-444444444444"),
                uuid.UUID("55555555-5555-5555-5555-555555555555"),
            ]
            tiers = ["new", "warm", "warm", "active", "power"]
            for uid, tier in zip(user_ids, tiers):
                session.add(User(id=uid, cold_start_tier=tier, interaction_count=5 if tier != "new" else 0))
            await session.commit()
            print(f"✅ Seeded {len(user_ids)} benchmark personas (new, warm, active, power).")
        else:
            print(f"ℹ️ Cloud database already has {u_count} users.")

    print("\n⏳ [Step 3/3] Computing Feature Store entries for all movies and users on Cloud DB...")
    async with session_factory() as session:
        result = await FeatureStoreService.sync_all_features(session)
        print(f"✅ Feature Store calculation complete: {result}")

    # Final verification
    async with session_factory() as session:
        m_count = (await session.execute(select(func.count(Movie.id)))).scalar()
        u_count = (await session.execute(select(func.count(User.id)))).scalar()
        ext_count = (await session.execute(select(func.count(MovieExternalID.id)))).scalar()
        print("\n" + "=" * 50)
        print("🎉 NEON CLOUD DATABASE FULLY PROVISIONED & VERIFIED!")
        print(f"📊 Movies in Cloud:        {m_count}")
        print(f"📊 External TMDB/IMDb IDs: {ext_count}")
        print(f"📊 Benchmark Users:        {u_count}")
        print("=" * 50)

    await engine.dispose()


def main():
    if len(sys.argv) > 1:
        raw_url = sys.argv[1]
    else:
        raw_url = os.getenv("DATABASE_URL", "")

    if not raw_url:
        print("❌ Error: Please provide a cloud DATABASE_URL argument or set DATABASE_URL environment variable.")
        sys.exit(1)

    cloud_url = get_direct_db_url(raw_url)
    print(f"🌐 Target Cloud Database Host: {cloud_url.split('@')[-1]}")

    # 1. Run migrations
    run_alembic(cloud_url)

    # 2. Seed data
    asyncio.run(seed_neon(cloud_url))


if __name__ == "__main__":
    main()
