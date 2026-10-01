#!/usr/bin/env python3
"""Start the Brotto orchestrator server. Thin shim over the `brotto` CLI."""

import sys
from pathlib import Path

# ponytail: two clones of this repo sit on one machine sharing one venv, and
# that venv has an editable install pointing at whichever one it was made from.
# Without this, "start the server from brotto-v2" silently runs the sibling's
# code — which is how a deleted control kept showing up in the panel. sys.path
# entries from PYTHONPATH are added before site-packages .pth paths, so
# inserting here beats both.
_SRC = Path(__file__).resolve().parent / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from brotto_orchestrator.cli import main

if __name__ == "__main__":
    main()
