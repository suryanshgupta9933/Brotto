# Decision: Default model — MiniMax is dev-only

**Date:** 2026-09-28
**Question:** Q2 (open-questions.md)
**Status:** Accepted (placeholder)

## Context

Question: what should the default model be at first run?

The current behavior (per CLAUDE.md): `BROTTO_ENV=dev` defaults to `anthropic:MiniMax-M3.1-Flash-Preview` (1M context, covered by Claude Code Token Plan subscriptions). The CLAUDE.md gotcha note: "MiniMax-M3 pay-as-you-go returns 402 insufficient_balance; dev default is M3.1-Flash-Preview for this reason."

## Choice

**MiniMax is a dev-time placeholder. A better model will be default at launch.**

Specifically:
- Keep `BROTTO_ENV=dev` defaulting to `MiniMax-M3.1-Flash-Preview` for development (works without API spend).
- Production launch default: pick a better model closer to launch (when we know what Claude Sonnet/Opus generation is current, what OpenAI shipped, what Anthropic Computer Use scoring looks like).
- `BROTTO_ENV=prod` already opts out — operator (or extension settings) picks the actual default.
- Don't over-design the model adapter around MiniMax as a permanent first-class citizen. It's a placeholder.

## Consequences

**Enabled:**
- Clean migration path when we pick the real launch default (no MiniMax-specific UX, no MiniMax-specific docs, no MiniMax-as-brand)
- Production defaults stay current with model state-of-the-art
- Token Plan ergonomics (`AUTH_TOKEN → API_KEY` propagation) still works for whatever model we land on

**Closed off:**
- No "Brotto is the MiniMax agent" branding
- No MiniMax-specific marketing in Phase 2 launch
- Don't optimize the harness loop for MiniMax quirks (it's a dev-time provider)

**New constraints:**
- The 1M-context default in `CONTEXT_WINDOW_TOKENS=1000000` is MiniMax-specific; production launch needs a new default that matches the chosen model's context window
- Need to re-evaluate at launch: which model is "best" in Sept 2027 (when we'd be in late Phase 4)?

## Follow-ups

- [ ] Decide production launch default model ~4 weeks before Phase 2 OSS launch
- [ ] Decide production launch default context window at the same time
- [ ] Don't write MiniMax-specific copy into the public README or extension UI