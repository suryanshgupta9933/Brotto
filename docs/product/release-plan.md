# Brotto — Release Plan (Oct 2026)

**Read before any launch work.** The three forks in `open-questions.md` are settled; this document is
the *execution* order and the *preparation* list, which did not exist. Status: **not launched**.

## TL;DR

The code is further along than the release. Nothing on the critical path to launch is agent quality —
it is packaging, one legal question, and a review clock. Two dates drive everything:

| Date | What | Consequence of missing it |
|---|---|---|
| **2026-11-02** | YC W2027 application deadline | 6-month wait for W2028 |
| **~2026-10-15** | Submit to Chrome Web Store (unlisted) | Every week late pushes the public listing a week out; 3–4 wk review + likely one rejection |

**The single most important finding: `docs/product/roadmap.md` is right that GTM is not blocked on
reliability** — and that means the whole of Wave 3 (auth, onboarding, CWS packaging, cost visibility)
plus this document can proceed now, in parallel, while the perception work continues on `feat/perception-hardening`.

## What is actually blocking

Ranked by "blocks launch" × "effort to fix". Everything in the top five is independent of the agent.

| # | Blocker | Evidence | Effort |
|---|---|---|---|
| 1 | **GitHub repo is private** | `isPrivate: true`, 0 stars, 0 releases, 0 tags | minutes |
| 2 | **No root README** | No `README.md` at repo root. First screen of the repo is `CONTRIBUTING.md` | hours |
| 3 | **Package is not installable** | `pyproject.toml` declares `packages = ["brotto_orchestrator"]` but `services/brotto-orchestrator/src/brotto_orchestrator/` has **no `__init__.py`**. `pip install .` / `uvx brotto` cannot work | ~30 min |
| 4 | **License file is the untouched Apache boilerplate** | `LICENSE` line 189: `Copyright [yyyy] [name of copyright owner]` — never filled in. `NOTICE` reads `Copyright 2026 Inventic` | blocked, see below |
| 5 | **No privacy policy** | Mandatory for CWS; a privacy-policy *link in the description* is a documented rejection | hours |
| 6 | Extension README is substantially fiction | Claims `Page.captureScreenshot` (not implemented), `crypto.ts`, `popup.tsx`, React, WebCrypto — **none of these files exist** | hours |
| 7 | `/docs/` and `/CLAUDE.md` are gitignored | `git ls-files` → 182 files, zero docs. A fresh clone starts blind on the entire design reasoning | minutes |
| 8 | No `SECURITY.md`, issue templates, GitHub `topics`, homepage, or Discussions | `gh api` → `topics: []` | hours |
| 9 | Two `uv.lock` files (root and `services/brotto-orchestrator/`) | Ambiguous dependency resolution; CI comments say the root `pyproject.toml` "isn't tracked yet", which is stale — it is tracked | minutes |

Blockers 1, 2, 3, 5, 6, 7, 8, 9 total roughly two days of work for one person. **They are the launch.**

## License — the decided option is invalid, for two independent reasons

`open-questions.md` Q1 records "BSL with 3-year Apache 2.0 conversion" as **RESOLVED**. It is not
executable, and neither reason depends on the other:

**1. BSL 1.1 cannot convert to Apache 2.0.** The Covenant of Licensor requires the Change License be
"GPL Version 2.0 or any later version, **or a license that is compatible with GPL**." Apache 2.0 is
patent-based and one-way compatible; it is *not* GPL-compatible. MariaDB's own BSL FAQ restates the
requirement as "GPL Version 2.0 or later." A "BSL → Apache 2.0" license does not exist. If a delayed-OSS
license is wanted, the correct instrument is **FSL-1.1-ALv2**, which converts to Apache-2.0 *or* MIT
on the second anniversary of each version. BSL is also not OSI-approved, so the project may not be
described as open source.

**2. The `LICENSE`/`NOTICE`/`package.json`/`manifest.json` state a third party's copyright.**
`NOTICE` says `Copyright 2026 Inventic`; `clients/brotto-extension/package.json:21` has
`"author": "Inventic"`; `manifest.json:40` has the Firefox ID `brotto-browser-extension@inventic.ch`;
`CONTRIBUTING.md:78` still references `inventicai/browser-automation`. Any delayed-OSS license must be
granted by the copyright holder, and this must be confirmed in writing.

**Recommended: ship under Apache 2.0 as-is, and re-open the license question later.**

- If the code is the founder's own, Apache 2.0 is a legitimate and maximally-adoption-friendly choice —
  it is what browser-use uses to reach 116k stars.
- If any part is derived from third-party Apache-2.0 code, Apache 2.0 is the *only* licence the founder
  was ever entitled to apply, and the BSL question is moot.
- Either way the repo is already Apache 2.0, so this is a **decision not to change course**, and it
  unblocks everything with zero code risk.

The cost is real and should be recorded: without a non-commercial clause, the cloud tier must be
defended by *value* (managed hosting, history, replay, multi-tab, audit export) rather than by licence.
The research is explicit that the licence was never the main risk — in a 2026 catalogue of 29 adverse
open-source events, **13 involved no licence change at all**, and the dominant risk factor was
single-vendor governance (~46% adverse-event rate vs 2.5% for foundation-governed), which no licence
choice fixes.

**Two items to obtain in writing before the repo goes public:** (a) confirmation of rights to every file
in the repo and an explanation of the Inventic references; (b) name clearance. Until (a) exists, do not
edit the copyright lines — an incorrect assertion is worse than a pending one.

## The release, staged

Four stages. Each has an exit gate, and no stage starts before the previous gate passes.

### Stage 0 — Make it installable and legible (no clock, no review)
Exit: a stranger can clone, install, and get a first task done, unaided.

1. Add `__init__.py` to the package; verify `pip install -e .` and `uvx brotto --help` actually run.
   Collapse the two `uv.lock` files to one.
2. Write the root `README.md`: 45–60s demo GIF above the fold, the three claims that are already true
   (logged-in Chrome, AX tree not screenshots, BYOK with a session-only key), a quickstart a stranger can
   finish, and an honest "what's rough" section.
3. Delete or rewrite `clients/brotto-extension/README.md` — it documents files that do not exist.
4. Un-ignore `/docs/architecture/` and `/docs/product/` (`git add -f` is required, they are gitignored
   wholesale) so the design reasoning ships with the repo.
5. `SECURITY.md`, issue template, `topics`, homepage, Discussions on. Topics to copy from stagehand:
   `ai-agents`, `browser-agent`, `browser-automation`, `chrome-extension`, `agents`, `ai`, `llm`,
   `cdp`, `automation`, `typescript`, `python`.
6. Make the repo public. Set the GitHub description to positioning, not jargon — currently
   "Server-hosted agent harness with browser extension client" is a phrase only this project uses.

### Stage 1 — Chrome Web Store submission (starts the review clock)
Exit: an unlisted listing is live and one stranger has installed it unaided.

**Submit by ~2026-10-15.** Official guidance is "a few days… up to a few weeks", explicitly longer for
extensions with broad host permissions or sensitive execution permissions. Brotto has all four slow-down
signals: new developer, new extension, `debugger` + `<all_urls>`, new code. Budget **3–4 weeks and one
rejection cycle**, so submit 6+ weeks before the channel is needed.

**Ship unlisted.** No store page, but anyone with the URL installs and auto-updates, for one review
rather than a permanent sideload-support burden. That is the right vehicle for the first 100 users.
Public listing comes later and does not need a second review.

**The three rejection risks, and the mitigation for each:**

1. **`chrome.debugger` + `<all_urls>` reads as "Web Browsing Activity" under Limited Use.** The policy
   permits it only "to the extent required for a user-facing feature described prominently in the
   Product's Chrome Web Store page and in the Product's user interface." Brotto reads full AX trees of
   arbitrary pages, so it is squarely in scope. *Mitigation:* one-sentence single purpose — *"Let the
   user ask an AI to perform tasks in their own logged-in browser"* — used **verbatim** in the listing,
   the first-run screen and the privacy policy; attach `debugger` only per-task, on a tab the user
   names, and request `scripting` on `activeTab` only. This converts always-on broad access into a
   user gesture, which is the argument `activeTab` exists to win.
2. **The model-driven action loop looks like a remote-code interpreter.** The MV3 policy's example
   violation is "building an interpreter to run complex commands fetched from a remote source, **even
   if those commands are fetched as data**." An action-dispatch loop fed by model output reads exactly
   like that. *Mitigation:* state in the review notes that the extension never `eval`s and never fetches
   JS — model output is parsed as data into a fixed action enum (`navigate | click | type | press_key |
   scroll | task_complete`), validated in the extension, then dispatched through existing Chrome APIs.
   Every landing site is a real extension API, never a code path.
3. **Wrapper appearance.** Extensions that merely display a website in a tab are rejected. *Mitigation:*
   demo screenshots must show the agent driving a third-party site (Gmail, a booking flow), never
   Brotto's own UI.

**Also: drop the `tabs` permission** — it is not required when broad host permissions are held, and
requesting an unused permission is its own violation. **Drop Firefox** — `chrome.debugger` is not
supported there, so nothing in the product works; the `browser_specific_settings.gecko` block should go.

**Artifacts to write:** privacy policy (live URL, covering collection/use/sharing, **not** linked from
the description); single-purpose statement; per-permission justifications — `PERMISSIONS.md` is a
head start and needs rewriting to the feature-framing Google accepts; data-collection declarations; and
working reviewer test instructions with a live server URL and credentials, or the review fails on
"not working due to a server side issue".

> **Declaration risk specific to Brotto.** `POST /v1/suggestions` reads visible page text with no task
> in flight. That is ambient collection of browsing activity with no in-panel indicator, and under the
> Aug 1 2026 policy it must be declared precisely or it reads as undisclosed. Either declare it
> explicitly or gate it behind a visible opt-in before submitting.

**Copy does not need re-review** — only code, manifest and packaged-resource changes do. So do not
over-polish the listing before Stage 1; iterate it afterwards for free.

### Stage 2 — Launch (Show HN, one day)
Exit: a measurable spike in installs and stars.

Only when there is a new thing to announce and a stranger can reach a working install in under 60
seconds without a signup or waitlist.

- **Tue or Wed, 8–9:30am ET.** Submit Show HN and **post the first comment within seconds**.
- The ranking formula is roughly `(upvotes−1)/(age+2)^1.8` — **10–30 votes in the first 30–60 minutes
  usually breaks the front page; the same votes spread over hours will not.**
- Reply to every comment for the first 90 minutes. Admit what breaks; HN rewards "here's what's
  rough" over a pitch. Then leave the thread alone.
- No friend upvotes. Ring detection gets the post, the URL, or the domain penalised.
- **Never delete and repost** a dead Show HN — it forfeits second-chance eligibility permanently.

The benchmark is real and measured: **Skyvern's Show HN (2024-03-14) reached #1 and stayed on the front
page all day — 420 points, 138 comments, 3,000 GitHub stars, 71 inbound meetings, 1,298 workflows run by
OSS users, and pickup in 30+ AI newsletters and GitHub Trending.** Browser-use's later Launch HN to
introduce its cloud product returned 259 points and 100 comments. Caveat: Skyvern was a funded team, so
3,000 stars in a day is a ceiling, not a base case.

### Stage 3 — Monetise
Exit: first dollar collected.

Entity and payments are prerequisites, not follow-ups. **Lemon Squeezy or Paddle** as merchant of record
until there is an entity and a US bank account — a MoR handles global VAT/sales tax. If funding is ever
possible, **Stripe Atlas** for a Delaware C-corp (~$500 plus $100/yr franchise tax) and file the **83(b)
election within 30 days**; a Delaware LLC is simpler if bootstrapping and never raising.

Pricing (Fork B, BYOK + free harness + paid cloud) is already decided and unaffected by the licence
change. Per-task cost visibility is Wave 3D and should land before paid conversion — the single loudest
trust complaint in the category is token-bill surprise.

## Awareness — ranked, with realistic yield

| Rank | Channel | Effort | Realistic yield |
|---|---|---|---|
| 1 | **Show HN** | 3 days prep, 1 launch day | The only channel with a measured 3,000-star outcome. The entire rest of this table is a multiplier on it |
| 2 | **r/SideProject** + r/AI_Agents, problem-first | 30-day account warm-up | 200–2k visits, highest per-visitor intent, threads rank in Google for years |
| 3 | **Newsletter / GitHub Trending ripple** | passive | 30+ features *after* front page (Skyvern). Not a launch action — a consequence of one |
| 4 | **Product Hunt** | 1 week | ~500–1,500 visits. Last first-party measurement: **2,399 visitors → 33 signups (1.38%)**. Needs 400–600 pre-built followers to approach #1. Do it 3–7 days *after* HN, only if a follower list exists |
| 5 | DevHunt, Peerlist Launchpad | 2h each | Tens–low hundreds. Cheap dofollow, not traffic |
| 6 | X / LinkedIn / YouTube | 1 day each | A single demo clip, not a thread of links. Build-in-public is a 3+ month asset with **no measured 2026 conversion data** — cheap, not load-bearing |
| 7 | Dev.to / Hashnode | — | Treat as zero. Hashnode has been effectively dormant since Nov 2024 |

**The BYOK objection is a false one, and worth answering explicitly in the launch copy.** The fear is
that "paste your API key" kills conversion. Skyvern found the opposite: OSS users who tried the product
then *booked cloud demos*. The HN audience already holds an Anthropic or OpenAI key. The mitigation is
mechanical, not strategic: the key lives entirely in the side panel, never reaches the server, and the
demo asset must carry the value proposition without requiring setup.

**Free downloads are only worth listing:** `uvx` over `pipx` for any Python CLI path — 35,520 READMEs
mention `uvx` vs 34,432 `pipx`, and ruff leads with `uvx` — plus `npx` for the extension. **Cut** brew
formulae, Codespaces/gitpod buttons, and Docker Compose as the *headline* path (keep it documented for
self-hosters; Skyvern reports Windows/Linux users struggling with exactly this). Do not make key entry
step one for the default user.

## What I did not do, and why

- **Did not write the README, privacy policy, or CWS listing copy.** That is Stage 0/1 execution, not
  planning, and the copy depends on the final license and name decisions.
- **Did not recommend a delayed-OSS licence.** The chosen one is invalid and the alternative costs the
  star funnel for a business model that has not been validated. Revisit when there is revenue to protect.
- **Did not touch the agent or re-plan the waves.** `roadmap.md` and the capability map are sound and the
  perception work in flight is on the critical path. GTM is not blocked on it.
- **Did not research trademark registration for "Brotto".** The founder has said clearance is obtainable;
  registration is a separate, later question.

## Sources

- [Show HN guidelines](https://news.ycombinator.com/showhn.html) · [HN front-page playbook](https://www.flowjam.com/blog/how-to-get-on-the-front-page-of-hacker-news-in-2025-the-complete-up-to-date-playbook)
- [Skyvern: "We open-sourced and ended up #1 on Hackernews"](https://www.skyvern.com/blog/we-open-sourced-and-ended-up-1-on-hackernews/) — the launch numbers
- [Browser Use: $17M seed](https://browser-use.com/posts/seed-round) · [Launch HN](https://news.ycombinator.com/item?id=43173378)
- [CWS Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) · [troubleshooting / violation codes](https://developer.chrome.com/docs/webstore/troubleshooting) · [review process](https://developer.chrome.com/docs/webstore/review-process) · [distribution (unlisted)](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [BSL 1.1 SPDX](https://spdx.org/licenses/BUSL-1.1.html) · [FSL-1.1-ALv2](https://spdx.org/licenses/FSL-1.1-ALv2.html) · [FSL](https://fsl.software/) · [MariaDB BSL FAQ](https://mariadb.com/bsl-faq-adopting/) · [OSI approved licences](https://opensource.org/licenses)
- [CHAOSS: what happens to relicensed projects](https://www.chaoss.community/what-happens-to-relicensed-open-source-projects-and-their-forks/) · [Why Memory Components Fail (arXiv 2026)](https://arxiv.org/html/2606.24896v1)
- [YC apply (W2027)](https://www.ycombinator.com/apply) · [YC FAQ](https://www.ycombinator.com/faq)
- [Plausible: PH launch conversion](https://plausible.io/blog/product-hunt-launch) · [Plausible vs alternatives 2026](https://www.setproduct.com/blog/where-to-launch-startup-2026) · [Reddit self-promotion rules](https://www.soar.sh/blog/self-promotion-rules-by-subreddit-database)
- [ruff README (`uvx`)](https://github.com/astral-sh/ruff) · [stagehand topics](https://github.com/browserbase/stagehand)
- [Lemon Squeezy 2026](https://www.lemonsqueezy.com/blog/2026-update) · [Stripe Atlas](https://stripe.com/atlas)
