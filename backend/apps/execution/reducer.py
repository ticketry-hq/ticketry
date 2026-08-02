from __future__ import annotations

from dataclasses import replace

from apps.execution.state import Decision, EngineState, LaunchAction, SeamEvent


def _is_complete(state: EngineState, event: SeamEvent) -> bool:
    if state.phase == "implement":
        return event.to_group == "completed"
    if state.phase == "refine":
        return event.from_group == "backlog" and event.to_group == "unstarted"
    if state.phase == "split":
        return event.from_group == "unstarted" and event.to_group == "unstarted"
    return False


def decide(state: EngineState, event: SeamEvent) -> Decision:
    """Pure one-task execution transition."""

    if event.task_id != state.task_id:
        return Decision(next=state)

    if event.kind == "execute_requested":
        if state.status != "idle":
            return Decision(next=state)
        action = LaunchAction(
            task_id=state.task_id,
            project_id=state.project_id,
            module_id=state.module_id,
            agent=state.agent,
            recipe=state.phase,
        )
        return Decision(next=state, actions=[action])

    if event.kind == "run_started":
        return Decision(
            next=replace(
                state,
                status="running",
                agent_run_id=event.agent_run_id,
                error=None,
            )
        )

    if event.kind == "run_failed":
        return Decision(
            next=replace(
                state,
                status="failed",
                agent_run_id=None,
                error=event.error or "launch_failed",
            )
        )

    if event.kind == "issue_state_changed":
        if state.status == "running" and _is_complete(state, event):
            return Decision(next=replace(state, status="done", error=None))
        return Decision(next=state)

    if event.kind == "release_requested":
        # Manual escape hatch (CODIN-755): clear a wedged guard. Only a
        # ``running`` run is a releasable lock; any other status is a no-op the
        # driver reports as ``planning_run_not_found``.
        if state.status == "running":
            return Decision(
                next=replace(state, status="idle", agent_run_id=None, error=None)
            )
        return Decision(next=state)

    return Decision(next=state)
