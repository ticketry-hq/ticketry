"""The durable routing scopes a run can carry.

A run's scope is its own discriminator — hooks can report lifecycle before the
terminal-session mirror exists, so the run row owns it. ``shell`` is the one
scope whose runs have no provider at all: a shell run's ``agent`` is null and
nothing about it may be interpreted as an agent run (#665).
"""

from __future__ import annotations

#: Every scope the persisted run record recognises, in wire order.
RUN_SCOPES: tuple[str, ...] = ("task", "plan", "instant", "docchat", "shell")

#: The scope of a run with no agent, hosting a plain interactive shell.
SHELL_SCOPE = "shell"

#: Scopes whose runs legitimately carry no ``agent``.
AGENTLESS_SCOPES = frozenset({SHELL_SCOPE})


def is_agentless_scope(scope: str | None) -> bool:
    """Whether a run in ``scope`` is expected to have no provider."""

    return scope in AGENTLESS_SCOPES
