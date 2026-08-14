"""The workflow state machine (#860/#871) — service-level gate tests.

Exercises ``worktracker.workflow`` directly (no HTTP): persisted per-type graphs,
forward-skip / illegal-backward / terminal rejection, ``→Cancelled`` from
non-Done states, foreign-state rejection, the structured rejection, and the
non-SDLC ungated fallback. HTTP-seam behavior lives in ``test_workflow_api``.
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
from worktracker.workflow import (
    InvalidTransition,
    transition_state,
)


# --- fixtures & helpers -----------------------------------------------------


@pytest.fixture
def sdlc(project):
    """Seed the canonical states + SDLC issue types for ``project``.

    Returns ``(states_by_name, types_by_name)`` — every canonical state and
    SDLC :class:`IssueType`.
    """

    states = {
        name: State.objects.create(
            id=uuid.uuid4(), project=project, name=name, group=group
        )
        for name, group, _color in DEFAULT_STATES
    }
    types = {
        name: IssueType.objects.create(
            id=uuid.uuid4(), project=project, name=name, level="task"
        )
        for name in ("Story", "Implementation", "PathFind")
    }
    ensure_type_workflows(project, IssueType, State, IssueTypeTransition)
    return states, types


def _issue(project, states, issue_type, *, state, parent=None):
    """A persisted issue sitting in the named canonical ``state``."""

    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="S",
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        state=states[state],
        parent=parent,
    )


LEGAL_BY_TYPE = {
    "Story": [
        ("Ideas", "Grill"),
        ("Ideas", "Spec"),
        ("Ideas", "Implement"),
        ("Grill", "Ideas"),
        ("Grill", "Spec"),
        ("Spec", "Tickets"),
        ("Tickets", "Implement"),
        ("Implement", "Grill"),
        ("Implement", "Review"),
        ("Review", "Implement"),
        ("Review", "Done"),
        ("Grill", "Cancelled"),
        ("Spec", "Cancelled"),
        ("Tickets", "Cancelled"),
        ("Implement", "Cancelled"),
        ("Review", "Cancelled"),
    ],
    "Implementation": [
        ("Implement", "Review"),
        ("Review", "Implement"),
        ("Review", "Done"),
        ("Implement", "Cancelled"),
        ("Review", "Cancelled"),
    ],
    "PathFind": [
        ("Spec", "Done"),
        ("Spec", "Cancelled"),
    ],
}

ILLEGAL_BY_TYPE = {
    "Story": [
        ("Ideas", "Tickets"),
        ("Ideas", "Done"),
        ("Grill", "Tickets"),
        ("Grill", "Implement"),
        ("Grill", "Done"),
        ("Spec", "Implement"),
        ("Tickets", "Review"),
        ("Implement", "Done"),
        ("Spec", "Grill"),
        ("Tickets", "Spec"),
        ("Implement", "Tickets"),
        ("Review", "Tickets"),
        ("Review", "Spec"),
        ("Done", "Review"),
        ("Done", "Implement"),
        ("Done", "Cancelled"),
        ("Cancelled", "Grill"),
        ("Cancelled", "Done"),
        ("Grill", "Grill"),  # idempotent re-set is not a legal edge
    ],
    "Implementation": [
        ("Implement", "Done"),
        ("Implement", "Tickets"),
        ("Review", "Tickets"),
        ("Done", "Cancelled"),
        ("Cancelled", "Implement"),
        ("Cancelled", "Cancelled"),
        ("Implement", "Implement"),
        ("Implement", "Grill"),
        ("Implement", "Spec"),
        ("Review", "Spec"),
    ],
    "PathFind": [
        ("Spec", "Grill"),
        ("Spec", "Tickets"),
        ("Spec", "Implement"),
        ("Spec", "Review"),
        ("Done", "Cancelled"),
        ("Cancelled", "Spec"),
        ("Cancelled", "Cancelled"),
        ("Spec", "Spec"),
    ],
}

LEGAL_CASES = [
    pytest.param(type_name, frm, to, id=f"{type_name}:{frm}->{to}")
    for type_name, moves in LEGAL_BY_TYPE.items()
    for frm, to in moves
]

ILLEGAL_CASES = [
    pytest.param(type_name, frm, to, id=f"{type_name}:{frm}->{to}")
    for type_name, moves in ILLEGAL_BY_TYPE.items()
    for frm, to in moves
]


# --- table shape ------------------------------------------------------------


@pytest.mark.django_db
def test_story_terminals_have_no_exit(sdlc):
    states, types = sdlc
    outgoing = {
        states[name].id: {
            edge.to_state_id
            for edge in IssueTypeTransition.objects.filter(
                issue_type=types["Story"], from_state=states[name]
            )
        }
        for name in states
    }
    assert outgoing[states["Done"].id] == set()
    assert outgoing[states["Cancelled"].id] == set()
    assert states["Implement"].id in outgoing[states["Review"].id]


@pytest.mark.django_db
def test_reduced_type_graphs_forbid_foreign_states(sdlc):
    states, types = sdlc

    types["Implementation"].refresh_from_db()
    assert types["Implementation"].start_state_id == states["Implement"].id

    def node_names(type_name):
        issue_type = types[type_name]
        ids = {issue_type.start_state_id}
        transitions = IssueTypeTransition.objects.filter(issue_type=issue_type)
        ids.update(transitions.values_list("from_state_id", flat=True))
        ids.update(transitions.values_list("to_state_id", flat=True))
        return {
            name for name, state in states.items() if state.id in ids
        }

    assert node_names("Implementation") == {
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    }
    assert node_names("PathFind") == {
        "Spec",
        "Done",
        "Cancelled",
    }


# --- transition validity ----------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("type_name,frm,to", LEGAL_CASES)
def test_legal_moves_accepted(project, sdlc, type_name, frm, to):
    states, types = sdlc
    issue = _issue(project, states, types[type_name], state=frm)

    transition_state(issue, states[to].id)

    issue.refresh_from_db()
    assert issue.state.name == to


@pytest.mark.django_db
def test_human_only_transition_rejects_agent_but_allows_human(project, sdlc):
    states, types = sdlc
    edge = IssueTypeTransition.objects.get(
        issue_type=types["Story"],
        from_state=states["Tickets"],
        to_state=states["Implement"],
    )
    assert edge.agent_allowed is False

    agent_issue = _issue(project, states, types["Story"], state="Tickets")
    with pytest.raises(InvalidTransition) as exc:
        transition_state(agent_issue, states["Implement"].id, origin="agent")

    assert exc.value.code == "human_only_transition"
    assert "human-only transition" in exc.value.message
    agent_issue.refresh_from_db()
    assert agent_issue.state.name == "Tickets"

    human_issue = _issue(project, states, types["Story"], state="Tickets")
    transition_state(human_issue, states["Implement"].id, origin="human")
    human_issue.refresh_from_db()
    assert human_issue.state.name == "Implement"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("source", "target"),
    [("Ideas", "Implement"), ("Implement", "Grill")],
)
def test_run_now_transitions_accept_agent_origin(project, sdlc, source, target):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state=source)

    transition_state(issue, states[target].id, origin="agent")

    issue.refresh_from_db()
    assert issue.state.name == target


@pytest.mark.django_db
@pytest.mark.parametrize("type_name,frm,to", ILLEGAL_CASES)
def test_illegal_moves_rejected(project, sdlc, type_name, frm, to):
    states, types = sdlc
    issue = _issue(project, states, types[type_name], state=frm)

    with pytest.raises(InvalidTransition):
        transition_state(issue, states[to].id)

    issue.refresh_from_db()
    assert issue.state.name == frm  # provably unchanged


@pytest.mark.django_db
def test_rejection_carries_structured_fields(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Grill")

    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, states["Done"].id)

    err = exc.value
    assert err.code == "illegal_transition"
    assert err.from_state == "Grill"
    assert err.to_state == "Done"
    body = err.as_body()
    assert set(body) == {"detail", "code", "from", "to"}
    assert body["from"] == "Grill" and body["to"] == "Done"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "type_name,frm,to",
    [
        pytest.param("PathFind", "Spec", "Implement", id="PathFind->Implement"),
        pytest.param(
            "Implementation",
            "Implement",
            "Spec",
            id="Implementation->Spec",
        ),
    ],
)
def test_foreign_state_rejection_is_structured(project, sdlc, type_name, frm, to):
    states, types = sdlc
    issue = _issue(project, states, types[type_name], state=frm)

    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, states[to].id)

    err = exc.value
    assert err.code == "foreign_state"
    assert err.from_state == frm
    assert err.to_state == to
    assert err.as_body()["code"] == "foreign_state"
    issue.refresh_from_db()
    assert issue.state.name == frm


@pytest.mark.django_db
def test_unknown_target_state_rejected(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Grill")

    # A random id that is no State in this project.
    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, uuid.uuid4())
    assert exc.value.code == "unknown_state"


@pytest.mark.django_db
def test_non_canonical_target_rejected_for_gated_type(project, sdlc):
    states, types = sdlc
    custom = State.objects.create(
        id=uuid.uuid4(), project=project, name="Parking Lot", group="unstarted"
    )
    issue = _issue(project, states, types["Story"], state="Grill")

    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, custom.id)
    assert exc.value.code == "unknown_state"


# --- no graph means no transition ------------------------------------------


@pytest.mark.django_db
def test_unconfigured_issue_type_rejects_state_changes(project, sdlc):
    states, _types = sdlc
    unconfigured = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Unconfigured", level="task"
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=unconfigured,
        name="X",
        sequence_id=99,
        state=states["Grill"],
    )

    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, states["Done"].id)

    assert exc.value.code == "illegal_transition"
    issue.refresh_from_db()
    assert issue.state.name == "Grill"


# --- cancel cascade ---------------------------------------------------------


@pytest.mark.django_db
def test_cancel_archives_and_cascades(project, sdlc):
    states, types = sdlc
    parent = _issue(project, states, types["Story"], state="Implement")
    child = _issue(project, states, types["Story"], state="Implement", parent=parent)

    transition_state(parent, states["Cancelled"].id)

    parent.refresh_from_db()
    child.refresh_from_db()
    assert parent.state.name == "Cancelled"
    assert parent.is_archived is True
    assert child.is_archived is True
