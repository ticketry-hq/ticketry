"""Session lifecycle: create, list, look up, terminate, reconcile.

These are the DB-touching helpers — each mirrors a tmux session into the
``AgentTerminalSession`` table and, because it runs inside an
``asyncio.to_thread`` worker, closes stale per-thread connections before
returning. ``agent_runs`` rows are owned elsewhere and never touched here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import django.db
import libtmux

from apps.terminals.models import AgentTerminalSession
from apps.terminals.tmux._core import (
    SESSION_PREFIX,
    TmuxSessionError,
    _has_session,
    _server,
    _session_name,
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

@dataclass(frozen=True)
class ReconcileResult:
    """Outcome of one reconciliation pass over the terminal-session table.

    - ``soft_deleted`` holds the ``agent_run_id`` of every active row whose
      tmux session was gone and was therefore soft-deleted.
    - ``exited`` holds rows whose tmux session survived with a dead provider
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

    # Commit the mirror row before starting the provider. A failed insert can
    # then roll back only the inert setup shell rather than killing live work.
    # This runs in an asyncio.to_thread worker, so close the thread connection.

    try:
        AgentTerminalSession.objects.create(
            agent_run_id=agent_run_id,
            tmux_session_name=name,
            task_id=task_id,
            module_id=module_id,
            project_id=project_id,
            agent=agent,
            created_at=created_at.isoformat(),
            scope=scope,
            doc_rel_path=doc_rel_path,
        )
    except Exception as exc:
        # No provider has started yet; discard the incomplete setup shell.
        server.cmd("kill-session", "-t", name)
        raise TmuxSessionError(
            f"persist session metadata failed for {name!r}: {exc}"
        ) from exc
    finally:
        django.db.close_old_connections()

    # All durability, identity, and database state is now in place. Replace
    # the setup shell with the provider command; even an immediate exit leaves
    # a retained dead pane that reconciliation can classify.
    res = server.cmd("respawn-pane", "-k", "-t", name, command)
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        server.cmd("kill-session", "-t", name)
        terminated_at = datetime.now(timezone.utc).isoformat()
        try:
            AgentTerminalSession.objects.filter(
                agent_run_id=agent_run_id,
                terminated_at__isnull=True,
            ).update(terminated_at=terminated_at)
        finally:
            django.db.close_old_connections()
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
    terminated_at = datetime.now(timezone.utc).isoformat()

    # Soft-delete the metadata row with a direct sync ORM update; this runs
    # in an asyncio.to_thread worker, so close the thread connection.

    try:
        AgentTerminalSession.objects.filter(
            agent_run_id=agent_run_id,
            terminated_at__isnull=True,
        ).update(terminated_at=terminated_at)
    except Exception as exc:
        raise TmuxSessionError(
            f"soft-delete session metadata failed for {name!r}: {exc}"
        ) from exc
    finally:
        django.db.close_old_connections()
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
    """Reconcile the terminal-session table against live tmux reality.

    For every active row (``terminated_at IS NULL``) whose tmux session no
    longer exists, soft-delete the row so it stops being offered as
    attachable. Live tmux sessions are authoritative and are never terminated
    by reconciliation, even when this database has no row for them.

    Idempotent: only active rows are inspected. ``agent_runs`` rows are
    deliberately left untouched (owned by the run reconciler).

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

    # Soft-delete dead rows and capture the names still backed by an active
    # row, all with direct sync ORM in this to_thread worker.

    try:
        rows = list(AgentTerminalSession.objects.filter(terminated_at__isnull=True))
        terminated_at = datetime.now(timezone.utc).isoformat()
        soft_deleted: list[str] = []
        exited: list[str] = []
        for row in rows:
            if row.tmux_session_name in dead_names:
                AgentTerminalSession.objects.filter(
                    agent_run_id=row.agent_run_id,
                    terminated_at__isnull=True,
                ).update(terminated_at=terminated_at)
                exited.append(row.agent_run_id)
                continue
            if row.tmux_session_name in live_names:
                continue
            AgentTerminalSession.objects.filter(
                agent_run_id=row.agent_run_id,
                terminated_at__isnull=True,
            ).update(terminated_at=terminated_at)
            soft_deleted.append(row.agent_run_id)
        recorded_names = {row.tmux_session_name for row in rows}
    finally:
        django.db.close_old_connections()

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
