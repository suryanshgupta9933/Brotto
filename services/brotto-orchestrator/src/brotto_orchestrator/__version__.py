"""The one product version. manifest.json is authoritative; this is a mirror.

Written by scripts/release.js. Read by main.py. Never hand-edited to
"catch up" — if this disagrees with manifest.json, scripts/version.js
fails the build, and that is the point.
"""

__version__ = "0.2.1"
