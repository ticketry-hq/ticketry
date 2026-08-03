"""Tests for the canonical design-directory path contract (#521).

Covers the acceptance criteria for path calculation:
- Slugs are lowercase, dash-collapsed, truncated without a trailing dash.
- Module/task directory names pair a readable slug with an authoritative
  id/key suffix; planning dirs are run-scoped under the module.
- Resolution is rename-proof: existing directories are matched by the id
  suffix / key prefix only, never by re-derived slugs.
- ``scan_documents`` lists nested HTML/Markdown case-insensitively and skips
  symlink escapes.
"""

from __future__ import annotations

import os
from pathlib import Path

from apps.documents import design_docs
from studio_server.contracts import ModuleSummary, TaskState, TaskSummary


def _module(name: str = "Platform") -> ModuleSummary:
    return ModuleSummary(
        id="35f9e33a-bcb3-4198-96ce-e2dc0f87304f",
        name=name,
        project_id="proj-1",
    )


def _task(name: str = "Display generated HTML", seq: int | None = 521) -> TaskSummary:
    return TaskSummary(
        id="1a25c66a-7979-47c7-a273-f317f121a1a4",
        name=name,
        issue_type="Story",
        project_id="proj-1",
        sequence_id=seq,
        state=TaskState(name="Todo"),
    )


# ---------- slugify ----------


def test_slugify_collapses_symbol_runs() -> None:
    assert design_docs.slugify("Add: a/b — c!!", 40) == "add-a-b-c"


def test_slugify_truncates_without_trailing_dash() -> None:
    assert design_docs.slugify("alpha beta", 6) == "alpha"


def test_slugify_empty_falls_back_to_untitled() -> None:
    assert design_docs.slugify("£€¡", 10) == "untitled"


# ---------- directory names ----------


def test_module_dir_name_pairs_slug_and_id_suffix() -> None:
    assert design_docs.module_dir_name(_module()) == "platform--35f9e33a"


def test_task_dir_name_uses_sequence_key() -> None:
    assert (
        design_docs.task_dir_name(_task())
        == "T521--display-generated-html"
    )


def test_task_dir_name_falls_back_to_id_without_sequence() -> None:
    assert design_docs.task_dir_name(_task(seq=None)).startswith("1a25c66a--")


def test_task_design_dir_layout() -> None:
    assert (
        design_docs.task_design_dir(_module(), _task())
        == "spec/platform--35f9e33a/T521--display-generated-html"
    )


def test_planning_design_dir_is_run_scoped() -> None:
    assert (
        design_docs.planning_design_dir(_module(), "a3f9c2d1deadbeef")
        == "spec/platform--35f9e33a/planning/a3f9c2d1"
    )


# ---------- rename-proof resolution ----------


def test_resolve_returns_canonical_when_nothing_exists(tmp_path: Path) -> None:
    assert (
        design_docs.resolve_task_design_dir(tmp_path, _module(), _task())
        == "spec/platform--35f9e33a/T521--display-generated-html"
    )


def test_resolve_reuses_renamed_module_and_task_dirs(tmp_path: Path) -> None:
    # Dirs created under earlier names; only id suffix / key prefix match.

    existing = tmp_path / "spec" / "old-name--35f9e33a" / "T521--old-slug"
    existing.mkdir(parents=True)

    resolved = design_docs.resolve_task_design_dir(tmp_path, _module(), _task())
    assert resolved == "spec/old-name--35f9e33a/T521--old-slug"


def test_resolve_other_task_dirs_do_not_match(tmp_path: Path) -> None:
    (tmp_path / "spec" / "platform--35f9e33a" / "T520--other").mkdir(parents=True)

    resolved = design_docs.resolve_task_design_dir(tmp_path, _module(), _task())
    assert resolved == "spec/platform--35f9e33a/T521--display-generated-html"


# ---------- filesystem helpers ----------


def test_ensure_dir_creates_and_returns_absolute(tmp_path: Path) -> None:
    abs_dir = design_docs.ensure_dir(tmp_path, "spec/m--1/T9--x")
    assert abs_dir.is_dir()
    assert abs_dir == (tmp_path / "spec/m--1/T9--x").resolve()


def test_scan_documents_lists_html_and_markdown_case_insensitive(
    tmp_path: Path,
) -> None:
    (tmp_path / "design.html").write_text("<html></html>")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "REPORT.HTML").write_text("<html></html>")
    (tmp_path / "SPEC.md").write_text("# Spec")
    (tmp_path / "sub" / "notes.MD").write_text("# Notes")
    (tmp_path / "notes.txt").write_text("not a doc")

    assert design_docs.scan_documents(tmp_path) == [
        "SPEC.md",
        "design.html",
        "sub/REPORT.HTML",
        "sub/notes.MD",
    ]


def test_scan_documents_skips_symlink_escapes(tmp_path: Path) -> None:
    outside = tmp_path / "outside.md"
    outside.write_text("# Outside")
    inside = tmp_path / "dir"
    inside.mkdir()
    os.symlink(outside, inside / "link.md")

    assert design_docs.scan_documents(inside) == []


def test_scan_documents_missing_dir_is_empty(tmp_path: Path) -> None:
    assert design_docs.scan_documents(tmp_path / "nope") == []
