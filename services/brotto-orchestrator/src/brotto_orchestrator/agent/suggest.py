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
from .redact import redact_text

log = logging.getLogger(__name__)

MAX_LINES = 3
MAX_CHARS = 110

# Page text is the input that makes a real suggestion possible — a Gmail tab's
# title says nothing and its contents say everything. Capped hard because this
# is a three-line answer: past a few thousand characters the useful part of a
# page is already in view and the rest is latency. 2K is ~500 tokens, and this
# call fires on every idle page. The panel caps at the same number before
# sending; this is the backstop for any other caller.
MAX_PAGE_TEXT = 2_000

# A suggestion is a one-tap line read before thinking. The prompt already
# forbids proposing a change; this drops the ones that slip through. A net,
# not a guarantee — the cost of a false positive is one missing line. "close"
# and "drop" are deliberately absent: "close the gap between these two figures"
# is a legitimate analytical task.
_DESTRUCTIVE_VERBS = frozenset("""
    delete remove disable uninstall archive clear wipe purge empty overwrite
    send reply forward post publish buy pay subscribe cancel revoke terminate
""".split())

# The sentinel the prompt asks for, plus the prose openers a model falls back
# to when it ignores it. See _is_declining.
_DECLINE_OPENERS = frozenset({"none", "nothing", "no", "i", "i'm", "im", "there"})

# No output_type. A structured output costs a second model call roughly a
# third of the time, because pydantic-ai retries when the model misses the
# tool schema: measured 1.9s median but 4-5s on the tail, against 1.0s and
# no retry for plain text. The schema was validating something `_normalise`
# already defends against — a fourth line, a preamble, a run-on sentence.
_PLAIN_OUTPUT_SUFFIX = (
    "\n\nOutput at most three lines of plain text, one suggestion per line, "
    "with no numbering, bullets, or preamble. Fewer lines is correct when "
    "fewer are worth offering, and no lines at all is a valid answer."
)


def _is_declining(line: str) -> bool:
    """True when the model declined instead of suggesting.

    The prompt asks for a bare NONE, which is a closed set and the reason this
    is not a pile of string matching. But a model that ignores the sentinel
    does not return nothing — it returns prose about declining, and truncated
    to the panel's width "I can't return anything for this page, it's the
    browser's own extensions settings..." rendered as a clickable task. The
    openers below are the three shapes that actually showed up on a live run,
    kept as a backstop for a model that disobeys the sentinel.

    A decline has to reach the panel as an empty list, which the panel already
    treats as "keep your own fallback". Declining cleanly is free; rendering
    the refusal is not.
    """
    first = line.split(" ", 1)[0].strip(".,!?'\"").lower()
    return first in _DECLINE_OPENERS


def _is_destructive(line: str) -> bool:
    """True when a suggestion opens by proposing a change to the page.

    Anchored on the leading word because a suggestion is an imperative, so the
    first token is the verb. Matching anywhere else would catch "the thread
    mentions deleting the old branch", which is a subject, not an instruction.
    """
    verb = line.split(" ", 1)[0].strip(".,!?'\"").lower()
    return verb in _DESTRUCTIVE_VERBS


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
        if not text or _is_declining(text) or _is_destructive(text):
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
    page_text: str = "",
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
    # Redacted first, and unconditional, exactly as the task path does it.
    # PRIVACY.md promises page text is redacted before it is sent, and this
    # is a second call site that promise did not know about — so a page read
    # with *no task in flight* went to the provider raw. Unconditional for
    # the harness's reason: a live card number reaching a provider's logs is
    # not a setting the user should have to know to turn on.
    page_text, redactions = redact_text(page_text)
    if redactions:
        log.info("suggestion page text: redacted %s", ", ".join(
            f"{n} {k}" for k, n in sorted(redactions.items())))
    # Capped before the strip, not after: a direct caller can hand over a whole
    # document and the angle brackets have to come out of the payload either
    # way. Head-truncated, because the part of a page that carries what a
    # question would be about is the part already in view. After the redaction,
    # so a secret straddling the boundary goes out whole or not at all.
    text = page_text[:MAX_PAGE_TEXT].replace("<", "").replace(">", "")
    body = f"  <text>\n{text}\n  </text>\n" if text else '  <text unavailable="true" />\n'
    # < > stripped from url and title for the same reason: all three values are
    # attacker-controlled page metadata interpolated into a tagged block. Cheap
    # to lose, not worth risking.
    result = await agent.run(
        f"<page>\n"
        f"  <url>{url.replace('<', '').replace('>', '')}</url>\n"
        f"  <title>{(title or '(none)').replace('<', '').replace('>', '')}</title>\n"
        f"{body}"
        f"</page>",
        model_settings=factory.model_settings(cfg.model),
    )
    lines = _normalise(_parse(result.output))
    # Whether page text went to the model is the one thing here the user cannot
    # otherwise see, and it is their inbox that may have gone.
    log.info(
        "suggestions for %s: %d line(s), page text %s",
        url[:120],
        len(lines),
        f"{len(text)} chars" if text else "unavailable",
    )
    return lines
