# Decision: Canvas-rendered pages — report the limitation, do not add vision

**Date:** 2026-10-01
**Question:** Open item in `docs/superpowers/specs/2026-10-01-perception-hardening-design.md` ("Canvas")
**Status:** Accepted

## Context

A canvas-rendered page has no accessibility nodes and no text, by construction.
The perception probe measured it: `auth-canvas` is `GAP_UNREACHABLE`, so there is
no a11y mirror to be had for free. The spec deliberately left the resolution open,
because the two options are a product decision rather than a perception task:

- **Add a vision fallback** — `Page.captureScreenshot` plus a vision model.
- **Report the limitation** — tell the model the page is drawing itself, name the
  control it could not find, and ask the user.

A vision path contradicts the "AX tree, no vision model" position that is on the
moat list, and it costs tokens on every observation.

## Choice

**Report the limitation. No screenshots, no vision model, in this workstream or
after it unless new evidence flips the numbers below.**

Concretely: `prompt.py` gains one section, "When a page looks empty" — check the
text once with `read_page_text("body")`, and if that is empty too, say the page is
rendering itself, name the control being looked for, and ask the user. No new CDP
method, no `AgentTurn` field, no protocol surface. It fires on the symptom the
model already observes, so it works on both capture paths.

## Consequences

**Enabled:**
- The no-vision position is now measured rather than assumed. On 358 OSWorld
  tasks: screenshot **7.0%**, linearized AX tree **15.6%**, compressed AX tree
  **20.7%**. The screenshot condition was 8× worse than text.
- Zero per-observation token cost for a page type we cannot fix.
- An honest answer instead of a runaway. The model reaching "I cannot read this
  page" is a *complete* answer under the convergence rules.

**Closed off:**
- Any task on a canvas-rendered UI. These are unreachable and will stay so. This
  is a real product limit, not a bug, and it should be stated in user-facing copy
  rather than discovered mid-task.
- `Page.captureScreenshot` remains out of scope, which also keeps the audit
  document text-only.

**Why not the other way.** The obvious counter-argument is that vision closes the
gap. The evidence points the other way: on WebArena-Infinity, Gemini-3-Flash
scores **69.3%** while vision-based Kimi-K2.5 scores **45.9%** and Qwen-3.5-Plus
**49.1%**. A vision path is a measurable regression on exactly the pages Brotto
already reads well. The cost of vision is not only tokens.

## Follow-ups

- [ ] State the canvas limit in user-facing copy before launch, so a user who hits
      a canvas page knows it is the product and not a stall.
- [ ] Revisit only if a canvas-rendered site is load-bearing for the product. That
      is a market question, not a perception one, and the bar to overturn this is
      evidence that a canvas surface matters *and* that vision no longer measures
      worse.
