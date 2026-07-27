"""Shared fixtures for the worktrees engine tests.

Every test runs against a *real* git repo built in ``tmp_path`` — git is never
mocked — and worktree checkouts are redirected under ``tmp_path`` so nothing
ever touches the developer's real ``~/.config/worktracker-studio``.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest


def git(args: list[str], cwd, *, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command in ``cwd`` for test setup/assertions."""

    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def init_repo(path):
    """Create a git repo on ``main`` with one committed file."""

    path.mkdir(parents=True, exist_ok=True)
    git(["init", "-b", "main"], path)
    git(["config", "user.email", "test@example.com"], path)
    git(["config", "user.name", "Test User"], path)
    git(["config", "commit.gpgsign", "false"], path)
    (path / "README.md").write_text("line one\n")
    git(["add", "."], path)
    git(["commit", "-m", "init"], path)
    return path


@pytest.fixture(autouse=True)
def worktrees_store(tmp_path, monkeypatch):
    """Redirect worktree checkouts under tmp_path for every test."""

    store = tmp_path / "wt-store"
    monkeypatch.setenv("MUXED_WORKTREES_DIR", str(store))
    return store


@pytest.fixture
def repo(tmp_path):
    """A fresh single-commit git repo on ``main``."""

    return init_repo(tmp_path / "repo")
