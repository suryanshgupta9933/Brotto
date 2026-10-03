# brag-plan — Brotto

## The angle

Every AI agent on your accounts stops at the login screen. Brotto's whole bet is
that the browser *is* the account: run the agent inside the one you have already
signed into, and the wall disappears.

That is a one-sentence idea, which is what a 20-second video can afford. The
54-second explainer in `Brotto.tsx` has to argue it across seven scenes; this one
states it and then shows three panels doing the arguing.

**Not** "a Chrome extension with an AI agent" — a stranger does not care what it
is built from, only what it unlocks.

## Hook (first 2 seconds)

`AI can't log in.` — struck through. `So it can't use your accounts.`

This is the first and only thing on screen, and it is a fact rather than a
hyperbole. The strikethrough does the arguing in one gesture and it is the kind
of frame that survives being screenshotted.

## Reveal

The real side panel, at real size, rising on the paper. Its own copy does the
explaining: *"Tell Brotto what to do in this tab."* No narration over it.

## Highlights

1. **It reads the page, not a screenshot.** The plan card, real, with its real
   "Allow actions on" line — which doubles as the domain-consent story.
2. **Anything sensitive, it asks first.** The approval card with DENY/APROVE.
   This is the trust beat and it is the one a sceptical viewer needs.
3. **Every run, on your own disk. Yours to delete.** The history panel with its
   DELETE ALL. The privacy claim is shown as a button, not asserted.

## Punchline

`Self-hosted. Open source. Your keys, your browser, your account.` then the
install line, because a launch video that does not say how to get it has spent
its last four seconds on a logo.

## Tone

`default` — punchy, clean, no hard cuts. The product's own UI does the work, so
the edit stays out of the way.

## Visual identity

The panel's own tokens, read from `panel-tokens.css` and re-exported in
`tokens.ts` — black on white, a 1px rule, Geist and Geist Mono, no shadows, no
brand colour. The panels in frame are the shipped `sidepanel.html` screenshotted
by `tools/panel_shot.py`, not rebuilt. A second palette here would be a palette
that drifts the first time the panel changes.

## Storyboard — 600 frames at 30fps (20.0s)

| # | Scene | Frames | Dur | On screen |
|---|---|---|---|---|
| 1 | Hook | 0–74 | 2.5s | `AI can't log in.` struck through, then `So it can't use your accounts.` |
| 2 | Reveal | 75–164 | 3.0s | Panel rises. `Brotto runs in the browser you already signed into.` |
| 3 | Highlight — reads | 165–254 | 3.0s | Plan card panel. `It reads the page's structure, not a screenshot.` |
| 4 | Highlight — asks | 255–344 | 3.0s | Approval card panel. `Anything sensitive, it stops and asks you.` |
| 5 | Highlight — yours | 345–419 | 2.5s | History panel. `Every run, on your own disk. Yours to delete.` |
| 6 | Punchline | 420–599 | 6.0s | `Self-hosted. Open source.` / `Your keys. Your browser. Your account.` / install line |

Scene lengths are the durations inside the `TransitionSeries` table and the
composition total is derived from it, for the reason in `README.md`: a
hand-written total truncates the last scene by however much the two drift.

## Readability

Every line is short (longest: "Anything sensitive, it stops and asks you." — 7
words ≈ 2.1s) and each is on screen for at least 2.5s, well past the 0.3s per
word floor. The hook's second line arrives at frame 26 and holds to 74, so it
is fully settled for 1.6s before the cut.

## Sound

The same generated bed as the explainer, trimmed harder: this cut moves faster,
so the music sits lower (0.11 peak) and the bed's arpeggio does the cutting
rather than a sound effect per scene. Adding a click to each of six cuts buys
nothing at 20 seconds and turns the track into a metronome.
