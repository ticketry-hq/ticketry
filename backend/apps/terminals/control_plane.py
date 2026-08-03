"""Control-plane operation for creating durable agent terminal runs."""

from __future__ import annotations

from apps.terminals.dao import SCRATCH_TASK_ID
from apps.terminals.session import LaunchIntent, session as terminal_session
from apps.terminals.validation import SpawnRequest


def launch_intent_from_spawn(request: SpawnRequest) -> LaunchIntent:
    """Translate a validated spawn request into the shared session intent."""

    scope = (
        "docchat"
        if request.is_doc_chat
        else "plan"
        if request.is_planning
        else "instant"
        if request.is_instant
        else "task"
    )
    if scope == "task":
        persist_task_id = request.task_id
        issue_id = request.task_id
    elif scope == "docchat":
        # A task-bound document chat remains associated with its task; a
        # scratch chat uses the existing sentinel bucket.
        persist_task_id = request.task_id or SCRATCH_TASK_ID
        issue_id = request.task_id or request.module_id
    else:
        persist_task_id = SCRATCH_TASK_ID
        issue_id = request.module_id

    return LaunchIntent(
        agent=request.agent,
        project_id=request.project_id,
        module_id=request.module_id,
        task_id=persist_task_id,
        issue_id=issue_id,
        initial_prompt=request.instant_prompt
        if scope == "instant"
        else request.initial_prompt,
        scope=scope,
        doc_rel_path=request.doc_rel_path,
        doc_id=request.doc_id,
    )


async def create_terminal_run(request: SpawnRequest) -> str:
    """Create the AgentRun and detached tmux session before transport attach.

    ``TerminalSessionService.spawn`` is the one launcher responsible for
    persisting the run and deleting it if tmux setup fails. ``request`` must
    have passed terminal spawn validation before reaching this operation.
    """

    return await terminal_session.spawn(launch_intent_from_spawn(request))
