# Security Evaluation

Comprehensive security test suite for the Fara1.5 platform.

## Purpose

The security evaluation suite tests:
- Prompt injection (see also `../prompt-injection`)
- Cross-tenant session access
- CDP endpoint discovery attempts
- Token replay attacks
- DNS rebinding attacks
- Redirect to private IP addresses
- Malicious file upload
- Oversized screenshot handling
- Malformed CDP frame handling
- Extension tab escape attempts
- Service worker restart behavior
- Credential leakage prevention
- Audit log tampering

## Test Categories

### Protocol Security
- Session token entropy and randomness
- Replay protection
- Sequence number validation
- Expiry enforcement
- Protocol version negotiation

### Network Security
- SSRF prevention
- DNS rebinding protection
- Private IP blocking
- Dangerous URL scheme blocking
- Redirect validation

### Tenant Isolation
- Cross-tenant session access attempts
- Cross-tenant artifact access attempts
- Tenant-bound authorization enforcement

### Client Security
- CDP port exposure attempts
- Extension tab escape attempts
- Local file system access attempts

## Running Tests

```bash
cd evals/security
npm install
npm test
```

## Related

- [Prompt Injection Tests](../prompt-injection/README.md)
- [Threat Model](../../THREAT_MODEL.md)
- [Security Documentation](../../docs/security/README.md)
