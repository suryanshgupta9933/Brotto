# Artifact Service

Service for managing file transfers between client browsers and the server. Handles download approval workflows and secure file storage.

## Purpose

The artifact service provides:
- Encrypted file upload and download
- Download approval workflows
- Session-scoped temporary directory management
- File metadata tracking (filename, MIME type, size, checksum)
- Retention policy enforcement
- Secure file deletion after transfer

## Technology

- TypeScript
- Object storage (S3-compatible) for encrypted artifacts
- PostgreSQL for metadata

## Security

- Files are encrypted at rest
- Temporary files are deleted according to retention policy
- The CDP tunnel is not an unrestricted filesystem bridge
- Cross-tenant artifact references are rejected

## Downloads Flow

1. Browser downloads into connector-controlled temp directory
2. Connector records metadata
3. User or policy approves transfer
4. File encrypted and uploaded to artifact service
5. Temporary files deleted

## Related

- [Agent Orchestrator](../agent-orchestrator/README.md)
- [Desktop Connector](../../clients/desktop-connector/README.md)
