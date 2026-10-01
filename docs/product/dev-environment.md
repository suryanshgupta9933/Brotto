# Dev Environment — Shipping Brotto Solo with AI (Sept 2026)

**Read at the start of any non-trivial Claude session on this project.** Update when a new skill/hook/pattern becomes standard.

This project uses heavy AI-assisted development. The goal: one human shipping at the speed of a small team, with sub-agents in parallel where it makes sense. The constraints: no context loss, no stale docs, no redundant code, no skipped human-in-the-loop.

## Modes you'll see

| Mode | When | Skill |
|---|---|---|
| **Ponytail** (default for code) | Writing any code | Always on (SessionStart hook) — `~/.claude/plugins/marketplaces/ponytail/` |
| **Superpowers** (default for process) | Any non-trivial work | `~/.claude/plugins/marketplaces/superpowers/` — load `using-superpowers` at session start |
| **Caveman** (default for prose in code) | Writing README, CLAUDE.md, comments | Pairs with Ponytail — terse, no essays |
| **Research mode** | You ask "research X" or invoke `/you:you-research` | Loads `you:you-research` skill — runs managed or agent-led research pipeline |

## Skills to know

### Process skills (superpowers plugin)

- **`superpowers:brainstorming`** — explore a problem space before deciding. Use before any new feature fork, before pricing decisions, before picking a vertical. Generates questions, not answers.
- **`superpowers:writing-plans`** — produce a formal spec/plan under `docs/superpowers/specs/` or `docs/superpowers/plans/`. Used when a feature is big enough to need a multi-step plan. The model-adapter spec at `docs/superpowers/specs/2026-09-28-model-adapter-design.md` is an example.
- **`superpowers:subagent-driven-development`** — the main pattern for parallel work. Use `sdd-workspace`, `task-brief`, `review-package` scripts. See `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/`. Already in `.claude/settings.local.json` permissions.
- **`superpowers:systematic-debugging`** — when something is broken. Symptom → grep every caller → root cause. Ponytail complements this — the lazy fix IS the root-cause fix in the shared function.
- **`superpowers:test-driven-development`** — when writing new logic that needs tests. The Brotto repo has 188 Python tests; the gap is JS extension tests + real-browser integration.

### Domain skills

- **`pydantic-skills/building-pydantic-ai-agents`** + **`pydantic-skills/pydantic-ai-harness`** — for any agent loop / pydantic-ai work. The orchestrator is pydantic-ai based.
- **`pydantic-skills/logfire-instrumentation`** — for the telemetry gap. Phase 1 fix candidate.
- **`chrome-devtools-plugins/skills/chrome-devtools`** + **`chrome-devtools-plugins/skills/a11y-debugging`** — when debugging the extension or the AX tree itself.
- **`chrome-devtools-plugins/skills/memory-leak-debugging`** — for service worker memory issues (MV3 budget risk).
- **`context-engineering-marketplace/skills/multi-agent-patterns`** — when designing sub-agent flows.
- **`context-engineering-marketplace/skills/memory-systems`** — when designing the cross-session memory model.

### Research skills

- **`you:you-research`** — managed one-shot synthesis with citations. Use when the user explicitly wants deep research.
- **`agent-tinyfish-ai:search` + `fetch_content`** — for live web grounding. Default for "what is X / how does X work" questions.
- **`agent-tinyfish-ai:run_web_automation`** — for actually browsing a site as a user would. Use sparingly — wallet-metered.

## Memory system (already installed)

- **`claude-mem`** plugin — passive cross-session memory. Builds a corpus of observations as you work. Queries via `mcp__plugin_claude-mem_mcp-search__search` / `get_observations` / `timeline`. Inject `/learn-codebase` to front-load the whole repo (~5 min).
- **Auto memory** — `~/.claude/projects/-Users-apple-Work-code-brotto/memory/`. Use for project-specific facts that should outlive any one session.

## Multi-session workflow patterns

### Pattern 1 — Parallel research streams (what we just did)

Use when a question is research-heavy and parallelizable. Dispatch 2–5 `general-purpose` sub-agents in `run_in_background: true`. Synthesize the results into one document.

Example: the Brotto product research used 4 agents (current state, competitors, users, market). Each got a self-contained prompt with the goal, the relevant URLs/queries, and a word-count budget.

### Pattern 2 — Subagent-driven-development (SDD)

Use when a feature is complex enough to need a multi-step plan with checkpoints. Steps:

1. Run `superpowers:writing-plans` → produces a plan file under `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
2. Run `sdd-workspace <plan>` from `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/` → splits the plan into numbered task briefs
3. Run `task-brief <plan> <N>` for each task → produces a review package
4. Run `review-package <plan> <commit> HEAD` → checks the implementation
5. Each task can be implemented by a separate Claude session in parallel — sub-agents pick up briefs

This is the pattern for Phase 1+ features (auth, onboarding, replay, multi-tab, skill library, etc.).

### Pattern 3 — Brainstorm before code

Use when about to start a non-trivial implementation. Invoke `superpowers:brainstorming` first. It generates questions, not answers — you answer them, then it produces a spec. **Don't enter plan mode without brainstorming first.**

### Pattern 4 — One question at a time

Use when a fork has multiple options and the user needs to choose. `AskUserQuestion` tool — one question per call, 2–4 options, recommended option first. Save answers to `docs/product/decisions/`.

## Context-loss prevention

The system that prevents stale and redundant work:

| Mechanism | Purpose | Where |
|---|---|---|
| **Product docs (`docs/product/`)** | Strategic frame, facts, gaps, roadmap, decisions | Read at session start, update when facts change |
| **Architectural decisions (`decisions.md`)** | Locked code-architecture choices (D1–D10) | Don't change without re-discussion |
| **Specs (`docs/superpowers/specs/`)** | Formal feature designs before implementation | Read before implementing a spec'd feature |
| **Plans (`docs/superpowers/plans/`)** | Multi-step implementation plans | SDD workflow |
| **claude-mem** | Passive memory of all sessions | Auto-injected on second session onward |
| **Auto memory (`~/.claude/projects/.../memory/`)** | Project-specific persistent facts | Save explicitly when learning something durable |
| **Ponytail enforcement** | "Skip the abstraction, root-cause the bug, write the test" | SessionStart hook active |
| **Superpowers `using-superpowers`** | "Invoke skill before any action, including clarifying questions" | Load at session start |

## Hooks already configured

| Hook | Purpose |
|---|---|
| `SessionStart:clear` | Activates Ponytail mode (lazy dev) |
| `SessionStart:claude-mem` | Seeds passive memory for the project |
| Various plugin hooks | Per-plugin behavior (chrome-devtools, pydantic, etc.) |

## Working agreements

1. **Read the product docs at session start.** Vision + open-questions at minimum. Other docs as relevant to the task.
2. **Check `open-questions.md` before any fork-shaped decision.** If the question is unresolved, **stop and ask the user** — do not implement past an unresolved fork.
3. **Update the doc you're working from in the same commit as the change.** Stale product docs are worse than no docs.
4. **Append decisions to `docs/product/decisions/`, never edit history.** When superseded, write a new file.
5. **Use superpowers before plan mode.** Brainstorming first, writing-plans second, then ExitPlanMode.
6. **Ponytail reflex on code.** Ladder: needs to exist? → already in codebase? → stdlib? → native? → installed dep? → one line? → minimum.
7. **Bug fix = root cause.** Grep every caller of the function you're about to touch before editing. Fix in the shared function, not every caller.
8. **No unrequested abstractions, no scaffolding "for later", no half-finished implementations.**
9. **Markdown comments**: only when WHY is non-obvious. Comments don't repeat the code.
10. **Don't include `Co-Authored-By: Claude ...` in commit messages.** Per global `~/.claude/CLAUDE.md`.

## When to update this doc

- A new skill becomes standard practice (add to "Skills to know")
- A new pattern emerges from a multi-session workflow
- A new hook is configured
- A working agreement gets violated enough to need codifying

---

## Setup checklist — concrete changes to activate this

These changes are reversible. Apply them when ready; review and adjust as you go.

### 1. Add superpowers skills to `.claude/settings.local.json` permissions

Edit `/Users/apple/Work/code/brotto/.claude/settings.local.json` and add these to the `permissions.allow` array (in addition to what's already there):

```json
"Skill(superpowers:using-superpowers)",
"Skill(superpowers:brainstorming)",
"Skill(superpowers:brainstorming:*)",
"Skill(superpowers:test-driven-development)",
"Skill(superpowers:verification-before-completion)",
"Skill(superpowers:requesting-code-review)",
"Skill(superpowers:writing-skills)",
```

Also clean up the existing stale hardcoded `/Users/apple/Work/code/inventic/browser-automation/...` paths — those refer to a previous project and should be removed.

### 2. Add generic SDD script permissions

Replace the hardcoded SDD script permissions with generic versions:

```json
"Bash(/Users/apple/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/sdd-workspace *)",
"Bash(/Users/apple/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief *)",
"Bash(/Users/apple/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/review-package *)",
```

### 3. Add common Phase 1+ tooling permissions

```json
"Bash(./node_modules/.bin/*)",          // JS test runner
"Bash(npm test *)",
"Bash(npm run lint*)",
"Bash(playwright *)",                    // real-browser tests
"Bash(stripe *)",                        // Phase 4 billing
"Bash(gh repo create *)",
"Bash(gh release *)",
```

### 4. Session-start ritual (manual, 2 min)

Until/unless you add a custom SessionStart hook, run this ritual when you open Claude Code on Brotto:

1. Run `/clear` (clean slate)
2. Run `/reload-plugins` if you just edited settings
3. Tell Claude in your first message: **"Read `docs/product/vision.md` and `docs/product/open-questions.md`, then I'll brief you on today's task."** This primes the strategic context.

### 5. Optional — SessionStart hook for product docs

If you want product docs auto-injected on session start (no manual ritual), add a custom hook to `.claude/settings.json` (project-level):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "cat /Users/apple/Work/code/brotto/docs/product/vision.md /Users/apple/Work/code/brotto/docs/product/open-questions.md"
          }
        ]
      }
    ]
  }
}
```

This runs the two most important docs at every session start. Trade-off: adds ~5k tokens to every session's first message. Worth it for the no-context-loss guarantee; revert if it's too noisy.

### 6. End-of-session ritual (manual, 2 min)

When wrapping a session, before you `/clear`:

1. **Update any doc that drifted.** The "working agreements" rule says: same commit as the code change. Do it now, while you remember.
2. **If you answered a question or made a fork-shaped decision,** create the decision doc + update `open-questions.md` link index.
3. **If you shipped code, run `./.venv/bin/python -m pytest tests/ -q` to confirm nothing broke.**
4. **Stage the changes** so they're ready to commit (don't have to commit, just stage).

### 7. Multi-session workflow (when working in parallel)

For parallel work on different parts of the project:

- Each parallel session = different worktree (`git worktree add ../brotto-<feature> -b feature/<name>`)
- Each session reads `vision.md` + `open-questions.md` first
- Each session commits to its own branch
- Merge via PR or fast-forward when both are green

The docs (`docs/product/`) are shared across all sessions. Decisions are append-only; no conflicts. Phase 1+ features are best split by area: auth / onboarding / CWS / billing / replay / multi-tab.

### 8. When to NOT use AI

- Legal contracts (have a lawyer review)
- Pricing-page copy for the public launch (have a marketer review)
- Compliance: SOC2, GDPR, HIPAA (have a specialist)
- Anything that involves spending money > $1k without your explicit confirmation
- Anything that sends messages to other humans without your explicit confirmation

AI drafts. You decide. AI writes the diff. You commit. AI suggests the doc update. You make it stick.