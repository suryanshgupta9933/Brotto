# CDP Relay

High-throughput relay broker that tunnels CDP traffic between server-side Playwright MCP and client browsers. This is the critical component that enables server-hosted browser automation.

## Purpose

The CDP relay provides:
- Authenticated WebSocket tunnel between server and clients
- TLS-only connections with mutual TLS for native connectors
- Session routing and channel management
- Heartbeats and connection liveliness
- Backpressure handling
- Immediate revocation capability
- Protocol version negotiation

## Technology

- Go or Rust (high-throughput, low-latency)
- WebSocket secure (WSS)

## Protocol

Every relay message includes:
- protocolVersion
- tenantId
- sessionId
- deviceId
- channelId
- sequenceNumber
- messageType
- expiry
- payload
- signature or authenticated transport context

Required properties:
- Cryptographically random identifiers
- Replay protection
- Ordered sequence numbers
- Short-lived session leases
- Per-session bandwidth and message-size limits

## Security Rule

**Never expose a client browser's raw CDP port to the public internet.** The browser should listen only on loopback, and the client establishes an outbound authenticated WebSocket connection to the relay.

## Related

- [Browser MCP Gateway](../browser-mcp-gateway/README.md)
- [Desktop Connector](../../clients/desktop-connector/README.md)
- [Browser Extension](../../clients/browser-extension/README.md)
- [Relay Protocol](../../packages/relay-protocol/README.md)
