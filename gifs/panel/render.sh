#!/usr/bin/env bash
# Render the panel GIFs.
#
# HyperFrames writes GIF directly, but not palette-optimised — the crossfade
# between the two DOM states re-quantises every frame, so the raw output is
# ~10MB each. The ffmpeg pass is what makes them small enough to put on a page.
set -euo pipefail
cd "$(dirname "$0")"

node build.mjs
mkdir -p out

# The pinned version, matching package.json. Bare `npx hyperframes` resolves
# whatever is newest that day, so a re-render weeks from now is a different
# renderer than the one that produced the committed GIFs.
HF="npx --yes hyperframes@0.8.143"

for card in approval clarify login; do
  $HF render -c "$card.html" --format gif --gif-loop 0 \
    -f 20 -o "renders/$card.gif" --quiet
  # Native width, native framerate, double the palette. Downscaling to 360
  # threw away the hairlines the whole design is made of; 15fps dropped frames
  # off the crossfade. Together that was 260K against 224K for something visibly
  # better, so the quality is free here.
  ffmpeg -v error -y -i "renders/$card.gif" \
    -vf "fps=20,scale=400:-1:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=128:stats_mode=diff[p];\
[b][p]paletteuse=dither=bayer:bayer_scale=3" \
    -loop 0 "out/$card.gif"
  printf '%-10s %s\n' "$card" "$(du -h "out/$card.gif" | cut -f1)"
done