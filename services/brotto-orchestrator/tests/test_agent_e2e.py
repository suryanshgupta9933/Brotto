"""E2E smoke test: agent harness with TestModel (no real LLM calls)."""

import asyncio
import os
import pytest
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("ANTHROPIC_API_KEY", "test")
os.environ.setdefault("AGENT_AUTH_DISABLED", "true")
os.environ.setdefault("AGENT_MODEL", "test")  # use pydantic_ai TestModel


@pytest.mark.asyncio
async def test_stagnation_detector():
    from brotto_orchestrator.agent.stagnation import check_stagnation
    from brotto_orchestrator.agent.context import StepSummary

    steps = [
        StepSummary(step=i, url="http://same.com", action_taken="click(btn)", outcome="nothing")
        for i in range(3)
    ]
    stagnated, reason = check_stagnation(steps, window=3)
    assert stagnated
    assert "same.com" in reason


@pytest.mark.asyncio
async def test_no_stagnation_with_progress():
    from brotto_orchestrator.agent.stagnation import check_stagnation
    from brotto_orchestrator.agent.context import StepSummary

    steps = [
        StepSummary(step=0, url="http://a.com", action_taken="click(x)", outcome="ok"),
        StepSummary(step=1, url="http://b.com", action_taken="click(y)", outcome="ok"),
        StepSummary(step=2, url="http://c.com", action_taken="click(z)", outcome="ok"),
    ]
    stagnated, _ = check_stagnation(steps, window=3)
    assert not stagnated


def test_login_guardrail():
    from brotto_orchestrator.agent.guardrails import check_login_page

    # Title alone is authoritative.
    assert check_login_page("Sign In", "", "")
    # AX strong marker + URL corroboration (login path) → fires.
    assert check_login_page("Dashboard", "password textbox", "https://app.com/login")
    # AX strong marker + title corroboration → fires.
    assert check_login_page("Sign In", "password textbox", "https://app.com/home")
    # AX strong marker alone (no title/URL corroboration) → does NOT fire.
    # This is the Gmail/Google-search false-positive guard: "password"
    # appearing in the AX tree by itself is treated as incidental.
    assert not check_login_page("Dashboard", "password textbox", "https://app.com/home")
    # Nothing login-ish.
    assert not check_login_page("Dashboard", "welcome", "http://app.com/home")


def test_login_guardrail_gmail_google_false_positive():
    """Regression: Google Search has 'password' in AX (password manager
    UI) and Gmail has 'oauth' (analytics tags), but neither is a login
    page. The old heuristic fired on those markers alone and prompted
    the user to sign in mid-task on already-signed-in Gmail.
    """
    from brotto_orchestrator.agent.guardrails import check_login_page

    # Google search page — password manager surfaces a "password" button.
    google_ax = (
        '[1] button "Google apps" '
        '[2] link "Sign in" '
        '[3] combobox "Search" '
        '[4] button "Use password manager to autofill"'
    )
    assert not check_login_page("Google", google_ax, "https://www.google.com/")

    # Gmail signed-in inbox — OAuth mentions in integration cards.
    gmail_ax = (
        '[1] link "Compose" '
        '[2] link "Inbox" '
        '[3] button "Connected via OAuth to Calendar" '
        '[4] button "Sign in to another account"'
    )
    assert not check_login_page(
        "Inbox - user@gmail.com - Gmail",
        gmail_ax,
        "https://mail.google.com/mail/u/0/#inbox",
    )


def test_login_guardrail_second_factor():
    """2FA / OTP is still logging in, so the agent must keep waiting.

    The second factor arrives on its own page after the password was
    already accepted. If only the password step is detected, the agent
    resumes into a verification prompt it has no way to answer.
    """
    from brotto_orchestrator.agent.guardrails import check_login_page

    # Title flavours of a verification step.
    assert check_login_page("Two-Factor Authentication", "", "")
    assert check_login_page("Verify your identity", "", "")
    assert check_login_page("One-Time Password", "", "")
    assert check_login_page("Enter the code", "", "")
    assert check_login_page("Check your phone", "", "")

    # URL flavours — the password step already succeeded, so the path is
    # no longer /login but the flow is still mid-authentication.
    assert check_login_page("Dashboard", "", "https://app.com/two-factor")
    assert check_login_page("Dashboard", "", "https://app.com/challenge")
    assert check_login_page("Dashboard", "", "https://app.com/passcode")

    # Sign-up leaves the user mid-authentication too, with nothing the
    # agent can usefully click.
    assert check_login_page("Create account", "", "")
    assert check_login_page("Dashboard", "", "https://app.com/signup")

    # Email/account verification is caught by its title, not by a broad
    # "/verif" URL fragment (which also matches /guides/verify-your-backup).
    assert check_login_page("Verify your email address", "", "")

    # Content force-trigger: unambiguous on any site, no title/URL needed.
    assert check_login_page("Acme Portal", "Enter the code from your authenticator app", "")
    assert check_login_page("Acme Portal", "We sent a one-time passcode by SMS", "")
    assert check_login_page("Acme Portal", "[1] textbox 'Verification code'", "")

    # Session expired mid-page still force-triggers.
    assert check_login_page("Acme Portal", "Your session has expired. Please sign in.", "")


def test_login_guardrail_does_not_fire_on_ordinary_pages():
    """The 2FA markers must not cost us the Gmail/Google false-positive guard.

    These are the words that made a general content scan untenable.
    """
    from brotto_orchestrator.agent.guardrails import check_login_page

    # "security code" is a card CVV at checkout, not a second factor.
    assert not check_login_page("Checkout", "[1] textbox 'Security code' [2] Pay", "")
    # Ordinary product copy containing "verify".
    assert not check_login_page("Docs", "[1] paragraph 'Verify your backup settings'", "")
    # A docs route that merely contains "verify" — the reason there is no
    # "/verif" entry in LOGIN_URL_PATTERNS.
    assert not check_login_page("Docs", "[1] heading 'Verify your backup'", "https://docs.example.com/guides/verify-your-backup")
    # A signed-in settings page that happens to mention 2FA setup.
    assert not check_login_page(
        "Security settings",
        "[1] heading 'Two-factor authentication' [2] button 'Turn off'",
        "https://app.com/settings/security",
    )
    # Plain app page, nothing auth-flavoured.
    assert not check_login_page("Inbox", "[1] link 'Compose' [2] link 'Inbox'", "https://app.com/")
    # Event registration and "join a call" are not account creation.
    assert not check_login_page("Register for the webinar", "", "https://events.example.com/register")
    assert not check_login_page("Join the meeting", "", "https://app.slack.com/call")


def test_critical_action_guardrail():
    from brotto_orchestrator.agent.guardrails import check_critical_action

    assert check_critical_action("click", {"description": "delete account"})
    assert check_critical_action("click", {"description": "confirm payment"})
    assert not check_critical_action("click", {"ref": "btn_save", "description": "save draft"})


@pytest.mark.asyncio
async def test_approval_card_never_leaks_internals():
    """A card must name the action, not the tool, and must not carry the
    model's private narration.

    Regression from a real run: an `append_scratchpad` note reading "…to
    confirm star counts." raised a card on the word "confirm", and the
    card body showed the tool name plus a line of reasoning that opened
    with "the stars count isn't shown directly in the AX tree" — the
    system prompt marks `reasoning` as never-shown, and an approval card
    is a place the user reads verbatim.
    """
    from pydantic_ai.models.test import TestModel
    from brotto_orchestrator.agent.harness import AgentHarness, _NEVER_APPROVE
    import brotto_orchestrator.agent.harness as harness_mod
    from brotto_orchestrator.agent.context import AgentDeps, AgentDecision
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="btn_ok", tag="button", role="button", name="OK")]
    )
    cdp.get_current_url = AsyncMock(return_value="http://example.com")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Example Page")
    cdp.refresh_target_map = AsyncMock()

    messages: list[dict] = []

    async def ws_send(msg):
        messages.append(msg)

    deps = AgentDeps(
        user_id="test",
        task="Check the repository stars",
        cdp=cdp,
        ws_send=ws_send,
        human_input_queue=asyncio.Queue(),
    )

    # Only the note trips CRITICAL_PATTERNS — no real action in the batch.
    test_agent = harness_mod.agent.__class__(
        TestModel(
            custom_output_args={
                "reasoning": "The stars count isn't shown directly in the AX tree.",
                "thought": "Reading around the stars figure.",
                "actions": [
                    {"action": "append_scratchpad", "action_args": {
                        "line": "Reading the repository list to confirm star counts."}},
                ],
            },
        ),
        output_type=AgentDecision,
        deps_type=AgentDeps,
        system_prompt=harness_mod.SYSTEM_PROMPT,
    )
    original = harness_mod.agent
    harness_mod.agent = test_agent
    try:
        h = AgentHarness()
        run_task = asyncio.create_task(h.run(deps))
        deadline = asyncio.get_event_loop().time() + 2.0
        while asyncio.get_event_loop().time() < deadline:
            cards = [m for m in messages if m.get("type") == "approval_required"]
            if cards or run_task.done():
                break
            await asyncio.sleep(0.05)
        run_task.cancel()
        try:
            await run_task
        except (asyncio.CancelledError, Exception):
            pass
    finally:
        harness_mod.agent = original

    # The note alone must not raise a card.
    assert not [m for m in messages if m.get("type") == "approval_required"], (
        "a scratchpad note containing 'confirm' must not raise an approval card"
    )
    assert "append_scratchpad" in _NEVER_APPROVE


@pytest.mark.asyncio
async def test_approval_card_body_is_human_readable():
    """A genuine critical action still fires — and the card says what in
    plain words, with the model's narration left out."""
    from pydantic_ai.models.test import TestModel
    from brotto_orchestrator.agent.harness import AgentHarness
    import brotto_orchestrator.agent.harness as harness_mod
    from brotto_orchestrator.agent.context import AgentDeps, AgentDecision
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="btn_del", tag="button", role="button", name="Delete account")]
    )
    cdp.get_current_url = AsyncMock(return_value="http://example.com/account")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Account")
    cdp.refresh_target_map = AsyncMock()
    cdp.click_ref = AsyncMock(return_value="clicked")

    messages: list[dict] = []
    q: asyncio.Queue = asyncio.Queue()
    for _ in range(4):
        q.put_nowait("yes")

    async def ws_send(msg):
        messages.append(msg)

    deps = AgentDeps(
        user_id="test",
        task="delete the account, ask first",
        cdp=cdp,
        ws_send=ws_send,
        human_input_queue=q,
    )

    test_agent = harness_mod.agent.__class__(
        TestModel(
            custom_output_args={
                "reasoning": "ref btn_del matches CRITICAL_PATTERNS in the AX tree dump.",
                "thought": "Deleting the account.",
                "actions": [
                    {"action": "click", "action_args": {
                        "ref": "btn_del", "description": "Delete account"}},
                ],
            },
        ),
        output_type=AgentDecision,
        deps_type=AgentDeps,
        system_prompt=harness_mod.SYSTEM_PROMPT,
    )
    original = harness_mod.agent
    harness_mod.agent = test_agent
    try:
        h = AgentHarness()
        run_task = asyncio.create_task(h.run(deps))
        deadline = asyncio.get_event_loop().time() + 2.0
        while asyncio.get_event_loop().time() < deadline:
            if any(m.get("type") == "step_progress" for m in messages):
                break
            await asyncio.sleep(0.05)
        run_task.cancel()
        try:
            await run_task
        except (asyncio.CancelledError, Exception):
            pass
    finally:
        harness_mod.agent = original

    cards = [m for m in messages if m.get("type") == "approval_required"]
    assert cards, "a real critical click must still ask"
    card = cards[0]
    assert card["action"] == "Delete account"          # not "click"
    assert "AX tree" not in card["reasoning"]            # narration excluded
    assert "CRITICAL_PATTERNS" not in card["reasoning"]
    assert "Deleting the account." in card["reasoning"]  # thought carried instead


def test_ax_filter():
    from brotto_orchestrator.agent.ax_filter import filter_ax_targets
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    targets = [
        SemanticTarget(ref_id="btn_1", tag="button", role="button", name="Submit"),
        SemanticTarget(ref_id="lnk_1", tag="a", role="link", name="Home"),
        SemanticTarget(ref_id="gen_1", tag="div", role="generic", name=""),
        SemanticTarget(ref_id="txt_1", tag="input", role="textbox", name="Email"),
    ]
    result = filter_ax_targets(targets)
    assert "btn_1" in result
    assert "lnk_1" in result
    assert "txt_1" in result
    assert "gen_1" not in result  # stripped generic with no name


@pytest.mark.asyncio
async def test_harness_completes_with_test_model():
    """Harness should run + return result when agent calls task_complete."""
    from pydantic_ai.models.test import TestModel
    from brotto_orchestrator.agent.harness import AgentHarness, _turn_to_prompt
    from brotto_orchestrator.agent.context import AgentDeps, AgentDecision, Scratchpad

    # Build a fake CDPRelay
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    fake_target = SemanticTarget(ref_id="btn_ok", tag="button", role="button", name="OK")

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[fake_target])
    cdp.get_current_url = AsyncMock(return_value="http://example.com")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Example Page")
    cdp.refresh_target_map = AsyncMock()

    messages = []

    async def ws_send(msg):
        messages.append(msg)

    deps = AgentDeps(
        user_id="test",
        task="Check that http://example.com loads",
        cdp=cdp,
        ws_send=ws_send,
    )

    # Patch the global agent to use TestModel with a canned task_complete decision
    import brotto_orchestrator.agent.harness as harness_mod
    original_agent = harness_mod.agent

    test_agent = harness_mod.agent.__class__(
        TestModel(
            custom_output_args={
                "reasoning": "Page loaded successfully",
                "thought": "Page loaded",
                "actions": [
                    {"action": "task_complete", "action_args": {"summary": "Page loaded", "extracted_data": None}},
                ],
            },
        ),
        output_type=AgentDecision,
        deps_type=AgentDeps,
        system_prompt=harness_mod.SYSTEM_PROMPT,
    )
    harness_mod.agent = test_agent

    try:
        h = AgentHarness()
        result = await h.run(deps)
        assert result.status == "completed"
        # Was 0: task_complete stamped the 0-indexed deps.step_number. The
        # abort gate now stamps steps_run, so a one-step run reports 1.
        assert result.steps_taken == 1
        # progress event was sent
        assert any(m.get("type") == "step_progress" for m in messages)
    finally:
        harness_mod.agent = original_agent


@pytest.mark.asyncio
async def test_harness_blocks_on_approval_when_queue_is_empty():
    """Diagnose the approval_gate stall.

    When the agent emits a critical action, the harness sends
    `approval_required` and then `await human_input_queue.get()` with
    no timeout. With an empty queue the run stalls; the benchmark
    runner's outer wait_for(timeout=120) is what surfaces this as a
    timeout error. Confirms the runner must pre-seed the queue for
    `requires_approval` tasks.
    """
    from pydantic_ai.models.test import TestModel
    from brotto_orchestrator.agent.harness import AgentHarness
    import brotto_orchestrator.agent.harness as harness_mod
    from brotto_orchestrator.agent.context import AgentDeps, AgentDecision
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="btn_del", tag="button", role="button", name="Delete account")]
    )
    cdp.get_current_url = AsyncMock(return_value="http://example.com/account")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Account")
    cdp.refresh_target_map = AsyncMock()
    cdp.click_ref = AsyncMock(return_value="clicked")
    cdp.get_targets_after = cdp.get_targets

    messages: list[dict] = []
    q: asyncio.Queue = asyncio.Queue()  # intentionally empty

    async def ws_send(msg):
        messages.append(msg)

    deps = AgentDeps(
        user_id="test",
        task="delete the account, ask first",
        cdp=cdp,
        ws_send=ws_send,
        human_input_queue=q,
    )

    test_agent = harness_mod.agent.__class__(
        TestModel(
            custom_output_args={
                "reasoning": "destructive action",
                "thought": "clicking delete",
                "actions": [
                    {"action": "click", "action_args": {"ref": "btn_del", "description": "delete account"}},
                ],
            },
        ),
        output_type=AgentDecision,
        deps_type=AgentDeps,
        system_prompt=harness_mod.SYSTEM_PROMPT,
    )
    original = harness_mod.agent
    harness_mod.agent = test_agent
    try:
        h = AgentHarness()
        # short timeout proves the stall — no sentinel = blocks forever
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(h.run(deps), timeout=0.5)
        # The approval_required frame DID go out before the stall.
        assert any(m.get("type") == "approval_required" for m in messages), (
            "harness should have sent approval_required before blocking on the queue"
        )
    finally:
        harness_mod.agent = original


@pytest.mark.asyncio
async def test_harness_unblocks_when_approval_sentinel_is_queued():
    """End-to-end: a sentinel 'yes' on the queue unblocks the harness
    and lets the run complete normally. This is what the benchmark
    runner must do for tasks with `requires_approval=True`.
    """
    from pydantic_ai.models.test import TestModel
    from brotto_orchestrator.agent.harness import AgentHarness
    import brotto_orchestrator.agent.harness as harness_mod
    from brotto_orchestrator.agent.context import AgentDeps, AgentDecision
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="btn_del", tag="button", role="button", name="Delete account")]
    )
    cdp.get_current_url = AsyncMock(return_value="http://example.com/account")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Account")
    cdp.refresh_target_map = AsyncMock()
    cdp.click_ref = AsyncMock(return_value="clicked")

    messages: list[dict] = []
    q: asyncio.Queue = asyncio.Queue()
    # Pre-seed the approval reply BEFORE the harness runs — same pattern
    # the benchmark runner should use for requires_approval tasks.
    # TestModel re-emits the same critical action every step, so we need
    # a sentinel ready for each iteration (capped by max_steps=4).
    for _ in range(4):
        q.put_nowait("yes")

    async def ws_send(msg):
        messages.append(msg)

    deps = AgentDeps(
        user_id="test",
        task="delete the account, ask first",
        cdp=cdp,
        ws_send=ws_send,
        human_input_queue=q,
    )

    test_agent = harness_mod.agent.__class__(
        TestModel(
            custom_output_args={
                "reasoning": "destructive action",
                "thought": "clicking delete",
                "actions": [
                    {"action": "click", "action_args": {"ref": "btn_del", "description": "delete account"}},
                ],
            },
        ),
        output_type=AgentDecision,
        deps_type=AgentDeps,
        system_prompt=harness_mod.SYSTEM_PROMPT,
    )
    original = harness_mod.agent
    harness_mod.agent = test_agent
    try:
        h = AgentHarness()
        # Run in the background; we only need to assert the harness
        # progressed PAST the approval gate (click ran) without stalling.
        # We don't drive the full 30-step loop — TestModel re-emits the
        # same click until stagnation or max_steps, which isn't what
        # we're testing here.
        run_task = asyncio.create_task(h.run(deps))

        # Wait for the first approval_required frame, then for the
        # subsequent step_progress (proves the click executed).
        deadline = asyncio.get_event_loop().time() + 2.0
        while asyncio.get_event_loop().time() < deadline:
            if any(m.get("type") == "step_progress" for m in messages):
                break
            await asyncio.sleep(0.05)
        else:
            run_task.cancel()
            raise AssertionError("harness stalled — no step_progress after approval sentinel")

        # Approval frame went out and the click ran through the gate.
        assert any(m.get("type") == "approval_required" for m in messages)

        run_task.cancel()
        try:
            await run_task
        except (asyncio.CancelledError, Exception):
            pass
    finally:
        harness_mod.agent = original


if __name__ == "__main__":
    # Quick self-check without pytest
    asyncio.run(test_harness_completes_with_test_model())
    test_stagnation_detector.__wrapped__ = None
    asyncio.run(test_stagnation_detector())
    asyncio.run(test_no_stagnation_with_progress())
    test_login_guardrail()
    test_critical_action_guardrail()
    test_ax_filter()
    print("All checks passed")
