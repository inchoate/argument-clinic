"""
Voice Service for handling speech-to-text and text-to-speech functionality.
Supports multiple providers: OpenAI, ElevenLabs, and Google Cloud.
"""

import logging
import os
import tempfile
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

import openai
from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs
from google.cloud import speech, texttospeech

logger = logging.getLogger(__name__)


class ProviderType(Enum):
    """Available voice service providers."""

    OPENAI = "openai"
    ELEVENLABS = "elevenlabs"
    GOOGLE = "google"


@dataclass
class VoiceConfig:
    """Voice service configuration."""

    default_voice_id: str = "A5TM08C95NDSq8Seg1Rk"
    voice_speed: float = 2.0
    voice_stability: float = 0.5

    @classmethod
    def from_env(cls) -> "VoiceConfig":
        """Load configuration from environment variables."""
        return cls(
            default_voice_id=os.getenv("DEFAULT_VOICE_ID", cls.default_voice_id),
            voice_speed=float(os.getenv("VOICE_SPEED", str(cls.voice_speed))),
            voice_stability=float(os.getenv("VOICE_STABILITY", str(cls.voice_stability))),
        )


class VoiceProvider(Protocol):
    """Protocol for voice service providers."""

    def transcribe(self, audio_data: bytes, audio_format: str) -> str:
        """Transcribe audio to text."""
        ...

    def synthesize(self, text: str, voice_id: str, config: VoiceConfig) -> bytes:
        """Synthesize text to speech."""
        ...


class OpenAIProvider:
    """OpenAI voice provider implementation."""

    def __init__(self, api_key: str):
        self.client = openai.OpenAI(api_key=api_key)
        self.voice_mapping = {
            "mr_barnard": "onyx",
            "british_male": "onyx",
        }

    def transcribe(self, audio_data: bytes, audio_format: str) -> str:
        """Transcribe audio using OpenAI Whisper."""
        with tempfile.NamedTemporaryFile(suffix=f".{audio_format}", delete=False) as temp_file:
            temp_file.write(audio_data)
            temp_file.flush()

            try:
                with open(temp_file.name, "rb") as audio_file:
                    transcript = self.client.audio.transcriptions.create(
                        model="whisper-1", file=audio_file, language="en"
                    )
                return transcript.text
            finally:
                os.unlink(temp_file.name)

    def synthesize(self, text: str, voice_id: str, config: VoiceConfig) -> bytes:
        """Synthesize speech using OpenAI TTS."""
        openai_voice = self.voice_mapping.get(voice_id, "alloy")

        response = self.client.audio.speech.create(
            model="tts-1", voice=openai_voice, input=text, speed=config.voice_speed
        )
        return response.content


class ElevenLabsProvider:
    """ElevenLabs voice provider implementation."""

    def __init__(self, api_key: str):
        self.client = ElevenLabs(api_key=api_key)
        self.voice_mapping = {
            "mr_barnard": "A5TM08C95NDSq8Seg1Rk",
            "british_male": "A5TM08C95NDSq8Seg1Rk",
            "your_voice": "H9Cx3d2SfIOTM8McQQUY",
        }

    def transcribe(self, audio_data: bytes, audio_format: str) -> str:
        """ElevenLabs doesn't support transcription."""
        raise NotImplementedError("ElevenLabs doesn't support transcription")

    def synthesize(self, text: str, voice_id: str, config: VoiceConfig) -> bytes:
        """Synthesize speech using ElevenLabs."""
        actual_voice_id = self.voice_mapping.get(voice_id, voice_id)

        voice_settings = VoiceSettings(
            stability=config.voice_stability,
            similarity_boost=0.75,
            style=0.0,
            use_speaker_boost=True,
        )

        try:
            # Try new API method first
            audio_stream = self.client.generate(
                text=text,
                voice=actual_voice_id,
                voice_settings=voice_settings,
                model="eleven_multilingual_v2",
            )
        except AttributeError:
            # Fallback to older API method
            audio_stream = self.client.text_to_speech.convert(
                voice_id=actual_voice_id,
                text=text,
                voice_settings=voice_settings,
                model_id="eleven_multilingual_v2",
            )

        return b"".join(audio_stream)


class GoogleProvider:
    """Google Cloud voice provider implementation."""

    def __init__(self):
        self.speech_client = speech.SpeechClient()
        self.tts_client = texttospeech.TextToSpeechClient()
        self.voice_mapping = {
            "mr_barnard": "en-GB-Standard-B",
            "british_male": "en-GB-Standard-B",
        }

    def transcribe(self, audio_data: bytes, audio_format: str) -> str:
        """Transcribe audio using Google Cloud Speech-to-Text."""
        encoding_map = {
            "webm": speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            "ogg": speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            "mp3": speech.RecognitionConfig.AudioEncoding.MP3,
        }

        encoding = encoding_map.get(
            audio_format.lower(), speech.RecognitionConfig.AudioEncoding.LINEAR16
        )

        audio = speech.RecognitionAudio(content=audio_data)
        config = speech.RecognitionConfig(
            encoding=encoding, sample_rate_hertz=16000, language_code="en-US"
        )

        response = self.speech_client.recognize(config=config, audio=audio)

        if response.results:
            return response.results[0].alternatives[0].transcript
        return ""

    def synthesize(self, text: str, voice_id: str, config: VoiceConfig) -> bytes:
        """Synthesize speech using Google Cloud Text-to-Speech."""
        voice_name = self.voice_mapping.get(voice_id, "en-US-Standard-C")
        language_code = voice_name[:5]

        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(language_code=language_code, name=voice_name)
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3, speaking_rate=config.voice_speed
        )

        response = self.tts_client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )

        return response.audio_content


class VoiceService:
    """Handles all voice-related operations including STT and TTS."""

    def __init__(self, config: VoiceConfig | None = None):
        self.config = config or VoiceConfig.from_env()
        self.providers: dict[ProviderType, VoiceProvider] = {}
        self._initialize_providers()

        logger.info(f"Voice service initialized with {len(self.providers)} providers")
        logger.info(
            f"Config: voice_id={self.config.default_voice_id}, "
            f"speed={self.config.voice_speed}, stability={self.config.voice_stability}"
        )

    def _initialize_providers(self) -> None:
        """Initialize available voice service providers."""
        # OpenAI
        if openai_key := os.getenv("OPENAI_API_KEY"):
            try:
                self.providers[ProviderType.OPENAI] = OpenAIProvider(openai_key)
                logger.info("OpenAI provider initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI provider: {e}")

        # ElevenLabs
        if elevenlabs_key := os.getenv("ELEVENLABS_API_KEY"):
            try:
                self.providers[ProviderType.ELEVENLABS] = ElevenLabsProvider(elevenlabs_key)
                logger.info("ElevenLabs provider initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize ElevenLabs provider: {e}")

        # Google Cloud
        if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            try:
                self.providers[ProviderType.GOOGLE] = GoogleProvider()
                logger.info("Google Cloud provider initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize Google Cloud provider: {e}")

    def transcribe_audio(self, audio_data: bytes, audio_format: str = "webm") -> str | None:
        """Convert audio to text using available STT providers."""
        # Try providers in order of preference
        stt_providers = [ProviderType.OPENAI, ProviderType.GOOGLE]

        for provider_type in stt_providers:
            if provider := self.providers.get(provider_type):
                try:
                    result = provider.transcribe(audio_data, audio_format)
                    logger.info(f"Successfully transcribed with {provider_type.value}")
                    return result
                except Exception as e:
                    logger.error(f"{provider_type.value} transcription failed: {e}")

        logger.error("All STT providers failed or unavailable")
        return None

    def synthesize_speech(self, text: str, voice_id: str | None = None) -> bytes | None:
        """Convert text to speech using available TTS providers."""
        voice_id = voice_id or self.config.default_voice_id

        # Try providers in order of preference
        tts_providers = [ProviderType.ELEVENLABS, ProviderType.GOOGLE, ProviderType.OPENAI]

        for provider_type in tts_providers:
            if provider := self.providers.get(provider_type):
                try:
                    result = provider.synthesize(text, voice_id, self.config)
                    logger.info(f"Successfully synthesized with {provider_type.value}")
                    return result
                except Exception as e:
                    logger.error(f"{provider_type.value} synthesis failed: {e}")

        logger.error("All TTS providers failed or unavailable")
        return None

    def get_available_voices(self) -> dict[str, Any]:
        """Get list of available voices from all providers."""
        voices = {
            "mr_barnard": {"name": "Mr. Barnard", "provider": "multiple"},
            "british_male": {"name": "British Male", "provider": "multiple"},
        }

        # Add ElevenLabs voices if available
        if elevenlabs_provider := self.providers.get(ProviderType.ELEVENLABS):
            try:
                elevenlabs_voices = elevenlabs_provider.client.voices.get_all()
                for voice in elevenlabs_voices.voices:
                    voices[voice.voice_id] = {
                        "name": voice.name,
                        "provider": "elevenlabs",
                        "category": getattr(voice, "category", "custom"),
                    }
            except Exception as e:
                logger.warning(f"Failed to get ElevenLabs voices: {e}")

        return voices

    def is_available(self) -> bool:
        """Check if any voice services are available."""
        return len(self.providers) > 0

    def get_status(self) -> dict[str, bool]:
        """Get status of all voice service providers."""
        return {
            "openai_stt": ProviderType.OPENAI in self.providers,
            "openai_tts": ProviderType.OPENAI in self.providers,
            "elevenlabs_tts": ProviderType.ELEVENLABS in self.providers,
            "google_stt": ProviderType.GOOGLE in self.providers,
            "google_tts": ProviderType.GOOGLE in self.providers,
        }

    def get_provider_capabilities(self) -> dict[str, list[str]]:
        """Get capabilities of each provider."""
        capabilities = {}

        for provider_type, provider in self.providers.items():
            caps = []
            try:
                provider.transcribe(b"", "wav")
                caps.append("transcription")
            except (NotImplementedError, Exception):
                pass

            try:
                provider.synthesize("test", "test", self.config)
                caps.append("synthesis")
            except Exception:
                pass

            capabilities[provider_type.value] = caps

        return capabilities


# Global voice service instance
voice_service = VoiceService()
