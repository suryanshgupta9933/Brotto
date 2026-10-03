# The Brotto demo

Two videos, one renderer. Remotion renders them from React components, so a fix
to a scene is a diff you can review, not a re-record.

| Composition | Cut | Length | For |
|---|---|---|---|
| `Brotto` | the long explainer | 1619 frames / 54s | the README, people deciding whether to read it |
| `Brag` | the launch cut | 560 frames / 18.7s | a post, where the first two seconds are the whole pitch |

`Brag`'s plan — the angle, the storyboard and why each scene is the length it
is — is [`brag-plan.md`](./brag-plan.md). Read it before changing a scene
length; both cuts derive their total from the scene table.

```console
npm install
npm run dev      # Remotion Studio, scrub the timeline, hot-reload
npm run render   # -> out/brotto-demo.mp4
npm run lint     # eslint + tsc

npx remotion render Brag out/brag.mp4
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
../.venv/bin/python tools/panel_shot.py   # -> public/shots/*.png at 2x
```

Two details in there are load-bearing and are easy to get wrong on a re-run.
Every number the status bar shows is the panel's *own* arithmetic — `startedAt`
seeds its clock, `index` counts its steps, `context.pct` is what it renders for
CONTEXT — so the harness writes frames, never DOM. And the five `page.route()`
stubs are not optional: a `file://` origin gets CORS failures that look exactly
like a stopped server, so without them every shot carries the "server
unreachable" toast.

**Frame 0 is the poster.** `{frame === 0 ? … : null}` overlays the outro still
on the first frame and nothing else, so a platform that grabs its thumbnail off
frame 0 gets a card rather than the hook mid-entrance. It replaces the frame
rather than adding one — a one-frame *scene* cannot sit in a `TransitionSeries`
at all, because the next transition is 8 frames long, and adding a frame would
desync the audio.

**Fonts are bundled, not fetched.** `public/geist-latin.woff2` and
`public/geist-mono-latin.woff2`. A `staticFile()` that resolves to a network
fetch is a render that breaks on the day the CDN does.

**The music bed is generated, not licensed.** `public/bed.mp3` is a 10.67s
loop rendered from sine arithmetic — a four-bar i–VI–III–VII pad, a plucked
arpeggio, a sub, and a 350ms crossfade at the seam so the repeat is inaudible.
It is looped under the whole video with a 20-frame fade in and a 70-frame fade
out. It is ours, so there is no attribution to carry and nothing to clear.

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
