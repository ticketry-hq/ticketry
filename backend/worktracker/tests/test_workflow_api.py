"""The workflow gate over HTTP (#860, Slice 1): ``PATCH /work-items/{id}``.

200 on a legal move, a structured 422 on an illegal one, the state-is-its-own-
operation rule, the ``force`` bypass, the non-SDLC pass-through, and the
silent-rollback regression — a failing post-commit subscriber leaves the write
committed and the response truthful, while a gate rejection leaves the row
provably unchanged.
"""

import uuid

import pytest

from worktracker.models import (
    DEFAULT_STATES,
    ForceTransition,
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
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Refinement"].id)}, auth
    )

    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Refinement"


@pytest.mark.django_db
def test_unlabelled_rest_patch_is_human_on_human_only_edge(
    client, project, sdlc, auth
):
    states, story = sdlc
    IssueTypeTransition.objects.filter(
        issue_type=story,
        from_state=states["Idea"],
        to_state=states["Refinement"],
    ).update(agent_allowed=False)
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Refinement"].id)},
        auth,
    )

    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Refinement"


@pytest.mark.django_db
def test_agent_rest_patch_is_rejected_on_human_only_edge(
    client, project, sdlc, auth
):
    states, story = sdlc
    IssueTypeTransition.objects.filter(
        issue_type=story,
        from_state=states["Idea"],
        to_state=states["Refinement"],
    ).update(agent_allowed=False)
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Refinement"].id), "origin": "agent"},
        auth,
    )

    assert r.status_code == 422
    assert r.json() == {
        "detail": (
            "The 'Idea' → 'Refinement' edge is a human-only transition; "
            "agents are not allowed to take it."
        ),
        "code": "human_only_transition",
        "from": "Idea",
        "to": "Refinement",
    }


@pytest.mark.django_db
def test_illegal_state_patch_returns_structured_422(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Done"].id)}, auth
    )

    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "illegal_transition"
    assert body["from"] == "Idea" and body["to"] == "Done"
    assert "detail" in body
    # provably unchanged
    issue.refresh_from_db()
    assert issue.state.name == "Idea"


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
        state="Refinement",
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
    assert body["from"] == "Refinement" and body["to"] == "Implement"
    issue.refresh_from_db()
    assert issue.state.name == "Refinement"


@pytest.mark.django_db
def test_bundled_edit_is_rejected(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Refinement"].id), "name": "renamed"},
        auth,
    )

    assert r.status_code == 422
    issue.refresh_from_db()
    assert issue.state.name == "Idea"
    assert issue.name == "S"  # neither field moved


@pytest.mark.django_db
def test_force_via_patch_bypasses_and_records(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {"state_id": str(states["Done"].id), "force": True},
        auth,
    )

    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Done"
    assert ForceTransition.objects.filter(issue=issue).count() == 1


@pytest.mark.django_db
def test_force_if_completed_is_decided_from_locked_destination(
    client, project, sdlc, auth
):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {
            "state_id": str(states["Done"].id),
            "force_if_completed": True,
        },
        auth,
    )

    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Done"
    assert ForceTransition.objects.filter(issue=issue).count() == 1


@pytest.mark.django_db
def test_force_if_completed_does_not_force_after_destination_group_changes(
    client, project, sdlc, auth
):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")
    states["Done"].group = "started"
    states["Done"].save(update_fields=["group", "updated_at"])

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {
            "state_id": str(states["Done"].id),
            "force_if_completed": True,
        },
        auth,
    )

    assert r.status_code == 422
    assert r.json()["code"] == "illegal_transition"
    assert not ForceTransition.objects.filter(issue=issue).exists()


@pytest.mark.django_db
def test_agent_force_via_patch_is_rejected(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client,
        f"{BASE}/work-items/{issue.id}",
        {
            "state_id": str(states["Done"].id),
            "origin": "agent",
            "force": True,
        },
        auth,
    )

    assert r.status_code == 422
    assert r.json()["code"] == "agent_force_forbidden"
    issue.refresh_from_db()
    assert issue.state.name == "Idea"
    assert not ForceTransition.objects.filter(issue=issue).exists()


@pytest.mark.django_db
def test_untyped_issue_patches_through_ungated(client, project, sdlc, auth):
    states, _ = sdlc
    issue = _story(project, states, None, state="Idea", issue_type_override=None)

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Done"].id)}, auth
    )

    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Done"


# --- silent-rollback regression ---------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_failing_subscriber_never_masks_the_committed_write(client, project, sdlc, auth):
    """A post-commit subscriber that raises must not roll back or mask the move.

    The write commits *before* any receiver runs and the emit uses ``send_robust``
    (#860), so a raising subscriber is logged, never propagated — the PATCH still
    returns the committed row.
    """

    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    def boom(sender, **kwargs):
        raise RuntimeError("subscriber blew up")

    issue_state_changed.connect(boom, dispatch_uid="test_boom")
    try:
        r = patch_json(
            client,
            f"{BASE}/work-items/{issue.id}",
            {"state_id": str(states["Refinement"].id)},
            auth,
        )
    finally:
        issue_state_changed.disconnect(dispatch_uid="test_boom")

    assert r.status_code == 200
    assert r.json()["state"]["name"] == "Refinement"
    issue.refresh_from_db()
    assert issue.state.name == "Refinement"  # committed, not rolled back


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

    def reject_idea_to_done(issue):
        r = patch_json(
            client,
            f"{BASE}/work-items/{issue.id}",
            {"state_id": str(states["Done"].id)},
            auth,
        )
        assert r.status_code == 422
        issue.refresh_from_db()
        assert issue.state.name == "Idea"  # provably unchanged
        return r.json()

    states, story = sdlc

    # UI door: a single drag/status-change PATCH.
    ui = reject_idea_to_done(_story(project, states, story, state="Idea"))

    # Bulk door: the fan-out is N of the same per-item PATCH — every item is
    # refused with the same reason, so the response is stable across the batch.
    bulk = [
        reject_idea_to_done(_story(project, states, story, state="Idea"))
        for _ in range(3)
    ]

    expected = {
        "detail": "A Story cannot move 'Idea' → 'Done'.",
        "code": "illegal_transition",
        "from": "Idea",
        "to": "Done",
    }
    assert ui == expected
    for body in bulk:
        assert body == ui  # identical reason on every door / every fanned-out item


@pytest.mark.django_db(transaction=True)
def test_gate_rejection_leaves_row_unchanged(client, project, sdlc, auth):
    states, story = sdlc
    issue = _story(project, states, story, state="Idea")

    r = patch_json(
        client, f"{BASE}/work-items/{issue.id}", {"state_id": str(states["Done"].id)}, auth
    )

    assert r.status_code == 422
    issue.refresh_from_db()
    assert issue.state.name == "Idea"
