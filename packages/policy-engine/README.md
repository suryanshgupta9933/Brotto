# Policy Engine

Shared library for evaluating action policies and determining whether actions require user approval. Implements the critical-action classification system.

## Purpose

The policy engine provides:
- Critical-action classification (sign-in, personal info, passwords, email, publishing, etc.)
- Policy evaluation given action, target domain, and context
- Approval requirement determination
- Domain allowlist/blocklist evaluation
- Policy decision audit trail

## Critical Actions Requiring Approval

- Signing in
- Entering personal information
- Entering passwords or one-time codes
- Sending email or messages
- Publishing content
- Submitting forms with external impact
- Making purchases
- Accepting terms
- Changing account permissions
- Deleting data
- Uploading files
- Downloading sensitive information
- Inviting users
- Creating API keys
- Changing payment details
- Completing CAPTCHAs

## Technology

- TypeScript
- Zod for policy schema

## Usage

```typescript
import { PolicyEngine, PolicyContext } from '@fara/platform/policy-engine';

const engine = new PolicyEngine(policyRules);
const decision = engine.evaluate({
  action: 'fill_credential',
  domain: 'example.com',
  context: { hasUserConsent: true },
});
```

## Related

- [Agent Orchestrator](../../services/agent-orchestrator/README.md)
- [Audit Service](../../services/audit-service/README.md)
