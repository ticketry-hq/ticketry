"""One-shot claims for composed launches that replace state-entry auto-start."""

from __future__ import annotations

from threading import Lock


_PENDING_TARGETS: set[str] = set()
_PENDING_TARGETS_GUARD = Lock()


def claim(target_id: str) -> None:
    """Suppress the next auto-start event emitted for this target."""

    with _PENDING_TARGETS_GUARD:
        _PENDING_TARGETS.add(target_id)


def consume(target_id: str) -> bool:
    """Consume and report a pending suppression claim for this target."""

    with _PENDING_TARGETS_GUARD:
        if target_id not in _PENDING_TARGETS:
            return False
        _PENDING_TARGETS.remove(target_id)
        return True


def release(target_id: str) -> None:
    """Release a claim when its state transition did not commit."""

    with _PENDING_TARGETS_GUARD:
        _PENDING_TARGETS.discard(target_id)
