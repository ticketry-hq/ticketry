"""HTTP-surface tests for opening a pull request from a task worktree (#984).

Every case drives the real endpoint against a real worktree and a real remote —
a bare repository on disk that git dials and transfers objects to. Only GitHub
itself is substituted, at the one place this app spawns a process to reach it,
and the substitute is a real executable found by the production lookup on an
isolated ``PATH``.

The assertions are about what happened rather than what was returned: the
remote is asked whether the branch arrived, the fake ``gh`` is asked what it was
told to do, and a rejected action is asked to prove that nothing was written.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.source_control.clients.gh_cli import APPROVED_PATH_ENV
from apps.source_control.messages.message_generators import GENERATORS
from apps.source_control.tests.commit_fixtures import (
    install_generator,
    isolate_generators,
)
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git
from apps.source_control.tests.pull_request_fixtures import (
    install_gh,
    recorded_argv,
    recorded_body,
    recorded_environment,
)
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

PR_URL = "https://github.com/ticketry-hq/ticketry/pull/42"


class HostClient(Client):
    def post(self, path, *args, **kwargs):
        return super().post(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture(autouse=True)
def bin_dir(monkeypatch, tmp_path):
    """An isolated PATH: no generator CLI, and no ``gh`` until one is installed."""

    monkeypatch.delenv(APPROVED_PATH_ENV, raising=False)
    # Cleared so the "Ticketry adds no credential" assertion below is about this
    # app rather than about whatever the developer has exported.
    for name in ("GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    return isolate_generators(monkeypatch, tmp_path)


@pytest.fixture
def gh_logs(tmp_path):
    return tmp_path / "gh-logs"


@pytest.fixture
def gh(bin_dir, gh_logs):
    """A logged-in ``gh`` that opens a pull request and prints its URL."""

    return install_gh(bin_dir, gh_logs, create_prints=PR_URL)


@pytest.fixture
def remote(tmp_path, repo):
    """A bare repository this checkout's repo pushes to, with ``main`` default."""

    path = bare_remote(tmp_path)
    attach_remote(repo, path)
    git(["push", "--quiet", "origin", "refs/heads/main:refs/heads/main"], repo)
    git(["remote", "set-head", "origin", "main"], repo)
    return path


def request_stack(**params):
    return client.post(
        "/worktrees/changes/commit-push-pr",
        data={"task_id": TASK_ID, "module_id": MODULE_ID, **params},
        content_type="application/json",
    )


def run_stack(**params) -> dict:
    response = request_stack(**params)
    assert response.status_code == 200, response.content
    return response.json()


def request_pull_request_only(**params):
    return client.post(
        "/worktrees/changes/pull-request",
        data={"task_id": TASK_ID, "module_id": MODULE_ID, **params},
        content_type="application/json",
    )


def steps_by_name(body) -> dict:
    return {step["name"]: step for step in body["steps"]}


def branch_of(checkout) -> str:
    return git(["symbolic-ref", "--short", "HEAD"], checkout).stdout.strip()


def head_sha(checkout) -> str:
    return git(["rev-parse", "HEAD"], checkout).stdout.strip()


def create_arguments(gh_logs) -> str:
    """The ``gh pr create`` invocation, as the fake recorded it."""

    creates = [line for line in recorded_argv(gh_logs) if line.startswith("pr create")]
    assert creates, recorded_argv(gh_logs)
    return creates[-1]


def test_the_stack_commits_pushes_and_opens_a_pull_request(checkout, remote, gh_logs, gh):
    (checkout / "kept.txt").write_text("work to review\n")
    branch = branch_of(checkout)

    body = run_stack()

    assert body["status"] == "opened"
    # The steps arrive in the order they ran, the pull request last, so a client
    # renders progress without knowing the sequence itself.
    assert [step["name"] for step in body["steps"]] == [
        "stage",
        "generate_message",
        "commit",
        "push",
        "pull_request",
    ]
    assert [step["status"] for step in body["steps"]] == ["ok"] * 5
    assert body["pull_request_url"] == PR_URL
    assert body["branch"] == branch
    assert body["base_branch"] == "main"
    assert body["pushed_sha"] == body["commit_sha"]
    # The remote is the witness that the branch the pull request describes
    # actually exists on it.
    assert remote_sha(remote, branch) == body["commit_sha"]


def test_the_pull_request_is_created_from_the_users_login_and_a_body_file(
    checkout, remote, gh_logs, gh
):
    """The provider contract, stated as behaviour.

    Three things have to be true at once: the body travels in a file, the head
    and base branches are named explicitly rather than left to ``gh``'s guess,
    and Ticketry contributes no credential of its own.
    """

    (checkout / "kept.txt").write_text("work to review\n")
    branch = branch_of(checkout)

    body = run_stack()

    arguments = create_arguments(gh_logs)
    assert "--body-file" in arguments
    assert f"--head {branch}" in arguments
    assert "--base main" in arguments
    assert f"--title {body['pull_request_title']}" in arguments
    # The login is checked through ``gh``'s own command, never by this app
    # reading a credential.
    assert any(line.startswith("auth status") for line in recorded_argv(gh_logs))
    # No token was supplied, invented, or forwarded: the user's ``gh`` holds the
    # login and Ticketry holds nothing.
    environment = recorded_environment(gh_logs)
    assert "GH_TOKEN" not in environment
    assert "GITHUB_TOKEN" not in environment
    # The body file carried the generated description, not an empty placeholder.
    assert branch in recorded_body(gh_logs)


def test_the_pull_request_text_comes_from_the_configured_generator(
    checkout, remote, gh_logs, gh, bin_dir
):
    install_generator(
        bin_dir, "claude", prints="Ship the review surface\n\nWhat changed and why."
    )
    (checkout / "kept.txt").write_text("work to review\n")

    body = run_stack()

    assert body["pull_request_text_source"] == "claude"
    assert body["pull_request_title"] == "Ship the review surface"
    assert recorded_body(gh_logs).strip() == "What changed and why."


def test_a_missing_generator_falls_back_to_a_deterministic_template(
    checkout, remote, gh_logs, gh
):
    (checkout / "kept.txt").write_text("work to review\n")

    body = run_stack()

    assert body["pull_request_text_source"] == "template"
    # Deterministic: the same branch and change set produce the same text, so a
    # templated pull request is never mistaken for a generated one.
    assert body["pull_request_title"]
    assert "## Commits" in recorded_body(gh_logs)


def test_the_default_branch_cannot_open_a_pull_request(checkout, remote, gh):
    """A pull request needs two branches, and this surface will not invent one."""

    branch = branch_of(checkout)
    # The repository's recorded default branch becomes the branch this checkout
    # is on, which is exactly the state a pull request cannot be opened from.
    git(["push", "--quiet", "origin", f"refs/heads/{branch}:refs/heads/{branch}"], checkout)
    git(["remote", "set-head", "origin", branch], checkout)
    (checkout / "kept.txt").write_text("work on the default branch\n")
    before = head_sha(checkout)

    response = request_stack()

    assert response.status_code == 409, response.content
    payload = response.json()
    assert payload["code"] == "pull_request_default_branch"
    assert branch in payload["detail"]
    # A precondition is checked before anything is written.
    assert head_sha(checkout) == before
    assert git(["status", "--porcelain"], checkout).stdout.strip()


def test_a_pull_request_only_attempt_with_uncommitted_changes_is_rejected(
    checkout, remote, gh, gh_logs
):
    """Opening a pull request now would review a branch missing this work."""

    (checkout / "kept.txt").write_text("still uncommitted\n")
    before = head_sha(checkout)

    response = request_pull_request_only()

    assert response.status_code == 409, response.content
    payload = response.json()
    assert payload["code"] == "pull_request_dirty_tree"
    assert "Commit them first" in payload["detail"]
    assert head_sha(checkout) == before
    # Nothing reached GitHub, and nothing was committed on the way to finding out.
    assert not any(
        line.startswith("pr create") for line in recorded_argv(gh_logs)
    )
    assert git(["status", "--porcelain"], checkout).stdout.strip()


def test_the_pull_request_only_action_reports_the_earlier_steps_as_skips(
    checkout, remote, gh_logs, gh
):
    (checkout / "kept.txt").write_text("work to review\n")
    stacked = run_stack()

    response = request_pull_request_only()

    assert response.status_code == 200, response.content
    body = response.json()
    steps = steps_by_name(body)
    assert [step["name"] for step in body["steps"]] == [
        "stage",
        "generate_message",
        "commit",
        "push",
        "pull_request",
    ]
    assert steps["stage"]["status"] == "skipped"
    assert steps["commit"]["status"] == "skipped"
    assert steps["push"]["status"] == "skipped"
    assert body["commit_sha"] is None
    # The branch already had a pull request from the stacked run, so the second
    # attempt reports that one rather than opening a duplicate.
    assert body["status"] == "already_open"
    assert body["pull_request_url"] == PR_URL
    assert stacked["pull_request_url"] == PR_URL


def test_an_existing_pull_request_is_reported_as_a_skip_with_its_url(
    checkout, remote, bin_dir, gh_logs
):
    install_gh(
        bin_dir,
        gh_logs,
        create_exit=1,
        create_prints=(
            "a pull request for branch \"feature\" into branch \"main\" "
            f"already exists: {PR_URL}"
        ),
    )
    (checkout / "kept.txt").write_text("work to review\n")

    body = run_stack()

    assert body["status"] == "already_open"
    steps = steps_by_name(body)
    assert steps["pull_request"]["status"] == "skipped"
    assert "already has an open pull request" in steps["pull_request"]["detail"]
    assert body["pull_request_url"] == PR_URL
    # The commit and the push still happened and are still reported.
    assert steps["commit"]["status"] == "ok"
    assert steps["push"]["status"] == "ok"


def test_a_missing_gh_blocks_the_action_before_it_commits(checkout, remote):
    (checkout / "kept.txt").write_text("nowhere to open a pull request\n")
    before = head_sha(checkout)

    response = request_stack()

    assert response.status_code == 503, response.content
    payload = response.json()
    assert payload["code"] == "provider_unavailable"
    assert "gh auth login" in payload["detail"]
    assert head_sha(checkout) == before
    assert git(["status", "--porcelain"], checkout).stdout.strip()


def test_a_logged_out_gh_blocks_the_action_before_it_commits(
    checkout, remote, bin_dir, gh_logs
):
    install_gh(bin_dir, gh_logs, authenticated=False)
    (checkout / "kept.txt").write_text("no login to open it with\n")
    before = head_sha(checkout)

    response = request_stack()

    assert response.status_code == 409, response.content
    payload = response.json()
    assert payload["code"] == "provider_not_authenticated"
    assert "gh auth login" in payload["detail"]
    # Nothing was committed for a pull request that was never going to be
    # possible, and nothing was pushed.
    assert head_sha(checkout) == before
    assert remote_sha(remote, branch_of(checkout)) == ""
    assert not any(
        line.startswith("pr create") for line in recorded_argv(gh_logs)
    )


def test_a_refused_pull_request_keeps_the_commit_and_shows_no_provider_output(
    checkout, remote, bin_dir, gh_logs
):
    """A provider failure after the write is a step, not a lost commit."""

    install_gh(
        bin_dir,
        gh_logs,
        create_exit=1,
        create_prints="HTTP 422: Validation Failed on api.github.com/repos/o/r",
    )
    (checkout / "kept.txt").write_text("work to review\n")
    branch = branch_of(checkout)

    body = run_stack()

    assert body["status"] == "pull_request_failed"
    steps = steps_by_name(body)
    assert steps["commit"]["status"] == "ok"
    assert steps["push"]["status"] == "ok"
    assert steps["pull_request"]["status"] == "failed"
    assert body["pull_request_url"] is None
    # The commit and the push both stand, and the commit is reported: losing it
    # because GitHub said no would throw away the user's work.
    assert body["commit_sha"]
    assert head_sha(checkout) == body["commit_sha"]
    assert remote_sha(remote, branch) == body["commit_sha"]
    # The provider's own words never crossed the wire.
    serialized = str(body)
    assert "422" not in serialized
    assert "api.github.com" not in serialized
    assert "terminal" in steps["pull_request"]["detail"]


def test_a_failed_push_skips_the_pull_request_and_says_why(
    checkout, remote, tmp_path, gh_logs, gh
):
    (checkout / "kept.txt").write_text("published change\n")
    run_stack()
    branch = branch_of(checkout)
    theirs = publish_from_elsewhere(tmp_path, remote, branch)

    (checkout / "kept.txt").write_text("change made while behind\n")
    body = run_stack()

    assert body["status"] == "push_failed"
    assert body["failure_code"] == "diverged"
    steps = steps_by_name(body)
    assert steps["commit"]["status"] == "ok"
    assert steps["push"]["status"] == "failed"
    # The skip is explicit and says why, rather than the step being absent.
    assert steps["pull_request"]["status"] == "skipped"
    assert "no branch on GitHub" in steps["pull_request"]["detail"]
    assert body["pull_request_url"] is None
    # Nothing was overwritten on the remote, and no pull request was attempted.
    assert remote_sha(remote, branch) == theirs


def test_a_clean_worktree_still_opens_the_pull_request(checkout, remote, gh_logs, gh):
    (checkout / "kept.txt").write_text("committed in a terminal\n")
    git(["commit", "--quiet", "--all", "-m", "made outside Studio"], checkout)

    body = run_stack()

    assert body["status"] == "opened"
    steps = steps_by_name(body)
    # Nothing to commit is an explicit skip, and the steps after it still ran.
    assert steps["stage"]["status"] == "skipped"
    assert steps["commit"]["status"] == "skipped"
    assert steps["push"]["status"] == "ok"
    assert steps["pull_request"]["status"] == "ok"
    assert body["pull_request_url"] == PR_URL


def test_a_detached_head_blocks_the_action_before_it_commits(checkout, remote, gh):
    git(["checkout", "--detach", "--quiet", "HEAD"], checkout)
    (checkout / "kept.txt").write_text("change on a detached HEAD\n")
    before = head_sha(checkout)

    response = request_stack()

    assert response.status_code == 409, response.content
    assert response.json()["code"] == "push_detached_head"
    assert head_sha(checkout) == before


def test_a_task_without_a_worktree_cannot_open_a_pull_request(bin_dir, gh_logs):
    install_gh(bin_dir, gh_logs, create_prints=PR_URL)

    response = request_stack()

    assert response.status_code == 409, response.content
    assert response.json()["code"] == "no_checkout"


def test_the_generator_preference_is_honoured_over_the_fallback_order(
    checkout, remote, gh_logs, gh, bin_dir
):
    from apps.settings_store.models import AppSetting
    from apps.source_control.messages.commit_message import (
        PREFERENCE_KEY,
        PREFERENCE_SCOPE,
    )

    for name in GENERATORS:
        install_generator(bin_dir, name, prints=f"Title from {name}\n\nBody.")
    AppSetting.objects.create(
        scope=PREFERENCE_SCOPE, key=PREFERENCE_KEY, value="gemini"
    )
    (checkout / "kept.txt").write_text("work to review\n")

    body = run_stack()

    # claude leads the fixed fallback order; the configured preference wins.
    assert body["pull_request_text_source"] == "gemini"
    assert body["pull_request_title"] == "Title from gemini"
