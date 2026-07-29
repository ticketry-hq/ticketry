import json
from pathlib import Path

import pytest
from django.test import Client


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """Redirect installation configuration to a temporary directory."""

    config_dir = tmp_path / "settings"
    config_file = config_dir / "profiles.json"
    features_file = config_dir / "features.json"
    from apps.settings_store import config as config_module

    monkeypatch.setattr(config_module, "CONFIG_DIR", config_dir)
    monkeypatch.setattr(config_module, "CONFIG_FILE", config_file)
    monkeypatch.setattr(config_module, "FEATURES_FILE", features_file)
    monkeypatch.setattr(config_module, "features", config_module.load_features())
    return config_file


def write_profiles(config_file: Path, profiles, recent=None):
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(
        json.dumps({"recent_profile_index": recent, "profiles": profiles})
    )


@pytest.fixture
def client(tmp_config):
    return Client()


@pytest.fixture
def sample_profile():
    return {
        "name": "Default",
        "workspace_slug": "ws",
        "agent_prompt": None,
        "agent_prompts": {},
        "module_folders": {},
        "recent_project_id": None,
        "recent_module_ids": {},
    }
