# Security Policy

## Reporting a vulnerability

Email the maintainer, or open a **private** security advisory on the repository
("Security" → "Report a vulnerability"). Please do not open a public issue for an unfixed vulnerability.

Include: what you did, what you expected, what happened, the affected version, and your Chrome version
if the issue involves the extension. A proof of concept helps a great deal.

You can expect an acknowledgement within 72 hours and a substantive reply within seven days. If a fix
is warranted we will agree a disclosure date with you, and credit you in the release notes unless you
would rather we did not.

## Threat model

Brotto is unusual in a way that changes what "safe" means, so it is worth being explicit.

**Brotto is not a sandbox.** The agent operates with the full authority of the session you run it in.
A malicious page, a prompt injection in page content, or a bug in Brotto can all cause actions to be
taken as you. Treat a Brotto run the way you would treat handing your logged-in browser to a contractor.

What Brotto does provide:

- **Secure mode** gates — approval cards before a configurable list of sensitive actions (send email,
  payment, delete, publish, change password, revoke access, and similar), before the first action on a
  given domain, and on patterns marked critical.
- **Your domain blocklist, and only yours.** There is no server-side floor policy, by design.
- **Prompt-injection defence** — the system prompt establishes a trust hierarchy
  (system > user task > page content) and instructs the model to treat page content as data.
- **Secret redaction** — values typed into fields identified as credentials are redacted before the
  audit record is written.
- **No remote code execution.** The extension never `eval`s, never fetches a script, and dispatches only
  a fixed set of typed actions. See
  [`clients/brotto-extension/README.md`](clients/brotto-extension/README.md#what-this-extension-does-not-do).

What Brotto does **not** provide, and you should not assume:

- No authentication on the orchestrator. Anyone who can reach it can drive a browser. Do not expose it
  to a network you do not control.
- No isolation between concurrent users. Identity is the client IP address.
- No protection against a hostile page. Secure mode reduces the blast radius; it does not eliminate it.

## Out of scope

- Model behaviour (the agent making a poor decision is not a Brotto vulnerability, though a
  *disclosure bypass* — an action taken without a required approval — is)
- Denial of service by a page or a model
- Findings that require an attacker to already control your machine or your orchestrator
- Missing hardening with no demonstrated impact
