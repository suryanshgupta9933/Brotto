# Threat Model

This document describes the threat model for the Brotto Browser Automation Platform. It identifies key threats and the controls in place to mitigate them.

## Asset Classification

### High-Value Assets
- Browser CDP access (full browser control)
- User authentication tokens and sessions
- Credentials stored in the credential broker
- Tenant isolation boundaries

### Medium-Value Assets
- Screenshot data containing sensitive information
- Artifact uploads/downloads
- Session metadata and audit logs

### Low-Value Assets
- Public session configuration
- Non-sensitive browser state

## Threat Categories

### T1: Browser Takeover Through CDP

**Description**: An attacker gains access to the CDP endpoint, achieving full browser control.

**Controls**:
- CDP only bound to loopback (127.0.0.1)
- Random local port assignment
- Outbound WSS connections required from client
- CDP URL never exposed in logs or APIs
- One relay channel per browser session
- Immediate channel revocation on session end

**Severity**: Critical

### T2: Prompt Injection from Websites

**Description**: Malicious website content attempts to manipulate the agent into harmful actions.

**Controls**:
- Model cannot change policies
- Instructions from pages labeled as untrusted
- External navigation independently verified
- Critical actions require deterministic approval
- No secrets in model prompt
- Irreversible actions blocked without approval

**Severity**: High

### T3: Credential Exposure

**Description**: Credentials are leaked through logs, screenshots, or model prompts.

**Controls**:
- Credential broker pattern - model requests "fill credential X" not raw values
- Password redaction in screenshots
- Cookies/tokens redacted from traces
- One-time codes never retained
- OS keychain for native client secrets

**Severity**: Critical

### T4: Cross-Tenant Session Access

**Description**: A user in one tenant accesses another tenant's session or data.

**Controls**:
- Tenant ID in all protocol messages
- Session leases bound to tenant
- Database-level tenant isolation
- No shared cookies between tenants

**Severity**: Critical

### T5: SSRF and DNS Rebinding

**Description**: Attacker tricks the browser into accessing internal services or cloud metadata.

**Controls**:
- HTTPS-only by default
- Domain allowlists
- Block private, loopback, link-local addresses unless authorized
- DNS resolution immediately before connection
- Redirect validation
- Block `file:`, `javascript:`, `data:` schemes

**Severity**: High

### T6: Extension Tab Escape

**Description**: Browser extension automation spreads to tabs not selected by user.

**Controls**:
- Manual tab selection required
- One tab group per automation session
- Explicit debugger attachment per tab
- Immediate detachment on socket close
- No automatic reconnection after user cancellation

**Severity**: High

### T7: Protocol Replay

**Description**: Attacker replays valid protocol messages to hijack or replay sessions.

**Controls**:
- Cryptographically random session/channel identifiers
- Sequence numbers with replay protection
- Short-lived session leases
- Expiry timestamps on all messages

**Severity**: Medium

### T8: Resource Exhaustion

**Description**: Malicious or runaway sessions consume excessive resources.

**Controls**:
- Step, time, token, and cost budgets per session
- Maximum screenshot size limits
- Bandwidth limits per session
- Circuit breakers for repeated failures

**Severity**: Medium

## Security Boundaries

1. **Tenant boundary** - Each tenant is a separate security domain
2. **Session boundary** - Each browser session is isolated
3. **MCP boundary** - Playwright MCP is internal only
4. **Client boundary** - Raw CDP never reaches public network

## Out of Scope

- Client laptop security (user responsibility)
- Browser extension store review processes
- Model training data concerns (separate from platform)
- Physical security of deployment infrastructure

## Threat Model Updates

This threat model will be updated as new attack vectors are discovered. See `docs/threat-model/` for detailed analysis and ADR history.
