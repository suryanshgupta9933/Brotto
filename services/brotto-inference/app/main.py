"""
Brotto Inference Service - FastAPI Application

OpenAI-compatible inference service for Brotto model family using vLLM.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    print("Starting Brotto Inference Service...")
    yield
    # Shutdown
    print("Shutting down Brotto Inference Service...")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Brotto Inference Service",
        description="OpenAI-compatible inference service for Brotto model family using vLLM",
        version="1.0.0",
        lifespan=lifespan,
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API routes
    app.include_router(router, tags=["inference"])

    @app.get("/")
    async def root():
        """Root endpoint with service information."""
        return {
            "service": "brotto-inference",
            "version": "1.0.0",
            "description": "OpenAI-compatible inference service for Brotto models",
        }

    return app


# Application instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
