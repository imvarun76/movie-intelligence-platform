from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.interactions import router as interactions_router
from backend.app.api.movies import router as movies_router
from backend.app.api.recommendations import router as recommendations_router
from backend.app.core.config import settings
from backend.app.db import check_database_connection


app = FastAPI(
    title="Movie Intelligence Platform API",
    version="0.2.0",
    description="Personalized real-time movie intelligence and recommendation platform.",
)

# CORS — allow the Vite dev server and production frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(movies_router, prefix="/api/v1")
app.include_router(recommendations_router, prefix="/api/v1")
app.include_router(interactions_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db", tags=["health"])
async def database_health_check() -> dict[str, str]:
    connected = await check_database_connection()

    if connected:
        return {"status": "ok", "database": "connected"}

    return {"status": "error", "database": "unavailable"}