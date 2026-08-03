import json
from pathlib import Path

import pytest
from django.test import Client
from worktracker.tests.factories import ensure_issue


@pytest.fixture(autouse=True)
def seeded_agent_run_issues(request):
    if request.node.get_closest_marker("django_db") is None:
        return
    ensure_issue(project_id="p1", module_id="m1", task_id="t1")
    ensure_issue(project_id="p1", module_id="m2", task_id=None)


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """Redirect profile storage to a temporary file."""

    config_dir = tmp_path / "settings"
    config_file = config_dir / "profiles.json"
    from apps.settings_store import config as config_module

    monkeypatch.setattr(config_module, "CONFIG_DIR", config_dir)
    monkeypatch.setattr(config_module, "CONFIG_FILE", config_file)
    return config_file


def write_profiles(config_file: Path, profiles, recent=None):
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(
        json.dumps({"recent_profile_index": recent, "profiles": profiles})
    )


@pytest.fixture
def client():
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
