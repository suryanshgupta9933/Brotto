# Competitive Positioning Matrix (Sept 2026)

**Read before public-facing copy, launch, or fundraising pitches.** Update when the white-space picks change or a competitor closes a gap Brotto was relying on.

## Comparison matrix

| Axis | Operator | Comet | Manus | Browser Use | Skyvern | **Brotto** |
|---|---|---|---|---|---|---|
| Surface | Web app | Full browser | Web app + remote | OSS framework + cloud | OSS + cloud + ext | **Extension + remote** |
| Owns browser session | No (remote Chromium) | **Yes** | No | No | No | **Yes (user's Chrome)** |
| Sees user auth state | No | Yes | No | No | No | **Yes** |
| AX tree (vs vision) | Vision | No | Yes (DOM-text) | Yes (DOM-text) | No (vision) | **Yes (AX)** |
| BYOK | No (bundled) | Partial | No | **Yes** | Yes | **Yes** |
| Key persists on disk | N/A | N/A | N/A | Optional | Optional | **No (session-only, by design)** |
| Human-in-the-loop | Partial | Partial | Partial | Via MCP | Via HITL flag | **Yes (sensitive_actions + critical regex + first-time-seen)** |
| Speed ceiling | Slow (vision) | Fast (own browser) | Slow (cloud) | Fast (DOM-text) | Medium (vision) | **Fast (AX + own browser)** |
| Bot detection problem | Severe | **None** | Severe | Medium | Medium | **None** |
| Distribution | Web app | Browser download | Web app | pip/npm + cloud | OSS + cloud | **Chrome Web Store (planned)** |
| Pricing model | Bundled $20–$200 | Free + $5 | $20–$200 credits | $0.02/hr + model | $29–$149 credits | **TBD (BYOK + optional harness fee)** |
| Live? | Yes (folded into ChatGPT) | Yes (free) | Acquired by Meta | Yes (fast-growing) | Yes | **N/A (not shipping)** |
| Differentiator vs Brotto | Bigger model + bigger team | Owns the browser | Web-scale infra + UX polish | Dev wedge + speed | Enterprise SOC2 + vision | **CDP-via-extension + AX + BYOK + HITL primitives already wired** |

## What Brotto can credibly claim (only with what's actually built)

1. **"Agent runs in your logged-in Chrome — your cookies, your MFA, your SSO."** *(CDP-via-extension is the proof.)*
2. **"No screenshots. Reads the accessibility tree directly — cheaper and faster than vision."** *(AX tree, by code.)*
3. **"Bring your own API key. We never see it past the session."** *(chrome.storage.session.)*
4. **"You stay in control. Approval cards for sensitive actions, critical patterns, first-time-seen domains."** *(secure mode is real.)*
5. **"Model-agnostic. Use Claude, OpenAI, or MiniMax. Swap per task."** *(registry + resolver.)*

### Lead bet (gated — do not claim yet)

**"It works on the sites behind your login."** The category's stated failure is that *any task with login + 3+ steps breaks on every screenshot-driven approach.* That is architectural, and competitors cannot copy it without changing architecture.

**This claim is blocked on Wave 0–2 exit criteria** and must not appear in public copy before then. As of 2026-09-28 the AX pipeline has no shadow DOM traversal, no iframe traversal, no canvas fallback, no `aria-hidden` reconciliation, no dynamic-stability wait, and caps observation at 6000 chars / 50 targets — so the claim is not yet true. See the capability map, Wave 0A.

## What Brotto cannot compete on (yet, honestly)

- ❌ Bundled UX polish of Operator / Manus
- ❌ "Free browser" surface of Comet / Dia
- ❌ Vision fallback for non-AX-friendly sites (Canvas-rendered, image-only)
- ❌ Speed at the level of a 50k-user cloud with residential proxies
- ❌ Enterprise procurement (no SOC2, no HIPAA, no SSO)
- ❌ Distribution (not on CWS, no install funnel)
- ❌ Long-running background execution (no service worker idle budget plan beyond heartbeat)

## White-space (where new entrants can win)

1. **BYOK browser-agent middleware for SaaS power users.** $20–49/mo Chrome ext that BYOKs the user's own Claude/OpenAI key + adds reliability/memory/templates + uses the user's *own* browser session. **Brotto fits this exactly.**
2. **Vertical browser-agent SaaS for regulated ops** (insurance quoting, healthcare prior auth, government forms). SOC2 + HIPAA + 2FA + audit log are the moat — not the LLM. Skyvern Pro/Enterprise pricing ($149+ → custom) validates WTP.
3. **Reliability/eval layer above raw agents.** Every agent demo breaks on real sites. A "managed agents" middleware with retry, screenshot diffing, and human-in-the-loop fallback is the missing layer. Sell to dev teams shipping agents into production.
4. **Browser-automation for SEO/data teams as a Skyvern alternative** at 1/10th the price. Long tail: real estate agents, recruiters, ops analysts.
5. **MCP-native browser tool.** Every MCP host (Claude, Cursor, Cline, Continue) needs a browser primitive. Browser Use / Skyvern sell whole agents; nobody is selling a clean `mcp-browser` server that any host can drop in.

## When to update this doc

- Competitor launches a new capability that closes a Brotto gap
- Brotto ships a new capability that adds a row
- A new white-space opens (funding round, M&A, regulatory change)