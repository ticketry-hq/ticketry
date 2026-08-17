"""Projection of one durable agent run into its public status record.

Shared by the authoritative snapshot and by every delta publisher so a run
cannot be described one way by a snapshot and another way by a frame.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from studio_server.contracts import RunRecord, project_effective_state


def build_run_record(
    run,
    *,
    module_id: str,
    output_sequence: int = 0,
    last_output_at: Optional[str] = None,
    now: Optional[datetime] = None,
) -> RunRecord:
    """Project one ``AgentRun`` row plus its terminal activity facts.

    The run's launch snapshots ride along unchanged: they describe how the run
    was started and never participate in lifecycle reduction (#693).

    An ended run is an exited tombstone regardless of the last lifecycle event
    it happened to record — otherwise a fresh snapshot can present a terminated
    run as still ``working`` (#978). The output-activity axis is carried
    alongside, never merged into, the lifecycle axis: the effective
    presentation is projected from both by the contract itself.

    :param run: the ``AgentRun`` instance, with ``issue`` already loaded.
    :param module_id: the run's resolved module routing key.
    :param output_sequence: monotonic terminal-output sequence for the run.
    :param last_output_at: backend-owned stamp of the newest changed output.
    :param now: reference clock for the read-time projection; injectable so the
        inactivity boundary is deterministic in tests.
    """

    if run.ended_at:
        state = "exited"
        updated_at = max(filter(None, (run.ended_at, run.lifecycle_updated_at)))
    else:
        state = run.lifecycle_state or "unknown"
        updated_at = run.lifecycle_updated_at or run.started_at
    return RunRecord(
        agent_run_id=run.id,
        project_id=str(run.issue.project_id),
        task_id=str(run.issue_id) if run.issue.type == "task" else None,
        module_id=module_id,
        agent=run.agent,
        scope=run.scope,
        launch_state=run.launch_state,
        launch_model=run.launch_model,
        started_at=run.started_at,
        state=state,
        updated_at=updated_at,
        exit_code=run.exit_code,
        output_sequence=output_sequence or 0,
        last_output_at=last_output_at,
        effective_state=project_effective_state(
            state=state,
            last_output_at=last_output_at,
            now=now,
        ),
    )
