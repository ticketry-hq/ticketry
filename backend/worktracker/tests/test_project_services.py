import uuid

import pytest

from worktracker.models import (
    IssueType,
    IssueTypeTransition,
    Project,
    State,
)
from worktracker.services.errors import ConflictError, ServiceError
from worktracker.services.projects import (
    create_project,
    delete_project,
    update_project,
)
from worktracker.services.work_items import create_project_work_item


@pytest.mark.django_db
def test_create_project_seeds_defaults_and_persists_description(project):
    created = create_project(
        name="Second",
        slug="SEC",
        description="# Goals\n\nShip it.",
    )

    assert created.slug == "SEC"
    assert created.description == "# Goals\n\nShip it."
    assert created.seq_counter == 0
    assert State.objects.filter(project=created).count() == 8
    assert set(State.objects.filter(project=created).values_list("group", flat=True)) == {
        "backlog",
        "unstarted",
        "started",
        "completed",
        "cancelled",
    }
    assert set(
        State.objects.filter(project=created, is_protected=True).values_list(
            "name", flat=True
        )
    ) == {
        "Ideas",
        "Grill",
        "Spec",
        "Tickets",
        "Implement",
        "Review",
        "Done",
        "Cancelled",
    }
    assert set(
        IssueType.objects.filter(
            project=created, start_state__isnull=False
        ).values_list("name", flat=True)
    ) == {"Story", "Implementation", "PathFind"}
    story_type = IssueType.objects.get(project=created, name="Story")
    assert story_type.start_state.name == "Ideas"
    story = create_project_work_item(
        created.id,
        name="New story",
        issue_type_id=story_type.id,
    )
    assert story.state.name == "Ideas"
    assert all(
        issue_type.workflow_revision == 1
        and IssueTypeTransition.objects.filter(issue_type=issue_type).exists()
        for issue_type in IssueType.objects.filter(
            project=created, start_state__isnull=False
        )
    )


@pytest.mark.django_db
def test_create_project_rejects_duplicate_slug(project):
    with pytest.raises(ServiceError) as excinfo:
        create_project(name="Dup", slug="MEML")

    assert excinfo.value.status_code == 409
    assert Project.objects.filter(slug="MEML").count() == 1


@pytest.mark.django_db
def test_update_project_description_only(project):
    updated = update_project(project.id, description="updated")

    assert updated.name == "meml"
    assert updated.description == "updated"
    project.refresh_from_db()
    assert project.slug == "MEML"


@pytest.mark.django_db
def test_delete_project_cascades_owned_rows(project):
    from worktracker.models import Issue, IssueType

    State.objects.create(id=uuid.uuid4(), project=project, name="Todo", group="unstarted")
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Epic",
        sequence_id=1,
    )

    delete_project(project.id)

    assert not Project.objects.filter(id=project.id).exists()
    assert State.objects.filter(project_id=project.id).count() == 0
    assert IssueType.objects.filter(project_id=project.id).count() == 0
    assert Issue.objects.filter(project_id=project.id).count() == 0


@pytest.mark.django_db
def test_ordinary_project_creation_does_not_enter_onboarding():
    created = create_project(name="First chosen project", slug="FIRST")
    assert created.onboarding_required is False


@pytest.mark.django_db
def test_failed_project_creation_preserves_default_project_onboarding(project):
    project.onboarding_required = True
    project.save(update_fields=["onboarding_required"])

    with pytest.raises(ConflictError):
        create_project(name="Duplicate", slug=project.slug)

    project.refresh_from_db()
    assert project.onboarding_required is True
