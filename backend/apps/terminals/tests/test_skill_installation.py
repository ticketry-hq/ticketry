from __future__ import annotations

import json
import shutil

import pytest

from apps.terminals.agents.skills import package_path, tree_digest, verify_catalog
from apps.terminals.agents.skills.installation import (
    MANIFEST_NAME,
    SkillInstallationError,
    install_packaged_skills,
    provider_skill_root,
    verify_all_installations,
    verify_provider_installation,
)


PROVIDERS = ("claude", "codex", "agy", "gemini")


def test_install_is_offline_persistent_idempotent_and_provider_native(tmp_path):
    home = tmp_path / "home"
    home.mkdir()

    first = install_packaged_skills(home=home, environ={})
    before = {
        provider: {
            path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file()
        }
        for provider, root in first.items()
    }
    second = install_packaged_skills(home=home, environ={})

    assert first == second == verify_all_installations(home=home, environ={})
    expected = {package["name"] for package in verify_catalog()["packages"]}
    for provider in PROVIDERS:
        root = provider_skill_root(provider, home=home, environ={})
        assert {path.name for path in root.iterdir() if path.is_dir()} == expected
        assert json.loads((root / MANIFEST_NAME).read_text())["provider"] == provider
        assert {
            path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file()
        } == before[provider]


def test_install_accepts_existing_skill_without_overwriting(tmp_path):
    home = tmp_path / "home"
    conflict = provider_skill_root("codex", home=home, environ={}) / "to-spec"
    conflict.mkdir(parents=True)
    skill_file = conflict / "SKILL.md"
    skill_file.write_text("---\nname: to-spec\n---\nuser-owned\n")

    installed = install_packaged_skills(providers=("codex",), home=home, environ={})

    assert installed["codex"] == conflict.parent
    assert skill_file.read_text().endswith("user-owned\n")
    assert (
        verify_provider_installation("codex", names=("to-spec",), home=home, environ={})
        == conflict.parent
    )


def test_existing_skill_does_not_prevent_other_provider_installations(tmp_path):
    home = tmp_path / "home"
    conflict = provider_skill_root("codex", home=home, environ={}) / "to-spec"
    conflict.mkdir(parents=True)
    skill_file = conflict / "SKILL.md"
    skill_file.write_text("---\nname: to-spec\n---\nuser-owned\n")
    claude_root = provider_skill_root("claude", home=home, environ={})

    installed = install_packaged_skills(
        providers=("claude", "codex"), home=home, environ={}
    )

    assert installed["claude"] == claude_root
    assert (claude_root / "to-spec/SKILL.md").is_file()
    assert skill_file.read_text().endswith("user-owned\n")


def test_install_refuses_file_that_blocks_missing_skill(tmp_path):
    home = tmp_path / "home"
    conflict = provider_skill_root("codex", home=home, environ={}) / "to-spec"
    conflict.parent.mkdir(parents=True)
    conflict.write_text("user-owned\n")

    with pytest.raises(SkillInstallationError) as caught:
        install_packaged_skills(providers=("codex",), home=home, environ={})

    assert caught.value.reason == "collision"
    assert caught.value.path == conflict
    assert conflict.exists()
    assert conflict.read_text() == "user-owned\n"


def test_install_accepts_symlinked_existing_skill(tmp_path):
    home = tmp_path / "home"
    conflict = provider_skill_root("codex", home=home, environ={}) / "to-spec"
    conflict.parent.mkdir(parents=True)
    target = tmp_path / "user-owned-skill"
    target.mkdir()
    (target / "SKILL.md").write_text("---\nname: to-spec\n---\nuser-owned\n")
    conflict.symlink_to(target, target_is_directory=True)

    install_packaged_skills(providers=("codex",), home=home, environ={})

    assert conflict.is_symlink()
    assert (conflict / "SKILL.md").read_text().endswith("user-owned\n")


def test_install_accepts_existing_skill_in_alias_directory(tmp_path):
    home = tmp_path / "home"
    alias = provider_skill_root("claude", home=home, environ={}) / "my-spec"
    alias.mkdir(parents=True)
    (alias / "SKILL.md").write_text("---\nname: to-spec\n---\nlocal\n")

    install_packaged_skills(providers=("claude",), home=home, environ={})

    assert not (alias.parent / "to-spec").exists()
    assert (alias / "SKILL.md").read_text().endswith("local\n")


def test_install_updates_unedited_managed_version_when_catalog_changes(
    monkeypatch, tmp_path
):
    home = tmp_path / "home"
    root = provider_skill_root("codex", home=home, environ={})
    install_packaged_skills(providers=("codex",), home=home, environ={})
    old_digest = tree_digest(root / "to-spec")
    manifest_path = root / MANIFEST_NAME
    manifest = json.loads(manifest_path.read_text())
    manifest["packages"]["to-spec"] = old_digest
    manifest_path.write_text(json.dumps(manifest))

    replacement = tmp_path / "replacement"
    shutil.copytree(package_path("to-spec"), replacement)
    (replacement / "EXTRA").write_text("new pinned bytes\n")
    new_digest = tree_digest(replacement)
    real_verify = verify_catalog

    def changed_catalog():
        lock = real_verify()
        changed = json.loads(json.dumps(lock))
        for package in changed["packages"]:
            if package["name"] == "to-spec":
                package["path"] = str(replacement)
                package["digest"] = new_digest
        return changed

    monkeypatch.setattr(
        "apps.terminals.agents.skills.installation.verify_catalog",
        changed_catalog,
    )
    monkeypatch.setattr(
        "apps.terminals.agents.skills.installation.catalog_root",
        lambda: tmp_path,
    )

    install_packaged_skills(providers=("codex",), home=home, environ={})

    assert tree_digest(root / "to-spec") == new_digest
    assert json.loads(manifest_path.read_text())["packages"]["to-spec"] == new_digest


def test_install_preserves_edited_managed_version_with_warning(
    caplog, monkeypatch, tmp_path
):
    home = tmp_path / "home"
    root = provider_skill_root("codex", home=home, environ={})
    install_packaged_skills(providers=("codex",), home=home, environ={})
    manifest_path = root / MANIFEST_NAME
    recorded_digest = json.loads(manifest_path.read_text())["packages"]["to-spec"]
    skill_file = root / "to-spec/SKILL.md"
    skill_file.write_text(skill_file.read_text() + "\nuser edit\n")
    edited_digest = tree_digest(root / "to-spec")

    replacement = tmp_path / "replacement"
    shutil.copytree(package_path("to-spec"), replacement)
    (replacement / "EXTRA").write_text("new pinned bytes\n")
    new_digest = tree_digest(replacement)
    real_verify = verify_catalog

    def changed_catalog():
        lock = real_verify()
        changed = json.loads(json.dumps(lock))
        for package in changed["packages"]:
            if package["name"] == "to-spec":
                package["path"] = str(replacement)
                package["digest"] = new_digest
        return changed

    monkeypatch.setattr(
        "apps.terminals.agents.skills.installation.verify_catalog",
        changed_catalog,
    )
    monkeypatch.setattr(
        "apps.terminals.agents.skills.installation.catalog_root",
        lambda: tmp_path,
    )

    install_packaged_skills(providers=("codex",), home=home, environ={})

    assert tree_digest(root / "to-spec") == edited_digest
    assert (
        json.loads(manifest_path.read_text())["packages"]["to-spec"] == recorded_digest
    )
    assert "was edited by the user and will be preserved" in caplog.text


def test_verification_accepts_modified_existing_skill(tmp_path):
    home = tmp_path / "home"
    install_packaged_skills(providers=("agy",), home=home, environ={})
    root = provider_skill_root("agy", home=home, environ={})
    (root / "to-spec/SKILL.md").write_text("---\nname: to-spec\n---\nchanged\n")

    assert (
        verify_provider_installation("agy", names=("to-spec",), home=home, environ={})
        == root
    )
