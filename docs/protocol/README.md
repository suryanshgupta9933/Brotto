# Protocol Documentation

Technical documentation for the Fara1.5 platform protocols.

## Contents

- [Relay Protocol](./relay-protocol.md) - CDP relay wire protocol
- [Session Lifecycle](./session-lifecycle.md) - Session state machine
- [Action Schema](./action-schema.md) - Fara action definitions
- [MCP Integration](./mcp-integration.md) - Playwright MCP integration
- [Coordinate System](./coordinates.md) - Screenshot and coordinate handling

## Relay Protocol

The relay protocol is a custom narrow protocol for CDP tunneling. Key properties:
- TLS-only transport
- Mutual TLS for native connectors
- Short-lived session leases
- Cryptographically random identifiers
- Replay protection
- Ordered sequence numbers
- Per-session limits

### Message Format

Every message includes:
- `protocolVersion` - Protocol version identifier
- `tenantId` - Tenant identifier
- `sessionId` - Session identifier
- `deviceId` - Device identifier
- `channelId` - Channel identifier
- `sequenceNumber` - Ordered sequence number
- `messageType` - Type of message
- `expiry` - Message expiry timestamp
- `payload` - Message payload
- `signature` - Authenticated transport context

## Related

- [Relay Protocol Package](../../packages/relay-protocol/README.md)
- [CDP Relay Service](../../services/cdp-relay/README.md)
