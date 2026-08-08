"""Launch and control first-class structured Chat agent runs.

This module is the transport-neutral counterpart to
``apps.terminals.session``.  It deliberately reuses Ticketry's existing
launch-policy, prompt, worktree, required-skill, lifecycle-hook, and MCP seams,
then branches only at the final transport: Codex runs as ``app-server`` rather
than inside tmux.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from django.conf import settings
from django.db import close_old_connections, transaction

from apps.documents import watch as documents_watch
from apps.runs.bus import publish_status
from apps.runs.chat.codex_runtime import (
    CodexChatRuntime,
    RequestKindMismatchError,
    TurnAlreadyActiveError,
    TurnStartError,
    runtime_registry,
)
from apps.runs.chat.database import chat_database_sync_to_async
from apps.runs.chat.events import append_event
from apps.runs.chat.safety import sanitize_external_message
from apps.runs.models import AgentChatCommand, AgentChatSession, AgentRun
from apps.settings_store import config as cfgmod
from apps.settings_store.config import NoConfigurationSelected, module_link_path
from apps.terminals.agents.registry import (
    LaunchAugmentation,
    UnknownAgent,
    cleanup_temporary_artifacts,
    cleanup_temporary_artifacts_for_run,
    get_adapter,
)
from apps.terminals.agents.skills.preflight import (
    ResolvedSkills,
    resolve_required_skills,
    skill_prompt_envelope,
)
from apps.terminals.launch import (
    _approved_agent_argv,
    _env_url,
    _resolve_lifecycle_url,
)
from apps.terminals.agents.injectors import DEFAULT_MCP_URL
from apps.terminals.launch_configuration import resolve_task_launch_configuration
from apps.terminals.prompt_builder import _build_prompt, _resolve_profile_index
from apps.terminals.session import LaunchIntent, _enforce_provider_activation
from studio_server.contracts import AgentLifecycleFrame, RunRecord
from worktracker.models import Issue


CHAT_PROVIDER = "codex"
INITIAL_TURN_COMMAND_PREFIX = "initial-turn-"


class ChatRunError(RuntimeError):
    """A stable transport-neutral Chat operation rejection."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class PreparedChatLaunch:
    """Facts resolved before the Chat subprocess becomes externally visible."""

    runtime: CodexChatRuntime
    prompt: str
    project_id: str
    module_id: str
    task_id: str | None
    scope: str
    started_at: str
    design_dir: str | None
    augmentation: LaunchAugmentation


def _ticketry_version() -> str:
    spectacular = getattr(settings, "SPECTACULAR_SETTINGS", {})
    return str(spectacular.get("VERSION", "0.1.0"))


def _scope_ids(issue: Issue) -> tuple[str, str, str | None]:
    """Return the status-feed project/module/task identity for one run anchor."""

    project_id = str(issue.project_id)
    if issue.module_id:
        return project_id, str(issue.module_id), str(issue.id)
    return project_id, str(issue.id), None


def _initial_turn_command_id(agent_run_id: str) -> str:
    digest = hashlib.sha256(agent_run_id.encode("utf-8")).hexdigest()
    return f"{INITIAL_TURN_COMMAND_PREFIX}{digest}"


def _persist_launch(
    *,
    agent_run_id: str,
    issue_id: str,
    cwd: str,
    design_dir: str | None,
    scope: str,
    started_at: str,
    initial_prompt: str,
) -> tuple[str, str, str | None, str]:
    """Atomically persist the shared run identity and Chat-owned session row."""

    try:
        with transaction.atomic():
            # Serialize durable Chat ownership with work-item/project delete
            # guards. The process is not started until this transaction and
            # its initial-command audit have committed.
            issue = (
                Issue.objects.select_for_update()
                .get(id=issue_id)
            )
            project_id, module_id, task_id = _scope_ids(issue)
            run = AgentRun.objects.create(
                id=agent_run_id,
                issue=issue,
                agent=CHAT_PROVIDER,
                status="running",
                started_at=started_at,
                lifecycle_state="starting",
                lifecycle_updated_at=started_at,
                cwd=cwd,
                design_dir=design_dir,
                scope=scope,
                run_kind=AgentRun.Kind.CHAT,
            )
            session = AgentChatSession.objects.create(run=run)
            initial_command_id = _initial_turn_command_id(agent_run_id)
            AgentChatCommand.objects.create(
                session=session,
                command_id=initial_command_id,
                command_type="start_turn",
                request_fingerprint=hashlib.sha256(
                    initial_prompt.encode("utf-8")
                ).hexdigest(),
            )
            # Persist the launch intent before app-server startup. A hard
            # backend crash can now reconcile every phase: before thread
            # creation, after an early thread id, or after turn/start write.
            append_event(
                agent_run_id=agent_run_id,
                event_type="thread.message-sent",
                payload={
                    "id": initial_command_id,
                    "role": "user",
                    "text": initial_prompt,
                    "streaming": False,
                    "deliveryState": "pending",
                },
            )
            return project_id, module_id, task_id, initial_command_id
    finally:
        close_old_connections()


def _delete_failed_launch(agent_run_id: str) -> None:
    try:
        AgentRun.objects.filter(id=agent_run_id).delete()
    finally:
        close_old_connections()


async def _await_task_despite_cancellation(task: asyncio.Task[Any]) -> Any:
    """Wait for an ownership-changing worker even after repeated cancellation."""

    while True:
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            if task.done():
                return task.result()


async def _persist_launch_cancellation_safe(
    **kwargs: Any,
) -> tuple[str, str, str | None, str]:
    """Never release the run lock while its DB transaction can still commit."""

    agent_run_id = str(kwargs["agent_run_id"])
    persistence = asyncio.create_task(asyncio.to_thread(_persist_launch, **kwargs))
    try:
        return await asyncio.shield(persistence)
    except asyncio.CancelledError as cancellation:
        persisted = False
        try:
            await _await_task_despite_cancellation(persistence)
            persisted = True
        except Exception:
            # The transaction is atomic, so an unsuccessful worker cannot
            # leave a partial run for a later Stop to miss.
            pass
        if persisted:
            cleanup = asyncio.create_task(
                asyncio.to_thread(_delete_failed_launch, agent_run_id)
            )
            await _await_task_despite_cancellation(cleanup)
        raise cancellation


def _build_app_server_augmentation(
    *,
    agent_run_id: str,
    resolved_skills: ResolvedSkills,
) -> LaunchAugmentation:
    """Apply the exact Codex executable approval, hook, and MCP configuration."""

    adapter = get_adapter(CHAT_PROVIDER)
    argv = _approved_agent_argv(CHAT_PROVIDER, [CHAT_PROVIDER, "app-server"])
    return adapter.augment_launch(
        argv,
        agent_run_id,
        lifecycle_url=_resolve_lifecycle_url(),
        mcp_url=_env_url("WORKTRACKER_MCP_URL") or DEFAULT_MCP_URL,
        skills=resolved_skills,
    )


async def _publish_launch(prepared: PreparedChatLaunch) -> None:
    await publish_status(
        prepared.project_id,
        AgentLifecycleFrame(
            at=prepared.started_at,
            run=RunRecord(
                agent_run_id=prepared.runtime.agent_run_id,
                project_id=prepared.project_id,
                task_id=prepared.task_id,
                module_id=prepared.module_id,
                agent=CHAT_PROVIDER,
                run_kind="chat",
                scope=prepared.scope,
                started_at=prepared.started_at,
                state="starting",
                updated_at=prepared.started_at,
            ),
        ).model_dump(),
    )


class ChatSessionService:
    """Own launch-fact resolution and runtime operations for Chat runs."""

    def __init__(self) -> None:
        self._run_operation_locks: dict[str, asyncio.Lock] = {}
        self._active_runtime_commands: dict[str, asyncio.Task[Any]] = {}
        self._stopping_runs: set[str] = set()

    def _run_operation_lock(self, agent_run_id: str) -> asyncio.Lock:
        # All production operations execute on RuntimeSupervisor's one event
        # loop. ``setdefault`` is synchronous, so competing coroutines for one
        # run always converge on the same lock before either can await.
        return self._run_operation_locks.setdefault(agent_run_id, asyncio.Lock())

    async def spawn(
        self,
        intent: LaunchIntent,
        *,
        agent_run_id: str | None = None,
    ) -> str:
        resolved_run_id = agent_run_id or uuid.uuid4().hex
        return await self._run_runtime_command(
            resolved_run_id,
            lambda: self._spawn_locked(
                intent,
                agent_run_id=resolved_run_id,
            ),
        )

    async def _spawn_locked(
        self,
        intent: LaunchIntent,
        *,
        agent_run_id: str,
    ) -> str:
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
        if effective_agent != CHAT_PROVIDER:
            raise ChatRunError("chat_provider_unsupported")

        await asyncio.to_thread(_enforce_provider_activation, CHAT_PROVIDER)

        profile_index = _resolve_profile_index()
        if profile_index is None:
            raise NoConfigurationSelected("No profile selected.")
        profile = cfgmod.Config().profiles[profile_index]
        module_folder = module_link_path(profile, intent.module_id)
        if module_folder and not os.path.isdir(module_folder):
            module_folder = None
        cwd = module_folder or os.path.expanduser("~")
        try:
            adapter = get_adapter(CHAT_PROVIDER)
        except UnknownAgent:
            raise ChatRunError("chat_provider_unsupported") from None
        required_skills = (
            launch_configuration.required_skills
            if launch_configuration is not None
            else ()
        )

        prompt, design_dir, worktree_cwd, error = await _build_prompt(
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
            workflow_prompt=(
                launch_configuration.prompt
                if launch_configuration is not None
                else None
            ),
            persist_task_id=intent.task_id,
            agent=CHAT_PROVIDER,
        )
        if error is not None:
            if error == "no_profile_selected":
                raise NoConfigurationSelected("No profile selected.")
            raise ChatRunError(error)
        if prompt is None:
            raise ChatRunError("prompt_unavailable")
        if worktree_cwd:
            cwd = worktree_cwd

        resolved_skills = await asyncio.to_thread(
            resolve_required_skills,
            provider=CHAT_PROVIDER,
            required_skills=required_skills,
            cwd=cwd,
            supports_required_skills=adapter.supports_required_skills,
            available_tools=adapter.available_worktracker_tools,
        )
        envelope = skill_prompt_envelope(resolved_skills)
        if envelope:
            prompt = f"{prompt}\n\n{envelope}"

        augmentation = _build_app_server_augmentation(
            agent_run_id=agent_run_id,
            resolved_skills=resolved_skills,
        )
        started_at = datetime.now(timezone.utc).isoformat()
        try:
            project_id, module_id, task_id, initial_command_id = (
                await _persist_launch_cancellation_safe(
                    agent_run_id=agent_run_id,
                    issue_id=str(intent.issue_id),
                    cwd=cwd,
                    design_dir=design_dir,
                    scope=intent.scope,
                    started_at=started_at,
                    initial_prompt=prompt,
                )
            )
        except BaseException:
            cleanup_temporary_artifacts(augmentation.temporary_artifacts)
            raise

        runtime = CodexChatRuntime(
            agent_run_id=agent_run_id,
            argv=augmentation.argv,
            cwd=cwd,
            version=_ticketry_version(),
            model=(
                launch_configuration.model if launch_configuration is not None else None
            ),
            reasoning=(
                launch_configuration.reasoning
                if launch_configuration is not None
                else None
            ),
            env=dict(augmentation.environment),
        )
        prepared = PreparedChatLaunch(
            runtime=runtime,
            prompt=prompt,
            project_id=project_id,
            module_id=module_id,
            task_id=task_id,
            scope=intent.scope,
            started_at=started_at,
            design_dir=design_dir,
            augmentation=augmentation,
        )
        try:
            # Establish the provider thread first.  Publishing the shared
            # ``starting`` frame before starting the turn prevents a fast
            # ``turn/started`` notification from being followed by a stale
            # status regression.
            await runtime_registry.add(runtime)
        except (Exception, asyncio.CancelledError):
            # A failed containment attempt deliberately remains registered so
            # End/Close can retry. Never delete its durable owner or artifacts
            # while that full-access process may still be alive.
            try:
                retained = runtime_registry.get(agent_run_id) is runtime
            except KeyError:
                retained = False
            if not retained:
                await asyncio.to_thread(_delete_failed_launch, agent_run_id)
                cleanup_temporary_artifacts(augmentation.temporary_artifacts)
            raise

        async def publish_document_frame(frame: dict[str, Any]) -> None:
            from apps.runs.bus import publish_document

            await publish_document(project_id, frame)

        # Start the watcher synchronously before yielding the runtime loop.
        # From this point a natural process exit can always tear it down via
        # the registry callback; no dead-runtime watcher can be installed late.
        try:
            documents_watch.start_watch(
                agent_run_id=agent_run_id,
                design_dir=design_dir,
                module_id=module_id,
                task_id=task_id,
                scope=intent.scope,
                publish=publish_document_frame,
            )
            await _publish_launch(prepared)
            try:
                await self._deliver_turn(
                    agent_run_id,
                    prompt,
                    command_id=initial_command_id,
                    message_already_audited=True,
                    runtime=runtime,
                )
            except TurnStartError:
                # The runtime recorded a failed delivery tied to the visible
                # user-message id. The live thread remains available to retry.
                pass
            except Exception as exc:
                # Test doubles and pre-runtime failures cannot record their own
                # delivery audit, so retain the service-level fallback.
                at = datetime.now(timezone.utc).isoformat()
                project_id, record = await chat_database_sync_to_async(
                    self._record_initial_turn_failure
                )(
                    agent_run_id,
                    sanitize_external_message(exc) or exc.__class__.__name__,
                    at,
                )
                await publish_status(
                    project_id,
                    AgentLifecycleFrame(at=at, run=record).model_dump(),
                )
        except asyncio.CancelledError:
            # Once a provider thread exists, launch cancellation may follow a
            # turn/start write. Preserve its durable command/transcript and
            # make the thread resumable rather than deleting the only audit
            # that prevents duplicate autonomous work.
            await runtime_registry.remove(agent_run_id, resumable=True)
            documents_watch.stop_watch(agent_run_id)
            cleanup_temporary_artifacts_for_run(agent_run_id)
            raise
        except Exception:
            await runtime_registry.remove(agent_run_id)
            documents_watch.stop_watch(agent_run_id)
            cleanup_temporary_artifacts_for_run(agent_run_id)
            await asyncio.to_thread(_delete_failed_launch, agent_run_id)
            raise
        return agent_run_id

    async def resume(self, agent_run_id: str) -> str:
        """Reattach a managed app-server process to a durable Codex thread."""

        return await self._run_runtime_command(
            agent_run_id,
            lambda: self._resume_locked(agent_run_id),
        )

    async def _resume_locked(self, agent_run_id: str) -> str:

        try:
            runtime_registry.get(agent_run_id)
        except KeyError:
            pass
        else:
            raise ChatRunError("run_still_active")

        run, provider_thread_id, project_id, module_id, task_id = (
            await chat_database_sync_to_async(self._load_resumable)(agent_run_id)
        )
        if not run.cwd or not os.path.isdir(run.cwd):
            raise ChatRunError("cwd_missing")

        augmentation = _build_app_server_augmentation(
            agent_run_id=agent_run_id,
            resolved_skills=ResolvedSkills((), (), frozenset(), ""),
        )
        runtime = CodexChatRuntime(
            agent_run_id=agent_run_id,
            argv=augmentation.argv,
            cwd=run.cwd,
            version=_ticketry_version(),
            env=dict(augmentation.environment),
            resume_thread_id=provider_thread_id,
        )
        resume_token = uuid.uuid4().hex
        started_at = datetime.now(timezone.utc).isoformat()
        await chat_database_sync_to_async(self._claim_resuming)(
            agent_run_id,
            resume_token,
            started_at,
        )

        async def publish_document_frame(frame: dict[str, Any]) -> None:
            from apps.runs.bus import publish_document

            await publish_document(project_id, frame)

        try:
            await runtime_registry.add(runtime)
        except asyncio.CancelledError:
            try:
                retained = runtime_registry.get(agent_run_id) is runtime
            except KeyError:
                retained = False
            if not retained:
                await chat_database_sync_to_async(self._mark_resume_interrupted)(
                    agent_run_id,
                    resume_token,
                    "Resume was cancelled; the Codex thread remains resumable.",
                )
                cleanup_temporary_artifacts(augmentation.temporary_artifacts)
            raise
        except Exception as exc:
            try:
                retained = runtime_registry.get(agent_run_id) is runtime
            except KeyError:
                retained = False
            if not retained:
                await chat_database_sync_to_async(self._mark_resume_failed)(
                    agent_run_id,
                    resume_token,
                    sanitize_external_message(exc) or exc.__class__.__name__,
                )
                cleanup_temporary_artifacts(augmentation.temporary_artifacts)
            raise

        try:
            documents_watch.start_watch(
                agent_run_id=agent_run_id,
                design_dir=run.design_dir,
                module_id=module_id,
                task_id=task_id,
                scope=run.scope,
                publish=publish_document_frame,
            )
            ready_at = datetime.now(timezone.utc).isoformat()
            owns_claim = await chat_database_sync_to_async(self._mark_resume_ready)(
                agent_run_id,
                resume_token,
                provider_thread_id,
                ready_at,
            )
            if not owns_claim:
                raise ChatRunError("runtime_state_conflict")
            released_claim = await chat_database_sync_to_async(
                self._release_resume_claim
            )(agent_run_id, resume_token)
            if not released_claim:
                raise ChatRunError("runtime_state_conflict")
            await publish_status(
                project_id,
                AgentLifecycleFrame(
                    at=ready_at,
                    run=RunRecord(
                        agent_run_id=agent_run_id,
                        project_id=project_id,
                        module_id=module_id,
                        task_id=task_id,
                        agent=CHAT_PROVIDER,
                        run_kind="chat",
                        scope=run.scope,
                        started_at=run.started_at,
                        state="quiet",
                        updated_at=ready_at,
                    ),
                ).model_dump(),
            )
        except (Exception, asyncio.CancelledError) as exc:
            await runtime_registry.remove(agent_run_id, resumable=True)
            documents_watch.stop_watch(agent_run_id)
            cleanup_temporary_artifacts_for_run(agent_run_id)
            await chat_database_sync_to_async(self._mark_resume_interrupted)(
                agent_run_id,
                resume_token,
                (
                    "Resume was cancelled; the Codex thread remains resumable."
                    if isinstance(exc, asyncio.CancelledError)
                    else sanitize_external_message(exc)
                ),
            )
            raise
        return agent_run_id

    async def read(self, agent_run_id: str) -> None:
        runtime = self._runtime(agent_run_id)
        await runtime.read_thread()

    async def send_turn(
        self,
        agent_run_id: str,
        prompt: str,
        *,
        command_id: str | None = None,
    ) -> str:
        return await self._run_runtime_command(
            agent_run_id,
            lambda: self._send_turn_locked(
                agent_run_id,
                prompt,
                command_id=command_id,
            ),
        )

    async def _send_turn_locked(
        self,
        agent_run_id: str,
        prompt: str,
        *,
        command_id: str | None = None,
    ) -> str:
        if not prompt.strip():
            raise ChatRunError("prompt_required")
        if command_id is not None and (not command_id or len(command_id) > 128):
            raise ChatRunError("invalid_command_id")
        if command_id is not None:
            request_fingerprint = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
            is_new, cached_result = await chat_database_sync_to_async(
                self._claim_start_turn_command
            )(agent_run_id, command_id, request_fingerprint)
            if not is_new:
                assert cached_result is not None
                return str(cached_result["turn_id"])
        return await self._deliver_turn(
            agent_run_id,
            prompt,
            command_id=command_id,
        )

    async def _deliver_turn(
        self,
        agent_run_id: str,
        prompt: str,
        *,
        command_id: str | None,
        message_already_audited: bool = False,
        runtime: CodexChatRuntime | None = None,
    ) -> str:
        try:
            runtime = runtime or self._runtime(agent_run_id)
        except Exception as exc:
            if command_id is not None:
                await chat_database_sync_to_async(self._fail_start_turn_command)(
                    agent_run_id,
                    command_id,
                    sanitize_external_message(exc) or exc.__class__.__name__,
                )
            raise
        if runtime.active_turn_id is not None:
            if command_id is not None:
                await chat_database_sync_to_async(self._fail_start_turn_command)(
                    agent_run_id, command_id, "A Chat turn is already active"
                )
            raise ChatRunError("turn_already_active")
        try:
            if command_id is None:
                turn_id = await runtime.send_turn(prompt)
            elif message_already_audited:
                turn_id = await runtime.send_turn(
                    prompt,
                    client_message_id=command_id,
                    message_already_audited=True,
                )
            else:
                turn_id = await runtime.send_turn(
                    prompt,
                    client_message_id=command_id,
                )
        except (Exception, asyncio.CancelledError) as exc:
            if command_id is not None:
                await chat_database_sync_to_async(self._fail_start_turn_command)(
                    agent_run_id,
                    command_id,
                    sanitize_external_message(exc) or exc.__class__.__name__,
                )
            if isinstance(exc, TurnAlreadyActiveError):
                raise ChatRunError("turn_already_active") from None
            raise
        if command_id is not None:
            await chat_database_sync_to_async(self._complete_start_turn_command)(
                agent_run_id, command_id, turn_id
            )
        return turn_id

    @staticmethod
    @transaction.atomic
    def _claim_start_turn_command(
        agent_run_id: str,
        command_id: str,
        request_fingerprint: str,
    ) -> tuple[bool, dict[str, Any] | None]:
        try:
            session = AgentChatSession.objects.get(run_id=agent_run_id)
        except AgentChatSession.DoesNotExist:
            raise ChatRunError("chat_not_found") from None
        command, created = AgentChatCommand.objects.get_or_create(
            session=session,
            command_id=command_id,
            defaults={
                "command_type": "start_turn",
                "request_fingerprint": request_fingerprint,
            },
        )
        if command.command_type != "start_turn":
            raise ChatRunError("command_id_conflict")
        if (
            command.request_fingerprint is not None
            and command.request_fingerprint != request_fingerprint
        ):
            raise ChatRunError("command_id_conflict")
        if created:
            return True, None
        if command.status == AgentChatCommand.Status.COMPLETED:
            return False, command.result
        if command.status == AgentChatCommand.Status.PENDING:
            raise ChatRunError("command_in_progress")
        raise ChatRunError("command_failed")

    @staticmethod
    def _complete_start_turn_command(
        agent_run_id: str,
        command_id: str,
        turn_id: str,
    ) -> None:
        AgentChatCommand.objects.filter(
            session_id=agent_run_id,
            command_id=command_id,
            status=AgentChatCommand.Status.PENDING,
        ).update(
            status=AgentChatCommand.Status.COMPLETED,
            result={"turn_id": turn_id},
            error=None,
            updated_at=datetime.now(timezone.utc),
        )

    @staticmethod
    def _fail_start_turn_command(
        agent_run_id: str,
        command_id: str,
        message: str,
    ) -> None:
        AgentChatCommand.objects.filter(
            session_id=agent_run_id,
            command_id=command_id,
            status=AgentChatCommand.Status.PENDING,
        ).update(
            status=AgentChatCommand.Status.FAILED,
            error=sanitize_external_message(message),
            updated_at=datetime.now(timezone.utc),
        )

    async def interrupt(self, agent_run_id: str) -> bool:
        return await self._run_runtime_command(
            agent_run_id,
            lambda: self._interrupt_locked(agent_run_id),
        )

    async def _interrupt_locked(self, agent_run_id: str) -> bool:
        runtime = self._runtime(agent_run_id)
        interrupted = runtime.active_turn_id is not None
        await runtime.interrupt()
        return interrupted

    async def respond_to_approval(
        self,
        agent_run_id: str,
        request_id: str,
        decision: str,
    ) -> None:
        await self._run_runtime_command(
            agent_run_id,
            lambda: self._respond_to_approval_locked(
                agent_run_id,
                request_id,
                decision,
            ),
        )

    async def _respond_to_approval_locked(
        self,
        agent_run_id: str,
        request_id: str,
        decision: str,
    ) -> None:
        try:
            await self._runtime(agent_run_id).respond_to_approval(request_id, decision)
        except KeyError:
            raise ChatRunError("request_not_pending") from None
        except RequestKindMismatchError:
            raise ChatRunError("request_kind_mismatch") from None

    async def respond_to_user_input(
        self,
        agent_run_id: str,
        request_id: str,
        answers: dict[str, list[str]],
    ) -> None:
        await self._run_runtime_command(
            agent_run_id,
            lambda: self._respond_to_user_input_locked(
                agent_run_id,
                request_id,
                answers,
            ),
        )

    async def _respond_to_user_input_locked(
        self,
        agent_run_id: str,
        request_id: str,
        answers: dict[str, list[str]],
    ) -> None:
        try:
            await self._runtime(agent_run_id).respond_to_user_input(
                request_id, answers
            )
        except KeyError:
            raise ChatRunError("request_not_pending") from None
        except RequestKindMismatchError:
            raise ChatRunError("request_kind_mismatch") from None

    async def stop(self, agent_run_id: str) -> bool:
        """Stop a live process and durably close its shared AgentRun identity."""

        # Stop is a preemptive safety boundary, not an ordinary queued command.
        # Cancel a provider RPC that may never answer before waiting for its
        # lock; its cancellation audit runs and releases the lock, after which
        # process-tree containment proceeds. New commands fail closed from the
        # moment stop intent is registered.
        self._stopping_runs.add(agent_run_id)
        active_command = self._active_runtime_commands.get(agent_run_id)
        if active_command is not None and active_command is not asyncio.current_task():
            active_command.cancel()
        async with self._run_operation_lock(agent_run_id):
            try:
                return await self._stop_locked(agent_run_id)
            except ChatRunError as exc:
                # A preempted launch can clean its reserved row as part of
                # cancellation. That is already a successful Stop outcome:
                # the provider tree was contained and no durable run remains.
                if active_command is not None and exc.code == "chat_not_found":
                    return False
                raise

    async def _run_runtime_command(
        self,
        agent_run_id: str,
        operation: Callable[[], Awaitable[Any]],
    ) -> Any:
        if agent_run_id in self._stopping_runs:
            raise ChatRunError("chat_runtime_unavailable")
        async with self._run_operation_lock(agent_run_id):
            if agent_run_id in self._stopping_runs:
                raise ChatRunError("chat_runtime_unavailable")
            task = asyncio.current_task()
            if task is None:
                raise RuntimeError("Chat runtime command has no asyncio task")
            self._active_runtime_commands[agent_run_id] = task
            try:
                return await operation()
            finally:
                if self._active_runtime_commands.get(agent_run_id) is task:
                    self._active_runtime_commands.pop(agent_run_id, None)

    async def _stop_locked(self, agent_run_id: str) -> bool:
        exists = await chat_database_sync_to_async(
            AgentRun.objects.filter(
                id=agent_run_id,
                run_kind=AgentRun.Kind.CHAT,
            ).exists
        )()

        was_live = True
        try:
            runtime_registry.get(agent_run_id)
        except KeyError:
            was_live = False
        # Registry ownership is retained until close confirms process-group
        # containment. Only then publish a durable stopped state; a failed
        # close remains retryable and cannot masquerade as success.
        await runtime_registry.remove(agent_run_id)
        if not exists:
            if not was_live:
                raise ChatRunError("chat_not_found")
            # A legacy/direct cascade may already have removed the durable
            # owner. Containment still takes precedence over reporting 404.
            documents_watch.stop_watch(agent_run_id)
            cleanup_temporary_artifacts_for_run(agent_run_id)
            return True

        ended_at = datetime.now(timezone.utc).isoformat()
        # Closing the process also drives its watcher. Reassert the explicit
        # user terminal state after that watcher finishes so it cannot replace
        # ``terminated`` with a generic process-exit status.
        try:
            project_id, record = await chat_database_sync_to_async(
                self._mark_stopped
            )(
                agent_run_id, ended_at
            )
        except (AgentRun.DoesNotExist, AgentChatSession.DoesNotExist):
            documents_watch.stop_watch(agent_run_id)
            cleanup_temporary_artifacts_for_run(agent_run_id)
            return was_live
        await publish_status(
            project_id,
            AgentLifecycleFrame(at=ended_at, run=record).model_dump(),
        )
        documents_watch.stop_watch(agent_run_id)
        cleanup_temporary_artifacts_for_run(agent_run_id)
        return was_live

    @staticmethod
    def _runtime(agent_run_id: str) -> CodexChatRuntime:
        try:
            return runtime_registry.get(agent_run_id)
        except KeyError:
            raise ChatRunError("chat_runtime_unavailable") from None

    @staticmethod
    def _load_resumable(
        agent_run_id: str,
    ) -> tuple[AgentRun, str, str, str, str | None]:
        try:
            session = AgentChatSession.objects.select_related(
                "run", "run__issue"
            ).get(run_id=agent_run_id, run__run_kind=AgentRun.Kind.CHAT)
        except AgentChatSession.DoesNotExist:
            raise ChatRunError("chat_not_found") from None
        if not session.provider_thread_id:
            raise ChatRunError("no_provider_thread_id")
        if session.status not in {
            AgentChatSession.Status.INTERRUPTED,
            AgentChatSession.Status.ERROR,
        }:
            raise ChatRunError("runtime_state_conflict")
        project_id, module_id, task_id = _scope_ids(session.run.issue)
        return (
            session.run,
            session.provider_thread_id,
            project_id,
            module_id,
            task_id,
        )

    @staticmethod
    @transaction.atomic
    def _claim_resuming(agent_run_id: str, resume_token: str, at: str) -> None:
        try:
            issue_id = AgentRun.objects.values_list("issue_id", flat=True).get(
                id=agent_run_id,
                run_kind=AgentRun.Kind.CHAT,
            )
            # Work-item and project deletion take this same anchor lock before
            # checking for active Chat ownership. Whichever operation wins is
            # now decisive: delete removes the row before resume can claim it,
            # or resume commits ``running`` before delete rechecks and blocks.
            Issue.objects.select_for_update().get(id=issue_id)
        except (AgentRun.DoesNotExist, Issue.DoesNotExist):
            raise ChatRunError("chat_not_found") from None
        try:
            session = (
                AgentChatSession.objects.select_for_update()
                .select_related("run")
                .get(run_id=agent_run_id, run__run_kind=AgentRun.Kind.CHAT)
            )
        except AgentChatSession.DoesNotExist:
            raise ChatRunError("chat_not_found") from None
        if not session.provider_thread_id:
            raise ChatRunError("no_provider_thread_id")
        if session.status not in {
            AgentChatSession.Status.INTERRUPTED,
            AgentChatSession.Status.ERROR,
        }:
            raise ChatRunError("runtime_state_conflict")
        run = session.run
        run.status = "running"
        run.ended_at = None
        run.error = None
        run.lifecycle_state = "starting"
        run.lifecycle_updated_at = at
        run.save(
            update_fields=[
                "status",
                "ended_at",
                "error",
                "lifecycle_state",
                "lifecycle_updated_at",
            ]
        )
        session.status = AgentChatSession.Status.STARTING
        session.active_turn_id = None
        session.last_error = None
        session.resume_token = resume_token
        session.save(
            update_fields=[
                "status",
                "active_turn_id",
                "last_error",
                "resume_token",
                "updated_at",
            ]
        )

    @staticmethod
    @transaction.atomic
    def _mark_resume_failed(
        agent_run_id: str,
        resume_token: str,
        message: str,
    ) -> bool:
        message = sanitize_external_message(message) or "Chat resume failed"
        at = datetime.now(timezone.utc).isoformat()
        try:
            session = (
                AgentChatSession.objects.select_for_update()
                .select_related("run")
                .get(run_id=agent_run_id)
            )
        except AgentChatSession.DoesNotExist:
            return False
        if session.resume_token != resume_token:
            return False
        AgentRun.objects.filter(id=agent_run_id).update(
            status="exited",
            ended_at=at,
            error=message,
            lifecycle_state="error",
            lifecycle_updated_at=at,
        )
        session.status = AgentChatSession.Status.ERROR
        session.active_turn_id = None
        session.last_error = message
        session.resume_token = None
        session.save(
            update_fields=[
                "status",
                "active_turn_id",
                "last_error",
                "resume_token",
                "updated_at",
            ]
        )
        append_event(
            agent_run_id=agent_run_id,
            event_type="thread.error",
            payload={"phase": "resume", "message": message},
        )
        return True

    @staticmethod
    @transaction.atomic
    def _mark_resume_interrupted(
        agent_run_id: str,
        resume_token: str,
        message: str,
    ) -> bool:
        message = sanitize_external_message(message) or "Chat resume was interrupted"
        at = datetime.now(timezone.utc).isoformat()
        try:
            session = AgentChatSession.objects.select_for_update().get(
                run_id=agent_run_id
            )
        except AgentChatSession.DoesNotExist:
            return False
        if session.resume_token != resume_token:
            return False
        AgentRun.objects.filter(id=agent_run_id).update(
            status="interrupted",
            ended_at=None,
            error=message,
            lifecycle_state="quiet",
            lifecycle_updated_at=at,
        )
        session.status = AgentChatSession.Status.INTERRUPTED
        session.active_turn_id = None
        session.last_error = message
        session.resume_token = None
        session.save(
            update_fields=[
                "status",
                "active_turn_id",
                "last_error",
                "resume_token",
                "updated_at",
            ]
        )
        append_event(
            agent_run_id=agent_run_id,
            event_type="thread.session-interrupted",
            payload={"reason": "resume_cancelled", "resumable": True},
        )
        return True

    @staticmethod
    @transaction.atomic
    def _mark_resume_ready(
        agent_run_id: str,
        resume_token: str,
        provider_thread_id: str,
        at: str,
    ) -> bool:
        try:
            session = AgentChatSession.objects.select_for_update().get(
                run_id=agent_run_id
            )
        except AgentChatSession.DoesNotExist:
            return False
        if session.resume_token != resume_token:
            return False
        AgentRun.objects.filter(id=agent_run_id).update(
            status="running",
            ended_at=None,
            error=None,
            lifecycle_state="quiet",
            lifecycle_updated_at=at,
        )
        session.status = AgentChatSession.Status.READY
        session.active_turn_id = None
        session.last_error = None
        session.save(
            update_fields=["status", "active_turn_id", "last_error", "updated_at"]
        )
        append_event(
            agent_run_id=agent_run_id,
            event_type="thread.session-resumed",
            payload={"providerThreadId": provider_thread_id},
        )
        return True

    @staticmethod
    def _release_resume_claim(agent_run_id: str, resume_token: str) -> bool:
        return bool(
            AgentChatSession.objects.filter(
                run_id=agent_run_id,
                resume_token=resume_token,
            ).update(resume_token=None)
        )

    @staticmethod
    @transaction.atomic
    def _mark_stopped(
        agent_run_id: str, ended_at: str
    ) -> tuple[str, RunRecord]:
        run = (
            AgentRun.objects.select_for_update()
            .select_related("issue")
            .get(id=agent_run_id)
        )
        session = AgentChatSession.objects.select_for_update().get(run=run)
        run.status = "terminated"
        run.ended_at = run.ended_at or ended_at
        run.lifecycle_state = "exited"
        run.lifecycle_updated_at = ended_at
        run.save(
            update_fields=[
                "status",
                "ended_at",
                "lifecycle_state",
                "lifecycle_updated_at",
            ]
        )
        session.status = AgentChatSession.Status.STOPPED
        session.active_turn_id = None
        session.resume_token = None
        session.save(
            update_fields=[
                "status",
                "active_turn_id",
                "resume_token",
                "updated_at",
            ]
        )
        if not session.events.filter(event_type="thread.session-stopped").exists():
            append_event(
                agent_run_id=agent_run_id,
                event_type="thread.session-stopped",
                payload={"reason": "user_requested"},
            )
        project_id, module_id, task_id = _scope_ids(run.issue)
        return project_id, RunRecord(
            agent_run_id=run.id,
            project_id=project_id,
            task_id=task_id,
            module_id=module_id,
            agent=run.agent,
            run_kind="chat",
            scope=run.scope,
            started_at=run.started_at,
            state="exited",
            updated_at=ended_at,
        )

    @staticmethod
    @transaction.atomic
    def _record_initial_turn_failure(
        agent_run_id: str,
        message: str,
        at: str,
    ) -> tuple[str, RunRecord]:
        message = sanitize_external_message(message) or "Initial Chat turn failed"
        run = AgentRun.objects.select_related("issue").get(id=agent_run_id)
        run.lifecycle_state = "error"
        run.lifecycle_updated_at = at
        run.error = message
        run.save(
            update_fields=["lifecycle_state", "lifecycle_updated_at", "error"]
        )
        AgentChatSession.objects.filter(run=run).update(
            status=AgentChatSession.Status.ERROR,
            active_turn_id=None,
            last_error=message,
        )
        append_event(
            agent_run_id=agent_run_id,
            event_type="thread.error",
            payload={"phase": "initial_turn", "message": message},
        )
        project_id, module_id, task_id = _scope_ids(run.issue)
        return project_id, RunRecord(
            agent_run_id=run.id,
            project_id=project_id,
            task_id=task_id,
            module_id=module_id,
            agent=run.agent,
            run_kind="chat",
            scope=run.scope,
            started_at=run.started_at,
            state="error",
            updated_at=at,
        )


chat_session = ChatSessionService()
