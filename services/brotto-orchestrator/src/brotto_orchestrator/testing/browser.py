"""Playwright context with the real Brotto extension loaded."""

from __future__ import annotations

import contextlib
import pathlib
import tempfile
from typing import AsyncIterator

from playwright.async_api import BrowserContext, async_playwright


@contextlib.asynccontextmanager
async def brotto_browser(
    *, extension_dir: str, headless: bool = False
) -> AsyncIterator[BrowserContext]:
    """Launch Chrome with the extension and a throwaway profile.

    ponytail: a temp profile per launch. A persistent one would carry the
    previous fixture's session, so an 'authenticated' test could pass
    without ever logging in.

    No `channel=`: the installed Google Chrome 153 accepts --load-extension and
    then silently registers no service worker, whereas Playwright's bundled
    Chromium does. Callers that need the extension actually loaded must pass
    headless=False — headless never registers it, on either build.
    """
    ext = str(pathlib.Path(extension_dir).resolve())
    if not (pathlib.Path(ext) / "manifest.json").is_file():
        raise FileNotFoundError(
            f"no manifest.json under {ext} — run `npm run build` in "
            f"clients/brotto-extension first"
        )
    with tempfile.TemporaryDirectory(prefix="brotto-profile-") as profile:
        args = [
            f"--disable-extensions-except={ext}",
            f"--load-extension={ext}",
        ]
        async with async_playwright() as pw:
            # launch_persistent_context, not launch + new_context: Playwright
            # rejects --user-data-dir on launch(), and an MV3 extension only
            # loads into a persistent context anyway.
            ctx = await pw.chromium.launch_persistent_context(
                profile, headless=headless, args=args, no_viewport=True,
            )
            try:
                yield ctx
            finally:
                await ctx.close()
