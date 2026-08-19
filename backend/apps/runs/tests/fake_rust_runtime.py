"""A local stand-in for the out-of-process Rust Runs runtime.

Rust owns every Runs table in shipping, and it is a separate process the Django
suite does not start. This double answers the same commands against the test
database so the suite can keep asserting what a user, agent, or operator
observes after a launch, a lifecycle fact, or a crash — the durable outcome,
not which process wrote the row.

It deliberately mirrors only the observable contract: identity preservation,
idempotent preparation, older-fact rejection, terminal authority, and the
accepted/no-op answer for an unknown historical run. Anything it cannot model
faithfully (the durable outbox, cursors, replay) it simply does not claim.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from apps.runs.models import AgentRun, AutomationAttempt
from apps.runs.rust_port import RunsPortUnavailable
from studio_server.contracts import reduce_lifecycle
from worktracker.models import Issue


#: Prepared effects, keyed by the effect identity the caller predetermined.
_EFFECTS: dict[str, dict] = {}


def reset() -> None:
    _EFFECTS.clear()


def _normalize(value: str) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def apply_lifecycle_fact(
    agent_run_id: str,
    kind: str,
    occurred_at: str,
    provider_session_id: str | None = None,
) -> dict:
    occurred_at = _normalize(occurred_at)
    run = AgentRun.objects.filter(id=agent_run_id).first()
    if run is None:
        # An unknown historical run keeps its accepted/no-op meaning, and
        # appends nothing durable.
        return {"ok": True, "accepted": True, "known_run": False, "applied": False,
                "state": None, "occurred_at": occurred_at, "event_cursor": None}

    if provider_session_id and not run.provider_session_id:
        # First valid value wins, exactly as the established behaviour does.
        AgentRun.objects.filter(id=agent_run_id).update(
            provider_session_id=provider_session_id
        )

    state = reduce_lifecycle(kind)
    applied = False
    if state is not None and run.ended_at is None:
        # An ended run is terminal authority: a late hook cannot revive it, and
        # an older or duplicate fact is a no-op.
        if run.lifecycle_updated_at is None or run.lifecycle_updated_at < occurred_at:
            AgentRun.objects.filter(id=agent_run_id).update(
                lifecycle_state=state, lifecycle_updated_at=occurred_at
            )
            applied = True
    return {"ok": True, "accepted": True, "known_run": True, "applied": applied,
            "state": state, "occurred_at": occurred_at, "event_cursor": None}


def record_terminal_outcome(
    agent_run_id: str,
    outcome: str,
    occurred_at: str,
    exit_code: int | None = None,
) -> dict:
    occurred_at = _normalize(occurred_at)
    updates = {
        "status": outcome,
        "ended_at": occurred_at,
        "lifecycle_state": "exited",
        "lifecycle_updated_at": occurred_at,
    }
    if exit_code is not None:
        updates["exit_code"] = exit_code
    applied = AgentRun.objects.filter(
        id=agent_run_id, ended_at__isnull=True
    ).update(**updates)
    return {"ok": True, "applied": bool(applied),
            "state": "lost" if outcome == "lost" else "exited",
            "occurred_at": occurred_at, "event_cursor": None}


def prepare_launch(intent: dict, snapshot: dict) -> dict:
    effect_id = intent["effectId"]
    agent_run_id = intent["agentRunId"]
    existing = _EFFECTS.get(effect_id)
    if existing is not None:
        if existing["agent_run_id"] != agent_run_id:
            raise RunsPortUnavailable("launch_conflict")
        return {"ok": True, "effect_id": effect_id, "agent_run_id": agent_run_id,
                "state": existing["state"], "reused": True}

    run = AgentRun.objects.filter(id=agent_run_id).first()
    if run is not None and str(run.issue_id) != intent["issueId"]:
        raise RunsPortUnavailable("launch_conflict")
    if run is None:
        if not Issue.objects.filter(id=intent["issueId"]).exists():
            raise RunsPortUnavailable("launch_intent_invalid")
        started_at = datetime.now(timezone.utc).isoformat()
        AgentRun.objects.create(
            id=agent_run_id,
            issue_id=intent["issueId"],
            agent=intent["provider"],
            model=snapshot.get("model"),
            reasoning=snapshot.get("reasoning"),
            cwd=snapshot.get("cwd"),
            design_dir=snapshot.get("design_dir"),
            resumed_from=snapshot.get("resumed_from"),
            provider_session_id=snapshot.get("provider_session_id"),
            status="running",
            started_at=started_at,
            lifecycle_state="starting",
            lifecycle_updated_at=started_at,
            scope=intent["scope"],
        )
    _EFFECTS[effect_id] = {"agent_run_id": agent_run_id, "state": "prepared"}
    return {"ok": True, "effect_id": effect_id, "agent_run_id": agent_run_id,
            "state": "prepared", "reused": False}


def settle_launch(
    effect_id: str,
    *,
    applied: bool,
    runtime_id: str | None = None,
    adopted: bool = False,
    code: str | None = None,
    message: str | None = None,
    retryable: bool = False,
    cleanup_confirmed: bool = False,
) -> dict:
    effect = _EFFECTS.get(effect_id)
    if effect is None:
        raise RunsPortUnavailable("launch_effect_not_found")
    if applied:
        effect["state"] = "applied"
        return {"ok": True, "state": "applied", "settled": True, "attempt_status": None}
    if cleanup_confirmed:
        # Cleanup is proven, so the failed launch leaves no application rows.
        AgentRun.objects.filter(id=effect["agent_run_id"]).delete()
        effect["state"] = "failed"
        return {"ok": True, "state": "failed", "settled": True, "attempt_status": None}
    # Cleanup could not be proven: the run survives as a durable handle so the
    # external runtime can still be reconciled.
    AgentRun.objects.filter(id=effect["agent_run_id"]).update(status="cleanup_pending")
    effect["state"] = "cleanup_pending"
    return {"ok": True, "state": "cleanup_pending", "settled": False,
            "attempt_status": None}


def materialize_attempt(
    occurrence_id: str,
    issue_id: str,
    project_id: str,
    from_state_id: str,
    to_state_id: str,
    workflow_revision: int,
) -> dict:
    attempt, _ = AutomationAttempt.objects.get_or_create(
        transition_id=uuid.UUID(str(occurrence_id)),
        retry_of__isnull=True,
        defaults={
            "issue_id": issue_id,
            "from_state_id": from_state_id,
            "to_state_id": to_state_id,
            "workflow_revision": workflow_revision,
        },
    )
    return _attempt_body(attempt)


def record_attempt_outcome(
    attempt_id: str,
    *,
    succeeded: bool,
    agent: str | None = None,
    agent_run_id: str | None = None,
    error: str | None = None,
    failure: dict | None = None,
    retryable: bool = False,
) -> dict:
    attempt = AutomationAttempt.objects.filter(pk=attempt_id).first()
    if attempt is None:
        raise RunsPortUnavailable("automation_attempt_not_found")
    if succeeded:
        attempt.status = AutomationAttempt.Status.SUCCEEDED
        attempt.agent = agent
        attempt.agent_run_id = agent_run_id
        attempt.error = None
        attempt.error_details = None
        attempt.retryable = False
    else:
        attempt.status = AutomationAttempt.Status.FAILED
        attempt.error = error
        attempt.error_details = failure
        attempt.retryable = retryable
    attempt.save(
        update_fields=[
            "status",
            "agent",
            "agent_run_id",
            "error",
            "error_details",
            "retryable",
            "updated_at",
        ]
    )
    return _attempt_body(attempt)


def launch(intent: dict, snapshot: dict) -> dict:
    """Rust-driven launch is not exercised by the Django suite."""

    raise RunsPortUnavailable("runs_port_unreachable")


def _attempt_body(attempt: AutomationAttempt) -> dict:
    return {
        "ok": True,
        "attempt_id": str(attempt.id),
        "root_attempt_id": str(attempt.root_attempt_id or attempt.id),
        "retry_of_attempt_id": (
            str(attempt.retry_of_id) if attempt.retry_of_id else None
        ),
        "work_item_id": str(attempt.issue_id),
        "status": attempt.status,
        "agent_run_id": attempt.agent_run_id,
        "error": attempt.error,
        "retryable": attempt.retryable,
        "updated_at": attempt.updated_at.isoformat(),
    }
