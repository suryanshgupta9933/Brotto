"""The named volume is `brotto-data`, and it is where the user's data goes.

Two ways this file fails, and both fail silently:

- **The name.** Left to itself compose namespaces a volume as
  `<project>_brotto-data`, where the project is the checkout directory's name.
  A user who clones into `~/brotto` instead of `~/work/brotto` gets a fresh,
  empty `/data`, every session document reads as gone, and nothing anywhere
  says a second volume exists.
- **The directories.** `/data` holds the user's transcripts and their policy.
  One of the three env vars pointing somewhere off the volume — or a fourth
  directory added without a variable — loses that data on every restart, in a
  container that starts cleanly and answers `/health` the whole time.

This reads the shipped compose file rather than a copy, because the claim is
about the file a self-hoster downloads.
"""

from __future__ import annotations

import pathlib

import pytest

yaml = pytest.importorskip("yaml")

ROOT = pathlib.Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def compose() -> dict:
    return yaml.safe_load((ROOT / "docker-compose.yml").read_text())


def _service(compose: dict) -> dict:
    # The service is named after the directory by convention, but the file is
    # the source of truth, so take the only one with a container image.
    services = compose["services"]
    (svc,) = [s for s in services.values() if "image" in s or "build" in s]
    return svc


def test_the_volume_is_named_exactly(compose):
    # Not `brotto_brotto-data`. The whole point is that the name survives the
    # directory being moved or renamed.
    assert compose["volumes"]["brotto-data"]["name"] == "brotto-data"


def test_all_three_state_directories_are_on_the_volume(compose):
    env = _service(compose)["environment"]
    assert any(m.endswith(":/data") for m in _service(compose)["volumes"])

    for var in (
        "BROTTO_SESSIONS_DIR",
        "BROTTO_USER_POLICY_DIR",
        "BROTTO_USER_MODEL_DIR",
    ):
        assert env[var].startswith("/data/"), f"{var}={env.get(var)!r} is off the volume"


def test_the_container_is_the_only_thing_writing_there(compose):
    # The quickstart's whole promise is that state survives a restart. A
    # bind mount over /data would shadow the volume and silently replace it
    # with the host directory, which on a laptop is the same broken state with
    # an extra step.
    for mount in _service(compose)["volumes"]:
        assert mount.split(":")[0] != "/data", f"{mount} shadows the volume"
