"""The workflow state machine (#860/#871) — service-level gate tests.

Exercises ``worktracker.workflow`` directly (no HTTP): persisted per-type graphs,
forward-skip / illegal-backward / terminal rejection, ``→Cancelled`` from
non-Done states, foreign-state rejection, the structured rejection, the ``force``
bypass + audit trace, and the non-SDLC ungated fallback. HTTP-seam behavior lives
in ``test_workflow_api``.
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
from worktracker.workflow import (
    InvalidTransition,
    allowed_transitions,
    transition_state,
)


# --- fixtures & helpers -----------------------------------------------------


@pytest.fixture
def sdlc(project):
    """Seed the seven canonical states + SDLC issue types for ``project``.

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
        ("Idea", "Refinement"),
        ("Refinement", "Ready"),
        ("Ready", "Implement"),
        ("Implement", "Review"),
        ("Review", "Implement"),
        ("Review", "Done"),
        ("Idea", "Cancelled"),
        ("Refinement", "Cancelled"),
        ("Ready", "Cancelled"),
        ("Implement", "Cancelled"),
        ("Review", "Cancelled"),
    ],
    "Implementation": [
        ("Ready", "Implement"),
        ("Implement", "Review"),
        ("Review", "Implement"),
        ("Review", "Done"),
        ("Ready", "Cancelled"),
        ("Implement", "Cancelled"),
        ("Review", "Cancelled"),
    ],
    "PathFind": [
        ("Refinement", "Done"),
        ("Refinement", "Cancelled"),
    ],
}

ILLEGAL_BY_TYPE = {
    "Story": [
        ("Idea", "Ready"),
        ("Idea", "Implement"),
        ("Idea", "Done"),
        ("Refinement", "Implement"),
        ("Ready", "Review"),
        ("Implement", "Done"),
        ("Refinement", "Idea"),
        ("Ready", "Refinement"),
        ("Implement", "Ready"),
        ("Review", "Ready"),
        ("Review", "Refinement"),
        ("Done", "Review"),
        ("Done", "Implement"),
        ("Done", "Cancelled"),
        ("Cancelled", "Idea"),
        ("Cancelled", "Done"),
        ("Idea", "Idea"),  # idempotent re-set is not a legal edge
    ],
    "Implementation": [
        ("Ready", "Review"),
        ("Ready", "Done"),
        ("Implement", "Done"),
        ("Implement", "Ready"),
        ("Review", "Ready"),
        ("Done", "Cancelled"),
        ("Cancelled", "Ready"),
        ("Cancelled", "Cancelled"),
        ("Ready", "Ready"),
        ("Ready", "Idea"),
        ("Ready", "Refinement"),
        ("Review", "Refinement"),
    ],
    "PathFind": [
        ("Refinement", "Idea"),
        ("Refinement", "Ready"),
        ("Refinement", "Implement"),
        ("Refinement", "Review"),
        ("Done", "Cancelled"),
        ("Cancelled", "Refinement"),
        ("Cancelled", "Cancelled"),
        ("Refinement", "Refinement"),
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
        "Ready",
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    }
    assert node_names("PathFind") == {
        "Refinement",
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
        from_state=states["Idea"],
        to_state=states["Refinement"],
    )
    edge.agent_allowed = False
    edge.save(update_fields=["agent_allowed"])

    agent_issue = _issue(project, states, types["Story"], state="Idea")
    with pytest.raises(InvalidTransition) as exc:
        transition_state(agent_issue, states["Refinement"].id, origin="agent")

    assert exc.value.code == "human_only_transition"
    assert "human-only transition" in exc.value.message
    agent_issue.refresh_from_db()
    assert agent_issue.state.name == "Idea"

    human_issue = _issue(project, states, types["Story"], state="Idea")
    transition_state(human_issue, states["Refinement"].id, origin="human")
    human_issue.refresh_from_db()
    assert human_issue.state.name == "Refinement"


@pytest.mark.django_db
def test_agent_allowed_transition_accepts_agent_origin(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Idea")

    transition_state(issue, states["Refinement"].id, origin="agent")

    issue.refresh_from_db()
    assert issue.state.name == "Refinement"


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
    issue = _issue(project, states, types["Story"], state="Idea")

    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, states["Done"].id)

    err = exc.value
    assert err.code == "illegal_transition"
    assert err.from_state == "Idea"
    assert err.to_state == "Done"
    body = err.as_body()
    assert set(body) == {"detail", "code", "from", "to"}
    assert body["from"] == "Idea" and body["to"] == "Done"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "type_name,frm,to",
    [
        pytest.param("PathFind", "Refinement", "Implement", id="PathFind->Implement"),
        pytest.param(
            "Implementation",
            "Ready",
            "Refinement",
            id="Implementation->Refinement",
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
    issue = _issue(project, states, types["Story"], state="Idea")

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
    issue = _issue(project, states, types["Story"], state="Idea")

    with pytest.raises(InvalidTransition) as exc:
        transition_state(issue, custom.id)
    assert exc.value.code == "unknown_state"


@pytest.mark.django_db
def test_allowed_transitions_respects_each_type_graph(project, sdlc):
    states, types = sdlc
    story = _issue(project, states, types["Story"], state="Idea")
    impl = _issue(project, states, types["Implementation"], state="Ready")
    pathfind = _issue(project, states, types["PathFind"], state="Refinement")

    assert allowed_transitions(story) == {"Refinement", "Cancelled"}
    assert allowed_transitions(impl) == {"Implement", "Cancelled"}
    assert allowed_transitions(pathfind) == {"Done", "Cancelled"}


# --- force bypass + audit ---------------------------------------------------


@pytest.mark.django_db
def test_force_bypasses_gate_and_records_trace(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Idea")

    transition_state(issue, states["Done"].id, force=True, actor="alice")

    issue.refresh_from_db()
    assert issue.state.name == "Done"
    trace = ForceTransition.objects.get(issue=issue)
    assert (trace.from_state, trace.to_state, trace.actor) == ("Idea", "Done", "alice")


@pytest.mark.django_db
def test_force_leaves_a_terminal_state(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Done")

    transition_state(issue, states["Idea"].id, force=True)

    issue.refresh_from_db()
    assert issue.state.name == "Idea"
    assert ForceTransition.objects.filter(issue=issue).count() == 1


@pytest.mark.django_db
def test_agent_origin_force_is_rejected(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Idea")

    with pytest.raises(InvalidTransition) as exc:
        transition_state(
            issue,
            states["Done"].id,
            force=True,
            origin="agent",
        )

    assert exc.value.code == "agent_force_forbidden"
    assert "Force is human-only" in exc.value.message
    issue.refresh_from_db()
    assert issue.state.name == "Idea"
    assert not ForceTransition.objects.filter(issue=issue).exists()


@pytest.mark.django_db
def test_legal_move_records_no_force_trace(project, sdlc):
    states, types = sdlc
    issue = _issue(project, states, types["Story"], state="Idea")

    transition_state(issue, states["Refinement"].id)

    assert not ForceTransition.objects.filter(issue=issue).exists()


# --- non-SDLC fallback ------------------------------------------------------


@pytest.mark.django_db
def test_untyped_issue_writes_through_ungated(project, sdlc):
    states, _types = sdlc
    # issue_type=None → no table → the Story-illegal Idea→Done writes through.
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=None,
        name="X",
        sequence_id=99,
        state=states["Idea"],
    )

    transition_state(issue, states["Done"].id)

    issue.refresh_from_db()
    assert issue.state.name == "Done"


@pytest.mark.django_db
def test_epic_type_writes_through_ungated(project, sdlc):
    states, _types = sdlc
    epic = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Epic", level="module"
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=epic,
        name="E",
        sequence_id=98,
        state=states["Idea"],
    )

    transition_state(issue, states["Done"].id)

    issue.refresh_from_db()
    assert issue.state.name == "Done"


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
