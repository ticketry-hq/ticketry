"""Knowable local prerequisites for one configured task launch."""

from __future__ import annotations

import os

from django.db import close_old_connections

from apps.settings_store import config as cfgmod
from apps.settings_store.config import module_link_path, resolve_profile_index
from apps.terminals.agents.registry import UnknownAgent, get_adapter
from apps.terminals.agents.skills.preflight import ResolvedSkills, resolve_required_skills
from apps.terminals.launch_configuration import (
    LaunchConfigurationError,
    ResolvedLaunchConfiguration,
)


def enforce_provider_activation(agent: str) -> frozenset[str]:
    """Refuse a deactivated provider for every launch scope."""

    from worktracker.services.launch_bindings import (
        LaunchBindingError,
        validate_provider_options,
    )
    from worktracker.services.provider_catalog import activated_provider_slugs

    try:
        activated_providers = activated_provider_slugs()
        validate_provider_options(
            agent=agent,
            model=None,
            reasoning=None,
            activated_providers=activated_providers,
        )
    except LaunchBindingError as exc:
        raise LaunchConfigurationError(exc.code) from exc
    finally:
        close_old_connections()
    return activated_providers


def preflight_task_launch(
    *,
    module_id: str,
    launch_configuration: ResolvedLaunchConfiguration,
) -> ResolvedSkills:
    """Validate profile, provider, and skills before a composed state move."""

    agent = launch_configuration.agent
    enforce_provider_activation(agent)
    config = cfgmod.Config()
    profile = config.profiles[resolve_profile_index(config, None)]
    module_folder = module_link_path(profile, module_id)
    cwd = (
        module_folder
        if module_folder and os.path.isdir(module_folder)
        else os.path.expanduser("~")
    )
    try:
        adapter = get_adapter(agent)
    except UnknownAgent:
        raise ValueError("unknown_agent") from None
    return resolve_required_skills(
        provider=agent,
        required_skills=launch_configuration.required_skills,
        cwd=cwd,
        supports_required_skills=adapter.supports_required_skills,
        available_tools=adapter.available_worktracker_tools,
    )
