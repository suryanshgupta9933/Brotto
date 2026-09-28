"""Named scripted tasks, one per fixture. Dev/test only."""

from __future__ import annotations

from ..agent.context import ActionCall
from .fixtures import FIXTURES, load_fixture
from .scripted_planner import ScriptedPlanner, ScriptedStep, ref_by_name

SCRIPT_NAMES: tuple[str, ...] = tuple(f.name for f in FIXTURES)


def _login_steps() -> list[ScriptedStep]:
    """Every fixture gates its content behind the same login form."""
    return [
        ScriptedStep(
            thought="enter email",
            actions=[ActionCall(action="type_text",
                                action_args={"text": "dev@example.com",
                                             "ref": ref_by_name("Email", role="textbox")})],
        ),
        ScriptedStep(
            thought="enter password",
            actions=[ActionCall(action="type_text",
                                action_args={"text": "hunter2",
                                             "ref": ref_by_name("Password", role="textbox")})],
        ),
        ScriptedStep(
            thought="sign in",
            actions=[ActionCall(action="click",
                                action_args={"ref": ref_by_name("Sign in", role="button")})],
        ),
    ]


# Steps between "logged in" and "target reached". The planner has no
# intelligence — the script is the solution — so a fixture's deliberate
# obstacle must be cleared here. The other five need none: their targets are
# meant to be unresolvable, and a workaround step would erase the measurement.
_OBSTACLES: dict[str, list[ScriptedStep]] = {
    "auth-popup": [
        ScriptedStep(
            thought="dismiss the cookie dialog blocking the target",
            actions=[ActionCall(action="click",
                                action_args={"ref": ref_by_name("Accept", role="button")})],
        ),
    ],
    "auth-tabbed": [
        ScriptedStep(
            thought="switch to the tab holding the target",
            actions=[ActionCall(action="click",
                                action_args={"ref": ref_by_name("Archived", role="tab")})],
        ),
    ],
}


def build_script(name: str) -> ScriptedPlanner:
    """Steps that log in, clear the fixture's obstacle, then reach its target."""
    fx = load_fixture(name)
    return ScriptedPlanner(
        _login_steps()
        + _OBSTACLES.get(fx.name, [])
        + [
            ScriptedStep(
                thought=f"reach {fx.target_name}",
                actions=[ActionCall(action="click",
                                    action_args={"ref": ref_by_name(fx.target_name)})],
            ),
            ScriptedStep(thought="done", actions=[ActionCall(
                action="task_complete", action_args={})]),
        ],
        on_exhausted="task_complete",
    )


def get_script(name: str) -> ScriptedPlanner:
    if name not in SCRIPT_NAMES:
        raise KeyError(f"no script {name!r}; available: {', '.join(SCRIPT_NAMES)}")
    return build_script(name)
