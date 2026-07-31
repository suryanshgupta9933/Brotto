# Shared Telemetry

Shared OpenTelemetry instrumentation for the Fara1.5 platform. Contains common trace/span attributes, exporters configuration, and telemetry utilities.

## Purpose

The shared-telemetry package provides:
- Common span attributes (service name, tenant ID, session ID)
- Trace context propagation utilities
- Standardized logger with trace context
- Exporter configuration (OTLP, console)
- Metrics definitions and collectors
- Health check integration

## Technology

- TypeScript
- OpenTelemetry SDK
- Metrics API (OTLP or Prometheus)

## Instrumentation

All platform services should use shared telemetry to ensure consistent trace context across service boundaries.

```typescript
import { createTelemetry, trace, metrics } from '@fara/platform/shared-telemetry';

const { tracer, meter } = createTelemetry({
  serviceName: 'agent-orchestrator',
  exporter: 'otlp',
});
```

## Attributes

Standard attributes include:
- `fara.tenant_id`
- `fara.session_id`
- `fara.task_id`
- `fara.model_version`
- `fara.action_type`

## Related

- All services use this package for observability
