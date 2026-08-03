"""Shared agent launch primitive (ticket #714, parent #707).

The *launch half* of the WS terminal spawn path, lifted out of
``terminals.consumers._spawn_persisted`` into a single module-level callable so
the human WebSocket flow and the Session seam's programmatic ``spawn``
(``apps.terminals.session``, T800) share one launch path. :func:`_launch`
injects per-agent lifecycle
hooks, persists the ``AgentRun`` row, creates the detached tmux session (which
runs the agent command), and starts the design-dir document watcher — then
returns the run id. On a persist/tmux failure it deletes the just-inserted row
and raises :class:`LaunchUnavailable`, so no caller can leak an orphan run.

The *viewer half* (PTY spawn, ``PtySession``, client-size refresh, pump) stays
in the consumer; :func:`_launch` never touches ``cols``/``rows`` or ``self``.

Dependencies point one way: ``consumers`` imports from here; this module never
imports ``consumers``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from django.db import close_old_connections

from apps.terminals.agents.injectors import (
    DEFAULT_LIFECYCLE_URL,
    DEFAULT_MCP_URL,
    lifecycle_url_for_port,
)
from apps.terminals.agents.registry import (
    AgentAdapter,
    LaunchAugmentation,
    cleanup_temporary_artifacts,
)
from apps.terminals.agents.skills.preflight import (
    RequiredSkillUnavailable,
    ResolvedSkills,
)
from apps.terminals.dao.constants import SCRATCH_TASK_ID
from apps.documents import watch as documents_watch
from apps.runs.bus import publish_document, publish_status
from apps.runs.models import AgentRun
from apps.terminals.tmux import sessions as tmux_sessions
from studio_server.contracts import AgentLifecycleFrame, RunRecord
from worktracker.models import Issue

logger = logging.getLogger(__name__)
tmux = tmux_sessions

_APPROVED_AGENT_PATHS = {
    "claude": "MUXED_APPROVED_CLAUDE_PATH",
    "agy": "MUXED_APPROVED_AGY_PATH",
    "codex": "MUXED_APPROVED_CODEX_PATH",
    "gemini": "MUXED_APPROVED_GEMINI_PATH",
}


def _env_url(name: str) -> Optional[str]:
    """Return a configured URL, treating a blank value as unset.

    ``os.getenv(name, default)`` keeps an explicitly empty value, and an empty
    lifecycle URL is worse than a wrong one: Claude's env-based hook repairs it
    with its own fallback, but the argv-based agents are handed
    ``--lifecycle-url ''`` and post nowhere, silently (#1462).
    """

    value = os.getenv(name)
    return value.strip() or None if value else None


def _resolve_lifecycle_url() -> str:
    """Resolve the ingress URL this run's hooks should report to.

    Prefers an explicit ``MUXED_LIFECYCLE_URL`` (the packaged sidecar sets it
    from the port it bound). Failing that, derives the URL from the port the
    backend was actually started on, so a backend on a non-default port is still
    addressed correctly rather than silently falling back to the default port.
    """

    explicit = _env_url("MUXED_LIFECYCLE_URL")
    if explicit:
        return explicit

    port = _env_url("MUXED_BACKEND_PORT")
    if port and port.isdigit():
        return lifecycle_url_for_port(port)

    return DEFAULT_LIFECYCLE_URL


def _approved_agent_argv(agent: str, argv: list[str]) -> list[str]:
    """Replace the named agent command with the Rust-approved absolute path.

    The desktop supervisor supplies these variables only from its validated
    discovery service. Development leaves them unset, preserving the existing
    local workflow without creating a webview-controlled command channel.
    """

    approved = os.getenv(_APPROVED_AGENT_PATHS[agent])
    if approved is None:
        return argv
    path = Path(approved)
    if not path.is_absolute() or path.name != agent:
        raise LaunchUnavailable(f"desktop supplied an invalid approved {agent} path")
    return [str(path), *argv[1:]]


class LaunchUnavailable(Exception):
    """The persisted launch could not complete.

    Raised when the persist/create worker fails (tmux missing/broken or the DB
    write failed). :func:`_launch` deletes the orphan ``AgentRun`` row before
    raising, so callers decide only whether to fall back (the WS consumer) or
    let it propagate (the Session seam's ``spawn``, T800).
    """


def _delete_agent_run(run_id: str) -> None:
    """Remove an agent_runs row left orphaned by a failed tmux create.

    Runs in an ``asyncio.to_thread`` worker; the direct sync ORM delete
    replaces the old SQLAlchemy ``asyncio.run`` bridge. The thread
    connection is closed before returning.
    """

    try:
        AgentRun.objects.filter(id=run_id).delete()
    finally:
        close_old_connections()


async def _launch(
    *,
    adapter: AgentAdapter,
    issue_id: str,
    argv: list[str],
    cwd: str,
    design_dir: Optional[str],
    scope: str,
    doc_rel_path: Optional[str],
    agent_run_id: str,
    resumed_from: Optional[str] = None,
    resolved_skills: ResolvedSkills | None = None,
) -> str:
    """Persist and start one agent run inside a detached tmux session.

    The single shared launch path for both the WS consumer and the Session
    seam's programmatic ``spawn`` (T800). All inputs are already-built
    launch facts the caller computed; no ``self``, ``profile``, ``init`` dict,
    or ``cols``/``rows`` cross the boundary.

    :param adapter: the already-selected agent adapter. Its slug is the
        authoritative agent identity for executable approval, injection,
        persistence, and tmux metadata.
    :param argv: the raw agent command *before* hook injection.
    :param design_dir: absolute design directory to record and watch (#521), or
        ``None`` when the module folder is unset.
    :param scope: run scope (``"task"`` / ``"plan"`` / ``"instant"`` /
        ``"docchat"``).
    :param issue_id: the task or module Issue anchoring the run.
    :param agent_run_id: pre-minted, non-null run id (callers mint it upstream).
    :return: ``agent_run_id`` — the persisted, live run.
    :raises LaunchUnavailable: on persist/tmux failure; the orphan row is
        deleted before the raise so no run leaks.
    """

    started_at = datetime.now(timezone.utc).isoformat()
    agent = adapter.slug

    # Wire this run's lifecycle hooks (and MCP config) through the agent's one
    # already-selected adapter. launch.py stays the single URL-resolution point:
    # it reads the environment here and hands the adapter explicit URLs
    # (adapters are env-free). Carrying the adapter itself keeps agent identity
    # and argv transformation in one route.
    lifecycle_url = _resolve_lifecycle_url()
    mcp_url = _env_url("WORKTRACKER_MCP_URL") or DEFAULT_MCP_URL
    argv = _approved_agent_argv(agent, argv)
    resolved_skills = resolved_skills or ResolvedSkills((), (), frozenset(), "")
    try:
        if hasattr(adapter, "augment_launch"):
            augmentation = adapter.augment_launch(
                argv,
                agent_run_id,
                lifecycle_url=lifecycle_url,
                mcp_url=mcp_url,
                skills=resolved_skills,
            )
        else:
            augmentation = LaunchAugmentation(
                tuple(
                    adapter.inject(
                        argv,
                        agent_run_id,
                        lifecycle_url=lifecycle_url,
                        mcp_url=mcp_url,
                    )
                )
            )
    except RequiredSkillUnavailable:
        raise
    except Exception as exc:
        if resolved_skills.requested:
            raise RequiredSkillUnavailable(
                provider=agent,
                skill=resolved_skills.requested[0],
                reason="launch_configuration_failed",
                message="The provider lifecycle or MCP configuration could not be created.",
            ) from exc
        raise
    # Ticketry is often launched by an agent host that sets NO_COLOR for its
    # own captured output. Do not leak that host-only preference into the
    # interactive agent terminal, whose tmux/libghostty path advertises color.
    final_argv = [
        "env",
        "-u",
        "NO_COLOR",
        *(f"{name}={value}" for name, value in augmentation.environment),
        *(str(item) for item in augmentation.argv),
    ]
    command = shlex.join(final_argv)

    run = AgentRun(
        id=agent_run_id,
        issue_id=issue_id,
        agent=agent,
        status="running",
        started_at=started_at,
        lifecycle_state="starting",
        lifecycle_updated_at=started_at,
        cwd=cwd,
        design_dir=design_dir,
        resumed_from=resumed_from,
        scope=scope,
    )

    def _persist_and_create() -> tuple[str, str, str | None]:
        # Runs in a to_thread worker: direct sync ORM insert then
        # create_session, which runs the agent command inside tmux and
        # writes its own terminal-session row. Close the thread connection.
        try:
            issue = Issue.objects.only("id", "project_id", "module_id").get(
                id=issue_id
            )
            project_id = str(issue.project_id)
            module_id = str(issue.module_id or issue.id)
            task_id = str(issue.id) if issue.module_id else None
            run.save(force_insert=True)
            tmux_sessions.create_session(
                agent_run_id=agent_run_id,
                task_id=task_id or SCRATCH_TASK_ID,
                module_id=module_id,
                project_id=project_id,
                agent=agent,
                command=command,
                cwd=cwd,
                scope=scope,
                doc_rel_path=doc_rel_path,
            )
            return project_id, module_id, task_id
        finally:
            close_old_connections()

    try:
        project_id, module_id, task_id = await asyncio.to_thread(
            _persist_and_create
        )
    except Exception as exc:
        # tmux missing/broken, or persistence failed — delete the half-created
        # row so no orphan remains, then signal the caller to decide.
        logger.exception("terminal launch failed run=%s", agent_run_id)
        try:
            await asyncio.to_thread(_delete_agent_run, agent_run_id)
        except Exception:
            pass
        cleanup_temporary_artifacts(augmentation.temporary_artifacts)
        raise LaunchUnavailable(str(exc)) from exc

    # The run row exists and the agent is live inside tmux: tell connected
    # /ws/status clients about the spawn (or resume — it shares this path)
    # NOW, instead of leaving them blind until the first hook event (#979).
    # The same state is persisted above so a snapshot or page reload cannot
    # regress this live run to the deliberately hidden `unknown` state.
    await publish_status(
        project_id,
        AgentLifecycleFrame(
            at=started_at,
            run=RunRecord(
                agent_run_id=agent_run_id,
                task_id=task_id,
                module_id=module_id,
                scope=scope,
                state="starting",
                updated_at=started_at,
            ),
        ).model_dump(),
    )

    # Watch the run's design directory for generated HTML for the rest of the
    # run (#521).
    async def publish_document_frame(frame: dict) -> None:
        await publish_document(project_id, frame)

    documents_watch.start_watch(
        agent_run_id=agent_run_id,
        design_dir=design_dir,
        module_id=module_id,
        task_id=task_id,
        scope=scope,
        publish=publish_document_frame,
    )

    return agent_run_id
