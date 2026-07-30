"""Controlled maintainer refresh for the vendored upstream skill snapshot."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .catalog import (
    EXPECTED_PACKAGES,
    EXPECTED_SELECTED_PACKAGES,
    LOCK_PATH,
    PINNED_UPSTREAM_COMMIT,
    SNAPSHOT_PATH,
    UPSTREAM_LICENSE_PATH,
    UPSTREAM_REPOSITORY,
    verify_catalog,
)


PACKAGES = tuple(EXPECTED_PACKAGES)


def _run(*args: str, cwd: Path, env: dict[str, str] | None = None) -> str:
    completed = subprocess.run(
        args,
        cwd=cwd,
        env=env,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return completed.stdout.strip()


def _file_map(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _tree_digest(root: Path) -> str:
    lines = [
        f"{hashlib.sha256(contents).hexdigest()}  {relative}\n"
        for relative, contents in _file_map(root).items()
    ]
    return "sha256:" + hashlib.sha256("".join(lines).encode()).hexdigest()


def refresh() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))

    with tempfile.TemporaryDirectory(prefix="ticketry-skills-refresh-") as temporary:
        workspace = Path(temporary)
        install_root = workspace / "install"
        upstream_root = workspace / "upstream"
        npm_cache = workspace / "npm-cache"
        _run(
            "git",
            "clone",
            "--quiet",
            "--no-checkout",
            UPSTREAM_REPOSITORY,
            str(upstream_root),
            cwd=workspace,
        )
        _run(
            "git",
            "checkout",
            "--quiet",
            PINNED_UPSTREAM_COMMIT,
            cwd=upstream_root,
        )
        commit = _run("git", "rev-parse", "HEAD", cwd=upstream_root)
        if commit != PINNED_UPSTREAM_COMMIT:
            raise RuntimeError("upstream checkout disagrees with pinned revision")

        install_root.mkdir()
        env = os.environ.copy()
        env["npm_config_cache"] = str(npm_cache)
        _run("git", "init", "--quiet", cwd=install_root)

        installer_version = _run(
            "npx", "--yes", "skills@latest", "--version", cwd=install_root, env=env
        )
        _run(
            "npx",
            "--yes",
            "skills@latest",
            "add",
            str(upstream_root),
            "--skill",
            *PACKAGES,
            "--agent",
            "codex",
            "--copy",
            "--yes",
            cwd=install_root,
            env=env,
        )

        installer_lock = json.loads(
            (install_root / "skills-lock.json").read_text(encoding="utf-8")
        )["skills"]
        if set(installer_lock) != set(PACKAGES):
            raise RuntimeError("installer output disagrees with catalog package set")
        staged_snapshot = workspace / "snapshot"
        staged_snapshot.mkdir()
        locked_packages = []
        for name in PACKAGES:
            installed = install_root / ".agents" / "skills" / name
            expected = EXPECTED_PACKAGES[name]
            source_path = Path(expected["source_path"])
            upstream = upstream_root / source_path
            if _file_map(installed) != _file_map(upstream):
                raise RuntimeError(
                    f"installer output for {name} differs from upstream {commit}"
                )
            shutil.copytree(installed, staged_snapshot / name)
            locked_packages.append(
                {
                    "name": name,
                    "role": (
                        "selected"
                        if name in EXPECTED_SELECTED_PACKAGES
                        else "transitive"
                    ),
                    "source_path": source_path.as_posix(),
                    "path": f"snapshot/{name}",
                    "installer_hash": installer_lock[name]["computedHash"],
                    "digest": _tree_digest(installed),
                    "dependencies": list(expected["dependencies"]),
                    "required_mcp_tools": list(expected["required_mcp_tools"]),
                }
            )

        license_bytes = (upstream_root / "LICENSE").read_bytes()
        lock["installer"]["command"] = (
            "npx skills@latest add <pinned mattpocock/skills checkout>"
        )
        lock["installer"]["version"] = installer_version
        lock["upstream"]["repository"] = UPSTREAM_REPOSITORY
        lock["upstream"]["commit"] = commit
        lock["upstream"]["license"]["digest"] = (
            "sha256:" + hashlib.sha256(license_bytes).hexdigest()
        )
        lock["selected_packages"] = list(EXPECTED_SELECTED_PACKAGES)
        lock["packages"] = locked_packages

        shutil.rmtree(SNAPSHOT_PATH)
        shutil.copytree(staged_snapshot, SNAPSHOT_PATH)
        UPSTREAM_LICENSE_PATH.write_bytes(license_bytes)
        LOCK_PATH.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")

    verify_catalog()


if __name__ == "__main__":
    refresh()
