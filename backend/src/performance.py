"""
Performance monitoring and metrics collection.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PerformanceMetrics:
    """Collect and calculate performance metrics."""

    response_times: deque = field(default_factory=lambda: deque(maxlen=100))
    error_count: int = 0
    success_count: int = 0
    session_count: int = 0
    audio_processing_times: deque = field(default_factory=lambda: deque(maxlen=50))

    def add_response_time(self, ms: float):
        """Add a response time measurement."""
        self.response_times.append(ms)

    def add_audio_processing_time(self, ms: float):
        """Add an audio processing time measurement."""
        self.audio_processing_times.append(ms)

    def increment_success(self):
        """Increment successful operations counter."""
        self.success_count += 1

    def increment_error(self):
        """Increment error counter."""
        self.error_count += 1

    def increment_session(self):
        """Increment session counter."""
        self.session_count += 1

    def get_metrics(self) -> dict[str, Any]:
        """Get current metrics summary."""
        response_times = list(self.response_times)
        audio_times = list(self.audio_processing_times)

        total_requests = self.success_count + self.error_count

        return {
            "response_times": {
                "avg_ms": sum(response_times) / len(response_times) if response_times else 0,
                "min_ms": min(response_times) if response_times else 0,
                "max_ms": max(response_times) if response_times else 0,
                "p95_ms": sorted(response_times)[int(len(response_times) * 0.95)] if response_times else 0,
                "p99_ms": sorted(response_times)[int(len(response_times) * 0.99)] if response_times else 0,
                "count": len(response_times)
            },
            "audio_processing": {
                "avg_ms": sum(audio_times) / len(audio_times) if audio_times else 0,
                "count": len(audio_times)
            },
            "requests": {
                "total": total_requests,
                "success": self.success_count,
                "error": self.error_count,
                "error_rate": self.error_count / total_requests if total_requests > 0 else 0
            },
            "sessions": {
                "total_created": self.session_count
            }
        }


# Global metrics instance
metrics = PerformanceMetrics()


def track_response_time(start_time: float) -> float:
    """Helper to track response time from start time."""
    response_time_ms = (time.time() - start_time) * 1000
    metrics.add_response_time(response_time_ms)
    return response_time_ms


def track_audio_processing(start_time: float) -> float:
    """Helper to track audio processing time from start time."""
    processing_time_ms = (time.time() - start_time) * 1000
    metrics.add_audio_processing_time(processing_time_ms)
    return processing_time_ms
