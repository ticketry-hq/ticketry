"""Launch policy for a durable login shell rooted in a module folder (#666).

A *shell run* is a run with no agent (#665): its work item is the module
itself, its task is the scratch sentinel, and its scope is
:data:`~apps.runs.run_scopes.SHELL_SCOPE`. Its durable terminal hosts the
person's own login shell rather than a provider CLI.

This is a distinct entry point beside agent launch, not a branch inside it. It
resolves no adapter, builds no prompt, resolves no skills and reads no launch
configuration; it produces a login-shell command and a working directory and
hands them to the shared durable-launch transaction, so a shell run inherits
the same all-or-nothing guarantee as an agent run.

It deliberately diverges from agent launch on one point: the working directory
is the profile's module folder and **nothing else**. Agent launch falls back to
the home directory when a module folder is unset or stale, because an agent
carries a prompt that can explain where it is. A bare shell cannot, and a shell
that appears to be in your repository but is not fails silently and
destructively — so the launch is refused instead.
"""

from __future__ import annotations

import asyncio
import os
import shlex
import uuid
from datetime import datetime, timezone

from apps.runs.bus import publish_status
from apps.runs.run_scopes import SHELL_SCOPE
from apps.settings_store.config import (
    NoConfigurationSelected,
    module_link_path,
    resolve_profile,
)
from apps.terminals.durable_launch import create_durable_run
from apps.terminals.persistence import LaunchRecords
from studio_server.contracts import AgentLifecycleFrame, RunRecord


class ShellLaunchRefused(Exception):
    """A module cannot host a shell, and no runtime or record was created.

    ``reason`` is the stable code the surface renders its remedy from; every
    reason here means "point this module at a real folder first".
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def resolve_module_shell_directory(module_id: str) -> str:
    """Return the module folder a shell may be rooted in, or refuse.

    The three refusals are kept apart because they are three different things
    to tell a person: nothing is configured, what was configured is gone, or
    what was configured is not a directory at all. None of them falls back.
    """

    try:
        profile = resolve_profile(None)
    except NoConfigurationSelected as exc:
        raise ShellLaunchRefused("no_profile_selected") from exc
    module_folder = module_link_path(profile, module_id)
    if not module_folder:
        raise ShellLaunchRefused("module_folder_unset")
    if not os.path.exists(module_folder):
        raise ShellLaunchRefused("module_folder_missing")
    if not os.path.isdir(module_folder):
        raise ShellLaunchRefused("module_folder_not_a_directory")
    return module_folder


def login_shell_command() -> str:
    """Return the hosted command for one interactive login shell.

    ``SHELL`` is the person's own choice and is preferred; the account's
    configured shell is the fallback when the environment does not carry one.

    ``NO_COLOR`` is dropped for the same reason agent launch drops it: Ticketry
    is often started by a host that sets it for its own captured output, and
    that host-only preference must not leak into an interactive terminal.
    """

    shell = os.environ.get("SHELL") or _account_shell() or "/bin/sh"
    return shlex.join(["env", "-u", "NO_COLOR", shell, "-l"])


def _account_shell() -> str | None:
    try:
        import pwd

        return pwd.getpwuid(os.getuid()).pw_shell or None
    except Exception:
        return None


async def launch_module_shell(module_id: str) -> str:
    """Create one durable login shell for a module and return its run id.

    :param module_id: the module work item the shell hangs off; it is also the
        run's issue, so persistence derives the project and the scratch task
        sentinel from it exactly as a taskless scratch run does.
    :raises ShellLaunchRefused: the module has no usable folder. Nothing is
        persisted and no runtime is created.
    :raises ~apps.terminals.durable_launch.LaunchUnavailable: persistence or
        runtime creation failed; both records are compensated.
    """

    # Read the runtime instance at call time: it is process-wide state owned by
    # the agent-launch module, and substituting it is how tests drive this
    # service against the public protocol rather than tmux.
    from apps.terminals.launch import terminal_runtime

    cwd = await asyncio.to_thread(resolve_module_shell_directory, module_id)
    agent_run_id = uuid.uuid4().hex
    started_at = datetime.now(timezone.utc).isoformat()

    routing = await create_durable_run(
        runtime=terminal_runtime,
        records=LaunchRecords(
            agent_run_id=agent_run_id,
            issue_id=module_id,
            # No provider at all — never a placeholder slug (#665).
            agent=None,
            started_at=started_at,
            cwd=cwd,
            design_dir=None,
            resumed_from=None,
            scope=SHELL_SCOPE,
            doc_rel_path=None,
            runtime_namespace=terminal_runtime.namespace,
        ),
        command=login_shell_command(),
        # A shell has no hooks to report with, so it is handed none of the
        # agent lifecycle environment.
        environment={},
    )

    # Announce the live run on the same status seam every launch uses, so a
    # surface learns about the shell immediately instead of waiting for a
    # lifecycle event that a shell will never produce.
    await publish_status(
        routing.project_id,
        AgentLifecycleFrame(
            at=started_at,
            run=RunRecord(
                agent_run_id=agent_run_id,
                project_id=routing.project_id,
                task_id=routing.task_id,
                module_id=routing.module_id,
                agent=None,
                scope=SHELL_SCOPE,
                started_at=started_at,
                state="starting",
                updated_at=started_at,
                last_output_at=started_at,
            ),
        ).model_dump(),
    )
    return agent_run_id
