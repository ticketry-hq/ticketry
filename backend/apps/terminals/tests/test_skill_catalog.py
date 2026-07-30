from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from apps.terminals.agents.skills import catalog as skill_catalog
from apps.terminals.agents.skills import (
    CatalogValidationError,
    catalog_root,
    package_path,
    verify_catalog,
)


def test_locked_skill_snapshot_is_complete_and_valid():
    lock = verify_catalog()

    assert lock["selected_packages"] == [
        "code-review",
        "grill-with-docs",
        "implement",
        "tdd",
        "to-spec",
        "to-tickets",
    ]
    packages = {package["name"]: package for package in lock["packages"]}
    assert set(packages) == {
        "code-review",
        "grill-with-docs",
        "implement",
        "tdd",
        "to-spec",
        "to-tickets",
        "grilling",
        "domain-modeling",
        "setup-matt-pocock-skills",
    }
    assert packages["grill-with-docs"]["dependencies"] == [
        "grilling",
        "domain-modeling",
    ]
    assert packages["code-review"]["dependencies"] == ["setup-matt-pocock-skills"]
    assert packages["implement"]["dependencies"] == ["tdd", "code-review"]
    assert packages["tdd"]["dependencies"] == []
    assert packages["to-spec"]["dependencies"] == ["setup-matt-pocock-skills"]
    assert packages["to-tickets"]["dependencies"] == ["setup-matt-pocock-skills"]
    assert {
        name for name, package in packages.items() if package["role"] == "selected"
    } == set(lock["selected_packages"])
    assert lock["upstream"]["commit"] == ("ed37663cc5fbef691ddfecd080dff42f7e7e350d")


@pytest.fixture
def isolated_catalog(monkeypatch, tmp_path):
    root = tmp_path / "skills"
    shutil.copytree(catalog_root(), root)
    monkeypatch.setattr(skill_catalog, "LOCK_PATH", root / "lock.json")
    monkeypatch.setattr(skill_catalog, "SNAPSHOT_PATH", root / "snapshot")
    monkeypatch.setattr(
        skill_catalog,
        "UPSTREAM_LICENSE_PATH",
        root / "UPSTREAM_LICENSE",
    )
    monkeypatch.setattr(skill_catalog, "catalog_root", lambda: root)
    return root


@pytest.mark.parametrize(
    "mutation",
    ("missing", "extra", "unreachable", "classification", "modified"),
)
def test_catalog_rejects_package_set_and_integrity_drift(isolated_catalog, mutation):
    lock_path = isolated_catalog / "lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    packages = {package["name"]: package for package in lock["packages"]}

    if mutation == "missing":
        lock["selected_packages"].remove("code-review")
        lock["packages"].remove(packages["code-review"])
        shutil.rmtree(isolated_catalog / "snapshot/code-review")
    elif mutation == "extra":
        extra = json.loads(json.dumps(packages["tdd"]))
        extra["name"] = "unexpected"
        extra["path"] = "snapshot/unexpected"
        lock["packages"].append(extra)
        shutil.copytree(
            isolated_catalog / "snapshot/tdd",
            isolated_catalog / "snapshot/unexpected",
        )
    elif mutation == "unreachable":
        packages["grill-with-docs"]["dependencies"] = []
    elif mutation == "classification":
        packages["code-review"]["role"] = "transitive"
    else:
        (isolated_catalog / "snapshot/code-review/SKILL.md").write_text(
            "modified\n",
            encoding="utf-8",
        )

    lock_path.write_text(json.dumps(lock), encoding="utf-8")

    with pytest.raises(CatalogValidationError):
        verify_catalog()


def test_package_paths_resolve_without_network_or_user_configuration(monkeypatch):
    for variable in (
        "HOME",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "GEMINI_CLI_HOME",
        "HTTP_PROXY",
        "HTTPS_PROXY",
    ):
        monkeypatch.delenv(variable, raising=False)

    skill_file = package_path("code-review") / "SKILL.md"

    assert skill_file.is_file()
    assert "name: code-review" in skill_file.read_text(encoding="utf-8")


def test_runtime_catalog_code_has_no_installer_or_download_path():
    catalog_module = Path(package_path.__code__.co_filename)
    runtime_sources = [
        catalog_module,
        catalog_module.with_name("__init__.py"),
    ]

    for source in runtime_sources:
        contents = source.read_text(encoding="utf-8")
        assert "npx " not in contents
        assert "subprocess" not in contents
