"""
The Argument Clinic FastAPI application.
A real-time AI recreation of Monty Python's Argument Clinic.
"""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from core.observability import setup_observability
from routes.websocket import router as websocket_router

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Starting The Argument Clinic FastAPI server...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Debug mode: {settings.debug}")
    yield
    logger.info("Shutting down The Argument Clinic FastAPI server...")

    # Clean shutdown of observability
    from core.observability import shutdown_observability

    shutdown_observability()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="The Argument Clinic API",
        description="A real-time AI recreation of Monty Python's Argument Clinic using FastAPI and Pydantic AI",
        version="2.0.0",
        lifespan=lifespan,
        debug=settings.debug,
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # POC: In production, specify frontend domains
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Set up observability
    setup_observability(app)

    # Include routers
    app.include_router(websocket_router)

    # Serve static files if directory exists
    try:
        app.mount("/static", StaticFiles(directory="static"), name="static")
        logger.info("Mounted static files directory")
    except RuntimeError:
        logger.info("No static directory found, skipping static files")

    return app


# Create the app instance
app = create_app()


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "message": "Welcome to The Argument Clinic API",
        "version": "2.0.0",
        "framework": "FastAPI + Pydantic AI",
        "environment": settings.environment,
        "docs": "/docs",
        "health": "/health",
        "websocket": "/ws/argument",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "environment": settings.environment,
        "debug": settings.debug,
        "version": "2.0.0",
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level=settings.log_level.lower(),
        reload=settings.debug,
    )
