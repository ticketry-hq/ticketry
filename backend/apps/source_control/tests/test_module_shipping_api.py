"""HTTP-surface tests for shipping the module base checkout (#985).

The same real-git discipline the worktree cases use, pointed at the other
checkout kind: the repository is real, the module work item and its host folder
link are real, the remote is a real bare repository git dials and transfers
objects to, and the only substituted things are the generator CLIs and ``gh`` —
ordinary executables on an isolated ``PATH``, found by the production lookup.

Two properties are what these cases exist for. The *shape* of the module flow
must match the worktree's — the same ordered steps, skips, preconditions, hook
output, and curated failures — and its *reach* must not: a module action writes
the module's folder and a worktree action writes the worktree, even though the
two share one ``.git``.
"""

from __future__ import annotations

import shutil

import pytest
from django.test import Client

from apps.source_control.gh_cli import APPROVED_PATH_ENV
from apps.source_control.tests.commit_fixtures import (
    install_generator,
    install_hook,
    isolate_generators,
)
from apps.source_control.tests.conftest import MODULE_ID, TASK_ID, git
from apps.source_control.tests.pull_request_fixtures import (
    install_gh,
    recorded_argv,
    recorded_body,
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

PR_URL = "https://github.com/ticketry-hq/ticketry/pull/985"


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
    """An isolated PATH: no generator CLI, and no ``gh`` until one is installed."""

    monkeypatch.delenv(APPROVED_PATH_ENV, raising=False)
    for name in ("GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    return isolate_generators(monkeypatch, tmp_path)


@pytest.fixture
def remote(tmp_path, repo):
    """A bare repository the module's checkout pushes to, ``main`` default."""

    path = bare_remote(tmp_path)
    attach_remote(repo, path)
    git(["push", "--quiet", "origin", "refs/heads/main:refs/heads/main"], repo)
    git(["remote", "set-head", "origin", "main"], repo)
    return path


@pytest.fixture
def gh_logs(tmp_path):
    return tmp_path / "gh-logs"


@pytest.fixture
def gh(bin_dir, gh_logs):
    """A logged-in ``gh`` that opens a pull request and prints its URL."""

    return install_gh(bin_dir, gh_logs, create_prints=PR_URL)


def module_commit(module, **params):
    return client.post(
        "/modules/changes/commit",
        data={"module_id": str(module.id), **params},
        content_type="application/json",
    )


def module_commit_push(module, **params):
    return client.post(
        "/modules/changes/commit-push",
        data={"module_id": str(module.id), **params},
        content_type="application/json",
    )


def module_push_preview(module):
    return client.get(
        "/modules/changes/push-preview", data={"module_id": str(module.id)}
    )


def module_stack(module):
    return client.post(
        "/modules/changes/commit-push-pr",
        data={"module_id": str(module.id)},
        content_type="application/json",
    )


def module_pull_request(module):
    return client.post(
        "/modules/changes/pull-request",
        data={"module_id": str(module.id)},
        content_type="application/json",
    )


def ok(response) -> dict:
    assert response.status_code == 200, response.content
    return response.json()


def steps_by_name(body) -> dict:
    return {step["name"]: step for step in body["steps"]}


def step_names(body) -> list[str]:
    return [step["name"] for step in body["steps"]]


def branch_of(path) -> str:
    return git(["symbolic-ref", "--short", "HEAD"], path).stdout.strip()


def head_sha(path) -> str:
    return git(["rev-parse", "HEAD"], path).stdout.strip()


def head_files(path) -> set[str]:
    listed = git(["show", "--name-only", "--format=", "HEAD"], path).stdout
    return {line for line in listed.splitlines() if line}


def on_feature_branch(repo, name: str = "sync/module-work") -> str:
    """Move the module's base checkout onto a branch a pull request can use."""

    git(["checkout", "-q", "-b", name], repo)
    return name


# --- AC 1: the same commit, push, and pull-request actions -------------------


def test_the_module_commit_takes_every_change_including_deletions(
    repo, linked_module, bin_dir
):
    """AC 1: one action, the whole change set, no path list on the wire."""

    (repo / "kept.txt").write_text("one\ntwo\nthree\nfour\n")
    (repo / "doomed.txt").unlink()
    (repo / "added.txt").write_text("new file\n")

    body = ok(module_commit(linked_module))

    assert body["status"] == "committed"
    assert step_names(body) == ["stage", "generate_message", "commit"]
    assert [step["status"] for step in body["steps"]] == ["ok"] * 3
    assert body["file_count"] == 3
    # git is the witness: the commit carries every change, deletion included.
    assert head_files(repo) == {"kept.txt", "doomed.txt", "added.txt"}
    assert not git(["status", "--porcelain"], repo).stdout.strip()
    assert body["commit_sha"] == head_sha(repo)
    assert body["branch"] == "main"


def test_a_clean_module_checkout_reports_three_explicit_skips(repo, linked_module):
    """AC 2: nothing to commit is a typed skip, not a silent no-op."""

    body = ok(module_commit(linked_module))

    assert body["status"] == "nothing_to_commit"
    assert [step["status"] for step in body["steps"]] == ["skipped"] * 3
    assert steps_by_name(body)["stage"]["detail"] == (
        "This checkout matches its last commit."
    )
    assert body["commit_sha"] is None


def test_a_hook_refusing_the_module_commit_aborts_with_its_output(
    repo, linked_module
):
    """AC 2: hooks are repository policy on this checkout too."""

    install_hook(repo, "pre-commit", "echo 'lint failed: two blank lines' >&2\nexit 1")
    (repo / "kept.txt").write_text("work the hook rejects\n")
    before = head_sha(repo)

    response = module_commit(linked_module)

    assert response.status_code == 409, response.content
    payload = response.json()
    assert payload["code"] == "commit_refused"
    assert "lint failed: two blank lines" in payload["hook_output"]
    # Nothing was written, and the work is still in the checkout.
    assert head_sha(repo) == before
    assert git(["status", "--porcelain"], repo).stdout.strip()


def test_the_module_commit_and_push_runs_as_one_ordered_action(
    repo, linked_module, remote
):
    """AC 1: the module checkout's terminal action publishes its branch."""

    (repo / "kept.txt").write_text("work to sync\n")

    body = ok(module_commit_push(linked_module))

    assert body["status"] == "committed_and_pushed"
    assert step_names(body) == ["stage", "generate_message", "commit", "push"]
    assert [step["status"] for step in body["steps"]] == ["ok"] * 4
    assert body["remote"] == "origin"
    assert body["branch"] == "main"
    # The remote is the witness that the branch actually arrived.
    assert remote_sha(remote, "main") == body["commit_sha"]
    assert body["pushed_sha"] == body["commit_sha"]


def test_the_module_confirmation_counts_the_commit_the_action_will_make(
    repo, linked_module, remote
):
    """AC 2: the confirmation is a real read, and shows no generated text."""

    (repo / "kept.txt").write_text("work to confirm\n")

    preview = ok(module_push_preview(linked_module))

    assert preview["state"] == "ready"
    assert preview["branch"] == "main"
    assert preview["remote"] == "origin"
    assert preview["dirty"] is True
    # The pending commit counts: the user is agreeing to send it too.
    assert preview["commit_count"] == 1
    assert "subject" not in preview and "message" not in preview


def test_a_diverged_module_checkout_keeps_its_commit_and_fails_the_push(
    tmp_path, repo, linked_module, remote
):
    """AC 2: divergence is discovered after the commit is worth keeping."""

    publish_from_elsewhere(tmp_path, remote, "main")
    remote_before = remote_sha(remote, "main")
    (repo / "kept.txt").write_text("local work\n")

    body = ok(module_commit_push(linked_module))

    assert body["status"] == "push_failed"
    assert body["failure_code"] == "diverged"
    steps = steps_by_name(body)
    assert steps["commit"]["status"] == "ok"
    assert steps["push"]["status"] == "failed"
    assert "resolve it in a terminal" in steps["push"]["detail"]
    # The commit stands, and the remote was not rewritten.
    assert body["commit_sha"] == head_sha(repo)
    assert remote_sha(remote, "main") == remote_before


def test_a_detached_module_checkout_is_refused_before_anything_is_written(
    repo, linked_module, remote
):
    """AC 2: a precondition runs before the write, on this kind too."""

    git(["checkout", "-q", "--detach", "HEAD"], repo)
    (repo / "kept.txt").write_text("work on a detached HEAD\n")
    before = head_sha(repo)

    preview = ok(module_push_preview(linked_module))
    assert preview["state"] == "detached_head"
    assert "Check out a branch in a terminal first." in preview["detail"]

    response = module_commit_push(linked_module)

    assert response.status_code == 409, response.content
    assert response.json()["code"] == "push_detached_head"
    assert head_sha(repo) == before
    assert git(["status", "--porcelain"], repo).stdout.strip()


def test_an_up_to_date_module_checkout_reports_the_push_as_a_skip(
    repo, linked_module, remote
):
    """AC 2: nothing to do is reported step by step, not as a failure."""

    body = ok(module_commit_push(linked_module))

    assert body["status"] == "up_to_date"
    assert [step["status"] for step in body["steps"]] == ["skipped"] * 4
    assert "already has this commit" in steps_by_name(body)["push"]["detail"]


def test_the_module_stack_opens_a_pull_request_from_a_feature_branch(
    repo, linked_module, remote, gh_logs, gh
):
    """AC 1: the pull-request action is the same action, reached by module."""

    branch = on_feature_branch(repo)
    (repo / "kept.txt").write_text("work to review\n")

    body = ok(module_stack(linked_module))

    assert body["status"] == "opened"
    assert step_names(body) == [
        "stage",
        "generate_message",
        "commit",
        "push",
        "pull_request",
    ]
    assert [step["status"] for step in body["steps"]] == ["ok"] * 5
    assert body["pull_request_url"] == PR_URL
    assert body["branch"] == branch
    # A base checkout records no base branch, so the target is resolved from
    # the repository's own default rather than from anything Studio sent.
    assert body["base_branch"] == "main"
    assert remote_sha(remote, branch) == body["commit_sha"]
    arguments = [line for line in recorded_argv(gh_logs) if line.startswith("pr create")]
    assert f"--head {branch}" in arguments[-1]
    assert "--base main" in arguments[-1]
    assert "--body-file" in arguments[-1]
    assert branch in recorded_body(gh_logs)


def test_the_module_pull_request_uses_the_configured_generator(
    repo, linked_module, remote, gh_logs, gh, bin_dir
):
    """AC 2: message generation behaves the same for both checkout kinds."""

    install_generator(
        bin_dir, "claude", prints="Sync the module checkout\n\nWhat changed and why."
    )
    on_feature_branch(repo)
    (repo / "kept.txt").write_text("work to review\n")

    body = ok(module_stack(linked_module))

    assert body["pull_request_text_source"] == "claude"
    assert body["pull_request_title"] == "Sync the module checkout"
    assert body["message_source"] == "claude"
    assert recorded_body(gh_logs).strip() == "What changed and why."


def test_a_module_checkout_on_the_default_branch_cannot_open_a_pull_request(
    repo, linked_module, remote, gh
):
    """AC 2: the base checkout's usual state is refused, before any write.

    This is why the module surface makes ``Commit & push`` its primary action
    (ADR 0013): a base checkout normally sits here, and a pull request from
    ``main`` into ``main`` is not something this surface may invent a branch for.
    """

    (repo / "kept.txt").write_text("work on the default branch\n")
    before = head_sha(repo)

    response = module_stack(linked_module)

    assert response.status_code == 409, response.content
    payload = response.json()
    assert payload["code"] == "pull_request_default_branch"
    assert "main" in payload["detail"]
    # Refused before the commit, so the work is untouched and unpublished.
    assert head_sha(repo) == before
    assert git(["status", "--porcelain"], repo).stdout.strip()


def test_a_module_pull_request_only_attempt_over_uncommitted_work_is_refused(
    repo, linked_module, remote, gh, gh_logs
):
    """AC 2: the retry's own precondition holds on the module checkout too."""

    on_feature_branch(repo)
    (repo / "kept.txt").write_text("still uncommitted\n")
    before = head_sha(repo)

    response = module_pull_request(linked_module)

    assert response.status_code == 409, response.content
    assert response.json()["code"] == "pull_request_dirty_tree"
    assert head_sha(repo) == before
    assert not any(line.startswith("pr create") for line in recorded_argv(gh_logs))


def test_the_module_pull_request_only_action_reports_earlier_steps_as_skips(
    repo, linked_module, remote, gh_logs, gh
):
    """AC 2: the retry renders from the same five-step list."""

    on_feature_branch(repo)
    (repo / "kept.txt").write_text("work to review\n")
    ok(module_stack(linked_module))

    body = ok(module_pull_request(linked_module))

    assert step_names(body) == [
        "stage",
        "generate_message",
        "commit",
        "push",
        "pull_request",
    ]
    steps = steps_by_name(body)
    assert steps["stage"]["status"] == "skipped"
    assert steps["commit"]["status"] == "skipped"
    assert steps["push"]["status"] == "skipped"
    assert body["commit_sha"] is None
    assert body["status"] == "already_open"
    assert body["pull_request_url"] == PR_URL


def test_a_module_with_no_linked_folder_refuses_every_action(linked_module):
    """AC 3: a write cannot answer absence with data, so it refuses."""

    from apps.settings_store.models import ModuleLink

    ModuleLink.objects.filter(module=linked_module).delete()

    for response in (
        module_commit(linked_module),
        module_commit_push(linked_module),
        module_push_preview(linked_module),
        module_stack(linked_module),
        module_pull_request(linked_module),
    ):
        assert response.status_code == 409, response.content
        assert response.json()["code"] == "no_checkout"


# --- AC 3: commands stay bound to the resolved module checkout ---------------


def test_a_module_action_writes_the_module_folder_and_not_the_worktree(
    repo, checkout, linked_module, bin_dir
):
    """AC 3: one ``.git``, two working trees, and no crossing between them."""

    (repo / "module-only.txt").write_text("module work\n")
    (checkout / "worktree-only.txt").write_text("worktree work\n")
    worktree_head_before = head_sha(checkout)

    body = ok(module_commit(linked_module))

    # The module's commit carries the module's file, on the module's branch.
    assert head_files(repo) == {"module-only.txt"}
    assert body["branch"] == "main"
    assert body["commit_sha"] == head_sha(repo)
    # The worktree is untouched: its HEAD did not move and its work is still
    # uncommitted, even though both checkouts share one repository.
    assert head_sha(checkout) == worktree_head_before
    assert "worktree-only.txt" in git(["status", "--porcelain"], checkout).stdout


def test_a_worktree_action_leaves_the_module_checkout_alone(
    repo, checkout, linked_module, bin_dir
):
    """AC 3: the reverse direction, asserted rather than assumed."""

    (repo / "module-only.txt").write_text("module work\n")
    (checkout / "worktree-only.txt").write_text("worktree work\n")
    module_head_before = head_sha(repo)

    response = client.post(
        "/worktrees/changes/commit",
        data={"task_id": TASK_ID, "module_id": MODULE_ID},
        content_type="application/json",
    )

    body = ok(response)
    assert head_files(checkout) == {"worktree-only.txt"}
    assert body["branch"] == branch_of(checkout)
    assert head_sha(repo) == module_head_before
    assert "module-only.txt" in git(["status", "--porcelain"], repo).stdout
