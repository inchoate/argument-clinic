"""
Configuration management for the Argument Clinic backend.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    # Server Configuration
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    debug: bool = False
    environment: str = "development"

    # AI Provider Configuration
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    google_api_key: str | None = None
    elevenlabs_api_key: str | None = None

    # Whisper Configuration
    whisper_model: str = "base.en"
    whisper_device: str = "cpu"
    enable_whisper: bool = False

    # Session Configuration
    max_session_minutes: int = 5
    session_cleanup_interval: int = 300  # seconds
    max_concurrent_sessions: int = 100

    # Voice Configuration
    audio_threshold: float = Field(default=0.07, ge=0.0, le=1.0)
    silence_timeout: float = Field(default=1.5, ge=0.1, le=10.0)
    min_recording_duration: float = Field(default=0.5, ge=0.1, le=5.0)
    max_concurrent_audio_tasks: int = Field(default=10, ge=1, le=50)

    model_config = {
        "env_file": ".env",
        "case_sensitive": False,
        "extra": "allow",
    }


# Global settings instance
settings = Settings()
