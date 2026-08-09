"""Application-owned agent launch and explicit terminal cleanup.

The *launch half* of the WS terminal spawn path, lifted out of
``terminals.consumers._spawn_persisted`` into a single module-level callable so
the human WebSocket flow and programmatic launches share one path. :func:`_launch`
injects per-agent lifecycle
hooks, asks the persistence service to record the launch, creates the detached
terminal through the public runtime, and starts the design-dir document watcher — then
returns the run id. On a persistence/runtime failure it deletes the inserted row
and raises :class:`LaunchUnavailable`, so no caller can leak an orphan run.

Viewer attachment is owned separately by :mod:`apps.terminals.viewer_attachments`;
:func:`_launch` never handles transport or viewer policy.

Dependencies point one way: ``consumers`` imports from here; this module never
imports ``consumers``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
import uuid
from dataclasses import dataclass
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
    UnknownAgent,
    cleanup_temporary_artifacts,
    cleanup_temporary_artifacts_for_run,
    create_temporary_artifact_root,
    get_adapter,
)
from apps.terminals.agents.skills.preflight import (
    RequiredSkillUnavailable,
    ResolvedSkills,
    resolve_required_skills,
    skill_prompt_envelope,
)
from apps.documents import watch as documents_watch
from apps.runs.bus import publish_backend_session_sync, publish_document, publish_status
from apps.settings_store import config as cfgmod
from apps.settings_store.config import NoConfigurationSelected, module_link_path
from apps.terminals.launch_configuration import (
    LaunchConfigurationError,
    ResolvedLaunchConfiguration,
    resolve_task_launch_configuration,
)
from apps.terminals.persistence import (
    LaunchRecords,
    compensate_launch,
    load_resume_launch,
    persist_launch,
    persist_termination,
    termination_context,
)
from apps.terminals.prompt_builder import _build_prompt, _resolve_profile_index
from apps.terminals.runtime import (
    CreateTerminal,
    TerminalDimensions,
    TerminalRuntime,
    TmuxTerminalRuntime,
)
from studio_server.atomic_files import atomic_write_bytes
from studio_server.contracts import AgentLifecycleFrame, RunRecord

logger = logging.getLogger(__name__)

_APPROVED_AGENT_PATHS = {
    "claude": "MUXED_APPROVED_CLAUDE_PATH",
    "agy": "MUXED_APPROVED_AGY_PATH",
    "codex": "MUXED_APPROVED_CODEX_PATH",
    "gemini": "MUXED_APPROVED_GEMINI_PATH",
}

# tmux rejects a shell-command once its control message grows too large. Keep
# direct commands comfortably below that boundary; large prompts are executed
# from a private run-scoped wrapper instead.
_TMUX_DIRECT_COMMAND_MAX_BYTES = 8 * 1024
_INITIAL_TERMINAL_DIMENSIONS = TerminalDimensions(columns=80, rows=24)

# Application callers depend on the public runtime protocol.  Tests replace
# this instance with the in-memory runtime or a recording fake.
terminal_runtime: TerminalRuntime = TmuxTerminalRuntime()


@dataclass(frozen=True)
class LaunchIntent:
    """Application inputs for preparing one agent launch."""

    agent: str | None
    project_id: str
    module_id: str | None
    task_id: str
    issue_id: str | None = None
    scope: str = "task"
    initial_prompt: str | None = None
    doc_rel_path: str | None = None
    doc_id: str | None = None
    launch_configuration: ResolvedLaunchConfiguration | None = None

    def __post_init__(self) -> None:
        if self.issue_id is None:
            object.__setattr__(self, "issue_id", self.task_id)


def _enforce_provider_activation(agent: str) -> frozenset[str]:
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


def _prepare_runtime_command(
    agent_run_id: str, argv: list[str]
) -> tuple[str, tuple[Path, ...]]:
    """Return a runtime-safe command and any run-scoped artifacts it owns."""

    command = shlex.join(argv)
    if len(command.encode("utf-8")) <= _TMUX_DIRECT_COMMAND_MAX_BYTES:
        return command, ()

    root = create_temporary_artifact_root(agent_run_id)
    script = root / "launch.sh"
    try:
        atomic_write_bytes(
            script,
            f"#!/bin/sh\nexec {command}\n".encode("utf-8"),
            mode=0o700,
        )
    except BaseException:
        cleanup_temporary_artifacts((root,))
        raise
    return shlex.quote(str(script)), (root,)


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

    Raised when persistence or runtime creation fails. :func:`_launch`
    terminates any partial runtime and deletes orphan application rows before
    raising, so callers receive one application-level launch failure.
    """


class ResumeUnavailable(Exception):
    """The requested historical provider conversation cannot be resumed."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


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
    provider_session_id: Optional[str] = None,
    resolved_skills: ResolvedSkills | None = None,
) -> str:
    """Persist and start one agent run inside a detached terminal runtime.

    The single shared launch path for WebSocket and programmatic callers. All
    inputs are already-built
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
    :raises LaunchUnavailable: on persistence/runtime failure; the orphan row is
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
        augmentation = adapter.augment_launch(
            argv,
            agent_run_id,
            lifecycle_url=lifecycle_url,
            mcp_url=mcp_url,
            skills=resolved_skills,
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
        *(str(item) for item in augmentation.argv),
    ]
    try:
        command, command_artifacts = _prepare_runtime_command(
            agent_run_id, final_argv
        )
    except Exception as exc:
        cleanup_temporary_artifacts(augmentation.temporary_artifacts)
        raise LaunchUnavailable(f"could not prepare runtime command: {exc}") from exc
    temporary_artifacts = (
        *augmentation.temporary_artifacts,
        *command_artifacts,
    )

    try:
        routing = await asyncio.to_thread(
            persist_launch,
            LaunchRecords(
                agent_run_id=agent_run_id,
                issue_id=issue_id,
                agent=agent,
                started_at=started_at,
                cwd=cwd,
                design_dir=design_dir,
                resumed_from=resumed_from,
                scope=scope,
                doc_rel_path=doc_rel_path,
                provider_session_id=provider_session_id,
            ),
        )
        await asyncio.to_thread(
            terminal_runtime.create,
            CreateTerminal(
                agent_run_id=agent_run_id,
                command=command,
                working_directory=cwd,
                environment=dict(augmentation.environment),
                dimensions=_INITIAL_TERMINAL_DIMENSIONS,
            ),
        )
    except Exception as exc:
        # Runtime creation can fail after making a partial terminal. Explicitly
        # compensate both sides; terminate is idempotent when nothing exists.
        logger.exception("terminal launch failed run=%s", agent_run_id)
        try:
            await asyncio.to_thread(terminal_runtime.terminate, agent_run_id)
        except Exception:
            logger.warning(
                "terminal launch compensation failed run=%s",
                agent_run_id,
                exc_info=True,
            )
        try:
            await asyncio.to_thread(compensate_launch, agent_run_id)
        except Exception:
            pass
        cleanup_temporary_artifacts(temporary_artifacts)
        raise LaunchUnavailable(str(exc)) from exc

    # The run row exists and the agent is live inside tmux: tell connected
    # /ws/status clients about the spawn (or resume — it shares this path)
    # NOW, instead of leaving them blind until the first hook event (#979).
    # The same state is persisted above so a snapshot or page reload cannot
    # regress this live run to the deliberately hidden `unknown` state.
    await publish_status(
        routing.project_id,
        AgentLifecycleFrame(
            at=started_at,
            run=RunRecord(
                agent_run_id=agent_run_id,
                project_id=routing.project_id,
                task_id=routing.task_id,
                module_id=routing.module_id,
                agent=agent,
                scope=scope,
                started_at=started_at,
                state="starting",
                updated_at=started_at,
            ),
        ).model_dump(),
    )

    # Watch the run's design directory for generated HTML for the rest of the
    # run (#521).
    async def publish_document_frame(frame: dict) -> None:
        await publish_document(routing.project_id, frame)

    documents_watch.start_watch(
        agent_run_id=agent_run_id,
        design_dir=design_dir,
        module_id=routing.module_id,
        task_id=routing.task_id,
        scope=scope,
        publish=publish_document_frame,
    )

    return agent_run_id


async def launch_agent_run(intent: LaunchIntent) -> str:
    """Prepare provider policy and create a persisted terminal-backed run."""

    launch_configuration = intent.launch_configuration
    effective_agent = intent.agent
    if intent.scope == "task" and launch_configuration is None:
        launch_configuration = await asyncio.to_thread(
            resolve_task_launch_configuration,
            intent.task_id,
            agent_override=intent.agent,
        )
    if launch_configuration is not None:
        effective_agent = launch_configuration.agent
    if effective_agent is None:
        raise ValueError("unknown_agent")
    activated_providers = await asyncio.to_thread(
        _enforce_provider_activation, effective_agent
    )

    profile_index = _resolve_profile_index()
    if profile_index is None:
        raise NoConfigurationSelected("No profile selected.")
    profile = cfgmod.Config().profiles[profile_index]
    module_folder: Optional[str] = module_link_path(profile, intent.module_id)
    if module_folder and not os.path.isdir(module_folder):
        module_folder = None
    cwd = module_folder or os.path.expanduser("~")
    agent_run_id = uuid.uuid4().hex

    try:
        adapter = get_adapter(effective_agent)
    except UnknownAgent:
        raise ValueError("unknown_agent") from None
    required_skills = (
        launch_configuration.required_skills
        if launch_configuration is not None
        else ()
    )
    prompt, design_dir, worktree_cwd, err = await _build_prompt(
        profile_index,
        is_planning=intent.scope == "plan",
        is_instant=intent.scope == "instant",
        instant_prompt=intent.initial_prompt if intent.scope == "instant" else None,
        project_id=intent.project_id,
        module_id=intent.module_id,
        task_id=None if intent.scope in {"plan", "instant"} else intent.task_id,
        initial_prompt=None if intent.scope == "instant" else intent.initial_prompt,
        agent_run_id=agent_run_id,
        module_folder=module_folder,
        is_doc_chat=intent.scope == "docchat",
        doc_rel_path=intent.doc_rel_path,
        doc_id=intent.doc_id,
        persist_task_id=intent.task_id,
        workflow_prompt=(
            launch_configuration.prompt
            if launch_configuration is not None
            else None
        ),
        agent=effective_agent,
    )
    if err is not None:
        if err == "no_profile_selected":
            raise NoConfigurationSelected("No profile selected.")
        raise ValueError(err)
    if worktree_cwd:
        cwd = worktree_cwd

    resolved_skills = await asyncio.to_thread(
        resolve_required_skills,
        provider=effective_agent,
        required_skills=required_skills,
        cwd=cwd,
        supports_required_skills=adapter.supports_required_skills,
        available_tools=adapter.available_worktracker_tools,
    )
    envelope = skill_prompt_envelope(resolved_skills)
    if envelope:
        prompt = f"{prompt}\n\n{envelope}"
    argv = adapter.command(
        prompt,
        model=(
            launch_configuration.model if launch_configuration is not None else None
        ),
        reasoning=(
            launch_configuration.reasoning
            if launch_configuration is not None
            else None
        ),
        activated_providers=activated_providers,
    )
    return await _launch(
        adapter=adapter,
        issue_id=intent.issue_id,
        argv=argv,
        cwd=cwd,
        design_dir=design_dir,
        scope=intent.scope,
        doc_rel_path=intent.doc_rel_path,
        agent_run_id=agent_run_id,
        resolved_skills=resolved_skills,
    )


def terminate_agent_run(agent_run_id: str) -> None:
    """Explicitly terminate runtime mechanics, then persist application state."""

    ended_at = datetime.now(timezone.utc).isoformat()
    context = termination_context(agent_run_id)
    terminal_runtime.terminate(agent_run_id)
    cleanup_temporary_artifacts_for_run(agent_run_id)
    if not context.was_active:
        return
    documents_watch.stop_watch(agent_run_id)
    persist_termination(agent_run_id, ended_at=ended_at)
    if context.project_id:
        publish_backend_session_sync(
            context.project_id, agent_run_id, "exited", at=ended_at
        )


async def resume_provider_conversation(agent_run_id: str) -> str:
    """Continue one ended provider conversation in a fresh persisted launch.

    The application loads historical launch context and prepares the
    provider-native resume argv. The terminal runtime receives only the new
    run handle and prepared terminal inputs; it is never given the old run,
    terminal session, or provider conversation as a separate concept.
    """

    facts = await asyncio.to_thread(load_resume_launch, agent_run_id)
    if facts is None:
        raise ResumeUnavailable("unknown_run")
    if facts.ended_at is None:
        raise ResumeUnavailable("run_still_active")
    if not facts.provider_session_id:
        raise ResumeUnavailable("no_provider_session_id")
    if not facts.cwd or not os.path.isdir(facts.cwd):
        raise ResumeUnavailable("cwd_missing")

    adapter = get_adapter(facts.agent)
    argv = adapter.resume_command(facts.provider_session_id)
    new_run_id = uuid.uuid4().hex
    return await _launch(
        adapter=adapter,
        issue_id=facts.issue_id,
        argv=argv,
        cwd=facts.cwd,
        design_dir=facts.design_dir,
        scope=facts.scope,
        doc_rel_path=None,
        agent_run_id=new_run_id,
        # Provider identity is the sole resume continuity persisted onto the
        # new run. The old AgentRun and terminal session remain historical.
        provider_session_id=facts.provider_session_id,
        resolved_skills=ResolvedSkills((), (), frozenset(), ""),
    )
