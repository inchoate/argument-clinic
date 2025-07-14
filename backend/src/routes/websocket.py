"""
WebSocket endpoints for real-time argument clinic conversations.
"""

import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass
from typing import Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import settings
from models.argument import ArgumentState, MessageType
from performance import metrics, track_response_time
from services.argument_clinic_graph import (
    ArgumentClinicContext,
    EntryNode,
    argument_clinic_graph,
)
from services.voice_service import voice_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])


class TranscriptionValidator:
    """Validates transcription quality."""

    INVALID_PATTERNS = [
        ".",
        "...",
        "Thank you.",
        "Thank you for watching",
        "Thanks for watching",
    ]  # Removed empty string

    @classmethod
    def is_valid(cls, text: str) -> bool:
        """Check if transcription is valid and meaningful."""
        if not text:
            return False

        cleaned = text.strip()
        return len(cleaned) >= 2 and cleaned not in cls.INVALID_PATTERNS  # Exact matches only


class GraphSession:
    """Manages a stateful graph session for WebSocket conversation."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = ArgumentClinicContext(session_id=session_id)
        self.graph_runner = None
        self.graph_context = None
        self.is_processing = False
        self.created_at = time.time()

    async def start_graph(self) -> None:
        """Initialize and start the graph execution."""
        if self.graph_runner is None:
            self.graph_runner = argument_clinic_graph.iter(EntryNode(), state=self.state)
            self.graph_context = await self.graph_runner.__aenter__()
            await self.graph_context.next()  # Execute EntryNode

    async def process_input(self, user_input: str) -> tuple[str, float, str]:
        """Process user input through the graph and return response."""
        if self.is_processing:
            logger.warning(f"Session {self.session_id} rejected concurrent processing")
            return (
                "Please wait for the current response to complete.",
                0.0,
                "ConcurrencyError",
            )

        start_time = time.time()

        try:
            self.is_processing = True

            if self.graph_runner is None:
                await self.start_graph()

            # Process through graph: WaitForInput -> ProcessUserInput -> ResponseNode -> WaitForInput
            self.state.current_input = user_input

            # Execute the three graph steps
            await self.graph_context.next()  # ProcessUserInput
            self.state = self.graph_context.state

            current_node = await self.graph_context.next()  # ResponseNode
            self.state = self.graph_context.state
            response_node_name = type(current_node).__name__

            await self.graph_context.next()  # Back to WaitForInput
            self.state = self.graph_context.state

            processing_time = track_response_time(start_time)
            metrics.increment_success()

            response = self.state.last_response or "Good morning! Welcome to the Argument Clinic."

            return response, processing_time, response_node_name

        except Exception as e:
            logger.error(f"Graph processing error for session {self.session_id}: {e}")
            metrics.increment_error()
            raise
        finally:
            self.is_processing = False


class SessionManager:
    """Manages WebSocket sessions and their lifecycle."""

    def __init__(self):
        self.active_sessions: Dict[str, GraphSession] = {}
        self.session_timeouts: Dict[str, asyncio.Task] = {}

    def create_session(self) -> GraphSession:
        """Create a new session with timeout management."""
        session_id = str(uuid4())
        session = GraphSession(session_id)

        self.active_sessions[session_id] = session
        self.session_timeouts[session_id] = asyncio.create_task(
            self._cleanup_after_timeout(session_id)
        )

        metrics.increment_session()
        logger.info(f"Created session {session_id}")
        return session

    def reset_timeout(self, session_id: str) -> None:
        """Reset session timeout on activity."""
        if session_id in self.session_timeouts:
            self.session_timeouts[session_id].cancel()
            self.session_timeouts[session_id] = asyncio.create_task(
                self._cleanup_after_timeout(session_id)
            )

    def cleanup_session(self, session_id: str) -> None:
        """Immediately clean up a session."""
        if session_id in self.active_sessions:
            del self.active_sessions[session_id]
        if session_id in self.session_timeouts:
            self.session_timeouts[session_id].cancel()
            del self.session_timeouts[session_id]
        logger.info(f"Cleaned up session {session_id}")

    async def _cleanup_after_timeout(self, session_id: str) -> None:
        """Clean up session after timeout."""
        await asyncio.sleep(settings.max_session_minutes * 60)
        if session_id in self.active_sessions:
            del self.active_sessions[session_id]
            logger.info(f"Timed out session {session_id}")
        if session_id in self.session_timeouts:
            del self.session_timeouts[session_id]

    def get_active_count(self) -> int:
        """Get number of active sessions."""
        return len(self.active_sessions)


class WebSocketHandler:
    """Handles WebSocket communication and message processing."""

    def __init__(self, websocket: WebSocket, session_manager: SessionManager):
        self.websocket = websocket
        self.session_manager = session_manager
        self.session: Optional[GraphSession] = None

    async def handle_connection(self) -> None:
        """Handle the entire WebSocket connection lifecycle."""
        await self.websocket.accept()

        self.session = self.session_manager.create_session()

        try:
            await self._send_session_start()

            async for message in self._receive_messages():
                await self._process_message(message)

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected for session {self.session.session_id}")
        except Exception as e:
            logger.error(f"WebSocket error for session {self.session.session_id}: {e}")
            await self._send_error(f"Server error: {str(e)}")
        finally:
            if self.session:
                self.session_manager.cleanup_session(self.session.session_id)

    async def _receive_messages(self):
        """Async generator for receiving and parsing messages."""
        while True:
            try:
                raw_message = await self.websocket.receive_text()
                data = json.loads(raw_message)

                # Reset session timeout on activity
                self.session_manager.reset_timeout(self.session.session_id)

                yield data

            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON received: {e}")
                await self._send_error("Invalid message format")
                continue

    async def _process_message(self, data: dict) -> None:
        """Process a single WebSocket message."""
        message_type = data.get("type")

        if message_type == MessageType.USER_INPUT.value:
            await self._handle_text_input(data)
        elif message_type == MessageType.VOICE_INPUT.value:
            await self._handle_voice_input(data)
        else:
            await self._send_error(f"Unknown message type: {message_type}")

    async def _handle_text_input(self, data: dict) -> None:
        """Handle text input from user."""
        user_input = data.get("content", "")
        logger.info(f"Processing text input: '{user_input}'")

        try:
            response_text, response_time, current_node = await self.session.process_input(
                user_input
            )
            await self._send_ai_response(response_text, response_time, current_node)
        except Exception as e:
            logger.error(f"Text processing error: {e}")
            await self._send_error(f"Processing failed: {str(e)}")

    async def _handle_voice_input(self, data: dict) -> None:
        """Handle voice input from user."""
        audio_data_b64 = data.get("audio_data", "")
        logger.info(f"Processing voice input")

        try:
            # Decode and transcribe audio
            audio_data = base64.b64decode(audio_data_b64)
            transcribed_text = voice_service.transcribe_audio(audio_data, "webm")

            # Validate transcription
            if not transcribed_text or not TranscriptionValidator.is_valid(transcribed_text):
                logger.info(f"Rejecting invalid transcription: '{transcribed_text}'")
                return

            # Send transcription confirmation
            await self._send_transcription(transcribed_text)

            # Process transcribed text
            response_text, response_time, current_node = await self.session.process_input(
                transcribed_text
            )
            await self._send_ai_response(
                response_text,
                response_time,
                current_node,
                transcribed_text=transcribed_text,
                is_voice=True,
            )

        except Exception as e:
            logger.error(f"Voice processing error: {e}")
            await self._send_error(f"Voice processing failed: {str(e)}")

    async def _send_session_start(self) -> None:
        """Send session start message."""
        await self._send_raw_message(
            {
                "type": MessageType.SESSION_START.value,
                "content": "Welcome to the Argument Clinic! Please start by saying something.",
                "session_id": self.session.session_id,
            }
        )

    async def _send_transcription(self, text: str) -> None:
        """Send transcription confirmation."""
        await self._send_raw_message(
            {
                "type": MessageType.TRANSCRIPTION.value,
                "content": text,
                "session_id": self.session.session_id,
            }
        )

    async def _send_ai_response(
        self,
        content: str,
        response_time: float,
        current_node: str,
        transcribed_text: Optional[str] = None,
        is_voice: bool = False,
    ) -> None:
        """Send AI response with optional TTS audio."""
        # Generate TTS audio if voice service is available
        audio_url = None
        if voice_service.is_available():
            try:
                audio_data = voice_service.synthesize_speech(content, "mr_barnard")
                if audio_data:
                    audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                    audio_url = f"data:audio/mpeg;base64,{audio_b64}"
            except Exception as e:
                logger.warning(f"TTS generation failed: {e}")

        # Build response data
        response_data = {
            "type": MessageType.AI_RESPONSE.value,
            "content": content,
            "session_id": self.session.session_id,
            "turn_count": self.session.state.turn_count,
            "payment_received": self.session.state.payment_received,
            "current_node": current_node,
            "websocket_status": "connected",
            "response_time_ms": round(response_time, 2),
        }

        if transcribed_text:
            response_data["transcribed_text"] = transcribed_text
        if is_voice:
            response_data["is_voice"] = True
        if audio_url:
            response_data["audio_url"] = audio_url

        await self._send_raw_message(response_data)

    async def _send_error(self, error_message: str) -> None:
        """Send error message."""
        await self._send_raw_message(
            {
                "type": MessageType.ERROR.value,
                "content": error_message,
                "session_id": self.session.session_id if self.session else "unknown",
            }
        )

    async def _send_raw_message(self, message_dict: dict) -> None:
        """Send raw message with error handling."""
        try:
            await self.websocket.send_text(json.dumps(message_dict))
        except Exception as e:
            logger.error(f"Failed to send WebSocket message: {e}")


# Global session manager
session_manager = SessionManager()


@router.websocket("/argument")
async def websocket_argument_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time argument clinic conversations."""
    handler = WebSocketHandler(websocket, session_manager)
    await handler.handle_connection()


@router.get("/health")
async def health_check():
    """Health check endpoint with metrics."""
    return {
        "status": "healthy",
        "active_sessions": session_manager.get_active_count(),
        "voice_service_available": voice_service.is_available(),
        "voice_service_status": voice_service.get_status(),
        "metrics": metrics.get_metrics(),
        "timestamp": time.time(),
    }


@router.get("/metrics")
async def get_metrics():
    """Get detailed performance metrics."""
    return {
        "performance": metrics.get_metrics(),
        "sessions": {
            "active_count": session_manager.get_active_count(),
            "timeout_minutes": settings.max_session_minutes,
        },
        "voice_service": {
            "available": voice_service.is_available(),
            "status": voice_service.get_status(),
            "capabilities": voice_service.get_provider_capabilities(),
        },
    }


@router.get("/voices")
async def get_available_voices():
    """Get available voices for TTS."""
    return {
        "available": voice_service.is_available(),
        "voices": voice_service.get_available_voices(),
    }
