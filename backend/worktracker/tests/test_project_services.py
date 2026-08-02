from concurrent.futures import ThreadPoolExecutor
import uuid

import pytest
from django.db import close_old_connections

from worktracker.models import (
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    State,
    Workspace,
)
from worktracker.services.errors import ConflictError, NotFoundError, ServiceError
from worktracker.services.projects import (
    create_project,
    delete_project,
    resolve_current_project,
    update_project,
)


@pytest.mark.django_db
def test_create_project_seeds_defaults_and_persists_description(project):
    created = create_project(
        name="Second",
        slug="SEC",
        description="# Goals\n\nShip it.",
        workspace_slug="meml",
    )

    assert created.slug == "SEC"
    assert created.description == "# Goals\n\nShip it."
    assert created.seq_counter == 0
    assert State.objects.filter(project=created).count() == 7
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
        create_project(name="Dup", slug="MEML", workspace_slug="meml")

    assert excinfo.value.status_code == 409
    assert Project.objects.filter(slug="MEML").count() == 1


@pytest.mark.django_db
def test_resolve_current_project_creates_fully_seeded_cdn_project():
    Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")

    resolved = resolve_current_project()

    assert resolved.name == "coding"
    assert resolved.slug == "CDN"
    assert Project.objects.filter(slug="CDN").count() == 1
    assert State.objects.filter(project=resolved).count() == 7
    assert IssueType.objects.filter(project=resolved).count() == 4
    assert LaunchBinding.objects.filter(issue_type__project=resolved).count() == 21
    assert all(
        issue_type.start_state_id is not None
        and issue_type.workflow_revision == 1
        and IssueTypeTransition.objects.filter(issue_type=issue_type).exists()
        for issue_type in IssueType.objects.filter(project=resolved, level="task")
    )


@pytest.mark.django_db
def test_resolve_current_project_returns_existing_cdn_project():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    existing = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="Existing", slug="CDN"
    )

    resolved = resolve_current_project()

    assert resolved.id == existing.id
    assert resolved.name == "Existing"
    assert list(Project.objects.values_list("id", flat=True)) == [existing.id]


@pytest.mark.django_db
def test_resolve_current_project_preserves_other_projects_and_is_idempotent(project):
    original = {
        "id": project.id,
        "workspace_id": project.workspace_id,
        "name": project.name,
        "slug": project.slug,
        "description": project.description,
    }

    first = resolve_current_project()
    second = resolve_current_project()

    assert first.id == second.id
    assert first.slug == "CDN"
    assert Project.objects.count() == 2
    assert Project.objects.filter(**original).exists()


@pytest.mark.django_db(transaction=True)
def test_resolve_current_project_is_safe_for_concurrent_callers():
    Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")

    def resolve_in_thread():
        close_old_connections()
        try:
            return resolve_current_project().id
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        resolved_ids = list(executor.map(lambda _: resolve_in_thread(), range(2)))

    assert resolved_ids[0] == resolved_ids[1]
    assert Project.objects.filter(slug="CDN").count() == 1


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
def test_create_project_missing_workspace_404():
    with pytest.raises(NotFoundError):
        create_project(name="NoWs", slug="NWS")


@pytest.mark.django_db
def test_first_successful_project_creation_preserves_workspace_onboarding():
    workspace = Workspace.objects.create(
        id=uuid.uuid4(),
        slug="meml",
        name="meml",
        onboarding_required=True,
    )

    create_project(name="First chosen project", slug="FIRST", workspace_slug="meml")

    workspace.refresh_from_db()
    assert Project.objects.filter(workspace=workspace).count() == 1
    assert workspace.onboarding_required is True


@pytest.mark.django_db
def test_failed_project_creation_preserves_workspace_onboarding(project):
    workspace = project.workspace
    workspace.onboarding_required = True
    workspace.save(update_fields=["onboarding_required"])

    with pytest.raises(ConflictError):
        create_project(name="Duplicate", slug=project.slug, workspace_slug="meml")

    assert Workspace.objects.get(pk=workspace.id).onboarding_required is True
