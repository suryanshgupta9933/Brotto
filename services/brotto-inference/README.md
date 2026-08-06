# Brotto Inference Service

OpenAI-compatible inference service for the Brotto model family using vLLM.

## Purpose

The Brotto inference service provides:
- OpenAI-compatible inference endpoints (vLLM backend)
- Support for Brotto-4B, Brotto-9B, and Brotto-27B models
- GPU-accelerated inference via vLLM
- Continuous batching for high throughput
- Model version management with stable prompt formats

## Technology

- Python 3.11+
- FastAPI for OpenAI-compatible REST API
- vLLM for high-performance inference
- Kubernetes for autoscaling and deployment

## Model Configuration

| Model | Profile | VRAM | Use Case |
|-------|---------|------|----------|
| Brotto-4B | Economy | 8GB | Development, self-hosted |
| Brotto-9B | Standard | 16GB | Production (default) |
| Brotto-27B | Quality | 48GB | Difficult tasks |

## Project Structure

```
services/brotto-inference/
├── app/
│   ├── __init__.py      # Package exports
│   ├── main.py           # FastAPI application
│   ├── api.py            # OpenAI-compatible endpoints
│   ├── client.py         # vLLM client wrapper
│   ├── models.py         # Model manifests
│   ├── prompts.py        # Prompt template manager
│   └── batching.py       # Continuous batching config
├── deploy/
│   └── k8s/              # Kubernetes manifests
│       ├── deployment.yaml         # Standard (9B)
│       ├── economy-deployment.yaml # Economy (4B)
│       ├── quality-deployment.yaml # Quality (27B)
│       └── configmap.yaml          # vLLM config
├── tests/
│   ├── test_prompts.py   # Prompt template tests
│   ├── test_client.py    # vLLM client tests
│   └── conftest.py       # Pytest fixtures
├── Dockerfile
└── pyproject.toml
```

## API Endpoints

### OpenAI-Compatible Endpoints

- `POST /v1/chat/completions` - Chat completion inference
- `GET /v1/models` - List available models
- `GET /v1/models/{model_id}` - Get model info
- `GET /health` - Service health check

### Prompt Management

- `POST /prompts/render` - Render a prompt template
- `GET /prompts/versions` - List prompt template versions

## Usage

### Running Locally

```bash
# Install dependencies
pip install -e .

# Start the service
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

### Docker

```bash
# Build image
docker build -t brotto-inference:latest .

# Run container
docker run --gpus all -p 8080:8080 brotto-inference:latest
```

### Kubernetes

```bash
# Apply standard deployment (9B)
kubectl apply -f deploy/k8s/deployment.yaml

# Apply economy deployment (4B)
kubectl apply -f deploy/k8s/economy-deployment.yaml

# Apply quality deployment (27B)
kubectl apply -f deploy/k8s/quality-deployment.yaml
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `VLLM_MODEL_ID` | fara1.5-9b | Model identifier |
| `VLLM_MODEL_REPO` | inventic/fara1.5-9b | HuggingFace repo |
| `VLLM_MAX_MODEL_LEN` | 32768 | Max context length |
| `VLLM_GPU_MEMORY_UTILIZATION` | 0.90 | GPU memory fraction |
| `VLLM_MAX_NUM_SEQS` | 256 | Max concurrent sequences |
| `VLLM_TENSOR_PARALLEL_SIZE` | 1 | Tensor parallelism |
| `VLLM_PORT` | 8000 | vLLM server port |
| `SERVICE_PORT` | 8080 | FastAPI service port |

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html
```

## Prompt Versioning

The service maintains versioned prompt templates to ensure prompt stability during model switches. The current version is V2, which includes:

- Structured failure context handling
- Action history formatting
- Approved user answers tracking
- Concise failure messaging

## Autoscaling

The service supports Kubernetes HPA with:
- CPU utilization targeting (70%)
- Memory utilization targeting (80%)
- Custom metrics for pending vLLM requests

## Related

- [Agent Orchestrator](../agent-orchestrator/README.md)
- [MODEL_USAGE.md](../../MODEL_USAGE.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
