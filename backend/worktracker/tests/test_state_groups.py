"""#734 hardening: direct coverage of state-group interpretation (#705).

The signal and scope-context suites exercise ``state_group`` indirectly; this
pins the framework-neutral helper itself — id resolution, the None/unknown
fallbacks, and the resolved-group vocabulary the FE mirrors.
"""

import uuid

import pytest

from worktracker.models import State
from worktracker.state_groups import RESOLVED_GROUPS, state_group


@pytest.mark.django_db
def test_state_group_resolves_id_to_group(project):
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Doing", group="started"
    )
    assert state_group(state.id) == "started"


@pytest.mark.django_db
def test_state_group_reads_fresh_after_regroup(project):
    """Resolution reads the table, not a cached FK, so a regroup is visible."""
    state = State.objects.create(
        id=uuid.uuid4(), project=project, name="Doing", group="started"
    )
    State.objects.filter(pk=state.id).update(group="completed")
    assert state_group(state.id) == "completed"


def test_state_group_none_id_is_none():
    assert state_group(None) is None


@pytest.mark.django_db
def test_state_group_unknown_id_is_none():
    assert state_group(uuid.uuid4()) is None


def test_resolved_groups_are_the_two_terminal_groups():
    assert RESOLVED_GROUPS == frozenset({"completed", "cancelled"})
    assert "started" not in RESOLVED_GROUPS
    assert "backlog" not in RESOLVED_GROUPS
