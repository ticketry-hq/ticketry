from __future__ import annotations

from pathlib import Path

from apps.terminals.agents.skills import package_path, verify_catalog


def test_locked_skill_snapshot_is_complete_and_valid():
    lock = verify_catalog()

    assert lock["selected_packages"] == [
        "grill-with-docs",
        "to-spec",
        "to-tickets",
    ]
    packages = {package["name"]: package for package in lock["packages"]}
    assert set(packages) == {
        "grill-with-docs",
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
    assert packages["to-spec"]["dependencies"] == ["setup-matt-pocock-skills"]
    assert packages["to-tickets"]["dependencies"] == [
        "setup-matt-pocock-skills"
    ]


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

    skill_file = package_path("grill-with-docs") / "SKILL.md"

    assert skill_file.is_file()
    assert "name: grill-with-docs" in skill_file.read_text(encoding="utf-8")


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
