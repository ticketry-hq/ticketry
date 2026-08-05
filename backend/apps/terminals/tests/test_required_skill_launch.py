from __future__ import annotations

import json
from pathlib import Path

import pytest

import apps.terminals.launch as launch
import apps.terminals.agents.registry as agent_registry
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from apps.terminals.tmux import sessions as tmux_sessions
from apps.terminals.agents.registry import (
    cleanup_temporary_artifacts,
    get_adapter,
)
from apps.terminals.agents.skills import (
    CatalogValidationError,
    package_path,
    tree_digest,
    verify_catalog,
)
from apps.terminals.agents.skills import preflight
from apps.terminals.agents.skills.installation import (
    install_packaged_skills,
    provider_skill_root,
)
from apps.terminals.agents.skills.preflight import (
    RequiredSkillUnavailable,
    WORKTRACKER_TOOLS,
    resolve_required_skills,
    skill_prompt_envelope,
)
from worktracker.required_skills import DEFAULT_REQUIRED_SKILLS
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)


def _isolate_visible_skills(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    home = tmp_path / "home"
    repo = tmp_path / "repo"
    home.mkdir()
    repo.mkdir()
    monkeypatch.setattr(preflight.Path, "home", lambda: home)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.delenv("GEMINI_CLI_HOME", raising=False)
    return home, repo


def _resolved(monkeypatch, tmp_path: Path, provider: str = "claude"):
    home, repo = _isolate_visible_skills(monkeypatch, tmp_path)
    install_packaged_skills(providers=(provider,), home=home)
    return resolve_required_skills(
        provider=provider,
        required_skills=("grill-with-docs", "to-spec", "to-tickets"),
        cwd=str(repo),
        supports_required_skills=True,
        available_tools=WORKTRACKER_TOOLS,
    )


def test_resolution_freezes_dependency_closure_tools_and_revision(monkeypatch, tmp_path):
    resolved = _resolved(monkeypatch, tmp_path)

    assert resolved.requested == ("grill-with-docs", "to-spec", "to-tickets")
    assert set(resolved.names) == {
        "grill-with-docs",
        "to-spec",
        "to-tickets",
        "grilling",
        "domain-modeling",
        "setup-matt-pocock-skills",
    }
    assert resolved.required_tools == WORKTRACKER_TOOLS
    assert len(resolved.upstream_revision) == 40
    envelope = skill_prompt_envelope(resolved)
    assert "grill-with-docs, to-spec, to-tickets" in envelope
    assert resolved.upstream_revision in envelope


@pytest.mark.parametrize(
    ("stage", "expected_names"),
    [
        (
            "Grill",
            {"grill-with-docs", "grilling", "domain-modeling"},
        ),
        (
            "Spec",
            {"to-spec", "setup-matt-pocock-skills"},
        ),
        (
            "Tickets",
            {"to-tickets", "setup-matt-pocock-skills"},
        ),
    ],
)
def test_refinement_stage_resolves_only_its_declared_skill_closure(
    monkeypatch,
    tmp_path,
    stage,
    expected_names,
):
    home, repo = _isolate_visible_skills(monkeypatch, tmp_path)
    install_packaged_skills(providers=("claude",), home=home)

    resolved = resolve_required_skills(
        provider="claude",
        required_skills=DEFAULT_REQUIRED_SKILLS[stage],
        cwd=str(repo),
        supports_required_skills=True,
        available_tools=WORKTRACKER_TOOLS,
    )

    assert resolved.requested == DEFAULT_REQUIRED_SKILLS[stage]
    assert set(resolved.names) == expected_names


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
def test_different_provider_visible_reserved_name_fails_closed(
    monkeypatch, tmp_path, provider
):
    home, repo = _isolate_visible_skills(monkeypatch, tmp_path)
    collision_roots = {
        "claude": home / ".claude/skills",
        "codex": home / ".codex/skills",
        "agy": home / ".agents/skills",
        "gemini": home / ".gemini/skills",
    }
    conflict = collision_roots[provider] / "to-spec"
    conflict.mkdir(parents=True)
    (conflict / "SKILL.md").write_text("---\nname: to-spec\n---\nchanged\n")

    with pytest.raises(RequiredSkillUnavailable) as caught:
        resolve_required_skills(
            provider=provider,
            required_skills=("to-spec",),
            cwd=str(repo),
            supports_required_skills=True,
            available_tools=WORKTRACKER_TOOLS,
        )

    assert caught.value.reason == "collision"
    assert caught.value.conflicting_path == conflict
    assert (conflict / "SKILL.md").read_text().endswith("changed\n")
    assert AgentRun.objects.count() == 0
    assert AgentTerminalSession.objects.count() == 0


def test_collision_scan_uses_canonical_metadata_not_only_folder_name(
    monkeypatch, tmp_path
):
    home, repo = _isolate_visible_skills(monkeypatch, tmp_path)
    conflict = home / ".claude/skills/local-alias"
    conflict.mkdir(parents=True)
    (conflict / "SKILL.md").write_text("---\nname: to-spec\n---\nlocal\n")

    with pytest.raises(RequiredSkillUnavailable) as caught:
        resolve_required_skills(
            provider="claude",
            required_skills=("to-spec",),
            cwd=str(repo),
            supports_required_skills=True,
            available_tools=WORKTRACKER_TOOLS,
        )

    assert caught.value.reason == "collision"
    assert caught.value.conflicting_path == conflict


def test_identical_provider_visible_reserved_name_is_accepted(monkeypatch, tmp_path):
    home, repo = _isolate_visible_skills(monkeypatch, tmp_path)
    install_packaged_skills(providers=("claude",), home=home)

    resolved = resolve_required_skills(
        provider="claude",
        required_skills=("to-spec",),
        cwd=str(repo),
        supports_required_skills=True,
        available_tools=WORKTRACKER_TOOLS,
    )

    assert "to-spec" in resolved.names


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
def test_missing_required_worktracker_tool_fails_preflight(
    monkeypatch, tmp_path, provider
):
    _, repo = _isolate_visible_skills(monkeypatch, tmp_path)

    with pytest.raises(RequiredSkillUnavailable) as caught:
        resolve_required_skills(
            provider=provider,
            required_skills=("to-tickets",),
            cwd=str(repo),
            supports_required_skills=True,
            available_tools=frozenset({"get_task_details"}),
        )

    assert caught.value.reason == "tool_unavailable"
    assert "create_sub_task" in caught.value.message
    assert AgentRun.objects.count() == 0
    assert AgentTerminalSession.objects.count() == 0


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
def test_approved_provider_below_locked_minimum_fails_preflight(
    monkeypatch, tmp_path, provider
):
    _, repo = _isolate_visible_skills(monkeypatch, tmp_path)
    executable = tmp_path / provider
    executable.write_text(f"#!/bin/sh\nprintf '{provider} 0.0.1\\n'\n")
    executable.chmod(0o700)
    monkeypatch.setenv(
        f"MUXED_APPROVED_{provider.upper()}_PATH", str(executable)
    )

    with pytest.raises(RequiredSkillUnavailable) as caught:
        resolve_required_skills(
            provider=provider,
            required_skills=("to-spec",),
            cwd=str(repo),
            supports_required_skills=True,
            available_tools=WORKTRACKER_TOOLS,
        )

    assert caught.value.reason == "provider_unsupported"
    assert AgentRun.objects.count() == 0
    assert AgentTerminalSession.objects.count() == 0


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
@pytest.mark.parametrize("corruption", ("lock", "package"))
def test_corrupt_packaged_catalog_fails_before_durable_state(
    monkeypatch, tmp_path, provider, corruption
):
    _, repo = _isolate_visible_skills(monkeypatch, tmp_path)

    def corrupt_catalog():
        raise CatalogValidationError(f"corrupt {corruption}")

    monkeypatch.setattr(preflight, "verify_catalog", corrupt_catalog)

    with pytest.raises(RequiredSkillUnavailable) as caught:
        resolve_required_skills(
            provider=provider,
            required_skills=("to-spec",),
            cwd=str(repo),
            supports_required_skills=True,
            available_tools=WORKTRACKER_TOOLS,
        )

    assert caught.value.reason == "catalog_invalid"
    assert AgentRun.objects.count() == 0
    assert AgentTerminalSession.objects.count() == 0


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
def test_adapter_uses_persistent_exact_locked_installation(
    monkeypatch, tmp_path, provider
):
    resolved = _resolved(monkeypatch, tmp_path, provider)
    adapter = get_adapter(provider)
    augmentation = adapter.augment_launch(
        adapter.command(
            "prompt", activated_providers={"claude", "agy", "codex", "gemini"}
        ),
        f"run-{provider}",
        lifecycle_url="http://127.0.0.1:8123/api/lifecycle/events",
        mcp_url="http://127.0.0.1:8124/mcp",
        skills=resolved,
    )

    try:
        argv = list(augmentation.argv)
        environment = dict(augmentation.environment)
        exposed_root = provider_skill_root(provider, home=tmp_path / "home")
        exposed = {
            path.name for path in exposed_root.iterdir() if path.is_dir()
        }
        assert "--plugin-dir" not in argv
        assert "--add-dir" not in argv
        assert "HOME" not in environment
        assert "CODEX_HOME" not in environment
        assert "GEMINI_CLI_HOME" not in environment
        if provider == "gemini":
            settings = json.loads(
                Path(environment["GEMINI_CLI_SYSTEM_SETTINGS_PATH"]).read_text()
            )
            assert "worktracker-agent" in settings["mcpServers"]
        assert exposed == {
            package["name"] for package in verify_catalog()["packages"]
        }
        assert all(
            tree_digest(path) == tree_digest(package_path(path.name))
            for path in exposed_root.iterdir()
            if path.is_dir()
        )
    finally:
        cleanup_temporary_artifacts(augmentation.temporary_artifacts)

    assert all(not path.exists() for path in augmentation.temporary_artifacts)
    assert list((tmp_path / "home").iterdir()) != []
    assert list((tmp_path / "repo").iterdir()) == []


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
async def test_overlay_failure_happens_before_agent_run_or_tmux(
    monkeypatch, tmp_path, provider
):
    monkeypatch.setattr(agent_registry.tempfile, "tempdir", str(tmp_path))
    adapter = get_adapter(provider)
    resolved = preflight.ResolvedSkills(
        ("to-spec",),
        (("to-spec", package_path("to-spec")),),
        frozenset(),
        "a" * 40,
    )
    tmux_called = False

    def create_session(**kwargs):
        nonlocal tmux_called
        tmux_called = True

    def fail_augmentation(self, *args, **kwargs):
        raise OSError("overlay unavailable")

    monkeypatch.setattr(type(adapter), "augment_launch", fail_augmentation)
    monkeypatch.setattr(tmux_sessions, "create_session", create_session)

    with pytest.raises(RequiredSkillUnavailable) as caught:
        await launch._launch(
            adapter=adapter,
            issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
            argv=[provider, "prompt"],
            cwd="/tmp",
            design_dir=None,
            scope="task",
            doc_rel_path=None,
            agent_run_id=f"preflight-failure-{provider}",
            resolved_skills=resolved,
        )

    assert caught.value.reason == "launch_configuration_failed"
    assert not tmux_called
    assert await AgentRun.objects.acount() == 0
    assert await AgentTerminalSession.objects.acount() == 0
    assert not (
        tmp_path / "ticketry-agent-runs" / f"preflight-failure-{provider}"
    ).exists()


@pytest.mark.parametrize("provider", ("claude", "codex", "agy", "gemini"))
async def test_tmux_launch_failure_removes_run_session_and_overlay(
    monkeypatch, tmp_path, provider
):
    monkeypatch.setattr(agent_registry.tempfile, "tempdir", str(tmp_path))
    resolved = _resolved(monkeypatch, tmp_path, provider)
    adapter = get_adapter(provider)

    def fail_create_session(**kwargs):
        raise RuntimeError("tmux refused launch")

    monkeypatch.setattr(tmux_sessions, "create_session", fail_create_session)
    run_id = f"tmux-failure-{provider}"

    with pytest.raises(launch.LaunchUnavailable):
        await launch._launch(
            adapter=adapter,
            issue_id=fixture_issue_id(project_id="p1", module_id="m1", task_id="t1"),
            argv=[provider, "prompt"],
            cwd=str(tmp_path),
            design_dir=None,
            scope="task",
            doc_rel_path=None,
            agent_run_id=run_id,
            resolved_skills=resolved,
        )

    assert await AgentRun.objects.acount() == 0
    assert await AgentTerminalSession.objects.acount() == 0
    assert not (tmp_path / "ticketry-agent-runs" / run_id).exists()
