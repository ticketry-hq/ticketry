"""Launch-time delivery of short manual input to a ready provider pane."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable

from apps.terminals.runtime import TerminalRuntime


PROMPT_READINESS_TIMEOUT_SECONDS = 30.0
PROMPT_READINESS_POLL_SECONDS = 0.05


class PromptDeliveryTimeout(RuntimeError):
    """The provider never exposed its declared input-ready marker."""


async def _wait_until_ready(
    *,
    runtime: TerminalRuntime,
    agent_run_id: str,
    is_ready: Callable[[bytes], bool],
    timeout: float,
    poll_interval: float,
) -> None:
    deadline = time.monotonic() + timeout
    while True:
        screen = await asyncio.to_thread(runtime.capture_screen, agent_run_id)
        if is_ready(screen):
            return
        if time.monotonic() >= deadline:
            raise PromptDeliveryTimeout(agent_run_id)
        await asyncio.sleep(poll_interval)


async def submit_entry_skill(
    *,
    runtime: TerminalRuntime,
    agent_run_id: str,
    command: str,
    is_ready: Callable[[bytes], bool],
    timeout: float = PROMPT_READINESS_TIMEOUT_SECONDS,
    poll_interval: float = PROMPT_READINESS_POLL_SECONDS,
) -> None:
    """Wait for the idle composer, then submit one entry-skill command."""

    await _wait_until_ready(
        runtime=runtime,
        agent_run_id=agent_run_id,
        is_ready=is_ready,
        timeout=timeout,
        poll_interval=poll_interval,
    )
    await asyncio.to_thread(runtime.submit_text, agent_run_id, command)


async def stage_resume_prompt(
    *,
    runtime: TerminalRuntime,
    agent_run_id: str,
    prompt: str,
    is_ready: Callable[[bytes], bool],
    timeout: float = PROMPT_READINESS_TIMEOUT_SECONDS,
    poll_interval: float = PROMPT_READINESS_POLL_SECONDS,
) -> None:
    """Wait for the idle composer, then type ``prompt`` without submitting."""

    await _wait_until_ready(
        runtime=runtime,
        agent_run_id=agent_run_id,
        is_ready=is_ready,
        timeout=timeout,
        poll_interval=poll_interval,
    )
    await asyncio.to_thread(runtime.stage_text, agent_run_id, prompt)
