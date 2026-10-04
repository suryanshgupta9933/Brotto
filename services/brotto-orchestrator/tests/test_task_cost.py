"""What a run cost, and the ceiling that stops one.

Two failure modes this pins, both of which look correct in a diff:

  1. A cost read off `RunUsage.cost` is 0.00 on Claude and MiniMax, because
     pydantic-ai has no cost calculation for `AnthropicModel` at all. A total
     that displays $0.00 for a run the user was billed for is worse than one
     that displays nothing.
  2. A ceiling that fires *after* the actions dispatch has already clicked
     half of what it was set not to pay for, and one that never fires because
     the model is unpriced silently spends everything.

  3. Pricing that a free build can still reach. Cost is a paid feature, and it
     is switched off at one point rather than at each of the three places that
     would otherwise have to be right.
"""

from __future__ import annotations

from types import SimpleNamespace

from brotto_orchestrator.agent import harness
from brotto_orchestrator.agent.audit import AuditTrail
from brotto_orchestrator.model import pricing
from brotto_orchestrator.model.pricing import price_usage


def test_a_priced_model_totals_the_runs_cost():
    """Two turns of the same model add up in `totals`."""
    info = pricing.lookup("anthropic", "claude-sonnet-4-5")
    assert info is not None, "catalog lost a priced Anthropic model"

    audit = AuditTrail(session_id="s1")
    turn = audit.begin_turn(step=0, url="https://x.test/", page_title="x",
                            ax_targets=1, ax_chars=1, ax_diff_chars=0,
                            page_text_chars=1)
    audit.record_model(turn, thought="t", reasoning="r", tokens_in=1_000,
                       tokens_out=500, context_pct=1.0, latency_ms=10,
                       cost_usd=0.01)
    audit.record_model(turn, thought="t", reasoning="r", tokens_in=1_000,
                       tokens_out=500, context_pct=1.0, latency_ms=10,
                       cost_usd=0.02)
    assert audit._doc["totals"]["cost_usd"] == 0.03


def test_an_unpriced_model_is_absent_not_zero():
    """No rate means no key — the reader defaults it, and never reads $0.00.

    A budget cap is the consumer of this field, and a cap that cannot see a
    missing number spends exactly what it was set to bound.
    """
    audit = AuditTrail(session_id="s1")
    turn = audit.begin_turn(step=0, url="https://x.test/", page_title="x",
                            ax_targets=1, ax_chars=1, ax_diff_chars=0,
                            page_text_chars=1)
    audit.record_model(turn, thought="t", reasoning="r", tokens_in=1_000,
                       tokens_out=500, context_pct=1.0, latency_ms=10,
                       cost_usd=None)
    assert "cost_usd" not in audit._doc["turns"][turn]["model"]
    assert "cost_usd" not in audit._doc["totals"]


def test_the_ceiling_only_holds_when_there_is_a_price():
    """The cap is off by default, and a non-positive amount does not arm a $0
    budget — the mistake being a silent one, since a $0.00 cap would end
    every run at its first step with a plausible-looking reason."""
    assert harness._MAX_TASK_COST_USD is None


def test_the_budget_ceiling_shape_is_a_real_failure():
    """`budget_exhausted` has to be distinguishable from every other stop, and
    has to name the money — a user who hit a ceiling needs to know which
    ceiling."""
    from brotto_orchestrator.agent.context import TaskResult
    r = TaskResult(
        status="failed",
        summary="Stopped at step 4: this task reached $0.83, over the $0.50 ceiling",
        failure_reason="budget_exhausted",
        steps_taken=4,
    )
    assert r.failure_reason == "budget_exhausted"
    assert "$0.83" in r.summary and "$0.50" in r.summary


def _deps_for(provider: str, model: str):
    return SimpleNamespace(_model_config=SimpleNamespace(provider=provider, model=model))


def test_a_free_build_never_reaches_a_price(monkeypatch):
    """One gate, three consumers.

    Per-run cost and the per-task ceiling are paid features. `_catalog_for` is
    the only way the loop reaches a price, so returning None with the flag off
    is what makes the turn unpriced, `TaskResult.cost_usd` stay None and the
    panel draw nothing. A second gate downstream would be a second thing to get
    wrong, and the model here is priced — the only thing stopping it is the
    flag."""
    monkeypatch.setattr(harness, "_PRO_ENABLED", False)
    assert harness._catalog_for(_deps_for("anthropic", "claude-sonnet-4-5")) is None


def test_pro_prices_the_model_it_actually_ran_on(monkeypatch):
    """The same call with the flag on returns the catalogue entry, so the
    feature is a switch and not a removal."""
    monkeypatch.setattr(harness, "_PRO_ENABLED", True)
    info = harness._catalog_for(_deps_for("anthropic", "claude-sonnet-4-5"))
    assert info is not None
    assert price_usage(info, input_tokens=1_000, output_tokens=0,
                       cache_read=0, cache_write=0) > 0
