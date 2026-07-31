# SDK Python

Official Python SDK for interacting with the Fara1.5 platform API. Provides idiomatic Python clients for task creation, session management, and real-time events.

## Purpose

The Python SDK provides:
- Typed API client for control plane endpoints
- Task creation and management
- Session monitoring with asyncio support
- Approval submission
- Credential management
- Audit log access

## Installation

```bash
pip install fara-platform-sdk
```

## Usage

```python
from fara_platform import FaraClient

client = FaraClient(
    base_url="https://api.fara.example.com",
    api_key=os.environ["FARA_API_KEY"],
)

task = client.tasks.create(
    goal="Search for flights from NYC to LA",
    model="fara15-9b",
)

async for event in client.sessions.watch(task.session_id):
    print(event.type, event.data)
```

## Technology

- Python 3.11+
- httpx for HTTP
- pydantic for validation
- asyncio for async operations

## Related

- [SDK TypeScript](../sdk-typescript/README.md)
- [API Gateway](../../services/api-gateway/README.md)
