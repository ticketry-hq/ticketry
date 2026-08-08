"""Small deterministic work-item factories shared by cross-app tests."""

from __future__ import annotations

import uuid

from django.db.models import Max

from worktracker.models import Issue, IssueType, Project, Workspace


_NAMESPACE = uuid.UUID("db7ca9dc-a441-49af-a268-6a620b416caf")


def fixture_uuid(label: str) -> str:
    """Map a readable fixture label to a stable UUID string."""

    try:
        return str(uuid.UUID(str(label)))
    except ValueError:
        return str(uuid.uuid5(_NAMESPACE, str(label)))


def fixture_issue_id(
    *, project_id: str = "proj-1", module_id: str = "mod-1", task_id: str | None
) -> str:
    """Return the stable id used by :func:`ensure_issue`."""

    project_uuid = fixture_uuid(project_id)
    if task_id is None:
        return fixture_uuid(f"{project_uuid}:module:{module_id}")
    return fixture_uuid(f"{project_uuid}:module:{module_id}:task:{task_id}")


def ensure_issue(
    *,
    project_id: str = "proj-1",
    module_id: str = "mod-1",
    task_id: str | None = "task-1",
) -> Issue:
    """Return a persisted module or task for readable cross-app fixture ids."""

    project_uuid = fixture_uuid(project_id)
    module_uuid = fixture_issue_id(
        project_id=project_id, module_id=module_id, task_id=None
    )
    workspace, _ = Workspace.objects.get_or_create(
        id=fixture_uuid(f"{project_uuid}:workspace"),
        defaults={
            "slug": f"test-{project_uuid}",
            "name": f"Workspace {project_id}",
        },
    )
    project, _ = Project.objects.get_or_create(
        id=project_uuid,
        defaults={
            "workspace": workspace,
            "name": f"Project {project_id}",
            "slug": "TEST",
        },
    )
    module_type, _ = IssueType.objects.get_or_create(
        id=fixture_uuid(f"{project_uuid}:module-type"),
        defaults={
            "project": project,
            "name": "Module",
            "level": "module",
        },
    )
    module = Issue.objects.filter(id=module_uuid).first()
    if module is None:
        next_sequence = (
            Issue.objects.filter(project=project).aggregate(
                value=Max("sequence_id")
            )["value"]
            or 0
        ) + 1
        module = Issue.objects.create(
            id=module_uuid,
            project=project,
            type="module",
            issue_type=module_type,
            name=f"Module {module_id}",
            sequence_id=next_sequence,
        )
    if task_id is None:
        return module

    task_uuid = fixture_issue_id(
        project_id=project_id, module_id=module_id, task_id=task_id
    )
    task_type, _ = IssueType.objects.get_or_create(
        id=fixture_uuid(f"{project_uuid}:task-type"),
        defaults={
            "project": project,
            "name": "Task",
            "level": "task",
        },
    )
    task = Issue.objects.filter(id=task_uuid).first()
    if task is not None:
        return task
    next_sequence = (
        Issue.objects.filter(project=project).aggregate(value=Max("sequence_id"))[
            "value"
        ]
        or 0
    ) + 1
    return Issue.objects.create(
        id=task_uuid,
        project=project,
        type="task",
        issue_type=task_type,
        parent=module,
        module=module,
        name=f"Task {task_id}",
        sequence_id=next_sequence,
    )
