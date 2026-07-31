# Threat Model Documentation

Detailed threat model analysis for the Fara1.5 Browser Automation Platform.

## Contents

- [Executive Summary](./summary.md) - High-level threat landscape
- [T1 Browser Takeover](./t1-browser-takeover.md) - CDP endpoint protection
- [T2 Prompt Injection](./t2-prompt-injection.md) - Website content attack mitigation
- [T3 Credential Exposure](./t3-credential-exposure.md) - Secrets protection
- [T4 Cross-Tenant Access](./t4-cross-tenant.md) - Tenant isolation verification
- [T5 SSRF DNS Rebinding](./t5-ssrf-dns.md) - Network attack prevention
- [T6 Extension Tab Escape](./t6-tab-escape.md) - Extension scope enforcement
- [T7 Protocol Replay](./t7-replay.md) - Session replay protection
- [T8 Resource Exhaustion](./t8-resource-exhaustion.md) - Denial of service prevention

## Threat Categories

| ID | Threat | Severity | Status |
|----|--------|----------|--------|
| T1 | Browser Takeover via CDP | Critical | Mitigated |
| T2 | Prompt Injection | High | Mitigated |
| T3 | Credential Exposure | Critical | Mitigated |
| T4 | Cross-Tenant Session Access | Critical | Mitigated |
| T5 | SSRF / DNS Rebinding | High | Mitigated |
| T6 | Extension Tab Escape | High | Mitigated |
| T7 | Protocol Replay | Medium | Mitigated |
| T8 | Resource Exhaustion | Medium | Mitigated |

## Security Boundaries

1. **Tenant boundary** - Database and network isolation per tenant
2. **Session boundary** - Isolated browser sessions per task
3. **MCP boundary** - Playwright MCP internal only
4. **Client boundary** - Raw CDP not publicly reachable

## Related

- [THREAT_MODEL.md](../../THREAT_MODEL.md)
- [Security Documentation](../security/README.md)
