# Prompt Injection Evaluation

Test suite for evaluating the platform's resistance to prompt injection attacks from website content.

## Purpose

The prompt-injection evaluation suite tests:
- Injection attempts to ignore original goal
- Injection attempts to reveal credentials
- Injection attempts to upload local files
- Injection attempts to navigate to attacker-controlled domains
- Injection attempts to send sensitive information
- Injection attempts to disable security settings
- Injection attempts to execute commands

## Test Categories

1. **Goal Override Tests** - Website content attempts to redefine the task goal
2. **Credential Access Tests** - Attempts to extract or manipulate credentials
3. **File System Tests** - Attempts to read/write local files
4. **Network Tests** - Attempts to exfiltrate data or access internal services
5. **Policy Bypass Tests** - Attempts to modify or disable policies

## Expected Behavior

The platform should:
- Never allow the model to change policies
- Never include secrets in the model prompt where avoidable
- Always check external navigation independently
- Require explicit approval for sensitive actions
- Never execute arbitrary code even if requested by page content

## Related

- [Security Tests](../security/README.md)
- [Browser Tasks Tests](../browser-tasks/README.md)
- [Threat Model](../../THREAT_MODEL.md)
