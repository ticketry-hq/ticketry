"""Single-flight background scheduling for terminal reconciliation."""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from django.db import close_old_connections

from apps.terminals.reconciliation import reconcile_terminals


logger = logging.getLogger(__name__)


class TerminalReconciliationScheduler:
    """Submit at most one best-effort reconciliation job at a time."""

    def __init__(
        self,
        *,
        reconcile: Callable[[], object],
        submit: Callable[[Callable[[], None]], object],
    ) -> None:
        self._reconcile = reconcile
        self._submit = submit
        self._lock = Lock()
        self._in_flight = False

    def schedule(self) -> bool:
        """Start a reconciliation job, or coalesce into the running job."""

        with self._lock:
            if self._in_flight:
                return False
            self._in_flight = True

        try:
            self._submit(self._run)
        except Exception:
            with self._lock:
                self._in_flight = False
            logger.warning("terminal reconciliation submission failed", exc_info=True)
            return False
        return True

    def _run(self) -> None:
        try:
            try:
                close_old_connections()
                self._reconcile()
            except Exception:
                logger.warning(
                    "background terminal reconciliation failed", exc_info=True
                )
            finally:
                close_old_connections()
        except Exception:
            logger.warning("terminal reconciliation cleanup failed", exc_info=True)
        finally:
            # Releasing the slot must be the last thing that can fail, or a
            # cleanup error would jam the scheduler for the process lifetime.
            with self._lock:
                self._in_flight = False


_executor = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="terminal-reconciliation",
)
_scheduler = TerminalReconciliationScheduler(
    reconcile=reconcile_terminals,
    submit=_executor.submit,
)


def schedule_terminal_reconciliation() -> bool:
    """Schedule a best-effort sweep without delaying the calling request."""

    return _scheduler.schedule()
