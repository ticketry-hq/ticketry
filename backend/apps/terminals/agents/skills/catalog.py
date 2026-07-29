"""Locate and validate the immutable workflow-skill snapshot."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


LOCK_PATH = Path(__file__).with_name("lock.json")
SNAPSHOT_PATH = Path(__file__).with_name("snapshot")
UPSTREAM_LICENSE_PATH = Path(__file__).with_name("UPSTREAM_LICENSE")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")


class CatalogValidationError(RuntimeError):
    """The packaged catalog does not match its upstream lock."""


def catalog_root() -> Path:
    """Return the resource root in source and frozen PyInstaller builds."""

    return Path(__file__).resolve().parent


def load_lock() -> dict[str, Any]:
    try:
        payload = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogValidationError(f"cannot read skill lock: {exc}") from exc
    if not isinstance(payload, dict):
        raise CatalogValidationError("skill lock must be a JSON object")
    return payload


def tree_digest(directory: Path) -> str:
    """Return the lock-format digest for one skill directory."""

    manifest_lines: list[str] = []
    for path in sorted(directory.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise CatalogValidationError(f"catalog contains a symlink: {path}")
        if not path.is_file():
            continue
        relative = path.relative_to(directory).as_posix()
        file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest_lines.append(f"{file_hash}  {relative}\n")
    return "sha256:" + hashlib.sha256("".join(manifest_lines).encode()).hexdigest()


def _skill_name(skill_file: Path) -> str:
    try:
        contents = skill_file.read_text(encoding="utf-8")
    except OSError as exc:
        raise CatalogValidationError(f"cannot read {skill_file}: {exc}") from exc
    match = re.search(r"(?m)^name:\s*([a-z0-9-]+)\s*$", contents)
    if not match:
        raise CatalogValidationError(f"{skill_file} has no canonical name")
    return match.group(1)


def package_path(name: str, *, verify: bool = True) -> Path:
    lock = verify_catalog() if verify else load_lock()
    packages = {package["name"]: package for package in lock["packages"]}
    try:
        relative = packages[name]["path"]
    except KeyError as exc:
        raise CatalogValidationError(f"unknown packaged skill: {name}") from exc
    path = (catalog_root() / relative).resolve()
    if not path.is_relative_to(catalog_root()):
        raise CatalogValidationError(f"skill path escapes catalog: {relative}")
    return path


def verify_catalog() -> dict[str, Any]:
    """Fail closed unless the snapshot, lock, attribution, and closure agree."""

    lock = load_lock()
    if lock.get("schema_version") != 1:
        raise CatalogValidationError("unsupported skill lock schema")
    commit = lock.get("upstream", {}).get("commit", "")
    if not _COMMIT.fullmatch(commit):
        raise CatalogValidationError("upstream commit must be an exact SHA")

    license_digest = lock.get("upstream", {}).get("license", {}).get("digest", "")
    actual_license_digest = "sha256:" + hashlib.sha256(
        UPSTREAM_LICENSE_PATH.read_bytes()
    ).hexdigest()
    if not _SHA256.fullmatch(license_digest) or license_digest != actual_license_digest:
        raise CatalogValidationError("upstream license does not match its digest")

    packages = lock.get("packages")
    if not isinstance(packages, list) or not packages:
        raise CatalogValidationError("skill lock has no packages")
    names = [package.get("name") for package in packages]
    if any(not isinstance(name, str) or not name for name in names):
        raise CatalogValidationError("every package needs a name")
    if len(names) != len(set(names)):
        raise CatalogValidationError("skill package names must be unique")
    packages_by_name = dict(zip(names, packages, strict=True))
    actual_snapshot_entries = {
        path.name for path in SNAPSHOT_PATH.iterdir() if path.is_dir()
    }
    if actual_snapshot_entries != packages_by_name.keys() or any(
        not path.is_dir() for path in SNAPSHOT_PATH.iterdir()
    ):
        raise CatalogValidationError("snapshot root disagrees with locked packages")

    for name, package in packages_by_name.items():
        relative = package.get("path")
        if not isinstance(relative, str):
            raise CatalogValidationError(f"{name} has no package path")
        directory = (catalog_root() / relative).resolve()
        if not directory.is_relative_to(SNAPSHOT_PATH.resolve()):
            raise CatalogValidationError(f"{name} path escapes the snapshot")
        if not directory.is_dir():
            raise CatalogValidationError(f"{name} package is missing")
        if _skill_name(directory / "SKILL.md") != name:
            raise CatalogValidationError(f"{name} package metadata disagrees with lock")
        digest = package.get("digest", "")
        if not _SHA256.fullmatch(digest) or tree_digest(directory) != digest:
            raise CatalogValidationError(f"{name} package digest mismatch")
        installer_hash = package.get("installer_hash", "")
        if not re.fullmatch(r"[0-9a-f]{64}", installer_hash):
            raise CatalogValidationError(f"{name} installer hash is invalid")
        dependencies = package.get("dependencies")
        if not isinstance(dependencies, list) or len(dependencies) != len(
            set(dependencies)
        ):
            raise CatalogValidationError(f"{name} dependencies must be unique")
        unknown = set(dependencies) - packages_by_name.keys()
        if unknown:
            raise CatalogValidationError(
                f"{name} has unknown dependencies: {sorted(unknown)}"
            )
        tools = package.get("required_mcp_tools")
        if not isinstance(tools, list) or len(tools) != len(set(tools)):
            raise CatalogValidationError(f"{name} MCP tools must be unique")
        if any(not isinstance(tool, str) or not tool for tool in tools):
            raise CatalogValidationError(f"{name} MCP tool name is invalid")

    selected = lock.get("selected_packages")
    if not isinstance(selected, list) or len(selected) != len(set(selected)):
        raise CatalogValidationError("selected packages must be unique")
    if set(selected) - packages_by_name.keys():
        raise CatalogValidationError("selected package is absent from snapshot")
    for name, package in packages_by_name.items():
        expected_role = "selected" if name in selected else "transitive"
        if package.get("role") != expected_role:
            raise CatalogValidationError(f"{name} has incorrect dependency role")

    reachable: set[str] = set()
    frontier = list(selected)
    while frontier:
        name = frontier.pop()
        if name in reachable:
            continue
        reachable.add(name)
        frontier.extend(packages_by_name[name]["dependencies"])
    if reachable != packages_by_name.keys():
        raise CatalogValidationError("snapshot contains packages outside dependency closure")

    providers = lock.get("providers")
    if not isinstance(providers, list) or not providers:
        raise CatalogValidationError("skill lock has no provider support matrix")
    provider_names = [provider.get("name") for provider in providers]
    if len(provider_names) != len(set(provider_names)):
        raise CatalogValidationError("provider names must be unique")
    for provider in providers:
        if not provider.get("minimum_tested_version") or not provider.get("mechanism"):
            raise CatalogValidationError("provider entry lacks tested version or mechanism")
    return lock
