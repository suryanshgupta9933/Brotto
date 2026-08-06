# Relay Protocol

Shared TypeScript/Go/Rust library defining the CDP relay wire protocol. Contains message schemas, serialization, validation, and protocol constants.

## Purpose

The relay protocol package provides:
- Message schema definitions (protocolVersion, tenantId, sessionId, deviceId, channelId, sequenceNumber, messageType, expiry, payload, signature)
- Serialization/deserialization (JSON with binary payloads)
- Protocol validation and version negotiation
- Sequence number tracking and replay protection
- Constants for message types and limits

## Technology

- TypeScript for web/Node.js consumers
- Go for cdp-relay service
- Rust for desktop-connector

## Usage

```typescript
import { RelayMessage, MessageType, createMessage } from '@brotto/platform/relay-protocol';

const msg = createMessage({
  sessionId: '...',
  channelId: '...',
  messageType: MessageType.CDP_FRAME,
  payload: cdpFrame,
});
```

## Security Properties

- TLS-only transport assumed
- Mutual TLS for native connectors
- Cryptographically random identifiers
- Short-lived session leases
- Replay protection via sequence numbers
- Message-size limits enforced

## Related

- [CDP Relay](../../services/cdp-relay/README.md)
- [Desktop Connector](../../...