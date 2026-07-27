"""The lifecycle state machine (#758) — service-level guard + helper tests.

Exercises ``worktracker.lifecycle`` directly (no HTTP): transition validity,
``(lifecycle_state, state)`` pairing validity, the entry set, terminals, the
rejection back-edges, and ``allowed_transitions``.
"""

import uuid

import pytest

from worktracker.lifecycle import (
    ENTRY,
    PAIRING,
    STRICT_TERMINALS,
    TRANSITIONS,
    InvalidTransition,
    allowed_transitions,
    set_lifecycle,
)
from worktracker.models import Issue, State


ACTIVE = [s for s in TRANSITIONS if s not in STRICT_TERMINALS and s != "failed"]

# Every listed (from, to) edge, for the "all accepted" parametrization.
LISTED_EDGES = [(frm, to) for frm, nexts in TRANSITIONS.items() for to in nexts]

# A grid of moves that are NOT in any row — must be rejected on transition alone.
DISALLOWED_EDGES = [
    ("backlog", "implementing"),
    ("backlog", "prd_approved"),
    ("refining", "done"),
    ("prd_approved", "backlog"),
    ("split_created", "implementing"),
    ("implementing", "refining"),
    ("hld_approved", "lld_approved"),
    ("backlog", "backlog"),  # idempotent re-set is rejected
]


def _make_issue(project, *, lifecycle=None, group=None):
    """Build a persisted Issue with a given lifecycle + visible state group.

    ``group=None`` leaves the issue stateless (state FK null) so the null-group
    pairing case can be exercised.
    """

    state = None
    if group is not None:
        state = State.objects.create(
            id=uuid.uuid4(), project=project, name=group.title(), group=group
        )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="I",
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        state=state,
        lifecycle_state=lifecycle,
    )


# --- transition validity ----------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("frm,to", LISTED_EDGES)
def test_every_listed_transition_is_accepted(project, frm, to):
    # Put the issue in the group the *target* requires so pairing never masks a
    # transition rejection (failed carries no constraint → any group works).
    issue = _make_issue(project, lifecycle=frm, group=PAIRING.get(to) or "backlog")

    set_lifecycle(issue, to)

    issue.refresh_from_db()
    assert issue.lifecycle_state == to


@pytest.mark.django_db
@pytest.mark.parametrize("frm,to", DISALLOWED_EDGES)
def test_unlisted_transitions_are_rejected(project, frm, to):
    issue = _make_issue(project, lifecycle=frm, group="backlog")

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, to)


@pytest.mark.django_db
def test_unknown_target_is_rejected(project):
    issue = _make_issue(project, lifecycle="backlog", group="backlog")

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, "not_a_state")


# --- failed / cancelled reachability ----------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("frm", ACTIVE)
def test_failed_reachable_from_every_active_state(project, frm):
    issue = _make_issue(project, lifecycle=frm, group="backlog")

    set_lifecycle(issue, "failed")

    assert issue.lifecycle_state == "failed"


@pytest.mark.django_db
@pytest.mark.parametrize("frm", ACTIVE)
def test_cancelled_reachable_from_every_active_state(project, frm):
    # cancelled requires the visible cancelled group.
    issue = _make_issue(project, lifecycle=frm, group="cancelled")

    set_lifecycle(issue, "cancelled")

    assert issue.lifecycle_state == "cancelled"


@pytest.mark.django_db
@pytest.mark.parametrize("terminal", sorted(STRICT_TERMINALS))
@pytest.mark.parametrize("target", ["failed", "cancelled", "done"])
def test_no_transition_out_of_a_terminal(project, terminal, target):
    issue = _make_issue(project, lifecycle=terminal, group="cancelled")

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, target)


@pytest.mark.django_db
def test_failed_recovers_to_lld_approved(project):
    issue = _make_issue(project, lifecycle="failed", group="unstarted")

    set_lifecycle(issue, "lld_approved")

    issue.refresh_from_db()
    assert issue.lifecycle_state == "lld_approved"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "target",
    sorted(set(TRANSITIONS) - {"lld_approved"}),
)
def test_failed_rejects_every_other_exit(project, target):
    issue = _make_issue(project, lifecycle="failed", group=PAIRING.get(target))

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, target)


@pytest.mark.django_db
def test_failed_recovery_respects_lld_approved_pairing(project):
    issue = _make_issue(project, lifecycle="failed", group="started")

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, "lld_approved")


# --- rejection back-edges ----------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    "frm,to",
    [
        ("prd_review", "refining"),
        ("hld_review", "generating_hld"),
        ("lld_review", "lld_generating"),
    ],
)
def test_review_back_edges_accepted(project, frm, to):
    issue = _make_issue(project, lifecycle=frm, group=PAIRING[to])

    set_lifecycle(issue, to)

    assert issue.lifecycle_state == to


# --- entry from NULL ---------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("target", sorted(ENTRY))
def test_entry_targets_accepted_from_null(project, target):
    issue = _make_issue(project, lifecycle=None, group=PAIRING[target])

    set_lifecycle(issue, target)

    assert issue.lifecycle_state == target


@pytest.mark.django_db
@pytest.mark.parametrize("target", ["refining", "implementing", "done", "prd_approved"])
def test_non_entry_targets_rejected_from_null(project, target):
    issue = _make_issue(project, lifecycle=None, group="backlog")

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, target)


# --- pairing validity --------------------------------------------------------


@pytest.mark.django_db
def test_illegal_pairing_rejected(project):
    # lld_approved → implementing is a legal transition, but implementing
    # requires the visible 'started' group; a Backlog-group issue must fail.
    issue = _make_issue(project, lifecycle="lld_approved", group="backlog")

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, "implementing")


@pytest.mark.django_db
def test_legal_pairing_accepted(project):
    issue = _make_issue(project, lifecycle="lld_approved", group="started")

    set_lifecycle(issue, "implementing")

    assert issue.lifecycle_state == "implementing"


@pytest.mark.django_db
def test_constrained_target_with_no_state_rejected(project):
    # A stateless issue has a None visible group; a constrained target fails.
    issue = _make_issue(project, lifecycle="lld_approved", group=None)

    with pytest.raises(InvalidTransition):
        set_lifecycle(issue, "implementing")


@pytest.mark.django_db
def test_failed_ignores_pairing(project):
    # failed carries no group constraint — legal from any visible group.
    issue = _make_issue(project, lifecycle="implementing", group="backlog")

    set_lifecycle(issue, "failed")

    assert issue.lifecycle_state == "failed"


# --- allowed_transitions -----------------------------------------------------


def test_allowed_transitions_none_returns_entry_set():
    assert allowed_transitions(None) == set(ENTRY)


@pytest.mark.parametrize("state", list(TRANSITIONS))
def test_allowed_transitions_matches_table(state):
    class _Stub:
        lifecycle_state = state

    assert allowed_transitions(_Stub()) == set(TRANSITIONS[state])


@pytest.mark.parametrize("terminal", sorted(STRICT_TERMINALS))
def test_allowed_transitions_empty_for_terminals(terminal):
    class _Stub:
        lifecycle_state = terminal

    assert allowed_transitions(_Stub()) == set()
