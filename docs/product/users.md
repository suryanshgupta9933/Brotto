# Users — Pain Points & Wishes (Sept 2026)

**Read before designing any feature.** Update when new pain-point or wishlist signal emerges from research (quarterly user research cycle recommended).

## Top 10 pain points (with sources)

| # | Pain | Frequency | Source signal |
|---|---|---|---|
| 1 | **Too slow** — 90 min for 15 min of work | Universal | Operator r/csMajors: "swimming through molasses"; Manus: "1.5 hours to supervise 15 min"; HN: "17 min for vision vs 0.5s for API" |
| 2 | **Hallucination / fabrication** | Universal | r/csMajors: "schizophrenic on psilocybin"; Operator invented LinkedIn contacts |
| 3 | **Cost / token sticker shock** | Near-universal | Manus: "8200 credits gone in 1 month"; Claude Code: $5k → $800 stripping cache; ZDNet: "Operator isn't worth $200/mo" |
| 4 | **Bot detection / blocked sites** | Universal for cloud-hosted | "Cloudflare drops the hammer"; "Chromium stealth forks are detectable"; proxy flag leakage |
| 5 | **Stuck in loops / popups / fragile** | Universal | "pop-up appears and the agent has a panic attack"; "any task with login + 3+ steps breaks on every screenshot-driven approach" |
| 6 | **Context window / attention drift** | Common for long tasks | Manus: "until everything completely collapsed" |
| 7 | **Login / 2FA / auth friction** | Universal | "if it asked me to sign in to Google Sheets I'd have done it" — Operator didn't |
| 8 | **No observability / replay / audit** | Common | "Don't trust AI agents"; Codex "took autonomous decision to launch 826 parallel agents" |
| 9 | **No parallelism / multi-tab** | Common for power users | Skyvern #4392: "single shared X display"; "spin up multiple parallel sessions" |
| 10 | **Onboarding / docs / support friction** | Common | Manus: "support0 or -100"; refund disputes; "no onboarding" |

## Top 10 user wishes (with sources)

| # | Wish | Why it matters | Source signal |
|---|---|---|---|
| 1 | **Persistent memory / branched sessions** | Long projects collapse without it | "Adding branched conversations within Projects would be a major improvement" |
| 2 | **Human-in-the-loop / approval before destructive** | Safety + control | Operator designed to ask, didn't; Skyvern HITL requests |
| 3 | **Reusable "skills" / saved workflows** | Time savings on repeat | HN: "write skills like /logging-in, /read-latest-emails… reduces execution time drastically" |
| 4 | **Run in your own browser** | **The #1 architectural insight** — bypasses bot detection, reuses auth | "Comet — best balance; runs in your own browser"; "vibe browser exposes it as MCP so any agent can drive your actual logged-in sessions" |
| 5 | **A11y tree over screenshots** | Cheaper, faster, no pixel guess | "drive the OS accessibility tree directly… failure rate falls roughly 4x"; "small models can do it" |
| 6 | **Structured output / deterministic formats** | Makes agents usable in pipelines | "Computer use is an amazing demo, but structured APIs are what pay the server bills" |
| 7 | **Native mobile + multi-platform** | Coverage gap | browser-use #4761: mobile feature request |
| 8 | **CAPTCHA / 2FA handling** | Blocks login-required workflows | browser-use #1986; Skyvern #2847 |
| 9 | **Cost controls / usage transparency / budget caps** | "Token use cost can easily get as large as dev salaries" | HN: "$20 Pro is gateway plan to $100 Max" |
| 10 | **Audit log / replay / step-by-step explanation** | Trust | HN: "Don't trust AI agents" thread |

## Under-served segments

1. **Non-technical business users** — currently worst-served. Manus and Operator both target them and both fail on cost, reliability, support.
2. **Recruiters / real-estate agents / e-commerce operators** — recurring use cases (job apps, listing scraping, social posting) all require login + multi-step, where every current agent breaks.
3. **Privacy/security-sensitive users** — multiple HN threads on agent-browser distrust ("Anthropic installed a spyware bridge on my machine?" — 151 points).
4. **Power users on a budget** — hosted agents too expensive, OSS too unreliable. "Your own browser + your own API key" is the only sustainable model they're converging on.
5. **Vertical SaaS without APIs** — Epic EHRs blocking Akasa medical coders is the largest unaddressed opportunity. Browser agents are the only option but slow/fragile.
6. **Dev teams shipping agents to production** — "managed agents" middleware with retry, screenshot diffing, HITL fallback. The missing layer between raw Browser Use/Skyvern and enterprise procurement.

## Pricing sensitivity

- **Hard ceiling for daily-use individual spend:** ~$20–50/mo.
- **Hidden/usage-tier pricing is the trust killer** — "$20 Pro is a gateway plan to $100 Max since you'll easily burn your token rate on a single prompt."
- **Free + OSS gravitating toward "your own browser + your own API key"** as the only sustainable model. Comet, OpenTabs, terminator-MCP, vibe-browser all share this pattern.

## Key source URLs (research archives)

- r/csMajors/comments/1i8joi4 — Operator hands-on
- r/AI_Agents/comments/1slc8rj — Six-product test
- r/AI_Agents/comments/1pau2f2 — Manus experiences
- r/ManusOfficial/comments/1jltrz5 — Manus credits
- r/LocalLLaMA/comments/1rrisqn — Former Manus backend lead
- r/ArtificialInteligence/comments/1qrcwco — Manus fragility
- r/ClaudeAI/comments/1s839hp, /1s7wkky — Claude Code Computer Use
- news.ycombinator.com/item?id=48024859 — Computer Use 45x more expensive than APIs
- news.ycombinator.com/item?id=46549823 — Anthropic closed Max loophole
- news.ycombinator.com/item?id=47829800 — Spyware bridge concern (151 pts)
- github.com/Skyvern-AI/skyvern/issues/4392, 4439, 2847
- github.com/browser-use/browser-use/issues/1986, 199, 4761

## When to update this doc

- Quarterly user-research cycle (recommended) — re-run pain/wish surveys
- Major new product launch shifts pain priorities
- A wishlist item gets delivered by a competitor (changes the wishlist)
- New under-served segment emerges (e.g. vertical-specific pattern from Pro usage data)