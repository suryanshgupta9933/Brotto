# Fara Inference Service

Server-side inference service for the Fara1.5 model family. Provides OpenAI-compatible API endpoints for the agent orchestrator.

## Purpose

The Fara inference service provides:
- OpenAI-compatible inference endpoints
- Support for Fara1.5-4B, Fara1.5-9B, and Fara1.5-27B models
- GPU-accelerated inference via vLLM
- Continuous batching
- Model version management

## Technology

- Python
- vLLM for inference
- OpenAI-compatible API (vLLM backend)

## Model Configuration

- **Fara1.5-9B**: Default production model
- **Fara1.5-4B**: Economy/self-hosted profile
- **Fara1.5-27B**: Quality-focused optional profile

## Deployment

The inference service should be autoscaled independently from the orchestration tier. Model weights are fetched separately and are not included in this repository.

## Related

- [Agent Orchestrator](../agent-orchestrator/README.md)
- [MODEL_USAGE.md](../../MODEL_USAGE.md)
