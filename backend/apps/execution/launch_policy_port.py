"""Idempotent Django effect port for immutable Rust launch decisions."""

from __future__ import annotations

import uuid
from threading import Lock, RLock
from typing import Literal
from weakref import WeakValueDictionary

from django.db import connection, transaction
from pydantic import BaseModel, ConfigDict

from apps.execution import driver
from apps.execution.models import GraphRun, LaunchedTask, LaunchPolicyEffect
from apps.runs import rust_port
from apps.runs.models import AgentRun, AutomationAttempt
from apps.terminals.launch_configuration import ResolvedLaunchConfiguration
from worktracker.models import Issue


_LOCKS: WeakValueDictionary[str, RLock] = WeakValueDictionary()
_LOCKS_GUARD = Lock()


class SelectedProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int
    name: str
    workspace_slug: str


class ModuleLinkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    module_id: str
    path: str | None = None


class LaunchPolicyDecisionIn(BaseModel):
    """Versioned compatibility contract; policy fields are data, not hints."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    decision_id: str
    policy_identity: str
    policy_version: int
    caller_scope: Literal["interactive", "auto_start", "subtree", "retry"]
    idempotency_key: str
    task_id: str
    project_id: str
    issue_type_id: str
    state_id: str
    prompt: str
    required_skills: list[str]
    provider: str
    model: str | None = None
    reasoning: str | None = None
    selected_profile: SelectedProfileInput
    module_link: ModuleLinkInput

    def configuration(self) -> ResolvedLaunchConfiguration:
        return ResolvedLaunchConfiguration(
            prompt=self.prompt,
            agent=self.provider,
            model=self.model,
            reasoning=self.reasoning,
            required_skills=tuple(self.required_skills),
            selected_profile_index=self.selected_profile.index,
            module_id=self.module_link.module_id,
            module_link_path=self.module_link.path,
            policy_identity=self.policy_identity,
            policy_version=self.policy_version,
        )


def _lock(decision: LaunchPolicyDecisionIn) -> RLock:
    identity = f"{decision.caller_scope}:{decision.idempotency_key}"
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(identity, RLock())


def perform(decision: LaunchPolicyDecisionIn) -> tuple[int, dict]:
    """Perform or replay exactly one effect without consulting policy stores."""

    with _lock(decision):
        receipt, _ = LaunchPolicyEffect.objects.get_or_create(
            caller_scope=decision.caller_scope,
            idempotency_key=decision.idempotency_key,
            defaults={"decision_id": decision.decision_id},
        )
        if receipt.result is not None:
            return 200, receipt.result
        result = _perform_or_recover(decision)
        receipt.result = result
        receipt.save(update_fields=["result", "updated_at"])
        return 201, result


def _perform_or_recover(decision: LaunchPolicyDecisionIn) -> dict:
    configuration = decision.configuration()
    if decision.caller_scope == "interactive":
        existing = AgentRun.objects.filter(id=decision.idempotency_key).first()
        if existing is None:
            launched = driver.launch_task_agent(
                decision.task_id,
                agent=None,
                agent_run_id=decision.idempotency_key,
                launch_configuration=configuration,
            )
            agent = launched.agent
            run_id = launched.agent_run_id
        else:
            agent = existing.agent
            run_id = existing.id
        return {
            "target_id": decision.task_id,
            "agent": agent,
            "agent_run_id": run_id,
        }

    if decision.caller_scope == "auto_start":
        return _perform_auto_start(decision, configuration)

    if decision.caller_scope == "retry":
        return _perform_retry(decision, configuration)

    header = GraphRun.objects.filter(pk=decision.task_id).first()
    if header is None:
        launched = driver.execute_graph(
            decision.task_id,
            agent=decision.provider,
            launch_configuration=configuration,
        )
    else:
        launched = driver.advance(decision.task_id)
        if not launched:
            launched = [
                str(task_id)
                for task_id in LaunchedTask.objects.filter(
                    root_id=decision.task_id
                ).values_list("task_id", flat=True)
            ]
    return {"root_id": decision.task_id, "launched": launched}


def _perform_retry(
    decision: LaunchPolicyDecisionIn,
    configuration: ResolvedLaunchConfiguration,
) -> dict:
    """Launch the durable retry child Rust already appended.

    Rust owns the retry lineage, so this effect never creates an attempt: it
    performs the launch the pending child is still owed, and only while that
    child is still pending. A replayed decision therefore reports the settled
    attempt instead of starting a second session for the same retry.
    """

    attempt = AutomationAttempt.objects.filter(
        pk=uuid.UUID(decision.idempotency_key)
    ).first()
    if attempt is None:
        raise ValueError("automation_attempt_not_found")
    if attempt.status == AutomationAttempt.Status.PENDING:
        from apps.execution.signals import run_automation_attempt

        run_automation_attempt(
            attempt,
            destination_state_id=decision.state_id,
            launch_configuration=configuration,
        )
        attempt.refresh_from_db()
    return {
        "attempt_id": str(attempt.id),
        "target_id": decision.task_id,
        "agent_run_id": attempt.agent_run_id,
        "status": attempt.status,
    }


def _perform_auto_start(
    decision: LaunchPolicyDecisionIn,
    configuration: ResolvedLaunchConfiguration,
) -> dict:
    occurrence_id = uuid.UUID(decision.idempotency_key)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT from_state_id, to_state_id, workflow_revision
              FROM worktracker_transitionoccurrence
             WHERE occurrence_id = %s AND issue_id = %s
            """,
            [occurrence_id.hex, uuid.UUID(decision.task_id).hex],
        )
        row = cursor.fetchone()
    if row is None:
        raise ValueError("automation_occurrence_not_found")
    Issue.objects.get(pk=decision.task_id, type="task")
    # Rust owns automation_attempts. Materialization is idempotent by committed
    # transition occurrence, so a re-delivered decision returns the same root
    # attempt rather than launching a second time.
    materialized = rust_port.materialize_attempt(
        occurrence_id=str(occurrence_id),
        issue_id=decision.task_id,
        project_id=decision.project_id,
        from_state_id=str(row[0]),
        to_state_id=str(row[1]),
        workflow_revision=int(row[2]),
    )
    attempt = AutomationAttempt.objects.get(pk=materialized["attempt_id"])
    if attempt.status == AutomationAttempt.Status.PENDING:
        from apps.execution.signals import run_automation_attempt

        run_automation_attempt(
            attempt,
            destination_state_id=decision.state_id,
            launch_configuration=configuration,
        )
        attempt.refresh_from_db()
    return {
        "attempt_id": str(attempt.id),
        "target_id": decision.task_id,
        "agent_run_id": attempt.agent_run_id,
        "status": attempt.status,
    }
