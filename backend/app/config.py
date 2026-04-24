from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    cors_origins: list[str] = ["http://localhost:3000"]

    database_url: str = "postgresql+asyncpg://talking_text:talking_text@localhost:5432/talking_text"

    redis_url: str = "redis://localhost:6379/0"

    session_secret: str = "change-me-in-production"


settings = Settings()
