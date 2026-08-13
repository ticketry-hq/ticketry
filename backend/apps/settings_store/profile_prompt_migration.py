"""One-time import of legacy profile prompts into project launch bindings."""

from __future__ import annotations

import json
from pathlib import Path

from studio_server.atomic_files import atomic_write_json
from worktracker.launch_seeds import default_agent_prompt
from worktracker.workflow_seeds import DEFAULT_WORKFLOW_TEMPLATES


def migrate_profile_prompts(
    config_file: Path,
    *,
    Workspace,
    LaunchBinding,
) -> int:
    """Move current profile prompt overrides to existing project bindings.

    A profile historically applied across its workspace, so its prompt values
    are copied to every existing canonical type/state binding in that
    workspace.  No binding is created here: custom types and states remain
    unconfigured.  Successfully imported prompt fields are then removed from
    the profile document so they cannot remain a second source of authority.
    """

    from django.apps import apps

    if LaunchBinding._meta.apps is apps:
        from apps.settings_store.write_ownership import (
            assert_django_settings_write_allowed,
        )

        assert_django_settings_write_allowed()

    if not config_file.exists():
        return 0
    payload = json.loads(config_file.read_text())
    profiles = payload.get("profiles")
    if not isinstance(profiles, list):
        return 0

    migrated_bindings = 0
    changed_file = False
    canonical_types = tuple(DEFAULT_WORKFLOW_TEMPLATES)
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        state_prompts = profile.get("agent_prompts")
        state_prompts = state_prompts if isinstance(state_prompts, dict) else {}
        default_prompt = profile.get("agent_prompt")
        if not state_prompts and not default_prompt:
            profile.pop("agent_prompt", None)
            profile.pop("agent_prompts", None)
            changed_file = True
            continue

        workspace = Workspace.objects.filter(
            slug=profile.get("workspace_slug", "")
        ).first()
        if workspace is None or not workspace.projects.exists():
            continue

        prompts_by_state = {
            str(name).casefold(): prompt
            for name, prompt in state_prompts.items()
            if isinstance(prompt, str) and prompt
        }
        bindings = LaunchBinding.objects.filter(
            issue_type__project__workspace=workspace,
            issue_type__name__in=canonical_types,
            issue_type__level="task",
        ).select_related("issue_type", "state")
        for binding in bindings:
            seeded_prompt = default_agent_prompt(
                binding.issue_type.name,
                binding.state.name,
            )
            if binding.prompt != seeded_prompt:
                continue
            prompt = prompts_by_state.get(binding.state.name.casefold()) or default_prompt
            if not isinstance(prompt, str) or not prompt or binding.prompt == prompt:
                continue
            binding.prompt = prompt
            binding.save(update_fields=["prompt"])
            migrated_bindings += 1

        profile.pop("agent_prompt", None)
        profile.pop("agent_prompts", None)
        changed_file = True

    if changed_file:
        atomic_write_json(config_file, payload, indent=4)
    return migrated_bindings
