"""HTTP-surface tests for the worktree change list (#980, AC 1 and AC 3).

Drives the real ``git`` binary through the real worktrees engine; nothing about
git's reporting is stubbed. Each case names the acceptance criterion it covers.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


class HostClient(Client):
    def get(self, path, *args, **kwargs):
        return super().get(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


def read_changes(**params):
    query = "&".join(
        f"{key}={value}"
        for key, value in {"task_id": TASK_ID, "module_id": MODULE_ID, **params}.items()
    )
    response = client.get(f"/worktrees/changes?{query}")
    assert response.status_code == 200, response.content
    return response.json()


def by_path(body) -> dict:
    return {entry["path"]: entry for entry in body["files"]}


def test_a_task_without_a_worktree_reports_absence_rather_than_failing():
    body = read_changes()

    assert body["kind"] == "no_worktree"
    assert body["files"] == []
    assert body["reason"]


def test_a_clean_worktree_lists_no_files(checkout):
    body = read_changes()

    assert body["kind"] == "changes"
    assert body["dirty"] is False
    assert body["file_count"] == 0
    assert body["branch"]
    assert body["path"] == str(checkout)


def test_tracked_untracked_modified_and_deleted_files_all_carry_counts(checkout):
    """AC 1: every working-tree state is listed with accurate per-file counts."""

    (checkout / "kept.txt").write_text("one\ntwo\nthree\nfour\n")
    (checkout / "doomed.txt").unlink()
    (checkout / "fresh.txt").write_text("alpha\nbeta\n")
    (checkout / "staged.txt").write_text("staged\n")
    git(["add", "staged.txt"], checkout)

    body = read_changes()
    files = by_path(body)

    assert body["kind"] == "changes"
    assert body["dirty"] is True
    assert body["file_count"] == 4
    assert files["kept.txt"]["status"] == "modified"
    assert (files["kept.txt"]["insertions"], files["kept.txt"]["deletions"]) == (1, 0)
    assert files["doomed.txt"]["status"] == "deleted"
    assert (files["doomed.txt"]["insertions"], files["doomed.txt"]["deletions"]) == (0, 1)
    assert files["fresh.txt"]["status"] == "untracked"
    assert (files["fresh.txt"]["insertions"], files["fresh.txt"]["deletions"]) == (2, 0)
    assert files["staged.txt"]["status"] == "added"
    assert (files["staged.txt"]["insertions"], files["staged.txt"]["deletions"]) == (1, 0)
    assert body["insertions"] == 4
    assert body["deletions"] == 1


def test_untracked_files_in_subdirectories_are_listed_individually(checkout):
    (checkout / "nested").mkdir()
    (checkout / "nested" / "one.txt").write_text("x\n")
    (checkout / "nested" / "two.txt").write_text("y\nz")

    files = by_path(read_changes())

    assert files["nested/one.txt"]["insertions"] == 1
    # A final line without a newline still counts, exactly as git counts it.
    assert files["nested/two.txt"]["insertions"] == 2


def test_a_rename_keeps_its_original_path(checkout):
    git(["mv", "kept.txt", "moved.txt"], checkout)

    files = by_path(read_changes())

    assert files["moved.txt"]["status"] == "renamed"
    assert files["moved.txt"]["original_path"] == "kept.txt"


def test_binary_files_are_flagged_instead_of_counted(checkout):
    (checkout / "tracked.bin").write_bytes(b"\x00\x01\x02")
    git(["add", "tracked.bin"], checkout)
    git(["commit", "-m", "binary"], checkout)
    (checkout / "tracked.bin").write_bytes(b"\x00\x09\x0a\x0b")
    (checkout / "new.bin").write_bytes(b"\x00\xff\x00")

    files = by_path(read_changes())

    assert files["tracked.bin"]["binary"] is True
    assert files["tracked.bin"]["insertions"] is None
    assert files["new.bin"]["binary"] is True
    assert files["new.bin"]["insertions"] is None


def test_ignored_files_are_not_reported_as_changes(checkout):
    (checkout / ".gitignore").write_text("build/\n")
    (checkout / "build").mkdir()
    (checkout / "build" / "artifact.txt").write_text("generated\n")

    files = by_path(read_changes())

    assert ".gitignore" in files
    assert "build/artifact.txt" not in files


def test_refreshing_after_a_change_reports_the_current_status(checkout):
    """AC 3: the panel fetches current status rather than a cached answer."""

    assert read_changes()["file_count"] == 0

    (checkout / "later.txt").write_text("later\n")

    refreshed = read_changes()
    assert refreshed["file_count"] == 1
    assert refreshed["files"][0]["path"] == "later.txt"


def test_a_subtask_reads_its_parent_task_worktree(checkout):
    body = read_changes(task_id="subtask-1", parent_id=TASK_ID)

    assert body["kind"] == "changes"
    assert body["top_level_task_id"] == TASK_ID


def test_a_discarded_worktree_reports_absence_again(checkout):
    from apps.worktrees import service as worktrees_service

    worktrees_service.discard(TASK_ID)

    assert read_changes()["kind"] == "no_worktree"
