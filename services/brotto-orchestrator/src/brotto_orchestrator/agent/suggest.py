"""Model-written task suggestions for the idle side panel.

Three earlier versions of these were hand-written tables keyed on hostname or
page class, and every one of them was wrong in the same way: correct on the
sites someone thought of, identical everywhere else. The strings were never
the hard part. The model the user already pays for is.

Standalone rather than folded into the harness: that Agent is bound to
`AgentDecision` with a `SYSTEM_PROMPT` whose whole identity is "you are not a
chatbot", which is the opposite of what a suggestion writer should be.
"""

from __future__ import annotations

import logging
import re

from pydantic_ai import Agent
from pydantic_ai.exceptions import UserError

from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.registry import PROVIDER_REGISTRY

from .prompt import SUGGESTION_PROMPT

log = logging.getLogger(__name__)

MAX_LINES = 3
MAX_CHARS = 110

# No output_type. A structured output costs a second model call roughly a
# third of the time, because pydantic-ai retries when the model misses the
# tool schema: measured 1.9s median but 4-5s on the tail, against 1.0s and
# no retry for plain text. The schema was validating something `_normalise`
# already defends against — a fourth line, a preamble, a run-on sentence.
_PLAIN_OUTPUT_SUFFIX = (
    "\n\nOutput exactly three lines of plain text, one suggestion per line, "
    "with no numbering, bullets, or preamble."
)


def _parse(text: str) -> list[str]:
    """Split the model's reply into suggestion lines.

    The prompt already forbids numbering and explanation, but a stray
    bullet or a leading number costs nothing to strip, and a panel that
    renders "1. Summarise the open pull requests" looks broken.
    """
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.strip().lstrip("-*•").lstrip()
        line = re.sub(r"^\d+[.)]\s*", "", line)
        if line:
            out.append(line)
    return out


def _normalise(lines: list[str]) -> list[str]:
    """Trim the model's output to what the panel can actually render.

    A model will occasionally lead with a preamble, return four suggestions,
    or run long. The panel should never have to defend against any of that.
    """
    out: list[str] = []
    for raw in lines:
        text = " ".join(str(raw).split())
        if not text:
            continue
        if len(text) > MAX_CHARS:
            # Cut on a space so a line never ends mid-word.
            text = text[:MAX_CHARS].rsplit(" ", 1)[0].rstrip(" ,;:")
        out.append(text)
        if len(out) == MAX_LINES:
            break
    return out


async def generate(
    url: str,
    title: str,
    cfg: ModelConfig,
    creds: UserCredentials,
) -> list[str]:
    factory = PROVIDER_REGISTRY.get(cfg.provider)
    # The registry is indexed unguarded everywhere else, but this is reached
    # from a public HTTP endpoint with client-supplied config, so a bad
    # provider has to be an error rather than a bare KeyError.
    if factory is None or not factory.validate_model_id(cfg.model):
        raise UserError(f"Unknown model {cfg.provider}:{cfg.model}")

    agent = Agent(
        factory.build(cfg.model, creds),
        system_prompt=SUGGESTION_PROMPT + _PLAIN_OUTPUT_SUFFIX,
    )
    # < > stripped because both values are attacker-controlled page metadata
    # interpolated into a tagged block. Cheap to lose, not worth risking.
    result = await agent.run(
        f"<page>\n"
        f"  <url>{url.replace('<', '').replace('>', '')}</url>\n"
        f"  <title>{(title or '(none)').replace('<', '').replace('>', '')}</title>\n"
        f"</page>",
        model_settings=factory.model_settings(cfg.model),
    )
    lines = _normalise(_parse(result.output))
    log.info("suggestions for %s: %d line(s)", url[:120], len(lines))
    return lines
