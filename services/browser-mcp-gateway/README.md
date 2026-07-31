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

- TypeScript
- Playwright MCP
- Internal IPC or private interface (not exposed to public network)

## Security

Playwright MCP explicitly states it is not itself a security boundary. The allowed-origin and blocked-origin options are useful controls but do not protect redirects. Network-level enforcement is required.

The gateway does not expose `browser_run_code_unsafe` (arbitrary JavaScript execution).

## Fara Action Mapping

The gateway maps Fara actions to Playwright MCP tools:
- `left_click` → `browser_mouse_click_xy`
- `scroll` → `browser_mouse_wheel`
- `visit_url` → `browser_navigate`
- `screenshot` → `browser_take_screenshot`
- `key` → `browser_press_key`

## Related

- [Agent Orchestrator](../agent-orchestrator/README.md)
- [CDP Relay](../cdp-relay/README.md)
- [Fara Action Schema](../../packages/fara-action-schema/README.md)
