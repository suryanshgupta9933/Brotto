# Reliability Evaluation

Test suite for evaluating platform reliability under adverse conditions.

## Purpose

The reliability evaluation suite tests:
- New tab and popup window handling
- Cross-origin redirect handling
- Browser dialogs (alert, confirm, prompt)
- File picker interactions
- Download and upload reliability
- Authentication redirect handling
- SSO and two-factor authentication flows
- Session expiration and recovery
- Stale screenshot detection
- Page animation handling
- Lazy-loaded content
- Infinite scrolling behavior
- Sticky header offset handling
- Browser zoom changes
- Nested iframe interactions
- Shadow DOM handling
- Service worker behavior
- Network disconnect recovery
- Browser crash recovery
- Extension suspension handling
- Client laptop sleep and resume
- Relay reconnection behavior
- Multiple monitor and display scaling
- CAPTCHA handling (pause detection)
- Sites that prohibit automation

## Metrics

- Task success rate under adverse conditions
- Mean time between failures
- Recovery success rate
- Degraded mode operation

## Related

- [Performance Tests](../performance/README.md)
- [Browser Tasks Tests](../browser-tasks/README.md)
