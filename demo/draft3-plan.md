# draft3-plan — the disk

## The angle

The other two cuts argue about what the agent can *do*: run in your session
(`Draft1`), and address elements semantically (`Draft2`). This one argues about
what it *leaves behind*, because "self-hosted" is the whole product claim and
nobody can check that by looking at a screenshot of a panel. It is a fact about
a filesystem.

A viewer who has not felt the difference between a hosted agent and a local one
believes them equally, and it is the privacy claim that loses the argument when
both products look the same. So the second column here is a file listing rather
than a picture. That is the cheapest possible way to make the claim checkable.

## Hook (first 2.5 seconds)

`Not on our box.` / `On yours.` — the second line in `ink.ink3`, so it reads as
the answer to the first. Then `docker compose up` in mono, because the sentence
that proves the claim is a command anyone can paste.

## The three beats

1. **A run is two files.** The session JSON and its scratchpad, both real paths
   as `agent/audit.py` writes them, in a mono block under the rule. The panel
   behind it is the history drawer — the same place the two files came from.

2. **And two things it used to write.** Struck through, in `ink.ink3`:
   `sessions/<id>.pages.json` and `ax_diff → audit document`. A hosted competitor
   writes all three. That is the entire difference between the two products, and
   it is a list.

3. **One button ends it.** The history drawer with DELETE ALL, called out. The
   cap is the argument, not the feature: the transcript, the scratchpad and the
   registry entry go together, because a session that comes back after you
   deleted it is a session you did not delete.

## The filenames are real, and the strikethroughs are load-bearing

Both surviving files are the ones `audit.py` actually writes, at the paths it
actually uses. A made-up listing would be the one place in three cuts where the
viewer could check.

The two struck-through ones are the interesting half. `.pages.json` lost its last
writer and `ax_diff` went with it on 2026-10-03; what survives per page is a
200-character digest. A cut that only listed what exists would sound like any
other product's file layout. Listing what a competitor writes and this one
stopped writing is what makes the difference legible in nine seconds.

## Layout

`Beat` is reused as-is rather than forked. It is the layout for a claim on the
left and evidence on the right, and this cut is that. The one thing it needed was
somewhere to put a block that is not a sentence, which is the `extra` prop — the
mono listing, under the rule, entering 20 frames after it draws.

`extra` is the whole reason `Beat` grew it. Forking the component for a second
caller is how three cuts end up with three `Beat`s that differ by 30px.

## The callout is the one place the shared layout needed a fix

`SPOTS.deleteAll` sits at x≈700 of 840 — the panel's right half — so a
right-aligned label in a 280px gutter runs off it and lands on the drawer it is
annotating. `Callout` now clamps the label to `PANEL_X` and lets the leader take
up the slack. The leader is 690px long and crosses the panel's own header, which
looks like a lot; it is still cheaper than text on top of the button it names,
and the alternative — a routed L-shaped leader — is a drawing.

## Music

`--dur 19.1 --accents 0,4,10,16,23 --resolve 31`. The five scene starts fall at
0, 2.2s, 6.1s, 9.9s and 13.6s; the nearest beats are 0, 4, 10, 16 and 23.
