"""Asking terminals to refresh liveness a serial campaign is waiting on (CODING-475).

The completion seam only fires when a termination is *recorded*, and an agent
that exits on its own is recorded solely by terminal reconciliation. Left alone,
a serial campaign whose current child is satisfied waits for whatever sweep
happens next — up to the idle-sweep interval, or forever when that sweep is
disabled and no terminal surface is open.

The execution app therefore asks for a reconciliation pass when — and only
when — its own frontier is pending purely on liveness. The request is
best-effort and never blocks the advancement that made it: reconciliation
publishes the durable termination, which re-enters the completion seam through
the ordinary path. Scheduling policy stays here; terminals still owns *how* a
sweep runs.
"""

from __future__ import annotations

import logging


logger = logging.getLogger(__name__)


def request_terminal_liveness_refresh() -> bool:
    """Ask terminals to reconcile now so a real exit becomes a durable fact.

    Returns whether a sweep was started; a coalesced or failed request is not an
    error here, because the pending frontier is re-checked by every later
    observation regardless.
    """

    try:
        from apps.terminals.reconciliation_scheduler import (
            schedule_terminal_reconciliation,
        )

        return schedule_terminal_reconciliation()
    except Exception:
        logger.warning(
            "execution could not request terminal reconciliation", exc_info=True
        )
        return False
