# Agent Orchestrator

The core agent harness that owns the complete browser automation loop. The orchestrator maintains session state, manages the Fara inference pipeline, and coordinates actions through the MCP gateway.

## Purpose

The agent orchestrator owns:
- Session state machine (CREATED → WAITING_FOR_CLIENT → CONNECTED → OBSERVING → PLANNING → POLICY_CHECK → WAITING_FOR_APPROVAL → EXECUTING → VERIFYING → COMPLETED/FAILED/CANCELLED)
- Task goal maintenance
- Bounded action and screenshot history
- Fara inference requests
- Fara tool call parsing and validation
- Policy approval requests
- Action execution through MCP
- Screenshot capture and next browser state
- Completion and failure detection
- Time, step, token, and cost budgets
- Retry and circuit breaker logic

## Technology

- TypeScript
- Coordinates with Fara inference service and Browser MCP gateway
- Uses @fara/fara-action-schema for action validation
- Uses @fara/policy-engine for policy enforcement

## Security

The orchestrator is a critical security boundary. It never lets the model directly control authentication tokens, CDP session identifiers, internal service URLs, arbitrary JavaScript execution, local file paths, system commands, or policy settings.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Orchestrator                        │
│                                                             │
│  SessionStateMachine ── manages session lifecycle            │
│  HistoryManager ─────── bounded action/screenshot history    │
│  FaraInferenceClient ── OpenAI-compatible inference client  │
│  ToolCallParser ─────── validates and parses tool calls      │
│  PolicyIntegrator ───── policy engine integration           │
│  ActionExecutor ─────── MCP action execution                │
│  CompletionDetector ── completion/failure detection         │
│  AgentBudgetTracker ─── time/step/token/cost budgets        │
│  ResilientExecutor ──── retry + circuit breaker             │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### Session State Machine (`src/session.ts`)
- Full state lifecycle management
- Event emission for state changes
- Context tracking (goal, URL, domain, last action result)
- Invalid state transition detection

### History Manager (`src/history.ts`)
- Bounded action history (configurable max size)
- Bounded screenshot history
- Memory storage for pause_and_memorize_fact actions
- Prompt context builder for Fara inference
- Full trajectory recording for auditing

### Fara Inference Client (`src/inference.ts`)
- OpenAI-compatible API client
- System and user prompt building
- Tool call extraction from model response
- Token usage tracking

### Tool Call Parser (`src/parser.ts`)
- Parses tool calls from Fara inference
- Validates arguments against fara-action-schema
- Blocks dangerous tools (browser_run_code_unsafe, shell, etc.)
- Coordinate bounds validation
- URL scheme validation (rejects javascript:, data:, etc.)

### Policy Integrator (`src/policy.ts`)
- Critical action classification
- Policy engine evaluation
- Approval request creation and management
- Budget checking

### Action Executor (`src/executor.ts`)
- Maps Fara actions to Playwright MCP tools
- Timeout handling
- Execution state management
- Mock gateway for testing

### Completion Detector (`src/completion.ts`)
- Goal completion detection
- Repeated failure detection
- Repeated action detection
- Accessibility snapshot analysis (as out-of-band verifier)

### Budget Tracker (`src/budget.ts`)
- Step counting
- Session duration tracking
- Token usage tracking
- Cost tracking
- Budget exhaustion events

### Retry and Circuit Breaker (`src/retry.ts`)
- Exponential backoff retry
- Circuit breaker pattern
- Configurable failure thresholds
- Event emission for state changes

## Usage

```typescript
import { AgentOrchestrator, createOrchestrator } from './src';

const orchestrator = createOrchestrator({
  session: {
    sessionId: 'my-session',
    goal: 'Search for cat pictures',
    tenantId: 'tenant-1',
    userId: 'user-1',
  },
  inference: {
    endpoint: 'http://fara-inference:8000/v1/chat/completions',
    model: 'fara-1.5-9b',
  },
  mcpGateway: myMcpGateway,
});

orchestrator.on('stateChanged', (session, oldState, newState) => {
  console.log(`State: ${oldState} → ${newState}`);
});

await orchestrator.start();
```

## Testing

```bash
npm test
```

## Run with Ollama (local development)

Prerequisites: [Ollama](https://ollama.ai) installed, a small model pulled.

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# Start the Ollama server
ollama serve &

# Pull a small model (3B; first run downloads ~2GB)
ollama pull qwen2.5:3b

# Install dependencies and build
pnpm install
pnpm build

# Run smoke (canned observation → model → action)
OLLAMA_HOST=http://127.0.0.1:11434 SMOKE_MODEL=qwen2.5:3b pnpm smoke
```

Expected output: `[smoke] family=openai-compatible ... responded in <X>ms` followed by a `PlanningOutcome` JSON.

### Other providers

- **OpenAI**: `OPENAI_API_KEY=sk-... pnpm smoke`
- **Azure OpenAI**: `AZURE_OPENAI_API_KEY=... AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com AZURE_OPENAI_DEPLOYMENT=<deployment> pnpm smoke`
- **Fara**: `FARA_ENDPOINT=https://<fara-host> pnpm smoke`

The smoke script reads `OLLAMA_HOST`, `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `FARA_ENDPOINT`, and `SMOKE_MODEL` from the environment and picks the right family automatically.

### Running the full E2E test

```bash
pnpm test:e2e
```

Requires Ollama running locally (the test starts its own server subprocess in CI; locally it uses whatever's on port 11434).

## Docker

```bash
docker build -t fara/agent-orchestrator .
docker run -p 3000:3000 fara/agent-orchestrator
```

## Related

- [Fara Inference Service](../fara-inference/README.md)
- [Browser MCP Gateway](../browser-mcp-gateway/README.md)
- [Policy Engine](../../packages/policy-engine/README.md)
- [Fara Action Schema](../../packages/fara-action-schema/README.md)
