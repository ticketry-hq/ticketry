"""Spawn-time prompt construction for the terminal consumer.

Turns a validated spawn init into the agent prompt, the run's design directory,
and the cwd, dispatching across the four spawn modes (task / planning / instant
/ doc-chat). The per-mode template strings come from
:mod:`apps.terminals.agents.prompts`; this module is the orchestration that
gathers WorkTracker context, resolves the design dir and worktree, and picks the
right template.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

from django.db import close_old_connections

from apps.documents import dao as documents_dao
from apps.documents import design_docs
from apps import worktracker_queries
from apps.terminals.agents.prompts import (
    build_context_prompt,
    build_doc_chat_prompt,
    build_instant_change_prompt,
    build_planning_context_prompt,
)
from apps.terminals.agents.registry import get_adapter
from apps.terminals.dao import SCRATCH_TASK_ID
from apps.worktrees import dao as worktrees_dao
from apps.worktrees import service as worktrees_service


logger = logging.getLogger(__name__)


def _prepare_design_dir(module_folder: Optional[str], rel: str) -> Optional[str]:
    """Create a run's design directory below the module folder (#521).

    :param module_folder: the module's local repo folder, or ``None`` when
        unset/invalid — then the run has no document sourcing.
    :param rel: repo-relative directory from the path contract.
    :return: absolute directory path, or ``None`` when unavailable.
    """

    if not module_folder:
        return None
    try:
        return str(design_docs.ensure_dir(Path(module_folder), rel))
    except OSError as exc:
        logger.warning("design dir creation failed (%s/%s): %s", module_folder, rel, exc)
        return None


def _worktree_root(
    *, task_id: Optional[str], parent_id: Optional[str], module_id: str
) -> Optional[str]:
    """Active worktree checkout for the launch's top-level owner, or None (#587).

    W2 *use-if-exists*: launches never create a worktree (opt-in is W3's Create
    button). A sub-task resolves UP to its parent's tree via W1's
    :func:`apps.worktrees.service.top_level_task_id`; it never gets its own.
    Returns ``None`` when no live tree exists (no opt-in, no repo, or a row left
    stale before reconcile) so the launch falls back to the plain module
    checkout exactly as today. A ``conflict``-status row still has a live tree,
    so it is used — the dev resolves in-worktree on the next launch.

    Runs synchronous ORM (call from a ``to_thread`` worker); closes the thread
    connection on the way out.
    """

    try:
        if not task_id:
            return None
        tlt = worktrees_service.top_level_task_id(
            task_id=task_id, parent_id=parent_id, module_id=module_id
        )
        rec = worktrees_dao.get_by_task(tlt)
        if rec is None or not os.path.isdir(rec.path):
            return None
        return rec.path
    finally:
        close_old_connections()


async def _build_prompt(
    *,
    is_planning: bool,
    is_instant: bool,
    instant_prompt: Optional[str],
    project_id: str,
    module_id: str,
    task_id: Optional[str],
    initial_prompt: Optional[str],
    agent_run_id: str,
    module_folder: Optional[str],
    is_doc_chat: bool = False,
    doc_rel_path: Optional[str] = None,
    doc_id: Optional[str] = None,
    persist_task_id: Optional[str] = None,
    workflow_prompt: Optional[str] = None,
    agent: str = "claude",
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Returns (prompt, design_dir, cwd, error).

    ``design_dir`` is the absolute created design directory for the run, or
    ``None`` when the module folder is unset — launching still proceeds.
    ``cwd`` is the worktree checkout to run in when the task has a live
    worktree (#587), else ``None`` so the caller keeps the module-folder cwd.
    On error, prompt is None and error is a code string.
    """
    if is_doc_chat:
        # #625: a fresh, dedicated agent scoped to one generated document.
        # The frontend's doc_rel_path is relative to the doc's design dir
        # (root_dir); the registry is the source of truth for where that
        # directory lives (module folder or a worktree). Running there gives
        # the #521 watcher live-reload for free.
        if not doc_rel_path:
            return None, None, None, "doc_rel_path_required"
        # Resolve the doc's design dir (root_dir). The document id is a PK,
        # so it pins the exact registered copy the user opened — a task can
        # have the same rel_path under more than one root (a worktree and
        # the canonical module folder). Fall back to the (task, module,
        # rel_path) key only when no id is carried.
        root_dir: Optional[str] = None
        resolved_rel = doc_rel_path
        if doc_id:
            row = await documents_dao.get_document(doc_id)
            if row is not None:
                root_dir = row.root_dir
                resolved_rel = row.rel_path
        if root_dir is None:
            lookup_task_id = persist_task_id or task_id or SCRATCH_TASK_ID
            root_dir = await documents_dao.get_document_root(
                task_id=lookup_task_id,
                module_id=module_id,
                rel_path=doc_rel_path,
            )
        design_abs: Optional[str] = None
        cwd: Optional[str] = None
        if root_dir and os.path.isdir(root_dir):
            design_abs = root_dir
            cwd = root_dir
        # No registry row / directory gone: degrade to the module folder so
        # the launch still proceeds; the prompt still names the target doc.
        prompt = build_doc_chat_prompt(
            doc_rel_path=resolved_rel,
            module_id=module_id,
            user_input=initial_prompt,
            resolved_module_folder=module_folder,
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
        design_rel = design_docs.planning_design_dir(module, agent_run_id)
        design_abs = _prepare_design_dir(module_folder, design_rel)
        prompt = build_instant_change_prompt(
            module=module,
            project_id=project_id,
            folder=module_folder,
            user_input=instant_prompt or "",
            design_dir=design_rel if design_abs else None,
            allow_self_termination=get_adapter(agent).supports_worktracker_mcp,
        )
        return prompt, design_abs, None, None

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
        design_rel = design_docs.planning_design_dir(module, agent_run_id)
        design_abs = _prepare_design_dir(module_folder, design_rel)
        prompt = build_planning_context_prompt(
            module=module,
            tasks=tasks,
            project_id=project_id,
            folder=module_folder,
            design_dir=design_rel if design_abs else None,
        )
        if initial_prompt:
            prompt = f"{initial_prompt}\n\n{prompt}"
        return prompt, design_abs, None, None

    if not task_id:
        return None, None, None, "task_id_required"
    try:
        details = await worktracker_queries.get_task_details(project_id, task_id)
    except Exception as e:
        return None, None, None, f"task_fetch_failed: {e!s}"

    # W2 (#587): if the owning top-level task has an opt-in worktree, root
    # the run there — both the agent cwd and the design dir — so generated
    # Design docs ride the branch and land on integrate. A sub-task
    # resolves up to its parent's tree; no worktree → the module folder,
    # exactly as before. One root substitution re-homes both together.

    cwd: Optional[str] = None
    root = module_folder
    if module_folder:
        worktree_root = await asyncio.to_thread(
            _worktree_root,
            task_id=task_id,
            parent_id=details.task.parent_id,
            module_id=module_id,
        )
        if worktree_root:
            root = worktree_root
            cwd = worktree_root

    # The canonical task dir needs the module's name; a module lookup
    # failure only degrades document sourcing, never the launch.

    design_abs: Optional[str] = None
    design_rel: Optional[str] = None
    if root:
        try:
            modules = await worktracker_queries.get_modules(project_id)
            module = next((m for m in modules if m.id == module_id), None)
            if module is not None:
                design_rel = design_docs.resolve_task_design_dir(
                    Path(root), module, details.task
                )
                design_abs = _prepare_design_dir(root, design_rel)
        except Exception as exc:
            logger.warning("design dir resolution failed: %s", exc)
    prompt = build_context_prompt(
        details.task,
        module_id=module_id,
        additional_prompt=initial_prompt,
        design_dir=design_rel if design_abs else None,
        resolved_module_folder=module_folder,
        workflow_prompt=workflow_prompt,
    )
    return prompt, design_abs, cwd, None
