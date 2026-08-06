# Fara Inference Service Dockerfile
# Multi-stage build for production image

# Stage 1: Builder
FROM python:3.11-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster package management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.cargo/bin:${PATH}"

# Copy application files
COPY app/ ./app/
COPY pyproject.toml ./

# Install Python dependencies
RUN uv pip install --system --no-cache -r pyproject.toml

# Stage 2: Production
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 as production

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VLLM_PORT=8000 \
    SERVICE_PORT=8080

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python

# Create non-root user
RUN groupadd -r -g 1000 inference && useradd -r -u 1000 -g inference inference

WORKDIR /app

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --chown=inference:inference app/ ./app/

# Install vLLM (final production dependency)
# Note: vLLM requires CUDA and is installed separately to ensure proper GPU support
RUN pip install vllm>=0.6.0

# Switch to non-root user
USER inference:inference

# Expose ports
EXPOSE 8080 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Entry point - uses shell form to allow vLLM args to be passed
ENTRYPOINT ["/bin/bash", "-c"]

# Default command - starts both vLLM server and FastAPI
CMD echo "Starting vLLM server..." && \
    vllm serve ${VLLM_MODEL_REPO:-inventic/fara1.5-9b} \
        --port ${VLLM_PORT:-8000} \
        --model ${VLLM_MODEL_ID:-fara1.5-9b} \
        --tokenizer ${VLLM_MODEL_REPO:-inventic/fara1.5-9b} \
        --trust-remote-code \
        --dtype half \
        --max-model-len ${VLLM_MAX_MODEL_LEN:-32768} \
        --gpu-memory-utilization ${VLLM_GPU_MEMORY_UTILIZATION:-0.90} \
        --max-num-seqs ${VLLM_MAX_NUM_SEQS:-256} \
        --max-num-concurrent-limit ${VLLM_MAX_NUM_CONCURRENT_LIMIT:-256} \
        --enable-chunked-prefill \
        --enable-prefix-caching \
        --host 0.0.0.0 \
        --api-key ${VLLM_API_KEY:-} & \
    echo "Starting FastAPI service..." && \
    uvicorn app.main:app --host 0.0.0.0 --port ${SERVICE_PORT:-8080}
