"""Baselines a first drag must refuse to seed from (#360).

A first drag seeds the whole project's canonical order from the client's
snapshot, so an untrustworthy snapshot may not be applied even partially: the
project stays automatic and every rank stays empty.
"""

import pytest

from worktracker.models import ModulePresentation
from worktracker.services.errors import ValidationError
from worktracker.services.module_reorder import reorder_module
from worktracker.tests.module_reorder_fixtures import (  # noqa: F401 - pytest fixture
    modules,
)
from worktracker.tests.module_reorder_fixtures import (
    baseline,
    make_foreign_module,
    make_module,
    make_task,
    ranks_by_name,
)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "names",
    [
        pytest.param(("c", "b"), id="incomplete"),
        pytest.param(("c", "b", "a", "a"), id="duplicated"),
    ],
)
def test_incomplete_or_duplicated_baselines_roll_everything_back(
    project, modules, names
):
    with pytest.raises(ValidationError):
        reorder_module(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, *names),
        )

    assert not ModulePresentation.objects.filter(module__project=project).exists()


@pytest.mark.django_db
def test_a_foreign_project_module_in_the_baseline_rolls_back(project, modules):
    foreign = make_foreign_module(project)

    with pytest.raises(ValidationError):
        reorder_module(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b") + [str(foreign.id)],
        )

    assert not ModulePresentation.objects.filter(module__project=project).exists()


@pytest.mark.django_db
def test_a_task_work_item_in_the_baseline_rolls_back(project, modules, task_type):
    task = make_task(project, task_type)

    with pytest.raises(ValidationError):
        reorder_module(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b", "a") + [str(task.id)],
        )

    assert not ModulePresentation.objects.filter(module__project=project).exists()


@pytest.mark.django_db
def test_an_archived_only_baseline_rolls_back(project, module_type, modules):
    archived = make_module(project, module_type, "archived", is_archived=True)

    with pytest.raises(ValidationError):
        reorder_module(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=[str(archived.id)],
        )

    assert not ModulePresentation.objects.filter(module__project=project).exists()


@pytest.mark.django_db
def test_a_missing_baseline_rolls_back(project, modules):
    with pytest.raises(ValidationError):
        reorder_module(modules["a"].id, before_id=None, after_id=modules["c"].id)

    assert not ModulePresentation.objects.filter(module__project=project).exists()


@pytest.mark.django_db
def test_a_neighborless_first_drag_does_not_enable_manual_order(project, modules):
    with pytest.raises(ValidationError, match="requires at least one neighbor"):
        reorder_module(
            modules["a"].id,
            before_id=None,
            after_id=None,
            initial_order_ids=baseline(modules, "c", "b", "a"),
        )

    assert not ModulePresentation.objects.filter(module__project=project).exists()


@pytest.mark.django_db
def test_inverted_neighbors_leave_the_project_automatic(project, modules):
    # before/after inverted against the supplied baseline order.
    with pytest.raises(ValidationError):
        reorder_module(
            modules["a"].id,
            before_id=modules["b"].id,
            after_id=modules["c"].id,
            initial_order_ids=baseline(modules, "c", "b", "a"),
        )

    assert not ModulePresentation.objects.filter(module__project=project).exists()
