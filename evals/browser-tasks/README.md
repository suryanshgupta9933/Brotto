# Browser Tasks Evaluation

Integration test suite for end-to-end browser automation tasks. Tests the complete agent loop from task creation through completion.

## Purpose

The browser-tasks evaluation suite tests:
- Search and information retrieval
- Multi-step form filling
- CRM workflow navigation
- Scheduling tasks
- File download and upload
- Authenticated dashboard navigation
- Dynamic single-page application interaction
- Popup and nested frame handling

## Metrics Tracked

- Task success rate
- Action accuracy
- Average steps to completion
- Repeated-action rate
- Human-intervention rate
- Screenshot-to-action latency
- End-to-end task latency
- Model cost per task
- Failure category distribution

## Technology

- TypeScript
- Playwright for browser automation
- Custom task harness

## Running Tests

```bash
cd evals/browser-tasks
npm install
npm test
```

## Browser Compatibility

Tests run on:
- Chrome stable and beta
- Edge stable
- Windows, macOS (Intel and Apple Silicon), Linux

## Related

- [Prompt Injection Tests](../prompt-injection/README.md)
- [Security Tests](../security/README.md)
- [Reliability Tests](../reliability/README.md)
