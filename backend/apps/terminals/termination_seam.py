"""The high-level completion seam for durable run/terminal termination (CODING-465).

Terminal and run lifecycle code owns *whether* a run has ended; it must not own
what that ending means for any campaign scheduled on top of it. This module is
the one place that turns a committed termination write into an announcement, so
lifecycle code publishes a fact and subscribers — today the execution app's
subtree scheduler — decide what to do about it.

The announcement is deliberately post-commit and best-effort, mirroring
``worktracker.signals.issue_state_changed``: a subscriber never runs before the
termination is durable, and a raising subscriber can never fail the termination
write that caused it.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.dispatch import Signal

logger = logging.getLogger(__name__)

# Sent with ``agent_run_id`` once a run and/or its terminal session has durably
# been recorded as ended. Grep the ``dispatch_uid`` values to enumerate the
# current subscribers.
agent_run_terminated = Signal()


def publish_agent_run_terminated(agent_run_id: str) -> None:
    """Announce one durable termination after its transaction commits."""

    transaction.on_commit(lambda: _emit(str(agent_run_id)))


def _emit(agent_run_id: str) -> None:
    for subscriber, response in agent_run_terminated.send_robust(
        sender=None, agent_run_id=agent_run_id
    ):
        if isinstance(response, Exception):
            logger.error(
                "agent_run_terminated subscriber failed agent_run_id=%s receiver=%s",
                agent_run_id,
                getattr(subscriber, "__qualname__", subscriber),
                exc_info=response,
            )
