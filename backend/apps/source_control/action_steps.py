"""The per-step vocabulary shared by every stacked source-control action.

The write surface is one ordered action — stage, generate a message, commit,
push, open a pull request — and a caller renders it as progress rather than as
a bare success flag. That only works if the step names and their statuses are
one vocabulary rather than one per endpoint, so they live here and every
action on the surface — commit, commit-and-push, the whole stack, and the
pull-request-only retry — reports in the same terms.

``failed`` exists in the vocabulary because a *later* step can fail after an
earlier one has already written something: once a commit lands, the action can
no longer leave through the error envelope without throwing away the sha the
caller needs. Steps that fail before anything is written still abort the
action instead (:mod:`apps.source_control.errors`).
"""

from __future__ import annotations

from dataclasses import dataclass


#: The steps, in the only order they ever run.
STEP_STAGE = "stage"
STEP_MESSAGE = "generate_message"
STEP_COMMIT = "commit"
STEP_PUSH = "push"
STEP_PULL_REQUEST = "pull_request"

STEP_NAMES = (STEP_STAGE, STEP_MESSAGE, STEP_COMMIT, STEP_PUSH, STEP_PULL_REQUEST)

#: What one step reports. ``running`` is deliberately absent: this is the
#: vocabulary of a *settled* step, and a synchronous response can only ever
#: describe steps that already finished. A client showing progress supplies
#: "running" itself for the steps it has not heard about yet.
STATUS_OK = "ok"
STATUS_SKIPPED = "skipped"
STATUS_FAILED = "failed"

STATUSES = (STATUS_OK, STATUS_SKIPPED, STATUS_FAILED)


@dataclass(frozen=True)
class ActionStep:
    """What one step of a stacked action did, in the order it ran."""

    name: str
    status: str
    detail: str
