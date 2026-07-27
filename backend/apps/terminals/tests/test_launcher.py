"""Tests for agent launch prompt builders (#625 doc-chat, #862 SDLC prompts)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from apps.terminals.agents.prompts import (
    build_context_prompt,
    build_doc_chat_prompt,
    build_planning_context_prompt,
)
from apps.settings_store.config import config
from apps.settings_store.defaults import DEFAULT_AGENT_PROMPTS
from studio_server.contracts import ModuleSummary, TaskState, TaskSummary


def _task(state: str, issue_type: str = "Story", **kwargs) -> TaskSummary:
    """Build a minimal TaskSummary in a given SDLC state / type."""
    return TaskSummary(
        id="task-1",
        name="Launch workflow",
        project_id="project-1",
        state=TaskState(name=state),
        issue_type=issue_type,
        **kwargs,
    )


def test_build_doc_chat_prompt_names_target_and_preserves_visual_language():
    prompt = build_doc_chat_prompt(
        doc_rel_path="spec/x/LLD.html",
        user_input="make the risk section red",
    )

    # The exact target file is named and edit-in-place is required.
    assert "spec/x/LLD.html" in prompt
    assert "in place" in prompt
    assert "visual design language" in prompt
    assert "sticky header" in prompt
    assert "clickable SVG diagram" in prompt
    assert "requirement-trace table" in prompt
    assert "file change-map tree" in prompt
    assert "acceptance-signal callout" in prompt
    # The user's change request is folded in.
    assert "make the risk section red" in prompt


def test_build_doc_chat_prompt_asks_when_no_user_input():
    prompt = build_doc_chat_prompt(doc_rel_path="LLD.html")

    assert "LLD.html" in prompt
    assert "asking the user" in prompt.lower()


def test_build_doc_chat_prompt_forbids_creating_new_docs():
    prompt = build_doc_chat_prompt(doc_rel_path="LLD.html", user_input="tweak it")

    # Edit-in-place, not a new file elsewhere.
    assert "Do not create" in prompt


def test_build_context_prompt_keeps_factual_context_and_tools_neutral():
    prompt = build_context_prompt(_task("Refinement", "Story"))

    assert "Work item context (factual):" in prompt
    assert "Type: Story" in prompt
    assert "Available tools: WorkTracker MCP server; coding agent status tool." in prompt
    assert "Follow the WorkTracker workflow" not in prompt
    assert "Priority:" not in prompt


def test_planning_prompt_does_not_request_work_item_priority():
    prompt = build_planning_context_prompt(
        ModuleSummary(id="module-1", name="Module", project_id="project-1"),
        [],
        "workspace",
        "project-1",
        "/tmp/module",
    )

    assert "appropriate priority" not in prompt


def test_seeded_prompts_are_exposed_for_migration_not_launch_fallbacks(monkeypatch):
    assert "Implement" in DEFAULT_AGENT_PROMPTS
    monkeypatch.setattr(config, "profiles", [])

    prompt = build_context_prompt(_task("Implement", "Implementation"))

    assert DEFAULT_AGENT_PROMPTS["Implement"] not in prompt
    assert "Selected workflow prompt:" not in prompt


def test_profile_default_prompt_is_not_launch_authority(monkeypatch):
    monkeypatch.setattr(
        config,
        "profiles",
        [
            SimpleNamespace(
                agent_prompts={},
                agent_prompt="CUSTOM DEFAULT: follow our operations handbook.",
                workspace_slug="",
                module_folders={},
            )
        ],
    )
    monkeypatch.setattr(config, "current_profile_index", 0)

    prompt = build_context_prompt(_task("A domain-specific state", "Incident"))

    assert "CUSTOM DEFAULT: follow our operations handbook." not in prompt
    assert "Selected workflow prompt:" not in prompt


def test_resolved_binding_prompt_overrides_legacy_profile_prompt():
    profile = SimpleNamespace(
        agent_prompts={"Implement": "LEGACY PROFILE PROMPT"},
        agent_prompt="LEGACY DEFAULT",
        workspace_slug="meml",
        module_folders={"module-1": "/repo"},
    )

    prompt = build_context_prompt(
        _task("Implement", "Implementation"),
        module_id="module-1",
        profile=profile,
        workflow_prompt="RESOLVED TYPE/STATE PROMPT",
    )

    assert "RESOLVED TYPE/STATE PROMPT" in prompt
    assert "LEGACY PROFILE PROMPT" not in prompt
    assert "LEGACY DEFAULT" not in prompt


@pytest.mark.parametrize("issue_type", ["Story", "PathFind", "Implementation"])
def test_type_is_always_visible_in_prompt(issue_type):
    """The work item's Type is printed next to State so type-branching works."""
    prompt = build_context_prompt(_task("Refinement", issue_type))

    assert f"Type: {issue_type}" in prompt


def test_selected_workflow_prompt_is_opaque_over_neutral_framing(monkeypatch):
    """Selected guidance is preserved without injected workflow policy."""
    monkeypatch.setattr(
        config,
        "profiles",
        [
            SimpleNamespace(
                agent_prompts={
                    "Implement": "CUSTOM: use our support-playbook language."
                },
                agent_prompt=None,
                workspace_slug="workspace",
                module_folders={"module-1": "/code/module"},
            )
        ],
    )
    monkeypatch.setattr(config, "current_profile_index", 0)

    prompt = build_context_prompt(
        _task("Implement", "Implementation", sequence_id=1115),
        module_id="module-1",
        additional_prompt="Keep the change local.",
        design_dir="spec/module/T1115--caller-neutral",
        workflow_prompt="CUSTOM: use our support-playbook language.",
    )

    assert "Selected workflow prompt:\nCUSTOM: use our support-playbook language." in prompt
    assert "Task: Launch workflow" in prompt
    assert "Work Item ID: task-1" in prompt
    assert "Project ID: project-1" in prompt
    assert "Workspace Slug: workspace" in prompt
    assert "Module ID: module-1" in prompt
    assert "Local Module Folder: /code/module" in prompt
    assert "State: Implement" in prompt
    assert "Type: Implementation" in prompt
    assert "Additional user instructions:\nKeep the change local." in prompt
    assert "Design directory: spec/module/T1115--caller-neutral" in prompt
    assert "Available tools: WorkTracker MCP server; coding agent status tool." in prompt
    for hidden_policy in (
        "Follow the WorkTracker workflow",
        "Advance state only",
        "software-development",
        "state-retention",
        "move **this child**",
    ):
        assert hidden_policy not in prompt


def test_design_directory_instructions_present_when_dir_given():
    prompt = build_context_prompt(
        _task("Refinement", "Story"),
        design_dir="spec/x/T862--agents-run-the-sdlc-by-prompt",
    )

    assert "Design directory: spec/x/T862--agents-run-the-sdlc-by-prompt" in prompt
    assert "Write every user-reviewable HTML design document" not in prompt


def test_idea_launch_omits_design_directory_block():
    prompt = build_context_prompt(
        _task("Idea", "Story"),
        design_dir="spec/x/T943--example",
    )

    assert "Design directory:" not in prompt
    assert "Write every user-reviewable HTML design document" not in prompt


def test_refinement_launch_keeps_design_directory_block():
    prompt = build_context_prompt(
        _task("Refinement", "Story"),
        design_dir="spec/x/T943--example",
    )

    assert "Design directory: spec/x/T943--example" in prompt


def test_project_binding_wins_for_idea_state(monkeypatch):
    monkeypatch.setattr(
        config,
        "profiles",
        [
            SimpleNamespace(
                agent_prompts={"Idea": "CUSTOM IDEA PROMPT"},
                agent_prompt=None,
                workspace_slug="",
                module_folders={},
            )
        ],
    )
    monkeypatch.setattr(config, "current_profile_index", 0)

    prompt = build_context_prompt(
        _task("Idea", "Story"), workflow_prompt="PROJECT IDEA PROMPT"
    )

    assert "PROJECT IDEA PROMPT" in prompt
    assert "CUSTOM IDEA PROMPT" not in prompt
    assert "This task is in `Idea`" not in prompt


def test_custom_idea_prompt_is_not_supplemented_with_hard_constraints(monkeypatch):
    """A project binding's Idea prompt fully owns its stage guidance."""

    monkeypatch.setattr(
        config,
        "profiles",
        [
            SimpleNamespace(
                agent_prompts={"Idea": "CUSTOM IDEA PROMPT: transition when ready"},
                agent_prompt=None,
                workspace_slug="",
                module_folders={},
            )
        ],
    )
    monkeypatch.setattr(config, "current_profile_index", 0)

    prompt = build_context_prompt(
        _task("Idea", "Story"),
        workflow_prompt="CUSTOM IDEA PROMPT: transition when ready",
    )

    assert "CUSTOM IDEA PROMPT: transition when ready" in prompt
    assert "Hard constraints for the `Idea` stage" not in prompt
    assert "do not create design artifacts or design documents" not in prompt.lower()
    assert "do not make any state or lifecycle change" not in prompt.lower()
    assert "Leave the ticket in `Idea`" not in prompt


def test_custom_non_idea_prompt_gets_no_idea_boundary(monkeypatch):
    monkeypatch.setattr(
        config,
        "profiles",
        [
            SimpleNamespace(
                agent_prompts={"Review": "CUSTOM REVIEW PROMPT"},
                agent_prompt=None,
                workspace_slug="",
                module_folders={},
            )
        ],
    )
    monkeypatch.setattr(config, "current_profile_index", 0)

    prompt = build_context_prompt(
        _task("Review", "Story"), workflow_prompt="CUSTOM REVIEW PROMPT"
    )

    assert "CUSTOM REVIEW PROMPT" in prompt
    assert "Hard constraints for the `Idea` stage" not in prompt


def test_no_design_directory_block_when_dir_absent():
    prompt = build_context_prompt(_task("Refinement", "Story"))

    assert "Design directory:" not in prompt
