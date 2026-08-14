"""Allowed execution modes of a durable graph run (CODING-462).

``parallel`` launches every eligible direct child in one advancement and is the
historical behaviour, so an omitted mode always resolves to it. ``serial``
records the intent to keep at most one live launched child; scheduling policy
itself lives in :mod:`apps.execution.driver`.
"""

from __future__ import annotations

PARALLEL = "parallel"
SERIAL = "serial"

EXECUTION_MODES = (PARALLEL, SERIAL)
EXECUTION_MODE_CHOICES = tuple((mode, mode.title()) for mode in EXECUTION_MODES)
DEFAULT_EXECUTION_MODE = PARALLEL


def normalize_execution_mode(value: str | None) -> str:
    """Resolve a requested mode, treating omission as ``parallel``.

    :raises ValueError: ``invalid_execution_mode`` for any other value, so the
        transport maps it through the existing structured-error path.
    """

    if value is None:
        return DEFAULT_EXECUTION_MODE
    if not isinstance(value, str):
        raise ValueError("invalid_execution_mode")
    candidate = value.strip()
    if not candidate:
        return DEFAULT_EXECUTION_MODE
    if candidate not in EXECUTION_MODES:
        raise ValueError("invalid_execution_mode")
    return candidate
