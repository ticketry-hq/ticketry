"""Deep session seam for agent terminal runs."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from asgiref.sync import async_to_sync
from django.db import close_old_connections

from apps.documents import watch as documents_watch
from apps.settings_store import config as cfgmod
from apps.settings_store.config import NoConfigurationSelected, module_link_path
from apps.runs.models import AgentRun
from apps.runs.bus import publish_backend_session_sync
from apps.terminals.agents.registry import (
    UnknownAgent,
    cleanup_temporary_artifacts_for_run,
    get_adapter,
    reconcile_temporary_artifacts,
)
from apps.terminals.agents.skills.preflight import (
    ResolvedSkills,
    resolve_required_skills,
    skill_prompt_envelope,
)
from apps.terminals.dao import sessions as session_dao
from apps.terminals.launch import LaunchUnavailable, _launch  # noqa: F401 - public seam
from apps.terminals.launch_configuration import (
    LaunchConfigurationError,
    ResolvedLaunchConfiguration,
    resolve_task_launch_configuration,
)
from apps.terminals.models import AgentTerminalSession
from apps.terminals import viewer_leases
from apps.terminals.prompt_builder import _build_prompt, _resolve_profile_index
from apps.terminals.session_registry import (
    PtySession,
    _release_tmux_viewer_sync,
    _replace_tmux_viewer_sync,
)
from apps.terminals.tmux import client as tmux_client
from apps.terminals.tmux import sessions as tmux_sessions
from apps.terminals.tmux._core import TmuxSessionError
from apps.terminals.tmux.metadata import TmuxSession


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LaunchIntent:
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


class SessionNotFound(Exception):
    """No live terminal session exists for the requested run."""


class ResumeUnavailable(Exception):
    """The requested run cannot be resumed."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


TerminalSessionError = TmuxSessionError


class AttachHandle:
    """Prepares and activates one tmux viewer attachment."""

    def __init__(self, *, agent_run_id: str, viewer_id: str, session: TmuxSession):
        self.agent_run_id = agent_run_id
        self.viewer_id = viewer_id
        self.session = session
        self._released = False

    def attach_argv(self) -> list[str]:
        return tmux_client.attach_argv(self.agent_run_id)

    def scroll(self, direction: str, lines: int = 3) -> None:
        tmux_client.scroll(self.agent_run_id, direction, lines)

    def resize(self, cols: int, rows: int) -> None:
        tmux_client.refresh_client_size(self.agent_run_id, cols, rows)

    refresh_client_size = resize

    def activate(self, session: PtySession) -> PtySession | None:
        """Make a fully connected PTY the viewer and return its predecessor."""

        if (
            session.agent_run_id != self.agent_run_id
            or session.session_id != self.viewer_id
        ):
            raise ValueError("PTY session does not belong to this attach handle")
        # The legacy in-memory tmux test seam can attach a fabricated session
        # with no persisted AgentRun. Real control-plane runs always have the
        # row (and therefore always acquire the durable lease).
        if AgentRun.objects.filter(id=self.agent_run_id).exists():
            viewer_leases.acquire(
                agent_run_id=self.agent_run_id,
                viewer_id=self.viewer_id,
                transport="browser",
            )
        return _replace_tmux_viewer_sync(session)

    def release(self) -> None:
        if self._released:
            return
        _release_tmux_viewer_sync(self.agent_run_id, self.viewer_id)
        viewer_leases.release(
            agent_run_id=self.agent_run_id,
            viewer_id=self.viewer_id,
        )
        self._released = True

    def __enter__(self) -> "AttachHandle":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()


def _enforce_provider_activation(agent: str) -> frozenset[str]:
    """Refuse a deactivated provider and return the activation set in force.

    ``resolve_task_launch_configuration`` validates activation only for
    ``scope == "task"``, but the spawn request carries both the scope and the
    provider, so a plan/instant/doc-chat run could name a provider the host
    switched off (ADR-0015 promises such a launch is *blocked*, never silently
    substituted). This runs for every scope. The set it returns is handed to
    the adapter so command construction re-uses this read instead of touching
    the ORM from the async launch path.
    """

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


class TerminalSessionService:
    async def spawn(self, intent: LaunchIntent) -> str:
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
            # Preserve the consumer's error frame: it maps ValueError
            # "unknown_agent" to the dedicated WS close code.
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
            # Preserve the consumer's error frame: it maps ValueError
            # "unknown_agent" to the dedicated WS close code.
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
            agent=effective_agent or "",
        )
        if err is not None:
            if err == "no_profile_selected":
                raise NoConfigurationSelected("No profile selected.")
            raise ValueError(err)
        if worktree_cwd:
            cwd = worktree_cwd
        # Resolve after worktree selection because that directory determines
        # which repository-owned provider skills are visible to the CLI.
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

    async def resume(self, agent_run_id: str) -> str:
        """Resume a terminated provider conversation in a fresh tmux run.

        The provider session already holds the conversation transcript, so this
        path does not rebuild a prompt; it only validates the old run, reuses
        its cwd, and launches a new tmux-backed run with the provider-native
        resume argv.
        """

        def _load_run() -> AgentRun:
            try:
                return AgentRun.objects.get(id=agent_run_id)
            finally:
                close_old_connections()

        try:
            run = await asyncio.to_thread(_load_run)
        except AgentRun.DoesNotExist:
            raise ResumeUnavailable("unknown_run") from None

        if run.ended_at is None:
            raise ResumeUnavailable("run_still_active")
        if not run.provider_session_id:
            raise ResumeUnavailable("no_provider_session_id")
        if not run.cwd or not os.path.isdir(run.cwd):
            raise ResumeUnavailable("cwd_missing")

        adapter = get_adapter(run.agent)
        argv = adapter.resume_command(run.provider_session_id)
        terminal_session = await (
            AgentTerminalSession.objects.filter(agent_run_id=agent_run_id)
            .order_by("-created_at")
            .afirst()
        )
        scope = run.scope
        doc_rel_path = (
            terminal_session.doc_rel_path if terminal_session is not None else None
        )
        new_run_id = uuid.uuid4().hex
        return await _launch(
            adapter=adapter,
            issue_id=str(run.issue_id),
            argv=argv,
            cwd=run.cwd,
            design_dir=run.design_dir,
            scope=scope,
            doc_rel_path=doc_rel_path,
            agent_run_id=new_run_id,
            resumed_from=agent_run_id,
            resolved_skills=ResolvedSkills((), (), frozenset(), ""),
        )

    def terminate(self, agent_run_id: str) -> None:
        ended_at = datetime.now(timezone.utc).isoformat()
        project_id = (
            AgentRun.objects.filter(id=agent_run_id)
            .values_list("issue__project_id", flat=True)
            .first()
        )
        active = (
            AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).exists()
            or AgentRun.objects.filter(id=agent_run_id, ended_at__isnull=True).exists()
        )
        if not active:
            cleanup_temporary_artifacts_for_run(agent_run_id)
            return
        try:
            tmux_sessions.terminate_session(agent_run_id)
        except TmuxSessionError:
            raise
        finally:
            close_old_connections()

        documents_watch.stop_watch(agent_run_id)
        cleanup_temporary_artifacts_for_run(agent_run_id)
        try:
            AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).update(terminated_at=ended_at)
            # Stamp the terminal lifecycle state alongside the terminal status:
            # process exit is authoritative even when a provider has no reliable
            # session-end hook, so reload cannot render a dead run in its last
            # mid-turn state (#1462).
            AgentRun.objects.filter(id=agent_run_id, ended_at__isnull=True).update(
                status="terminated",
                ended_at=ended_at,
                lifecycle_state="exited",
                lifecycle_updated_at=ended_at,
            )
        finally:
            close_old_connections()
        if project_id:
            publish_backend_session_sync(
                str(project_id), agent_run_id, "exited", at=ended_at
            )

    def live_run_for(self, task_id: str) -> AgentRun | None:
        return (
            AgentRun.objects.filter(issue_id=task_id, status="running")
            .order_by("-started_at", "-id")
            .first()
        )

    def sessions_for(self, task_id: str) -> list[AgentTerminalSession]:
        return async_to_sync(session_dao.list_terminal_sessions_for_task)(task_id)

    def attach(
        self, agent_run_id: str, *, viewer_id: str | None = None
    ) -> AttachHandle:
        tmux_session = tmux_sessions.get_session(agent_run_id)
        if tmux_session is None:
            raise SessionNotFound(agent_run_id)
        viewer_id = viewer_id or uuid.uuid4().hex
        return AttachHandle(
            agent_run_id=agent_run_id,
            viewer_id=viewer_id,
            session=tmux_session,
        )

    def reconcile(self) -> tmux_sessions.ReconcileResult:
        result = tmux_sessions.reconcile_sessions()
        try:
            ended_run_ids = [*result.soft_deleted, *result.exited]
            if ended_run_ids:
                ended_at = datetime.now(timezone.utc).isoformat()
                projects = {
                    run_id: str(project_id)
                    for run_id, project_id in AgentRun.objects.filter(
                        id__in=ended_run_ids
                    ).values_list("id", "issue__project_id")
                }
                for agent_run_id in ended_run_ids:
                    documents_watch.stop_watch(agent_run_id)
                    cleanup_temporary_artifacts_for_run(agent_run_id)
                try:
                    # A vanished session or retained dead provider pane is
                    # authoritative: freeze the lifecycle axis so the run
                    # cannot keep rendering its last mid-turn hook state.
                    AgentRun.objects.filter(
                        id__in=ended_run_ids,
                        ended_at__isnull=True,
                    ).update(
                        status="exited",
                        ended_at=ended_at,
                        lifecycle_state="exited",
                        lifecycle_updated_at=ended_at,
                    )
                finally:
                    close_old_connections()
                for agent_run_id in result.soft_deleted:
                    project_id = projects.get(agent_run_id)
                    if project_id:
                        publish_backend_session_sync(
                            project_id, agent_run_id, "lost", at=ended_at
                        )
                for agent_run_id in result.exited:
                    project_id = projects.get(agent_run_id)
                    if project_id:
                        publish_backend_session_sync(
                            project_id, agent_run_id, "exited", at=ended_at
                        )
            active_run_ids = set(
                AgentTerminalSession.objects.filter(terminated_at__isnull=True)
                .exclude(agent_run_id__in=ended_run_ids)
                .values_list("agent_run_id", flat=True)
            )
            reconcile_temporary_artifacts(active_run_ids)
        finally:
            close_old_connections()
        return result


session = TerminalSessionService()
