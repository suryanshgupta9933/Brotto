"""The model's output is trimmed to what the panel can render.

This is the one thing a language model is reliably bad at: returning exactly
the shape asked for. It leads with a preamble, returns four suggestions
instead of three, and runs long when it has something to say. The panel is
narrow and has no defence of its own, so `generate` trims.

`_normalise` is the whole contract, so it is tested directly. No model, no
key, no network.
"""

from __future__ import annotations

import pytest

from brotto_orchestrator.agent.suggest import (
    MAX_CHARS,
    MAX_LINES,
    MAX_PAGE_TEXT,
    _normalise,
    _parse,
)


def test_page_text_stays_a_token_budget_not_a_document():
    """The suggestion answer is three short lines, so page text is an input
    sample rather than the page. It is paid for on every idle page, which is
    why this is a named cost decision and not an arbitrary slice."""
    assert MAX_PAGE_TEXT <= 2_000, (
        f"page text cap is {MAX_PAGE_TEXT} chars (~{MAX_PAGE_TEXT // 4} tokens) "
        "per suggestion call"
    )


def test_numbered_and_bulleted_lines_lose_their_marker():
    """The prompt forbids markers, but a panel rendering "1. Summarise the
    open pull requests" looks broken, and stripping it costs nothing."""
    assert _parse("1. Read the changelog\n- Check the open issues\n* Compare the two") == [
        "Read the changelog",
        "Check the open issues",
        "Compare the two",
    ]


def test_blank_lines_do_not_become_suggestions():
    assert _parse("Read the changelog\n\n\n  \nCheck the open issues") == [
        "Read the changelog",
        "Check the open issues",
    ]


def test_whitespace_is_collapsed():
    assert _normalise(["  Summarise   the\tthread\n"]) == ["Summarise the thread"]


def test_blank_lines_are_dropped():
    assert _normalise(["", "   ", "Read the changelog."]) == ["Read the changelog."]


def test_capped_at_three():
    lines = _normalise(["one", "two", "three", "four", "five"])
    assert lines == ["one", "two", "three"]
    assert len(lines) == MAX_LINES


def test_a_long_line_is_cut_on_a_word_boundary():
    # The failure this guards: "…and flag anything" → "…and flag anythi",
    # which is not shorter, it is wrong.
    out = _normalise(["word " * 60])
    assert len(out[0]) <= MAX_CHARS
    assert not out[0].endswith(("anythi", "an", "a"))


def test_trailing_punctuation_goes_with_the_cut():
    out = _normalise(["Compare the pricing tiers carefully, " + "and " * 40])
    assert not out[0].endswith((" ", ",", ";", ":"))


def test_everything_blank_yields_nothing_rather_than_a_placeholder():
    # The panel keeps its own fallback on an empty result, so returning
    # something here would overwrite the one path that always works.
    assert _normalise(["", "  ", "\n"]) == []


def test_a_suggestion_that_proposes_a_change_is_dropped():
    """The failure this guards, from a live idle panel: "Disable any
    extension that has not been updated in over a year" rendered as a
    one-tap suggestion. A destructive task offered casually is how it happens
    by accident — the user has agreed to nothing yet."""
    assert _normalise([
        "Delete the branches for merged pull requests",
        "Send the summary to the team channel",
        "Summarise the mail that arrived today",
    ]) == ["Summarise the mail that arrived today"]


def test_a_destructive_word_as_a_subject_is_not_a_destructive_suggestion():
    # Anchoring on the leading verb is what makes this safe. Matching anywhere
    # in the line would throw away a legitimate read of a thread whose subject
    # happens to be deletion.
    assert _normalise([
        "Summarise the thread about deleting the old deploy branch",
    ]) == ["Summarise the thread about deleting the old deploy branch"]


def test_a_dropped_line_does_not_consume_one_of_the_three_slots():
    # Otherwise the filter silently shortens every list that contained one,
    # and the panel renders two suggestions where it could render three.
    assert _normalise([
        "Delete everything in the trash",
        "one", "two", "three", "four",
    ]) == ["one", "two", "three"]


def test_a_refusal_reaches_the_panel_as_an_empty_list():
    """The prompt asks for a bare NONE, and on chrome:// pages the model takes
    the permission to decline — but answers with prose about declining rather
    than the sentinel or an empty reply. Rendered, that refusal was truncated
    mid-sentence into a clickable task. The panel keeps its own fallback on an
    empty result, so [] is the outcome that costs the user nothing."""
    for refusal in (
        "NONE",
        "I can't return anything for this page - it's the browser's own "
        "extensions settings, and suggesting tasks on it would only be noise",
        "Nothing here is worth offering.",
        "Nothing to suggest on an empty tab.",
    ):
        assert _normalise([refusal]) == [], refusal


def test_a_refusal_alongside_real_suggestions_drops_only_itself():
    assert _normalise([
        "I don't have enough here to suggest anything specific.",
        "Summarise the mail that arrived today",
    ]) == ["Summarise the mail that arrived today"]


def test_a_refusal_alongside_real_suggestions_drops_only_itself():
    assert _normalise([
        "I don't have enough here to suggest anything specific.",
        "Summarise the mail that arrived today",
    ]) == ["Summarise the mail that arrived today"]


# ── the page text that reaches the provider ───────────────────────────────
#
# `_normalise` is the output contract and the tests above are all no-model,
# no-key, no-network. Redaction is the *input* contract, and it is the one
# The README's Privacy section names: "page text is redacted before it is sent... on every
# task, with no setting to turn it off." The task path honoured that from
# one call site and the suggestion path was a second one nobody counted, so
# a page read with no task in flight reached the provider raw.

async def _prompt_generate(monkeypatch, page_text: str) -> str:
    """The prompt `generate` would hand the provider. No model, no key."""
    from brotto_orchestrator.agent import suggest as suggest_mod
    from brotto_orchestrator.model.config import ModelConfig, UserCredentials

    sent: list[str] = []

    class _StubAgent:
        def __init__(self, _model, system_prompt=""):
            pass

        async def run(self, prompt, **kwargs):
            sent.append(prompt)
            return _Run("Summarise the open thread.")

    class _Run:
        def __init__(self, output):
            self.output = output

    monkeypatch.setattr(suggest_mod, "Agent", _StubAgent)
    cfg = ModelConfig("anthropic", "claude-sonnet-4-5", 400_000)
    await suggest_mod.generate(
        "https://mail.google.com/mail/u/0/#inbox", "Inbox", cfg,
        UserCredentials(api_key="k", base_url=None), page_text,
    )
    return sent[0]


@pytest.mark.asyncio
async def test_a_card_number_in_the_page_never_reaches_the_provider(monkeypatch):
    prompt = await _prompt_generate(
        monkeypatch, "Your card 4111 1111 1111 1111 expires 04/27\nAda - Q3 budget"
    )
    assert "4111 1111 1111 1111" not in prompt
    assert "Q3 budget" in prompt, "redaction must not eat the page it was asked about"


@pytest.mark.asyncio
async def test_a_bearer_token_in_the_page_never_reaches_the_provider(monkeypatch):
    prompt = await _prompt_generate(
        monkeypatch, "Authorization: Bearer sk-ant-api03-AAAAAAAAAAAAAAAAAAAA\nhello"
    )
    assert "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA" not in prompt
