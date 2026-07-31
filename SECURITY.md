# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within the Fara1.5 Browser Automation Platform, please report it responsibly.

### How to Report

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email a description of the vulnerability to security@inventic.io
3. Include the following details:
   - Type of vulnerability
   - Full paths of source file(s) related to the vulnerability
   - Location of the affected source code
   - Any special configuration required to reproduce the issue
   - Step-by-step instructions to reproduce the issue
   - Proof-of-concept or exploit code (if possible)
   - Impact of the issue

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: We aim to resolve critical issues within 30 days

### Security Updates

Security updates will be released as patch versions and announced through the project's security advisories.

## Security Architecture

The platform is designed with the following security principles:

- **Never expose raw CDP to the public internet** - browsers listen only on loopback
- **Outbound WSS relay** - clients establish authenticated outbound connections
- **Mutual TLS** - for native connectors where possible
- **Tenant isolation** - one tenant per security boundary
- **Critical-action approval** - irreversible actions require explicit user approval
- **Protocol-level controls** - replay protection, sequence numbers, short-lived session leases

For detailed security architecture, see [docs/security/README.md](docs/security/README.md).
