"""The relays' lazy DOM-attribute lookup — the only way to tell a password
field from an ordinary input, since `type` never crosses the AX tree.

Contract under test: one round trip per *typed action*, correlated by `ref`,
and {} on any failure. The consumer treats an unresolvable field as
redact-rather-than-write, so an honest empty dict is the correct failure and
raising would abort a type_text that was about to succeed.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.cdp import extension_relay  # noqa: E402
from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay, _to_semantic  # noqa: E402
from brotto_orchestrator.cdp.relay import CDPRelay  # noqa: E402

# ---------- backendNodeId reaches the semantic target ----------

def test_to_semantic_carries_backend_node_id():
    out = _to_semantic([{"ref": "7", "role": "textbox", "name": "Password",
                         "backendNodeId": 4242}])
    assert out[0].backend_node_id == 4242

def test_to_semantic_tolerates_missing_backend_node_id():
    out = _to_semantic([{"ref": "7", "role": "textbox", "name": "Email"}])
    assert out[0].backend_node_id is None

# ---------- request / response correlation ----------

def _relay(ws_send=None) -> ExtensionCDPRelay:
    return ExtensionCDPRelay(
        ws_send=ws_send or AsyncMock(),
        obs_queue=asyncio.Queue(),
        session_id="test",
    )

@pytest.mark.asyncio
async def test_get_attributes_sends_the_contract_wire_shape():
    """The extension task implements this exact message; a shape change here
    silently degrades redaction to the accessible-name check on their side."""
    relay = _relay()
    task = asyncio.create_task(relay.get_attributes(4242))
    await asyncio.sleep(0)  # let the request go out
    sent = relay._ws_send.await_args.args[0]
    assert sent["type"] == "get_attributes"
    assert sent["backend_node_id"] == 4242
    assert sent["ref"] and sent["ref"].startswith("attrs-")
    assert set(sent) == {"type", "backend_node_id", "ref"}
    await relay.deliver_attributes_result({"ref": sent["ref"], "attributes": {"type": "password"}})
    assert await task == {"type": "password"}

@pytest.mark.asyncio
async def test_get_attributes_matches_by_ref():
    """A result for another request must not answer this one."""
    relay = _relay()
    task = asyncio.create_task(relay.get_attributes(4242))
    await asyncio.sleep(0)
    await relay.deliver_attributes_result({"ref": "attrs-someoneelse", "attributes": {"type": "text"}})
    assert not task.done()  # a foreign result must not answer our lookup
    ref = relay._ws_send.await_args.args[0]["ref"]
    await relay.deliver_attributes_result({"ref": ref, "attributes": {"type": "password"}})
    assert await task == {"type": "password"}

@pytest.mark.asyncio
async def test_get_attributes_ignores_result_when_nothing_is_pending():
    """Late replies must be dropped, not queued for whoever asks next."""
    relay = _relay()
    await relay.deliver_attributes_result({"ref": "attrs-stale", "attributes": {"type": "password"}})
    assert relay._attrs.empty()

# ---------- failure paths: {} , never a raise ----------

@pytest.mark.asyncio
async def test_get_attributes_returns_empty_on_timeout(monkeypatch):
    monkeypatch.setattr(extension_relay, "_ATTRS_TIMEOUT", 0.05)
    relay = _relay()
    assert await relay.get_attributes(4242) == {}

@pytest.mark.asyncio
async def test_get_attributes_returns_empty_when_send_raises():
    ws_send = AsyncMock(side_effect=RuntimeError("socket closed"))
    relay = _relay(ws_send)
    assert await relay.get_attributes(4242) == {}

@pytest.mark.asyncio
async def test_get_attributes_without_node_id_never_asks():
    """No backendNodeId means no lookup is possible — don't spend a round
    trip, and don't invent a subject to fill the slot."""
    relay = _relay()
    assert await relay.get_attributes(None) == {}
    assert await relay.get_attributes(0) == {}
    relay._ws_send.assert_not_called()

@pytest.mark.asyncio
async def test_get_attributes_returns_empty_when_attributes_not_a_dict():
    relay = _relay()
    task = asyncio.create_task(relay.get_attributes(4242))
    await asyncio.sleep(0)
    ref = relay._ws_send.await_args.args[0]["ref"]
    await relay.deliver_attributes_result({"ref": ref, "attributes": "boom"})
    assert await task == {}

# ---------- Playwright side: DOM.getAttributes, same contract ----------

class _FakeSession:
    def __init__(self, response=None, error=None):
        self._response = response
        self._error = error
        self.calls: list[tuple] = []

    async def send(self, method, params=None):
        self.calls.append((method, params))
        if self._error:
            raise self._error
        return self._response

class _FakeContext:
    def __init__(self, session):
        self._session = session

    async def new_cdp_session(self, page):
        return self._session

class _FakePage:
    def __init__(self, session):
        self.context = _FakeContext(session)

class _FakeBrowser:
    def __init__(self, session):
        self.page = _FakePage(session)

@pytest.mark.asyncio
async def test_cdp_relay_get_attributes_flattens_the_cdp_list():
    session = _FakeSession({"attributes": ["type", "password", "id", "pw"]})
    relay = CDPRelay(_FakeBrowser(session))
    assert await relay.get_attributes(4242) == {"type": "password", "id": "pw"}
    assert session.calls == [("DOM.getAttributes", {"backendNodeId": 4242})]

@pytest.mark.asyncio
async def test_cdp_relay_get_attributes_returns_empty_on_protocol_error():
    relay = CDPRelay(_FakeBrowser(_FakeSession(error=RuntimeError("no node"))))
    assert await relay.get_attributes(4242) == {}

@pytest.mark.asyncio
async def test_cdp_relay_get_attributes_without_page_or_node_id():
    browser = _FakeBrowser(_FakeSession({"attributes": ["type", "password"]}))
    browser.page = None
    assert await CDPRelay(browser).get_attributes(4242) == {}
    assert await CDPRelay(_FakeBrowser(_FakeSession({}))).get_attributes(None) == {}
