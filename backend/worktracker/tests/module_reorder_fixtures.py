"""Shared scenario builders for the module reorder suite (#360).

The reorder behaviours are covered by several focused test modules — first
drag, baseline validation, later drags, concurrency, and the HTTP route. They
all need the same three-module automatic-mode project and the same read-back
helpers, which live here so no single test module owns them.
"""

import uuid

import pytest

from worktracker.models import Issue, IssueType, Project
from worktracker.services.queries import list_modules
from worktracker.services.work_items import reorder_work_item
from worktracker.tests.conftest import BASE, post_json


def make_module(project, module_type, name, *, rank="", is_archived=False):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=module_type,
        type="module",
        name=name,
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        rank=rank,
        is_archived=is_archived,
    )


def make_task(project, task_type, *, name="task", rank=""):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        issue_type=task_type,
        type="task",
        name=name,
        sequence_id=99,
        rank=rank,
    )


def make_foreign_module(project, name="foreign"):
    """A module in a sibling project of the same workspace."""

    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="other", slug="OTHER"
    )
    foreign_type = IssueType.objects.create(
        id=uuid.uuid4(), project=other, name="Module", level="module"
    )
    return make_module(other, foreign_type, name)


def reorder_request(client, auth, module_id, body):
    """POST the reorder operation for one work item."""

    return post_json(client, f"{BASE}/work-items/{module_id}/reorder", body, auth)


def module_names(project):
    """The project's modules exactly as every read surface would show them."""

    return [module["name"] for module in list_modules(str(project.id))]


def ranks_by_name(project):
    return {
        module.name: module.rank
        for module in Issue.objects.filter(project=project, type="module")
    }


@pytest.fixture
def modules(project, module_type):
    """Three automatic-mode modules, visible newest-created-first: c, b, a."""

    return {
        name: make_module(project, module_type, name) for name in ("a", "b", "c")
    }


def baseline(modules, *names):
    return [str(modules[name].id) for name in names]


def seed_manual(modules, *names):
    """Turn the project manual with the supplied order already applied."""

    reorder_work_item(
        modules[names[-1]].id,
        before_id=modules[names[-2]].id,
        after_id=None,
        initial_order_ids=[str(modules[name].id) for name in names],
    )
