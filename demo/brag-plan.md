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

## Storyboard — 763 frames at 30fps (25.4s)

Scene lengths are the durations inside the `TransitionSeries` table; the
composition total is derived from it, for the reason in `README.md` — a
hand-written total truncates the last scene by however much the two drift. The
frame ranges below are therefore *starts*, and each overlaps the next by the
8-frame cut.

| # | Scene | Start | Dur | On screen |
|---|---|---|---|---|
| 1 | Hook | 0 | 2.5s | `AI can't log in.` struck through, then `So it can't use your accounts.` |
| 2 | Reveal | 67 | 3.5s | Panel slides in. `It runs in the browser you already signed into.` |
| 3 | Reads | 164 | 4.2s | The run, played as a sequence. `It reads the page's structure, not a screenshot.` |
| 4 | Asks | 282 | 4.0s | Approval card. `Anything sensitive, it stops and asks you.` |
| 5 | Answers | 394 | 3.7s | Final answer. `Then it comes back with the answer.` |
| 6 | Yours | 496 | 3.7s | History drawer. `Every run, on your own disk. Yours to delete.` |
| 7 | Outro | 598 | 5.5s | `Your keys. Your browser. Your account.` / install line |

## The panel is the hero, and it is drawn 1:1

The shots are captured at 2x, so the PNG is 840x1080 and the composition draws
it into an 840x1080 slot — a 1:1 pixel mapping, sharp, occupying 44% of the
frame width. It was previously displayed at the panel's 420px CSS width, which
put its own 11px body text at five pixels on the frame: legible as texture,
never as UI. That single change is most of why the screenshots read as
evidence now instead of as wallpaper.

The window is the panel's top 540 CSS px, not the whole ~1080px column. A full
column is a ninth of a 16:9 frame and cannot be shown at a readable size;
the top is the part worth showing anyway — the status bar that counts the run,
the card making the claim, the composer underneath. Beats whose evidence sits
lower scroll the panel before the capture.

## Motion

The complaint the first cut drew was "not a lot of motion", and it was right:
one still held for ninety frames behind a 5% scale. What there is now, per
scene: the panel slides in 140px and fades over 12 frames, the shot drifts
1.000 → 1.035 across the scene, the callout rectangle scales 0.93 → 1 while its
leader line draws leftward, the type enters staggered, and a rule draws under
the claim over frames 34–64. The Reads scene replaces the drift with a
four-frame crossfade between captured states, because those frames are already
changing and a moving container makes a run look like it is sliding.

## Readability

Every line is short (longest: "Anything sensitive, it stops and asks you." — 7
words ≈ 2.1s) and each is on screen for at least 2.5s, well past the 0.3s per
word floor. The hook's second line arrives at frame 26 and holds to 74, so it
is fully settled for 1.6s before the cut.

## Sound

The same generated bed as the explainer, trimmed harder: this cut moves faster,
so the music sits lower (0.11 peak) and the bed's arpeggio does the cutting
rather than a sound effect per scene. Adding a click to each of six cuts buys
nothing at 25 seconds and turns the track into a metronome.
