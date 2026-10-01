# Market, Pricing & Regulatory (Sept 2026)

**Read before pricing, fundraising, or making regulatory-sensitive decisions.** Update when a major analyst report, funding event, or policy change shifts the numbers.

## Market sizing

| Slice | Source | 2024–25 | 2030+ | CAGR |
|---|---|---|---|---|
| AI agents (umbrella) | Grand View Research | $7.6B (2025) | $182.9B (2033) | 49.6% |
| Agentic AI | Fortune Business Insights | $7.29B (2025) | $139.19B (2034) | — |
| Enterprise agentic AI | Grand View | $2.6B (2024) | $24.5B (2030) | 46.2% |
| **Agentic browser market** | **Bright Data** | **$4.5B (2024)** | **$76.8B (2034)** | **~33%** |
| RPA (adjacent) | TBRC | $9.91B (2025) | $29.86B (2030) | ~25% |
| Web scraping (adjacent) | Mordor | $1.34B (2025) | $3.49B (2031) | ~21% |

**SAM for a BYOK browser-extension/SDK approach:** $1.5–3B by 2030 (5–10% of agentic browser market).
**SOM for a new entrant in 3 years:** $15–30M ARR at 1% SAM share. Browser Use and Skyvern are tracking toward it.

## Pricing landscape

| Product | Tier | Price | Unit |
|---|---|---|---|
| OpenAI Operator / Agent | Plus / Pro | $20 / $200 | per month,400 / ~8,000 tasks |
| Manus | Free → Team | $0 / $20 / $39 / $200 | per month, credits |
| Skyvern | Free / Hobby / Pro / Ent | $0 / $29 / $149 / custom | per month, credits |
| Browser Use | Pay-as-you-go | $5+ top-up | $0.02/browser-hr + model + 20% |
| Claude Opus 4.5 | API | $5 / $25 per MTok | input/output |
| Claude Sonnet 4.6 | API | $3 / $15 per MTok | input/output |
| Claude Haiku 4.5 | API | $1 / $5 per MTok | input/output |
| Perplexity Comet | Free / Plus / Ent | $0 / $5 / $40 | per month |
| Dia (Atlassian) | Pro | $20 | per month |
| Apify (web scraping) | Entry | $19 | per month |

**Patterns that work:**
1. **Credit-based subscriptions** (Manus, Skyvern) — pay only for completed work, not failed attempts. But credit opacity triggers complaints ("3,900 credits barely supports 3–4 tasks").
2. **Pure consumption** (Browser Use) — appeals to developers; min top-up $5, never expires.
3. **Quota on flat subscription** (OpenAI) — simplest billing, but $200 tier widely rejected (ZDNet: "Operator isn't worth its $200/mo").
4. **Browser-hour + model pass-through** is the structural cost unit (~85% of COGS for an agent using Sonnet at 1M tokens/run + residential proxy at $5/GB). Browser Use's 20% service fee on top of model cost is a defensible margin.

**Hard ceilings from user signal:**
- Daily-use individual ceiling: ~$20–50/mo.
- Above $100/mo: "unsustainable for daily use" complaints (r/AI_Agents six-product test).
- $200/mo: "not worth it" verdict on Operator Pro.

## Distribution playbook (what's worked)

1. **Open-source → cloud pivot is dominant.** Browser Use: $17M seed on 110k stars. Skyvern: YC S23 → $2.7M seed → cloud → SOC2 → 500+ enterprise teams.
2. **YC pedigree matters.** Browser Use (W24 batch), Skyvern (S23).
3. **Chrome Web Store as top-of-funnel.** $5 one-time dev fee; new privacy policy effective Aug 1, 2026; AI extensions explicitly *encouraged* by Google.
4. **Vertical-intent SEO** beats umbrella terms. "Form filler for X industry" > "AI agent."
5. **PLG ceiling ~$500/mo per user.** Beyond that, enterprise sales motion required.

## Regulatory ceiling

### Anthropic Usage Policy (effective Sept 15, 2025)

Added explicit restrictions on "deceptive or disruptive to democratic processes" and a sharp focus on high-volume automated workflows on personal accounts. **The Aug 2025 update also closed the "Claude Max plugged into third-party agents" loophole** — Anthropic actively blocks this.

**Implication for Brotto:** BYOK with the user's own key (no re-selling Max) sidesteps this entirely. Any move toward bundled keys kills Phase 4 monetization.

### OpenAI Operator ToS

Requires users to delete browsing data + log out of all sites via a "one-click" privacy control. Imposes UX constraint on anyone wrapping Operator.

### Chrome Web Store Developer Program Policies (Aug 1, 2026)

- Stricter privacy/data-handling standards
- Manifest v3 cap on background workers remains
- Single-purpose statement required
- AI extensions explicitly *encouraged* category per Google's own docs

### OS-level

- No bans yet from Apple/Google at the OS level
- Chrome Web Store has rejected specific "auto-purchase" extensions; commerce-agent listings getting stricter

### Cross-border M&A

Meta reportedly blocked from acquiring Manus at ~$2B (Reuters, 2025). **US/EU/UK addresses favored over Chinese/Singaporean for exit value.** Founder team location matters.

## When to update this doc

- New analyst report with materially different sizing.
- Pricing model change at a major competitor (these move quarterly).
- New regulatory ruling from Anthropic / OpenAI / Google / Apple.
- Chrome Web Store policy revision.
- New funding round or M&A in the category.