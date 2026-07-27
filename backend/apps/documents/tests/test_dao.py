"""Tests for the design-documents Django DAO."""

import pytest

from apps.documents import dao


pytestmark = pytest.mark.django_db(transaction=True)
SCRATCH = "00000000-0000-0000-0000-000000000000"


async def _upsert(
    *,
    doc_id: str = "doc-1",
    task_id: str = "task-1",
    module_id: str = "mod-1",
    rel_path: str = "design.html",
    root_dir: str = "/repo/spec/m--1/T9--x",
    run_id: str | None = "run-1",
    now: str = "2026-06-11T10:00:00",
):
    return await dao.upsert_document(
        doc_id=doc_id,
        module_id=module_id,
        task_id=task_id,
        scope="task",
        root_dir=root_dir,
        rel_path=rel_path,
        discovered_by_run_id=run_id,
        now=now,
    )


async def test_upsert_creates_then_touches_only_updated_at() -> None:
    row, created = await _upsert()
    row2, created2 = await _upsert(
        doc_id="doc-2",
        task_id="other-task",
        module_id="other-module",
        run_id=None,
        now="2026-06-11T11:00:00",
    )

    assert created is True
    assert created2 is False
    assert row2.id == row.id == "doc-1"
    assert row2.task_id == "task-1"
    assert row2.module_id == "mod-1"
    assert row2.discovered_by_run_id == "run-1"
    assert row2.created_at == "2026-06-11T10:00:00"
    assert row2.updated_at == "2026-06-11T11:00:00"


async def test_same_rel_path_under_other_root_is_distinct() -> None:
    await _upsert()
    _, created = await _upsert(doc_id="doc-2", root_dir="/repo/spec/other")

    assert created is True


async def test_get_document() -> None:
    await _upsert()

    row = await dao.get_document("doc-1")
    assert row is not None and row.rel_path == "design.html"
    assert await dao.get_document("nope") is None


async def test_list_for_task_ordered_oldest_first() -> None:
    await _upsert(doc_id="doc-b", rel_path="b.html", now="2026-06-11T12:00:00")
    await _upsert(doc_id="doc-a", rel_path="a.html", now="2026-06-11T10:00:00")

    rows = await dao.list_for_task("task-1")

    assert [row.rel_path for row in rows] == ["a.html", "b.html"]
    assert await dao.list_for_task("other") == []


async def test_list_for_scratch_filters_by_module() -> None:
    await _upsert(doc_id="doc-1", task_id=SCRATCH, module_id="mod-1")
    await _upsert(
        doc_id="doc-2",
        task_id=SCRATCH,
        module_id="mod-2",
        root_dir="/repo/spec/other",
    )

    rows = await dao.list_for_scratch("mod-1", SCRATCH)

    assert [row.id for row in rows] == ["doc-1"]
