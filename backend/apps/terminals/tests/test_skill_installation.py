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


def test_install_refuses_user_owned_collision_without_overwriting(tmp_path):
    home = tmp_path / "home"
    conflict = provider_skill_root("codex", home=home, environ={}) / "to-spec"
    conflict.mkdir(parents=True)
    skill_file = conflict / "SKILL.md"
    skill_file.write_text("---\nname: to-spec\n---\nuser-owned\n")

    with pytest.raises(SkillInstallationError) as caught:
        install_packaged_skills(providers=("codex",), home=home, environ={})

    assert caught.value.reason == "collision"
    assert caught.value.path == conflict
    assert skill_file.read_text().endswith("user-owned\n")


@pytest.mark.parametrize("kind", ("file", "symlink"))
def test_install_refuses_non_directory_collision_without_overwriting(tmp_path, kind):
    home = tmp_path / "home"
    conflict = provider_skill_root("codex", home=home, environ={}) / "to-spec"
    conflict.parent.mkdir(parents=True)
    if kind == "file":
        conflict.write_text("user-owned\n")
    else:
        target = tmp_path / "user-owned-skill"
        target.mkdir()
        (target / "SKILL.md").write_text("---\nname: to-spec\n---\nuser-owned\n")
        conflict.symlink_to(target, target_is_directory=True)

    with pytest.raises(SkillInstallationError) as caught:
        install_packaged_skills(providers=("codex",), home=home, environ={})

    assert caught.value.reason == "collision"
    assert caught.value.path == conflict
    assert conflict.exists()
    if kind == "file":
        assert conflict.read_text() == "user-owned\n"
    else:
        assert conflict.is_symlink()
        assert (conflict / "SKILL.md").read_text().endswith("user-owned\n")


def test_install_refuses_alias_collision(tmp_path):
    home = tmp_path / "home"
    alias = provider_skill_root("claude", home=home, environ={}) / "my-spec"
    alias.mkdir(parents=True)
    (alias / "SKILL.md").write_text("---\nname: to-spec\n---\nlocal\n")

    with pytest.raises(SkillInstallationError) as caught:
        install_packaged_skills(providers=("claude",), home=home, environ={})

    assert caught.value.reason == "collision"
    assert caught.value.path == alias


def test_install_repairs_only_a_manifest_owned_unchanged_version(
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


def test_verification_fails_after_installed_skill_is_modified(tmp_path):
    home = tmp_path / "home"
    install_packaged_skills(providers=("agy",), home=home, environ={})
    root = provider_skill_root("agy", home=home, environ={})
    (root / "to-spec/SKILL.md").write_text("changed\n")

    with pytest.raises(SkillInstallationError) as caught:
        verify_provider_installation("agy", names=("to-spec",), home=home, environ={})

    assert caught.value.reason == "modified"
