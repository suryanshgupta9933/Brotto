"""The coordinate actions must say their arguments are integers, and show it.

A real Google Sheets run emitted `{"x": "113", "y": "213"}` — numbers as
JSON strings — because `action_args` is a bare dict (`context.ActionCall`), so
the output tool's schema carries no per-argument type and every literal in the
prompt's example block was quoted. The dispatch guard now coerces; this is the
half that lowers the probability, and like every prompt rule it needs a test or
it silently goes back.

Asserts the *property* (each of the three action descriptions names the type;
the one coordinate example has bare literals), not a pinned string.
"""

import json
import re

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT

_XY = ("click_xy", "focus_xy", "type_xy")


def _flat() -> str:
    return re.sub(r"\s+", " ", SYSTEM_PROMPT)


def test_each_coordinate_action_names_the_integer_type():
    flat = _flat()
    for action in _XY:
        entry = flat[flat.index(f"{action}(x, y, label"):]
        entry = entry[: entry.index("—") + 200]
        assert re.search(r"\bintegers?\b", entry), (
            f"{action} never says its x/y are integers"
        )


def test_the_coordinate_example_has_unquoted_numbers():
    flat = _flat()
    examples = re.findall(
        r'\{"action": "click_xy", "action_args": \{.*?\}\}', flat
    )
    assert examples, "the click_xy example is gone"
    assert len(examples) == 1, "one coordinate example; more is noise"
    args = json.loads(examples[0])
    assert isinstance(args["action_args"]["x"], int)
    assert isinstance(args["action_args"]["y"], int)
    assert args["action_args"]["x"] == 412
    # The shape the model copies: numbers beside the one string that must be one.
    assert isinstance(args["action_args"]["label"], str)
