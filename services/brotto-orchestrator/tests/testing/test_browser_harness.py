"""Real-browser harness. Slow and networkless; opt in explicitly."""

from __future__ import annotations

import os
import pathlib

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("BROTTO_E2E") != "1",
    reason="set BROTTO_E2E=1 to run real-browser tests",
)

EXT = pathlib.Path(__file__).resolve().parents[4] / "clients" / "brotto-extension" / "dist"


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
            # Not a skip: the browser launched, the dist exists (guarded above),
            # and the extension was handed to it on the command line. A missing
            # service worker here is a broken background.ts build turning the
            # repo's only extension coverage green. A missing browser or a
            # missing dist is an environment problem, and those are the cases
            # that stay a skip.
            pytest.fail(
                f"browser launched with --load-extension={EXT} but registered no "
                "service worker; the extension did not load (broken background "
                "bundle, or a Chrome build that ignores --load-extension)"
            )
