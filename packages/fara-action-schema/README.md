# Fara Action Schema

Shared library containing the Fara action schema and validation logic. Defines the canonical set of actions the Fara model can produce and their validation rules.

## Purpose

The fara-action-schema package provides:
- Zod schemas for all Fara actions (left_click, double_click, right_click, drag, mouse_move, scroll, key, visit_url, history_back, screenshot, wait, ask_user_question, terminate, pause_and_memorize_fact)
- Action argument validation
- Coordinate validation (viewport bounds, observation reference)
- Action parsing utilities for the orchestrator

## Technology

- TypeScript
- Zod for schema validation

## Action List

| Action | Description |
|--------|-------------|
| left_click | Click at viewport coordinates |
| double_click | Double-click at viewport coordinates |
| right_click | Right-click at viewport coordinates |
| drag | Drag from one coordinate to another |
| mouse_move | Move cursor to viewport coordinates |
| scroll | Scroll at viewport coordinates |
| key | Press a keyboard key |
| visit_url | Navigate to a URL |
| history_back | Navigate back in browser history |
| screenshot | Capture current viewport |
| wait | Pause for specified duration |
| ask_user_question | Request user input/approval |
| terminate | End the automation session |
| pause_and_memorize_fact | Store information in session memory |

## Coordinate System

All coordinates are in viewport pixel space (not device pixels). Screenshots are normalized to a fixed model canvas, and coordinates must be transformed back to viewport space before execution.

## Related

- [Agent Orchestrator](../../services/agent-orchestrator/README.md)
- [Browser MCP Gateway](../../services/browser-mcp-gateway/README.md)
- [Coordinate Transform](../coordinate-transform/README.md)
