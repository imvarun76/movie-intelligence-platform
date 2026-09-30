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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
