# Risks & Unknowns (Sept 2026)

**Read when making risk-sensitive decisions.** Update when a new risk emerges or an old one dies.

## Technical risks

- **MV3 service worker idle budget.** Background workers can be killed after 30s idle. Current heartbeat (20s ping / 30s deadline) handles active sessions but **long-running background tasks** (e.g. "scrape this site every hour") will be killed. Need workerd-style offloading or accept the constraint.
- **AX tree variance across sites.** Heavy SPAs (React with `aria-hidden` everywhere) can give noisy trees. Browser Use solves this with DOM-text extraction fallback. Brotto should keep both.
- **`Page.captureScreenshot` not implemented** but README claims it. Either implement or fix the doc.
- **30-step `MAX_STEPS` cap** — may surface as a real-product ceiling. Long workflows (book flight + hotel + email confirmation) routinely exceed 30 steps.

## Regulatory risks

- **Anthropic Sept 2025 Usage Policy** closed the Max-reselling loophole. BYOK structure sidesteps this; any move toward bundled keys kills Phase 4 monetization.
- **Chrome Web Store Aug 2026 privacy policy.** Compliance work is real (privacy disclosures, data-handling statements) but tractable.
- **OpenAI Operator ToS** requires a "one-click delete" privacy control. If Brotto ever wraps Operator, build the control.
- **Cross-border M&A ceiling.** Meta was reportedly blocked from acquiring Manus at ~$2B (Reuters). US/EU/UK addresses favored over Chinese/Singaporean for exit value.
- **Chrome Web Store rejections.** "Auto-purchase" extensions have been rejected; commerce agents are getting stricter review.

## Competitive risks

- **OpenAI Atlas (Sep 2026)** and **Comet free (Oct 2025)** are racing to own the browser surface. If they win, extensions get marginalized. Counter: extensions are faster to ship, easier to specialize, don't require users to switch browsers.
- **Anthropic Computer Use** as a primitive gets stronger every model release. If they ship a Cowork-quality product at $20/mo, the standalone extension is squeezed. Counter: Brotto's BYOK + multi-model is the only hedge.
- **Google Gemini in Chrome** (free, US desktop, Sep 2025) is bundled with Chrome. Hard to beat free. Counter: Chrome's agent is Google's model only; BYOK + multi-model is the wedge.
- **Island ($400M @ $6.4B)** signals enterprise IT treats agent browsers as a security category. SOC2 + audit log becomes table stakes for enterprise by 2027.

## Distribution risks

- **No Chrome Web Store listing yet** — distribution is the #1 risk to the plan.
- **YC interview window is narrow.** Spring/Summer batches; missed window = 6-month delay.
- **HN launch fatigue.** Must be demo-quality, not slideware.

## Strategic risks

- **Picking a vertical too early** — Fork C2 limits TAM. Recommend C1 for first 6 months.
- **Pricing too low.** $20/mo is the ceiling for daily-use individuals; if you undercharge you can't fund SOC2.
- **Pricing too high.** $200/mo (Operator Pro) is widely rejected. Don't copy OpenAI's worst pricing decision.

## Funding / runway risks

- **Bootstrap before traction** — fast feedback loop but caps SOC2 + vertical spend.
- **Fund pre-launch** — faster Phase 1 but uses leverage before signal.
- **Fund post-launch on traction** — best optionality but requires Phase 1+2+3 to ship first.

## Unknowns

- Will Anthropic / OpenAI / Google ship a "BYOK extension API" that commoditizes the harness? (no signal today)
- Will Chrome MV3 service worker budget change? (no signal)
- Will another team release an OSS CDP-via-extension BYOK agent with better marketing before us? (Skyvern and Browserbase are closest — neither matches Brotto's stack exactly)
- What happens when Anthropic / OpenAI ship multimodal context windows large enough to do AX tree + screenshot together? (predicted 2027)

## When to update this doc

- New regulatory ruling
- Competitor launches a feature that closes a Brotto gap
- Chrome platform change (MV3, manifest, debugger permissions)
- Pricing experiment result from a competitor
- A previously-unknown risk materializes