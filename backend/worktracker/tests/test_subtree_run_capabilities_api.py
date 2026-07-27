import json
import uuid

import pytest

from worktracker.models import IssueType, LaunchBinding, State
from worktracker.tests.conftest import BASE


@pytest.mark.django_db
def test_subtree_run_capability_map_reflects_a_toggle_immediately(
    client, project, auth
):
    enabled_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
    )
    disabled_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Initiative",
        level="task",
    )
    enabled_state = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Ready",
        group="unstarted",
    )
    disabled_state = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Review",
        group="started",
    )
    binding = LaunchBinding.objects.create(
        issue_type=enabled_type,
        state=enabled_state,
        subtree_run_enabled=True,
    )
    LaunchBinding.objects.create(
        issue_type=enabled_type,
        state=disabled_state,
        subtree_run_enabled=False,
    )
    LaunchBinding.objects.create(
        issue_type=disabled_type,
        state=enabled_state,
        subtree_run_enabled=False,
    )
    url = f"{BASE}/projects/{project.id}/subtree-run-capabilities"

    response = client.get(url, headers=auth)

    assert response.status_code == 200
    assert response.json() == {
        str(enabled_type.id): [str(enabled_state.id)],
    }

    setter = (
        f"{BASE}/issue-types/{enabled_type.id}/workflow-settings/"
        f"launch-bindings/{enabled_state.id}/subtree-run"
    )
    response = client.put(
        setter,
        data=json.dumps({"enabled": False, "workflow_revision": 0}),
        content_type="application/json",
        headers=auth,
    )
    assert response.status_code == 200
    # This row existed only to carry the flag, so disabling it takes the row
    # with it rather than leaving an empty launch policy on the state.
    assert not LaunchBinding.objects.filter(pk=binding.pk).exists()

    response = client.get(url, headers=auth)
    assert response.status_code == 200
    assert response.json() == {}
