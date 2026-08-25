"""HTTP-surface tests for the single-file working-tree diff (#980, AC 2).

Real git, real worktrees, no terminal: the endpoint is the whole way a Studio
reviewer sees what changed in a file.
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


def request_diff(path: str, **params):
    query = {"task_id": TASK_ID, "module_id": MODULE_ID, "path": path, **params}
    return client.get("/worktrees/changes/file-diff", data=query)


def read_diff(path: str, **params) -> dict:
    response = request_diff(path, **params)
    assert response.status_code == 200, response.content
    return response.json()


def test_a_modified_file_returns_its_working_tree_patch(checkout):
    (checkout / "kept.txt").write_text("one\ntwo\nthree\nfour\n")

    body = read_diff("kept.txt")

    assert body["status"] == "modified"
    assert body["binary"] is False
    assert body["truncated"] is False
    assert "+four" in body["patch"]
    assert body["patch"].startswith("diff --git")


def test_an_untracked_file_returns_a_patch_of_its_whole_content(checkout):
    (checkout / "fresh.txt").write_text("alpha\nbeta\n")

    body = read_diff("fresh.txt")

    assert body["status"] == "untracked"
    assert "+alpha" in body["patch"]
    assert "+beta" in body["patch"]


def test_a_deleted_file_returns_its_removed_lines(checkout):
    (checkout / "doomed.txt").unlink()

    body = read_diff("doomed.txt")

    assert body["status"] == "deleted"
    assert "-bye" in body["patch"]


def test_a_rename_renders_as_a_rename_not_a_rewrite(checkout):
    git(["mv", "kept.txt", "moved.txt"], checkout)

    body = read_diff("moved.txt")

    assert body["status"] == "renamed"
    assert "rename from kept.txt" in body["patch"]
    assert "rename to moved.txt" in body["patch"]


def test_a_binary_file_reports_a_difference_without_content(checkout):
    (checkout / "image.bin").write_bytes(b"\x00\x01\x02\x03")

    body = read_diff("image.bin")

    assert body["binary"] is True
    assert "Binary files" in body["patch"]


def test_a_file_with_one_very_long_line_still_returns_a_patch(checkout):
    (checkout / "kept.txt").write_text("x" * 200_000 + "\n")

    body = read_diff("kept.txt")

    assert body["truncated"] is False
    assert len(body["patch"]) > 200_000


def test_an_unchanged_file_is_refused_rather_than_read(checkout):
    """The change set is the access bound: nothing else can be fetched."""

    response = request_diff("kept.txt")

    assert response.status_code == 404
    assert response.json()["code"] == "file_not_changed"


def test_a_path_outside_the_checkout_is_rejected_before_git_runs(checkout):
    for attempt in ("../outside.txt", "/etc/passwd", "nested/../../escape.txt"):
        response = request_diff(attempt)
        assert response.status_code == 400, attempt


def test_a_task_without_a_worktree_has_no_file_to_diff():
    response = request_diff("kept.txt")

    assert response.status_code == 404
    assert response.json()["code"] == "file_not_changed"
