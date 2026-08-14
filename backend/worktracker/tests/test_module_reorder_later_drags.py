"""Drags in a project that is already manual (#360).

Once the order is durable a drag is a single-row write against its neighbours,
so no baseline is sent and no other module's rank may change. Modules and tasks
also rank in separate spaces, and these tests hold that boundary in both
directions.
"""

import pytest

from worktracker.services.errors import ValidationError
from worktracker.services.work_items import reorder_work_item
from worktracker.tests.module_reorder_fixtures import (  # noqa: F401 - pytest fixture
    modules,
)
from worktracker.tests.module_reorder_fixtures import (
    baseline,
    make_foreign_module,
    make_task,
    module_names,
    ranks_by_name,
    seed_manual,
)


@pytest.mark.django_db
def test_a_later_drag_writes_only_the_moved_module_rank(project, modules):
    seed_manual(modules, "c", "b", "a")
    before = ranks_by_name(project)

    reorder_work_item(
        modules["a"].id, before_id=None, after_id=modules["c"].id
    )

    after = ranks_by_name(project)
    assert after["b"] == before["b"] and after["c"] == before["c"]
    assert after["a"] != before["a"]
    assert module_names(project) == ["a", "c", "b"]


@pytest.mark.django_db
def test_repeated_drags_between_the_same_neighbors_never_rebalance(project, modules):
    seed_manual(modules, "c", "b", "a")
    fixed = ranks_by_name(project)

    for _ in range(40):
        reorder_work_item(
            modules["a"].id, before_id=modules["c"].id, after_id=modules["b"].id
        )
        moved = ranks_by_name(project)
        assert fixed["c"] < moved["a"] < fixed["b"]
        assert moved["b"] == fixed["b"] and moved["c"] == fixed["c"]


@pytest.mark.django_db
def test_a_later_drag_rejects_a_cross_project_neighbor(project, modules):
    seed_manual(modules, "c", "b", "a")
    foreign = make_foreign_module(project)

    with pytest.raises(ValidationError):
        reorder_work_item(modules["a"].id, before_id=foreign.id, after_id=None)


@pytest.mark.django_db
def test_a_module_may_not_be_ranked_against_a_task(project, modules, task_type):
    seed_manual(modules, "c", "b", "a")
    task = make_task(project, task_type, rank="V")

    with pytest.raises(ValidationError):
        reorder_work_item(modules["a"].id, before_id=task.id, after_id=None)


@pytest.mark.django_db
def test_a_task_may_not_be_ranked_against_a_module(project, modules, task_type):
    task = make_task(project, task_type, rank="V")

    with pytest.raises(ValidationError):
        reorder_work_item(task.id, before_id=modules["a"].id, after_id=None)


@pytest.mark.django_db
def test_a_task_reorder_rejects_a_module_baseline(project, modules, task_type):
    task = make_task(project, task_type, rank="V")

    with pytest.raises(ValidationError):
        reorder_work_item(
            task.id,
            before_id=None,
            after_id=None,
            initial_order_ids=baseline(modules, "c", "b", "a"),
        )
