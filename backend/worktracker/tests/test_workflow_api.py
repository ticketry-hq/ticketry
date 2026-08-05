"""The workflow gate over HTTP (#860, Slice 1): ``PATCH /work-items/{id}``.

200 on a legal move, a structured 422 on an illegal one, the state-is-its-own-
operation rule, the non-SDLC pass-through, and the
silent-rollback regression — a failing post-commit subscriber leaves the write
committed and the response truthful, while a gate rejection leaves the row
provably unchanged.
"""

import uuid

import pytest

from worktracker.models import (
    DEFAULT_STATES,
    Issue,
    IssueType,
    IssueTypeTransition,
    State,
)
from worktracker.seed import ensure_type_workflows
from worktracker.signals import issue_state_changed
from worktracker.tests.conftest import BASE, patch_json


@pytest.fixture
def sdlc(project):
    """Seed the seven canonical states + Story type; return ``(states, story)``."""

    states = {
        name: State.objects.create(
            id=uuid.uuid4(), project=project, name=name, group=group
        )
        for name, group, _color in DEFAULT_STATES
    }
    story = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    ensure_type_workflows(project, IssueType, State, IssueTypeTransition)
    return states, story


def _story(project, states, story, *, state, issue_type_override=...):
    issue_type = story if issue_type_override is ... else issue_type_override
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="S",
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        state=states[state],
    )


# --- legal / illegal --------------------------------------------------------


@pytest.mark.django_db
def test_legal_state_patch_returns_200(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Grill")

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Spec"].id)}, auth
    )

    assert r.status_code == 200
    assert r.json()["state"] == str(states["Spec"].id)


@pytest.mark.django_db
def test_unlabelled_rest_patch_is_human_on_human_only_edge(
    client, project, sdlc, auth
):
    states, story = sdlc
    issue = _story(project, states, story, state="Tickets")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Implement"].id)},
        auth,
    )

    assert r.status_code == 200
    assert r.json()["state"] == str(states["Implement"].id)


@pytest.mark.django_db
def test_agent_rest_patch_is_rejected_on_human_only_edge(
    client, project, sdlc, auth
):
    states, story = sdlc
    issue = _story(project, states, story, state="Tickets")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Implement"].id), "origin": "agent"},
        auth,
    )

    assert r.status_code == 422
    assert r.json() == {
        "detail": (
            "The 'Tickets' → 'Implement' edge is a human-only transition; "
            "agents are not allowed to take it."
        ),
        "code": "human_only_transition",
        "from": "Tickets",
        "to": "Implement",
    }


@pytest.mark.django_db
def test_illegal_state_patch_returns_structured_422(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Grill")

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Done"].id)}, auth
    )

    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "illegal_transition"
    assert body["from"] == "Grill" and body["to"] == "Done"
    assert "detail" in body
    # provably unchanged
    issue.refresh_from_db()
    assert issue.state.name == "Grill"


@pytest.mark.django_db
def test_foreign_state_patch_returns_structured_422(client, project, sdlc, auth):
    states, story = sdlc
    pathfind = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="PathFind", level="task"
    )
    ensure_type_workflows(project, IssueType, State, IssueTypeTransition)
    issue = _story(
        project,
        states,
        story,
        state="Spec",
        issue_type_override=pathfind,
    )

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Implement"].id)},
        auth,
    )

    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "foreign_state"
    assert body["from"] == "Spec" and body["to"] == "Implement"
    issue.refresh_from_db()
    assert issue.state.name == "Spec"


@pytest.mark.django_db
def test_bundled_edit_is_rejected(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Grill")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Spec"].id), "name": "renamed"},
        auth,
    )

    assert r.status_code == 422
    issue.refresh_from_db()
    assert issue.state.name == "Grill"
    assert issue.name == "S"  # neither field moved


@pytest.mark.django_db
@pytest.mark.parametrize(
    "origin",
    [
        pytest.param("human", id="human"),
        pytest.param("agent", id="agent"),
    ],
)
def test_completed_state_moves_obey_the_graph_for_every_origin(
    client, project, sdlc, auth, origin
):
    states, story = sdlc
    issue = _story(project, states, story, state="Grill")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {
            "state_id": str(states["Done"].id),
            "origin": origin,
        },
        auth,
    )

    assert r.status_code == 422
    assert r.json() == {
        "detail": "A Story cannot move 'Grill' → 'Done'.",
        "code": "illegal_transition",
        "from": "Grill",
        "to": "Done",
    }
    issue.refresh_from_db()
    assert issue.state.name == "Grill"


@pytest.mark.django_db
def test_unconfigured_issue_type_patch_is_rejected(client, project, sdlc, auth):
    states, _ = sdlc
    unconfigured = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Unconfigured", level="task"
    )
    issue = _story(
        project,
        states,
        None,
        state="Grill",
        issue_type_override=unconfigured,
    )

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Done"].id)}, auth
    )

    assert r.status_code == 422
    assert r.json()["code"] == "illegal_transition"
    issue.refresh_from_db()
    assert issue.state.name == "Grill"


# --- silent-rollback regression ---------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_failing_subscriber_never_masks_the_committed_write(client, project, sdlc, auth):
    """A post-commit subscriber that raises must not roll back or mask the move.

    The write commits *before* any receiver runs and the emit uses ``send_robust``
    (#860), so a raising subscriber is logged, never propagated — the PATCH still
    returns the committed row.
    """

    states, story = sdlc
    issue = _story(project, states, story, state="Grill")

    def boom(sender, **kwargs):
        raise RuntimeError("subscriber blew up")

    issue_state_changed.connect(boom, dispatch_uid="test_boom")
    try:
        r = patch_json(
            client,
            f"{BASE}/work-items/{issue.id}",
            {"state_id": str(states["Spec"].id)},
            auth,
        )
    finally:
        issue_state_changed.disconnect(dispatch_uid="test_boom")

    assert r.status_code == 200
    assert r.json()["state"] == str(states["Spec"].id)
    issue.refresh_from_db()
    assert issue.state.name == "Spec"  # committed, not rolled back


# --- cross-door parity (#872) -----------------------------------------------


@pytest.mark.django_db
def test_all_write_doors_reject_the_same_move_identically(client, project, sdlc, auth):
    """The one illegal move, refused with one structured reason, through every door.

    All three write doors funnel through ``PATCH /work-items/{id}`` and the sole
    ``transition_state`` writer (#860): the UI PATCH, the MCP status tool
    (``update_task_status`` — it issues this exact PATCH, see the agent suite's
    ``test_workflow_tools``), and the FE bulk multi-select fan-out (one PATCH per
    selected item). This asserts the chokepoint answers byte-identical structured
    422s regardless of how many items are fanned out, so no door can be a weaker
    gate than the others and none can bypass the sole-writer.
    """

    def reject_grill_to_done(issue):
        r = patch_json(
            client,
            f"{BASE}/work-items/{issue.id}",
            {"state_id": str(states["Done"].id)},
            auth,
        )
        assert r.status_code == 422
        issue.refresh_from_db()
        assert issue.state.name == "Grill"  # provably unchanged
        return r.json()

    states, story = sdlc

    # UI door: a single drag/status-change PATCH.
    ui = reject_grill_to_done(_story(project, states, story, state="Grill"))

    # Bulk door: the fan-out is N of the same per-item PATCH — every item is
    # refused with the same reason, so the response is stable across the batch.
    bulk = [
        reject_grill_to_done(_story(project, states, story, state="Grill"))
        for _ in range(3)
    ]

    expected = {
        "detail": "A Story cannot move 'Grill' → 'Done'.",
        "code": "illegal_transition",
        "from": "Grill",
        "to": "Done",
    }
    assert ui == expected
    for body in bulk:
        assert body == ui  # identical reason on every door / every fanned-out item


@pytest.mark.django_db(transaction=True)
def test_gate_rejection_leaves_row_unchanged(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Grill")

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Done"].id)}, auth
    )

    assert r.status_code == 422
    issue.refresh_from_db()
    assert issue.state.name == "Grill"
