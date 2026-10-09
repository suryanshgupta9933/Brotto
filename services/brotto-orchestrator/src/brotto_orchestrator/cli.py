"""Console entry point: `brotto`."""

from __future__ import annotations

import argparse
import sys

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def run_server(host: str, port: int, reload: bool) -> None:
    """Boot uvicorn with the FastAPI app."""
    import uvicorn

    from brotto_orchestrator.main import app
    from brotto_orchestrator.session.auth import auth_enabled

    # main.py already refuses a placeholder secret and warns on an unset one.
    # The warning is right for a developer on loopback and wrong everywhere
    # else: this process binds a relay that drives a logged-in browser, so an
    # unset secret plus a non-loopback bind is an open endpoint, not a
    # convenience. Pairing the two mistakes is what this refuses.
    if host not in _LOOPBACK and not auth_enabled():
        raise SystemExit(
            f"Refusing to bind {host} with no AGENT_SECRET: this relay can drive "
            "a logged-in browser, and with no secret every caller is trusted.\n"
            "Set one and start again:\n"
            "  export AGENT_SECRET=\"$(python3 -c 'import secrets;"
            "print(secrets.token_urlsafe(32))')\"\n"
            "If you only meant to reach this from this machine, bind 127.0.0.1."
        )

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

    # workers=1 is an invariant, not a tuning knob: the session registry is a
    # plain in-process dict, so POST /v1/sessions mints the id into whichever
    # worker served the request and the WebSocket then lands on a coin flip —
    # roughly half of all runs die on "session not found". Hosted platforms set
    # WEB_CONCURRENCY for us (Heroku sends 2), and uvicorn treats that as
    # "restart me" and exits 3 when handed an app object, so this overrides it.
    uvicorn.run(app, host=host, port=port, reload=reload, log_level="info", workers=1)


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
