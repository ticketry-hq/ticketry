import json

import pytest

from worktracker.models import AgentModel, LaunchBinding, Provider, ReasoningLevel


pytestmark = pytest.mark.django_db


def _put(client, url, body, auth):
    return client.put(
        url,
        data=json.dumps(body),
        content_type="application/json",
        headers=auth,
    )


def _catalog_model():
    provider = Provider.objects.get(slug="codex")
    model = AgentModel.objects.create(provider=provider, name="gpt-catalog-crud")
    allowed = ReasoningLevel.objects.get(name="high")
    rejected = ReasoningLevel.objects.get(name="max")
    model.permitted_reasoning_levels.add(allowed)
    return model, allowed, rejected


def test_composite_write_rejects_reasoning_not_permitted_for_model(
    client, auth, task_type, state
):
    model, _allowed, rejected = _catalog_model()
    url = (
        f"/api/work-tracker/issue-types/{task_type.id}/workflow-settings/"
        f"launch-bindings/{state.id}"
    )

    response = _put(
        client,
        url,
        {
            "workflow_revision": 0,
            "prompt": "Implement the selected work item.",
            "model": str(model.id),
            "reasoning": str(rejected.id),
        },
        auth,
    )

    assert response.status_code == 400
    assert "not permitted" in str(response.json()["reasoning"])
    assert not LaunchBinding.objects.exists()


def test_composite_write_rejects_automation_without_launch_configuration(
    client, auth, task_type, state
):
    url = (
        f"/api/work-tracker/issue-types/{task_type.id}/workflow-settings/"
        f"launch-bindings/{state.id}"
    )

    response = _put(
        client,
        url,
        {"workflow_revision": 0, "auto_start": True},
        auth,
    )

    assert response.status_code == 400
    assert "Configure a launch binding" in str(response.json())
    assert not LaunchBinding.objects.exists()


@pytest.mark.parametrize("method", ("put", "delete"))
def test_composite_write_rejects_a_missing_revision_as_bad_input(
    method, client, auth, task_type, state
):
    url = (
        f"/api/work-tracker/issue-types/{task_type.id}/workflow-settings/"
        f"launch-bindings/{state.id}"
    )

    response = getattr(client, method)(
        url,
        data=json.dumps({}),
        content_type="application/json",
        headers=auth,
    )

    assert response.status_code == 400
    assert response.json() == {"workflow_revision": ["This field is required."]}


def test_composite_crud_returns_the_row_and_persists_ordinary_flag_fields(
    client, auth, project, task_type, state
):
    model, allowed, _rejected = _catalog_model()
    detail_url = (
        f"/api/work-tracker/issue-types/{task_type.id}/workflow-settings/"
        f"launch-bindings/{state.id}"
    )

    created = _put(
        client,
        detail_url,
        {
            "workflow_revision": 0,
            "prompt": "Implement the selected work item.",
            "model": str(model.id),
            "reasoning": str(allowed.id),
            "auto_start": True,
            "subtree_run_enabled": True,
        },
        auth,
    )

    assert created.status_code == 201
    assert created.json()["issue_type"] == str(task_type.id)
    assert created.json()["state"] == str(state.id)
    assert created.json()["model"] == str(model.id)
    assert created.json()["reasoning"] == str(allowed.id)
    assert created.json()["auto_start"] is True
    assert created.json()["subtree_run_enabled"] is True
    assert "launch_bindings" not in created.json()

    listed = client.get(
        f"/api/work-tracker/projects/{project.id}/launch-bindings", headers=auth
    )
    assert listed.status_code == 200
    assert listed.json() == [created.json()]

    deleted = client.delete(
        detail_url,
        data=json.dumps({"workflow_revision": 1}),
        content_type="application/json",
        headers=auth,
    )
    assert deleted.status_code == 204
    assert not LaunchBinding.objects.exists()


def test_subtree_run_capabilities_and_standalone_flag_routes_do_not_resolve(
    client, auth, project, task_type, state
):
    assert (
        client.get(
            f"/api/work-tracker/projects/{project.id}/subtree-run-capabilities",
            headers=auth,
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/work-tracker/issue-types/{task_type.id}/workflow-settings/"
            f"launch-bindings/{state.id}/auto-start",
            data=json.dumps({"auto_start": True, "workflow_revision": 0}),
            content_type="application/json",
            headers=auth,
        ).status_code
        == 404
    )


def test_global_default_write_validates_the_catalog_triple(client, auth):
    provider = Provider.objects.get(slug="codex")
    model = AgentModel.objects.create(provider=provider, name="gpt-global-default")
    allowed = ReasoningLevel.objects.get(name="high")
    rejected = ReasoningLevel.objects.get(name="max")
    model.permitted_reasoning_levels.add(allowed)
    url = "/api/settings/provider-catalog"

    invalid = client.put(
        url,
        data=json.dumps(
            {
                "value": {
                    "global_default": {
                        "provider": "codex",
                        "model": model.name,
                        "reasoning": rejected.name,
                    }
                }
            }
        ),
        content_type="application/json",
        headers=auth,
    )
    assert invalid.status_code == 422

    valid = client.put(
        url,
        data=json.dumps(
            {
                "value": {
                    "global_default": {
                        "provider": "codex",
                        "model": model.name,
                        "reasoning": allowed.name,
                    }
                }
            }
        ),
        content_type="application/json",
        headers=auth,
    )
    assert valid.status_code == 200
