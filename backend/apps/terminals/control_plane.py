"""Control-plane operation for creating durable agent terminal runs."""

from __future__ import annotations

from apps.terminals.dao import SCRATCH_TASK_ID
from apps.terminals.session import LaunchIntent, session as terminal_session


def launch_intent_from_spawn(init: dict) -> LaunchIntent:
    """Translate a validated spawn request into the shared session intent."""

    scope = (
        "docchat"
        if init["is_doc_chat"]
        else "plan"
        if init["is_planning"]
        else "instant"
        if init["is_instant"]
        else "task"
    )
    if scope == "task":
        persist_task_id = init["task_id"]
        issue_id = init["task_id"]
    elif scope == "docchat":
        # A task-bound document chat remains associated with its task; a
        # scratch chat uses the existing sentinel bucket.
        persist_task_id = init["task_id"] or SCRATCH_TASK_ID
        issue_id = init["task_id"] or init["module_id"]
    else:
        persist_task_id = SCRATCH_TASK_ID
        issue_id = init["module_id"]

    return LaunchIntent(
        agent=init["agent"],
        project_id=init["project_id"],
        module_id=init["module_id"],
        task_id=persist_task_id,
        issue_id=issue_id,
        initial_prompt=init["instant_prompt"]
        if scope == "instant"
        else init["initial_prompt"],
        scope=scope,
        doc_rel_path=init["doc_rel_path"],
        doc_id=init["doc_id"],
    )


async def create_terminal_run(init: dict) -> str:
    """Create the AgentRun and detached tmux session before transport attach.

    ``TerminalSessionService.spawn`` is the one launcher responsible for
    persisting the run and deleting it if tmux setup fails. ``init`` must have
    passed terminal spawn validation before reaching this operation.
    """

    return await terminal_session.spawn(launch_intent_from_spawn(init))
