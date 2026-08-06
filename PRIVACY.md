# Privacy Policy

## Data Collection and Handling

The Brotto Browser Automation Platform is designed with privacy as a core principle. This document describes how data is handled.

## Platform Architecture and Privacy

The platform operates on a **server-hosted agent** model:

- **Inference runs server-side** - screenshots and task data are processed on the server
- **Clients are thin transports** - the desktop connector and browser extension relay CDP data only
- **Model interaction is server-controlled** - the model never accesses client data directly

## Screenshot Handling

- **Default: No screenshot retention** - screenshots are processed and discarded after inference
- **Optional retention** - organizations may configure screenshot retention with appropriate consent
- **Automatic redaction** - sensitive content (passwords, credit cards) is redacted before any logging
- **User-accessible deletion** - users can request deletion of their session data

## Browser Data

- **Dedicated browser profiles** - the desktop connector uses dedicated profiles, not user profiles
- **Session-scoped cookies** - cookies are isolated per automation session
- **No cross-session sharing** - cookies and state are not shared between unrelated tasks
- **Profile cleanup** - ephemeral profiles are deleted after task completion

## Audit Logs

The audit service records:
- Session metadata (creator, device, domain)
- Policy decisions (approved/denied actions)
- Timing and error information

Audit logs do **not** contain:
- Screenshot pixel data (by default)
- Passwords or credentials
- Authorization tokens

## Data Residency

- Screenshot processing occurs in the deployed region
- Audit logs are stored in the configured database
- No data is shared with third parties for training purposes

## Compliance

Organizations are responsible for ensuring their use of the platform complies with applicable privacy regulations (GDPR, CCPA, etc.).

## Privacy by Design

The platform implements privacy-by-design principles:
- Data minimization - only necessary data is collected
- Purpose limitation - data is used only for its intended purpose
- Storage limitations - automatic cleanup of temporary data
- Security - encryption at rest and in transit

## Contact

For privacy-related questions, contact: privacy@inventic.io
