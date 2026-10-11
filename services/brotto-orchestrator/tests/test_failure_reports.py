"""Failure reports: the closed shape, and the guarantee it exists to make.

The load-bearing test here is `test_the_payload_cannot_carry_a_task_or_a_page`.
It is the one that should fail loudly if somebody widens this payload later —
which is the failure mode the whole table is designed against, and the reason
`build_row` takes named scalars and **raises** on an unrecognised keyword
rather than filtering a request body.

`scripts/test-failure-reasons.test.js` is the other half: it enumerates every
`failure_reason` and client-side code out of the source and fails if one is
missing from `REPORTABLE`, so the closed set cannot quietly fall behind.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session import failure_report as fr
from brotto_orchestrator.session.jwt_auth import make_jwt

JWT_SECRET = "jwt-secret-for-tests"
USER_ID = "11111111-2222-3333-4444-555555555555"
OTHER_ID = "99999999-8888-7777-6666-555555555555"

# The things that must never reach the wire or the table. Used as a table by
# `test_the_payload_cannot_carry_a_task_or_a_page`.
PAGE_TEXT = "Order 4471 — card ending 4242, shipping to 12 Alder Road"
TASK = "find the invoice for my November electricity bill"


def _token(sub: str = USER_ID) -> str:
    return make_jwt({"sub": sub, "email": "beta@example.test", "exp": int(time.time()) + 3600}, JWT_SECRET)


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


@pytest.fixture(autouse=True)
def _fresh_buckets():
    """Empty the report limiter before and after every test.

    Imported *inside* the fixture, not aliased at module scope:
    `test_failure_modes.py` deletes every `brotto_orchestrator` entry from
    `sys.modules` and re-imports, so a module-level alias names the pre-purge
    module while `main` looks the bucket up on the post-purge one. Clearing the
    stale dict then clears nothing, and the next test gets a 429 it did not
    earn. The same trap is why conftest's `_fresh_signin_buckets` imports
    inside the fixture too.
    """
    from brotto_orchestrator.session import failure_report as fresh

    fresh._REPORT_BUCKETS.clear()
    fresh._REPORT_SWEEP_AT = 0.0
    yield
    fresh._REPORT_BUCKETS.clear()
    fresh._REPORT_SWEEP_AT = 0.0


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


# ── the boundary ──────────────────────────────────────────────────────────

def test_a_row_is_exactly_the_columns():
    row = fr.build_row(code="offline", stage="connect", side="client",
                       owner=USER_ID, ext_version="1.2.3")
    assert row is not None
    assert set(row) == set(fr.COLUMNS), "a column nobody wrote a reason for"
    assert row["ext_version"] == "1.2.3"


def test_carrying_a_task_raises_rather_than_being_filtered():
    """The whole point. A `**extra` swallow here would make every future
    field an accident rather than a decision."""
    with pytest.raises(ValueError):
        fr.build_row(code="offline", stage="connect", side="client",
                     owner=USER_ID, task=TASK)


def test_a_code_outside_the_vocabulary_is_dropped():
    """A free-text reason here would put the agent's own prose — which can
    quote the page — into a table we hold forever."""
    assert fr.build_row(code=PAGE_TEXT, stage="connect", side="client", owner=USER_ID) is None
    assert fr.build_row(code="something_the_operator_just_made_up", stage="connect",
                        side="client", owner=USER_ID) is None


def test_a_server_code_cannot_ride_the_client_stage():
    row = fr.build_row(code="offline", stage="task_refused", side="client", owner=USER_ID)
    assert row is None, "a client report claims where a run failed; it never ran"


def test_a_client_code_cannot_ride_the_server_stage():
    assert fr.build_row(code="offline", stage="task_refused", side="server", owner=USER_ID) is None




# ── self-host sends nothing, ever ─────────────────────────────────────────

def test_self_host_never_reports(monkeypatch):
    for secret in (None, "s3cret"):
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        if secret:
            monkeypatch.setenv("AGENT_SECRET", secret)
        else:
            monkeypatch.delenv("AGENT_SECRET", raising=False)
        assert fr.reporting_enabled() is False


def test_the_operator_can_switch_it_off_on_the_relay(monkeypatch, hosted):
    assert fr.reporting_enabled() is True
    monkeypatch.setenv("BROTTO_FAILURE_REPORTING", "off")
    assert fr.reporting_enabled() is False


def test_a_self_host_relay_answers_404(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    resp = client.post("/v1/reports", json={"reports": [{"code": "offline"}]},
                       headers={"Authorization": "Bearer s3cret"})
    assert resp.status_code == 404


# ── the endpoint ──────────────────────────────────────────────────────────

def test_a_bad_credential_is_404_not_403(client, hosted):
    assert client.post("/v1/reports", json={"reports": []}).status_code == 404
    assert client.post("/v1/reports", json={"reports": []},
                       headers={"Authorization": "Bearer wrong"}).status_code == 404


def test_a_report_carries_no_identity_field(client, hosted):
    """The client never says who it is; the relay reads it off the token."""
    body = client.post("/v1/reports",
                       json={"reports": [{"code": "offline", "ext_version": "1.0.0"}]},
                       headers={"Authorization": f"Bearer {_token()}"}).json()
    assert body == {"accepted": 1}
    row = fr.build_row(code="offline", stage="connect", side="client",
                       owner=USER_ID, ext_version="1.0.0")
    assert "user_id" not in row and "email" not in row


def test_the_kept_count_is_the_answer_not_the_codes(client, hosted):
    """Echoing codes back would make this an "what does the relay accept"
    oracle; offered-vs-kept is what an operator debugging a missing row wants."""
    resp = client.post("/v1/reports",
                       json={"reports": [{"code": "offline"}, {"code": "from_the_future"}]},
                       headers={"Authorization": f"Bearer {_token()}"})
    assert resp.json() == {"accepted": 1}
    assert "offline" not in resp.text and "from_the_future" not in resp.text


def test_one_bad_install_cannot_write_a_row_per_reconnect(client, hosted):
    """A laptop that sleeps through an outage wakes up and reconnects. Rate
    limited at the relay, so the limit has to be here and not only client-side."""
    hdr = {"Authorization": f"Bearer {_token()}"}
    statuses = [client.post("/v1/reports", json={"reports": [{"code": "offline"}]},
                            headers=hdr).status_code for _ in range(int(fr._REPORT_CAPACITY) + 5)]
    assert statuses[-1] == 429
    assert set(statuses) == {200, 429}


def test_a_malformed_body_is_a_400_not_a_500(client, hosted):
    resp = client.post("/v1/reports", content=b"{not json",
                       headers={"Authorization": f"Bearer {_token()}",
                                "Content-Type": "application/json"})
    assert resp.status_code == 400


def test_a_body_that_is_not_a_list_is_empty_not_an_error(client, hosted):
    hdr = {"Authorization": f"Bearer {_token()}"}
    assert client.post("/v1/reports", json={"reports": "everything"}, headers=hdr).json() == {"accepted": 0}
    assert client.post("/v1/reports", json={}, headers=hdr).json() == {"accepted": 0}


# ── THE guarantee ─────────────────────────────────────────────────────────

def test_the_payload_cannot_carry_a_task_or_a_page(client, hosted):
    """Post every forbidden field the extension might plausibly grow into,
    and assert none of it reaches a stored row.

    An over-wide body is silently ignored by `build_client_rows` because the
    function has no parameter for it — not because it filtered it. Widen the
    function and this test fails, which is the point.
    """
    hostile = {
        "reports": [{
            "code": "offline",
            "ext_version": "1.0.0",
            # Everything below is a plausible future field, and none of it
            # is a field the relay reads.
            "task": TASK,
            "task_title": TASK[:40],
            "summary": PAGE_TEXT,
            "url": "https://mail.google.com/mail/u/0/#inbox/4471",
            "domain": "mail.google.com",
            "page_text": PAGE_TEXT,
            "typed": "4242 4242 4242 4242",
            "session_id": "0f9a2b1c-3d4e-5f60-8a9b-0c1d2e3f4a5b",
            "device_id": "11111111-2222-3333-4444-555555555555",
            "email": "beta@example.test",
            "user_id": OTHER_ID,
            "api_key": "sk-ant-whatever",
        }]
    }
    resp = client.post("/v1/reports", json=hostile, headers={"Authorization": f"Bearer {_token()}"})
    assert resp.json() == {"accepted": 1}

    rows, offered = fr.build_client_rows(hostile, USER_ID, "2.0.0")
    assert offered == 1
    assert len(rows) == 1
    blob = repr(rows[0])
    for forbidden in (TASK, "mail.google.com", "4242", "beta@example.test",
                      "sk-ant", "0f9a2b1c", OTHER_ID, PAGE_TEXT):
        assert forbidden not in blob, f"{forbidden!r} reached the stored row"
    # And the identity is the relay's, read off the token — never the
    # `user_id` the body offered.
    assert rows[0]["owner"] == USER_ID


def test_ext_version_cannot_be_used_as_a_channel(client, hosted):
    """The one client-controlled string on the table, and the only place a
    payload could ride that the shape rules do not otherwise cover.

    `ext_version` is client-supplied by design — it is how an operator knows
    which build emitted a code — so the alphabet is the boundary rather than
    the name. Truncating left 32 characters of whatever was sent, in the one
    column a human reads, and `failure_reports` is a durable sink: a column is
    not content until somebody reads it.
    """
    forbidden = [TASK, PAGE_TEXT, "https://mail.google.com/mail/u/0/#inbox/4471",
                 "beta@example.test", "hello world",
                 "1.0.0\r\nX-Injected: 1", "v" * 500, "1/2;3",
                 "1.0.0 <script>", "{'task': 'x'}", "a" * 200]
    for value in forbidden:
        rows, offered = fr.build_client_rows(
            {"reports": [{"code": "offline", "ext_version": value}]}, USER_ID)
        assert offered == 1, value
        # Empty, not truncated: 32 characters of what was sent is still what
        # was sent, in the one column a human reads.
        assert rows[0]["ext_version"] == "", f"{value!r} reached the row"


def test_the_alphabet_is_a_shape_not_a_vocabulary():
    """What the guard actually buys, stated so it is not over-sold.

    `[0-9A-Za-z][0-9A-Za-z.+-]{0,31}` removes free text: whitespace, newlines,
    quotes, URLs with a scheme, braces, and anything over 32 characters. It
    does not stop a caller writing `sk-ant-whatever` — that is inside the
    alphabet, and it is the ceiling. It is the right ceiling here: the client
    is the user's own extension, `code` is the closed set the operator
    actually reads, and this is a bounded nuisance in a supplementary column
    rather than a channel. Anything tighter starts guessing which builds exist,
    which is a filter a later commit widens — the shape this table is built
    on is `build_row` having no parameter for a task, not how well a string
    is recognised.
    """
    assert fr.clean_version("sk-ant-whatever") == "sk-ant-whatever"
    assert len(fr.clean_version("a" * 500)) == 0
    assert fr.clean_version("the operator's notes") == ""


def test_a_real_version_still_gets_through():
    """The closed alphabet is the whole cost; spellings that are actually
    versions must survive it."""
    for value in ("1.0.0", "2", "v3", "0.1.2-beta.1", "1.0.0+build.7", "2.0.0",
                  " 1.0.0 "):
        assert fr.clean_version(value) == value.strip(), value
    # Non-strings and empty are absence, not a version.
    assert fr.clean_version(None) == ""
    assert fr.clean_version(123) == ""
    assert fr.clean_version("") == ""


def test_the_oversized_version_is_dropped_not_truncated():
    """It used to truncate; a 500-character version string's first 32
    characters are not a version either, and keeping the truncation meant the
    test below asserted the weaker of the two guarantees."""
    row = fr.build_row(code="offline", stage="connect", side="client", owner=USER_ID,
                       ext_version="v" * 500)
    assert row["ext_version"] == ""


def test_a_client_cannot_claim_another_account(client, hosted):
    """The body carries `user_id` for a different person; the row must name
    the token's subject."""
    rows, _ = fr.build_client_rows(
        {"reports": [{"code": "offline", "user_id": OTHER_ID}]}, USER_ID)
    assert rows[0]["owner"] == USER_ID != OTHER_ID


def test_connection_lost_is_reported_as_mid_task():
    """`build_client_rows` stamped `stage="connect"` on every client code.

    `CONNECTION_LOST` is not a connect failure: `background.ts` queues it from
    `cleanup()` and only inside `lost`, which is `taskInFlight &&
    !taskTerminalEmitted` — the socket died with a run in progress. Filed
    under `connect`, every one of those rows claimed the socket died before
    the run it was reported *about*, which is the single question the stage
    column exists to answer.
    """
    rows, _ = fr.build_client_rows({"reports": [{"code": "CONNECTION_LOST"}]}, USER_ID)
    assert rows[0]["stage"] == "task"
    assert rows[0]["stage"] in fr.CLIENT_STAGE


def test_the_handshake_codes_are_still_connect_stage():
    """The other four are raised around the handshake, before a run exists."""
    for code in sorted(fr.CLIENT_CODES - {"CONNECTION_LOST"}):
        rows, _ = fr.build_client_rows({"reports": [{"code": code}]}, USER_ID)
        assert rows[0]["stage"] == "connect", code


def test_every_client_code_has_a_stage():
    """An omission here is an absence, and an absence reads clean in review:
    the code would fall back to `connect` and be wrong for whoever adds it."""
    assert set(fr.CLIENT_CODE_STAGE) == set(fr.CLIENT_CODES)
    assert set(fr.CLIENT_CODE_STAGE.values()) <= fr.CLIENT_STAGE


def test_a_server_failure_cannot_ride_the_task_stage():
    """`task` is a client stage now, so the two halves have to stay disjoint."""
    assert fr.build_row(code="cannot_complete", stage="task", side="server",
                        owner=USER_ID) is None


def test_a_batch_is_capped(client, hosted):
    """One bad install, capped here as well as at the rate limiter — a single
    request must not be a way to write five hundred rows."""
    rows, offered = fr.build_client_rows(
        {"reports": [{"code": "offline"}] * 500}, USER_ID)
    assert offered == fr.MAX_PER_REQUEST
    assert len(rows) == fr.MAX_PER_REQUEST


# ── the relay's own failures ──────────────────────────────────────────────

def test_a_server_side_failure_is_a_code_and_never_the_summary(monkeypatch, hosted):
    seen: list[dict] = []
    monkeypatch.setattr(fr, "spawn", lambda coro: coro.close())
    monkeypatch.setattr(fr, "record", lambda rows: seen.extend(rows) or asyncio_sleep())
    from brotto_orchestrator.session.jwt_auth import Claims

    claims = Claims(sub=USER_ID, email="beta@example.test")
    fr.note_failure("cannot_complete", "task_result", claims)
    assert seen and seen[0]["code"] == "cannot_complete"
    assert seen[0]["side"] == "server"
    assert set(seen[0]) == set(fr.COLUMNS)


def asyncio_sleep():
    """A coroutine for the stubbed `spawn` to close."""
    async def _noop():
        return None

    return _noop()


def test_note_failure_is_a_no_op_off_the_relay(monkeypatch):
    from brotto_orchestrator.session.jwt_auth import Claims

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    called = []
    monkeypatch.setattr(fr, "spawn", lambda coro: (coro.close(), called.append(1)))
    fr.note_failure("internal", "task_error", Claims(sub=USER_ID, email="x@example.test"))
    assert called == [], "a self-host relay wrote a failure report"


def test_note_failure_without_a_claim_writes_nothing(monkeypatch, hosted):
    """`owner` comes off a verified token or not at all — never from a body
    field, and never as None."""
    called = []
    monkeypatch.setattr(fr, "spawn", lambda coro: (coro.close(), called.append(1)))
    fr.note_failure("internal", "task_error", None)
    assert called == []