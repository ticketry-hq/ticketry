"""Transition landing through the canonical workflow service."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections

from worktracker.models import (
    Issue,
    IssueType,
    IssueTypeTransition,
    ModulePresentation,
    State,
)
from worktracker.services.queries import list_modules
from worktracker.tests.conftest import BASE, patch_json
from worktracker.workflow import InvalidTransition, transition_state


@pytest.fixture
def workflow(project):
    source = State.objects.create(
        id=uuid.uuid4(), project=project, name="Source", group="unstarted"
    )
    destination = State.objects.create(
        id=uuid.uuid4(), project=project, name="Destination", group="started"
    )
    other = State.objects.create(
        id=uuid.uuid4(), project=project, name="Other", group="started"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Task",
        level="task",
        start_state=source,
    )
    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=source,
        to_state=destination,
        agent_allowed=True,
    )
    return source, destination, other, task_type


def make_task(project, task_type, state, name, rank):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=task_type,
        name=name,
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        state=state,
        rank=rank,
    )


@pytest.mark.django_db
@pytest.mark.parametrize("origin", ["human", "agent"])
def test_transition_lands_after_destination_tail_before_global_successor(
    project, workflow, origin
):
    source, destination, other, task_type = workflow
    moving = make_task(project, task_type, source, "moving", "5")
    first = make_task(project, task_type, destination, "first", "A")
    tail = make_task(project, task_type, destination, "tail", "M")
    successor = make_task(project, task_type, other, "successor", "Z")
    ranks_before = {item.id: item.rank for item in (first, tail, successor)}

    transitioned = transition_state(moving, destination.id, origin=origin)

    assert transitioned.state_id == destination.id
    assert tail.rank < transitioned.rank < successor.rank
    assert {
        item.id: Issue.objects.get(pk=item.id).rank for item in (first, tail, successor)
    } == ranks_before


@pytest.mark.django_db
def test_transition_into_empty_destination_preserves_rank(project, workflow):
    source, destination, _other, task_type = workflow
    moving = make_task(project, task_type, source, "moving", "M")

    transitioned = transition_state(moving, destination.id)

    assert transitioned.state_id == destination.id
    assert transitioned.rank == "M"


@pytest.mark.django_db
def test_module_transition_preserves_manual_module_order(project, workflow):
    source, destination, other, task_type = workflow
    module_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Module",
        level="module",
        start_state=source,
    )
    IssueTypeTransition.objects.create(
        issue_type=module_type,
        from_state=source,
        to_state=destination,
        agent_allowed=True,
    )
    modules = [
        Issue.objects.create(
            id=uuid.uuid4(),
            project=project,
            type="module",
            issue_type=module_type,
            name=name,
            sequence_id=index,
            state=source,
            rank=rank,
        )
        for index, (name, rank) in enumerate(
            (("first", "A"), ("moving", "M"), ("last", "Z")), start=1
        )
    ]
    ModulePresentation.objects.bulk_create(
        [ModulePresentation(module=module, rank=module.rank) for module in modules]
    )
    moving = modules[1]
    make_task(project, task_type, destination, "destination tail", "M")
    make_task(project, task_type, other, "global successor", "Z")
    order_before = [module["id"] for module in list_modules(str(project.id))]

    transitioned = transition_state(moving, destination.id)

    assert transitioned.state_id == destination.id
    assert transitioned.rank == "M"
    moving.refresh_from_db()
    assert moving.rank == "M"
    assert [module["id"] for module in list_modules(str(project.id))] == order_before


@pytest.mark.django_db
def test_rejected_agent_transition_preserves_state_and_rank(project, workflow):
    source, destination, _other, task_type = workflow
    IssueTypeTransition.objects.filter(
        issue_type=task_type,
        from_state=source,
        to_state=destination,
    ).update(agent_allowed=False)
    moving = make_task(project, task_type, source, "moving", "A")
    make_task(project, task_type, destination, "tail", "M")

    with pytest.raises(InvalidTransition) as exc:
        transition_state(moving, destination.id, origin="agent")

    assert exc.value.code == "human_only_transition"
    moving.refresh_from_db()
    assert moving.state_id == source.id
    assert moving.rank == "A"


@pytest.mark.django_db
def test_landing_bounds_span_task_groupings_and_ignore_ineligible_rows(
    project, workflow
):
    source, destination, other, task_type = workflow
    alternate_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Alternate task",
        level="task",
        start_state=source,
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="module rank",
        sequence_id=1,
        rank="P",
    )
    moving = make_task(project, task_type, source, "moving", "N")
    tail = make_task(project, alternate_type, destination, "tail", "M")
    tail.parent = module
    tail.module = module
    tail.save()
    archived_destination_tail = make_task(
        project, task_type, destination, "archived destination tail", "Y"
    )
    archived_destination_tail.is_archived = True
    archived_destination_tail.save()
    archived = make_task(project, task_type, other, "archived", "Q")
    archived.is_archived = True
    archived.save()
    successor = make_task(project, task_type, other, "successor", "Z")

    transitioned = transition_state(moving, destination.id)

    assert tail.rank < transitioned.rank < successor.rank
    assert transitioned.rank > module.rank
    assert transitioned.rank > archived.rank
    assert transitioned.rank < archived_destination_tail.rank


@pytest.mark.django_db
def test_landing_uses_ascii_rank_order_independent_of_database_locale(
    project, workflow
):
    source, destination, other, task_type = workflow
    moving = make_task(project, task_type, source, "moving", "A")
    tail = make_task(
        project,
        task_type,
        destination,
        "tail",
        "zrr4CbpUTQGoRJxth5FlFV",
    )
    make_task(
        project,
        task_type,
        other,
        "locale-only neighbor",
        "zTQGoRJxth5FlHramL13",
    )
    successor = make_task(project, task_type, other, "successor", "zz")

    transitioned = transition_state(moving, destination.id)

    assert tail.rank < transitioned.rank < successor.rank


@pytest.mark.django_db
def test_transition_response_returns_authoritative_state_rank_and_revision(
    client, project, workflow, auth
):
    source, destination, other, task_type = workflow
    moving = make_task(project, task_type, source, "moving", "A")
    tail = make_task(project, task_type, destination, "tail", "M")
    successor = make_task(project, task_type, other, "successor", "Z")
    revision_before = moving.state_revision

    response = patch_json(
        client,
        f"{BASE}/work-items/{moving.id}",
        {"state_id": str(destination.id)},
        auth,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == str(destination.id)
    assert body["rank"] == Issue.objects.get(pk=moving.id).rank
    assert tail.rank < body["rank"] < successor.rank
    assert body["state_revision"] > revision_before


@pytest.mark.django_db(transaction=True)
def test_concurrent_transitions_serialize_into_distinct_commit_ordered_ranks(
    project, workflow
):
    source, destination, other, task_type = workflow
    first = make_task(project, task_type, source, "first moving", "A")
    second = make_task(project, task_type, source, "second moving", "B")
    tail = make_task(project, task_type, destination, "tail", "M")
    successor = make_task(project, task_type, other, "successor", "Z")
    ready = threading.Barrier(2)

    def move(issue_id):
        close_old_connections()
        try:
            issue = Issue.objects.select_related("state", "issue_type").get(pk=issue_id)
            ready.wait(timeout=5)
            transitioned = transition_state(issue, destination.id)
            return transitioned.state_revision, transitioned.rank
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(move, (first.id, second.id)))

    assert len({rank for _revision, rank in results}) == 2
    by_revision = sorted(results)
    assert by_revision[0][1] < by_revision[1][1]
    assert tail.rank < by_revision[0][1] < by_revision[1][1] < successor.rank


@pytest.mark.django_db
def test_cancellation_archive_and_later_unarchive_keep_landing_behavior(
    project, workflow
):
    source, destination, other, task_type = workflow
    cancelled = State.objects.create(
        id=uuid.uuid4(), project=project, name="Cancelled", group="cancelled"
    )
    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=source,
        to_state=cancelled,
        agent_allowed=True,
    )
    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=cancelled,
        to_state=destination,
        agent_allowed=True,
    )
    moving = make_task(project, task_type, source, "moving", "A")
    child = make_task(project, task_type, source, "child", "B")
    child.parent = moving
    child.save()
    tail = make_task(project, task_type, destination, "tail", "M")
    successor = make_task(project, task_type, other, "successor", "Z")

    cancelled_item = transition_state(moving, cancelled.id)

    child.refresh_from_db()
    assert cancelled_item.is_archived is True
    assert cancelled_item.rank == "A"
    assert child.is_archived is True

    restored = transition_state(cancelled_item, destination.id)

    assert restored.is_archived is False
    assert tail.rank < restored.rank < successor.rank
