import uuid

import pytest

from worktracker.models import Project, Workspace
from worktracker.sequences import allocate_sequence_id


@pytest.mark.django_db
def test_shared_counter_across_types(project):
    """One counter feeds every type: module, task, module -> 1, 2, 3 (C5)."""

    assert allocate_sequence_id(project.id) == 1
    assert allocate_sequence_id(project.id) == 2
    assert allocate_sequence_id(project.id) == 3


@pytest.mark.django_db
def test_monotonic_per_project(project):
    """Allocations are strictly increasing for a project (C5)."""

    seqs = [allocate_sequence_id(project.id) for _ in range(5)]

    assert seqs == sorted(set(seqs)) == [1, 2, 3, 4, 5]


@pytest.mark.django_db
def test_independent_across_projects(project):
    """Each project keeps its own counter (C5)."""

    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="other", slug="OTHER"
    )

    assert allocate_sequence_id(project.id) == 1
    assert allocate_sequence_id(other.id) == 1
    assert allocate_sequence_id(project.id) == 2


@pytest.mark.django_db
def test_key_reproduces_identifier_prefix(project):
    """The allocated seq reproduces the ``{slug}-{seq}`` key (C5)."""

    seq = allocate_sequence_id(project.id)

    assert f"{project.slug}-{seq}" == "MEML-1"
