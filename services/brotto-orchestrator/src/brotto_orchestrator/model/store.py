from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path

from brotto_orchestrator.model.config import ModelConfig

log = logging.getLogger(__name__)

BROTTO_USER_MODEL_DIR_ENV = "BROTTO_USER_MODEL_DIR"


def _user_dir() -> Path:
    raw = os.getenv(BROTTO_USER_MODEL_DIR_ENV, "logs/user_models")
    return Path(raw)


def _safe_filename(client_ip: str) -> str:
    # Strip path separators and characters that could escape the dir.
    safe = "".join(c for c in client_ip if c.isalnum() or c in (".", "-"))
    return f"{safe}.json"


def save_user_config(client_ip: str, config: ModelConfig) -> None:
    d = _user_dir()
    d.mkdir(parents=True, exist_ok=True)
    target = d / _safe_filename(client_ip)
    payload = json.dumps(config.to_dict(), sort_keys=True).encode()
    digest = hashlib.sha256(payload).hexdigest()[:12]
    if target.exists():
        try:
            existing = json.loads(target.read_text())
            if existing == config.to_dict():
                log.debug("user config unchanged for %s (dedup %s)", client_ip, digest)
                return
        except (json.JSONDecodeError, OSError):
            pass  # fall through and overwrite
    tmp = target.with_suffix(f".{digest}.tmp")
    tmp.write_bytes(payload)
    tmp.rename(target)
    log.info("saved user config for %s (digest %s)", client_ip, digest)


def load_user_config(client_ip: str) -> ModelConfig | None:
    # `_safe_filename` drops every character that is not alphanumeric, `.` or
    # `-`, so a separator cannot survive into this path — a name built from
    # those can only ever land inside `_user_dir()`. CodeQL models the sink,
    # not the character filter. Suppressed in `.github/workflows/codeql.yml`,
    # not inline: a `# codeql[...]` comment here suppresses nothing.
    path = _user_dir() / _safe_filename(client_ip)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as e:
        log.warning("failed to read user config at %s: %s", path, e)
        return None
    try:
        return ModelConfig.from_dict(data)
    except (ValueError, TypeError) as e:
        log.warning("invalid user config at %s: %s", path, e)
        return None