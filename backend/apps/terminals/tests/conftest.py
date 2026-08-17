import json

import pytest
from django.test import Client

import apps.terminals.launch as session_module
from apps.terminals.launch_configuration import ResolvedLaunchConfiguration
from worktracker.tests.factories import ensure_issue


@pytest.fixture(autouse=True)
def seeded_agent_run_issues(request):
    """Seed the readable work-item ids used by terminal integration fixtures."""

    if request.node.get_closest_marker("django_db") is None:
        return
    for project_id, module_id, task_ids in (
        ("p1", "m1", ("t1", "t-runtime-urls")),
        ("proj-1", "mod-1", ("task-1", "task-2")),
        ("proj-1", "mod-2", ("task-2",)),
        ("project-1", "module-1", ("task-1",)),
        ("project-1", "module-2", ()),
        ("project-2", "module-1", ()),
        ("project-789", "module-456", ("task-123",)),
    ):
        ensure_issue(project_id=project_id, module_id=module_id, task_id=None)
        for task_id in task_ids:
            ensure_issue(project_id=project_id, module_id=module_id, task_id=task_id)


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
            state_name="Todo",
        )

    monkeypatch.setattr(session_module, "resolve_task_launch_configuration", resolve)


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
        "module_links": [],
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
