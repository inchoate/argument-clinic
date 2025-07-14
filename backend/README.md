# Argument Clinic Backend

The backend service for the Argument Clinic application, built with FastAPI and Pydantic AI.

## Features

- Real-time WebSocket communication
- State machine-based conversation flow
- Multi-provider AI integration (OpenAI, Anthropic, Google)
- Voice processing with STT/TTS capabilities
- Performance metrics and observability

## Tech Stack

- **Framework**: [FastAPI](https://fastapi.tiangolo.com/)
- **State Management**: [Pydantic AI Graph](https://github.com/pydantic/pydantic-ai)
- **AI Providers**: OpenAI GPT, Anthropic Claude, Google Gemini
- **Voice Services**: ElevenLabs, OpenAI Whisper, Google TTS/STT
- **Observability**: OpenTelemetry, Jaeger
- **Package Management**: uv

## Directory Structure

```
backend/
├── src/
│   ├── models/         # Pydantic models
│   ├── services/       # Business logic & AI
│   │   ├── argument_clinic_graph.py  # State machine
│   │   └── voice_service.py          # Voice processing
│   ├── routes/         # API endpoints
│   │   └── websocket.py              # WebSocket routes
│   ├── core/           # Infrastructure
│   │   └── observability.py          # Tracing setup
│   ├── config.py       # Configuration
│   ├── performance.py  # Metrics
│   └── main.py         # FastAPI app
├── static/             # Static files
├── pyproject.toml      # Python dependencies
├── requirements.txt    # Pinned dependencies
└── Dockerfile          # Container config
```

## Development Setup

### Environment Setup

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
uv pip install -e .
# OR
pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file with the following variables:

```
# AI Providers (at least one required)
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
GOOGLE_API_KEY=your-google-key

# Voice Providers (optional)
ELEVENLABS_API_KEY=your-elevenlabs-key

# Application Config
ENVIRONMENT=development
DEBUG=true
LOG_LEVEL=INFO
ENABLE_TRACING=false
```

### Running the Service

```bash
# Run with uvicorn directly
uvicorn src.main:app --reload

# Or use the helper script
python src/main.py
```

### API Endpoints

- `GET /` — Root endpoint with API info
- `GET /health` — Health check with metrics
- `GET /ws/metrics` — Detailed performance metrics
- `GET /ws/voices` — Available TTS voices
- `WS /ws/argument` — WebSocket endpoint for real-time conversation

## Docker

Build and run the container:

```bash
docker build -t argument-clinic-backend .
docker run -p 8000:8000 argument-clinic-backend
```

## Testing

Run tests with pytest:

```bash
pytest
```

## License

See the project root for license information. 
