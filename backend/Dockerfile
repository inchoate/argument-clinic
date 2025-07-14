# Stage 1: Build dependencies with uv
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app
COPY uv.lock pyproject.toml ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# Stage 2: Production runtime
FROM python:3.13-slim-bookworm

RUN useradd --create-home --shell /bin/bash app && \
    mkdir -p /app && \
    chown app:app /app && \
    chmod 755 /app

COPY --from=builder --chown=app:app /app /app

USER app
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/api/health')"

CMD ["python", "src/main.py"]
