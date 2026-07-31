# Admin Console

Administrative interface for platform operators to manage organizations, monitor system health, and configure global policies.

## Purpose

The admin console provides:
- Organization and user management
- Global policy configuration
- System health and metrics dashboard
- Audit log aggregation and search
- Connector and extension version management
- Tenant isolation verification

## Technology

- TypeScript
- React
- Shares backend APIs with control-plane-web

## Access

This interface should be restricted to platform administrators with elevated privileges. Access is controlled through role-based access control (RBAC) in the control plane.

## Related

- [Control Plane Web](../control-plane-web/README.md)
- [API Gateway](../services/api-gateway/README.md)
