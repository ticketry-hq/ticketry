import json

import pytest
from django.test import Client

import apps.terminals.session as session_module
from apps.terminals.launch_configuration import ResolvedLaunchConfiguration


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """Redirect profile storage to a temporary file."""

    config_dir = tmp_path / "settings"
    config_file = config_dir / "profiles.json"
    from apps.settings_store import config as config_module

    monkeypatch.setattr(config_module, "CONFIG_DIR", config_dir)
    monkeypatch.setattr(config_module, "CONFIG_FILE", config_file)
    return config_file


@pytest.fixture(autouse=True)
def default_task_launch_configuration(monkeypatch):
    """Keep legacy terminal harnesses focused on their own spawn concern.

    Tests for the real type/state resolver override this seam explicitly.
    """

    def resolve(task_id, *, agent_override=None):
        del task_id
        return ResolvedLaunchConfiguration(
            prompt="TEST WORKFLOW PROMPT",
            agent=agent_override or "claude",
            model=None,
            reasoning=None,
        )

    monkeypatch.setattr(
        session_module, "resolve_task_launch_configuration", resolve
    )


def write_profiles(config_file, profiles, recent=None):
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(
        json.dumps({"recent_profile_index": recent, "profiles": profiles})
    )


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


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def configured(tmp_config, sample_profile):
    write_profiles(tmp_config, [sample_profile], recent=0)
    return tmp_config
