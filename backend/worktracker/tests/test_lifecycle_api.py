"""The lifecycle HTTP surface (#758): read fields on ``WorkItemOut`` + the
guarded ``POST /work-items/{id}/lifecycle`` route, plus the sole-writer gate.
"""

import pathlib
import uuid

import pytest

from worktracker.models import State
from worktracker.tests.conftest import BASE, post_json


@pytest.fixture
def states(project):
    """Seed one state per group so created issues land in Backlog by default."""

    for name, group in [
        ("Backlog", "backlog"),
        ("Todo", "unstarted"),
        ("In Progress", "started"),
        ("Done", "completed"),
        ("Cancelled", "cancelled"),
    ]:
        State.objects.create(id=uuid.uuid4(), project=project, name=name, group=group)


def _create_issue(client, project, auth):
    return post_json(
        client, f"{BASE}/projects/{project.id}/work-items", {"name": "T"}, auth
    ).json()


# --- read surface -----------------------------------------------------------


@pytest.mark.django_db
def test_fresh_issue_exposes_null_lifecycle_and_entry_transitions(
    client, project, states, auth
):
    issue = _create_issue(client, project, auth)

    assert issue["lifecycle_state"] is None
    assert issue["lifecycle_transitions"] == ["backlog", "split_created"]


# --- guarded write ----------------------------------------------------------


@pytest.mark.django_db
def test_lifecycle_advances_a_legal_target(client, project, states, auth):
    issue = _create_issue(client, project, auth)  # backlog group, null lifecycle

    r = post_json(
        client, f"{BASE}/work-items/{issue['id']}/lifecycle", {"target": "backlog"}, auth
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lifecycle_state"] == "backlog"
    assert body["lifecycle_transitions"] == ["cancelled", "failed", "refining"]


@pytest.mark.django_db
def test_lifecycle_accepts_key_path_param(client, project, states, auth):
    issue = _create_issue(client, project, auth)

    r = post_json(
        client, f"{BASE}/work-items/{issue['key']}/lifecycle", {"target": "backlog"}, auth
    )
    assert r.status_code == 200
    assert r.json()["lifecycle_state"] == "backlog"


@pytest.mark.django_db
def test_illegal_target_returns_422(client, project, states, auth):
    issue = _create_issue(client, project, auth)  # null lifecycle → entry set only

    r = post_json(
        client,
        f"{BASE}/work-items/{issue['id']}/lifecycle",
        {"target": "implementing"},
        auth,
    )
    assert r.status_code == 422


@pytest.mark.django_db
def test_illegal_pairing_returns_422(client, project, states, auth):
    # split_created is a legal entry target, but it requires the 'unstarted'
    # group; a Backlog-group issue must be rejected on the pairing rule.
    issue = _create_issue(client, project, auth)

    r = post_json(
        client,
        f"{BASE}/work-items/{issue['id']}/lifecycle",
        {"target": "split_created"},
        auth,
    )
    assert r.status_code == 422


@pytest.mark.django_db
def test_unknown_target_returns_422(client, project, states, auth):
    issue = _create_issue(client, project, auth)

    r = post_json(
        client,
        f"{BASE}/work-items/{issue['id']}/lifecycle",
        {"target": "nonsense"},
        auth,
    )
    assert r.status_code == 422


@pytest.mark.django_db
def test_missing_issue_returns_404(client, project, states, auth):
    r = post_json(
        client, f"{BASE}/work-items/{uuid.uuid4()}/lifecycle", {"target": "backlog"}, auth
    )
    assert r.status_code == 404


# --- sole-writer gate --------------------------------------------------------


def test_lifecycle_field_written_only_in_lifecycle_module():
    """The attribute write ``.lifecycle_state =`` may appear only in
    ``lifecycle.py`` — the sole writer. The model/migration declare the field
    (no attribute write) and the schemas expose it read-only."""

    pkg = pathlib.Path(__file__).resolve().parent.parent
    offenders = []
    for path in pkg.rglob("*.py"):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        if ".lifecycle_state =" in path.read_text():
            offenders.append(path.name)

    assert offenders == ["lifecycle.py"]
