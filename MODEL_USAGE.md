# Model Usage

The Brotto Browser Automation Platform uses the Brotto family of models for inference. This document describes model usage, licensing, and configuration.

## Brotto Model Family

The platform supports three Brotto model variants:

| Model        | Parameter Count | Use Case                      | License    |
| ------------ | --------------- | ----------------------------- | ---------- |
| Brotto-4B   | 4 billion       | Development, self-hosted       | MIT        |
| Brotto-9B   | 9 billion       | Default production model      | MIT        |
| Brotto-27B  | 27 billion      | Quality-focused, complex tasks| MIT        |

## Model Licensing

All Brotto model weights are licensed under the **MIT license**.

- Brotto model weights are **not** included in this repository
- Model weights are fetched from the official model repository during deployment
- Always verify model checksums against the official manifest

## Model Deployment

### Recommended Deployment Profiles

#### Standard Profile (Brotto-9B)
- GPU-backed vLLM deployment
- Continuous batching enabled
- Default production model

#### Economy Profile (Brotto-4B)
- Lower GPU memory requirement
- Suitable for development and private installations
- Less complex automation flows

#### Quality Profile (Brotto-27B)
- Used selectively for difficult or long-tail tasks
- Optional routing after repeated 9B failures
- Higher computational cost

## Model Manifest

Each deployed model must be accompanied by a versioned manifest containing:

- Model repository identifier
- Git revision or commit hash
- SHA-256 checksum of model weights
- License file reference
- Supported inference runtime (vLLM version)
- Tested prompt template version

Example manifest:
```json
{
  "model_id": "fara15-9b",
  "revision": "v1.0.0",
  "checksum": "sha256:...",
  "license": "MIT",
  "runtime": "vllm>=0.4.0",
  "prompt_version": "1.0"
}
```

## Prompt Versioning

The platform uses a stable, versioned prompt format. Do not dynamically switch models during a task unless action history and screenshots are carried across using the same prompt version.

## Inference Endpoint

The platform uses an OpenAI-compatible inference endpoint behind the orchestrator. Configure the endpoint in the brotto-inference service environment:

```
FARA_INFERENCE_BASE_URL=http://localhost:8000/v1
FARA_INFERENCE_MODEL=fara15-9b
```

## Best Practices

1. **Never bundle model weights in Git releases**
2. **Always verify checksums** before deployment
3. **Use GPU-backed inference** for production (vLLM recommended)
4. **Separate inference autoscaling** from orchestration autoscaling
5. **Monitor token usage** and implement budgets

## External Dependencies

The Brotto models are external dependencies governed by their respective licenses. Inventic does not assume responsibility for third-party model licensing.
