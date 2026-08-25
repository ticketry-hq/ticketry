from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.utils import timezone
from worktracker.models import Issue

from apps.source_control.actions.action_steps import (
    STATUS_FAILED,
    STATUS_OK,
    STATUS_SKIPPED,
    STEP_COMMIT,
    STEP_PULL_REQUEST,
    STEP_PUSH,
    ActionStep,
)
from apps.source_control.checkouts.checkout import ModuleCheckout, TaskCheckout
from apps.source_control.errors import ShipRecordPersistenceFailed
from apps.source_control.models import (
    CHECKOUT_BASE,
    CHECKOUT_WORKTREE,
    PR_OPEN,
    STEP_DONE,
    STEP_FAILED,
    STEP_SKIPPED,
    ShipRecord,
)

_PR_NUMBER = re.compile(
    r"^https://github\.com/[^/?#]+/[^/?#]+/pull/([1-9][0-9]*)(?:[/?#].*)?$"
)
_STATUS_MAP = {
    STATUS_OK: STEP_DONE,
    STATUS_SKIPPED: STEP_SKIPPED,
    STATUS_FAILED: STEP_FAILED,
}


@dataclass(frozen=True)
class FailedShipAction:
    """Safe terminal facts retained when an action raises after commit starts."""

    status: str
    steps: tuple[ActionStep, ...]
    branch: str
    commit_shas: tuple[str, ...] = ()
    base_branch: str | None = None
    remote: str | None = None
    commit_sha: str | None = None
    pushed_sha: str | None = None
    pull_request_url: str | None = None


def new_action_id(action_id: uuid.UUID | str | None = None) -> uuid.UUID:
    return uuid.UUID(str(action_id)) if action_id is not None else uuid.uuid4()


def failed_action(
    checkout: ModuleCheckout | TaskCheckout,
    *,
    phase: str,
    completed_steps: tuple[ActionStep, ...] = (),
    commit_shas: tuple[str, ...] = (),
    remote: str | None = None,
    base_branch: str | None = None,
    commit_sha: str | None = None,
    pushed_sha: str | None = None,
    pull_request_url: str | None = None,
) -> FailedShipAction:
    labels = {
        STEP_COMMIT: "The commit step failed.",
        STEP_PUSH: "The push step failed.",
        STEP_PULL_REQUEST: "The pull request step failed.",
    }
    return FailedShipAction(
        status="failed",
        steps=(*completed_steps, ActionStep(phase, STATUS_FAILED, labels[phase])),
        branch=checkout.branch,
        commit_shas=commit_shas,
        base_branch=base_branch,
        remote=remote,
        commit_sha=commit_sha,
        pushed_sha=pushed_sha,
        pull_request_url=pull_request_url,
    )


def persist_ship_record_or_fail(
    checkout: ModuleCheckout | TaskCheckout,
    outcome,
    *,
    action_id: uuid.UUID,
) -> ShipRecord:
    """Persist once, replacing every storage exception with one safe failure."""

    try:
        return persist_ship_record(checkout, outcome, action_id=action_id)
    except Exception as exc:
        raise ShipRecordPersistenceFailed(
            action_result=safe_action_result(outcome, action_id=action_id)
        ) from exc


def persist_ship_record(
    checkout: ModuleCheckout | TaskCheckout,
    outcome,
    *,
    action_id: uuid.UUID,
) -> ShipRecord:
    module, task, checkout_kind, checkout_name = _resolve_ownership(checkout)
    pr_url, pr_number = _pr_facts(getattr(outcome, "pull_request_url", None))
    defaults = {
        "module": module,
        "task": task,
        "checkout_kind": checkout_kind,
        "checkout_name": checkout_name,
        "branch": getattr(outcome, "branch", checkout.branch),
        "commit_shas": [sha.lower() for sha in getattr(outcome, "commit_shas", ())],
        "commit_outcome": _phase_outcome(outcome.steps, STEP_COMMIT),
        "push_outcome": _phase_outcome(outcome.steps, STEP_PUSH),
        "create_pr_outcome": _phase_outcome(outcome.steps, STEP_PULL_REQUEST),
        "pr_url": pr_url,
        "pr_number": pr_number,
        "pr_state": PR_OPEN if pr_url is not None else None,
        "action_at": timezone.now(),
    }
    candidate = ShipRecord(action_id=action_id, **defaults)
    candidate.full_clean(validate_unique=False)

    try:
        with transaction.atomic():
            record, _ = ShipRecord.objects.get_or_create(
                action_id=action_id,
                defaults=defaults,
            )
            return record
    except IntegrityError:
        return ShipRecord.objects.get(action_id=action_id)


def safe_action_result(outcome, *, action_id: uuid.UUID) -> dict:
    """Known Git and PR facts without command text, process output, or secrets."""

    return {
        "action_id": str(action_id),
        "status": getattr(outcome, "status", "failed"),
        "steps": [
            {"name": step.name, "status": step.status}
            for step in getattr(outcome, "steps", ())
        ],
        "branch": getattr(outcome, "branch", None),
        "base_branch": getattr(outcome, "base_branch", None),
        "remote": getattr(outcome, "remote", None),
        "commit_shas": list(getattr(outcome, "commit_shas", ())),
        "commit_sha": getattr(outcome, "commit_sha", None),
        "pushed_sha": getattr(outcome, "pushed_sha", None),
        "pull_request_url": getattr(outcome, "pull_request_url", None),
        "ship_record": None,
    }


def _phase_outcome(steps: tuple[ActionStep, ...], phase: str) -> dict:
    step = next((candidate for candidate in steps if candidate.name == phase), None)
    if step is None:
        return {
            "status": STEP_SKIPPED,
            "message": f"The {_phase_label(phase)} step did not run.",
        }
    status = _STATUS_MAP[step.status]
    if status == STEP_DONE:
        return {"status": status}
    return {
        "status": status,
        "message": f"The {_phase_label(phase)} step was {status}.",
    }


def _phase_label(phase: str) -> str:
    return "pull request" if phase == STEP_PULL_REQUEST else phase


def _pr_facts(url: str | None) -> tuple[str | None, int | None]:
    if not url:
        return None, None
    matched = _PR_NUMBER.fullmatch(url)
    return url, int(matched.group(1)) if matched is not None else None


def _resolve_ownership(
    checkout: ModuleCheckout | TaskCheckout,
) -> tuple[Issue, Issue | None, str, str]:
    if isinstance(checkout, ModuleCheckout):
        module = Issue.objects.select_related("issue_type").get(pk=checkout.module_id)
        if module.type != "module" or module.issue_type.level != "module":
            raise ValueError("The resolved base checkout is not owned by a module.")
        return module, None, CHECKOUT_BASE, module.name

    anchor = Issue.objects.select_related("issue_type", "module", "parent").get(
        pk=checkout.top_level_task_id
    )
    requested = Issue.objects.select_related("module", "parent").get(
        pk=checkout.task_id
    )
    module = anchor.module
    if module is None or anchor.type != "task" or anchor.issue_type.level != "task":
        raise ValueError("The resolved worktree anchor is not a task.")
    if anchor.parent_id != module.id:
        raise ValueError("The resolved worktree owner is not a top-level task.")
    if requested.module_id != module.id:
        raise ValueError("The requested task does not belong to the resolved module.")
    if requested.id != anchor.id and requested.parent_id != anchor.id:
        raise ValueError("The requested task does not share the resolved worktree.")
    return module, anchor, CHECKOUT_WORKTREE, anchor.name
