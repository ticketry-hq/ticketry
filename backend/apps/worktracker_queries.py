"""Async presentation seam over the owned WorkTracker query services."""

from __future__ import annotations

from typing import Optional

from asgiref.sync import sync_to_async
from worktracker.services import queries

from studio_server.contracts import (
    AssigneeSummary,
    LabelSummary,
    ModuleSummary,
    TaskDetails,
    TaskState,
    TaskSummary,
)


def _state(raw: Optional[dict]) -> TaskState:
    if not raw:
        return TaskState(name="Unknown")
    return TaskState(
        id=str(raw["id"]) if raw.get("id") else None,
        name=raw.get("name", "Unknown"),
        group=raw.get("group", "") or "",
        color=raw.get("color"),
    )


def _task(item: dict) -> TaskSummary:
    raw_issue_type = item.get("issue_type")
    issue_type = raw_issue_type.get("name") if isinstance(raw_issue_type, dict) else raw_issue_type
    return TaskSummary(
        id=str(item["id"]),
        name=item.get("name", "Untitled"),
        project_id=str(item["project_id"]),
        sequence_id=item.get("sequence_id"),
        state=_state(item.get("state")),
        issue_type=issue_type,
        assignees=[
            AssigneeSummary(display_name=a.get("display_name"), email=a.get("email"))
            for a in item.get("assignees", [])
        ],
        labels=[LabelSummary(name=label.get("name", "")) for label in item.get("labels", [])],
        description_html=item.get("description_html"),
        description_stripped=item.get("description_stripped"),
        description=item.get("description"),
        parent_id=str(item["parent_id"]) if item.get("parent_id") else None,
        sub_issues_count=item.get("sub_issues_count", 0),
    )


async def get_modules(project_id: str) -> list[ModuleSummary]:
    modules = await sync_to_async(queries.list_modules)(project_id)
    return [
        ModuleSummary(id=str(m["id"]), name=m["name"], project_id=str(m["project_id"]))
        for m in modules
    ]


async def get_tasks_and_states(
    project_id: str, module_id: str
) -> tuple[list[TaskSummary], list[TaskState]]:
    items, states = await sync_to_async(queries.list_module_tasks_and_states)(
        project_id, module_id
    )
    tasks = [
        _task(item)
        for item in items
        if str(item.get("parent_id")) == str(module_id)
    ]
    return tasks, [_state(state) for state in states]


async def get_task_details(project_id: str, task_id: str) -> TaskDetails:
    del project_id
    item = await sync_to_async(queries.retrieve_work_item)(task_id)
    return TaskDetails(task=_task(item))
