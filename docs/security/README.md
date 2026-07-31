# Security Documentation

Security architecture and best practices for the Fara1.5 Browser Automation Platform.

## Contents

- [Overview](./overview.md) - Security architecture summary
- [CDP Security](./cdp-security.md) - Browser debugging interface protection
- [Credential Handling](./credentials.md) - Credential broker and secrets management
- [Network Security](./network.md) - Network restrictions and egress control
- [Session Isolation](./session-isolation.md) - Tenant and session boundaries
- [Audit Logging](./audit.md) - Security event recording

## Security Principles

1. **Never expose raw CDP** - Browsers listen only on loopback; clients connect outbound
2. **Defense in depth** - Multiple layers of security controls
3. **Principle of least privilege** - Minimal permissions for all components
4. **Fail secure** - Deny by default; safe defaults
5. **Observable** - Comprehensive audit logging for security analysis

## Critical Security Controls

- CDP loopback-only binding with random ports
- Mutual TLS for native connectors
- Short-lived session leases
- Replay protection with sequence numbers
- Critical-action mandatory approval
- Credential broker pattern
- Domain allowlisting
- SSRF protection (block private IPs by default)

## Incident Response

For security incidents, contact: security@inventic.io

See [SECURITY.md](../../SECURITY.md) for full disclosure policy.

## Related

- [Threat Model](../../THREAT_MODEL.md)
- [Protocol Documentation](../protocol/README.md)
