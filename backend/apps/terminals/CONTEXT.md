# Terminal Runtime

The vocabulary for durable interactive terminal sessions and the viewers that
temporarily attach to them. Recorded run history, agent launch policy, and
provider behavior belong to other contexts.

## Language

**Durable terminal session**:
The long-lived interactive terminal environment for a run. It survives viewer
disconnection and exists independently of both its viewers and its recorded
run history.
_Avoid_: Agent run, viewer session, WebSocket session, terminal tab

**Terminal viewer**:
A temporary interactive attachment to one durable terminal session.
Disconnecting a viewer does not end the durable terminal session.
_Avoid_: Terminal session, agent run, terminal owner

**Viewer ownership**:
The application policy that decides which terminal viewer may interact with a
durable terminal session. It is separate from the mechanics of attaching a viewer.
_Avoid_: Terminal attachment, terminal session ownership

**Terminal session identity**:
The agent-run ID used as the public handle for one durable terminal session.
The terminal implementation may recognize or use its application meaning
internally. Its contract does not make the terminal module authoritative for
the agent run, and callers cannot depend on it to resolve or persist application
facts. Internal identities such as the derived tmux session name remain hidden.
_Avoid_: Tmux session name, terminal-owned agent run

**Viewer detachment**:
The end of a terminal viewer's temporary attachment. It says nothing about the
durable terminal session or the liveness of any associated run.
_Avoid_: Terminal exit, run exit, session termination

**Hosted command exit**:
The completion of the command running inside a durable terminal session. It is
a runtime fact, not a decision about an associated run's lifecycle.
_Avoid_: Agent exited, terminal lost, viewer detached

**Missing terminal session**:
The fact that an expected durable terminal session is no longer present. It
does not encode why it disappeared or determine an associated run's lifecycle.
_Avoid_: Exited run, lost run, terminated run

**Terminal runtime observation**:
A mechanical snapshot reported by the terminal module: the hosted command is
running, the hosted command exited (with an exit code when available), or the
durable terminal session is missing. Failure to inspect the terminal runtime is
an observation error, not a missing-session observation.
_Avoid_: Run status, persisted terminal state, lifecycle event

**Terminal reconciliation**:
An outside process that compares recorded application state with terminal
runtime observations. It interprets hosted-command exit and missing-session
facts, updates persistence or run lifecycle, and requests terminal cleanup when
policy requires it. It is not part of the terminal module.
_Avoid_: Terminal inspection, viewer detachment, tmux cleanup

**Agent resume**:
An application/provider operation that creates a new agent run and a new
terminal runtime, using the previous run's recorded provider conversation
identity to continue the conversation. It may be offered after a command exit
or a missing terminal session, but it is not reattachment to the old terminal
runtime and is not implemented by the terminal module. The provider conversation
identity is the only continuity between the old and new runs.
_Avoid_: Terminal reconnect, viewer reattachment, reviving a dead pane
