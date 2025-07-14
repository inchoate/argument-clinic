"""
OpenTelemetry observability configuration for the Argument Clinic.
Provides distributed tracing for LLM interactions and application performance.
"""

import logging
from contextlib import contextmanager
from typing import Optional

from config import settings
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased

logger = logging.getLogger(__name__)


class ObservabilityConfig:
    """Observability configuration derived from settings."""

    def __init__(self):
        self.enabled = getattr(settings, "enable_tracing", True)
        self.service_name = "argument-clinic-backend"
        self.service_version = "2.0.0"
        self.jaeger_endpoint = getattr(settings, "jaeger_endpoint", "http://localhost:14250")
        self.sample_rate = getattr(settings, "trace_sample_rate", 1.0)

    @property
    def otlp_endpoint(self) -> str:
        """Convert Jaeger endpoint to OTLP format."""
        if "localhost:16686" in self.jaeger_endpoint:
            return "http://localhost:14250"  # Jaeger OTLP gRPC port
        return self.jaeger_endpoint


observability_config = ObservabilityConfig()
_tracer_provider: Optional[TracerProvider] = None
_span_processor: Optional[BatchSpanProcessor] = None


def setup_observability(app) -> None:
    """Set up OpenTelemetry tracing with OTLP exporter."""
    global _tracer_provider, _span_processor

    if not observability_config.enabled:
        logger.info("OpenTelemetry tracing disabled")
        return

    try:
        # Create resource with service metadata
        resource = Resource.create(
            {
                SERVICE_NAME: observability_config.service_name,
                SERVICE_VERSION: observability_config.service_version,
                "environment": settings.environment,
                "debug": settings.debug,
            }
        )

        # Configure sampling
        sampler = TraceIdRatioBased(observability_config.sample_rate)

        # Set up tracer provider
        _tracer_provider = TracerProvider(resource=resource, sampler=sampler)
        trace.set_tracer_provider(_tracer_provider)

        # Configure OTLP exporter (modern replacement for Jaeger exporter)
        otlp_exporter = OTLPSpanExporter(
            endpoint=observability_config.otlp_endpoint, insecure=True  # For local development
        )

        # Add span processor
        _span_processor = BatchSpanProcessor(otlp_exporter)
        _tracer_provider.add_span_processor(_span_processor)

        # Instrument FastAPI
        FastAPIInstrumentor.instrument_app(app)

        # Instrument HTTP client for LLM API calls
        HTTPXClientInstrumentor().instrument()

        # Instrument logging
        LoggingInstrumentor().instrument(set_logging_format=True)

        logger.info(f"OpenTelemetry tracing enabled for {observability_config.service_name}")
        logger.info(f"OTLP endpoint: {observability_config.otlp_endpoint}")
        logger.info(f"Sample rate: {observability_config.sample_rate}")

    except Exception as e:
        logger.error(f"Failed to set up OpenTelemetry: {e}")
        logger.info("Application will continue without tracing")


def shutdown_observability() -> None:
    """Clean shutdown of observability components."""
    global _span_processor

    if _span_processor:
        _span_processor.shutdown()
        logger.info("OpenTelemetry span processor shut down")


def get_tracer(name: str = __name__) -> trace.Tracer:
    """Get a tracer instance for manual instrumentation."""
    return trace.get_tracer(name)


class LLMTracer:
    """Enhanced tracer for LLM and AI interactions."""

    def __init__(self):
        self.tracer = get_tracer("ai-interactions")

    @contextmanager
    def trace_llm_call(
        self, provider: str, model: str, operation: str = "completion", **attributes
    ):
        """
        Context manager for tracing LLM API calls.

        Args:
            provider: AI provider (openai, anthropic, google)
            model: Model name (gpt-4o-mini, claude-3, etc.)
            operation: Type of operation (completion, transcription, synthesis)
            **attributes: Additional span attributes
        """
        with self.tracer.start_as_current_span(f"llm_{operation}") as span:
            span.set_attributes(
                {
                    "ai.provider": provider,
                    "ai.model": model,
                    "ai.operation": operation,
                    **attributes,
                }
            )

            try:
                yield span
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
                raise

    def trace_conversation_flow(
        self,
        session_id: str,
        current_state: str,
        previous_state: Optional[str] = None,
        turn_count: int = 0,
        user_intent: Optional[str] = None,
        **metadata,
    ):
        """
        Trace conversation state transitions and flow.

        Args:
            session_id: Session identifier
            current_state: Current graph state
            previous_state: Previous graph state
            turn_count: Number of conversation turns
            user_intent: Detected user intention
            **metadata: Additional conversation metadata
        """
        with self.tracer.start_as_current_span("conversation_flow") as span:
            span.set_attributes(
                {
                    "conversation.session_id": session_id,
                    "conversation.current_state": current_state,
                    "conversation.turn_count": turn_count,
                    **metadata,
                }
            )

            if previous_state:
                span.set_attribute("conversation.previous_state", previous_state)
            if user_intent:
                span.set_attribute("conversation.user_intent", user_intent)

    def trace_voice_processing(
        self,
        session_id: str,
        operation: str,  # transcription, synthesis
        provider: str,
        audio_duration_ms: Optional[float] = None,
        **attributes,
    ):
        """
        Trace voice processing operations.

        Args:
            session_id: Session identifier
            operation: Voice operation type
            provider: Voice service provider
            audio_duration_ms: Audio duration in milliseconds
            **attributes: Additional voice processing attributes
        """
        with self.tracer.start_as_current_span(f"voice_{operation}") as span:
            span.set_attributes(
                {
                    "voice.operation": operation,
                    "voice.provider": provider,
                    "voice.session_id": session_id,
                    **attributes,
                }
            )

            if audio_duration_ms:
                span.set_attribute("voice.audio_duration_ms", audio_duration_ms)

    @contextmanager
    def trace_graph_execution(self, session_id: str, node_name: str, **attributes):
        """
        Context manager for tracing graph node execution.

        Args:
            session_id: Session identifier
            node_name: Name of the graph node being executed
            **attributes: Additional node execution attributes
        """
        with self.tracer.start_as_current_span(f"graph_node_{node_name}") as span:
            span.set_attributes(
                {"graph.session_id": session_id, "graph.node_name": node_name, **attributes}
            )

            try:
                yield span
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
                raise


# Global tracer instances
llm_tracer = LLMTracer()


# Convenience functions for common tracing patterns
def trace_ai_agent_call(provider: str, model: str, prompt_length: int, **kwargs):
    """Convenience function for tracing AI agent calls."""
    return llm_tracer.trace_llm_call(
        provider=provider,
        model=model,
        operation="agent_call",
        prompt_length=prompt_length,
        **kwargs,
    )


def trace_voice_transcription(provider: str, audio_size_bytes: int, **kwargs):
    """Convenience function for tracing voice transcription."""
    return llm_tracer.trace_llm_call(
        provider=provider,
        model="whisper" if provider == "openai" else "unknown",
        operation="transcription",
        audio_size_bytes=audio_size_bytes,
        **kwargs,
    )


def trace_voice_synthesis(provider: str, text_length: int, voice_id: str, **kwargs):
    """Convenience function for tracing voice synthesis."""
    return llm_tracer.trace_llm_call(
        provider=provider,
        model="tts",
        operation="synthesis",
        text_length=text_length,
        voice_id=voice_id,
        **kwargs,
    )
