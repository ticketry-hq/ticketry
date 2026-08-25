"""Fixtures for the source-control review tests.

Every case runs against a *real* git repository built under ``tmp_path`` and a
*real* checkout — a worktree cut by the worktrees engine, or a module linked
to that repository through a real ``ModuleLink`` row. Git is never mocked,
because the behaviour under test is exactly how git reports a working tree.
"""

from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

import pytest

from apps.settings_store.models import ModuleLink
from apps.worktrees import service as worktrees_service
from worktracker.models import Issue, IssueType, Project


MODULE_ID = "mod-source-control"
TASK_ID = "task-980"


def git(args: list[str], cwd, *, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command in ``cwd`` for test setup and assertions."""

    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        check=check,
    )


@pytest.fixture(autouse=True)
def worktrees_store(tmp_path, monkeypatch):
    """Keep worktree checkouts under tmp_path, never the developer's profile."""

    store = tmp_path / "wt-store"
    monkeypatch.setenv("MUXED_WORKTREES_DIR", str(store))
    return store


@pytest.fixture
def repo(tmp_path):
    """A git repo on ``main`` with one commit of two text files."""

    path = tmp_path / "repo"
    path.mkdir(parents=True, exist_ok=True)
    git(["init", "-b", "main"], path)
    git(["config", "user.email", "test@example.com"], path)
    git(["config", "user.name", "Test User"], path)
    git(["config", "commit.gpgsign", "false"], path)
    (path / "kept.txt").write_text("one\ntwo\nthree\n")
    (path / "doomed.txt").write_text("bye\n")
    git(["add", "."], path)
    git(["commit", "-m", "init"], path)
    return path


@pytest.fixture
def checkout(repo) -> Path:
    """A real task worktree for :data:`TASK_ID`, as its checkout path."""

    result = worktrees_service.create(
        task_id=TASK_ID,
        working_path=str(repo),
        task_name="Review worktree changes",
        ticket_seq=980,
        module_id=MODULE_ID,
    )
    assert not isinstance(result, worktrees_service.NoWorktree)
    return Path(result.path)


@pytest.fixture
def linked_module(repo):
    """A real module work item whose host link points at the temp repo.

    Nothing about the lookup is stubbed here: the review read resolves the
    folder through the same ``ModuleLink`` row a module shell would use.
    """

    project = Project.objects.create(
        id=uuid.uuid4(), name="Source control", slug="SRCCTL"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Studio",
        sequence_id=1,
    )
    ModuleLink.objects.create(module=module, local_path=str(repo))
    return module
