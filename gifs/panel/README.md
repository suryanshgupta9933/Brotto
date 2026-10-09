# Panel GIFs

Looping GIFs of the Brotto side panel showing each blocking card type: the
approval request, the clarifying question, and the sign-in wall. Each one opens
unanswered and resolves in place.

![approval](out/approval.gif)
![clarify](out/clarify.gif)
![login](out/login.gif)

## Why these are not screenshots

The panels are rendered from the shipping extension. `build.mjs` reads
`clients/brotto-extension/src/sidepanel.html`, lifts its `<style>` block and body
markup verbatim, copies `sidepanel.js` beside them, and calls the panel's own
`appendApprovalCard` / `appendClarifyCard` / `appendLoginCard` / `resolveCard`
at load time. Nothing here draws a card — a mockup is an absence nobody
reviews, so a card that drifts from shipping is a card that is wrong.

`chrome-stub.js` stands down only the parts that would open a socket or touch
extension storage, so the real `sidepanel.js` loads unedited.

The animation crossfades between two snapshots of that real markup rather than
mutating the DOM mid-timeline, so frames can render in any order.

## Rendering

```bash
./render.sh
```

Needs `ffmpeg` on PATH and the pinned `hyperframes` version from `package.json`.
HyperFrames writes GIF directly; the ffmpeg pass is what makes them small enough
to put on a page — raw output is ~10MB each because the crossfade re-quantises
every frame.

Three rules in the generated HTML depart from the panel, each commented in
`build.mjs`: `.grain` is hidden (its 1.5% noise is invisible at GIF scale and
costs ~4× the file size), and the two perpetual animations — the sign-in badge
pulse and the model pill's marquee — are stopped, since a 6s loop has no room for
a cycle nobody reads at GIF speed.

## Not verified in a browser

The GIFs are frames captured by HyperFrames' headless renderer, not the panel
running in a real side panel. Opening `login.html` in a browser is the closest
equivalent and is how the two panel bugs below were found.