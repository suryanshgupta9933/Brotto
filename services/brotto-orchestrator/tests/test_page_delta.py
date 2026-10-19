"""The page delta: the gate, the pass-through, and the absence.

A delta is derived from a captured viewport — the extension decodes the frame
locally and diffs it — so it is page-derived data arriving through a route the
capture gate does not see. `screenshot_block_reason` is asked here for exactly
that reason, and `None` for a refused domain is the whole of the guarantee.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay
from brotto_orchestrator.policy.schema import Policy


def _relay(obs: dict) -> ExtensionCDPRelay:
    relay = ExtensionCDPRelay(
        ws_send=AsyncMock(), obs_queue=asyncio.Queue(), session_id="test",
    )
    relay._cached_obs = obs
    return relay


DELTA = {
    "changed": True,
    "tiles": [{"x": 64, "y": 64, "w": 32, "h": 32, "pct": 14.4}],
}


@pytest.fixture(autouse=True)
def _capture_on(monkeypatch):
    monkeypatch.setenv("BROTTO_VISION_CAPTURE", "on")


@pytest.mark.asyncio
async def test_a_delta_on_a_blocked_domain_never_reaches_the_caller():
    relay = _relay({"url": "https://www.bank.com/login", "delta": DELTA})
    policy = Policy(blacklist=["*.bank.com"])
    assert await relay.get_page_delta(policy) is None


@pytest.mark.asyncio
async def test_capture_being_off_withholds_it_too(monkeypatch):
    """The delta comes from the same pixels. A gate that checked the domain
    but not the switch would be a second, wider route to the same content."""
    monkeypatch.delenv("BROTTO_VISION_CAPTURE", raising=False)
    relay = _relay({"url": "https://example.com/", "delta": DELTA})
    assert await relay.get_page_delta(Policy()) is None


@pytest.mark.asyncio
async def test_a_delta_on_an_allowed_domain_passes_through_with_its_tiles():
    relay = _relay({"url": "https://docs.google.com/spreadsheets/d/1", "delta": DELTA})
    got = await relay.get_page_delta(Policy(blacklist=["*.bank.com"]))
    assert got == DELTA
    assert got["tiles"][0]["pct"] == 14.4


@pytest.mark.asyncio
async def test_an_observation_with_no_delta_is_handled_without_raising():
    """First observation, navigation and resize all omit the key. Those are
    three of the most common moments in an ordinary run."""
    relay = _relay({"url": "https://example.com/", "axTargets": []})
    assert await relay.get_page_delta(Policy()) is None


@pytest.mark.asyncio
async def test_a_malformed_tile_is_dropped_rather_than_half_repaired():
    relay = _relay({"url": "https://example.com/",
                    "delta": {"changed": True,
                              "tiles": [{"x": "64", "y": 0, "w": 32, "h": 32, "pct": 1}]}})
    assert await relay.get_page_delta(Policy()) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [
    {"redactions": {"email": 1}},
    {"run_secrets": ["hunter2"]},
])
async def test_a_page_holding_a_typed_secret_is_not_diffed(kwargs):
    """The capture's veto, and it applies to the same pixels. Nothing is
    persisted today, but the gate must not depend on the returned value
    staying just rectangles and a boolean as the file changes."""
    relay = _relay({"url": "https://example.com/", "delta": DELTA})
    assert await relay.get_page_delta(Policy(), **kwargs) is None
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_an_empty_redactions_list_is_not_a_veto():
    """The boundary's other end. `redactions` empty means no detector fired,
    not that the page is clean — but it is not a reason to refuse either, and
    refusing here would silently strand every page."""
    relay = _relay({"url": "https://example.com/", "delta": DELTA})
    assert await relay.get_page_delta(Policy(), redactions={}, run_secrets=[]) == DELTA