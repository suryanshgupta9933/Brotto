"""Make the tests run the code in *this* worktree.

There is one venv on this machine and its editable install points at whichever
worktree it was made from — `/Users/apple/Work/code/brotto`, not this one. So
without this line, pytest collected this worktree's test files and imported
the sibling's `brotto_orchestrator`, and the suite passed while testing code
nobody was editing. `start_server.py` carries the same shim for the same
reason; PYTHONPATH entries land before site-packages `.pth` additions.
"""

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
