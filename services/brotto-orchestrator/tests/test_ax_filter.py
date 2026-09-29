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


def _t(ref, role, name, parent=None, href=None):
    return SemanticTarget(
        ref_id=ref, tag=role, role=role, name=name, parent_ref_id=parent, href=href,
    )


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


def test_budget_scales_with_the_context_window():
    assert budget_for_window(200_000) < budget_for_window(1_000_000)
    assert budget_for_window(1_000_000) == 50_000
    # A small-window model stays bounded rather than getting a huge tree.
    assert budget_for_window(32_000) == 8_000
    assert budget_for_window(None) == 6_000
