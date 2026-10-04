# draft2-plan — the accessibility tree

## The angle

The other cuts argue from the panel: here is the thing, here is what it did. This
one argues from the other side, from the lines the model actually receives.

The moat is not "it has a nice UI". It is that every control on a page is an
addressable node with a stable ref, so a click lands on the button rather than
on whatever happened to be near a coordinate when the screenshot was taken. Every
coordinate-based agent has the same picture; almost none of them can turn one
into an action that either lands or admits it missed.

`Draft1` says the browser is the account. `Draft2` says the browser is the API.
Both are the same bet — the extension is inside the page, not looking at it — and
they make different audiences care.

## Hook (first 2.5 seconds)

`It doesn't see the page.` / `It sees this.`

Below it, three real lines off the tree, at 30px, unindented so they read as
something the machine printed rather than as UI. The "this" is the turn in the
argument: the second line is dimmed to `ink.ink2` so the pair reads as one
sentence with a full stop in it.

## The three beats

1. **Reads.** Every line of the tree lands whole, because that is what the model
   gets: one observation, all of it, not a line at a time. Then the model walks
   it — one line every nine frames, lit, with the element it names outlined on
   the panel beside it. The walk exists to show the correspondence. It is not
   meant to be transcribed; nobody can read a ref in nine frames and is supposed
   to.

2. **Acts.** The walk stops on APPROVE PLAN and holds. The panel has not moved.
   `Clicked [0:98]` arrives underneath, in `ink.ok`. A ref clicked the button.

3. **Fails.** Same panel, same tree, nothing moved. A ref that is not in this
   observation — `[0:412] button "Continue"`, in `ink.bad` — and then the two
   lines the product actually wrote: `ok: false` and `Error executing: ref
   '0:412' is not in the current AX tree`.

   The panel being unchanged behind it is the whole point. Nothing on screen
   moved, so a coordinate-based agent would have clicked *something* and reported
   a step. It did not click the nearest plausible thing and call it progress.

## Both strings are verbatim

`Clicked [ref]` and the `Error executing:` refusal are the real formats from
`cdp/extension_relay.py`, not paraphrases for legibility. This is the only cut
whose evidence is the error path, and a tidied-up error message undercuts
exactly the thing it is showing. So does the `ok: false` — the marker that
`harness.py` derives by substring test, because it decorates the outcome as
`f"Clicked [{ref}]: {result}"` and the marker arrives mid-string.

## The tree is captured, not typed

`tools/panel_shot.py` reads it over the same CDP session that drives the panel:
`Accessibility.getFullAXTree`, formatted by the same rules as
`agent/ax_filter.py`, with each node's rect resolved by `DOM.getBoxModel`. Both
the line and the box come from one response, so the ref the video prints and the
rectangle it lights are provably the same node. A hand-typed tree would be a
drawing of the product.

`AX_TREE` is generated into `src/seq.ts` alongside `RUN` and `SPOTS`, for the
reason those are: a list kept by hand is a second copy that drifts.

**Every panel shot in this cut is `shots/panel-plan.png`.** The tree was read at
the plan state, so an earlier version that pointed the Act beat at
`seq/07-asks.png` lit an APPROVE PLAN highlight on a frame with no approval card
on it. The panel not moving between the Acts beat and the Fails beat is the
comparison, so it has to be the same panel.

**The walk references `AX_TREE[9]`, an index, not the literal ref `[0:98]`.** The
ids are whatever Chromium assigns on the day the shot is taken; a pinned ref
quietly points at nothing after a panel change and the cut goes on making its
argument about a button that is no longer there.

## The listitems are nameless, and that is honest

Chrome puts a row's text in a child `StaticText`, which `KEEP_ROLES` drops
because `page_text` already carries it on the real path. So five listitems render
as `[0:79] list`, then five bare listitem lines. That is what the model sees, and
it is why the cut argues about the correspondence between a ref and an element
rather than about reading the page back out of the tree.

## Layout

Not `Beat`. `Beat` spends its left column on a headline and reserves 280px of
gutter for a callout label; this cut spends the whole column on the tree, and the
panel keeps the right-hand slot so the two line up. `Split` is a local component
for that, built from the same `TYPE_X` / `PANEL_X` constants and reusing `Shot`.
`LINE` is 34 and the tree is 13 lines, so `TREE_TOP` of 470 leaves the headline
block above it and the audit lines below.

The lit element gets a 2px outline rather than a filled box, in the same weight
as the leader lines in the other cuts: a panel that is already a stack of boxes
does not need a second one drawn round the thing being pointed at.

## Music

`--dur 19.6 --accents 0,4,12,18,24 --resolve 32`. Five scenes, so five accents
rather than Draft1's seven. The five scene starts fall at 0, 2.2s, 7.0s, 10.7s
and 14.1s, and the nearest beats to those are 0, 4, 12, 18 and 24 — the accents
are the scene table, rounded. The resolve at beat 32 is the last chord change,
0.4s before the cut ends, so the outro starts on the turn.
