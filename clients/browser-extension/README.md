# Browser Extension

Chrome/Edge extension that enables selected browser tabs to be controlled by the server. Uses the chrome.debugger interface to attach to user-selected tabs.

## Purpose

The browser extension provides:
- Connection of selected Chrome or Edge tabs to the server
- Manual tab selection (one tab or tab group per session)
- Explicit chrome.debugger attachment
- Outbound WSS relay connection
- Active badge showing automation status
- Immediate detachment on disconnect

## Technology

- TypeScript
- Manifest V3
- WebCrypto for device key generation
- Service worker

## Authentication

The extension uses:
- WebCrypto-generated device keys (non-exportable where supported)
- Signed server challenges
- Short-lived session tokens
- Single-use pairing codes
- Server-side token revocation

No permanent API tokens in extension source or storage.

## Permissions

The extension requests:
- `debugger` - for chrome.debugger interface
- `activeTab` - for active tab access
- `tabs` - for tab listing
- `tabGroups` - for tab group management
- `<all_urls>` - for attaching to any selected tab

## Security Scope

Default behavior:
- Manual tab selection required
- One tab group per automation session
- No silent browser-wide attachment
- No automatic reconnection after explicit cancellation
- Visible session owner and server domain
- Clear warning before attaching authenticated tabs

## Limitations

- Higher-risk interactive mode (accesses user's logged-in browser state)
- chrome.debugger exposes only supported CDP domains
- Service workers can be suspended
- Behavior varies between Chrome and Edge versions

## Related

- [CDP Relay](../../services/cdp-relay/README.md)
- [Desktop Connector](../desktop-connector/README.md)
