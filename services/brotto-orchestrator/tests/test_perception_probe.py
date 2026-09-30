"""The probe's verdict logic, pinned.

The browser half of `probe_perception.py` needs Chrome and a real AX tree, so
it is not unit-tested. Everything that *decides* what a measurement means is
pure and is pinned here — the artifact the rest of the workstream is ordered
against is only worth committing if these rules cannot drift silently.
"""

import importlib.util
import pathlib

import pytest

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1] / "scripts" / "probe_perception.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("probe_perception", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = _load()


def _row(**over):
    base = {
        "in_ax_tree": False,
        "in_ax_tree_all_frames": False,
        "in_pierced_dom": False,
        "in_rendered_output": None,
        "render_delay_ms": 0,
    }
    return {**base, **over}


class TestVerdict:
    def test_top_frame_with_no_failure_is_ok(self):
        assert probe._verdict(_row(in_ax_tree=True, in_rendered_output=True)) == "OK"

    def test_known_failure_on_the_top_frame_is_a_rendering_gap(self):
        # Chrome has it and the baseline says it never reached the model: we
        # dropped it. The fix is ranking, not traversal.
        assert probe._verdict(_row(in_ax_tree=True, in_rendered_output=False)) == "GAP_RENDER"

    def test_a_late_target_is_a_timing_gap_not_a_rendering_one(self):
        # Same evidence, opposite cause — the observation happened before the
        # page drew the control, so the filter never got to drop it. Building
        # the ranking fix for this one would leave the fixture red.
        row = _row(in_ax_tree=True, in_rendered_output=False, render_delay_ms=5000)
        assert probe._verdict(row) == "GAP_TIMING"

    def test_no_evidence_is_not_a_pass(self):
        # auth-shadow postdates baseline.json, so in_rendered_output is null.
        # The AX route still answers, and it answers OK.
        assert probe._verdict(_row(in_ax_tree=True)) == "OK"

    def test_target_only_in_a_subframe_needs_traversal(self):
        assert probe._verdict(_row(in_ax_tree_all_frames=True, in_rendered_output=False)) == "GAP_FRAMES"

    def test_a_subframe_target_that_did_render_needs_no_fix(self):
        assert probe._verdict(_row(in_ax_tree_all_frames=True, in_rendered_output=True)) == "OK"

    def test_in_the_dom_but_not_in_the_ax_tree_is_an_aria_gap(self):
        assert probe._verdict(_row(in_pierced_dom=True, in_rendered_output=False)) == "GAP_ARIA"

    def test_absent_everywhere_is_unreachable(self):
        assert probe._verdict(_row(in_rendered_output=False)) == "GAP_UNREACHABLE"

    def test_a_target_that_never_rendered_is_not_treated_as_a_gap(self):
        # auth-canvas paints to a canvas: no AX node, no DOM text. That is a
        # product decision, and the verdict must not dress it up as a fix.
        assert probe._verdict(_row(render_delay_ms=None)) == "GAP_UNREACHABLE"


class TestFrameWalk:
    def test_reads_the_frame_id_off_the_wrapper(self):
        # Page.getFrameTree returns {"frame": {...}, "childFrames": [...]}, so
        # a node read as a frame has no "id" and KeyErrors on the first line.
        node = {"frame": {"id": "A"}, "childFrames": [{"frame": {"id": "B"}}]}
        assert probe._walk_frames(node) == ["A", "B"]

    def test_drops_frames_with_no_id(self):
        assert probe._walk_frames({"frame": {}}) == []


class TestObstacles:
    def test_reads_the_obstacle_names_off_the_benchmark_script(self):
        # Duplicating these strings here would let a fixture change its
        # obstacle and leave the probe observing a page no run ever reaches.
        assert probe._obstacle_names("auth-popup") == ["Accept"]
        assert probe._obstacle_names("auth-tabbed") == ["Archived"]
        assert probe._obstacle_names("auth-shadow") == []


class TestInDom:
    def test_matches_on_visible_text(self):
        assert probe._in_dom([{"tag": "button", "text": "Loaded", "label": ""}], "Loaded")

    def test_matches_on_aria_label(self):
        assert probe._in_dom([{"tag": "div", "text": "x", "label": "Confirm"}], "Confirm")

    def test_an_absent_target_is_absent(self):
        assert not probe._in_dom([{"tag": "button", "text": "Sign in", "label": ""}], "Loaded")


# The recorded verdicts, pinned. This is the measurement the rest of 0A is
# ordered against, so re-recording it is a deliberate act: a fixture that
# changes, a probe that changes, or a Chrome that changes must fail here and be
# looked at, rather than quietly rewriting the work order.
#
# `auth-shadow` is the row that matters. The capability map listed shadow DOM
# as its first 0A gap on the strength of a grep of our own source finding no
# "shadowRoot" identifier, which said nothing about Chrome. Chrome traverses
# open shadow roots on its own; the gap was never there.
EXPECTED_VERDICTS = {
    "auth-iframe": "GAP_FRAMES",       # in a cross-origin frame we never traverse
    "auth-aria-hidden": "GAP_ARIA",    # DOM has it, the AX tree does not
    "auth-canvas": "GAP_UNREACHABLE",  # pixels, not nodes — a product decision
    "auth-slowjs": "GAP_TIMING",       # measured 5s to appear; we looked too early
    "auth-inbox": "GAP_RENDER",        # present and past the character budget
    "auth-popup": "OK",
    "auth-tabbed": "OK",
    "auth-shadow": "OK",               # the gap the map invented
}


def _artifact():
    import json

    path = pathlib.Path(__file__).resolve().parent / "fixtures" / "perception-probe.json"
    return json.loads(path.read_text())["rows"]


def test_the_committed_artifact_is_not_stale():
    """Every row's verdict must still follow from its own recorded routes."""
    rows = _artifact()
    assert rows, "artifact records no fixtures"
    for row in rows:
        assert row["verdict"] == probe._verdict(row), f"{row['fixture']} is stale"
        assert not row["frame_errors"], f"{row['fixture']}: unreachable frames"


def test_the_recorded_verdicts_are_the_ones_the_work_order_assumes():
    assert {r["fixture"]: r["verdict"] for r in _artifact()} == EXPECTED_VERDICTS


def test_every_fixture_is_probed():
    from brotto_orchestrator.testing.fixtures import FIXTURES

    assert {r["fixture"] for r in _artifact()} == {f.name for f in FIXTURES}


# The backendNodeId join, which the bulk-geometry plan depends on. The spec
# listed it as an open item; these are the recorded answers, and re-recording
# the artifact with different numbers must fail here rather than quietly
# changing what the plan is allowed to assume.
class TestBackendNodeIdJoin:
    def test_the_ax_and_pierced_dom_id_spaces_are_the_same_space(self):
        # 20 to 1221 ids per fixture, every one of them present. This is the
        # spec's open item, answered: the join key exists.
        for row in _artifact():
            g = row["geometry"]
            assert g["ax_backend_ids"] > 0, row["fixture"]
            assert g["ax_ids_in_pierced_dom"] == g["ax_backend_ids"], row["fixture"]

    def test_the_path_walk_finds_the_element_the_id_names(self):
        # The sharp form of the same question, and the one that decides. A
        # backendNodeId has no page-side accessor, so the bulk read walks
        # element-child paths instead; if the arithmetic were off, this lands
        # on a different element and every coordinate on the page is wrong.
        for row in _artifact():
            g = row["geometry"]
            assert g["sampled"] > 0, row["fixture"]
            assert g["same_element"] == g["sampled"], row["fixture"]

    def test_the_y_difference_is_todays_top_edge_not_a_wrong_element(self):
        # `DOM.getBoxModel`'s content quad is flat (p0.y == p1.y) for every
        # node measured, so the existing `(y0+y1)/2` is the top edge of the
        # box. x agrees everywhere; y does not, and the walk's is the centre.
        for row in _artifact():
            g = row["geometry"]
            assert g["x_agrees"] == g["sampled"], row["fixture"]
            assert g["content_quad_flat"] == g["sampled"], row["fixture"]
            assert g["y_agrees"] == 0, row["fixture"]


class TestElementPaths:
    """The path arithmetic, pure, so a change to it cannot be a silent one."""

    def test_counts_element_children_only(self):
        # CDP's `children` carries text nodes; the DOM's does not. Counting
        # everything puts every node after the first text node on the wrong
        # element, which the recorded rect comparison above catches and this
        # does not have to wait for.
        tree = {
            "nodeType": 9,
            "children": [
                {"nodeType": 1, "backendNodeId": 1, "children": [
                    {"nodeType": 3, "backendNodeId": 90, "children": []},
                    {"nodeType": 1, "backendNodeId": 2, "children": [
                        {"nodeType": 1, "backendNodeId": 3, "children": []},
                    ]},
                ]},
                {"nodeType": 1, "backendNodeId": 4, "children": []},
            ],
        }
        assert probe._element_paths(tree, {3, 4}) == {3: [0, 0, 0], 4: [1]}

    def test_does_not_walk_into_shadow_roots_or_iframe_documents(self):
        # A path from the top document cannot reach either, and a path that
        # reached the *wrong* element would be worse than a round trip.
        tree = {
            "nodeType": 9,
            "children": [{
                "nodeType": 1, "backendNodeId": 1,
                "shadowRoots": [{"nodeType": 9, "children": [
                    {"nodeType": 1, "backendNodeId": 5, "children": []}]}],
                "contentDocument": {"nodeType": 9, "children": [
                    {"nodeType": 1, "backendNodeId": 6, "children": []}]},
            }],
        }
        assert probe._element_paths(tree, {5, 6}) == {}


class TestBackendIdWalk:
    def test_reads_children_shadow_roots_and_content_documents(self):
        tree = {
            "backendNodeId": 1,
            "children": [{"backendNodeId": 2}],
            "shadowRoots": [{"backendNodeId": 3}],
            "contentDocument": {"backendNodeId": 4},
        }
        assert probe._backend_ids(tree, set()) == {1, 2, 3, 4}

