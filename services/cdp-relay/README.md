# CDP Relay Service

High-throughput relay broker that tunnels Chrome DevTools Protocol frames between server-side Playwright MCP and client browsers.

## Features

- **WebSocket Server**: Full-duplex communication over secure WebSocket connections
- **CDP Frame Tunneling**: Forward browser CDP commands and responses between clients and server
- **Per-Session Channel Isolation**: Each browser session gets its own isolated channel
- **Heartbeat Monitoring**: Detect stale connections and maintain session liveness
- **Session Revocation (Kill Switch)**: Immediate disconnect capability
- **Tenant/Session Binding**: Reject cross-tenant frames for security
- **Bandwidth and Message Limits**: Per-session rate limiting
- **Protocol Version Negotiation**: Handshake to agree on protocol version
- **Replay Protection**: Sequence number tracking prevents message replay attacks

## Architecture

```
services/cdp-relay/
├── cmd/
│   └── server/
│       └── main.go           # Entry point with CLI
├── internal/
│   ├── server/               # WebSocket server implementation
│   ├── session/             # Session management
│   ├── tunnel/              # CDP tunneling
│   ├── protocol/            # Protocol types and validation
│   ├── heartbeat/           # Heartbeat monitoring
│   └── ratelimit/           # Rate limiting
├── Dockerfile
└── README.md
```

## Protocol

Every relay message includes:
- `protocolVersion`: Version of the protocol in use
- `tenantId`: Tenant identifier for multi-tenant isolation
- `sessionId`: Unique session identifier (cryptographically random)
- `deviceId`: Device identifier
- `channelId`: Channel identifier (no cross-session reuse)
- `sequenceNumber`: Ordered sequence number for replay protection
- `messageType`: Type of message
- `expiry`: Expiration timestamp for short-lived session leases
- `payload`: Message payload (CDP frames, heartbeats, etc.)
- `signature`: Message signature or authenticated transport context

### Message Types

- **Control**: HELLO, HELLO_ACK, HEARTBEAT, GOODBYE, ERROR
- **Session**: SESSION_CREATE, SESSION_CREATE_ACK, SESSION_RENEW, SESSION_RENEW_ACK, SESSION_REVOKE, SESSION_REVOKED
- **Channel**: CHANNEL_OPEN, CHANNEL_OPEN_ACK, CHANNEL_CLOSE, CHANNEL_CLOSED
- **CDP**: CDP_FRAME, CDP_FRAME_ACK
- **Backpressure**: BACKPRESSURE_BEGIN, BACKPRESSURE_END, RATE_LIMIT_UPDATE

## Running

### Local Development

```bash
go run ./cmd/server --address=127.0.0.1:8080 --log-level=debug
```

### Docker

```bash
docker build -t cdp-relay .
docker run -p 8080:8080 cdp-relay
```

### With TLS

```bash
docker run -p 8080:8080 \
  -v /path/to/cert.pem:/certs/cert.pem \
  -v /path/to/key.pem:/certs/key.pem \
  cdp-relay --tls-cert=/certs/cert.pem --tls-key=/certs/key.pem
```

### With Mutual TLS

```bash
docker run -p 8080:8080 \
  -v /path/to/cert.pem:/certs/cert.pem \
  -v /path/to/key.pem:/certs/key.pem \
  -v /path/to/ca.pem:/certs/ca.pem \
  cdp-relay --tls-cert=/certs/cert.pem --tls-key=/certs/key.pem --tls-ca=/certs/ca.pem --mtls
```

## Configuration

| Flag | Environment Variable | Default | Description |
|------|---------------------|---------|-------------|
| `--address` | `CDP_RELAY_ADDRESS` | `127.0.0.1:8080` | Server address |
| `--tls-cert` | `CDP_RELAY_TLS_CERT` | `` | TLS certificate file |
| `--tls-key` | `CDP_RELAY_TLS_KEY` | `` | TLS private key file |
| `--tls-ca` | `CDP_RELAY_TLS_CA` | `` | CA certificate for mTLS |
| `--mtls` | `CDP_RELAY_MTLS` | `false` | Enable mutual TLS |
| `--session-lease` | `CDP_RELAY_SESSION_LEASE` | `5m` | Default session lease |
| `--heartbeat-interval` | `CDP_RELAY_HEARTBEAT_INTERVAL` | `30s` | Heartbeat interval |
| `--rate-limit-tps` | `CDP_RELAY_RATE_LIMIT_TPS` | `1000` | Rate limit (tokens/sec) |
| `--rate-limit-burst` | `CDP_RELAY_RATE_LIMIT_BURST` | `100` | Rate limit burst size |
| `--log-level` | `CDP_RELAY_LOG_LEVEL` | `info` | Log level |

## Security

- **Never expose raw CDP ports** to the public internet
- Browser CDP only on loopback interface
- TLS-only connections
- Mutual TLS for native connectors
- Short-lived session leases
- Tenant-bound sessions
- Cryptographically random identifiers
- Replay protection with ordered sequence numbers
- Per-session bandwidth and message limits
- Immediate revocation capability

## Testing

```bash
go test ./...
go test -v -race ./...
```

## Related

- [Browser MCP Gateway](../browser-mcp-gateway/README.md)
- [Desktop Connector](../../clients/desktop-connector/README.md)
- [Browser Extension](../../clients/browser-extension/README.md)
- [Relay Protocol](../../packages/relay-protocol/README.md)
