# Vision — Brotto → Product (Sept 2026)

The strategic frame. Read this first in any session.

## TL;DR (5 bullets)

1. **Brotto's architectural thesis is right for this moment.** Every recent shutdown (Adept, Reworkd, MultiOn consumer, Project Mariner) confirms: standalone browser-takeover agents that don't own the surface get killed. The #1 user wish — "agent runs in my logged-in browser" — is exactly what Brotto's CDP-via-extension design delivers. Comet is the only product winning on this today.
2. **The largest unserved demand** is white-space #1 from the market research: a $20–49/mo BYOK Chrome extension for power users, after Anthropic closed the Claude-Max-reselling loophole in Sept 2025. Brotto fits this exactly. But it's a developer tool today, not a product — zero auth, zero accounts, zero onboarding, zero distribution.
3. **Anthropic's Sept 2025 Usage Policy change is a regulatory ceiling**, not a pricing opportunity. Any "cheap wrapper around Claude Max" play is dead. BYOK with the user's own key (which Brotto already does) is the only defensible structure.
4. **The dominant distribution playbook is OSS → cloud**, validated by Browser Use ($17M seed, 110k stars) and Skyvern ($2.7M + SOC2 +500+ enterprise teams). Going closed-source competes with Anthropic and OpenAI on their home turf and loses.
5. **Realistic 12-month path:** harden MVP (4–6 wks) → OSS launch (4–6 wks) → reliability layer (8 wks) → monetize (8 wks). Target: $250k–$1.5M ARR, 10–25k GitHub stars. Comparable to Skyvern's first year.

## The verdict on what Brotto is today

Brotto is **MVP-quality, not production**. The harness loop, AX-tree CDP relay, secure-mode policy engine, BYOK model adapter, and end-to-end observe→plan→act flow are real and tested (~188 Python tests). What's missing for shipping: auth, multi-user, billing, telemetry, onboarding, history, distribution, broader action surface.

The architectural choices are the actual product:
- **CDP-via-extension, not Playwright-only** — inherits the user's authenticated browser session. Solves the "log in once" problem that no cloud browser can solve.
- **AX tree, not screenshots** — stable refs from `Accessibility.getFullAXTree`. No vision model. Cheaper, faster, accessibility-correct.
- **Three-tier BYOK + session-only key storage** — privacy by design. Sidesteps Anthropic's Sept 2025 reselling ban.
- **Secure-mode policy + prompt-injection trust hierarchy** — the only real safety layer most competitors ship without.
- **Per-component timing in `TaskResult.timing`** — operator-visible wall-time breakdown. Diagnoses the "agent took 90 min for 15 min of work" complaint that kills every competitor.

## Strategic positioning

**The product claim Brotto can credibly make:**

> An AI browser agent that runs in your logged-in Chrome. Reads the accessibility tree, not screenshots. Bring your own API key — we never see it past the session. You stay in control with approval cards for sensitive actions. Use Claude, OpenAI, or MiniMax, swap per task.

**What Brotto cannot compete on (today, honestly):**

- Bundled UX polish of Operator / Manus
- "Free browser" surface of Comet / Dia
- Cloud-scale speed (no proxy fleet, no residential IPs)
- Enterprise procurement (no SOC2, no HIPAA, no SSO)
- Distribution (not on Chrome Web Store)

## The forks we have to make

Three forks gate everything else. **Do not implement Phase 1 until these are answered.** See `open-questions.md` for the full question set.

| Fork | Options | Recommended |
|---|---|---|
| **A: Distribution** | A1 OSS+cloud / A2 closed extension / A3 API-only | **A1 — Browser Use / Skyvern pattern** |
| **B: Pricing** | B1 BYOK+free harness, paid cloud / B2 20% token markup / B3 bundled credits | **B1 — regulatory-safe, market-aligned** |
| **C: Vertical** | C1 Generalist / C2 Vertical day-one | **C1 — for first 6 months** |

## What to read next

- `open-questions.md` — the unresolved forks + 8 product questions. **Read at session start.**
- `brotto-current-state.md` — what we have today, code-grounded.
- `competitors.md` — who's live, who's dead, who's racing.
- `market.md` — sizing, pricing, regulatory.
- `users.md` — pain points + wishes, with quotes.
- `gap-analysis.md` — where Brotto wins, where it doesn't, what's missing.
- `roadmap.md` — the 5-phase journey.
- `dev-environment.md` — how to ship solo with AI.