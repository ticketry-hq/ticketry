"""Real scripts on disk that stand in for the commit path's two spawn seams.

The commit tests mock nothing: git is git, the repository is a repository, and
its hooks are hooks. Two things cannot be assumed present on a developer's
machine, though — the four headless generator CLIs, and whatever hooks the
checkout would run — so both are installed here as ordinary executables.

Generators are discovered through ``PATH`` or an approved-path variable, which
makes them substitutable without a single patched function: a test drops a
script in a private bin directory and the production lookup finds it.
"""

from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

from apps.source_control.message_generators import GENERATORS


def write_executable(path: Path, body: str) -> Path:
    """Write ``body`` as an executable shell script at ``path``."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return path


def isolate_generators(monkeypatch, tmp_path) -> Path:
    """Put every generator CLI out of reach and return a private bin directory.

    ``PATH`` is narrowed to a directory holding nothing but ``git``, so a CLI
    the developer happens to have installed cannot decide a test's outcome, and
    every approved-path variable is cleared. Installing a generator afterwards
    is then a deliberate act.
    """

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    git_binary = shutil.which("git")
    assert git_binary, "these tests require git on PATH"
    git_link = bin_dir / "git"
    if not git_link.exists():
        os.symlink(git_binary, git_link)
    monkeypatch.setenv("PATH", str(bin_dir))
    for generator in GENERATORS.values():
        monkeypatch.delenv(generator.approved_path_env, raising=False)
    return bin_dir


def install_generator(
    bin_dir: Path,
    name: str,
    *,
    prints: str = "",
    exit_code: int = 0,
) -> Path:
    """Install a generator CLI on ``PATH`` that answers with ``prints``."""

    # ``echo`` and ``exit`` only: the isolated PATH holds nothing but git, so
    # a script here cannot reach for ``cat`` or ``printf`` from /bin.
    lines = [f"echo {_quoted(line)}" for line in prints.splitlines()] if prints else []
    lines.append(f"exit {exit_code}")
    return write_executable(bin_dir / name, "\n".join(lines))


def _quoted(text: str) -> str:
    """``text`` as one single-quoted shell word."""

    return "'" + text.replace("'", "'\"'\"'") + "'"


def install_hook(repo: Path, name: str, body: str) -> Path:
    """Install a git hook shared by the repository and all of its worktrees."""

    return write_executable(repo / ".git" / "hooks" / name, body)
