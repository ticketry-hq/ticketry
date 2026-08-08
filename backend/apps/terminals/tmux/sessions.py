"""Session lifecycle: create, list, look up, terminate, reconcile.

The durable record is ``AgentRun``; this module owns only the tmux transport
and returns reconciliation classifications to the run service.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import libtmux

from apps.runs.models import AgentRun
from apps.terminals.tmux._core import (
    SESSION_PREFIX,
    TmuxSessionError,
    _has_session,
    _server,
    _session_name,
    tmux_socket,
)
from apps.terminals.tmux.metadata import (
    _OPT_AGENT,
    _OPT_AGENT_RUN_ID,
    _OPT_CREATED_AT,
    _OPT_DOC_PATH,
    _OPT_MODULE_ID,
    _OPT_PROJECT_ID,
    _OPT_SCOPE,
    _OPT_TASK_ID,
    TmuxSession,
    _read_user_options,
    _session_from_options,
    _set_user_option,
)


logger = logging.getLogger(__name__)


def session_name_for(agent_run_id: str) -> str:
    """Return the deterministic tmux session name for a run."""

    return _session_name(agent_run_id)


def terminal_owner_id() -> str:
    """Return the stable identity of this profile's terminal transport."""

    return tmux_socket()


@dataclass(frozen=True)
class ReconcileResult:
    """Outcome of one reconciliation pass over active terminal-backed runs.

    - ``soft_deleted`` holds the id of every active run whose tmux session was
      gone and must be ended as lost by the run service.
    - ``exited`` holds runs whose tmux session survived with a dead provider
      pane. Those are cleanly classifiable provider exits, not lost sessions.
    - ``untracked`` holds live tmux sessions with no active row in this
      database. Reconciliation reports but never terminates them because they
      may belong to another profile.
    """

    soft_deleted: list[str]
    untracked: list[str] = field(default_factory=list)
    exited: list[str] = field(default_factory=list)
    inventory_available: bool = True


def create_session(
    *,
    agent_run_id: str,
    task_id: str,
    module_id: str,
    project_id: str,
    agent: str,
    command: str,
    cwd: str,
    scope: str = "task",
    doc_rel_path: Optional[str] = None,
) -> TmuxSession:
    """Create a detached tmux session for an agent run.

    :param agent_run_id: Stable id for the run; becomes part of the
        session name and is stored as ``@pt-agent-run-id``.
    :param task_id: WorkTracker work-item id this run belongs to (the reserved
        scratch sentinel for no-task plan/instant runs).
    :param module_id: WorkTracker module id this run belongs to.
    :param project_id: WorkTracker project id this run belongs to.
    :param agent: Agent slug (e.g. ``"claude-code"``).
    :param command: Shell command to run inside the session.
    :param cwd: Working directory for the session's first window.
    :param scope: Run scope: ``"task"``, ``"plan"``, ``"instant"``, or
        ``"docchat"`` (#625).
    :param doc_rel_path: for a doc-chat run, the design-dir-relative .html it is
        scoped to; stamped as ``@pt-doc-path`` so it survives a backend restart.
    :return: A populated :class:`TmuxSession` describing the new session.
    :raises TmuxSessionError: If session creation or option setting fails.
    """

    name = _session_name(agent_run_id)
    created_at = datetime.now(timezone.utc)
    server = _server()

    # Refuse to clobber an existing session for this run id.

    if _has_session(server, name):
        raise TmuxSessionError(f"tmux session {name!r} already exists")

    # Stay on Ticketry's raw-command seam.  ``libtmux.Server.new_session``
    # creates the session and then resolves its returned id by parsing a
    # formatted ``list-sessions`` response.  In a Finder-launched app with no
    # locale variables, tmux sanitizes libtmux's Unicode record separator,
    # causing that lookup to fail after the session was already created.
    # Start with tmux's default shell as a stable setup pane. Some providers
    # can fail or exit immediately; launching them here would let the final
    # pane disappear before remain-on-exit and the metadata options are set.
    res = server.cmd("new-session", "-d", "-s", name, "-c", cwd)
    if res.returncode != 0 or res.stderr:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(f"new-session failed for {name!r}: {stderr}")

    # Keep the tmux object after its provider command exits. Reconciliation can
    # then observe pane_dead and publish an ordinary `exited` lifecycle event
    # instead of discovering a vanished target and reporting `session lost`.
    res = server.cmd(
        "set-option", "-w", "-t", name, "remain-on-exit", "on"
    )
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        server.cmd("kill-session", "-t", name)
        raise TmuxSessionError(
            f"set-option remain-on-exit on failed for {name!r}: {stderr}"
        )

    # Stable detached resizes; libtmux has no typed setter for this.

    res = server.cmd("set-option", "-t", name, "window-size", "manual")
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(
            f"set-option window-size manual failed for {name!r}: {stderr}"
        )

    res = server.cmd("set-option", "-t", name, "status", "off")
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(f"set-option status off failed for {name!r}: {stderr}")

    # Note: tmux ``mouse`` mode is intentionally left OFF. Turning it on would
    # make wheel scroll work via copy-mode, but tmux would then also claim
    # click-drag, breaking xterm's native text selection. Instead the frontend
    # bridges wheel events to :func:`scroll`, which drives copy-mode without
    # enabling mouse reporting — scroll works and selection survives (#578).

    # Stamp all metadata user-options.

    values = {
        _OPT_AGENT_RUN_ID: agent_run_id,
        _OPT_TASK_ID: task_id,
        _OPT_MODULE_ID: module_id,
        _OPT_PROJECT_ID: project_id,
        _OPT_AGENT: agent,
        _OPT_CREATED_AT: created_at.isoformat(),
        _OPT_SCOPE: scope,
    }
    # Only doc-chat runs carry a doc path; never stamp an empty option.
    if doc_rel_path:
        values[_OPT_DOC_PATH] = doc_rel_path
    for key, value in values.items():
        _set_user_option(server, name, key, value)

    snapshot = TmuxSession(
        name=name,
        agent_run_id=agent_run_id,
        task_id=task_id,
        module_id=module_id,
        project_id=project_id,
        agent=agent,
        created_at=created_at,
        scope=scope,
        doc_rel_path=doc_rel_path,
    )

    # The AgentRun was persisted before this call. Replace the setup shell with
    # the provider command; even an immediate exit leaves a retained dead pane
    # that reconciliation can classify.
    res = server.cmd("respawn-pane", "-k", "-t", name, command)
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        server.cmd("kill-session", "-t", name)
        raise TmuxSessionError(f"respawn-pane failed for {name!r}: {stderr}")

    logger.info("tmux session created name=%s agent_run_id=%s", name, agent_run_id)
    return snapshot


def list_sessions() -> list[TmuxSession]:
    """Return every Muxed session on the dedicated socket.

    Only sessions whose names start with :data:`SESSION_PREFIX` are
    considered; others on the same socket are ignored. Sessions that
    fail metadata parsing are skipped with a warning rather than
    raising, so a single corrupted entry cannot break listing.
    """

    server = _server()

    # No server yet means no sessions; treat as empty, not an error.

    res = server.cmd("list-sessions", "-F", "#{session_name}")
    if res.returncode != 0:
        return []

    sessions: list[TmuxSession] = []
    for name in res.stdout or []:
        if not name.startswith(SESSION_PREFIX):
            continue
        try:
            opts = _read_user_options(server, name)
        except TmuxSessionError as exc:
            logger.warning("skipping session %s: %s", name, exc)
            continue
        parsed = _session_from_options(name, opts)
        if parsed is None:
            logger.warning("skipping session %s: missing or bad metadata", name)
            continue
        sessions.append(parsed)
    return sessions


def get_session(agent_run_id: str) -> Optional[TmuxSession]:
    """Look up a session by ``agent_run_id``.

    :param agent_run_id: Run id whose session should be returned.
    :return: The matching :class:`TmuxSession`, or ``None`` if either
        the session is gone or its metadata cannot be parsed.
    """

    name = _session_name(agent_run_id)
    server = _server()
    if not _has_session(server, name):
        return None
    try:
        opts = _read_user_options(server, name)
    except TmuxSessionError:
        return None
    return _session_from_options(name, opts)


def terminate_session(agent_run_id: str) -> bool:
    """Kill the tmux session for ``agent_run_id`` if it exists.

    :param agent_run_id: Run id whose session should be killed.
    :return: ``True`` if a session existed and was killed; ``False``
        if no such session was present.
    :raises TmuxSessionError: If ``kill-session`` fails for a session
        that was reported to exist.
    """

    name = _session_name(agent_run_id)
    server = _server()
    if not _has_session(server, name):
        return False
    res = server.cmd("kill-session", "-t", name)
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(f"kill-session failed for {name!r}: {stderr}")
    logger.info("tmux session terminated name=%s agent_run_id=%s", name, agent_run_id)
    return True


def _live_session_births(server: libtmux.Server) -> dict[str, float] | None:
    """Return live ``pt-`` session names and their Unix creation times.

    Unlike :func:`list_sessions` this ignores metadata entirely: a session
    with missing or corrupt user-options still counts as live so its DB row
    is never wrongly soft-deleted. An absent server is returned as ``None``:
    one missing socket observation is not sufficient authority to bulk-expire
    durable database rows. Any other listing failure is uncertain and aborts
    reconciliation.
    """

    res = server.cmd(
        "list-sessions", "-F", "#{session_name}|#{session_created}"
    )
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        absent_server = (
            "no server running on" in stderr.lower()
            or "no such file or directory" in stderr.lower()
        )
        if absent_server:
            return None
        raise TmuxSessionError(
            f"list-sessions failed while reconciling terminal sessions: {stderr}"
        )
    births: dict[str, float] = {}
    for line in res.stdout or []:
        try:
            name, created = line.split("|", 1)
            created_at = float(created)
        except (TypeError, ValueError):
            logger.warning("skipping malformed tmux session listing: %r", line)
            continue
        if name.startswith(SESSION_PREFIX):
            births[name] = created_at
    return births


def _dead_session_names(server: libtmux.Server) -> set[str]:
    """Return Ticketry sessions whose provider panes have all exited.

    A failed inspection returns an empty set. Uncertainty must preserve a
    session; a later reconciliation can classify it once tmux is readable.
    """

    res = server.cmd(
        "list-panes", "-a", "-F", "#{session_name}|#{pane_dead}"
    )
    if res.returncode != 0:
        return set()
    pane_states: dict[str, list[bool]] = {}
    for line in res.stdout or []:
        try:
            name, dead = line.split("|", 1)
        except ValueError:
            logger.warning("skipping malformed tmux pane listing: %r", line)
            continue
        if not name.startswith(SESSION_PREFIX) or dead not in {"0", "1"}:
            continue
        pane_states.setdefault(name, []).append(dead == "1")
    return {
        name
        for name, states in pane_states.items()
        if states and all(states)
    }


def reconcile_sessions() -> ReconcileResult:
    """Reconcile active agent runs against live tmux reality.

    For every active ``AgentRun`` whose tmux session no longer exists, report
    it so the run service can end it. Live tmux sessions are authoritative and
    are never terminated by reconciliation, even when this database has no
    run for them.

    Idempotent: only active runs are inspected. Rows are deliberately left
    untouched here; the run service owns lifecycle persistence.

    Synchronous like the rest of this module; callers in the Django layer
    wrap it with ``asyncio.to_thread``. The DB phase uses direct sync ORM.

    :return: a :class:`ReconcileResult` naming soft-deleted rows, naturally
        exited rows, and live sessions untracked by this database.
    """

    server = _server()
    live_births = _live_session_births(server)
    if live_births is None:
        logger.warning(
            "reconcile preserved terminal rows because tmux server is unavailable"
        )
        return ReconcileResult(soft_deleted=[], inventory_available=False)
    live_names = set(live_births)
    dead_names = _dead_session_names(server) & live_names

    runs = list(
        AgentRun.objects.filter(
            ended_at__isnull=True,
            terminal_owner_id__isnull=False,
        ).only("id")
    )
    recorded = {_session_name(run.id): run.id for run in runs}
    recorded_names = set(recorded)
    exited = [recorded[name] for name in sorted(recorded_names & dead_names)]
    soft_deleted = [
        recorded[name]
        for name in sorted(recorded_names - live_names)
        if name not in dead_names
    ]

    # A retained dead pane has now been durably classified. Remove its tmux
    # shell so it cannot be offered as attachable on the next list.
    for name in dead_names & recorded_names:
        res = server.cmd("kill-session", "-t", name)
        if res.returncode != 0:
            stderr = "\n".join(res.stderr or [])
            logger.warning("dead session cleanup failed name=%s: %s", name, stderr)

    # A row-less live session may belong to another Ticketry profile. It is not
    # reconciliation's property to destroy. Report it for diagnostics and
    # leave the provider running.
    untracked = sorted(live_names - recorded_names)

    if soft_deleted or exited or untracked:
        logger.info(
            "reconcile soft_deleted=%d exited=%d untracked=%d",
            len(soft_deleted),
            len(exited),
            len(untracked),
        )
    return ReconcileResult(
        soft_deleted=soft_deleted,
        untracked=untracked,
        exited=exited,
    )
