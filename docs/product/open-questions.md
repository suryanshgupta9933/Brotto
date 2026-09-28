# Open Questions

Unresolved forks and product questions. **Read at session start.** When you answer one, move it to `decisions/YYYY-MM-DD-<slug>.md` and replace this entry with a link.

## Forks (gate Phase 1)

These three gate everything. **Stop and ask the user before implementing.**

### Fork A — Distribution model ✅ RESOLVED

**Chose A1: OSS core + freemium cloud.** See `decisions/2026-09-28-distribution-oss-cloud.md`.

### Fork B — Pricing model ✅ RESOLVED

**Chose B1: BYOK + free harness, paid cloud.** See `decisions/2026-09-28-pricing-byok-freemium.md`.

### Fork C — Vertical ✅ RESOLVED

**Chose C1: Generalist for first 6 months.** See `decisions/2026-09-28-vertical-generalist.md`.

## Product questions (resolve as we go)

### Q1 — License choice ✅ RESOLVED

**Chose BSL with 3-year Apache 2.0 conversion.** See `decisions/2026-09-28-distribution-oss-cloud.md` (refined same day as Fork A).

### Q2 — Default model ✅ RESOLVED

**MiniMax is dev-only placeholder.** Better model will be default at launch. See `decisions/2026-09-28-default-model-minimax-dev-only.md`.

### Q3 — Skill marketplace ✅ RESOLVED

**Chose Hybrid (curated community).** See `decisions/2026-09-28-skill-marketplace-hybrid.md`.

### Q4 — Multi-tab ✅ RESOLVED

**Chose Free for everyone.** See `decisions/2026-09-28-multitab-free.md`.

### Q5 — Vertical spinout trigger ✅ RESOLVED

**Trigger: 10 paying enterprise customers in same vertical.** See `decisions/2026-09-28-spinout-trigger-10-enterprise.md`.

### Q6 — Funding timing ✅ RESOLVED

**Chose Post-launch on traction (>1000 Pro users, >$5k MRR, >5k stars).** See `decisions/2026-09-28-funding-post-launch.md`.

### Q7 — First vertical candidate ✅ RESOLVED

**Chose Defer to data.** See `decisions/2026-09-28-first-vertical-defer.md`.

### Q8 — Chrome Web Store policy work ✅ RESOLVED

**Chose Phase 1 (before launch).** See `decisions/2026-09-28-cws-policy-phase1.md`.

### Q9 — Product boundary and competitive bets ✅ RESOLVED

**Chose: repetitive logged-in web chores, with three bets (reliability on logged-in sites, trust as headline, compounding routines).** See `decisions/2026-09-28-product-boundary-and-bets.md`.

### Q10 — Auth model ✅ RESOLVED

**Chose: self-host shared secret + hosted email magic link.** See `decisions/2026-09-28-auth-model.md`.

## Resolved

| Fork / Q | Choice | Decision |
|---|---|---|
| Fork A — Distribution | A1 OSS + freemium cloud (BSL license) | `decisions/2026-09-28-distribution-oss-cloud.md` |
| Q1 — License | BSL with 3-year Apache 2.0 conversion | (refined same day as Fork A) |
| Fork B — Pricing | B1 BYOK + free harness, paid cloud | `decisions/2026-09-28-pricing-byok-freemium.md` |
| Fork C — Vertical | C1 Generalist for first 6 months | `decisions/2026-09-28-vertical-generalist.md` |
| Q2 — Default model | MiniMax is dev-only placeholder | `decisions/2026-09-28-default-model-minimax-dev-only.md` |
| Q3 — Skill marketplace | Hybrid (curated community) | `decisions/2026-09-28-skill-marketplace-hybrid.md` |
| Q4 — Multi-tab | Free for everyone | `decisions/2026-09-28-multitab-free.md` |
| Q5 — Spinout trigger | 10 enterprise customers in same vertical | `decisions/2026-09-28-spinout-trigger-10-enterprise.md` |
| Q6 — Funding timing | Post-launch on traction | `decisions/2026-09-28-funding-post-launch.md` |
| Q7 — First vertical candidate | Defer to data | `decisions/2026-09-28-first-vertical-defer.md` |
| Q8 — CWS policy work | Phase 1 (before launch) | `decisions/2026-09-28-cws-policy-phase1.md` |
| Q9 — Product boundary + bets | Repetitive logged-in chores; 3 bets | `decisions/2026-09-28-product-boundary-and-bets.md` |
| Q10 — Auth model | Self-host secret + hosted magic link | `decisions/2026-09-28-auth-model.md` |

## Still open

- Which real chore sites go in the 0B benchmark task set (scoping call for its own spec)
- Whether 0C fixture sites are hand-built or adopted from an existing adversarial suite
- Whether hosted auth ships before or after first public launch (sequencing, not settled)