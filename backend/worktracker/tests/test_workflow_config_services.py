"""Service-level rules for workflow configuration (#731).

Exercises the state / issue-type mutation policy directly against
``worktracker.services.workflow_config`` — no API layer, no HTTP. The API's
own status-code mapping is covered by ``test_types_states_config`` /
``test_protected_states``; here we assert the domain rules and the framework-
neutral errors they raise (``status_code`` 404 / 409 / 422).
"""

import uuid
from contextlib import contextmanager

import pytest

from worktracker.models import Issue, IssueType, Project, State
from worktracker.services import workflow_config as svc
from worktracker.services.errors import NotFoundError, ServiceError, ValidationError


CARBON_DARK_PALETTE = {
    "#8A3FFC",
    "#33B1FF",
    "#007D79",
    "#FF7EB6",
    "#FA4D56",
    "#FFF1F1",
    "#6FDC8C",
    "#4589FF",
    "#D12771",
    "#D2A106",
    "#08BDBA",
    "#BAE6FF",
    "#BA4E00",
    "#D4BBFF",
}


@contextmanager
def conflict():
    """Assert the block raises a 409 ``ServiceError`` (not a 404/422 subclass)."""

    with pytest.raises(ServiceError) as exc:
        yield exc
    assert exc.value.status_code == 409, f"expected 409, got {exc.value.status_code}"


def _issue(project, *, state=None, issue_type=None, type="task", seq=1):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type=type,
        name="Issue",
        sequence_id=seq,
        state=state,
        issue_type=issue_type,
    )


# --- issue types ------------------------------------------------------------


@pytest.mark.django_db
def test_create_issue_type_appends_to_level_order(project):
    first = svc.create_issue_type(project.id, name="Story", level="task")
    second = svc.create_issue_type(project.id, name="Bug", level="task")

    assert first.sort_order == 0
    assert second.sort_order == 1
    assert second.is_default is False


@pytest.mark.django_db
def test_create_issue_type_unknown_level_invalid(project):
    with pytest.raises(ValidationError):
        svc.create_issue_type(project.id, name="X", level="bogus")


@pytest.mark.django_db
def test_create_issue_type_duplicate_name_conflicts(project):
    svc.create_issue_type(project.id, name="Story", level="task")
    with conflict():
        svc.create_issue_type(project.id, name="Story", level="task")


@pytest.mark.django_db
def test_create_issue_type_unknown_project_not_found():
    with pytest.raises(NotFoundError):
        svc.create_issue_type(uuid.uuid4(), name="Story", level="task")


@pytest.mark.django_db
def test_update_issue_type_clearing_default_conflicts(project):
    t = svc.create_issue_type(project.id, name="Story", level="task")
    t.is_default = True
    t.save(update_fields=["is_default"])

    with conflict():
        svc.update_issue_type(t.id, {"is_default": False})


@pytest.mark.django_db
def test_update_issue_type_name_clash_conflicts(project):
    svc.create_issue_type(project.id, name="Story", level="task")
    bug = svc.create_issue_type(project.id, name="Bug", level="task")

    with conflict():
        svc.update_issue_type(bug.id, {"name": "Story"})


@pytest.mark.django_db
def test_update_issue_type_default_flips_other(project):
    a = svc.create_issue_type(project.id, name="Story", level="task")
    b = svc.create_issue_type(project.id, name="Bug", level="task")
    a.is_default = True
    a.save(update_fields=["is_default"])

    svc.update_issue_type(b.id, {"is_default": True})

    a.refresh_from_db()
    b.refresh_from_db()
    assert b.is_default is True
    assert a.is_default is False


@pytest.mark.django_db
def test_update_issue_type_missing_not_found():
    with pytest.raises(NotFoundError):
        svc.update_issue_type(uuid.uuid4(), {"name": "X"})


@pytest.mark.django_db
def test_delete_default_issue_type_conflicts(project):
    t = svc.create_issue_type(project.id, name="Story", level="task")
    t.is_default = True
    t.save(update_fields=["is_default"])

    with conflict():
        svc.delete_issue_type(t.id)


@pytest.mark.django_db
def test_delete_issue_type_in_use_requires_reassign(project):
    t = svc.create_issue_type(project.id, name="Story", level="task")
    _issue(project, issue_type=t)

    with conflict():
        svc.delete_issue_type(t.id)


@pytest.mark.django_db
def test_delete_issue_type_reassigns_then_deletes(project):
    src = svc.create_issue_type(project.id, name="Story", level="task")
    dst = svc.create_issue_type(project.id, name="Bug", level="task")
    issue = _issue(project, issue_type=src)

    svc.delete_issue_type(src.id, reassign_to=dst.id)

    issue.refresh_from_db()
    assert issue.issue_type_id == dst.id
    assert not IssueType.objects.filter(pk=src.id).exists()


@pytest.mark.django_db
def test_delete_issue_type_reassign_wrong_level_invalid(project):
    src = svc.create_issue_type(project.id, name="Story", level="task")
    dst = svc.create_issue_type(project.id, name="Epic", level="module")
    _issue(project, issue_type=src)

    with pytest.raises(ValidationError):
        svc.delete_issue_type(src.id, reassign_to=dst.id)


@pytest.mark.django_db
def test_reorder_issue_types_incomplete_set_invalid(project):
    a = svc.create_issue_type(project.id, name="Story", level="task")
    svc.create_issue_type(project.id, name="Bug", level="task")

    with pytest.raises(ValidationError):
        svc.reorder_issue_types(project.id, [a.id])


@pytest.mark.django_db
def test_reorder_issue_types_renumbers(project):
    a = svc.create_issue_type(project.id, name="Story", level="task")
    b = svc.create_issue_type(project.id, name="Bug", level="task")

    svc.reorder_issue_types(project.id, [b.id, a.id])

    a.refresh_from_db()
    b.refresh_from_db()
    assert b.sort_order == 0
    assert a.sort_order == 1


# --- states -----------------------------------------------------------------


@pytest.mark.django_db
def test_create_state_appends_to_order(project):
    first = svc.create_state(project.id, name="Backlog", group="backlog")
    second = svc.create_state(project.id, name="Todo", group="unstarted")

    assert first.sort_order == 0
    assert second.sort_order == 1


@pytest.mark.django_db
def test_create_state_without_color_persists_unused_project_palette_color(project):
    State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Existing",
        group="backlog",
        color="#8a3ffc",
    )

    created = svc.create_state(project.id, name="Todo", group="unstarted")

    created.refresh_from_db()
    assert created.color in CARBON_DARK_PALETTE
    assert created.color.casefold() != "#8a3ffc"


@pytest.mark.django_db
def test_create_state_automatic_colors_are_unique_within_project(project):
    first = svc.create_state(project.id, name="First", group="unstarted")
    second = svc.create_state(project.id, name="Second", group="started", color="")

    assert first.color in CARBON_DARK_PALETTE
    assert second.color in CARBON_DARK_PALETTE
    assert first.color.casefold() != second.color.casefold()


@pytest.mark.django_db
def test_create_state_preserves_explicit_color(project):
    created = svc.create_state(
        project.id,
        name="Custom",
        group="started",
        color="#aBc123",
    )

    assert created.color == "#aBc123"


@pytest.mark.django_db
def test_create_state_without_color_rejects_exhausted_project_atomically(project):
    for index, color in enumerate(CARBON_DARK_PALETTE):
        State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=f"Existing {index}",
            group="backlog",
            color=color.lower(),
        )

    before = State.objects.filter(project=project).count()
    with conflict() as exc:
        svc.create_state(project.id, name="Overflow", group="started", color=" ")

    assert "no automatic workflow-state colors remain" in exc.value.message.lower()
    assert State.objects.filter(project=project).count() == before


@pytest.mark.django_db
def test_create_state_automatic_palette_usage_is_project_scoped(project):
    for index, color in enumerate(CARBON_DARK_PALETTE):
        State.objects.create(
            id=uuid.uuid4(),
            project=project,
            name=f"Existing {index}",
            group="backlog",
            color=color,
        )
    other = Project.objects.create(
        id=uuid.uuid4(),
        workspace=project.workspace,
        name="Other",
        slug="OTHER",
    )

    created = svc.create_state(other.id, name="Available", group="started")

    assert created.color in CARBON_DARK_PALETTE


@pytest.mark.django_db
def test_create_state_unknown_group_invalid(project):
    with pytest.raises(ValidationError):
        svc.create_state(project.id, name="X", group="bogus")


@pytest.mark.django_db
def test_update_state_unknown_group_invalid(project):
    s = svc.create_state(project.id, name="Todo", group="unstarted")
    with pytest.raises(ValidationError):
        svc.update_state(s.id, {"group": "bogus"})


@pytest.mark.django_db
def test_update_state_moves_group(project):
    s = svc.create_state(project.id, name="Todo", group="unstarted")
    svc.update_state(s.id, {"group": "started", "name": "Doing"})

    s.refresh_from_db()
    assert s.group == "started"
    assert s.name == "Doing"


@pytest.mark.django_db
def test_delete_protected_state_conflicts(project):
    s = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="In Progress",
        group="started",
        is_protected=True,
    )
    # A sibling so the protection check, not the last-state guard, is exercised.
    svc.create_state(project.id, name="Doing", group="started")

    with conflict() as exc:
        svc.delete_state(s.id)
    assert "protected" in exc.value.message.lower()


@pytest.mark.django_db
def test_delete_last_state_in_group_conflicts(project):
    s = svc.create_state(project.id, name="Backlog", group="backlog")
    with conflict():
        svc.delete_state(s.id)


@pytest.mark.django_db
def test_delete_state_in_use_requires_reassign(project):
    s = svc.create_state(project.id, name="Backlog", group="backlog")
    svc.create_state(project.id, name="Icebox", group="backlog")
    _issue(project, state=s)

    with conflict():
        svc.delete_state(s.id)


@pytest.mark.django_db
def test_delete_state_reassigns_then_deletes(project):
    src = svc.create_state(project.id, name="Backlog", group="backlog")
    dst = svc.create_state(project.id, name="Icebox", group="backlog")
    issue = _issue(project, state=src)

    impact = svc.get_state_impact(src.id)
    svc.delete_state(
        src.id, reassign_to=dst.id, impact_token=impact["impact_token"]
    )

    issue.refresh_from_db()
    assert issue.state_id == dst.id
    assert not State.objects.filter(pk=src.id).exists()


@pytest.mark.django_db
def test_delete_state_reassign_routes_through_sole_writer(project):
    """Reassignment is a forced sole-writer move: audit trace + archive cascade
    apply, instead of a signal-free queryset ``update`` (#871/#872)."""

    from worktracker.models import ForceTransition

    src = svc.create_state(project.id, name="Backlog", group="backlog")
    svc.create_state(project.id, name="Icebox", group="backlog")
    dst = svc.create_state(project.id, name="Cancelled", group="cancelled")
    story_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    issue = _issue(project, state=src, issue_type=story_type)

    impact = svc.get_state_impact(src.id)
    svc.delete_state(
        src.id, reassign_to=dst.id, impact_token=impact["impact_token"]
    )

    issue.refresh_from_db()
    assert issue.state_id == dst.id
    # Entering a cancelled-group state must ride the archive cascade.
    assert issue.is_archived is True
    trace = ForceTransition.objects.get(issue=issue)
    assert trace.actor == "state-deletion"
    assert trace.from_state == "Backlog"
    assert trace.to_state == "Cancelled"


@pytest.mark.django_db
def test_reorder_states_incomplete_set_invalid(project):
    a = svc.create_state(project.id, name="Backlog", group="backlog")
    svc.create_state(project.id, name="Todo", group="unstarted")

    with pytest.raises(ValidationError):
        svc.reorder_states(project.id, [a.id])
