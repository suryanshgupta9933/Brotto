# Decision: Pricing — BYOK + free harness, paid cloud

**Date:** 2026-09-28
**Fork:** B
**Status:** Accepted

## Context

Three pricing options were on the table:
- B1: BYOK + free harness, paid cloud (skill library, history, multi-tab, replay) + enterprise (SOC2, SSO, audit)
- B2: BYOK + 20% markup on tokens
- B3: Bundled credits (we hold keys)

Market research showed: (1) the Anthropic Sept 2025 Usage Policy update closed the "Claude Max plugged into third-party agents" loophole — B3 is structurally risky for wrapped-Max plays. (2) Operator Pro at $200/mo is widely rejected (ZDNet: "Operator isn't worth its $200/mo"); hard ceiling for individual daily-use spend is $20–50/mo. (3) Browser Use's $0.02/browser-hr + model + 20% markup works for devs but is hard to scale to non-technical users. (4) The BYOK structure is structurally the cleanest — no API keys held, no regulatory exposure, no margin on tokens we don't sell.

The user's stated goal: acquire users first AND make money off the value provided. B1 serves both: free entry-point for adoption, paid cloud for value-add beyond raw engine.

## Choice

**B1: BYOK + free harness, paid cloud.**

### Concrete tiers

| Tier | Price | What's included |
|---|---|---|
| **OSS self-host** | $0 | Full engine, BYOK, no cloud features. For personal/eval/non-commercial under BSL. |
| **Free cloud** | $0 | 50 tasks/day, 7-day history, basic extension. Funnel to Pro. |
| **Pro** | $20/mo | Unlimited tasks, unlimited history, skill library, replay, multi-tab, cost controls. |
| **Team** | $20/seat/mo (5-seat min) | Shared skills, audit log, team dashboard. |
| **Enterprise** | $200+/seat/mo | SOC2 Type II, HIPAA option, SSO, on-prem option, custom SLA. |

**Pricing principles:**
- Zero markup on tokens (BYOK). User pays Anthropic/OpenAI directly. We are not in the LLM-resale business.
- Free cloud exists to drive adoption + funnel to Pro. Capped at 50 tasks/day so abuse is contained.
- Pro at $20/mo aligns with the user-research pricing-sensitivity ceiling ($20–50/mo for daily-use individuals).
- Enterprise at $200+/seat starts where SOC2 + sales motion begin.
- No surprises on billing: monthly, prorated, cancel-anytime. No hidden usage tiers. No "$20 Pro is a gateway to $100 Max" pattern.

### What's NOT in this model
- Per-task metered billing (too complex, hurts conversion; deferred)
- Affiliate revenue (tiny, gross, deferred)
- Compute arbitrage (browser-hour sales; commoditizes the agent loop)
- Marketplace commission (deferred to Phase 5)

## Consequences

**Enabled:**
- Regulatory safety (BYOK sidesteps Anthropic Sept 2025 policy; no API keys held)
- Honest pricing (no surprise escalations)
- Adoption funnel (free → Pro at the proven $20/mo ceiling)
- Phased monetization (cloud value-add grows in value as features ship)
- BSL license (Fork A) aligns naturally — OSS self-host is the free tier, cloud is the paid wrapper

**Closed off:**
- No margin on tokens (revenue scales with subscriptions, not usage)
- Cannot fund SOC2 from Pro alone (need enterprise scale)
- Free cloud tier costs real infra (~$50/user/year → ~$25/yr per free user at 50 tasks/day)
- Misalignment with token-resale competitors (no token arbitrage)

**New constraints:**
- Need to implement Stripe + auth + billing UI in Phase 1
- Free cloud tier needs rate-limiting + abuse controls from day 1
- Spend dashboard for users (BYOK = they need to know what they spent)
- Pricing page must be honest about "your LLM spend is separate"

## Follow-ups

- [ ] Stripe integration in Phase 1 (or Phase 4 — revisit)
- [ ] Pricing page copy: emphasize "BYOK means no markup on tokens" as a feature
- [ ] Spend dashboard for users (per-task token count + USD equivalent)
- [ ] Free cloud tier rate-limiting design (50 tasks/day, abuse thresholds)
- [ ] Revisit per-task metered billing once we have 100+ paying Pro users and real usage data