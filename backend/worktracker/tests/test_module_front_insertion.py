"""A newly created module enters at the front of the module order (#362).

The rule is one user-visible fact — the module you just created leads the list
— and the tests below observe it through the public service and the public HTTP
collection in both ordering modes, never through the rank column alone. The
manual-mode cases do read back the allocated rank, but only to prove the front
placement is durable data rather than a coincidence of insertion order.
"""

import uuid

import pytest

from worktracker.models import Issue, Project
from worktracker.services.errors import NotFoundError
from worktracker.services.modules import create_module
from worktracker.services.queries import list_modules
from worktracker.tests.conftest import BASE
from worktracker.tests.test_module_order import listed_names


def seed_module(project, module_type, name, *, rank="", is_archived=False):
    """Create an already-existing module, then force its durable rank.

    Seeding through the real service keeps the project's shared sequence
    counter honest, so the module under test allocates a fresh identifier the
    way it would in production. The rank is then overwritten directly because
    reorder — not creation — is what puts an established module on a key.
    """

    module = create_module(project.id, name, module_type.id)
    Issue.objects.filter(pk=module.id).update(rank=rank, is_archived=is_archived)
    module.refresh_from_db()
    return module


def go_manual(project):
    """Put a project into Manual module order, as a first drag would."""

    Project.objects.filter(pk=project.id).update(manual_module_order=True)


@pytest.mark.django_db
def test_automatic_create_leads_the_collection(client, project, module_type, auth):
    seed_module(project, module_type, "older")

    create_module(project.id, "newest", module_type.id)

    assert listed_names(client, project, auth) == ["newest", "older"]


@pytest.mark.django_db
def test_automatic_create_stays_automatic_without_a_rank(project, module_type):
    seed_module(project, module_type, "older")

    created = create_module(project.id, "newest", module_type.id)

    # Automatic front placement comes from the collection read's
    # newest-created-first fallback, so creation writes no rank at all and
    # leaves the project's one-way ordering decision untouched.
    assert created.rank == ""
    project.refresh_from_db()
    assert project.manual_module_order is False


@pytest.mark.django_db
def test_manual_create_ranks_before_the_first_active_module(
    client, project, module_type, auth
):
    seed_module(project, module_type, "first", rank="8r8r8r8r8r8r")
    seed_module(project, module_type, "second", rank="QZQZQZQZQZQZ")
    go_manual(project)

    created = create_module(project.id, "newest", module_type.id)

    # A real allocated key, not the default empty rank. The empty string sorts
    # before every key, so an unranked module would *look* first while holding
    # no position at all — the next module created would tie with it and the
    # identifier fallback, not the user's arrangement, would break it.
    assert created.rank != ""
    assert created.rank < "8r8r8r8r8r8r"
    assert listed_names(client, project, auth) == ["newest", "first", "second"]


@pytest.mark.django_db
def test_manual_create_stays_manual(project, module_type):
    seed_module(project, module_type, "first", rank="8r8r8r8r8r8r")
    go_manual(project)

    create_module(project.id, "newest", module_type.id)

    project.refresh_from_db()
    assert project.manual_module_order is True


@pytest.mark.django_db
def test_manual_creates_stay_in_front_of_each_other(client, project, module_type, auth):
    seed_module(project, module_type, "first", rank="8r8r8r8r8r8r")
    go_manual(project)

    earlier = create_module(project.id, "second-newest", module_type.id)
    latest = create_module(project.id, "newest", module_type.id)

    # Each create reads the *current* front, so repeated creates keep stacking
    # up on distinct keys rather than colliding on one bound and falling back
    # to the identifier tiebreak.
    assert latest.rank < earlier.rank
    assert listed_names(client, project, auth) == ["newest", "second-newest", "first"]


@pytest.mark.django_db
def test_manual_create_ignores_archived_modules_when_it_ranks(project, module_type):
    # An archived module is out of the Canonical module order, so it must not
    # be the neighbor the new module is placed in front of.
    seed_module(project, module_type, "retired", rank="0z", is_archived=True)
    seed_module(project, module_type, "first", rank="8r8r8r8r8r8r")
    go_manual(project)

    created = create_module(project.id, "newest", module_type.id)

    assert "0z" < created.rank < "8r8r8r8r8r8r"


@pytest.mark.django_db
@pytest.mark.parametrize("manual_module_order", [False, True])
def test_create_leads_the_first_module_of_an_empty_project(
    client, project, module_type, auth, manual_module_order
):
    Project.objects.filter(pk=project.id).update(
        manual_module_order=manual_module_order
    )

    create_module(project.id, "only", module_type.id)

    assert listed_names(client, project, auth) == ["only"]


@pytest.mark.django_db
@pytest.mark.parametrize("manual_module_order", [False, True])
def test_http_created_module_leads_a_fresh_read_in_both_modes(
    client, project, module_type, auth, manual_module_order
):
    seed_module(project, module_type, "first", rank="8r8r8r8r8r8r")
    seed_module(project, module_type, "second", rank="QZQZQZQZQZQZ")
    Project.objects.filter(pk=project.id).update(
        manual_module_order=manual_module_order
    )

    response = client.post(
        f"{BASE}/projects/{project.id}/modules",
        data={"name": "newest", "issue_type_id": str(module_type.id)},
        content_type="application/json",
        **{"headers": auth},
    )
    assert response.status_code == 201

    # The route Studio actually uses, re-read from scratch: front placement is
    # durable server state, not a client-side insertion.
    assert listed_names(client, project, auth)[0] == "newest"
    assert [module["name"] for module in list_modules(project.id)][0] == "newest"
    created = Issue.objects.get(project=project, name="newest")
    assert bool(created.rank) is manual_module_order
    project.refresh_from_db()
    assert project.manual_module_order is manual_module_order


@pytest.mark.django_db
def test_front_placement_leaves_the_rest_of_creation_alone(project, module_type):
    existing = seed_module(project, module_type, "first")

    created = create_module(project.id, "newest", module_type.id)

    assert created.sequence_id > existing.sequence_id
    assert created.type == "module"
    assert created.issue_type_id == module_type.id
    assert created.module_id is None
    assert Issue.objects.filter(project=project, type="module").count() == 2


@pytest.mark.django_db
def test_create_under_a_missing_project_writes_nothing():
    with pytest.raises(NotFoundError):
        create_module(uuid.uuid4(), "newest", uuid.uuid4())

    assert Issue.objects.count() == 0
