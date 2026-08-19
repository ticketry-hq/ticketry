"""The one channel the terminal capability asks where a run may start.

Rust owns Documents and Worktrees. The still-Python terminal capability still
spawns the agent process, so it still needs two directories: the working
directory to run in, and the design directory the run writes artifacts into.
It used to read both for itself — the `worktrees` index through the ORM, the
`design_documents` registry through a DAO, and the design directory straight
off the filesystem. After the handoff it may do none of that, so it asks here
instead.

What makes this safe is the shape of the question, not a promise about the
answer:

* Every argument is an identity or a scope. There is no parameter here for a
  path, a Git argument, a document body, a branch, or a model field, so there
  is nothing a caller — including a compromised one — could point somewhere.
* There is no verb. This module cannot create, save, prune, discard, or
  integrate; it resolves, and Rust performs whatever derived effect resolution
  implies inside its own authorized roots.
* An unavailable runtime is an error, never a fallback. Guessing a directory
  would launch an agent somewhere nobody authorized, which is worse than not
  launching at all.

The transport deliberately stays separate from :mod:`apps.runs.rust_port`:
that module speaks the Runs write routes, this one speaks exactly one
read-only workspace route, and keeping them apart keeps that fact checkable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx


DEFAULT_TIMEOUT_SECONDS = 10.0

#: The per-launch credential the supervisor issues the sidecar, shared with the
#: Runs ingress because it is the same loopback listener and trust boundary.
CREDENTIAL_ENV = "MUXED_SIDECAR_CREDENTIAL"

#: The single route this port speaks. It is read-only by construction.
ROUTE = "/workspace/launch-paths"

#: Bumped only alongside the Rust request contract, so a stale sidecar is
#: refused rather than misread.
CONTRACT_VERSION = 1

LaunchScope = Literal["task", "plan", "instant", "docchat"]


class LaunchPathsUnavailable(RuntimeError):
    """Rust could not answer. The launch must fail rather than guess."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class LaunchPaths:
    """Where one run starts, and why.

    ``working_directory`` is ``None`` when the run is not isolated, which means
    the caller keeps the module folder it already resolved. ``design_directory``
    is ``None`` when no authorized root could be resolved at all; the launch
    still proceeds, without document sourcing.
    """

    working_directory: Optional[str] = None
    design_directory: Optional[str] = None
    design_directory_relative: Optional[str] = None
    module_directory_name: Optional[str] = None
    document_relative_path: Optional[str] = None
    worktree_used: bool = False
    worktree_state: Optional[str] = None
    worktree_reason: str = "not_applicable"


def resolve(
    *,
    scope: LaunchScope,
    agent_run_id: str,
    project_id: str,
    module_id: Optional[str] = None,
    task_id: Optional[str] = None,
    document_id: Optional[str] = None,
) -> LaunchPaths:
    """Resolve one run's authorized directories.

    Raises :class:`LaunchPathsUnavailable` when the runtime is unconfigured,
    unreachable, or refuses the request.
    """

    body = _post(
        {
            "version": CONTRACT_VERSION,
            "scope": scope,
            "agent_run_id": agent_run_id,
            "project_id": project_id,
            "module_id": module_id,
            "task_id": task_id,
            "document_id": document_id,
        }
    )
    paths = body.get("paths")
    if not isinstance(paths, dict):
        raise LaunchPathsUnavailable("launch_paths_invalid_response")
    worktree = paths.get("worktree") or {}
    return LaunchPaths(
        working_directory=paths.get("working_directory"),
        design_directory=paths.get("design_directory"),
        design_directory_relative=paths.get("design_directory_relative"),
        module_directory_name=paths.get("module_directory_name"),
        document_relative_path=paths.get("document_relative_path"),
        worktree_used=bool(worktree.get("used")),
        worktree_state=worktree.get("state"),
        worktree_reason=str(worktree.get("reason") or "not_applicable"),
    )


def _base_url() -> str:
    """Derive the workspace ingress root from the MCP URL the launcher published."""

    mcp_url = os.environ.get("WORKTRACKER_MCP_URL", "").strip()
    if not mcp_url:
        raise LaunchPathsUnavailable("launch_paths_unconfigured")
    parts = urlsplit(mcp_url)
    if not parts.scheme or not parts.netloc:
        raise LaunchPathsUnavailable("launch_paths_unconfigured")
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def _credential() -> str:
    credential = os.environ.get(CREDENTIAL_ENV, "").strip()
    if not credential:
        raise LaunchPathsUnavailable("launch_paths_unauthenticated")
    return credential


def _post(payload: dict) -> dict:
    try:
        response = httpx.post(
            f"{_base_url()}{ROUTE}",
            json=payload,
            headers={"x-api-key": _credential()},
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        raise LaunchPathsUnavailable("launch_paths_unreachable") from None
    try:
        body = response.json()
    except ValueError:
        raise LaunchPathsUnavailable("launch_paths_invalid_response") from None
    if response.status_code != 200 or body.get("ok") is not True:
        raise LaunchPathsUnavailable(str(body.get("code") or "launch_paths_failed"))
    return body
