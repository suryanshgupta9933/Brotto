"""Fixture catalogue. Data only — serving lives in server.py."""

from __future__ import annotations

from pydantic import BaseModel

# Two ports so auth-iframe can embed a genuinely cross-origin frame.
MAIN_PORT = 8811
IFRAME_PORT = 8812


class FixtureDef(BaseModel):
    name: str
    path: str
    port: int
    target_name: str      # accessible name the scripted task must reach
    targets_gap: str
    iframe_port: int | None = None


FIXTURES: list[FixtureDef] = [
    FixtureDef(name="auth-iframe", path="/auth-iframe/", port=MAIN_PORT,
               target_name="Confirm", targets_gap="iframe", iframe_port=IFRAME_PORT),
    FixtureDef(name="auth-aria-hidden", path="/auth-aria-hidden/", port=MAIN_PORT,
               target_name="Publish", targets_gap="aria_hidden"),
    FixtureDef(name="auth-canvas", path="/auth-canvas/", port=MAIN_PORT,
               target_name="Draw", targets_gap="canvas"),
    FixtureDef(name="auth-slowjs", path="/auth-slowjs/", port=MAIN_PORT,
               target_name="Loaded", targets_gap="slow_js"),
    FixtureDef(name="auth-inbox", path="/auth-inbox/", port=MAIN_PORT,
               target_name="Message 400", targets_gap="truncation"),
    FixtureDef(name="auth-popup", path="/auth-popup/", port=MAIN_PORT,
               target_name="Delete account", targets_gap="popup"),
    FixtureDef(name="auth-tabbed", path="/auth-tabbed/", port=MAIN_PORT,
               target_name="Restore Draft", targets_gap="tabbed"),
]

_BY_NAME = {f.name: f for f in FIXTURES}


def load_fixture(name: str) -> FixtureDef:
    return _BY_NAME[name]
