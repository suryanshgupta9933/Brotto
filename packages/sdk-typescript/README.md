# SDK TypeScript

Official TypeScript SDK for interacting with the Fara1.5 platform API. Provides typed clients for task creation, session management, and real-time events.

## Purpose

The TypeScript SDK provides:
- Typed API client for control plane endpoints
- Task creation and management
- Session monitoring with WebSocket/SSE events
- Approval submission
- Credential management
- Audit log access

## Installation

```bash
npm install @fara/platform-sdk
```

## Usage

```typescript
import { FaraClient } from '@fara/platform-sdk';

const client = new FaraClient({
  baseUrl: 'https://api.fara.example.com',
  apiKey: process.env.FARA_API_KEY,
});

const task = await client.tasks.create({
  goal: 'Search for flights from NYC to LA',
  model: 'fara15-9b',
});

for await (const event of client.sessions.watch(task.sessionId)) {
  console.log(event.type, event.data);
}
```

## Technology

- TypeScript
- Universal (Node.js and browser)
- Zod for response validation

## Related

- [SDK Python](../sdk-python/README.md)
- [API Gateway](../../services/api-gateway/README.md)
