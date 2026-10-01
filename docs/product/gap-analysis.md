# Gap Analysis — Brotto vs User Reality (Sept 2026)

**Read when planning work.** Update when a gap is filled or a new gap is discovered.

## Pain points → Brotto coverage

| Pain point | Brotto coverage | Gap |
|---|---|---|
| Too slow | AX tree (fast) + own browser (no proxy) → should be fast | No benchmarks yet; 30-step cap may surface |
| Hallucination / fabrication | Per-component timing surfaces where errors occur | No eval suite; no retry policy |
| Cost / token sticker shock | BYOK means no markup | No budget cap, no spend tracking |
| Bot detection | **Solves completely** — runs in user's logged-in browser | None |
| Stuck in loops / popups / fragile | Stagnation detection exists (3-step window) | No retry policy; no popup-specific handling |
| Context window / attention drift | Scratchpad + recall_memory primitives exist | Not exposed as persistent project memory |
| Login / 2FA | Inherits user's session — **solves** | None |
| No observability / replay | JSONL run logs exist per task | No replay UI; no `/v1/tasks` list endpoint |
| No parallelism | Single-tab | **Real product gap** — needs multi-tab harness |
| Onboarding friction | No onboarding flow at all | **Real product gap** |

## Wishes → Brotto coverage

| Wish | Brotto coverage | Gap |
|---|---|---|
| Persistent memory / branched sessions | Scratchpad/recall primitives exist | Not exposed as project-scoped memory; no branching |
| Human-in-the-loop | **Built** — sensitive_actions + critical regex + first-time-seen | Fine |
| Reusable skills / saved workflows | Memory entry system exists | No skill library UI; no template marketplace |
| Run in own browser | **Built** | None |
| A11y tree over screenshots | **Built** | None |
| Structured output | `extracted_data` field in `task_result` | No JSON-schema-validated output contract per task type |
| Native mobile + multi-platform | Chrome only | Real product gap — multi-platform only if pursued |
| CAPTCHA / 2FA handling | Inherits user's solved state | None |
| Cost controls | None | **Real product gap** |
| Audit log / replay | Per-task JSONL only | No replay UI |

## The 8–10 things missing to ship (priority order)

1. **Auth + accounts** — token-gated WS, login flow, per-user config that doesn't key on IP
2. **Onboarding** — first-run wizard, test-connection, policy mode picker, sample task
4. **Chrome Web Store listing** — package, icons, screenshots, privacy disclosures, single-purpose statement (Aug 2026 policy compliance)
5. **Billing / quota** — usage telemetry, optional harness subscription, spend cap
6. **Multi-tab parallelism** — unlock the "one task at a time" rejection
7. **Replay + task history UI** — `/v1/tasks` list + step-by-step replay panel
8. **Skill/template library** — exposed memory entries + workflow templates, shareable
9. **Cost controls** — per-task token budget, spend dashboard
10. **Stale-doc cleanup** — `decisions.md`, README references to non-existent files
11. **Tests** — JS test runner for extension, real-browser integration tests

## What Brotto uniquely solves today (no competitor does all of this)

- ✅ CDP-via-extension (user's Chrome, user's auth state)
- ✅ AX tree (no vision model, accessibility-correct)
- ✅ BYOK with session-only key storage
- ✅ Secure mode with sticky-up merge
- ✅ Per-component timing in every `TaskResult`
- ✅ Prompt-injection trust hierarchy baked into system prompt
- ✅ Memory = skills primitive (`read_page_text` + `recall_memory`)
- ✅ Token Plan ergonomics (`AUTH_TOKEN → API_KEY` propagation)

This is the "why this team wins" claim. It is a real claim, backed by code. Don't dilute it.

## When to update this doc

- A gap gets filled (move to "ships today" or remove)
- A new gap is discovered (real user pain or wish from research)
- A competitor ships something that closes a Brotto gap