# The browser is not a picture

**2026-10-08 · Suryansh Gupta**

Every browser agent I looked at started the same way: screenshot the page, hand
the pixels to a vision model, decide where to click. Most still do. A few have
since bolted an accessibility tree on behind a flag for the easy cases.

I think that ordering is backwards — and the reason is not token cost. Token
cost is real and it is the *least* interesting reason. The interesting reason is
that the accessibility tree is not a cheaper screenshot. It is the interface a
human already uses to drive a browser, which means it has properties a
rendered rectangle does not.

This is a post about [Brotto](https://github.com/suryanshgupta9933/Brotto), an
extension plus a server you run yourself. I am not going to claim the pieces
here are new. The claim is narrower and falsifiable: **an agent that wants to
use your accounts has to be inside your session, and being inside your session
has consequences that show up in the design.**

## A ref that resolves is not a ref that can be clicked

The accessibility tree gives you roles, labels, values, and stable references —
`button`, `"Save changes"`, a backend node id. A screenshot gives you pixels
which you must resolve into the same information.

If you have ever written software against a browser, you have run into the gap
between those two. Your ref resolves. Your selector matches. The element is
real, has a box model, and is not disabled. And clicking it does nothing.

Brotto's answer is that the resolution succeeded and the *click* did not, and
those need different fixes. It measures the centre point — not the corners,
because a rectangle's corners are often not the element — and tests it in this
order: viewport bounds, then `document.elementFromPoint` in the page's own
realm. If the point hits a **child** of your target, that is a hit. If it hits
an **ancestor**, it is not. That direction is load-bearing and it is exactly the
thing that is wrong in both orders.

The part that changed my mind is what happens on failure. A blocked target
does not get retried against stale coordinates. It gets recorded in a separate
map as `off-screen` or `occluded`, with **a reason and no coordinates at all**.
Re-measuring it puts a coordinate back, and the model does the same wrong thing
again. And `disabled` is checked before anything else, because no amount of
scrolling fixes a disabled button — if you check it last, the agent will
happily scroll a disabled button into view and report progress.

Four labels — `[off-screen]`, `[covered]`, `[disabled]`, `[hidden]` — and all
four are **disclosures, not decoration**. Drop the line that says "this is off
screen" and you have not saved four tokens. You have taken away the only
explanation of why the last action did nothing. That is the entire difference
between an agent that fails legibly and one that fails mysteriously, and it is
invisible until the day it matters.

## The half-minute ceiling

Here is the part that decided the architecture.

Chrome suspends Manifest V3 service workers when they go idle. My own README
lists it under honest limitations: *"Long tasks can outlive the service worker.
Chrome suspends MV3 workers after ~30s idle."*

If your agent loop lives inside the extension, it inherits that lifetime. Every
long task is a race against a timer that has nothing to do with whether the task
is going well. Resuming then means reconstructing from a conversation in a
sidebar — which is not the same thing as resuming a run, because a conversation
is a transcript and a run is a state.

Brotto runs the loop in a process on your machine and makes the extension a
pure actuator: it is handed a target and asked for a box model. The extension
can die. Chrome can suspend it. The run continues, because the thing deciding
what to do next was never in the tab.

That is the whole reason for the server, and I want to be honest that it is a
cost. It means `docker compose up`, and it means a stranger evaluating this
compares unfavourably against every extension-only project on install friction.
I have made that trade knowingly. Below is what I think it buys.

## A record you can grep

Because the loop lives in a process with a filesystem behind it, every run
writes a nested-JSON document: one file per session, split into tasks, the
readable transcript, and the audit — each observation, prompt, action, approval
and timing, with the task as the join.

Not "chat history". An audit record. Concretely, this means I can ask questions
of my own system that I could not ask otherwise. How often does a run get
refused versus fail to decide at all? Those are different failure modes and
they have opposite fixes — one is the policy working, the other is the model
failing to produce a valid action — and on a chat-shaped history they look
identical. What is the p95 latency, and does it correlate with output length or
input length? On 73 recorded steps, output length correlates +0.876 and input
+0.660. The wall is **generation**, not prompt size, which is the opposite of
the instinct, and the instinct is expensive because a 25K-token prompt is
nearly free against a cached prefix.

Chrome storage cannot be the record of record. It is quota-bound, per-profile,
and evictable. An audit trail that answers "who ran this, and what did it see"
has to be somewhere with no eviction policy.

## Nanobrowser, honestly

The closest thing to this is [Nanobrowser](https://github.com/nanobrowser/nanobrowser) —
open-source, BYOK, local-first, extension-only. **14,000 stars, 1,500 forks, 40,000
users in the Chrome Web Store.** It has been building for two years. Its
multi-agent Planner/Navigator split is a good design and I have no complaint
about it.

It also has no server. Which is the right call for most people, most of the
time, and I am not going to pretend otherwise — it is why it has 40,000 users
and I have one. If you want an agent in your browser with your key and you do
not need a durable record, Nanobrowser is the better product today. Use it.

What Brotto adds is the part that needs a process behind it: a run that
survives the worker, and an audit record on your disk that you can grep and
delete as a unit. If you don't need those, you are paying six install steps for
nothing and you should not install this.

I had a line in my README grouping Nanobrowser with Browser Use and Skyvern as
"runs in a cloud browser you have never logged into." That was wrong, and it was
wrong in a way that would have been obvious to anyone from that community. It is
fixed now.

## What I want to be argued with

I would like to be wrong about some of this, specifically:

- **Is the accessibility tree actually a better agent interface than pixels?**
  My experience says yes, because roles and labels are the ground truth a human
  already uses. But I do not have a benchmark. My harness runs, but against a
  scripted planner with no model in the loop, so it measures perception and
  actions and says nothing about judgement. **Any reliability number you see in
  this space is a guess, including mine.** Screenshots might just be winning
  because they are easier to add, not because they are better.
- **Is a server the right home for an agent loop at all?** The extension-only
  architecture is simpler and it demonstrably scales. I have argued the
  service-worker lifetime and the audit record make it necessary. I would like
  to be talked out of this.
- **Is the approval-card model the right answer, or just a good one?** Every
  irreversible action stops and waits. That is a strong claim about what an agent
  should be trusted with, and it is a claim about trust, not about capability.

Apache 2.0. `git clone`, `docker compose up`, or wait for the store listing —
there is one in review and it removes the two build steps.