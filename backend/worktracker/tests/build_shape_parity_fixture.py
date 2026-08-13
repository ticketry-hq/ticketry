"""Build one Django fixture database and print its canonical REST read shapes.

The Rust integration test owns the temporary path and invokes this helper as a
separate process so Django and SeaORM read the exact same SQLite database.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import uuid
from datetime import datetime, UTC


DATABASE_PATH = Path(sys.argv[1]).resolve()
os.environ["DJANGO_SETTINGS_MODULE"] = "worktracker.tests.parity_settings"
os.environ["WORKTRACKER_PARITY_DATABASE"] = str(DATABASE_PATH)
os.environ["MUXED_DATA_DIR"] = str(DATABASE_PATH.parent)

import django  # noqa: E402

django.setup()

from django.core.management import call_command  # noqa: E402
from django.test import Client  # noqa: E402

from worktracker.models import (  # noqa: E402
    AgentModel,
    AgentModelReasoningLevel,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    Project,
    Provider,
    ReasoningLevel,
    State,
    Workspace,
)


def fixture_id(value: int) -> uuid.UUID:
    return uuid.UUID(f"{value:032x}")


def get_json(client: Client, path: str):
    response = client.get(path, headers={"x-api-key": "test-token"})
    if response.status_code != 200:
        raise RuntimeError(f"GET {path} returned {response.status_code}: {response.content!r}")
    return response.json()


def post_json(client: Client, path: str, body: dict):
    response = client.post(
        path,
        data=json.dumps(body),
        content_type="application/json",
        headers={"x-api-key": "test-token"},
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"POST {path} returned {response.status_code}: {response.content!r}"
        )
    return response.json()


def build_fixture() -> dict:
    call_command("migrate", interactive=False, verbosity=0)

    # The production migration chain intentionally seeds a default workspace,
    # workflow, and provider catalog. Replace those rows with a smaller,
    # deterministic corpus while retaining the exact migrated table shapes.
    Issue.objects.all().delete()
    LaunchBinding.objects.all().delete()
    IssueTypeTransition.objects.all().delete()
    AgentModelReasoningLevel.objects.all().delete()
    AgentModel.objects.all().delete()
    ReasoningLevel.objects.all().delete()
    Provider.objects.all().delete()
    IssueType.objects.all().delete()
    State.objects.all().delete()
    Project.objects.all().delete()
    Workspace.objects.all().delete()

    workspace = Workspace.objects.create(
        id=fixture_id(1),
        slug="memory-lane",
        name="Memory Lane",
        onboarding_required=True,
    )
    project = Project.objects.create(
        id=fixture_id(10),
        workspace=workspace,
        name="Primary",
        slug="MEM",
        description="Parity fixture",
        manual_module_order=True,
    )
    Project.objects.create(
        id=fixture_id(11),
        workspace=workspace,
        name="Secondary",
        slug="SEC",
        description="Ordering sentinel",
    )

    done = State.objects.create(
        id=fixture_id(22),
        project=project,
        name="Done",
        group="completed",
        color="#00aa00",
        sort_order=30,
        is_protected=True,
    )
    todo = State.objects.create(
        id=fixture_id(20),
        project=project,
        name="Todo",
        group="unstarted",
        color="#aaaaaa",
        sort_order=10,
        is_protected=True,
    )
    doing = State.objects.create(
        id=fixture_id(21),
        project=project,
        name="Doing",
        group="started",
        color="#0055ff",
        sort_order=20,
    )

    task_type = IssueType.objects.create(
        id=fixture_id(31),
        project=project,
        name="Story",
        level="task",
        color="#123456",
        sort_order=20,
        start_state=todo,
        workflow_revision=7,
    )
    module_type = IssueType.objects.create(
        id=fixture_id(30),
        project=project,
        name="Epic",
        level="module",
        color="#654321",
        sort_order=10,
        start_state=todo,
        workflow_revision=3,
    )
    IssueType.objects.create(
        id=fixture_id(32),
        project=project,
        name="Pathfind",
        level="task",
        sort_order=30,
        start_state=todo,
        is_pathfind=True,
    )

    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=doing,
        to_state=done,
        agent_allowed=False,
    )
    IssueTypeTransition.objects.create(
        issue_type=task_type,
        from_state=todo,
        to_state=doing,
        agent_allowed=True,
    )

    codex = Provider.objects.create(
        id=fixture_id(40), slug="codex", activated=True, supports_unattended=True
    )
    Provider.objects.create(
        id=fixture_id(41), slug="claude", activated=False, supports_unattended=True
    )
    high = ReasoningLevel.objects.create(id=fixture_id(50), name="high")
    ReasoningLevel.objects.create(id=fixture_id(51), name="low")
    model = AgentModel.objects.create(id=fixture_id(60), provider=codex, name="gpt-z")
    AgentModel.objects.create(id=fixture_id(61), provider=codex, name="gpt-a")
    AgentModelReasoningLevel.objects.create(agent_model=model, reasoning_level=high)

    LaunchBinding.objects.create(
        issue_type=task_type,
        state=doing,
        prompt="Implement the agreed slice.",
        required_skills=["tdd", "backend-debug"],
        model=model,
        reasoning=high,
        auto_start=True,
        subtree_run_enabled=True,
    )
    LaunchBinding.objects.create(
        issue_type=module_type,
        state=todo,
        prompt="Plan this module.",
        required_skills=[],
    )

    older_module = Issue.objects.create(
        id=fixture_id(70),
        project=project,
        type="module",
        issue_type=module_type,
        name="Later rank",
        sequence_id=1,
        rank="z",
    )
    first_module = Issue.objects.create(
        id=fixture_id(71),
        project=project,
        type="module",
        issue_type=module_type,
        name="First rank",
        sequence_id=2,
        rank="A",
    )
    Issue.objects.create(
        id=fixture_id(72),
        project=project,
        type="module",
        issue_type=module_type,
        name="Archived middle rank",
        sequence_id=3,
        rank="M",
        is_archived=True,
    )

    root = Issue.objects.create(
        id=fixture_id(80),
        project=project,
        type="task",
        issue_type=task_type,
        parent=first_module,
        module=first_module,
        state=doing,
        name="Root story",
        sequence_id=4,
        rank="z",
        description="Root description",
    )
    child = Issue.objects.create(
        id=fixture_id(81),
        project=project,
        type="task",
        issue_type=task_type,
        parent=root,
        module=first_module,
        state=todo,
        name="Active child",
        sequence_id=5,
        rank="A",
    )
    archived_child = Issue.objects.create(
        id=fixture_id(82),
        project=project,
        type="task",
        issue_type=task_type,
        parent=root,
        module=first_module,
        state=todo,
        name="Archived child",
        sequence_id=6,
        rank="M",
        is_archived=True,
    )
    root.blocked_by.add(child, archived_child)

    # Freeze timestamps after model creation so serializer formatting is stable
    # while still exercising the real auto_now/auto_now_add columns.
    frozen = datetime(2026, 8, 12, 12, 34, 56, 123456, tzinfo=UTC)
    Project.objects.update(created_at=frozen, updated_at=frozen)
    State.objects.update(created_at=frozen, updated_at=frozen)
    IssueType.objects.update(created_at=frozen, updated_at=frozen)
    Issue.objects.update(created_at=frozen, updated_at=frozen)
    LaunchBinding.objects.update(created_at=frozen, updated_at=frozen)

    client = Client()
    base = "/api/work-tracker"
    project_id = str(project.id)
    module_id = str(first_module.id)
    state_id = str(todo.id)
    type_id = str(task_type.id)
    batch_ids = [str(root.id), str(child.id), str(root.id), str(older_module.id)]

    rest = {
        "workspace": get_json(client, f"{base}/workspace"),
        "projects": get_json(client, f"{base}/projects"),
        "modules": get_json(client, f"{base}/projects/{project_id}/modules"),
        "archived_modules": get_json(
            client, f"{base}/projects/{project_id}/modules?include_archived=true"
        ),
        "work_items": get_json(client, f"{base}/work-items?module={module_id}"),
        "state_work_items": get_json(client, f"{base}/work-items?state={state_id}"),
        "work_items_by_ids": post_json(
            client, f"{base}/work-items/batch", {"ids": batch_ids}
        ),
        "work_item": get_json(client, f"{base}/work-items/{root.key}"),
        "states": get_json(client, f"{base}/projects/{project_id}/states"),
        "issue_types": get_json(
            client, f"{base}/projects/{project_id}/issue-types"
        ),
        "issue_type": get_json(client, f"{base}/issue-types/{type_id}"),
        "issue_type_transitions": get_json(
            client, f"{base}/issue-types/{type_id}/transitions"
        ),
        "launch_bindings": get_json(
            client, f"{base}/projects/{project_id}/launch-bindings"
        ),
        "providers": get_json(client, f"{base}/providers"),
        "agent_models": get_json(client, f"{base}/models"),
        "reasoning_levels": get_json(client, f"{base}/reasoning-levels"),
    }
    return {
        "variables": {
            "project": project_id,
            "module": module_id,
            "state": state_id,
            "type": type_id,
            "workItemKey": root.key,
            "workItemIds": batch_ids,
        },
        "rest": rest,
    }


if __name__ == "__main__":
    print(json.dumps(build_fixture(), separators=(",", ":")))
