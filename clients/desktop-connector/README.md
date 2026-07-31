# Desktop Connector

Native desktop application that launches a dedicated browser, connects to the CDP relay, and enables server-hosted automation. Distributed as signed ZIP packages.

## Purpose

The desktop connector is a thin client that provides:
- Dedicated Chromium browser launcher
- Local CDP discovery and bridge
- Secure outbound WSS tunnel to the CDP relay
- Device authentication and pairing
- Session indicator and local stop button
- Health checks and reconnection logic

## Technology

- Rust (preferred) or Go
- Single executable where possible
- Minimal local dependencies
- OS keychain integration for secrets

## Distribution

Published as signed ZIP packages:
- `connector-windows-x64.zip`, `connector-windows-arm64.zip`
- `connector-macos-x64.zip`, `connector-macos-arm64.zip`
- `connector-linux-x64.zip`, `connector-linux-arm64.zip`

Two variants:
- **Lightweight**: Uses installed Chrome or Edge, smaller download
- **Deterministic**: Bundles Chrome for Testing, better reproducibility

## Browser Startup

The connector launches Chromium with:
- Dedicated automation profile (`--user-data-dir`)
- Random local loopback port (`--remote-debugging-port`)
- Loopback-only binding (`--remote-debugging-address=127.0.0.1`)

## Profile Modes

- **Ephemeral**: New profile per task, deleted after completion
- **Persistent**: Retained automation profile with approved login state
- **Imported**: Explicit cookie/storage state import scoped to selected domains

## Security

- CDP only on loopback
- Outbound WSS connections only
- Browser closed on session end
- Secrets in OS keychain

## Related

- [CDP Relay](../../services/cdp-relay/README.md)
- [Browser Extension](../browser-extension/README.md)
