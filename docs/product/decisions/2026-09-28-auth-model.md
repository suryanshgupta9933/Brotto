# Decision: Auth model — self-host secret + hosted email magic link

**Date:** 2026-09-28
**Type:** Architecture / product
**Status:** Accepted
**Related:** `2026-09-28-product-boundary-and-bets.md`, `2026-09-28-distribution-oss-cloud.md`

## Context

Identity today is **client IP**. `main.py` keys user policies and per-user model configs off `request.client.host`, hashed with `sha256[:32]`. `POST /v1/sessions` is unauthenticated and mints a `session_id` for any caller, and `/ws/ext/{session_id}` accepts any connection. Anyone who can reach the server can run tasks.

`session/auth.py` already contains `validate_token`, but it is **not wired to `/ws/ext`**, and it is gated behind `AGENT_AUTH_DISABLED` which defaults to `"true"`. So the code looks protected and is not.

`main.py:227` additionally hardcodes `ws://localhost:8000` into the `websocket_url` it returns to the extension — the root cause of remote users silently connecting to localhost.

A public launch plus a hosted free tier makes this the highest-severity gap. It is workstream 3A.

## Options considered

- **GitHub OAuth** — rejected. The target audience is non-technical; requiring a GitHub account is a category error. Also implies a dev-shaped onboarding that decision `2026-09-28-product-boundary-and-bets.md` rules out.
- **Anonymous install token** — rejected as the primary path. Cheapest today, but a token→account migration lands exactly when billing arrives in Phase 4, and it provides no verified email, which is what Stripe needs.
- **Email magic link (passwordless)** — chosen for hosted. Universal for a non-technical audience, yields a durable `user_id` plus a verified email, and attaches to Stripe in Phase 4 without re-architecture. No passwords to store, phish, or reset.

## Choice

**Two deliberately separated paths.**

**Self-host — no account, ever.** The server mints a shared secret on first boot, prints it, and writes it to `./data/instance.json`. The user pastes it into the extension, where it lands in `chrome.storage.local`. The secret *is* the identity — which is what eliminates IP keying. Wires up the `validate_token` that already exists rather than adding new machinery.

**Hosted — email magic link.** `POST /v1/auth/request` sends a single-use link (15-minute expiry); verification returns a long-lived JWT carrying `user_id` and `plan`. Quota, task history, and spend key off `user_id`. In Phase 4 a Stripe customer attaches to that same `user_id` and the JWT gains a plan claim.

Identity stays behind one small module so a later swap is contained.

## Consequences

**Enabled:**
- Closes the unauthenticated-WS gap and removes all IP-keyed state.
- Self-hosters never depend on the email infrastructure, so the hosted path cannot block the OSS story.
- A verified email and durable `user_id` exist before billing does — Phase 4 becomes attachment, not reconstruction.

**Closed off:**
- No social login. Accept the activation dent.
- A real email-sending dependency exists for the hosted tier. At launch scale the cost is ~$0 on any provider free tier.

**New constraints — abuse control is denominated in tasks, not dollars.** With BYOK the model bill is the user's key, so the operator's exposure is orchestration CPU. But a heavy user with an expensive key still costs real money with no revenue. Cap **concurrency and tasks/day**, not token spend, and do not let the free tier imply unlimited parallel tabs.

## Follow-ups

- [ ] Wire `validate_token` into `/ws/ext/{session_id}` (3A)
- [ ] Replace the hardcoded `ws://localhost:8000` in `main.py:227` with a request-derived URL (3A/3C)
- [ ] Remove IP-keyed identity from policy and model-config persistence (3A)
- [ ] Decide whether hosted auth ships before or after first public launch — sequencing call, not settled here
- [ ] Set `AGENT_AUTH_DISABLED` default to `"false"` once 3A lands
