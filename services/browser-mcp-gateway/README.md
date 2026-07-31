# Browser MCP Gateway

Internal service that runs Playwright MCP for each browser session. Translates Fara actions into Playwright MCP tool calls and coordinates with the CDP relay.

## Purpose

The browser MCP gateway provides:
- Playwright MCP as an internal server-side dependency
- One MCP process or isolated worker per browser session
- Internal CDP relay endpoint connection
- Vision tools (screenshot capture)
- Coordinate-grounded action execution

## Technology

- TypeScript (Node.js)
- MCP SDK for protocol handling
- Playwright MCP integration
- Internal IPC or private interface (not exposed to public network)

## Architecture

```
┌─────────────────────────────────────────────┐
│           Browser MCP Gateway               │
├─────────────────────────────────────────────┤
│  Server (src/server.ts)                     │
│    - Session management                     │
│    - Worker lifecycle                       │
│    - Metrics and health                     │
├─────────────────────────────────────────────┤
│  Worker (src/worker.ts)                     │
│    - Per-session MCP client isolation       │
│    - CDP relay connection                   │
│    - Action execution                       │
├─────────────────────────────────────────────┤
│  Adapter (src/adapter.ts)                   │
│    - Fara action → MCP tool mapping         │
│    - URL validation                         │
│    - Disabled tool enforcement              │
├─────────────────────────────────────────────┤
│  Verifier (src/verifier.ts)                 │
│    - Accessibility snapshot verification     │
│    - Domain validation                      │
│    - Success condition checks               │
└─────────────────────────────────────────────┘
```

## Fara Action Mapping

Per ARCHITECTURE.md section 3.5:

| Fara action | Execution tool |
| ----------- | -------------- |
| `left_click` | `browser_mouse_click_xy` |
| `double_click` | `browser_mouse_click_xy` with `clickCount=2` |
| `right_click` | `browser_mouse_click_xy` with `right` button |
| `drag` | `browser_mouse_drag_xy` |
| `mouse_move` | `browser_mouse_move_xy` |
| `scroll` | `browser_mouse_wheel` |
| `key` | `browser_press_key` |
| `visit_url` | `browser_navigate` (with URL validation) |
| `history_back` | `browser_navigate_back` |
| `screenshot` | `browser_take_screenshot` |
| `wait` | Handled by orchestrator |
| `ask_user_question` | Control-plane approval request |
| `terminate` | Orchestrator session completion |
| `pause_and_memorize_fact` | Server-side session memory |

## Security

Per ARCHITECTURE.md section 8.6, these tools are **permanently unavailable**:

- `browser_run_code_unsafe` (arbitrary JavaScript execution)
- Shell execution
- Raw CDP commands

Per ARCHITECTURE.md section 3.5, `browser_keyboard_insert_text` is provided for safe focused typing.

## Accessibility Verification

Per ARCHITECTURE.md section 3.6, accessibility snapshots are used as out-of-band verifier:

- Confirm button click opened expected dialog
- Confirm text appeared
- Check form field contains expected value
- Detect navigation to unexpected domain
- Validate success before declaring task complete

## Configuration

Environment variables:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `8080` | Server port |
| `HOST` | `127.0.0.1` | Server host (internal only) |
| `CDP_RELAY_URL` | - | CDP relay endpoint URL |
| `MAX_CONCURRENT_SESSIONS` | `100` | Max concurrent browser sessions |
| `SESSION_TIMEOUT_MS` | `3600000` | Session timeout (1 hour) |

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development
npm run dev

# Run tests
npm test
```

## Docker

```bash
# Build
docker build -t fara15/browser-mcp-gateway:latest .

# Run
docker run -p 8080:8080 \
  -e CDP_RELAY_URL=ws://cdp-relay:8080 \
  fara15/browser-mcp-gateway:latest
```

## API

### Create Session
```typescript
const session = await gateway.createSession({
  session_id: 'session-123',
  cdp_endpoint: 'ws://localhost:9222',
  viewport_width: 1920,
  viewport_height: 1080,
  browser_type: 'chromium',
});
```

### Execute Action
```typescript
const result = await gateway.executeAction('session-123', {
  type: 'left_click',
  x: 100,
  y: 200,
});
```

## Related

- [Agent Orchestrator](../agent-orchestrator/README.md)
- [CDP Relay](../cdp-relay/README.md)
- [Fara Action Schema](../../packages/fara-action-schema/README.md)
