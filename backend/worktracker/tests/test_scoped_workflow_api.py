import json
import uuid

import pytest

from worktracker.models import IssueType, IssueTypeTransition, LaunchBinding, State
from worktracker.tests.conftest import BASE


def _json_request(client, method, url, body, auth):
    return getattr(client, method)(
        url,
        data=json.dumps(body),
        content_type="application/json",
        headers=auth,
    )


def _preview(client, issue_type, body, auth):
    return _json_request(
        client,
        "post",
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/impact",
        body,
        auth,
    )


@pytest.fixture
def scoped_workflow(project):
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
                ("Cancelled", "cancelled"),
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
    IssueTypeTransition.objects.bulk_create(
        [
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
        ]
    )
    return issue_type, states


@pytest.mark.django_db
def test_read_returns_live_per_type_policy_and_standing_warnings(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Build"],
        prompt="Build the work",
        agent="codex",
        auto_start=True,
    )

    response = client.get(
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings", headers=auth
    )

    assert response.status_code == 200
    body = response.json()
    assert body["issue_type_id"] == str(issue_type.id)
    assert body["start_state_id"] == str(states["Ready"].id)
    assert body["workflow_revision"] == 0
    assert body["transitions"] == [
        {
            "from_state_id": str(states["Ready"].id),
            "to_state_id": str(states["Build"].id),
            "agent_allowed": True,
        },
        {
            "from_state_id": str(states["Build"].id),
            "to_state_id": str(states["Done"].id),
            "agent_allowed": True,
        },
    ]
    assert body["launch_bindings"] == [
        {
            "state_id": str(states["Build"].id),
            "prompt": "Build the work",
            "agent": "codex",
            "model": None,
            "reasoning": None,
            "auto_start": True,
            "subtree_run_enabled": False,
        }
    ]
    assert body["warnings"] == []


@pytest.mark.django_db
def test_read_warns_only_for_member_states_without_a_path_to_completed(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=states["Ready"],
        to_state=states["Cancelled"],
    )

    response = client.get(
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings", headers=auth
    )

    assert response.status_code == 200
    assert {
        (warning["code"], warning["state_id"])
        for warning in response.json()["warnings"]
    } == {
        ("no_path_to_completed", str(states["Cancelled"].id)),
    }


@pytest.mark.django_db
def test_read_warns_when_start_state_is_not_configured(
    client, scoped_workflow, auth
):
    issue_type, _ = scoped_workflow
    issue_type.start_state = None
    issue_type.save(update_fields=["start_state"])

    response = client.get(
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings", headers=auth
    )

    assert response.status_code == 200
    assert response.json()["warnings"] == [
        {
            "code": "start_state_not_configured",
            "state_id": None,
            "message": "No start state is configured for this work-item type.",
        }
    ]


@pytest.mark.django_db
def test_scoped_transition_edits_apply_despite_an_unrelated_dead_end(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    base = f"{BASE}/issue-types/{issue_type.id}/workflow-settings/transitions"

    added = _json_request(
        client,
        "post",
        base,
        {
            "from_state_id": str(states["Ready"].id),
            "to_state_id": str(states["Done"].id),
            "agent_allowed": True,
            "workflow_revision": 0,
        },
        auth,
    )
    assert added.status_code == 200
    assert added.json()["workflow_revision"] == 1
    assert added.json()["warnings"] == []

    edge_url = f"{base}/{states['Ready'].id}/{states['Done'].id}"
    restricted = _json_request(
        client,
        "patch",
        edge_url,
        {"agent_allowed": False, "workflow_revision": 1},
        auth,
    )
    assert restricted.status_code == 200
    assert restricted.json()["workflow_revision"] == 2
    assert (
        IssueTypeTransition.objects.get(
            issue_type=issue_type,
            from_state=states["Ready"],
            to_state=states["Done"],
        ).agent_allowed
        is False
    )

    removed = _json_request(
        client,
        "delete",
        edge_url,
        {"workflow_revision": 2},
        auth,
    )
    assert removed.status_code == 200
    assert removed.json()["workflow_revision"] == 3
    assert not IssueTypeTransition.objects.filter(
        issue_type=issue_type,
        from_state=states["Ready"],
        to_state=states["Done"],
    ).exists()


@pytest.mark.django_db
def test_remove_state_preview_matches_cascading_deletion_and_preserves_catalog(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=states["Build"],
        to_state=states["Cancelled"],
    )
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Build"],
        prompt="Build",
        agent="codex",
        auto_start=True,
    )
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Cancelled"],
        prompt="Cancel",
        agent="codex",
    )

    preview = _preview(
        client,
        issue_type,
        {
            "operation": "remove_state",
            "state_id": str(states["Build"].id),
            "workflow_revision": 0,
        },
        auth,
    )

    assert preview.status_code == 200
    impact = preview.json()
    assert impact["workflow_revision"] == 0
    assert {
        (edge["from_state_id"], edge["to_state_id"])
        for edge in impact["deleted_transitions"]
    } == {
        (str(states["Ready"].id), str(states["Build"].id)),
        (str(states["Build"].id), str(states["Done"].id)),
        (str(states["Build"].id), str(states["Cancelled"].id)),
    }
    assert {
        binding["state_id"] for binding in impact["deleted_launch_bindings"]
    } == {
        str(states["Build"].id),
        str(states["Cancelled"].id),
    }
    assert impact["disabled_auto_start_state_ids"] == [
        str(states["Build"].id)
    ]

    removed = _json_request(
        client,
        "delete",
        (
            f"{BASE}/issue-types/{issue_type.id}/workflow-settings/"
            f"states/{states['Build'].id}"
        ),
        {"workflow_revision": 0},
        auth,
    )

    assert removed.status_code == 200
    assert removed.json()["workflow_revision"] == 1
    assert removed.json()["transitions"] == []
    assert removed.json()["launch_bindings"] == []
    assert State.objects.filter(pk=states["Build"].id).exists()


@pytest.mark.django_db
def test_remove_state_rejects_the_start_state(client, scoped_workflow, auth):
    issue_type, states = scoped_workflow

    preview = _preview(
        client,
        issue_type,
        {
            "operation": "remove_state",
            "state_id": str(states["Ready"].id),
            "workflow_revision": 0,
        },
        auth,
    )

    assert preview.status_code == 422
    assert "start state" in preview.json()["detail"].lower()

    removed = _json_request(
        client,
        "delete",
        (
            f"{BASE}/issue-types/{issue_type.id}/workflow-settings/"
            f"states/{states['Ready'].id}"
        ),
        {"workflow_revision": 0},
        auth,
    )
    assert removed.status_code == 422
    assert IssueTypeTransition.objects.filter(issue_type=issue_type).count() == 2


@pytest.mark.django_db
def test_remove_transition_prunes_disconnected_edges_and_bindings(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Build"],
        prompt="Build",
        agent="codex",
    )
    edge_url = (
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/transitions/"
        f"{states['Ready'].id}/{states['Build'].id}"
    )

    preview = _preview(
        client,
        issue_type,
        {
            "operation": "remove_transition",
            "from_state_id": str(states["Ready"].id),
            "to_state_id": str(states["Build"].id),
            "workflow_revision": 0,
        },
        auth,
    )

    assert preview.status_code == 200
    assert len(preview.json()["deleted_transitions"]) == 2
    assert [
        row["state_id"]
        for row in preview.json()["deleted_launch_bindings"]
    ] == [str(states["Build"].id)]

    removed = _json_request(
        client, "delete", edge_url, {"workflow_revision": 0}, auth
    )

    assert removed.status_code == 200
    assert removed.json()["transitions"] == []
    assert removed.json()["launch_bindings"] == []


@pytest.mark.django_db
def test_set_start_state_prunes_disconnected_configuration(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Ready"],
        prompt="Ready",
        agent="codex",
        auto_start=True,
    )

    preview = _preview(
        client,
        issue_type,
        {
            "operation": "set_start_state",
            "state_id": str(states["Build"].id),
            "workflow_revision": 0,
        },
        auth,
    )

    assert preview.status_code == 200
    assert preview.json()["deleted_transitions"] == [
        {
            "from_state_id": str(states["Ready"].id),
            "to_state_id": str(states["Build"].id),
            "agent_allowed": True,
        }
    ]
    assert preview.json()["disabled_auto_start_state_ids"] == [
        str(states["Ready"].id)
    ]

    changed = _json_request(
        client,
        "put",
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/start-state",
        {"state_id": str(states["Build"].id), "workflow_revision": 0},
        auth,
    )

    assert changed.status_code == 200
    assert changed.json()["start_state_id"] == str(states["Build"].id)
    assert changed.json()["transitions"] == [
        {
            "from_state_id": str(states["Build"].id),
            "to_state_id": str(states["Done"].id),
            "agent_allowed": True,
        }
    ]
    assert changed.json()["launch_bindings"] == []


@pytest.mark.django_db
def test_pruning_write_rejects_revision_stale_since_preview(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    preview = _preview(
        client,
        issue_type,
        {
            "operation": "remove_transition",
            "from_state_id": str(states["Ready"].id),
            "to_state_id": str(states["Build"].id),
            "workflow_revision": 0,
        },
        auth,
    )
    assert preview.status_code == 200
    issue_type.workflow_revision = 1
    issue_type.save(update_fields=["workflow_revision"])

    removed = _json_request(
        client,
        "delete",
        (
            f"{BASE}/issue-types/{issue_type.id}/workflow-settings/transitions/"
            f"{states['Ready'].id}/{states['Build'].id}"
        ),
        {"workflow_revision": 0},
        auth,
    )

    assert removed.status_code == 409
    assert IssueTypeTransition.objects.filter(issue_type=issue_type).count() == 2


@pytest.mark.django_db
def test_scoped_writes_reject_stale_workflow_revisions(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    url = f"{BASE}/issue-types/{issue_type.id}/workflow-settings/start-state"

    fresh = _json_request(
        client,
        "put",
        url,
        {"state_id": str(states["Build"].id), "workflow_revision": 0},
        auth,
    )
    assert fresh.status_code == 200
    assert fresh.json()["workflow_revision"] == 1

    stale = _json_request(
        client,
        "put",
        url,
        {"state_id": str(states["Done"].id), "workflow_revision": 0},
        auth,
    )
    assert stale.status_code == 409

    reread = client.get(
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings", headers=auth
    )
    assert reread.status_code == 200
    assert reread.json()["workflow_revision"] == 1
    assert reread.json()["start_state_id"] == str(states["Build"].id)


@pytest.mark.django_db
def test_auto_start_requires_a_valid_binding_at_that_edit(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    binding_url = (
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/"
        f"launch-bindings/{states['Build'].id}"
    )
    auto_start_url = f"{binding_url}/auto-start"

    missing = _json_request(
        client,
        "patch",
        auto_start_url,
        {"auto_start": True, "workflow_revision": 0},
        auth,
    )
    assert missing.status_code == 422

    configured = _json_request(
        client,
        "put",
        binding_url,
        {
            "prompt": "Build the work",
            "agent": "codex",
            "model": None,
            "reasoning": None,
            "workflow_revision": 0,
        },
        auth,
    )
    assert configured.status_code == 200
    assert configured.json()["workflow_revision"] == 1

    armed = _json_request(
        client,
        "patch",
        auto_start_url,
        {"auto_start": True, "workflow_revision": 1},
        auth,
    )
    assert armed.status_code == 200
    assert armed.json()["workflow_revision"] == 2
    assert LaunchBinding.objects.get(
        issue_type=issue_type, state=states["Build"]
    ).auto_start is True
    assert armed.json()["warnings"] == []

    invalid_reconfiguration = _json_request(
        client,
        "put",
        binding_url,
        {
            "prompt": "",
            "agent": None,
            "model": None,
            "reasoning": None,
            "workflow_revision": 2,
        },
        auth,
    )
    assert invalid_reconfiguration.status_code == 422
    issue_type.refresh_from_db()
    assert issue_type.workflow_revision == 2
    binding = LaunchBinding.objects.get(
        issue_type=issue_type, state=states["Build"]
    )
    assert binding.prompt == "Build the work"
    assert binding.auto_start is True


@pytest.mark.django_db
def test_subtree_run_can_create_an_empty_binding_and_rejects_stale_revisions(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    url = (
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/"
        f"launch-bindings/{states['Build'].id}/subtree-run"
    )

    enabled = _json_request(
        client,
        "put",
        url,
        {"enabled": True, "workflow_revision": 0},
        auth,
    )

    assert enabled.status_code == 200
    assert enabled.json()["workflow_revision"] == 1
    assert enabled.json()["launch_bindings"] == [
        {
            "state_id": str(states["Build"].id),
            "prompt": "",
            "agent": None,
            "model": None,
            "reasoning": None,
            "auto_start": False,
            "subtree_run_enabled": True,
        }
    ]
    binding = LaunchBinding.objects.get(
        issue_type=issue_type, state=states["Build"]
    )
    assert binding.subtree_run_enabled is True

    stale = _json_request(
        client,
        "put",
        url,
        {"enabled": False, "workflow_revision": 0},
        auth,
    )
    assert stale.status_code == 409
    binding.refresh_from_db()
    assert binding.subtree_run_enabled is True


@pytest.mark.django_db
def test_binding_clear_preserves_subtree_run_and_resets_launch_fields(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Build"],
        prompt="Build the work",
        agent="codex",
        auto_start=True,
        subtree_run_enabled=True,
    )
    url = (
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/"
        f"launch-bindings/{states['Build'].id}"
    )

    response = _json_request(
        client, "delete", url, {"workflow_revision": 0}, auth
    )

    assert response.status_code == 200
    assert response.json()["workflow_revision"] == 1
    assert response.json()["launch_bindings"] == [
        {
            "state_id": str(states["Build"].id),
            "prompt": "",
            "agent": None,
            "model": None,
            "reasoning": None,
            "auto_start": False,
            "subtree_run_enabled": True,
        }
    ]
    binding = LaunchBinding.objects.get(
        issue_type=issue_type, state=states["Build"]
    )
    assert binding.prompt == ""
    assert binding.agent is None
    assert binding.auto_start is False
    assert binding.subtree_run_enabled is True


@pytest.mark.django_db
def test_binding_clear_deletes_a_row_without_subtree_run(
    client, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    LaunchBinding.objects.create(
        issue_type=issue_type,
        state=states["Build"],
        prompt="Build the work",
        agent="codex",
        auto_start=True,
    )
    url = (
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/"
        f"launch-bindings/{states['Build'].id}"
    )

    response = _json_request(
        client, "delete", url, {"workflow_revision": 0}, auth
    )

    assert response.status_code == 200
    assert response.json()["launch_bindings"] == []
    assert not LaunchBinding.objects.filter(
        issue_type=issue_type, state=states["Build"]
    ).exists()


@pytest.mark.django_db
def test_invalid_transition_scope_does_not_apply_or_advance_revision(
    client, project, scoped_workflow, auth
):
    issue_type, states = scoped_workflow
    other_project = project.__class__.objects.create(
        id=uuid.uuid4(),
        workspace=project.workspace,
        name="Other",
        slug="OTHER",
    )
    foreign_state = State.objects.create(
        id=uuid.uuid4(),
        project=other_project,
        name="Foreign",
        group="started",
    )

    response = _json_request(
        client,
        "post",
        f"{BASE}/issue-types/{issue_type.id}/workflow-settings/transitions",
        {
            "from_state_id": str(states["Ready"].id),
            "to_state_id": str(foreign_state.id),
            "agent_allowed": True,
            "workflow_revision": 0,
        },
        auth,
    )

    assert response.status_code == 422
    issue_type.refresh_from_db()
    assert issue_type.workflow_revision == 0
    assert not IssueTypeTransition.objects.filter(
        issue_type=issue_type, to_state=foreign_state
    ).exists()
