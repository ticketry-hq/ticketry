"""HTTP-surface tests for the module base checkout review (#981).

Same real-git discipline as the worktree cases: the repository, the module
work item, and its host folder link are all real, so what these assert is what
Studio's module view will show. Each case names the acceptance criterion it
covers.
"""

from __future__ import annotations

import os
import shutil

import pytest
from django.test import Client

from apps.settings_store.models import ModuleLink
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


def request_changes(module_id):
    return client.get("/modules/changes", data={"module_id": str(module_id)})


def read_changes(module_id) -> dict:
    response = request_changes(module_id)
    assert response.status_code == 200, response.content
    return response.json()


def request_diff(module_id, path: str):
    return client.get(
        "/modules/changes/file-diff",
        data={"module_id": str(module_id), "path": path},
    )


def by_path(body) -> dict:
    return {entry["path"]: entry for entry in body["files"]}


def test_a_module_with_no_linked_folder_reports_absence_rather_than_failing():
    body = read_changes("11111111-1111-1111-1111-111111111111")

    assert body["kind"] == "no_checkout"
    assert body["checkout"] == "module"
    assert body["files"] == []
    assert body["reason"]


def test_a_clean_module_checkout_lists_no_files(repo, linked_module):
    body = read_changes(linked_module.id)

    assert body["kind"] == "changes"
    assert body["checkout"] == "module"
    assert body["dirty"] is False
    assert body["file_count"] == 0
    assert body["path"] == str(repo)
    assert body["branch"] == "main"
    # A base checkout is not being compared with anything.
    assert body["base_branch"] is None


def test_the_module_checkout_lists_every_change_with_its_own_counts(
    repo, linked_module
):
    """AC 1: the module view gets the same changed-file list as a worktree."""

    (repo / "kept.txt").write_text("one\ntwo\nthree\nfour\n")
    (repo / "doomed.txt").unlink()
    (repo / "fresh.txt").write_text("alpha\nbeta\n")

    body = read_changes(linked_module.id)
    files = by_path(body)

    assert body["kind"] == "changes"
    assert body["dirty"] is True
    assert files["kept.txt"]["status"] == "modified"
    assert (files["kept.txt"]["insertions"], files["kept.txt"]["deletions"]) == (1, 0)
    assert files["doomed.txt"]["status"] == "deleted"
    assert files["fresh.txt"]["status"] == "untracked"
    assert files["fresh.txt"]["insertions"] == 2


def test_a_changed_file_in_the_module_checkout_returns_its_patch(
    repo, linked_module
):
    """AC 1: the per-file diff reads the module checkout, not a worktree."""

    (repo / "kept.txt").write_text("one\ntwo\nthree\nfour\n")

    response = request_diff(linked_module.id, "kept.txt")

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "modified"
    assert "+four" in body["patch"]


def test_reading_again_reports_the_current_module_status(repo, linked_module):
    """AC 2: a refresh re-reads the checkout rather than a cached answer."""

    assert read_changes(linked_module.id)["file_count"] == 0

    (repo / "later.txt").write_text("later\n")

    refreshed = read_changes(linked_module.id)
    assert refreshed["file_count"] == 1
    assert refreshed["files"][0]["path"] == "later.txt"


def test_a_module_and_a_task_worktree_never_answer_for_each_other(
    repo, checkout, linked_module
):
    """AC 2: each read is identified by, and bounded to, its own checkout."""

    (repo / "module-only.txt").write_text("module\n")
    (checkout / "worktree-only.txt").write_text("worktree\n")

    module_body = read_changes(linked_module.id)
    worktree_body = client.get(
        "/worktrees/changes", data={"task_id": TASK_ID, "module_id": MODULE_ID}
    ).json()

    assert [entry["path"] for entry in module_body["files"]] == ["module-only.txt"]
    assert module_body["module_id"] == str(linked_module.id)
    assert module_body["task_id"] is None

    assert [entry["path"] for entry in worktree_body["files"]] == [
        "worktree-only.txt"
    ]
    assert worktree_body["checkout"] == "worktree"
    assert worktree_body["module_id"] is None
    assert worktree_body["path"] != module_body["path"]


@pytest.mark.parametrize(
    "path",
    [
        "../outside.txt",
        "nested/../../outside.txt",
        "/etc/passwd",
    ],
)
def test_a_path_outside_the_module_checkout_is_refused(repo, linked_module, path):
    """AC 3: traversal is rejected before a git argument is ever built."""

    (repo.parent / "outside.txt").write_text("secret\n")

    response = request_diff(linked_module.id, path)

    assert response.status_code == 400, response.content


def test_a_path_inside_the_checkout_that_is_not_changing_is_refused(
    repo, linked_module
):
    """AC 3: the diff endpoint is not a file reader for the whole checkout."""

    response = request_diff(linked_module.id, "kept.txt")

    assert response.status_code == 404
    assert response.json()["code"] == "file_not_changed"


def test_a_module_folder_that_is_not_a_checkout_explains_itself(
    tmp_path, linked_module
):
    """AC 3: a failed resolve reads as absence, never as raw git output."""

    plain = tmp_path / "not-a-repo"
    plain.mkdir()
    ModuleLink.objects.filter(module=linked_module).update(local_path=str(plain))

    body = read_changes(linked_module.id)

    assert body["kind"] == "no_checkout"
    assert body["reason"] == "this module's folder is not the top of a git checkout"


def test_a_module_folder_below_a_repository_root_is_refused(repo, linked_module):
    """AC 3: a subdirectory must not be reported as the whole repository."""

    nested = repo / "nested"
    nested.mkdir()
    git(["add", "-A"], repo)
    ModuleLink.objects.filter(module=linked_module).update(local_path=str(nested))

    body = read_changes(linked_module.id)

    assert body["kind"] == "no_checkout"


def test_a_module_folder_that_vanished_reports_absence(tmp_path, linked_module):
    ModuleLink.objects.filter(module=linked_module).update(
        local_path=str(tmp_path / "gone")
    )

    body = read_changes(linked_module.id)

    assert body["kind"] == "no_checkout"
    assert body["reason"] == "this module's folder is no longer on disk"


def test_a_diff_for_an_unreadable_module_checkout_is_curated(
    tmp_path, linked_module
):
    ModuleLink.objects.filter(module=linked_module).update(
        local_path=str(tmp_path / "gone")
    )

    response = request_diff(linked_module.id, "kept.txt")

    assert response.status_code == 404
    assert response.json()["code"] == "file_not_changed"


def test_a_module_change_set_past_the_output_cap_is_refused_not_truncated(
    repo, linked_module, monkeypatch
):
    """AC 3: the module read inherits the same caps, not a looser path."""

    from apps.source_control import git_cli

    monkeypatch.setattr(git_cli, "DEFAULT_OUTPUT_LIMIT_BYTES", 64)
    for index in range(20):
        (repo / f"file-{index}.txt").write_text("content\n")

    response = request_changes(linked_module.id)

    assert response.status_code == 413
    assert response.json()["code"] == "changes_too_large"


def test_a_failing_git_read_of_a_module_keeps_its_output_on_this_machine(
    repo, linked_module, tmp_path, monkeypatch
):
    """AC 3: a failed module read returns a sentence, never git's complaint."""

    directory = tmp_path / "fake-bin"
    directory.mkdir(exist_ok=True)
    fake = directory / "git"
    fake.write_text(
        "#!/bin/sh\n"
        'echo "fatal: /Users/someone/secret-repo is broken" >&2\n'
        "exit 3\n"
    )
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{directory}:{os.environ['PATH']}")

    response = request_changes(linked_module.id)

    assert response.status_code == 502
    body = response.json()
    assert body["code"] == "git_failed"
    assert body["stderr_bytes"] > 0
    assert "secret-repo" not in response.content.decode()
    assert "fatal" not in response.content.decode()
