# The Argument Clinic 🎭

> _"An argument isn't just contradiction... it's a connected series of statements intended to establish a proposition!"_

A real-time AI recreation of Monty Python's famous "Argument Clinic" sketch, built with [**FastAPI**](https://fastapi.tiangolo.com/), [**Pydantic AI**](https://github.com/pydantic/pydantic-ai), and [**React**](https://react.dev/). Experience authentic Monty Python comedy with modern AI technology!

![monty python](frontend/public/mounty-python.png)

## ✨ **Features**

### 🎭 **Authentic Monty Python Experience**
- **Recreation**: Mimics the original sketch dialogue and progression
- **State Machine**: Intelligent conversation flow through argument stages

### 🤖 **Modern Technology**
- **Real-time WebSocket**: Real time delivery
- **[FastAPI](https://fastapi.tiangolo.com/) Backend**: High-performance async web framework
- **[Pydantic AI](https://github.com/pydantic/pydantic-ai)**: Advanced LLM integration with structured outputs
- **Pydantic AI Graph**: Sophisticated state machine for conversation management
- **Multi-Provider Support**: [OpenAI](https://openai.com/), [Anthropic](https://www.anthropic.com/), [Google AI](https://ai.google/) with intelligent fallbacks
- **Voice**: Real-time voice input/output with [ElevenLabs](https://elevenlabs.io/), Google, OpenAI TTS/STT

### 🎨 **Beautiful Interface**
- **[React](https://react.dev/) Frontend**: Modern, responsive user interface with [DaisyUI](https://daisyui.com/)
- **Real-time Updates**: Live conversation with instant feedback
- **Debug Mode**: Performance metrics and state visualization
- **Voice Ready**: Architecture prepared for voice integration

## 🏗️ **Architecture**

- **All conversation (text and voice) is real-time via WebSocket (`/ws/argument`).**
- **State machine nodes**: `EntryNode`, `SimpleContradictionNode`, `ArgumentationNode`, `MetaCommentaryNode`, `ResolutionNode`.
- **Audio**: Sent as base64 over WebSocket, not as file upload.
- **TTS/STT**: Multi-provider fallback ([ElevenLabs](https://elevenlabs.io/), [Google](https://cloud.google.com/text-to-speech), [OpenAI](https://platform.openai.com/docs/guides/text-to-speech)).
- **Session**: Managed in-memory, with timeouts and cleanup.
- **Observability**: Metrics, health endpoints, and [OpenTelemetry](https://opentelemetry.io/)/[Jaeger](https://www.jaegertracing.io/) tracing.
- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/), [Tailwind](https://tailwindcss.com/), [DaisyUI](https://daisyui.com/).
- **Deployment**: [Docker](https://www.docker.com/), [Cloud Run](https://cloud.google.com/run), [Cloudflare Pages](https://pages.cloudflare.com/).

### 📊 **System Architecture Diagrams**

For a detailed visual representation of the system architecture, including component diagrams, data flow, and technology stack, see the [System Architecture Diagram](./system-architecture-diagram.md) document.

The document includes:
- System overview diagram
- Data flow sequence diagram
- Component architecture diagram
- Technology stack visualization

## 🚀 **Quick Start**

### Docker Compose (Recommended)

```bash
git clone git@github.com:inchoate/argument-clinic.git
cd argument-clinic

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Start the full stack
docker compose up --build
```

### Manual Setup

```bash
git clone git@github.com:inchoate/argument-clinic.git
cd argument-clinic

# Backend setup
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
uv pip install -e .

# Frontend setup
cd ../frontend
npm install
```

### Environment Configuration

```bash
# Backend environment (optional for demo)
export OPENAI_API_KEY=your-openai-key
export ANTHROPIC_API_KEY=your-anthropic-key
export GOOGLE_API_KEY=your-google-key
export ELEVENLABS_API_KEY=your-elevenlabs-key
```

### Run Locally

```bash
# Terminal 1: Start FastAPI backend
cd backend
uv run python src/main.py

# Terminal 2: Start React frontend
cd frontend
npm run dev

# Terminal 3: Start Jaeger (optional, for tracing)
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 14250:14250 \
  jaegertracing/all-in-one:1.51
```

### Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **Health Check**: http://localhost:8000/health
- **Jaeger Tracing**: http://localhost:16686

## 🔧 **Development**

### Project Structure

```
argument-clinic/
├── backend/                 # FastAPI backend
│   ├── src/
│   │   ├── models/         # Pydantic models
│   │   ├── services/       # Business logic & AI
│   │   │   ├── argument_clinic_graph.py  # State machine
│   │   │   └── voice_service.py          # Voice processing
│   │   ├── routes/         # API endpoints
│   │   │   └── websocket.py              # WebSocket routes
│   │   ├── core/           # Infrastructure
│   │   │   └── observability.py         # Tracing setup
│   │   ├── config.py       # Configuration
│   │   ├── performance.py  # Metrics
│   │   └── main.py         # FastAPI app
│   ├── pyproject.toml      # Python dependencies
│   └── Dockerfile          # Container config
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   └── App.tsx         # Main application
│   ├── package.json        # Node dependencies
│   └── index.html          # Entry point
├── docker-compose.yml      # Local development stack
└── README.md              # This file
```

### Key Technologies

- **Backend**: [FastAPI](https://fastapi.tiangolo.com/), [Pydantic AI](https://github.com/pydantic/pydantic-ai), [Uvicorn](https://www.uvicorn.org/)
- **Frontend**: [React](https://react.dev/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/), [DaisyUI](https://daisyui.com/)
- **AI**: [OpenAI GPT](https://platform.openai.com/docs/), [Anthropic Claude](https://www.anthropic.com/), [Google Gemini](https://ai.google.dev/gemini-api/docs)
- **Voice**: [ElevenLabs](https://elevenlabs.io/), [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech), [OpenAI TTS/STT](https://platform.openai.com/docs/guides/text-to-speech)
- **Monitoring**: [OpenTelemetry](https://opentelemetry.io/), [Jaeger](https://www.jaegertracing.io/)

### WebSocket Protocol

**All conversation (text and voice) is via WebSocket** (`/ws/argument`):

- **Text**: `{ type: 'user_input', content: 'your text', session_id }`
- **Voice**: `{ type: 'voice_input', audio_data: '<base64>', session_id }`
- **AI Response**: `{ type: 'ai_response', content: '...', audio_url, current_node, ... }`

### API Endpoints

- `GET /` — Root endpoint with API info
- `GET /health` — Health check with metrics  
- `GET /ws/metrics` — Detailed performance metrics
- `GET /ws/voices` — Available TTS voices
- `WS /ws/argument` — WebSocket endpoint for real-time conversation

### Manual Testing

1. Start the stack: `docker compose up` or manual setup above
2. Open [http://localhost:5173](http://localhost:5173)
3. Test conversation flow:
   - Type or speak: "I want an argument"
   - Try different paths through the state machine
   - Test voice mode (allow mic permissions)
4. Monitor performance:
   - Health: `curl http://localhost:8000/health`
   - Metrics: `curl http://localhost:8000/ws/metrics`
   - Tracing: [http://localhost:16686](http://localhost:16686)

### Monitoring & Observability

- **Health Checks**: `/health` endpoint with system status
- **Metrics**: `/ws/metrics` with response times, error rates, session stats
- **Distributed Tracing**: [OpenTelemetry](https://opentelemetry.io/) → [Jaeger](https://www.jaegertracing.io/) for end-to-end request tracking
- **Logging**: Structured logging throughout the application
- **Session Tracking**: In-memory session management with timeouts

### Performance Monitoring

- **Response Times**: Average, min, max, p95, p99 for API calls
- **AI Operations**: Token usage, model performance, provider fallbacks  
- **Voice Processing**: Transcription/synthesis latencies, audio quality metrics
- **Session Analytics**: User engagement, conversation flow patterns
- **Error Tracking**: Failed requests, AI timeouts, voice processing errors

## 🚢 **Deployment**

### Docker (Production)

```bash
# Build and run
docker compose -f docker-compose.prod.yml up --build

# Or build individual services
docker build -t argument-clinic-backend ./backend
docker build -t argument-clinic-frontend ./frontend
```

### Cloud Deployment

- **Backend**: Deploy to [Cloud Run](https://cloud.google.com/run), [Railway](https://railway.app/), or similar container platform
- **Frontend**: Deploy to [Cloudflare Pages](https://pages.cloudflare.com/), [Vercel](https://vercel.com/), or [Netlify](https://www.netlify.com/)
- **Monitoring**: Use cloud-native observability ([Cloud Monitoring](https://cloud.google.com/monitoring), [Datadog](https://www.datadoghq.com/), etc.)

### Environment Variables

Required for production:

```bash
# AI Providers (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AI...

# Voice Providers (optional)
ELEVENLABS_API_KEY=...

# Application Config
ENVIRONMENT=production
DEBUG=false
LOG_LEVEL=INFO
ENABLE_TRACING=true
```
