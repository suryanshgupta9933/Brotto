"""The prompt must not promise more memory than the tree keeps.

Bodies are not persisted — the sidecar that would hold them has no writer — so
a resumed run's entries are digest only. The prompt used to say recall_memory
returned a page "in full ... including after the run is interrupted and
resumed", which is the exact opposite of what the model gets. It is told the
truth at recall time (`[only the digest of ... survived]`), one step after the
prompt had promised otherwise.

Also covers `read_scratchpad`, which the prompt advertised as "manifest +
notes": the handler returns ids and digests, and nothing writes notes.
"""

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT


def test_the_prompt_does_not_promise_a_body_after_a_resume():
    lowered = SYSTEM_PROMPT.lower()
    assert "including after the run is" not in lowered, (
        "the prompt promises full bodies after a resume; no writer persists them"
    )
    assert "resumed" in lowered, (
        "the resume caveat is still true and still has to be in the prompt"
    )


def test_read_scratchpad_is_not_advertised_as_returning_notes():
    line = next(ln for ln in SYSTEM_PROMPT.splitlines()
                if "read_scratchpad()" in ln and "dump" in ln)
    assert "notes" not in line.lower()