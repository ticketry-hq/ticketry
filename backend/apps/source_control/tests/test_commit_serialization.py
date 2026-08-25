"""Two commits on one checkout run one at a time; two checkouts do not wait.

Serialization is proved by what a hook *observes*, not by inspecting a lock: a
pre-commit hook appends a marker when it starts and another when it finishes,
and the resulting log says whether the two runs overlapped.

These cases drive the mutation directly rather than through HTTP. What is
under test is concurrency in one process, and a test client request per thread
would drag a second concern — per-thread database connections — into a case
about a working tree.
"""

from __future__ import annotations

import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from apps.source_control.actions.commit import commit_all_changes
from apps.source_control.checkouts.checkout import TaskCheckout
from apps.source_control.tests.commit_fixtures import (
    install_hook,
    isolate_generators,
)
from apps.source_control.tests.conftest import git

pytestmark = [
    # Real threads read the generator preference, so the database has to be
    # reachable from them rather than blocked by the test-case wrapper.
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


@pytest.fixture(autouse=True)
def no_generators(monkeypatch, tmp_path):
    """Keep a real CLI on the developer's machine out of the timing."""

    return isolate_generators(monkeypatch, tmp_path)


def make_repo(path: Path) -> Path:
    """A standalone repository with one commit, outside the Django fixtures."""

    path.mkdir(parents=True, exist_ok=True)
    git(["init", "-b", "main"], path)
    git(["config", "user.email", "test@example.com"], path)
    git(["config", "user.name", "Test User"], path)
    git(["config", "commit.gpgsign", "false"], path)
    (path / "seed.txt").write_text("seed\n")
    git(["add", "."], path)
    git(["commit", "-m", "init"], path)
    return path


def as_checkout(path: Path, task_id: str) -> TaskCheckout:
    return TaskCheckout(
        task_id=task_id,
        top_level_task_id=task_id,
        path=str(path),
        branch="main",
        base_branch="main",
    )


def commit_both(first: TaskCheckout, second: TaskCheckout) -> list:
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [
            pool.submit(commit_all_changes, first),
            pool.submit(commit_all_changes, second),
        ]
        return [future.result(timeout=60) for future in pending]


def test_two_commits_on_one_checkout_do_not_overlap(tmp_path):
    repo = make_repo(tmp_path / "repo")
    log = tmp_path / "hook-log"
    install_hook(
        repo,
        "pre-commit",
        f'echo start >> "{log}"\n/bin/sleep 0.4\necho end >> "{log}"',
    )
    (repo / "seed.txt").write_text("first change\n")
    checkout = as_checkout(repo, "task-a")

    # The second caller finds the tree already committed and skips, but only
    # after the first has finished — which is the property under test.
    outcomes = commit_both(checkout, checkout)

    statuses = sorted(outcome.status for outcome in outcomes)
    assert statuses == ["committed", "nothing_to_commit"]
    assert log.read_text().split() == ["start", "end"]


def test_two_commits_on_one_checkout_both_land_when_both_have_work(tmp_path):
    repo = make_repo(tmp_path / "repo")
    log = tmp_path / "hook-log"
    # Each run's hook creates the next run's work, so both commits have
    # something to do and the log must still show no overlap.
    install_hook(
        repo,
        "pre-commit",
        f'echo start >> "{log}"\n/bin/sleep 0.3\n'
        f'echo more >> "{repo}/generated.txt"\necho end >> "{log}"',
    )
    (repo / "seed.txt").write_text("first change\n")
    checkout = as_checkout(repo, "task-a")

    outcomes = commit_both(checkout, checkout)

    assert [outcome.status for outcome in outcomes] == ["committed", "committed"]
    assert log.read_text().split() == ["start", "end", "start", "end"]
    assert len(git(["log", "--format=%H"], repo).stdout.split()) == 3


def test_commits_on_two_different_checkouts_do_not_wait_on_each_other(tmp_path):
    """Each hook blocks until the *other* checkout's hook has started.

    If the two mutations were serialized against each other, neither hook
    could ever see the other's marker and both would time out. That they both
    finish is the only evidence that matters.
    """

    first = make_repo(tmp_path / "one")
    second = make_repo(tmp_path / "two")
    started_first = tmp_path / "started-one"
    started_second = tmp_path / "started-two"

    def rendezvous(mine: Path, theirs: Path) -> str:
        return (
            f'echo up > "{mine}"\n'
            f'waited=0\n'
            f'while [ ! -f "{theirs}" ] && [ "$waited" -lt 100 ]; do\n'
            f'  /bin/sleep 0.05\n'
            f'  waited=$((waited + 1))\n'
            f'done\n'
            f'[ -f "{theirs}" ]'
        )

    install_hook(first, "pre-commit", rendezvous(started_first, started_second))
    install_hook(second, "pre-commit", rendezvous(started_second, started_first))
    (first / "seed.txt").write_text("one changed\n")
    (second / "seed.txt").write_text("two changed\n")

    outcomes = commit_both(
        as_checkout(first, "task-one"), as_checkout(second, "task-two")
    )

    assert [outcome.status for outcome in outcomes] == ["committed", "committed"]
