"""HTTP-surface tests for committing and pushing a task worktree (#983).

Every case drives the real endpoint against a real worktree and a real remote:
a bare repository on disk that git dials, transfers objects to, and refuses
non-fast-forward updates from. Afterwards the *remote* is asked what happened,
not the response — a push that claims success and moved nothing, or a refusal
that quietly rewrote the remote anyway, both have to fail here.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.source_control.tests.commit_fixtures import isolate_generators
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git
from apps.source_control.tests.push_fixtures import (
    attach_remote,
    bare_remote,
    publish_from_elsewhere,
    remote_sha,
)


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


class HostClient(Client):
    def post(self, path, *args, **kwargs):
        return super().post(f"/api{path}", *args, **kwargs)

    def get(self, path, *args, **kwargs):
        return super().get(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture(autouse=True)
def bin_dir(monkeypatch, tmp_path):
    """No generator CLI is reachable, so every subject is the template's."""

    return isolate_generators(monkeypatch, tmp_path)


@pytest.fixture
def remote(tmp_path, repo):
    """A bare repository this checkout's repo pushes to. Worktrees share it."""

    path = bare_remote(tmp_path)
    attach_remote(repo, path)
    return path


def request_action(**params):
    return client.post(
        "/worktrees/changes/commit-push",
        data={"task_id": TASK_ID, "module_id": MODULE_ID, **params},
        content_type="application/json",
    )


def run_action(**params) -> dict:
    response = request_action(**params)
    assert response.status_code == 200, response.content
    return response.json()


def request_preview(**params):
    return client.get(
        "/worktrees/changes/push-preview",
        data={"task_id": TASK_ID, "module_id": MODULE_ID, **params},
    )


def read_preview() -> dict:
    response = request_preview()
    assert response.status_code == 200, response.content
    return response.json()


def steps_by_name(body) -> dict:
    return {step["name"]: step for step in body["steps"]}


def branch_of(checkout) -> str:
    return git(["symbolic-ref", "--short", "HEAD"], checkout).stdout.strip()


def head_sha(checkout) -> str:
    return git(["rev-parse", "HEAD"], checkout).stdout.strip()


def test_commit_and_push_runs_as_one_ordered_action(checkout, remote):
    (checkout / "kept.txt").write_text("pushed change\n")
    branch = branch_of(checkout)

    body = run_action()

    assert body["status"] == "committed_and_pushed"
    # The steps arrive in the order they ran, push last, so a client renders
    # progress without knowing the sequence itself.
    assert [step["name"] for step in body["steps"]] == [
        "stage",
        "generate_message",
        "commit",
        "push",
    ]
    assert [step["status"] for step in body["steps"]] == ["ok", "ok", "ok", "ok"]
    assert body["branch"] == branch
    assert body["remote"] == "origin"
    assert body["pushed_sha"] == body["commit_sha"]
    assert body["failure_code"] is None
    # The remote is the witness: it now holds exactly the commit just made.
    assert remote_sha(remote, branch) == body["commit_sha"]
    assert steps_by_name(body)["push"]["detail"]


def test_the_push_publishes_only_the_current_branch(checkout, remote):
    """An explicit single-branch refspec, proved by what the remote does *not* get.

    A bare ``git push`` under some configurations publishes every matching
    branch. This action names one refspec, so a second local branch that is
    also ahead stays local.
    """

    git(["branch", "unrelated-branch"], checkout)
    (checkout / "kept.txt").write_text("only this branch\n")
    branch = branch_of(checkout)

    run_action()

    assert remote_sha(remote, branch)
    assert remote_sha(remote, "unrelated-branch") == ""
    assert remote_sha(remote, "main") == ""


def test_an_up_to_date_remote_returns_an_explicit_skipped_push(checkout, remote):
    (checkout / "kept.txt").write_text("first change\n")
    first = run_action()
    branch = branch_of(checkout)

    # Nothing has changed since, locally or remotely.
    body = run_action()

    assert body["status"] == "up_to_date"
    steps = steps_by_name(body)
    assert steps["stage"]["status"] == "skipped"
    assert steps["commit"]["status"] == "skipped"
    assert steps["push"]["status"] == "skipped"
    assert "already has this commit" in steps["push"]["detail"]
    assert body["pushed_sha"] is None
    assert body["failure_code"] is None
    # The skip is a skip: the remote still points where the first push left it.
    assert remote_sha(remote, branch) == first["commit_sha"]


def test_a_diverged_branch_fails_and_leaves_the_remote_untouched(
    checkout, remote, tmp_path
):
    """The whole no-force guarantee, stated as behaviour.

    The remote is advanced by another repository, then this action is asked to
    push over it. A forcing push would succeed and destroy that commit; this
    one fails, keeps the local commit, and leaves the remote exactly as the
    other repository left it.
    """

    (checkout / "kept.txt").write_text("published change\n")
    run_action()
    branch = branch_of(checkout)
    theirs = publish_from_elsewhere(tmp_path, remote, branch)

    (checkout / "kept.txt").write_text("change made while behind\n")
    body = run_action()

    assert body["status"] == "push_failed"
    assert body["failure_code"] == "diverged"
    steps = steps_by_name(body)
    # The commit still happened and is still reported — losing it because the
    # remote moved would throw away work the user asked to keep.
    assert steps["commit"]["status"] == "ok"
    assert body["commit_sha"]
    assert head_sha(checkout) == body["commit_sha"]
    assert steps["push"]["status"] == "failed"
    assert "terminal" in steps["push"]["detail"]
    assert body["pushed_sha"] is None
    # Nothing was overwritten: the other repository's commit is still the tip.
    assert remote_sha(remote, branch) == theirs


def test_a_detached_head_blocks_the_action_before_it_commits(checkout, remote):
    git(["checkout", "--detach", "--quiet", "HEAD"], checkout)
    (checkout / "kept.txt").write_text("change on a detached HEAD\n")
    before = head_sha(checkout)

    response = request_action()

    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "push_detached_head"
    assert "detached HEAD" in body["detail"]
    # A precondition is checked before anything is written: no commit was made
    # for a push that was never going to be possible.
    assert head_sha(checkout) == before
    assert git(["status", "--porcelain"], checkout).stdout.strip()


def test_a_checkout_with_no_remote_blocks_the_action(checkout):
    (checkout / "kept.txt").write_text("nowhere to push\n")
    before = head_sha(checkout)

    response = request_action()

    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "push_no_remote"
    assert head_sha(checkout) == before


def test_a_task_without_a_worktree_cannot_be_pushed():
    response = request_action()

    assert response.status_code == 409, response.content
    assert response.json()["code"] == "no_checkout"


def test_the_confirmation_reports_the_branch_remote_and_commit_count(
    checkout, remote
):
    (checkout / "kept.txt").write_text("about to be committed\n")
    branch = branch_of(checkout)

    body = read_preview()

    assert body["state"] == "ready"
    assert body["branch"] == branch
    assert body["remote"] == "origin"
    assert body["dirty"] is True
    # The branch is unpublished and holds no commits of its own yet, so the
    # only commit this push would send is the one the action is about to make.
    assert body["commit_count"] == 1
    # Nothing generated is shown before the confirmation, because nothing has
    # been generated yet: the subject is written inside the action.
    assert "subject" not in body
    assert "message_source" not in body


def test_the_confirmation_counts_commits_already_made_locally(checkout, remote):
    (checkout / "kept.txt").write_text("committed in a terminal\n")
    git(["commit", "--quiet", "--all", "-m", "made outside Studio"], checkout)
    (checkout / "arrived.txt").write_text("and one more change\n")

    body = read_preview()

    assert body["state"] == "ready"
    # One unpushed commit, plus the one the action would create.
    assert body["commit_count"] == 2
    assert body["dirty"] is True


def test_the_confirmation_reports_an_up_to_date_remote(checkout, remote):
    (checkout / "kept.txt").write_text("pushed already\n")
    run_action()

    body = read_preview()

    assert body["state"] == "up_to_date"
    assert body["dirty"] is False
    assert body["commit_count"] == 0
    assert "nothing to commit" in body["detail"]


def test_the_confirmation_reports_divergence_before_anything_is_sent(
    checkout, remote, tmp_path
):
    (checkout / "kept.txt").write_text("published change\n")
    run_action()
    publish_from_elsewhere(tmp_path, remote, branch_of(checkout))

    body = read_preview()

    assert body["state"] == "diverged"
    assert "terminal" in body["detail"]


def test_the_confirmation_reports_a_detached_head(checkout, remote):
    git(["checkout", "--detach", "--quiet", "HEAD"], checkout)

    body = read_preview()

    assert body["state"] == "detached_head"
    assert body["remote"] is None
    assert "detached HEAD" in body["detail"]
