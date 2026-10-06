import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.auth import router as auth_router
from backend.app.api.curator import router as curator_router
from backend.app.api.interactions import router as interactions_router
from backend.app.api.mlops import router as mlops_router
from backend.app.api.movies import router as movies_router
from backend.app.api.recommendations import router as recommendations_router
from backend.app.api.users import router as users_router
from backend.app.catalog_sync import sync_catalog_from_seed
from backend.app.core.config import settings
from backend.app.db import check_database_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Normalize franchise titles and synchronize catalog from seed
    async def _init_tasks():
        try:
            from sqlalchemy import text
            from backend.app.db import async_session_factory
            async with async_session_factory() as session:
                await session.execute(text("""
                    UPDATE movies SET title = 'Star Wars: Episode IV - A New Hope' WHERE title = 'Star Wars' AND release_year = 1977;
                    UPDATE movies SET title = 'Star Wars: Episode V - The Empire Strikes Back' WHERE (title = 'The Empire Strikes Back' OR title ILIKE '%empire strikes%') AND release_year = 1980;
                    UPDATE movies SET title = 'Star Wars: Episode VI - Return of the Jedi' WHERE title = 'Return of the Jedi' AND release_year = 1983;
                """))
                await session.commit()
        except Exception:
            pass
        await sync_catalog_from_seed()

    asyncio.create_task(_init_tasks())
    yield



app = FastAPI(
    title="ShowDyme Movie Intelligence Platform API",
    version="0.2.0",
    description="Personalized real-time movie intelligence and recommendation platform.",
    lifespan=lifespan,
)


# CORS — allow development and production frontends
allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]
if settings.frontend_url and settings.frontend_url != "*":
    allowed_origins.append(settings.frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.frontend_url == "*" else allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_cache_control_header(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# Routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(movies_router, prefix="/api/v1")
app.include_router(recommendations_router, prefix="/api/v1")
app.include_router(interactions_router, prefix="/api/v1")
app.include_router(curator_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(mlops_router, prefix="/api/v1")



@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db", tags=["health"])
async def database_health_check() -> dict[str, str]:
    connected = await check_database_connection()

    if connected:
        return {"status": "ok", "database": "connected"}

    return {"status": "error", "database": "unavailable"}