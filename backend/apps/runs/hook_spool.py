"""Drain lifecycle events written by sandboxed packaged agent hooks.

Packaged hooks cannot safely re-enter the one-file Python sidecar from a
provider command sandbox, and that sandbox cannot POST to the backend's
loopback listener.  The bundled native hook transport therefore atomically
writes the provider's raw JSON into a private temp spool.  This module runs in
the backend process, normalizes each event through the existing per-provider
``HookSpec``, and hands it to the normal lifecycle ingress reducer.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from apps.terminals.agents.hooks import (
    _reporter,
    agy_hook,
    claude_hook,
    codex_hook,
    gemini_hook,
)

logger = logging.getLogger(__name__)

HOOK_SPOOL_DIR_ENV = "MUXED_HOOK_SPOOL_DIR"
POLL_INTERVAL_SECONDS = 0.1
MAX_HOOK_BYTES = 1024 * 1024
MAX_BATCH_SIZE = 256

_SPECS = {
    "agy": agy_hook.SPEC,
    "claude": claude_hook.SPEC,
    "codex": codex_hook.SPEC,
    "gemini": gemini_hook.SPEC,
}
_drain_task: asyncio.Task[None] | None = None


def _spool_directory() -> Path | None:
    raw_path = os.environ.get(HOOK_SPOOL_DIR_ENV)
    if not raw_path:
        return None
    path = Path(raw_path)
    return path if path.is_absolute() else None


def _metadata(path: Path) -> tuple[_reporter.HookSpec, str]:
    """Return the provider spec and run id encoded in one spool filename."""

    if path.suffix != ".hook":
        raise ValueError("not a hook spool file")
    version, agent, agent_run_id, nonce = path.stem.split("__", 3)
    if version != "v1" or not agent_run_id or not nonce:
        raise ValueError("invalid hook spool filename")
    try:
        spec = _SPECS[agent]
    except KeyError as exc:
        raise ValueError("unknown hook provider") from exc
    return spec, agent_run_id


async def drain_file(path: Path) -> bool:
    """Ingest and remove one complete spool file.

    Returns ``True`` only when a recognized tracked event reached the normal
    lifecycle ingress.  Malformed/unmapped events are discarded so one bad
    hook cannot poison the spool forever.
    """

    try:
        if path.is_symlink() or path.stat().st_size > MAX_HOOK_BYTES:
            raise ValueError("unsafe hook spool file")
        spec, agent_run_id = _metadata(path)
        hook_input = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(hook_input, dict):
            raise ValueError("hook payload must be an object")
        payload = _reporter.build_event_from_hook(
            spec,
            hook_input,
            agent_run_id,
            datetime.now(timezone.utc).isoformat(),
        )
        if payload is None:
            return False

        # Import lazily so ASGI startup can load this transport without
        # creating an apps.runs.api import cycle.
        from apps.runs.api import ingest_lifecycle_event

        await ingest_lifecycle_event(**payload)
        return True
    except Exception as exc:
        logger.warning("discarding invalid lifecycle hook spool file %s: %s", path, exc)
        return False
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning(
                "could not remove lifecycle hook spool file %s: %s", path, exc
            )


async def drain_once() -> int:
    """Drain one bounded batch and return the number of ingested events."""

    directory = _spool_directory()
    if directory is None:
        return 0
    try:
        paths = sorted(directory.glob("*.hook"))[:MAX_BATCH_SIZE]
    except OSError as exc:
        logger.warning("could not scan lifecycle hook spool %s: %s", directory, exc)
        return 0

    accepted = 0
    for path in paths:
        accepted += int(await drain_file(path))
    return accepted


async def _drain_loop() -> None:
    while True:
        await drain_once()
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def start() -> None:
    """Start the singleton spool consumer when packaged transport is enabled."""

    global _drain_task
    if _drain_task is not None or _spool_directory() is None:
        return
    await drain_once()
    _drain_task = asyncio.create_task(_drain_loop(), name="lifecycle-hook-spool")


async def stop() -> None:
    """Stop the spool consumer and perform one final best-effort drain."""

    global _drain_task
    task = _drain_task
    _drain_task = None
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    await drain_once()
