"""Tests for the per-run design-directory watcher (#521).

Covers the acceptance criteria for live discovery:
- Creating an HTML or Markdown file inside the watched directory registers it and
  publishes a ``created`` document frame on the module bus.
- Rewriting the file publishes an ``updated`` frame against the same row —
  no duplicate registration.
- Non-document files are ignored; start is a no-op without a directory; stop is
  idempotent.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from asgiref.sync import async_to_sync

from apps.documents import dao, watch


pytestmark = pytest.mark.django_db(transaction=True)


async def _wait_for(predicate, timeout: float = 8.0):
    """Poll until ``predicate()`` is truthy, failing after ``timeout``."""

    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        value = predicate()
        if value:
            return value
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not met before timeout")
        await asyncio.sleep(0.05)


async def test_create_and_update_flow(tmp_path: Path):
    root = tmp_path / "design"
    root.mkdir()
    frames: list[dict] = []

    # Stub async publish matching the single-argument call-site contract.

    async def publish(frame):
        frames.append(frame)

    try:
        started = watch.start_watch(
            agent_run_id="run-1",
            design_dir=str(root),
            module_id="m1",
            task_id="t1",
            scope="task",
            publish=publish,
        )
        assert started is True

        # Let the watcher task boot before producing events.

        await asyncio.sleep(0.5)

        # Creation registers the document and relays a `created` frame.

        (root / "design.html").write_text("<html>v1</html>")
        await _wait_for(lambda: frames)
        frame = frames[0]
        assert frame["module_id"] == "m1"
        assert frame["type"] == "document"
        assert frame["event"] == "created"
        assert frame["task_id"] == "t1"
        assert frame["doc"]["rel_path"] == "design.html"
        assert frame["doc"]["label"] == "design"

        # Wait out the debounce window, then rewrite: same row, `updated`.

        await asyncio.sleep(watch.DEBOUNCE_SECONDS + 0.1)
        (root / "design.html").write_text("<html>version two</html>")
        await _wait_for(lambda: len(frames) >= 2)
        assert frames[1]["event"] == "updated"
        assert frames[1]["doc"]["rel_path"] == "design.html"

        watch.stop_watch("run-1")
    finally:
        watch.stop_all()

    rows = await dao.list_for_task("t1")
    assert len(rows) == 1
    assert rows[0].rel_path == "design.html"
    assert rows[0].discovered_by_run_id == "run-1"


async def test_watcher_survives_temporary_async_to_sync_launch_loop(tmp_path: Path):
    root = tmp_path / "design"
    root.mkdir()
    frames: list[dict] = []

    async def publish(frame):
        frames.append(frame)

    async def launch_from_temporary_loop() -> bool:
        return watch.start_watch(
            agent_run_id="run-sync-launch",
            design_dir=str(root),
            module_id="m1",
            task_id="t1",
            scope="task",
            publish=publish,
        )

    await watch.startup()
    try:
        started = await asyncio.to_thread(async_to_sync(launch_from_temporary_loop))
        assert started is True
        await asyncio.sleep(0.5)

        (root / "spec.md").write_text("# Discovered after launch returned")

        await _wait_for(lambda: frames)
        assert frames[0]["doc"]["rel_path"] == "spec.md"
    finally:
        await watch.shutdown()


async def test_markdown_create_and_update_flow_is_case_insensitive(tmp_path: Path):
    root = tmp_path / "design"
    root.mkdir()
    frames: list[dict] = []

    async def publish(frame):
        frames.append(frame)

    try:
        watch.start_watch(
            agent_run_id="run-md",
            design_dir=str(root),
            module_id="m1",
            task_id="t1",
            scope="task",
            publish=publish,
        )
        await asyncio.sleep(0.5)

        (root / "SPEC.MD").write_text("# Version 1")
        await _wait_for(lambda: frames)
        assert frames[0]["event"] == "created"
        assert frames[0]["doc"]["rel_path"] == "SPEC.MD"

        await asyncio.sleep(watch.DEBOUNCE_SECONDS + 0.1)
        (root / "SPEC.MD").write_text("# A longer version 2")
        await _wait_for(lambda: len(frames) >= 2)
        assert frames[1]["event"] == "updated"
        assert frames[1]["doc"]["rel_path"] == "SPEC.MD"
    finally:
        watch.stop_all()

    rows = await dao.list_for_task("t1")
    assert [row.rel_path for row in rows] == ["SPEC.MD"]


async def test_non_document_files_are_ignored(tmp_path: Path):
    root = tmp_path / "design"
    root.mkdir()
    frames: list[dict] = []

    async def publish(frame):
        frames.append(frame)

    try:
        watch.start_watch(
            agent_run_id="run-1",
            design_dir=str(root),
            module_id="m1",
            task_id="t1",
            scope="task",
            publish=publish,
        )

        # Let the watcher task boot before producing events.

        await asyncio.sleep(0.5)
        (root / "notes.txt").write_text("not a doc")
        (root / "style.css").write_text("body{}")

        # The HTML write afterwards proves the watcher was live throughout.

        (root / "real.html").write_text("<html></html>")
        await _wait_for(lambda: frames)
        watch.stop_watch("run-1")
    finally:
        watch.stop_all()

    assert [f["doc"]["rel_path"] for f in frames] == ["real.html"]
    assert [r.rel_path for r in await dao.list_for_task("t1")] == ["real.html"]


async def test_start_without_dir_is_noop_and_stop_is_idempotent(tmp_path: Path):
    async def publish(*_):
        return None

    assert (
        watch.start_watch(
            agent_run_id="run-x",
            design_dir=None,
            module_id="m1",
            task_id="t1",
            scope="task",
            publish=publish,
        )
        is False
    )
    assert (
        watch.start_watch(
            agent_run_id="run-x",
            design_dir=str(tmp_path / "missing"),
            module_id="m1",
            task_id="t1",
            scope="task",
            publish=publish,
        )
        is False
    )
    watch.stop_watch("run-x")
    watch.stop_watch("run-x")
