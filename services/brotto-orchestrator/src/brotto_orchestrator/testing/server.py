"""Serves the fixture sites on two ports so auth-iframe is really cross-origin."""

from __future__ import annotations

import contextlib
import functools
import pathlib
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# ponytail: the fixture HTML lives under tests/ rather than inside the
# package. Fixtures are test assets, not a shipped artifact, and copying
# them would let the benchmark drift from the pages it measures.
PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[2]   # src/brotto_orchestrator
REPO_ORCHESTRATOR = PACKAGE_ROOT.parents[0]                   # services/brotto-orchestrator
WEB_ROOT = REPO_ORCHESTRATOR / "tests" / "fixtures" / "web"


class _Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # silence per-request noise
        pass


@contextlib.contextmanager
def serving(directory: pathlib.Path, port: int):
    """Serve `directory` on `port` for the life of the context."""
    handler = functools.partial(_Handler, directory=str(directory))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def serve_fixtures(port: int):
    return serving(WEB_ROOT, port)


def serve_iframe_origin(port: int):
    # Rooted one level down so the auth-iframe page can reference /form.html
    # while living on a different port than the page that embeds it.
    return serving(WEB_ROOT / "auth-iframe", port)
