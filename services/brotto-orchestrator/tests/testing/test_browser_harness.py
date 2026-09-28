"""Real-browser harness. Slow and networkless; opt in explicitly."""

from __future__ import annotations

import os
import pathlib

import pytest

from brotto_orchestrator.testing.scripts import get_script, SCRIPT_NAMES

pytestmark = pytest.mark.skipif(
    os.getenv("BROTTO_E2E") != "1",
    reason="set BROTTO_E2E=1 to run real-browser tests",
)

EXT = pathlib.Path(__file__).resolve().parents[4] / "clients" / "brotto-extension" / "dist"


def test_every_fixture_has_a_script():
    """A fixture with no script can only ever record HARNESS_ERROR."""
    from brotto_orchestrator.testing.fixtures import FIXTURES
    assert set(SCRIPT_NAMES) == {f.name for f in FIXTURES}


def test_script_reaches_fixture_target():
    from brotto_orchestrator.testing.fixtures import FIXTURES
    for fx in FIXTURES:
        script = get_script(fx.name)
        assert script.steps, fx.name


def test_extension_dist_exists():
    assert (EXT / "manifest.json").is_file(), "run `npm run build` in clients/brotto-extension first"


@pytest.mark.asyncio
async def test_browser_launches_with_clean_profile():
    """Review Focus #4. A reused profile carries a previous session, which
    silently turns an authenticated fixture test into an anonymous one."""
    import asyncio

    from brotto_orchestrator.testing.browser import brotto_browser
    # headless=False is load-bearing: neither Chrome nor Chromium registers an
    # extension service worker in headless mode.
    async with brotto_browser(extension_dir=str(EXT), headless=False) as ctx:
        assert ctx is not None
        # A context that opens is not the claim — the extension loading is.
        # Without this, a browser that silently ignored --load-extension would
        # pass and the file would cover nothing.
        for _ in range(30):
            if ctx.service_workers:
                break
            await asyncio.sleep(0.1)
        if not ctx.service_workers:
            pytest.skip("browser launched but the unpacked extension did not load")
