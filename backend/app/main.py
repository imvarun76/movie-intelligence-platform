from fastapi import FastAPI

from backend.app.db import check_database_connection


app = FastAPI(
    title="Movie Intelligence Platform API",
    version="0.1.0",
)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
async def database_health_check() -> dict[str, str]:
    connected = await check_database_connection()

    if connected:
        return {"status": "ok", "database": "connected"}

    return {"status": "error", "database": "unavailable"}