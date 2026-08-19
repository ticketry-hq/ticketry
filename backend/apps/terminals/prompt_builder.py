"""Spawn-time prompt construction for the terminal consumer.

Turns a validated spawn init into the agent prompt, the run's design directory,
and the cwd, dispatching across the four spawn modes (task / planning / instant
/ doc-chat). The per-mode template strings come from
:mod:`apps.terminals.agents.prompts`; this module is the orchestration that
gathers WorkTracker context, asks Rust where the run may start, and picks the
right template.

Directories are no longer decided here. Rust owns Documents and Worktrees, so
the worktree lookup, the canonical design-directory contract, the registered
document root, and the directory creation that used to live in this module all
moved behind :mod:`apps.terminals.launch_paths_port`. What is left is what the
terminal capability still owns: which template a spawn mode uses, and what
context goes into it.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from apps import worktracker_queries
from apps.settings_store.compatibility import read_config
from apps.settings_store.config import (
    NoConfigurationSelected,
    module_link_path,
    resolve_profile_index,
)
from apps.terminals import launch_paths_port
from apps.terminals.agents.prompts import (
    build_context_prompt,
    build_doc_chat_prompt,
    build_instant_change_prompt,
    build_planning_context_prompt,
)
from apps.terminals.agents.registry import get_adapter
from apps.terminals.launch_paths_port import LaunchPaths, LaunchPathsUnavailable


def _resolve_profile_index() -> Optional[int]:
    cfg = read_config()
    try:
        return resolve_profile_index(cfg, None)
    except NoConfigurationSelected:
        return None


async def _resolve_launch_paths(
    *,
    scope: launch_paths_port.LaunchScope,
    agent_run_id: str,
    project_id: str,
    module_id: Optional[str] = None,
    task_id: Optional[str] = None,
    document_id: Optional[str] = None,
) -> LaunchPaths:
    """Ask Rust where this run may start.

    The port is synchronous loopback HTTP, so it runs in a worker thread. Its
    refusal is deliberately not caught here: launching an agent in a directory
    nobody authorized is worse than reporting that the runtime is unavailable.
    """

    return await asyncio.to_thread(
        launch_paths_port.resolve,
        scope=scope,
        agent_run_id=agent_run_id,
        project_id=project_id,
        module_id=module_id,
        task_id=task_id,
        document_id=document_id,
    )


def _prompt_design_dir(paths: LaunchPaths) -> Optional[str]:
    """The root-relative directory prompt text names, or None.

    Prompts speak the relative contract, and only when the directory actually
    exists — an unresolvable root must not tell an agent to write somewhere.
    """

    if not paths.design_directory:
        return None
    return paths.design_directory_relative


async def _build_prompt(
    profile_index: int,
    *,
    is_planning: bool,
    is_instant: bool,
    instant_prompt: Optional[str],
    project_id: str,
    module_id: str,
    task_id: Optional[str],
    initial_prompt: Optional[str],
    agent_run_id: str,
    is_doc_chat: bool = False,
    doc_rel_path: Optional[str] = None,
    doc_id: Optional[str] = None,
    workflow_prompt: Optional[str] = None,
    agent: str = "claude",
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Returns (prompt, design_dir, cwd, error).

    ``design_dir`` is the absolute design directory Rust authorized for the
    run, or ``None`` when no root could be resolved — launching still proceeds.
    ``cwd`` is the worktree checkout to run in when the task's top-level owner
    has a live worktree (#587), else ``None`` so the caller keeps the
    module-folder cwd. On error, prompt is None and error is a code string.
    """
    config = read_config()
    config.current_profile_index = profile_index
    profile = config.current_profile
    if profile is None:
        return None, None, None, "no_profile_selected"

    if is_doc_chat:
        # #625: a fresh, dedicated agent scoped to one generated document.
        # The document id is a registry primary key, so it pins the exact
        # registered copy the user opened — a task can have the same relative
        # path under more than one root (a worktree and the canonical module
        # folder). The old relative-path fallback is gone: a path is exactly
        # what the compatibility boundary refuses to resolve from.
        if not doc_rel_path:
            return None, None, None, "doc_rel_path_required"
        paths = LaunchPaths()
        if doc_id:
            try:
                paths = await _resolve_launch_paths(
                    scope="docchat",
                    agent_run_id=agent_run_id,
                    project_id=project_id,
                    module_id=module_id,
                    document_id=doc_id,
                )
            except LaunchPathsUnavailable as exc:
                return None, None, None, exc.code
        resolved_rel = paths.document_relative_path or doc_rel_path
        design_abs = paths.design_directory
        cwd = paths.working_directory
        # No registry row / directory gone: degrade to the module folder so
        # the launch still proceeds; the prompt still names the target doc.
        prompt = build_doc_chat_prompt(
            doc_rel_path=resolved_rel,
            module_id=module_id,
            user_input=initial_prompt,
            profile=profile,
        )
        return prompt, design_abs, cwd, None

    if is_instant:
        try:
            modules = await worktracker_queries.get_modules(project_id)
        except Exception as e:
            return None, None, None, f"module_fetch_failed: {e!s}"
        module = next((m for m in modules if m.id == module_id), None)
        if module is None:
            return None, None, None, "module_not_found"
        folder = module_link_path(profile, module_id)
        # An instant run is module-scoped and run-scoped: it keeps its own
        # planning directory and never mints or borrows a task worktree.
        try:
            paths = await _resolve_launch_paths(
                scope="instant",
                agent_run_id=agent_run_id,
                project_id=project_id,
                module_id=module_id,
            )
        except LaunchPathsUnavailable as exc:
            return None, None, None, exc.code
        prompt = build_instant_change_prompt(
            module=module,
            workspace_slug=profile.workspace_slug,
            project_id=project_id,
            folder=folder,
            user_input=instant_prompt or "",
            design_dir=_prompt_design_dir(paths),
            allow_self_termination=get_adapter(agent).supports_worktracker_mcp,
        )
        return prompt, paths.design_directory, None, None

    if is_planning:
        try:
            modules = await worktracker_queries.get_modules(project_id)
        except Exception as e:
            return None, None, None, f"module_fetch_failed: {e!s}"
        module = next((m for m in modules if m.id == module_id), None)
        if module is None:
            return None, None, None, "module_not_found"
        try:
            tasks, _states = await worktracker_queries.get_tasks_and_states(
                project_id, module_id
            )
        except Exception as e:
            return None, None, None, f"task_fetch_failed: {e!s}"
        folder = module_link_path(profile, module_id)
        # Planning is scoped by Agent Run identity, so two independent
        # planning runs never overwrite each other's artifacts.
        try:
            paths = await _resolve_launch_paths(
                scope="plan",
                agent_run_id=agent_run_id,
                project_id=project_id,
                module_id=module_id,
            )
        except LaunchPathsUnavailable as exc:
            return None, None, None, exc.code
        prompt = build_planning_context_prompt(
            module=module,
            tasks=tasks,
            workspace_slug=profile.workspace_slug,
            project_id=project_id,
            folder=folder,
            design_dir=_prompt_design_dir(paths),
            module_dir_name=paths.module_directory_name,
        )
        if initial_prompt:
            prompt = f"{initial_prompt}\n\n{prompt}"
        return prompt, paths.design_directory, None, None

    if not task_id:
        return None, None, None, "task_id_required"
    try:
        details = await worktracker_queries.get_task_details(project_id, task_id)
    except Exception as e:
        return None, None, None, f"task_fetch_failed: {e!s}"

    # W2 (#587) *use-if-exists*: if the owning top-level task has an opt-in
    # worktree, Rust roots the run there — both the agent cwd and the design
    # dir — so generated Design docs ride the branch and land on integrate. A
    # sub-task resolves up to its parent's tree; a missing or stale worktree
    # falls back to the module folder, exactly as before. A launch still never
    # creates one.
    try:
        paths = await _resolve_launch_paths(
            scope="task",
            agent_run_id=agent_run_id,
            project_id=project_id,
            module_id=module_id,
            task_id=task_id,
        )
    except LaunchPathsUnavailable as exc:
        return None, None, None, exc.code

    prompt = build_context_prompt(
        details.task,
        module_id=module_id,
        additional_prompt=initial_prompt,
        design_dir=_prompt_design_dir(paths),
        profile=profile,
        workflow_prompt=workflow_prompt,
    )
    return prompt, paths.design_directory, paths.working_directory, None
