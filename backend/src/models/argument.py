"""
Core data models for the Argument Clinic.
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ArgumentState(str, Enum):
    """Conversation states in the argument clinic."""

    ENTRY = "entry"
    SIMPLE_CONTRADICTION = "simple_contradiction"
    ARGUMENTATION = "argumentation"
    META_COMMENTARY = "meta_commentary"
    RESOLUTION = "resolution"


class UserIntent(str, Enum):
    """User intention categories for conversation routing."""

    ARGUMENTATIVE = "argumentative"
    TRANSACTIONAL = "transactional"
    META = "meta"
    CONFUSED = "confused"


class MessageType(str, Enum):
    """WebSocket message types."""

    USER_INPUT = "user_input"
    VOICE_INPUT = "voice_input"
    AI_RESPONSE = "ai_response"
    TRANSCRIPTION = "transcription"
    ERROR = "error"
    SESSION_START = "session_start"


class WebSocketMessage(BaseModel):
    """WebSocket message format."""

    type: MessageType
    content: str
    session_id: str
    audio_data: str | None = None


class SessionInfo(BaseModel):
    """Session metadata and status."""

    session_id: str
    current_state: ArgumentState
    turn_count: int
    payment_received: bool
    started_at: datetime
    last_activity: datetime


class ConversationTurn(BaseModel):
    """Single turn in a conversation."""

    user_input: str
    ai_response: str
    state: ArgumentState
    intent: UserIntent | None = None
    timestamp: datetime = Field(default_factory=datetime.now)
    response_time_ms: float


class HealthStatus(BaseModel):
    """API health check response."""

    status: str
    timestamp: datetime = Field(default_factory=datetime.now)
    version: str
    environment: str
    active_sessions: int
    voice_service_available: bool


class MetricsResponse(BaseModel):
    """Performance metrics response."""

    response_times: dict[str, float]
    audio_processing: dict[str, float]
    requests: dict[str, Any]
    sessions: dict[str, int]
    voice_service: dict[str, Any]


# Response models for potential REST API endpoints
class TextProcessRequest(BaseModel):
    """Request for text processing."""

    session_id: str
    text: str


class TextProcessResponse(BaseModel):
    """Response from text processing."""

    session_id: str
    user_text: str
    ai_response: str
    current_state: ArgumentState
    turn_count: int
    response_time_ms: float
    audio_url: str | None = None
