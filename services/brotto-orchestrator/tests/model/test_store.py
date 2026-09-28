from __future__ import annotations

from pathlib import Path

import pytest

from brotto_orchestrator.model.config import ModelConfig
from brotto_orchestrator.model.store import (
    BROTTO_USER_MODEL_DIR_ENV,
    load_user_config,
    save_user_config,
)


@pytest.fixture
def tmp_model_dir(monkeypatch, tmp_path: Path) -> Path:
    monkeypatch.setenv(BROTTO_USER_MODEL_DIR_ENV, str(tmp_path))
    return tmp_path


def test_save_then_load_round_trip(tmp_model_dir: Path):
    cfg = ModelConfig(provider="anthropic", model="MiniMax-M3", context_window=1_000_000)
    save_user_config("127.0.0.1", cfg)
    loaded = load_user_config("127.0.0.1")
    assert loaded == cfg


def test_load_returns_none_when_missing(tmp_model_dir: Path):
    assert load_user_config("10.0.0.1") is None


def test_save_creates_file_under_dir(tmp_model_dir: Path):
    cfg = ModelConfig(provider="openai", model="gpt-4o", context_window=128_000)
    save_user_config("127.0.0.1", cfg)
    files = list(tmp_model_dir.glob("*.json"))
    assert len(files) == 1


def test_save_dedupes_identical_content(tmp_model_dir: Path):
    cfg = ModelConfig(provider="anthropic", model="MiniMax-M3", context_window=1_000_000)
    save_user_config("127.0.0.1", cfg)
    save_user_config("127.0.0.1", cfg)
    files = list(tmp_model_dir.glob("*.json"))
    assert len(files) == 1


def test_load_corrupt_file_returns_none(tmp_model_dir: Path):
    (tmp_model_dir / "127.0.0.1.json").write_text("not json{")
    assert load_user_config("127.0.0.1") is None