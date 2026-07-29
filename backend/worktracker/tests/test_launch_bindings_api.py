import json
import uuid

import pytest

from apps.settings_store.models import AppSetting
from worktracker.models import IssueType, LaunchBinding, State
from worktracker.tests.conftest import BASE


@pytest.fixture
def binding_ids(project):
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Change", level="task"
    )
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Build", group="started"
    )
    return issue_type.id, state.id


@pytest.mark.django_db
def test_list_active_launch_binding(client, project, binding_ids, auth):
    issue_type_id, state_id = binding_ids
    LaunchBinding.objects.create(
        issue_type_id=issue_type_id,
        state_id=state_id,
        prompt="Use the runbook exactly as written.",
        required_skills=["to-tickets", "to-spec"],
        agent="claude",
        model="sonnet",
        reasoning="high",
    )

    listed = client.get(f"{BASE}/projects/{project.id}/launch-bindings", headers=auth)

    assert listed.status_code == 200
    assert listed.json() == [
        {
            "issue_type_id": str(issue_type_id),
            "state_id": str(state_id),
            "prompt": "Use the runbook exactly as written.",
            "required_skills": ["to-tickets", "to-spec"],
            "agent": "claude",
            "model": "sonnet",
            "reasoning": "high",
        }
    ]


@pytest.mark.django_db
def test_immediate_launch_binding_put_is_removed(client, project, binding_ids, auth):
    issue_type_id, state_id = binding_ids

    response = client.put(
        (f"{BASE}/projects/{project.id}/launch-bindings/{issue_type_id}/{state_id}"),
        data=json.dumps(
            {
                "prompt": "Use the runbook.",
                "agent": "gemini",
                "model": "gemini-3.1-pro-preview",
                "reasoning": "high",
            }
        ),
        content_type="application/json",
        headers=auth,
    )

    assert response.status_code == 404
    assert not LaunchBinding.objects.exists()


@pytest.mark.django_db
def test_provider_capabilities_are_exposed_to_settings(client, auth):
    response = client.get(f"{BASE}/launch-bindings/provider-capabilities", headers=auth)

    assert response.status_code == 200
    capabilities = {row["agent"]: row for row in response.json()}
    assert capabilities["claude"]["reasoning_levels"] == [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    ]
    assert capabilities["gemini"]["reasoning_levels"] == []
    assert capabilities["gemini"]["model_prefixes"] == ["gemini-"]
    assert capabilities["gemini"]["accepts_any_model"] is False
    assert "agy" not in capabilities


@pytest.mark.django_db
def test_provider_capabilities_omit_deactivated_providers(client, auth):
    AppSetting.objects.create(
        scope="host",
        key="provider_catalog",
        value='{"activated_providers":["claude","gemini"],"global_default":null}',
        updated_at="2026-07-25T00:00:00+00:00",
    )

    response = client.get(f"{BASE}/launch-bindings/provider-capabilities", headers=auth)

    assert response.status_code == 200
    assert [row["agent"] for row in response.json()] == ["claude", "gemini"]
