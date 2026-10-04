# The Brotto demo

Four videos, one renderer. Remotion renders them from React components, so a fix
to a scene is a diff you can review, not a re-record.

| Composition | Cut | Length | For |
|---|---|---|---|
| `Brotto` | the long explainer | 1619 frames / 54s | the README, people deciding whether to read it |
| `Draft1` | the login wall | 763 frames / 25.4s | a post, where the first two seconds are the whole pitch |
| `Draft2` | the accessibility tree | 588 frames / 19.6s | the moat: refs, not coordinates |
| `Draft3` | the disk | 573 frames / 19.1s | the other moat: nothing leaves your machine |

The three short cuts are variations, not a series. Each argues one part of the
same case off the same real panel, and each is a candidate for a different
audience rather than chapter two of the first. Their plans —
[`draft1-plan.md`](./draft1-plan.md), [`draft2-plan.md`](./draft2-plan.md),
[`draft3-plan.md`](./draft3-plan.md) — carry the angle and the storyboard. Read
one before changing a scene length; every cut derives its total from its scene
table.

```console
npm install
npm run dev      # Remotion Studio, scrub the timeline, hot-reload
npm run render   # -> out/brotto-demo.mp4
npm run lint     # eslint + tsc

npm run render:draft1   # -> out/draft1.mp4
npm run render:draft2   # -> out/draft2.mp4
npm run render:draft3   # -> out/draft3.mp4
```

## Things that are deliberate

**The panel screenshots are real.** They are the actual extension, captured from
a real run. The video's argument is that Brotto reads the accessibility tree
rather than taking an impression of a screenshot — a fabricated panel would
undercut the one claim the video is making.

**They are also generated, not photographed.** `tools/panel_shot.py` loads the
shipped `clients/brotto-extension/src/sidepanel.html` in Chromium behind a
`chrome` shim, then drives it through genuine relay frames delivered to the
genuine `chrome.runtime.onMessage` listener. Nothing re-implements the panel, so
a card that looks wrong in the video is wrong in the product — there is no
second copy to start lying the day the real one changes.

```console
../.venv/bin/python tools/panel_shot.py   # -> public/shots/*.png + public/seq/*.png at 2x
```

Two details in there are load-bearing and are easy to get wrong on a re-run.
Every number the status bar shows is the panel's *own* arithmetic — `startedAt`
seeds its clock, `index` counts its steps, `context.pct` is what it renders for
CONTEXT — so the harness writes frames, never DOM. And the five `page.route()`
stubs are not optional: a `file://` origin gets CORS failures that look exactly
like a stopped server, so without them every shot carries the "server
unreachable" toast.

**The panel is captured 420x540 and drawn 1:1, and both halves have to agree.**
`VIEW_W`/`VIEW_H` in the harness, the shot dimensions, and `PANEL_W`/`PANEL_H`
in the composition are the same 2x pixel space, so the callout anchors land
where the card actually is. Two things this bought: the panel's own 11px body
text now lands at 11px on the 1920px frame rather than the 5px it shrank to
when the panel was drawn at its 420px CSS width, and the panel occupies 44% of
the frame instead of 22%. The window is 540 CSS px of a ~1080px panel — a full
column cannot be shown at a readable size, and the top is the part worth
showing: the status bar, the card, the composer. Beats whose evidence is lower
scroll the panel before capturing.

**The run is a sequence, not a still.** `tools/panel_shot.py` also writes
`public/seq/*.png` and generates `src/seq.ts` naming them in order and how long
each holds, which is what `RunPanel` plays back with a four-frame crossfade
between states. One still of the panel is a picture of a thing that does
nothing; the same panel captured state by state has its steps arriving and its
counter moving, which is the product in a dozen frames. The module is generated
rather than hand-written because a hand-kept list of frames is a second copy
that drifts — the same failure as the three model catalogues.

**Nothing takes a frame number as a prop.** `Shot` and `RunPanel` used to accept
`at`, and every call site passed the literal `0`, which `panelIn(0)` turns into
`opacity: 0` — the panel was invisible for the whole cut and only the callouts
drew, which reads as "the screenshots look off" rather than as a bug. They call
`useCurrentFrame()` themselves now, because a prop a caller has to remember is
a prop a caller gets wrong.

**The staging is one module because it is one pixel space.** `src/stage.tsx`
holds `PANEL_W`/`PANEL_H`/`PANEL_X`/`TYPE_X`/`GUTTER` and the `Shot`, `Callout`,
`Beat` and `Outro` components every short cut draws with. With three cuts that is
the difference between a shared constant and three copies of it, and a constant
that drifts in one cut is a callout pointing at a gap where a card used to be.
A draft that copies these constants gets them right; a draft that re-derives them
does not.

`Callout` clamps its label to the panel's left edge, which is the one place the
clamp is not cosmetic. An anchor in the panel's right half — the history drawer's
DELETE ALL sits at x≈700 of 840 — otherwise pushes a right-aligned label clean
off the 280px gutter and over the panel it is annotating, so the label ends up
drawn on top of the thing it names. The leader takes up the slack and runs the
long way to the element; the short way costs correctness, and a rule is cheap.

**Frame 0 is the poster.** `{frame === 0 ? … : null}` overlays the outro still
on the first frame and nothing else, so a platform that grabs its thumbnail off
frame 0 gets a card rather than the hook mid-entrance. It replaces the frame
rather than adding one — a one-frame *scene* cannot sit in a `TransitionSeries`
at all, because the next transition is 8 frames long, and adding a frame would
desync the audio.

**Fonts are bundled, not fetched.** `public/geist-latin.woff2` and
`public/geist-mono-latin.woff2`. A `staticFile()` that resolves to a network
fetch is a render that breaks on the day the CDN does.

**The music is generated, not licensed.** `public/bed.mp3` comes from
`tools/bed.mjs` — pure stdlib plus the ffmpeg the Remotion CLI already ships, so
there is nothing to install and no attribution to carry. It is ours in the sense
that matters: the arithmetic is in the repo.

```console
node tools/bed.mjs   # -> public/bed.mp3, ~1.5s
```

**It is scored to the cut, not looped under it.** The previous bed was a 10.7s
cycle, which on a 25.4s video seam-auditions twice at moments nobody chose, and
a fixed cycle cannot hit an edit. `bed.mjs` places every accent on the beat
nearest a scene start — 100bpm, so a beat is 0.6s and the seven scene starts
land within 0.2s of a beat. Seven layers: a detuned pad, a sub, a sixteenth-note
arpeggio that enters on the Reveal rather than the hook, a shaker from the Asks
onward, a pitch-drop accent on each cut, two risers, and a Schroeder reverb.
The last chord resolves at 24.0s and rings into the cut at 25.4s.

Two things the first mix got wrong, both invisible in the code. The arpeggio
was mixed 5× below the pad and was inaudible — the pad and sub are a continuous
floor, so a layer under them disappears rather than being subtle. And the level
was set by eye against a file whose normalisation had changed; the script now
prints peak, RMS and a per-half-second energy profile, which is how the inaudible
layer was found without listening to the result. `Brotto` loops the same file at
a lower volume; the cue ends on a cadence, so the loop point is inaudible there.

**One generator, three cues.** The short cuts are 25.4s, 19.6s and 19.1s and
their scene boundaries fall on different beats, so `bed.mjs` takes the cut's
length, its accent positions and its resolve as flags rather than there being
three copies of the piece. The progression repeats to fill whatever length it is
given, so a second bed is different arguments to the same music — which is the
point, since three parallel copies of a generator is how the three model
catalogues in this repo went stale at the same time.

```console
node tools/bed.mjs --out public/bed2.mp3 --dur 19.6 --accents 0,4,12,18,24 --resolve 32
node tools/bed.mjs --out public/bed3.mp3 --dur 19.1 --accents 0,4,10,16,23 --resolve 31
```

**The accessibility tree is captured, not typed.** `Draft2` argues that a ref is
a handle on a real element rather than a guess at a pixel, and a hand-written
tree would be a drawing of the product rather than the product. The harness
reads it over the same CDP session that drives the panel —
`Accessibility.getFullAXTree`, formatted by the same rules as
`agent/ax_filter.py` — and resolves each node's rect with `DOM.getBoxModel` in
the same 2x space the composition draws, so the line the model sees and the box
the video lights are provably one node. `AX_TREE` is generated into `src/seq.ts`
for the same reason `RUN` and `SPOTS` are: a kept-by-hand list of frames or
names is a second copy that drifts.

The tree's listitems come back nameless, and that is faithful rather than a
capture bug — Chrome puts a row's text in a child `StaticText`, which
`KEEP_ROLES` drops because `page_text` already carries it on the real path. So
`Draft2` argues about the correspondence between a ref and an element, which is
the part that is actually the moat, rather than about reading the page back out
of the tree.

**Scene lengths are not round numbers.** Bet is 420 frames and SelfHost is 265.
Each scene is sized to its own content, because a scene that cuts while its last
animation is still arriving reads as a missing feature rather than as a fast
edit. `HOLD` and `SHOTS` live at module scope for the same reason — when the
shot length and the scene length were written separately they drifted, which is
how the first cut ended up cutting mid-animation.

**The composition length is derived, not typed.** Scenes are durations inside a
`<TransitionSeries>`, and transitions *overlap*, so no absolute start frame is
stable and the total is shorter than the sum. `DURATION` is computed from the
scene table and the transition timing; a hand-written total in `Root.tsx`
silently truncates the last scene by however much it drifted.

**Every animation goes through `enter()` in `src/atoms.tsx`.** One helper, one
easing constant, ~40 call sites. It uses `Easing.bezier(0.16, 1, 0.3, 1)` —
linear easing was what made the first cut read as slow, because it spends the
second half of every fade arriving, and the arrival is the part you look away
from.

**The panel screenshots drift.** A still that never moves reads as a still,
even for three seconds. Each panel pushes to 1.05× over its hold, with
`output: "perceptual-scale"` so the perceived rate stays even as the scale grows
— without it the drift slows down exactly as it becomes noticeable. This is the
placeholder for real screen capture, not a substitute for it.

## Output

`out/` is gitignored. The rendered file is attached to a GitHub release and
linked from the root README; a 3.5MB binary does not belong in the history.

## License

Remotion is free for individuals and companies of up to three people. Beyond
that it needs a company license — see
[the terms](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
The rest of this repository is Apache-2.0.
