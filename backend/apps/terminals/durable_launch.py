"""The persist-then-create transaction shared by every durable terminal launch.

Two launch paths reach a durable terminal: agent launch
(:mod:`apps.terminals.launch`) and module shell launch
(:mod:`apps.terminals.shell_launch`). Both must create their application
records and their terminal runtime as one unit — a failure on either side may
leave neither an orphan row nor an orphan pane. That guarantee lives here,
once, so the two paths cannot drift apart.

Everything policy-shaped — which agent, which prompt, which working directory —
is already decided by the caller. This module receives a finished
:class:`~apps.terminals.persistence.LaunchRecords`, a hosted command and an
environment, and answers only "did both sides commit".

The runtime is an explicit parameter rather than a module import: the
process-wide instance is owned by :mod:`apps.terminals.launch`, and reading it
at call time is what lets tests substitute the in-memory runtime.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Mapping

from apps.terminals.agents.registry import cleanup_temporary_artifacts
from apps.terminals.persistence import (
    LaunchRecords,
    LaunchRouting,
    compensate_launch,
    mark_launch_cleanup_pending,
    persist_launch,
    launch_effect_id,
    settle_launch,
)
from apps.terminals.runtime import (
    CreateTerminal,
    TerminalDimensions,
    TerminalRuntime,
)

logger = logging.getLogger(__name__)

#: Geometry a durable terminal is created with, before any viewer attaches and
#: resizes it to the surface actually presenting it.
INITIAL_TERMINAL_DIMENSIONS = TerminalDimensions(columns=80, rows=24)


class LaunchUnavailable(Exception):
    """The persisted launch could not complete.

    Raised when persistence or runtime creation fails. :func:`create_durable_run`
    terminates any partial runtime and deletes orphan application rows before
    raising. If termination cannot be confirmed, it preserves a cleanup-pending
    application handle for reconciliation.
    """


async def create_durable_run(
    *,
    runtime: TerminalRuntime,
    records: LaunchRecords,
    command: str,
    environment: Mapping[str, str],
    temporary_artifacts: tuple[Path, ...] = (),
) -> LaunchRouting:
    """Record one run and start its terminal, or leave nothing behind.

    :param runtime: the public terminal runtime this launch is created on.
    :param records: the already-decided application records for this launch.
    :param command: the hosted command the runtime executes.
    :param environment: extra environment for the hosted command; an agentless
        launch passes an empty mapping and so inherits nothing agent-specific.
    :param temporary_artifacts: run-scoped files the caller created for this
        launch, removed here only when compensation is confirmed complete.
    :return: the routing facts persistence derived from the run's work item.
    :raises LaunchUnavailable: on persistence/runtime failure; launch records
        are deleted after runtime cleanup is confirmed or retained for retry.
    """

    agent_run_id = records.agent_run_id
    launch_persisted = False
    try:
        routing = await asyncio.to_thread(
            persist_launch,
            records,
            command=command,
            environment=environment,
        )
        launch_persisted = True
        await asyncio.to_thread(
            runtime.create,
            CreateTerminal(
                agent_run_id=agent_run_id,
                command=command,
                working_directory=records.cwd,
                environment=dict(environment),
                dimensions=INITIAL_TERMINAL_DIMENSIONS,
            ),
        )
        await asyncio.to_thread(
            settle_launch,
            launch_effect_id(agent_run_id),
            applied=True,
            runtime_id=agent_run_id,
        )
        return routing
    except Exception as exc:
        # Runtime creation can fail after making a partial terminal. Explicitly
        # compensate both sides; terminate is idempotent when nothing exists.
        logger.exception("terminal launch failed run=%s", agent_run_id)
        cleanup_confirmed = not launch_persisted
        if launch_persisted:
            try:
                await asyncio.to_thread(runtime.terminate, agent_run_id)
                cleanup_confirmed = True
            except Exception:
                logger.warning(
                    "terminal launch compensation failed run=%s",
                    agent_run_id,
                    exc_info=True,
                )
                try:
                    await asyncio.to_thread(mark_launch_cleanup_pending, agent_run_id)
                except Exception:
                    logger.exception(
                        "could not mark terminal launch cleanup pending run=%s",
                        agent_run_id,
                    )
        if cleanup_confirmed:
            try:
                await asyncio.to_thread(compensate_launch, agent_run_id)
            except Exception:
                pass
            cleanup_temporary_artifacts(temporary_artifacts)
        raise LaunchUnavailable(str(exc)) from exc
