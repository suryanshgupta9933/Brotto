"""What the model is actually shown.

The three fields below were all captured and then thrown away, and each one
cost real steps on a live run: a repo's star count sat eight lines from its
name with nothing marking the record, and no link anywhere carried a URL, so
the agent guessed at deep-link patterns instead of reading the page's own.
"""

from brotto_orchestrator.agent.ax_filter import (
    budget_for_window,
    filter_ax_targets,
)
from brotto_orchestrator.dev.ax_tree_extractor import (
    AXTreeExtractor,
    SemanticTarget,
)


def _t(ref, role, name, parent=None, href=None, value=None, hidden=False):
    return SemanticTarget(
        ref_id=ref, tag=role, role=role, name=name, parent_ref_id=parent,
        href=href, value=value, hidden=hidden,
    )


def test_a_supplemented_control_renders_marked_hidden():
    """The extension surfaces `aria-hidden` controls from the DOM, because a
    control the site hid from assistive tech is often still the control the
    user means. It is marked, not recovered: the model has to be able to see
    that the site tried to hide this before it acts on it."""
    out = filter_ax_targets(
        [_t("0:-1", "button", "Delete account", hidden=True)], max_chars=100_000,
    )
    assert '[0:-1] button [hidden] "Delete account"' in out


def test_a_normal_control_is_not_marked_hidden():
    """The marker is a disclosure statement, not decoration. A line that says
    `[hidden]` when the element is not is worse than no marker at all."""
    out = filter_ax_targets(
        [_t("0:4", "button", "Save draft")], max_chars=100_000,
    )
    assert "[hidden]" not in out


def test_a_hidden_control_survives_the_budget():
    """A hidden control is actionable by role, so ranking is unchanged — it is
    dropped only on size, like any other button."""
    targets = [_t(f"h{i}", "heading", f"Message from sender {i}") for i in range(200)]
    targets.append(_t("0:-1", "button", "Delete account", hidden=True))
    out = filter_ax_targets(targets, max_chars=1200)
    assert "[hidden]" in out and "Delete account" in out


def test_depth_indents_fields_under_their_record():
    """A star count and a repo name are siblings inside one listitem. Flat,
    the model cannot tell which record a count belongs to."""
    targets = [
        _t("h", "heading", "Law-GPT Public", parent="li"),
        _t("t1", "link", "law", parent="li"),
        _t("s", "link", "star 50", parent="li"),
        _t("li", "listitem", "", parent=None),
        _t("h2", "heading", "Other Public", parent="li2"),
        _t("s2", "link", "star 3", parent="li2"),
        _t("li2", "listitem", "", parent=None),
    ]
    out = filter_ax_targets(targets, max_chars=100_000)
    assert '  [h] heading "Law-GPT Public"' in out
    assert '  [s] link "star 50"' in out
    # The nameless listitem never renders, but it is the boundary: the next
    # record's fields sit at the same depth, not deeper.
    assert '  [s2] link "star 3"' in out


def test_href_is_rendered_next_to_the_name():
    targets = [_t("n", "heading", "Repositories 36", href="/x?tab=repositories")]
    assert "tab=repositories" in filter_ax_targets(targets, max_chars=100_000)


def test_extractor_keeps_the_containers_records_live_in():
    """listitem is nameless on a list page, so it renders nothing. Drop it
    from the kept set and every field in the record loses its parent."""
    for role in ("listitem", "list", "row", "rowgroup", "table"):
        node = {"role": {"value": role}, "name": {"value": ""}}
        assert AXTreeExtractor._should_include_node(node), role


def test_href_read_from_cdp_url_property():
    node = {
        "role": {"value": "link"},
        "name": {"value": "star 50"},
        "properties": [{"name": "url", "value": {"value": "https://x/Law-GPT/stargazers"}}],
    }
    assert AXTreeExtractor._extract_href(node) == "https://x/Law-GPT/stargazers"
    assert AXTreeExtractor._extract_href({"role": {"value": "heading"}}) is None


def test_truncation_drops_whole_lines_and_says_how_many():
    """It used to slice mid-element, leaving a tree that ended on half a
    line. Over budget now means whole lines go and the count is reported."""
    targets = [_t(str(i), "link", f"item-{i}-{'x' * 60}") for i in range(50)]
    out = filter_ax_targets(targets, max_chars=600)
    assert "not shown" in out
    kept = [
        l for l in out.splitlines()
        if l.lstrip().startswith("[") and "not shown" not in l
    ]
    assert 0 < len(kept) < 50
    # Every surviving line is a whole element: its name is intact, not
    # cut off partway by the budget.
    for line in kept:
        ref = line.lstrip()[1 : line.lstrip().index("]")]
        name = next(t.name for t in targets if t.ref_id == ref)
        assert f'"{name}"' in line


def _inbox(heading_count=200):
    """A long list of nameless headings, then the one control worth having.

    Mirrors the `auth-inbox` fixture, which failed with GAP_RENDER: the target
    is in the tree and past the character cut. Document order puts it last.
    """
    targets = [_t(f"h{i}", "heading", f"Message from sender {i}") for i in range(heading_count)]
    targets.append(_t("msg", "button", "Message 400"))
    return targets


def test_a_later_interactive_control_outranks_nameless_headings():
    """Review Focus #5. Ranking is by actionability: the one button on the
    page survives a budget that 200 nameless headings would have eaten."""
    tree = filter_ax_targets(_inbox(), max_chars=1200)
    assert "Message 400" in tree
    assert "not shown" in tree  # the headings lost, and it says so


def test_a_nameless_but_valued_control_still_outranks_headings():
    """Criterion 3 only bites where a name is absent but a value is not —
    a filled field renders `value="…"` with no name at all, and is still the
    thing the agent can act on."""
    targets = [_t(f"h{i}", "heading", f"Message from sender {i}") for i in range(200)]
    targets.append(_t("q", "textbox", "", value="quarterly-report"))
    assert "quarterly-report" in filter_ax_targets(targets, max_chars=1200)


def test_ranking_never_hides_a_target_the_budget_can_hold():
    """Under a generous budget nothing is dropped — the ranked cut is a cut,
    not a filter."""
    out = filter_ax_targets(_inbox(heading_count=20), max_chars=100_000)
    assert "not shown" not in out
    for i in range(20):
        assert f"sender {i}" in out


def test_the_budget_still_scales_with_the_window():
    """Ranking changes which lines survive, never how many."""
    assert len(filter_ax_targets(_inbox(), max_chars=2000)) > \
           len(filter_ax_targets(_inbox(), max_chars=1000))


def test_budget_scales_with_the_context_window():
    assert budget_for_window(200_000) < budget_for_window(1_000_000)
    assert budget_for_window(1_000_000) == 50_000
    # A small-window model stays bounded rather than getting a huge tree.
    assert budget_for_window(32_000) == 8_000
    assert budget_for_window(None) == 6_000


def _m(ref, role, name, **kw):
    return SemanticTarget(ref_id=ref, tag=role, role=role, name=name, **kw)


# ── Markers for controls the page will not act on ────────────────────────────
#
# These render rather than drop. A control that is present and not clickable is
# information: it is usually the answer to "why did nothing happen", and a
# dropped line takes that answer with it.


def test_an_off_screen_control_renders_marked():
    """The `[off-screen]` marker had a renderer and no producer — a parameter
    nothing passed, so the marker had never once appeared on a real run while
    the code that would draw it sat there looking finished."""
    out = filter_ax_targets(
        [_m("0:1", "button", "Create", blocked="off-screen")], max_chars=100_000,
    )
    assert '[0:1] button [off-screen] "Create"' in out


def test_a_covered_control_renders_marked():
    out = filter_ax_targets(
        [_m("0:1", "button", "Create", blocked="occluded")], max_chars=100_000,
    )
    assert '[covered]' in out


def test_a_disabled_control_renders_marked():
    """A form whose Create button is disabled is telling you which field above
    it is not accepted yet — the single most useful thing on the page, and it
    used to be invisible."""
    out = filter_ax_targets(
        [_m("0:1", "button", "Create", disabled=True)], max_chars=100_000,
    )
    assert '[disabled]' in out


def test_markers_stack_and_stay_before_the_name():
    """Order is what a reader parses. A marker after the quoted name reads as
    part of the button's label."""
    out = filter_ax_targets(
        [_m("0:1", "button", "Create", disabled=True, blocked="occluded")],
        max_chars=100_000,
    )
    assert '[0:1] button [disabled] [covered] "Create"' in out


def test_an_unflagged_control_carries_no_marker():
    """The markers are disclosures, not decoration. `[off-screen]` on an
    element that is on screen is worse than no marker at all."""
    out = filter_ax_targets([_m("0:1", "button", "Create")], max_chars=100_000)
    assert "[" not in out.split("Create")[0].split("button")[1]


def test_an_unmarked_hypothetical_parameter_is_gone():
    """`viewport_coords` was the dead door: ax_filter accepted it, the tree
    renderer honoured it, and no caller has ever passed one — so `[off-screen]`
    had never rendered. A signature accepting a dead parameter is a feature that
    looks like it works, and this file had one burned into it already."""
    import inspect

    assert "viewport_coords" not in inspect.signature(filter_ax_targets).parameters


def test_a_disabled_control_sorts_below_a_live_one():
    """The line about what the agent will try now. A page's worth of disabled
    buttons is worth reading, but not before the one control that is live."""
    targets = [_m(f"d{i}", "button", f"Disabled {i}", disabled=True) for i in range(200)]
    targets.append(_m("live", "button", "Submit"))
    out = filter_ax_targets(targets, max_chars=1200)
    assert "Submit" in out
    assert "not shown" in out
