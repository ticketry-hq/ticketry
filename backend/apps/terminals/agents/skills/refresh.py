"""Controlled maintainer refresh for the vendored upstream skill snapshot."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .catalog import LOCK_PATH, SNAPSHOT_PATH, UPSTREAM_LICENSE_PATH, verify_catalog


SOURCE = "mattpocock/skills"
UPSTREAM_URL = "https://github.com/mattpocock/skills.git"
PACKAGES = (
    "grill-with-docs",
    "to-spec",
    "to-tickets",
    "grilling",
    "domain-modeling",
    "setup-matt-pocock-skills",
)


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
    packages_by_name = {package["name"]: package for package in lock["packages"]}
    if set(packages_by_name) != set(PACKAGES):
        raise RuntimeError("refresh package set disagrees with lock dependency closure")

    with tempfile.TemporaryDirectory(prefix="ticketry-skills-refresh-") as temporary:
        workspace = Path(temporary)
        install_root = workspace / "install"
        upstream_root = workspace / "upstream"
        npm_cache = workspace / "npm-cache"
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
            SOURCE,
            "--skill",
            *PACKAGES,
            "--agent",
            "codex",
            "--copy",
            "--yes",
            cwd=install_root,
            env=env,
        )

        commit = _run("git", "ls-remote", UPSTREAM_URL, "HEAD", cwd=workspace).split(
            "\t", 1
        )[0]
        _run("git", "clone", "--quiet", UPSTREAM_URL, str(upstream_root), cwd=workspace)
        _run("git", "checkout", "--quiet", commit, cwd=upstream_root)

        installer_lock = json.loads(
            (install_root / "skills-lock.json").read_text(encoding="utf-8")
        )["skills"]
        staged_snapshot = workspace / "snapshot"
        staged_snapshot.mkdir()
        for name in PACKAGES:
            installed = install_root / ".agents" / "skills" / name
            source_path = Path(installer_lock[name]["skillPath"]).parent
            upstream = upstream_root / source_path
            if _file_map(installed) != _file_map(upstream):
                raise RuntimeError(
                    f"installer output for {name} differs from upstream {commit}"
                )
            shutil.copytree(installed, staged_snapshot / name)
            package = packages_by_name[name]
            package["source_path"] = source_path.as_posix()
            package["installer_hash"] = installer_lock[name]["computedHash"]
            package["digest"] = _tree_digest(installed)

        license_bytes = (upstream_root / "LICENSE").read_bytes()
        lock["installer"]["version"] = installer_version
        lock["upstream"]["commit"] = commit
        lock["upstream"]["license"]["digest"] = (
            "sha256:" + hashlib.sha256(license_bytes).hexdigest()
        )

        shutil.rmtree(SNAPSHOT_PATH)
        shutil.copytree(staged_snapshot, SNAPSHOT_PATH)
        UPSTREAM_LICENSE_PATH.write_bytes(license_bytes)
        LOCK_PATH.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")

    verify_catalog()


if __name__ == "__main__":
    refresh()
