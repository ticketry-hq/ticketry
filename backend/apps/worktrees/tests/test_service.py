"""Integration tests for the git-worktree lifecycle engine (#585).

All tests drive the real ``git`` binary against repos built in ``tmp_path``;
nothing is mocked. Each AC line in the LLD maps to at least one test here.
"""

from __future__ import annotations

import os
import shutil

import pytest

from apps.worktrees import dao, service
from apps.worktrees.tests.conftest import git


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]


def _real(path: str) -> str:
    return os.path.realpath(path)


def _head(path) -> str:
    return git(["rev-parse", "HEAD"], path).stdout.strip()


def _commit(path, *, filename="work.txt", content="x\n", message="work"):
    target = os.path.join(str(path), filename)
    with open(target, "w") as fh:
        fh.write(content)
    git(["add", "."], path)
    git(["commit", "-m", message], path)


# --------------------------------------------------------------------------- discover


def test_discover_repo(repo, tmp_path):
    assert _real(service.discover_repo(str(repo))) == _real(str(repo))

    nested = repo / "a" / "b"
    nested.mkdir(parents=True)
    assert _real(service.discover_repo(str(nested))) == _real(str(repo))


def test_no_repo_fallback(tmp_path):
    bare = tmp_path / "not-a-repo"
    bare.mkdir()

    assert service.discover_repo(str(bare)) is None

    result = service.create(task_id="t1", working_path=str(bare), task_name="x")
    assert isinstance(result, service.NoWorktree)
    assert result.reason  # non-empty reason, no exception


# --------------------------------------------------------------------------- create


def test_create_off_head(repo):
    head_before = _head(repo)

    wt = service.create(
        task_id="t1", working_path=str(repo), task_name="My Task", ticket_seq=42
    )
    assert not isinstance(wt, service.NoWorktree)
    assert wt.branch == "wt/CODIN-42-my-task"
    assert wt.base_branch == "main"
    assert wt.base_commit == head_before
    assert _head(wt.path) == head_before

    # A later commit on the primary must NOT move the worktree.
    _commit(repo, message="primary advances")
    assert _head(repo) != head_before
    assert _head(wt.path) == head_before
    assert wt.base_commit == head_before


def test_create_idempotent(repo):
    first = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    second = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    assert first.id == second.id

    listing = git(["worktree", "list", "--porcelain"], repo).stdout
    # primary + exactly one added worktree
    assert listing.count("worktree ") == 2


def test_create_detached_head_records_sha(repo):
    sha = _head(repo)
    git(["checkout", "--detach", sha], repo)

    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=7)
    assert wt.base_branch == sha  # detached → sha is the recorded target


# --------------------------------------------------------------------------- status


def test_status_clean_dirty(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)

    st = service.status("t1")
    assert st.exists and st.clean and not st.dirty
    assert st.ahead == 0 and st.behind == 0

    with open(os.path.join(wt.path, "scratch.txt"), "w") as fh:
        fh.write("dirty\n")
    assert service.status("t1").dirty

    _commit(wt.path, message="a commit")
    st = service.status("t1")
    assert st.clean and st.ahead == 1 and st.behind == 0


def test_status_behind(repo):
    service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    _commit(repo, message="base moves")

    st = service.status("t1")
    assert st.behind >= 1 and st.ahead == 0


def test_status_no_worktree():
    assert isinstance(service.status("ghost"), service.NoWorktree)


# --------------------------------------------------------------------------- integrate


def test_integrate_clean(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    _commit(wt.path, message="task work")
    task_tip = _head(wt.path)

    result = service.integrate("t1")
    assert result.outcome == "integrated"

    assert git(["rev-parse", "main"], repo).stdout.strip() == task_tip  # base ff'd
    assert not os.path.isdir(wt.path)  # worktree removed
    assert wt.branch not in git(["branch", "--list", wt.branch], repo).stdout
    assert dao.get_by_task("t1") is None  # row deleted


def test_integrate_conflict(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)

    # Diverge the same line on base and on the task branch.
    with open(os.path.join(str(repo), "README.md"), "w") as fh:
        fh.write("base side\n")
    git(["commit", "-am", "base edit"], repo)

    with open(os.path.join(wt.path, "README.md"), "w") as fh:
        fh.write("task side\n")
    git(["commit", "-am", "task edit"], wt.path)

    result = service.integrate("t1")
    assert result.outcome == "conflict"

    record = dao.get_by_task("t1")
    assert record is not None and record.status == "conflict"  # row intact, flagged
    assert os.path.isdir(wt.path)  # tree intact for resolution
    # The primary checkout is never left mid-merge.
    assert not os.path.exists(os.path.join(str(repo), ".git", "MERGE_HEAD"))


def test_integrate_conflict_then_resolve(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)

    with open(os.path.join(str(repo), "README.md"), "w") as fh:
        fh.write("base side\n")
    git(["commit", "-am", "base edit"], repo)
    with open(os.path.join(wt.path, "README.md"), "w") as fh:
        fh.write("task side\n")
    git(["commit", "-am", "task edit"], wt.path)

    assert service.integrate("t1").outcome == "conflict"

    # Resolve inside the worktree and complete the merge.
    with open(os.path.join(wt.path, "README.md"), "w") as fh:
        fh.write("resolved\n")
    git(["add", "README.md"], wt.path)
    git(["commit", "--no-edit"], wt.path)

    result = service.integrate("t1")
    assert result.outcome == "integrated"
    assert not os.path.isdir(wt.path)
    assert dao.get_by_task("t1") is None


def test_integrate_base_not_checked_out(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    _commit(wt.path, message="task work")
    task_tip = _head(wt.path)

    # Move the primary off base; integrate must advance the ref directly.
    git(["checkout", "-b", "other"], repo)

    result = service.integrate("t1")
    assert result.outcome == "integrated"
    assert git(["rev-parse", "main"], repo).stdout.strip() == task_tip
    assert not os.path.isdir(wt.path)
    assert dao.get_by_task("t1") is None


def test_integrate_refuses_dirty(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    with open(os.path.join(wt.path, "uncommitted.txt"), "w") as fh:
        fh.write("wip\n")

    result = service.integrate("t1")
    assert result.outcome == "dirty"
    assert os.path.isdir(wt.path)  # nothing destroyed
    assert dao.get_by_task("t1") is not None


def test_integrate_refuses_ephemeral(repo):
    service.create(task_id="t1", working_path=str(repo), ticket_seq=1, ephemeral=True)
    result = service.integrate("t1")
    assert result.outcome == "ephemeral"
    assert dao.get_by_task("t1") is not None


# --------------------------------------------------------------------------- discard


def test_discard(repo):
    base_before = _head(repo)
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=1)
    _commit(wt.path, message="unwanted work")  # would be lost — that's the point

    result = service.discard("t1")
    assert result.removed

    assert git(["rev-parse", "main"], repo).stdout.strip() == base_before  # base untouched
    assert not os.path.isdir(wt.path)
    assert wt.branch not in git(["branch", "--list", wt.branch], repo).stdout
    assert dao.get_by_task("t1") is None


# --------------------------------------------------------------------------- persistence / reconcile


def test_persist_restore(repo):
    wt = service.create(task_id="t1", working_path=str(repo), ticket_seq=9)

    # Simulate a restart: a fresh query must re-attach path/branch/base.
    restored = dao.get_by_task("t1")
    assert restored.path == wt.path
    assert restored.branch == wt.branch
    assert restored.base_branch == wt.base_branch
    assert restored.base_commit == wt.base_commit


def test_reconcile_prunes_stale(repo):
    live = service.create(task_id="live", working_path=str(repo), ticket_seq=1)
    stale = service.create(task_id="stale", working_path=str(repo), ticket_seq=2)

    # Remove one worktree out of band — git forgets it, the row lingers.
    git(["worktree", "remove", "--force", stale.path], repo)

    result = service.reconcile()
    assert "stale" in result.pruned
    assert "live" not in result.pruned
    assert result.kept == 1

    assert dao.get_by_task("stale") is None
    assert dao.get_by_task("live") is not None
