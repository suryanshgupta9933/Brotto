# Audit Service

Service responsible for recording and storing all security-relevant events in the platform. Provides queryable audit logs for compliance and security analysis.

## Purpose

The audit service records:
- Session creator, device identity, selected browser/tabs
- Current domain, model version, prompt template version
- Screenshot hash, proposed action, policy result
- Approval decision, executed action, result and error
- Session termination reason

## Technology

- TypeScript
- PostgreSQL for audit storage
- OpenTelemetry for observability

## Privacy

Normal application logs are kept separate from sensitive agent traces. Screenshots are not stored in audit logs by default.

Recommended privacy defaults:
- Screenshot retention disabled or short-lived
- Configurable organization retention
- Automatic redaction of sensitive data
- User-accessible deletion
- No training on user sessions by default

## Retention

Audit records support configurable retention periods per organization. Records are exportable in standard formats for compliance reporting.

## Related

- [Control Plane Web](../../apps/control-plane-web/README.md)
- [Agent Orchestrator](../agent-orchestrator/README.md)
- [Policy Engine](../../packages/policy-engine/README.md)
