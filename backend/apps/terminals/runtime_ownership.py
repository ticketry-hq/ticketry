"""Which terminal runtime owns a recorded run.

Two Studio instances on one machine can share a data directory — and therefore
the run records and the credential-signing secret — while each owns its own
terminal runtime on its own tmux socket. Reconciliation already scopes every
sweep to its own ``runtime_namespace`` so a foreign reconciler cannot
manufacture a terminal death. Explicit termination needs the same scoping for
the same reason: killing a pane that lives on the other runtime's socket
silently kills nothing, and recording the ending anyway leaves a live agent
that the application believes has exited.

Ownership is read from the persisted terminal session rather than inferred from
an observation, because a missing pane and a foreign pane look identical from
here and mean opposite things.
"""

from __future__ import annotations

from django.db import close_old_connections

from apps.terminals.models import AgentTerminalSession
from apps.terminals.runtime import TerminalRuntime


class ForeignRuntimeRun(Exception):
    """The run's terminal session belongs to another Studio runtime."""

    code = "run_owned_by_other_runtime"

    def __init__(self, agent_run_id: str, owner_namespace: str) -> None:
        super().__init__(self.code)
        self.agent_run_id = agent_run_id
        self.owner_namespace = owner_namespace


def owning_runtime_namespace(agent_run_id: str) -> str | None:
    """Return the runtime namespace recorded for ``agent_run_id``, if any."""

    try:
        return (
            AgentTerminalSession.objects.filter(agent_run_id=agent_run_id)
            .values_list("runtime_namespace", flat=True)
            .first()
        )
    finally:
        close_old_connections()


def assert_runtime_owns_run(agent_run_id: str, *, runtime: TerminalRuntime) -> None:
    """Refuse a termination this runtime cannot actually carry out.

    A run with no terminal session row, or a row from before namespaces were
    recorded, is deliberately treated as ownable: termination is idempotent, and
    refusing those would break the ordinary local case to guard a hypothetical
    one. Only a row that names a *different* live runtime is refused.

    :raises ForeignRuntimeRun: when another runtime created this run's pane.
    """

    owner = owning_runtime_namespace(agent_run_id)
    if owner is None:
        return
    owned = (runtime.namespace, *runtime.legacy_namespaces)
    if owner in owned:
        return
    raise ForeignRuntimeRun(agent_run_id, owner)
