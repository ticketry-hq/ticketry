"""HTTP contract tests for decomposed issue-type workflow resources."""

import json
import uuid

import pytest

from worktracker.models import IssueType, IssueTypeTransition, LaunchBinding, State


pytestmark = pytest.mark.django_db


def _json(client, method, url, body, auth):
    return getattr(client, method)(
        url,
        data=json.dumps(body),
        content_type="application/json",
        headers=auth,
    )


@pytest.fixture
def workflow(project):
    states = {
        name: State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=name,
            group=group,
            sort_order=sort_order,
        )
        for sort_order, (name, group) in enumerate(
            (
                ("Ready", "unstarted"),
                ("Build", "started"),
                ("Done", "completed"),
            )
        )
    }
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Implementation",
        level="task",
        start_state=states["Ready"],
    )
    return issue_type, states


def test_transition_crud_is_canonical_and_revision_guarded(client, auth, workflow):
    issue_type, states = workflow
    collection = f"/api/work-tracker/issue-types/{issue_type.id}/transitions"
    detail = f"{collection}/{states['Ready'].id}/{states['Build'].id}"

    created = _json(
        client,
        "post",
        collection,
        {
            "from_state": str(states["Ready"].id),
            "to_state": str(states["Build"].id),
            "agent_allowed": True,
            "workflow_revision": 0,
        },
        auth,
    )

    assert created.status_code == 201
    assert created.json() == {
        "id": created.json()["id"],
        "issue_type": str(issue_type.id),
        "from_state": str(states["Ready"].id),
        "to_state": str(states["Build"].id),
        "agent_allowed": True,
    }
    assert client.get(collection, headers=auth).json() == [created.json()]

    missing_revision = _json(client, "patch", detail, {"agent_allowed": False}, auth)
    assert missing_revision.status_code == 422

    updated = _json(
        client,
        "patch",
        detail,
        {"agent_allowed": False, "workflow_revision": 1},
        auth,
    )
    assert updated.status_code == 200
    assert updated.json()["agent_allowed"] is False

    stale = _json(client, "delete", detail, {"workflow_revision": 1}, auth)
    assert stale.status_code == 409
    assert IssueTypeTransition.objects.filter(issue_type=issue_type).exists()

    deleted = _json(client, "delete", detail, {"workflow_revision": 2}, auth)
    assert deleted.status_code == 204
    assert client.get(collection, headers=auth).json() == []


def test_transition_delete_prunes_disconnected_edges_and_bindings_from_reads(
    client, auth, project, workflow
):
    issue_type, states = workflow
    IssueTypeTransition.objects.bulk_create(
        (
            IssueTypeTransition(
                issue_type=issue_type,
                from_state=states["Ready"],
                to_state=states["Build"],
            ),
            IssueTypeTransition(
                issue_type=issue_type,
                from_state=states["Build"],
                to_state=states["Done"],
            ),
        )
    )
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Build"],
        prompt="Build the work item.",
    )
    transitions_url = f"/api/work-tracker/issue-types/{issue_type.id}/transitions"
    edge_url = f"{transitions_url}/{states['Ready'].id}/{states['Build'].id}"

    response = _json(client, "delete", edge_url, {"workflow_revision": 0}, auth)

    assert response.status_code == 204
    assert client.get(transitions_url, headers=auth).json() == []
    assert (
        client.get(
            f"/api/work-tracker/projects/{project.id}/launch-bindings", headers=auth
        ).json()
        == []
    )
    issue_type.refresh_from_db()
    assert issue_type.workflow_revision == 1


def test_start_state_is_changed_by_issue_type_update_and_prunes_atomically(
    client, auth, workflow
):
    issue_type, states = workflow
    ready_to_build = IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=states["Ready"],
        to_state=states["Build"],
    )
    build_to_done = IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=states["Build"],
        to_state=states["Done"],
    )
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Ready"],
        prompt="Prepare the work item.",
    )
    url = f"/api/work-tracker/issue-types/{issue_type.id}"

    changed = _json(
        client,
        "patch",
        url,
        {
            "name": "Renamed implementation",
            "start_state": str(states["Build"].id),
            "workflow_revision": 0,
        },
        auth,
    )

    assert changed.status_code == 200
    assert changed.json()["name"] == "Renamed implementation"
    assert changed.json()["start_state"] == str(states["Build"].id)
    assert changed.json()["workflow_revision"] == 1
    assert not IssueTypeTransition.objects.filter(pk=ready_to_build.pk).exists()
    assert IssueTypeTransition.objects.filter(pk=build_to_done.pk).exists()
    assert not LaunchBinding.objects.filter(
        issue_type=issue_type, state=states["Ready"]
    ).exists()

    stale = _json(
        client,
        "patch",
        url,
        {
            "name": "Must roll back",
            "start_state": str(states["Done"].id),
            "workflow_revision": 0,
        },
        auth,
    )
    assert stale.status_code == 409
    issue_type.refresh_from_db()
    assert issue_type.name == "Renamed implementation"
    assert issue_type.start_state_id == states["Build"].id


def test_workflow_settings_composite_and_start_state_write_no_longer_resolve(
    client, auth, workflow
):
    issue_type, states = workflow
    composite = f"/api/work-tracker/issue-types/{issue_type.id}/workflow-settings"

    assert client.get(composite, headers=auth).status_code == 404
    assert (
        _json(
            client,
            "put",
            f"{composite}/start-state",
            {"state_id": str(states["Build"].id), "workflow_revision": 0},
            auth,
        ).status_code
        == 404
    )


def test_remove_state_from_workflow_remains_a_revision_guarded_domain_operation(
    client, auth, workflow
):
    issue_type, states = workflow
    IssueTypeTransition.objects.bulk_create(
        (
            IssueTypeTransition(
                issue_type=issue_type,
                from_state=states["Ready"],
                to_state=states["Build"],
            ),
            IssueTypeTransition(
                issue_type=issue_type,
                from_state=states["Build"],
                to_state=states["Done"],
            ),
        )
    )
    url = (
        f"/api/work-tracker/issue-types/{issue_type.id}/workflow-settings/"
        f"states/{states['Build'].id}"
    )

    assert (
        _json(client, "delete", url, {"workflow_revision": 1}, auth).status_code == 409
    )
    removed = _json(client, "delete", url, {"workflow_revision": 0}, auth)

    assert removed.status_code == 204
    assert State.objects.filter(pk=states["Build"].id).exists()
    assert not IssueTypeTransition.objects.filter(issue_type=issue_type).exists()
