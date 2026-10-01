# Competitor Landscape (Sept 2026)

**Read before making any positioning claim or competing with anyone.** Update when a competitor launches, pivots, dies, or raises.

## The bifurcation pattern

The category is splitting into:

| Pattern | Examples | Status (Sept 2026) |
|---|---|---|
| **Standalone browser-takeover without owning the surface** | Mariner, Reworkd, Adept, MultiOn consumer | **Dead / pivoted / acquired-but-defunct** |
| **Full AI browser (owns the surface)** | Comet, Dia, Atlas, Gemini in Chrome | **Live, racing** |
| **OSS framework + cloud (developer wedge)** | Browser Use, Skyvern, Browserbase | **Live, growing fast** |
| **API-only "computer use" primitive** | Anthropic Computer Use, Gemini 2.5 Computer Use | **Live, infra layer** |
| **Vertical SaaS agents** | EvenUp ($1B+), Eve, Kolena | **Live, niche winners** |

**The lesson:** if you don't own the browser surface and don't ship as dev infra, you get killed.

## Live competitors

### ChatGPT Operator / ChatGPT Agent
- **Launch:** Jan 23, 2025 as Operator (US Pro only); folded into ChatGPT as "ChatGPT agent" Jul 17, 2025. Operator standalone site sunset.
- **What:** Browser takeover (own remote Chromium), form fill, multi-tab parallel, hands back for login/payment/CAPTCHA.
- **Pricing:** $20/mo Pro; $200/mo for ~8k tasks.
- **Model:** Computer-Using Agent (CUA) — GPT-4o vision + RL GUI control.
- **Criticisms:** ~43% on real web tasks; struggles with calendars/slideshows.
- **2025–26:** Integrated into ChatGPT agent mode; Atlas browser (Sep 2026).

### Anthropic Claude Computer Use
- **Launch:** Public beta Oct 22, 2024 with Claude 3.5 Sonnet. Cowork desktop agent in beta.
- **What:** API tool — model takes screenshots, emits mouse/keyboard. Anthropic's Cowork is the consumer surface.
- **Pricing:** Per-token API; Opus 4.5 at $5/$25 per MTok in/out. Cowork $20/mo (Pro bundled).
- **Model:** Opus 4.5 (current best), Sonnet 4.6, Haiku 4.5.
- **Criticisms:** Slower than vision specialists per Google; API needs developer-built sandbox + safety.
- **2025–26:** Opus 4.5 (Nov 2025) substantially improved; published VM isolation best practices.

### Google Gemini Computer Use
- **Launch:** Project Mariner (Chrome ext) Dec 2024 for AI Ultra $249.99/mo. **Killed May 4, 2026.** API as Gemini 2.5 Computer Use Oct 7, 2025.
- **What:** Mariner = Chrome ext browser takeover; Computer Use = API tool.
- **Criticisms:** Mariner capped at 10 tasks, Ultra-tier-only — narrow funnel.
- **2025–26:** Killed Mariner; folded into Gemini Agent / AI Mode in Search. Open agentic-commerce protocol with Shopify (Sep 2025).

### Manus.im → Meta
- **Launch:** March 2025 by Singapore/Chinese team. Massive viral launch, invite queue.
- **Status:** **Acquired by Meta Dec 29, 2025 for ~$2B (some sources $2–3B).** Meta reportedly blocked from acquiring at ~$2B earlier — geopolitical ceiling now part of the thesis.
- **What:** General autonomous agent — research, code, spreadsheets, end-to-end in hosted browser.
- **Pricing:** Free / $20–$200/mo credit-based / Team $39/seat/mo (5-seat min).
- **Criticisms:** Credit consumption unpredictable; tasks fail silently after burning credits.

### Browser Use (browser-use.com)
- **Launch:** OSS project late 2024; **$17M seed Mar 2025** (Felicis led); Paul Graham, YC, A Capital, Nexus, SV Angel, Liquid2.
- **What:** DOM-text extraction (not vision); framework for building browser agents.
- **Pricing:** OSS free; cloud $0.02/browser-hr + model + 20% service fee; min top-up $5 never expires.
- **Model:** BYOK; first open-source LLM (30B/3B active) Dec 2025.
- **2025–26:** 50k+ GitHub stars; 110k+ per YC page; one of fastest-growing OSS AI repos.

### Skyvern
- **Launch:** YC W23, OSS; **$2.7M seed Dec 2025**; SOC-2 Type II certified Aug 2025.
- **What:** Vision-LLM browser automation for enterprise — vendor portal logins, invoice downloads, form fills. Planner/Actor/Validator architecture.
- **Pricing:** Free / Hobby $29 / Pro $149 / Enterprise (custom).
- **2025–26:** Web Bench (5,750 tasks) released; positioning vs UiPath for enterprise.

### Perplexity Comet
- **Launch:** Jul 9, 2025 as Chromium-based AI browser for Perplexity Max ($200/mo). **Made free Oct 2, 2025.**
- **What:** Full browser replacement with sidebar assistant; multi-step tasks (shop, book, summarize email); Comet Plus background assistant.
- **Pricing:** Free; Comet Plus $5/mo; Enterprise $40/seat/mo.
- **Model:** Sonar + GPT/Claude fallbacks.
- **Criticisms:** High RAM at launch; some sites break; privacy concerns.
- **2025–26:** Perplexity raised additional $200M (Jun 2026).

### Dia (The Browser Company)
- **Launch:** Dia browser paid Aug 6–7, 2025 at $20/mo. **Arc sunset.** **Atlassian acquired Browser Company for $610M (2025)** — focused on Dia.
- **What:** AI-native browser; sidebar chat/skills across every tab. Predecessor "Browse for Me" was summarization-only.
- **2025–26:** Atlassian deal positions Dia as enterprise AI browser; deeper Confluence/Jira integration.

### MS Copilot Vision / Recall / Edge Copilot Mode
- **Launch:** Copilot Vision in Edge preview Oct 2024, broader 2025. Recall Jun 2024 (privacy backlash, rebuilt late 2024). Copilot Mode in Edge GA mid-2025.
- **What:** Vision-on-the-web browsing, multi-tab agent. Recall = passive screen memory.
- **Pricing:** Bundled with M365 Copilot $30/user/mo enterprise; free tier limited.
- **Criticisms:** Heavy privacy scrutiny — Recall was withdrawn then rebuilt with opt-in.
- **2025–26:** Edge Copilot Mode expanded with agentic actions for US users.

### Other
- **Surfside.ai** — Chrome ext shopping agent, raised early 2024; pivoted to B2B; no major 2025–26 news.
- **Google Gemini in Chrome** — Free AI agent in Chrome for US desktop Sep 2025.
- **OpenAI Atlas** — Chromium browser with ChatGPT agent built in, launched **Sep 2026**. Confirms OpenAI's bet that browser is the agent surface.

## Dead / pivoted

- **Adept ACT** — Founded 2022, raised $415M+ at $1B+ valuation. **Acqui-hired by Amazon Jun 28, 2024.** Founders + key engineers to Amazon; product never publicly launched at scale.
- **Reworkd / AgentE** — AgentGPT viral 2023. Pivoted to web-scraping Jul 2024. **Shut down Feb 6, 2025.**
- **MultiOn** — Founded 2022, raised ~$20M Series A at ~$100M val. **Pivoted Dec 2024 to AGI, Inc.** — on-device mobile agents; founder Div Garg stepped back; multion.ai now redirects.
- **Project Mariner** — Killed May 4, 2026 ahead of I/O 2026.

## Funding & M&A landscape

| Company | Round | Amount | Date | Lead / Status |
|---|---|---|---|---|
| Manus (Butterfly Effect) | Series B | $75M | Apr 2025 | Benchmark |
| | talks | $500M @ $5B | 2025 | (per X chatter) |
| | total | ~$85M / 3 rounds | | Tencent, HongShan, Benchmark |
| | exit | $2–3B | Dec 29, 2025 | Meta |
| Browser Use | Seed | $17M | Mar 2025 | Felicis |
| Skyvern | Seed | $2.7M | Dec 2025 | (YC) |
| MultiOn | Series A | ~$20M @ $100M val | 2024 | GC, NVIDIA, Salesforce, Cisco, Amazon Alexa, Samsung Next, Forerunner |
| Perplexity | (additional) | $200M | Jun 2026 | Comet roadmap |
| Browserbase | Series B | $40M | Jun 2025 | Notable Capital |
| Island (enterprise browser security) | (round) | $400M @ $6.4B | Sep 2026 | Enterprise IT now treats agent browsers as security category |
| Adept | acqui-hire | — | Jun 28, 2024 | Amazon |

## When to update this doc

- New competitor launches (operator model or framework).
- Existing competitor pivots, raises, dies, gets acquired.
- Pricing changes (these move quarterly).
- Notable benchmark or criticism published.
- A major shutdown happens (these signal category shifts).