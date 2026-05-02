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

    # --- DeepSeek (LLM) ---
    deepseek_api_key: str = ""

    # --- Volcengine Ark (LLM) ---
    volc_ark_api_key: str = ""
    volc_ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    volc_ark_model: str = "doubao-seed-2-0-mini-260215"

    # --- Volcengine Speech (shared by STT + TTS) ---
    volc_speech_app_id: str = ""
    volc_speech_access_key: str = ""

    # --- TTS ---
    volc_tts_resource_id: str = "seed-tts-2.0"
    volc_tts_default_voice: str = "zh_female_yingyujiaoxue_uranus_bigtts"
    volc_tts_audio_format: str = "mp3"
    volc_tts_sample_rate: int = 24000

    # --- STT ---
    volc_stt_resource_id: str = "volc.seedasr.sauc.duration"
    volc_stt_model_name: str = "bigmodel"
    volc_stt_sample_rate: int = 16000

    # --- Audio storage (V1 local fs, V2 TOS) ---
    audio_storage_enabled: bool = True
    audio_storage_dir: str = "./tmp/audio"


settings = Settings()
