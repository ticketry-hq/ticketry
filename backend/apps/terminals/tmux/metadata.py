"""Per-session metadata round-tripped via tmux user-options.

Every Muxed session stamps a recovery snapshot into ``@pt-*`` user-options so
the transport stays self-describing when the authoritative ``AgentRun`` row is
unavailable. This module owns the option keys, the :class:`TmuxSession`
snapshot they hydrate, and the parsing/setting helpers — no lifecycle or DB.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import libtmux

from apps.terminals.tmux._core import TmuxSessionError


# Recovery-snapshot keys stamped on every session.

_OPT_AGENT_RUN_ID = "@pt-agent-run-id"
_OPT_TASK_ID = "@pt-task-id"
_OPT_MODULE_ID = "@pt-module-id"
_OPT_PROJECT_ID = "@pt-project-id"
_OPT_AGENT = "@pt-agent"
_OPT_CREATED_AT = "@pt-created-at"
_OPT_SCOPE = "@pt-scope"
_OPT_DOC_PATH = "@pt-doc-path"

_REQUIRED_OPTS = (
    _OPT_AGENT_RUN_ID,
    _OPT_TASK_ID,
    _OPT_MODULE_ID,
    _OPT_PROJECT_ID,
    _OPT_AGENT,
    _OPT_CREATED_AT,
)


@dataclass(frozen=True)
class TmuxSession:
    """Snapshot of a Muxed tmux session.

    - ``name`` is the full tmux session name (``pt-<agent_run_id>``).
    - The remaining fields mirror the ``@pt-*`` user-options stored on
      the session at create time.
    - ``created_at`` is timezone-aware UTC.
    """

    name: str
    agent_run_id: str
    task_id: str
    module_id: str
    project_id: str
    agent: str
    created_at: datetime
    scope: str
    doc_rel_path: Optional[str] = None


def _parse_show_options(lines: list[str]) -> dict[str, str]:
    """Parse ``tmux show-options`` output into ``{key: value}``.

    Each line has the shape ``<key> <value-or-quoted-value>``. Values
    wrapped in double quotes have their quotes stripped; other values
    are returned verbatim. Lines without a space are ignored.
    """

    result: dict[str, str] = {}
    for line in lines:
        if not line or " " not in line:
            continue
        key, _, raw = line.partition(" ")
        value = raw
        if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
            value = value[1:-1]
        result[key] = value
    return result


def _read_user_options(server: libtmux.Server, name: str) -> dict[str, str]:
    """Read every user-option set on ``name`` as a flat dict.

    Falls through to ``tmux show-options -t <name>`` because libtmux's
    typed option accessors do not expose user-options uniformly across
    versions; the raw command output is stable.
    """

    res = server.cmd("show-options", "-t", name)
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(f"show-options failed for {name!r}: {stderr}")
    return _parse_show_options(list(res.stdout or []))


def _set_user_option(
    server: libtmux.Server, session_name: str, key: str, value: str
) -> None:
    """Set a single user-option on a named session, raising on failure.

    Use the raw server command seam instead of constructing a high-level
    ``libtmux.Session``.  The latter reparses formatted tmux listings and is
    locale-sensitive in packaged Finder launches.
    """

    res = server.cmd("set-option", "-t", session_name, key, value)
    if res.returncode != 0:
        stderr = "\n".join(res.stderr or [])
        raise TmuxSessionError(
            f"set-option {key!r} failed for {session_name!r}: {stderr}"
        )


def _session_from_options(name: str, opts: dict[str, str]) -> Optional[TmuxSession]:
    """Build a :class:`TmuxSession` from raw user-options, or None.

    Returns ``None`` if any required option is missing or if
    ``@pt-created-at`` is not parseable as ISO8601; the caller logs
    and skips such sessions during listing.
    """

    for key in _REQUIRED_OPTS:
        if key not in opts:
            return None
    try:
        created_at = datetime.fromisoformat(opts[_OPT_CREATED_AT])
    except ValueError:
        return None
    return TmuxSession(
        name=name,
        agent_run_id=opts[_OPT_AGENT_RUN_ID],
        task_id=opts[_OPT_TASK_ID],
        module_id=opts[_OPT_MODULE_ID],
        project_id=opts[_OPT_PROJECT_ID],
        agent=opts[_OPT_AGENT],
        created_at=created_at,
        scope=opts.get(_OPT_SCOPE, "task"),
        doc_rel_path=opts.get(_OPT_DOC_PATH) or None,
    )
