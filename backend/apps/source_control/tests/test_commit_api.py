"""HTTP-surface tests for committing a task worktree's changes (#982).

Every case drives the real endpoint against a real worktree cut by the real
worktrees engine, and then asks *git* what happened rather than asking the
response to confirm itself. Nothing about git, the index, or hooks is stubbed;
the only substituted things are the generator CLIs, which are ordinary scripts
on a private ``PATH``.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.source_control.tests.commit_fixtures import (
    install_generator,
    install_hook,
    isolate_generators,
)
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


class HostClient(Client):
    def post(self, path, *args, **kwargs):
        return super().post(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture
def bin_dir(monkeypatch, tmp_path):
    """No generator CLI is reachable unless a case installs one."""

    return isolate_generators(monkeypatch, tmp_path)


def request_commit(**params):
    return client.post(
        "/worktrees/changes/commit",
        data={"task_id": TASK_ID, "module_id": MODULE_ID, **params},
        content_type="application/json",
    )


def commit_now(**params) -> dict:
    response = request_commit(**params)
    assert response.status_code == 200, response.content
    return response.json()


def steps_by_name(body) -> dict:
    return {step["name"]: step for step in body["steps"]}


def head_sha(path) -> str:
    return git(["rev-parse", "HEAD"], path).stdout.strip()


def head_files(path) -> set[str]:
    listed = git(["show", "--name-only", "--format=", "HEAD"], path).stdout
    return {line for line in listed.splitlines() if line}


def head_subject(path) -> str:
    return git(["log", "-1", "--format=%s"], path).stdout.strip()


def dirty_paths(path) -> set[str]:
    listed = git(["status", "--porcelain"], path).stdout
    return {line[3:] for line in listed.splitlines() if line}


def test_a_commit_takes_every_change_including_untracked_and_deleted_files(
    checkout, bin_dir
):
    (checkout / "kept.txt").write_text("one\ntwo\nthree\nfour\n")
    (checkout / "doomed.txt").unlink()
    (checkout / "arrived.txt").write_text("new file\n")

    body = commit_now()

    assert body["status"] == "committed"
    assert body["commit_sha"]
    assert body["file_count"] == 3
    # git holds the real verdict: the tree is clean and HEAD carries all three.
    assert dirty_paths(checkout) == set()
    assert head_files(checkout) == {"kept.txt", "doomed.txt", "arrived.txt"}
    assert head_sha(checkout) == body["commit_sha"]


def test_every_step_reports_its_own_typed_progress(checkout, bin_dir):
    (checkout / "kept.txt").write_text("changed\n")

    body = commit_now()

    # The steps arrive in the order they ran, so a client can render progress
    # without knowing the sequence itself.
    assert [step["name"] for step in body["steps"]] == [
        "stage",
        "generate_message",
        "commit",
    ]
    steps = steps_by_name(body)
    assert steps["stage"]["status"] == "ok"
    assert steps["generate_message"]["status"] == "ok"
    assert steps["commit"]["status"] == "ok"
    assert steps["stage"]["detail"]
    assert steps["commit"]["detail"]


def test_a_clean_worktree_returns_an_explicit_skip_rather_than_a_commit(
    checkout, bin_dir
):
    before = head_sha(checkout)

    body = commit_now()

    assert body["status"] == "nothing_to_commit"
    assert body["commit_sha"] is None
    assert body["subject"] is None
    assert body["message_source"] is None
    assert [step["status"] for step in body["steps"]] == [
        "skipped",
        "skipped",
        "skipped",
    ]
    assert head_sha(checkout) == before


def test_the_index_is_reset_so_a_stale_staged_path_is_not_committed(
    checkout, bin_dir
):
    """A file staged and then removed must not ride along in the commit.

    This is what "reset the index" buys: whatever a terminal left staged is
    dropped, and only the working tree as it stands is committed.
    """

    (checkout / "abandoned.txt").write_text("staged then removed\n")
    git(["add", "abandoned.txt"], checkout)
    (checkout / "abandoned.txt").unlink()
    (checkout / "kept.txt").write_text("still here\n")

    body = commit_now()

    assert body["status"] == "committed"
    assert head_files(checkout) == {"kept.txt"}
    assert dirty_paths(checkout) == set()


def test_a_failing_hook_aborts_the_commit_and_returns_its_output(
    repo, checkout, bin_dir
):
    install_hook(repo, "pre-commit", 'echo "lint refused: trailing whitespace"\nexit 1')
    (checkout / "kept.txt").write_text("offending change\n")
    before = head_sha(checkout)

    response = request_commit()

    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "commit_refused"
    assert "lint refused: trailing whitespace" in body["hook_output"]
    # Aborted means aborted: no commit, and the change is still in the tree.
    assert head_sha(checkout) == before
    assert "kept.txt" in dirty_paths(checkout)


def test_hooks_always_run_on_the_successful_path_too(
    repo, checkout, bin_dir, tmp_path
):
    witness = tmp_path / "pre-commit-ran"
    install_hook(repo, "pre-commit", f'echo ran > "{witness}"')
    (checkout / "kept.txt").write_text("hooked change\n")

    assert commit_now()["status"] == "committed"

    assert witness.read_text().strip() == "ran"


def test_a_task_without_a_worktree_cannot_be_committed(bin_dir):
    response = request_commit()

    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "no_checkout"
    assert "nothing to commit" in body["detail"].lower()


def test_with_no_generator_installed_the_subject_comes_from_the_template(
    checkout, bin_dir
):
    (checkout / "kept.txt").write_text("templated\n")

    body = commit_now()

    assert body["message_source"] == "template"
    assert body["subject"] == "Update kept.txt"
    assert head_subject(checkout) == "Update kept.txt"


def test_the_template_subject_is_deterministic_for_a_multi_file_change(
    checkout, bin_dir
):
    nested = checkout / "src" / "app"
    nested.mkdir(parents=True)
    (nested / "one.txt").write_text("1\n")
    (nested / "two.txt").write_text("2\n")

    body = commit_now()

    assert body["message_source"] == "template"
    assert body["subject"] == "Update 2 files in src/app"


def test_a_generated_subject_is_used_verbatim_when_it_is_already_clean(
    checkout, bin_dir
):
    install_generator(bin_dir, "claude", prints="Extend kept.txt with a fourth line")
    (checkout / "kept.txt").write_text("one\ntwo\nthree\nfour\n")

    body = commit_now()

    assert body["message_source"] == "claude"
    assert body["subject"] == "Extend kept.txt with a fourth line"
    assert head_subject(checkout) == "Extend kept.txt with a fourth line"
