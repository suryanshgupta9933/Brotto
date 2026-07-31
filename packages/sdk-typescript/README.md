# SDK TypeScript

Official TypeScript SDK for interacting with the Fara1.5 Browser Automation Platform. Provides typed clients for task creation, session management, and real-time events.

## Purpose

The TypeScript SDK provides:
- Typed API client for control plane endpoints
- Task creation and management
- Session monitoring with WebSocket events
- Approval submission
- Credential management
- Audit log access

## Installation

```bash
npm install @fara/platform-sdk
```

## Usage

### API Client

```typescript
import { FaraClient, createClientWithAPIKey } from '@fara/platform-sdk';

// With API key
const client = createClientWithAPIKey(
  'https://api.fara.example.com',
  process.env.FARA_API_KEY!
);

// Create a task
const { task } = await client.tasks.create({
  goal: 'Search for flights from NYC to LA',
  priority: 'high',
});

// Get task status
const { task } = await client.tasks.get(task.id);

// List tasks with filters
const { data: tasks } = await client.tasks.list({
  page: 1,
  limit: 20,
  status: 'completed',
});

// Update a task
const { task } = await client.tasks.update(task.id, {
  priority: 'low',
});

// Cancel a task
await client.tasks.cancel(task.id);
```

### Session Management

```typescript
// Create a session for a task
const { session } = await client.sessions.create({ taskId: task.id });

// Get session details
const { session } = await client.sessions.get(session.id);

// List sessions
const { data: sessions } = await client.sessions.list({
  status: 'executing',
});

// Terminate a session
await client.sessions.terminate(session.id, 'user_requested');
```

### WebSocket Real-time Events

```typescript
import { WebSocketClient, createWebSocketUrl } from '@fara/platform-sdk';

const wsUrl = createWebSocketUrl('https://api.fara.example.com', session.id);

const wsClient = new WebSocketClient({
  url: wsUrl,
  sessionId: session.id,
  authToken: 'your-auth-token',
  onStateChange: (previous, current) => {
    console.log(`State: ${previous} -> ${current}`);
  },
  onActionRequested: (action) => {
    console.log('Action requested:', action);
  },
  onApprovalRequired: (approval) => {
    console.log('Approval required:', approval);
  },
  onApprovalDecided: (approvalId, decision) => {
    console.log(`Approval ${approvalId} was ${decision}`);
  },
});

wsClient.connect().then(() => {
  console.log('Connected to session events');
});

// For async iteration
for await (const event of watchSession({
  url: wsUrl,
  sessionId: session.id,
  authToken: 'your-auth-token',
})) {
  console.log(event.type, event.payload);
}
```

### Approvals

```typescript
// List pending approvals
const { data: approvals } = await client.approvals.list({
  status: 'pending',
});

// Decide on an approval
const { approval } = await client.approvals.decide(approvalId, {
  decision: 'approved', // or 'denied'
});
```

### Session Helpers

```typescript
import {
  isTerminalState,
  isActiveState,
  getStateDescription,
  calculateSessionMetrics,
  SessionReplay,
} from '@fara/platform-sdk';

// Check if session is in a terminal state
if (isTerminalState(session.state)) {
  console.log('Session has ended');
}

// Get human-readable state description
console.log(getStateDescription(session.state)); // "Session completed successfully"

// Calculate metrics from events
const metrics = calculateSessionMetrics(session.id, startedAt, events);
console.log(`Actions: ${metrics.actionCount}, Approvals: ${metrics.approvalCount}`);

// Replay session events
const replay = new SessionReplay(events);
while (replay.hasNext()) {
  const event = replay.next();
  console.log(event.type);
}
```

### Authentication

```typescript
import {
  TokenManager,
  fetchOIDCDiscovery,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@fara/platform-sdk';

// OIDC discovery
const discovery = await fetchOIDCDiscovery('https://auth.fara.example.com');

// PKCE flow
const state = generateState();
const codeVerifier = generateCodeVerifier();
const codeChallenge = await generateCodeChallenge(codeVerifier);

const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: discovery.authorization_endpoint,
  clientId: 'your-client-id',
  redirectUri: 'https://your-app.com/callback',
  state,
  codeChallenge,
});

// After callback, exchange code for tokens
const tokens = await exchangeCodeForTokens({
  tokenEndpoint: discovery.token_endpoint,
  clientId: 'your-client-id',
  code: authorizationCode,
  redirectUri: 'https://your-app.com/callback',
  codeVerifier,
});

// Use TokenManager for automatic refresh
const tokenManager = new TokenManager(oidcIssuer, clientId);
tokenManager.setTokens(tokens);

const client = new FaraClient({
  baseUrl: 'https://api.fara.example.com',
  oidc: {
    issuer: oidcIssuer,
    clientId,
    tokens,
  },
  onTokenRefresh: (newToken) => {
    console.log('Token refreshed:', newToken);
  },
});
```

### Error Handling

```typescript
import {
  FaraClient,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  isSDKError,
  isAuthenticationError,
} from '@fara/platform-sdk';

try {
  const { task } = await client.tasks.get('non-existent-id');
} catch (error) {
  if (isAuthenticationError(error)) {
    console.log('Need to re-authenticate');
  } else if (error instanceof NotFoundError) {
    console.log('Task not found:', error.message);
  } else if (error instanceof ValidationError) {
    console.log('Validation failed:', error.validationErrors);
  } else if (error instanceof RateLimitError) {
    console.log('Rate limited, retry after:', error.retryAfter);
  }
}
```

## Technology

- TypeScript 5+
- Universal (Node.js 18+ and browser)
- Zod for response validation
- WebSocket for real-time events

## API Reference

### FaraClient

Main API client for interacting with the Fara1.5 Platform.

#### Constructor Options

```typescript
interface FaraClientConfig {
  baseUrl: string;           // API base URL
  apiKey?: string;           // API key for authentication
  oidc?: {                   // OIDC configuration (alternative to apiKey)
    issuer: string;
    clientId: string;
    audience?: string;
    tokens?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    };
  };
  timeout?: number;          // Request timeout in ms (default: 30000)
  maxRetries?: number;       // Max retries (default: 3)
  onTokenRefresh?: (token: string) => void;
}
```

### WebSocketClient

Client for receiving real-time session events.

#### Constructor Options

```typescript
interface WebSocketClientConfig {
  url: string;               // WebSocket URL
  sessionId: string;         // Session ID to subscribe to
  authToken?: string;        // Auth token
  tokenManager?: TokenManager;
  onOpen?: () => void;
  onClose?: (code: number, reason?: string) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: SessionEvent) => void;
  onStateChange?: (previous: SessionState, current: SessionState) => void;
  onActionRequested?: (action: unknown) => void;
  onActionExecuted?: (actionId: string, success: boolean, error?: string) => void;
  onApprovalRequired?: (approval: ApprovalRequest) => void;
  onApprovalDecided?: (approvalId: string, decision: 'approved' | 'denied', decidedBy: string) => void;
  onSessionError?: (error: string) => void;
  onHeartbeat?: (leaseExpiresAt: number) => void;
  reconnect?: boolean;       // Auto-reconnect (default: true)
  reconnectDelay?: number;   // Reconnect delay in ms (default: 1000)
  maxReconnectAttempts?: number;
}
```

## Related

- [SDK Python](../sdk-python/README.md)
- [API Gateway](../../services/api-gateway/README.md)
- [Fara Action Schema](../fara-action-schema/README.md)
