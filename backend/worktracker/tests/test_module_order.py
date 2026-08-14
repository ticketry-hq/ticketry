"""The server side of the Canonical module order (#359).

Both module collection readers — the HTTP route and the in-process query
service — must answer one project's modules in the same order, and that order
must follow the project's durable ordering mode.
"""

import uuid

import pytest

from worktracker.models import Issue, Project
from worktracker.services.modules import create_module
from worktracker.services.queries import list_modules
from worktracker.tests.conftest import BASE


def make_module(
    project, module_type, name, *, rank="", is_archived=False, module_id=None
):
    """Create one module work item with an explicit rank and identifier."""

    return Issue.objects.create(
        id=module_id or uuid.uuid4(),
        project=project,
        issue_type=module_type,
        type="module",
        name=name,
        sequence_id=Issue.objects.filter(project=project).count() + 1,
        rank=rank,
        is_archived=is_archived,
    )


def listed_names(client, project, auth, **params):
    response = client.get(
        f"{BASE}/projects/{project.id}/modules", params, **{"headers": auth}
    )
    assert response.status_code == 200
    return [module["name"] for module in response.json()]


@pytest.mark.django_db
def test_new_project_starts_in_automatic_ordering_mode(project):
    assert project.manual_module_order is False


@pytest.mark.django_db
def test_automatic_reads_are_newest_created_first(client, project, module_type, auth):
    make_module(project, module_type, "first")
    make_module(project, module_type, "second")
    make_module(project, module_type, "third")

    assert listed_names(client, project, auth) == ["third", "second", "first"]


@pytest.mark.django_db
def test_automatic_reads_ignore_persisted_rank(client, project, module_type, auth):
    make_module(project, module_type, "first", rank="z")
    make_module(project, module_type, "second", rank="a")

    assert listed_names(client, project, auth) == ["second", "first"]


@pytest.mark.django_db
def test_manual_reads_use_ascending_persisted_rank(
    client, project, module_type, auth
):
    # Real keys from ``ranking.rebalance``: mixed case, so a locale collation
    # that folds case would read "iHiH…" as smaller than "QZQZ…".
    make_module(project, module_type, "first", rank="QZQZQZQZQZQZ")
    make_module(project, module_type, "second", rank="8r8r8r8r8r8r")
    make_module(project, module_type, "third", rank="iHiHiHiHiHiH")
    Project.objects.filter(pk=project.id).update(manual_module_order=True)

    assert listed_names(client, project, auth) == ["second", "first", "third"]


@pytest.mark.django_db
def test_manual_reads_break_equal_ranks_on_identifier(
    client, project, module_type, auth
):
    # Every module of a project that has never been reordered shares the empty
    # default rank, so the identifier fallback is what keeps the read total.
    low = uuid.UUID("00000000-0000-4000-8000-000000000001")
    high = uuid.UUID("ffffffff-0000-4000-8000-000000000001")
    make_module(project, module_type, "high-id", module_id=high)
    make_module(project, module_type, "low-id", module_id=low)
    Project.objects.filter(pk=project.id).update(manual_module_order=True)

    assert listed_names(client, project, auth) == ["low-id", "high-id"]


@pytest.mark.django_db
@pytest.mark.parametrize("manual_module_order", [False, True])
def test_both_modes_still_hide_archived_modules(
    client, project, module_type, auth, manual_module_order
):
    make_module(project, module_type, "live")
    make_module(project, module_type, "retired", is_archived=True)
    Project.objects.filter(pk=project.id).update(
        manual_module_order=manual_module_order
    )

    assert listed_names(client, project, auth) == ["live"]
    assert set(listed_names(client, project, auth, include_archived="true")) == {
        "live",
        "retired",
    }


@pytest.mark.django_db
@pytest.mark.parametrize("manual_module_order", [False, True])
def test_query_service_shares_the_route_order(
    client, project, module_type, auth, manual_module_order
):
    make_module(project, module_type, "first", rank="QZQZQZQZQZQZ")
    make_module(project, module_type, "second", rank="8r8r8r8r8r8r")
    make_module(project, module_type, "third", rank="iHiHiHiHiHiH")
    Project.objects.filter(pk=project.id).update(
        manual_module_order=manual_module_order
    )

    assert [m["name"] for m in list_modules(project.id)] == listed_names(
        client, project, auth
    )


@pytest.mark.django_db
def test_creating_a_module_leaves_the_project_ordering_mode_alone(
    project, module_type
):
    create_module(project.id, "Epic", module_type.id)

    project.refresh_from_db()
    assert project.manual_module_order is False
