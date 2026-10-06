"""Console entry point: `brotto`."""

from __future__ import annotations

import argparse
import sys


def run_server(host: str, port: int, reload: bool) -> None:
    """Boot uvicorn with the FastAPI app."""
    import uvicorn

    from brotto_orchestrator.main import app

    print("=" * 60)
    print("BROTTO ORCHESTRATOR SERVER")
    print("=" * 60)
    print("Endpoints:")
    print("  - WebSocket: /ws/ext/{session_id}  (extension)")
    print("  - WebSocket: /ws/{user_id}         (Playwright clients)")
    print("  - HTTP     : /v1/sessions          (create session)")
    print("  - HTTP     : /run                  (dev mode task)")
    print("  - HTTP     : /health               (liveness)")
    print()
    print("Extension:")
    print("  1. Open chrome://extensions/")
    print("  2. Load unpacked: clients/brotto-extension/dist")
    print("  3. Configure server URL in extension options")
    print("=" * 60)

    uvicorn.run(app, host=host, port=port, reload=reload, log_level="info")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="brotto",
        description="Brotto orchestrator — drives a Chrome extension over CDP.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="bind address (default: %(default)s). Widening this exposes a relay "
        "that can drive the logged-in browser, so it needs a TLS terminator in "
        "front and an AGENT_SECRET set — see docs/architecture/deployment.md.",
    )
    parser.add_argument("--port", type=int, default=8000, help="bind port (default: %(default)s)")
    parser.add_argument("--reload", action="store_true", help="auto-reload on source changes")
    args = parser.parse_args()

    try:
        run_server(args.host, args.port, args.reload)
    except KeyboardInterrupt:
        print("\nServer stopped")
        sys.exit(0)


if __name__ == "__main__":
    main()
