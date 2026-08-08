import asyncio
import threading

import pytest
from asgiref.sync import sync_to_async

from apps import worktracker_queries
from apps.runs.chat.database import chat_database_sync_to_async


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_chat_launch_queries_do_not_wait_on_the_sync_request_executor(
    monkeypatch,
):
    occupied = threading.Event()
    release = threading.Event()

    def occupy_global_thread_sensitive_worker():
        occupied.set()
        release.wait(timeout=5)

    blocker = asyncio.create_task(
        sync_to_async(
            occupy_global_thread_sensitive_worker,
            thread_sensitive=True,
        )()
    )
    await asyncio.wait_for(asyncio.to_thread(occupied.wait), timeout=1)

    monkeypatch.setattr(
        worktracker_queries.queries,
        "retrieve_work_item",
        lambda task_id: {
            "id": task_id,
            "name": "Chat task",
            "project_id": "project-1",
            "state": None,
            "issue_type": "Story",
            "parent_id": "module-1",
        },
    )

    try:
        details = await asyncio.wait_for(
            worktracker_queries.get_task_details("project-1", "task-1"),
            timeout=1,
        )
        result = await asyncio.wait_for(
            chat_database_sync_to_async(lambda: "ready")(),
            timeout=1,
        )
    finally:
        release.set()
        await blocker

    assert details.task.id == "task-1"
    assert result == "ready"
