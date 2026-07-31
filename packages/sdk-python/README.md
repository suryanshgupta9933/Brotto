# SDK Python

Official Python SDK for interacting with the Fara1.5 Browser Automation Platform. Provides idiomatic Python clients for task creation, session management, and real-time events.

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

Or install from source:

```bash
pip install -e .
```

## Usage

### API Client

```python
import os
from fara_sdk import FaraClient, create_client_with_api_key

# With API key
client = create_client_with_api_key(
    base_url="https://api.fara.example.com",
    api_key=os.environ["FARA_API_KEY"],
)

# Or with OIDC
from fara_sdk import create_client_with_oidc

client = create_client_with_oidc(
    base_url="https://api.fara.example.com",
    oidc={
        "issuer": "https://auth.fara.example.com",
        "client_id": "your-client-id",
        "tokens": {
            "access_token": "...",
            "refresh_token": "...",
        },
    },
)
```

### Tasks

```python
import asyncio
from fara_sdk import FaraClient, CreateTaskInput, Priority

async def main():
    client = FaraClient(config=FaraClientConfig(
        base_url="https://api.fara.example.com",
        api_key=os.environ["FARA_API_KEY"],
    ))

    # Create a task
    response = await client.tasks_create(CreateTaskInput(
        goal="Search for flights from NYC to LA",
        priority=Priority.HIGH,
    ))
    task = response["task"]
    print(f"Created task: {task.id}")

    # Get task status
    response = await client.tasks_get(task.id)
    print(f"Task status: {response['task'].status}")

    # List tasks
    response = await client.tasks_list(status="completed")
    for task in response["data"]:
        print(f"Completed task: {task.id}")

    # Update a task
    response = await client.tasks_update(
        task.id,
        UpdateTaskInput(priority=Priority.LOW),
    )

    # Cancel a task
    await client.tasks_cancel(task.id)

    await client.close()

asyncio.run(main())
```

### Sessions

```python
from fara_sdk import CreateSessionInput

async def main():
    # Create a session for a task
    response = await client.sessions_create(
        CreateSessionInput(task_id=task.id)
    )
    session = response["session"]
    print(f"Created session: {session.id}")

    # Get session details
    response = await client.sessions_get(session.id)
    print(f"Session state: {response['session'].state}")

    # List sessions
    response = await client.sessions_list(status="executing")
    for session in response["data"]:
        print(f"Active session: {session.id}")

    # Terminate a session
    await client.sessions_terminate(session.id, reason="user_requested")

    await client.close()

asyncio.run(main())
```

### WebSocket Real-time Events

```python
import asyncio
from fara_sdk import WebSocketClient, create_websocket_url

async def main():
    ws_url = create_websocket_url(
        "https://api.fara.example.com",
        session.id,
    )

    ws_client = WebSocketClient(
        url=ws_url,
        session_id=session.id,
        auth_token="your-auth-token",
        on_state_change=lambda prev, curr: print(f"State: {prev} -> {curr}"),
        on_action_requested=lambda action: print(f"Action requested: {action}"),
        on_approval_required=lambda approval: print(f"Approval required: {approval.id}"),
        on_approval_decided=lambda aid, decision, by: print(f"Approval {aid} was {decision}"),
    )

    await ws_client.connect()
    print("Connected to session events")

    # Keep running
    await asyncio.Event().wait()

asyncio.run(main())

# Or use async iterator
async def watch_with_iterator():
    async for event in watch_session(config):
        print(f"{event.type}: {event.payload}")
```

### Approvals

```python
from fara_sdk import ApprovalDecision

async def main():
    # List pending approvals
    response = await client.approvals_list(status="pending")
    for approval in response["data"]:
        print(f"Pending: {approval.id} - {approval.action_type}")

    # Decide on an approval
    response = await client.approvals_decide(
        approval_id,
        ApprovalDecision(decision="approved"),
    )
    print(f"Decision: {response['approval'].status}")

    await client.close()

asyncio.run(main())
```

### Session Helpers

```python
from fara_sdk import (
    is_terminal_state,
    is_active_state,
    get_state_description,
    calculate_session_metrics,
    SessionReplay,
)

# Check if session is in a terminal state
if is_terminal_state(session.state):
    print("Session has ended")

# Get human-readable state description
print(get_state_description(session.state))

# Calculate metrics from events
metrics = calculate_session_metrics(session.id, started_at, events)
print(f"Actions: {metrics.action_count}, Approvals: {metrics.approval_count}")

# Replay session events
replay = SessionReplay(events)
while replay.has_next():
    event = replay.next()
    print(event.type)
```

### Authentication

```python
from fara_sdk import (
    TokenManager,
    fetch_oidc_discovery,
    build_authorization_url,
    exchange_code_for_tokens,
    generate_state,
    generate_code_verifier,
    generate_code_challenge,
)

async def oidc_flow():
    # OIDC discovery
    discovery = await fetch_oidc_discovery("https://auth.fara.example.com")

    # PKCE flow
    state = generate_state()
    code_verifier = generate_code_verifier()
    code_challenge = await generate_code_challenge(code_verifier)

    auth_url = build_authorization_url(
        authorization_endpoint=discovery.authorization_endpoint,
        client_id="your-client-id",
        redirect_uri="https://your-app.com/callback",
        state=state,
        code_challenge=code_challenge,
    )

    # After callback, exchange code for tokens
    tokens = await exchange_code_for_tokens(
        token_endpoint=discovery.token_endpoint,
        client_id="your-client-id",
        code=authorization_code,
        redirect_uri="https://your-app.com/callback",
        code_verifier=code_verifier,
    )

    # Use TokenManager for automatic refresh
    token_manager = TokenManager(issuer, client_id)
    token_manager.set_tokens(tokens)

    # Create client with token manager
    client = FaraClient(config=FaraClientConfig(
        base_url="https://api.fara.example.com",
        oidc={
            "issuer": issuer,
            "client_id": client_id,
            "tokens": {
                "access_token": tokens.access_token,
                "refresh_token": tokens.refresh_token,
            },
        },
        on_token_refresh=lambda t: print(f"Token refreshed: {t}"),
    ))

    await client.close()

asyncio.run(oidc_flow())
```

### Error Handling

```python
from fara_sdk import (
    FaraClient,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    RateLimitError,
    is_sdk_error,
    is_authentication_error,
)

async def main():
    try:
        response = await client.tasks_get("non-existent-id")
    except is_authentication_error(error):
        print("Need to re-authenticate")
    except NotFoundError as e:
        print(f"Task not found: {e.message}")
    except ValidationError as e:
        print(f"Validation failed: {e.validation_errors}")
    except RateLimitError as e:
        print(f"Rate limited, retry after: {e.retry_after}")
    except Exception as e:
        if is_sdk_error(e):
            print(f"SDK error: {e.code} - {e.message}")

asyncio.run(main())
```

## Technology

- Python 3.11+
- httpx for HTTP
- pydantic for validation
- asyncio for async operations
- websockets for WebSocket support

## Related

- [SDK TypeScript](../sdk-typescript/README.md)
- [API Gateway](../../services/api-gateway/README.md)
- [Fara Action Schema](../fara-action-schema/README.md)
