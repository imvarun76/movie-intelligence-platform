from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_name: str = "movie-intelligence-platform"

    database_url: str

    # TMDB
    tmdb_api_key: str = ""

    # OMDb (optional secondary source)
    omdb_api_key: str = ""

    # Redis (optional, for caching)
    redis_url: str = ""

    # OpenAI (for RAG/AI assistant)
    openai_api_key: str = ""

    # Frontend
    frontend_url: str = "http://localhost:5173"

    # Authentication & Security
    jwt_secret_key: str = "showdyme_super_secret_jwt_key_cinema_2026_9948"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    reset_token_expire_minutes: int = 60  # 1 hour

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
