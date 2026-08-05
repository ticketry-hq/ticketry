"""Atomic profile persistence never leaves a partial settings file."""

import json
import os

import pytest

from apps.settings_store import config as config_mod
from apps.settings_store.config import Config, Profile


SEED_PAYLOAD = {
    "recent_profile_index": 0,
    "profiles": [{"name": "seed", "workspace_slug": "seed-ws"}],
}


@pytest.fixture
def isolated_config(tmp_path, monkeypatch):
    config_dir = tmp_path / "settings"
    config_dir.mkdir()
    config_file = config_dir / "profiles.json"
    seed_text = json.dumps(SEED_PAYLOAD, indent=4)
    config_file.write_text(seed_text)
    monkeypatch.setattr(config_mod, "CONFIG_DIR", config_dir)
    monkeypatch.setattr(config_mod, "CONFIG_FILE", config_file)
    return config_dir, config_file, seed_text


def _config_with_profile():
    config = Config.__new__(Config)
    config.profiles = [Profile(name="new", workspace_slug="new-ws")]
    config.current_profile_index = 0
    config.recent_profile_index = None
    return config


def test_crash_during_temp_write_leaves_original_intact(isolated_config, monkeypatch):
    config_dir, config_file, seed_text = isolated_config
    real_fdopen = os.fdopen

    class ExplodingWriter:
        def __init__(self, real):
            self.real = real

        def __enter__(self):
            self.real.__enter__()
            return self

        def __exit__(self, *args):
            self.real.__exit__(*args)
            return False

        def write(self, _data):
            raise OSError("simulated mid-write crash")

    monkeypatch.setattr(config_mod.os, "fdopen", lambda fd, mode: ExplodingWriter(real_fdopen(fd, mode)))

    with pytest.raises(OSError):
        _config_with_profile().save_profiles()

    assert config_file.read_text() == seed_text
    assert [path for path in config_dir.iterdir() if path.suffix == ".tmp"] == []


def test_crash_during_replace_leaves_original_intact(isolated_config, monkeypatch):
    _config_dir, config_file, seed_text = isolated_config

    def fail_replace(_source, _destination):
        raise OSError("simulated replace crash")

    monkeypatch.setattr(config_mod.os, "replace", fail_replace)
    with pytest.raises(OSError):
        _config_with_profile().save_profiles()

    assert config_file.read_text() == seed_text


def test_successful_save_writes_new_content(isolated_config):
    _config_dir, config_file, _seed_text = isolated_config
    _config_with_profile().save_profiles()
    assert json.loads(config_file.read_text())["profiles"] == [
        {
            "name": "new",
            "workspace_slug": "new-ws",
            "agent_prompt": None,
            "agent_prompts": {},
            "module_links": [],
            "recent_project_id": None,
            "recent_module_ids": {},
        }
    ]
