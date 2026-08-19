"""Tests for keeping generated specs out of Git status."""

from __future__ import annotations

import subprocess
from pathlib import Path

from apps.documents import design_docs


def _git(path: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(path), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _init_repo(path: Path) -> Path:
    path.mkdir()
    _git(path, "init", "-b", "main")
    _git(path, "config", "user.email", "test@example.com")
    _git(path, "config", "user.name", "Test User")
    (path / "README.md").write_text("test\n", encoding="utf-8")
    _git(path, "add", "README.md")
    _git(path, "commit", "-m", "initial")
    return path


def _exclude_file(path: Path) -> Path:
    result = _git(
        path,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "info/exclude",
    )
    return Path(result.stdout.strip())


def test_ensure_dir_locally_excludes_spec_root(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path / "repo")

    generated = design_docs.ensure_dir(repo, "spec/module/T1--task")
    (generated / "SPEC.md").write_text("# Spec\n", encoding="utf-8")

    assert _git(repo, "check-ignore", "spec/module/T1--task/SPEC.md").returncode == 0
    assert "/spec/" in _exclude_file(repo).read_text(encoding="utf-8").splitlines()


def test_ensure_dir_excludes_nested_module_path(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path / "repo")
    module = repo / "packages" / "desktop"
    module.mkdir(parents=True)

    generated = design_docs.ensure_dir(module, "spec/module/T1--task")
    (generated / "SPEC.md").write_text("# Spec\n", encoding="utf-8")

    relative = generated.relative_to(repo).as_posix() + "/SPEC.md"
    assert _git(repo, "check-ignore", relative).returncode == 0
    assert (
        "/packages/desktop/spec/"
        in _exclude_file(repo).read_text(encoding="utf-8").splitlines()
    )


def test_ensure_dir_preserves_existing_excludes_and_is_idempotent(
    tmp_path: Path,
) -> None:
    repo = _init_repo(tmp_path / "repo")
    exclude_file = _exclude_file(repo)
    exclude_file.write_text("*.local", encoding="utf-8")

    design_docs.ensure_dir(repo, "spec/module/T1--task")
    design_docs.ensure_dir(repo, "spec/module/T2--other")

    assert exclude_file.read_text(encoding="utf-8") == "*.local\n/spec/\n"


def test_ensure_dir_excludes_specs_in_linked_worktree(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path / "repo")
    worktree = tmp_path / "worktree"
    _git(repo, "worktree", "add", "-b", "task/test", str(worktree))

    generated = design_docs.ensure_dir(worktree, "spec/module/T1--task")
    (generated / "SPEC.md").write_text("# Spec\n", encoding="utf-8")

    assert _git(worktree, "check-ignore", "spec/module/T1--task/SPEC.md").returncode == 0


def test_ensure_dir_still_works_outside_git(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()

    generated = design_docs.ensure_dir(plain, "spec/module/T1--task")

    assert generated.is_dir()
