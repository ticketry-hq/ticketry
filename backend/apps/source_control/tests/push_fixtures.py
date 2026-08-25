"""A real remote on disk for the push tests.

A bare repository in ``tmp_path`` is a *real* git remote: ``ls-remote`` dials
it, ``push`` transfers objects to it, and a non-fast-forward update is refused
by the same code in git that would refuse it over SSH. Nothing about the
network path is mocked, so what these tests exercise is the actual push, its
actual rejection, and the actual refspec this app builds.
"""

from __future__ import annotations

from pathlib import Path

from apps.source_control.tests.conftest import git


def bare_remote(tmp_path: Path, *, default_branch: str = "main") -> Path:
    """An empty bare repository, ready to be added as a remote."""

    path = tmp_path / "remote.git"
    git(["init", "--bare", "-b", default_branch, str(path)], tmp_path)
    return path


def attach_remote(repo: Path, remote_path: Path, *, name: str = "origin") -> None:
    """Point ``repo`` at ``remote_path``. Worktrees share the remote."""

    git(["remote", "add", name, str(remote_path)], repo)


def remote_sha(remote_path: Path, branch: str) -> str:
    """What the remote's copy of ``branch`` points at, or ``""`` if absent."""

    listed = git(
        ["for-each-ref", "--format=%(objectname)", f"refs/heads/{branch}"],
        remote_path,
    ).stdout
    return listed.strip()


def publish_from_elsewhere(tmp_path: Path, remote_path: Path, branch: str) -> str:
    """Push a commit to ``remote_path`` from a clone this test never reviews.

    This is how divergence is produced honestly: a second repository advances
    the remote branch, exactly as a colleague or another machine would, leaving
    the checkout under test behind without ever touching it.
    """

    clone = tmp_path / "elsewhere"
    git(["clone", "--branch", branch, str(remote_path), str(clone)], tmp_path)
    git(["config", "user.email", "other@example.com"], clone)
    git(["config", "user.name", "Other User"], clone)
    git(["config", "commit.gpgsign", "false"], clone)
    (clone / "from-elsewhere.txt").write_text("someone else pushed this\n")
    git(["add", "."], clone)
    git(["commit", "-m", "work from elsewhere"], clone)
    git(["push", "origin", f"refs/heads/{branch}:refs/heads/{branch}"], clone)
    return remote_sha(remote_path, branch)
