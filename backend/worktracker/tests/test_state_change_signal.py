"""The ``issue_state_changed`` seam (#706) — emit-on-commit + v1 logging.

Drives the real ninja API paths (``patch_work_item`` / ``create_work_item``)
through the package's own minimal Django host, with a spy receiver connected to
the signal. Because dispatch is deferred to ``transaction.on_commit``, the
measured actions run inside ``django_capture_on_commit_callbacks(execute=True)``
so the callbacks actually fire under the test's wrapping transaction.

Spy hygiene: the spy is connected per-test and disconnected in teardown so it
never leaks into other suites. The app-wide v1 logger stays connected and is
asserted via ``caplog`` rather than the spy.
"""

import logging
import uuid

import pytest
from django.db import transaction

from worktracker import signals
from worktracker.models import Issue, State
from worktracker.signals import issue_state_changed
from worktracker.tests.conftest import BASE, patch_json, post_json


@pytest.fixture
def states(project):
    """One state per relevant group in the test project."""

    return {
        group: State.objects.create(
            id=uuid.uuid4(), project=project, name=group.title(), group=group
        )
        for group in ("backlog", "unstarted", "started")
    }


@pytest.fixture
def spy():
    """A receiver that records every ``issue_state_changed`` payload."""

    events = []

    def _receiver(sender, **kwargs):
        events.append(kwargs)

    issue_state_changed.connect(_receiver, dispatch_uid="t706-spy")
    yield events
    issue_state_changed.disconnect(_receiver, dispatch_uid="t706-spy")


def _make_issue(project, state, *, type="task", sequence_id=1):
    """Create an issue directly via the model, in the test transaction.

    The create's ``on_commit`` send never fires here (no capture block), so the
    spy stays empty — leaving the subsequent measured action in isolation.
    """

    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type=type,
        name="Item",
        sequence_id=sequence_id,
        state=state,
    )


@pytest.mark.django_db
def test_patch_transition_emits_once(
    client, project, states, auth, spy, django_capture_on_commit_callbacks
):
    """AC1: a state change through ``patch_work_item`` fires exactly one event."""

    issue = _make_issue(project, states["unstarted"])

    with django_capture_on_commit_callbacks(execute=True):
        r = patch_json(
            client,
            f"{BASE}/work-items/{issue.id}",
            {"state_id": str(states["started"].id)},
            auth,
        )
    assert r.status_code == 200

    assert len(spy) == 1
    (event,) = spy
    assert event["issue_id"] == str(issue.id)
    assert event["project_id"] == str(project.id)
    assert event["from_state_id"] == str(states["unstarted"].id)
    assert event["to_state_id"] == str(states["started"].id)
    assert event["from_group"] == "unstarted"
    assert event["to_group"] == "started"


@pytest.mark.django_db
def test_within_group_move_emits(
    client, project, auth, spy, django_capture_on_commit_callbacks
):
    """AC1/D2: a move between two states in the *same* group still emits."""

    a = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo A", group="unstarted"
    )
    b = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo B", group="unstarted"
    )
    issue = _make_issue(project, a)

    with django_capture_on_commit_callbacks(execute=True):
        patch_json(client, f"{BASE}/work-items/{issue.id}", {"state_id": str(b.id)}, auth)

    assert len(spy) == 1
    assert spy[0]["from_group"] == "unstarted"
    assert spy[0]["to_group"] == "unstarted"
    assert spy[0]["from_state_id"] == str(a.id)
    assert spy[0]["to_state_id"] == str(b.id)


@pytest.mark.django_db
def test_create_into_state_emits_with_null_from(
    client, project, states, auth, spy, django_capture_on_commit_callbacks
):
    """AC2: creating an issue directly into a state fires one event, from=null."""

    with django_capture_on_commit_callbacks(execute=True):
        r = post_json(
            client,
            f"{BASE}/projects/{project.id}/work-items",
            {"name": "New", "state_id": str(states["unstarted"].id)},
            auth,
        )
    assert r.status_code == 200

    assert len(spy) == 1
    assert spy[0]["from_state_id"] is None
    assert spy[0]["from_group"] is None
    assert spy[0]["to_state_id"] == str(states["unstarted"].id)
    assert spy[0]["to_group"] == "unstarted"


@pytest.mark.django_db
def test_non_state_save_emits_nothing(
    client, project, states, auth, spy, django_capture_on_commit_callbacks
):
    """AC3: a save that does not touch ``state_id`` fires no event."""

    issue = _make_issue(project, states["unstarted"])

    with django_capture_on_commit_callbacks(execute=True):
        patch_json(client, f"{BASE}/work-items/{issue.id}", {"name": "Renamed"}, auth)

    assert spy == []


@pytest.mark.django_db
def test_same_state_resave_emits_nothing(
    client, project, states, auth, spy, django_capture_on_commit_callbacks
):
    """AC3: re-assigning the current state (a no-op transition) fires no event."""

    issue = _make_issue(project, states["unstarted"])

    with django_capture_on_commit_callbacks(execute=True):
        patch_json(
            client,
            f"{BASE}/work-items/{issue.id}",
            {"state_id": str(states["unstarted"].id)},
            auth,
        )

    assert spy == []


@pytest.mark.django_db
def test_rolled_back_transition_emits_nothing(
    project, states, spy, django_capture_on_commit_callbacks
):
    """AC4: a transition in a rolled-back txn never emits (on_commit semantics)."""

    issue = _make_issue(project, states["unstarted"])

    with django_capture_on_commit_callbacks(execute=True):
        with pytest.raises(RuntimeError):
            with transaction.atomic():
                issue.state = states["started"]
                issue.save()
                raise RuntimeError("force rollback")

    assert spy == []


@pytest.mark.django_db
def test_v1_receiver_logs(
    client, project, states, auth, caplog, django_capture_on_commit_callbacks
):
    """AC5: the v1 receiver is invoked and logs issue_id + from -> to groups."""

    issue = _make_issue(project, states["unstarted"])

    with caplog.at_level(logging.INFO, logger=signals.logger.name):
        with django_capture_on_commit_callbacks(execute=True):
            patch_json(
                client,
                f"{BASE}/work-items/{issue.id}",
                {"state_id": str(states["started"].id)},
                auth,
            )

    line = "\n".join(caplog.messages)
    assert str(issue.id) in line
    assert "unstarted -> started" in line


@pytest.mark.django_db
def test_state_delete_update_is_documented_gap(
    project, states, spy, django_capture_on_commit_callbacks
):
    """AC6: queryset ``.update(state=…)`` (delete_state reassign) fires no event.

    Locks in the documented gap: bulk ``update`` issues raw SQL and bypasses
    ``pre_save``/``post_save`` entirely, so no signal is emitted. This is config
    cleanup, not a work transition — excluded by design.
    """

    _make_issue(project, states["unstarted"])

    with django_capture_on_commit_callbacks(execute=True):
        Issue.objects.filter(state=states["unstarted"]).update(state=states["started"])

    assert spy == []


@pytest.mark.django_db
def test_epic_transition_emits(
    project, states, spy, django_capture_on_commit_callbacks
):
    """AC/D5: a ``type='module'`` (epic) issue's state change also emits."""

    epic = _make_issue(project, states["unstarted"], type="module")

    with django_capture_on_commit_callbacks(execute=True):
        with transaction.atomic():
            epic.state = states["started"]
            epic.save()

    assert len(spy) == 1
    assert spy[0]["from_group"] == "unstarted"
    assert spy[0]["to_group"] == "started"
