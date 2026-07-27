import pytest

from apps.settings_store.models import AppSetting


pytestmark = pytest.mark.django_db


def test_missing_provider_catalog_uses_first_run_defaults(client):
    response = client.get("/api/settings/provider-catalog")

    assert response.status_code == 200
    assert response.json() == {
        "value": {
            "activated_providers": ["claude", "codex", "gemini"],
            "global_default": None,
        }
    }


def test_provider_catalog_round_trips_as_one_host_scoped_setting(client):
    catalog = {
        "activated_providers": ["claude", "codex"],
        "global_default": {
            "provider": "codex",
            "model": "gpt-5",
            "reasoning": "high",
        },
    }

    response = client.put(
        "/api/settings/provider-catalog",
        data={"value": catalog},
        content_type="application/json",
    )

    assert response.status_code == 200
    # The save also reports its blast radius — how many launch bindings this
    # activation set now blocks. No bindings exist here, so none.
    assert response.json() == {"value": catalog, "blocked_launch_bindings": 0}
    setting = AppSetting.objects.get()
    assert (setting.scope, setting.key) == ("host", "provider_catalog")
    assert client.get("/api/settings/provider-catalog").json() == {"value": catalog}


def _launch_binding(agent: str) -> None:
    """One launch binding pinned to ``agent``, in its own type/state pair."""

    import uuid

    from worktracker.models import (
        IssueType,
        LaunchBinding,
        Project,
        State,
        Workspace,
    )

    workspace, _ = Workspace.objects.get_or_create(
        slug="ws", defaults={"id": uuid.uuid4(), "name": "ws"}
    )
    project, _ = Project.objects.get_or_create(
        slug="P", defaults={"id": uuid.uuid4(), "workspace": workspace, "name": "P"}
    )
    LaunchBinding.objects.create(
        issue_type=IssueType.objects.create(
            id=uuid.uuid4(), project=project, name=f"Type {agent}", level="task"
        ),
        state=State.objects.create(
            id=uuid.uuid4(), project=project, name=f"State {agent}", group="started"
        ),
        prompt="do the thing",
        agent=agent,
    )


def test_the_impact_preview_counts_bindings_a_deactivation_would_block(client):
    """Every other workflow mutation shows its blast radius before committing."""

    _launch_binding("codex")
    _launch_binding("claude")

    response = client.post(
        "/api/settings/provider-catalog/impact",
        data={
            "value": {
                "activated_providers": ["claude", "gemini"],
                "global_default": None,
            }
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json() == {"blocked_launch_bindings": 1}
    # A preview saves nothing.
    assert not AppSetting.objects.exists()


def test_the_impact_preview_reports_nothing_when_nothing_is_deactivated(client):
    response = client.post(
        "/api/settings/provider-catalog/impact",
        data={
            "value": {
                "activated_providers": ["claude", "codex", "gemini"],
                "global_default": None,
            }
        },
        content_type="application/json",
    )

    assert response.json() == {"blocked_launch_bindings": 0}


@pytest.mark.parametrize(
    "catalog",
    [
        {
            "activated_providers": ["claude", "agy"],
            "global_default": None,
        },
        {
            "activated_providers": ["claude"],
            "global_default": {
                "provider": "codex",
                "model": "gpt-5",
                "reasoning": "high",
            },
        },
        {
            "activated_providers": ["codex"],
            "global_default": {
                "provider": "codex",
                "model": "claude-opus-4",
                "reasoning": "high",
            },
        },
        {
            "activated_providers": ["gemini"],
            "global_default": {
                "provider": "gemini",
                "model": "gemini-2.5-pro",
                "reasoning": "high",
            },
        },
    ],
)
def test_provider_catalog_rejects_invalid_schema_without_persisting(client, catalog):
    response = client.put(
        "/api/settings/provider-catalog",
        data={"value": catalog},
        content_type="application/json",
    )

    assert response.status_code == 422
    assert not AppSetting.objects.exists()
