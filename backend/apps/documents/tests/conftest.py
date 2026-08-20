import pytest
from django.test import Client
from worktracker.tests.factories import ensure_issue


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture(autouse=True)
def seeded_agent_run_issues(request):
    if request.node.get_closest_marker("django_db") is None:
        return
    ensure_issue(project_id="p1", module_id="m1", task_id="t1")
    ensure_issue(project_id="p1", module_id="m2", task_id=None)


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """Provide an isolated typed Module-link lookup for document tests."""

    from apps.documents import service

    links = {}
    monkeypatch.setattr(service, "resolve_module_path", lambda module_id: links.get(str(module_id)))
    return links


def write_profiles(config_file, profiles, recent=None):
    del recent
    config_file.clear()
    for profile in profiles:
        for link in profile.get("module_links", []):
            config_file[str(link["module_id"])] = link.get("path")


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
        "module_links": [],
        "recent_project_id": None,
        "recent_module_ids": {},
    }
