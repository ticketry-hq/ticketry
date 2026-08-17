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

**Scroll bridge**:
The single mechanism by which any terminal viewer moves a durable terminal
session's scrollback: the viewer reports scroll intent, and the session's
scrollback is moved on its behalf. Wheel gestures never become input to the
hosted command.
_Avoid_: Mouse mode, arrow-key scrolling, renderer scrollback

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

**Terminal output activity**:
The durable evidence that a session's rendered output identity changed, held as
a compact identity, a monotonic per-session sequence, and a backend-owned
timestamp. It is independent of terminal input, viewer transport health, and
provider lifecycle hooks, and it never duplicates the screen or scrollback.
_Avoid_: Lifecycle event, terminal buffer, viewer activity, keystroke

**Terminal output report**:
One viewer's claim that the durable session it renders produced output. Every
renderer — the browser byte pump and the native viewer whose bytes Ticketry
never sees — reports exactly this and nothing more; capturing the screen,
comparing the output identity, and deciding whether anything changed stay with
terminal output activity. A report that changes nothing extends no deadline,
and a report that cannot be recorded is a status miss, never a rendering error.
_Avoid_: Output payload, activity update, viewer heartbeat, keepalive

**Live terminal output sweep**:
The backend's own periodic observation of every live durable session this
runtime owns, whether or not any viewer is attached to it. It exists because
both terminal output reports are viewer-scoped, so an unwatched session would
otherwise freeze its terminal output activity at the session creation baseline
and reach the stalled terminal projection purely for lack of an audience. It
reports through the same activity path a viewer does, so it can only bound how
stale an observation gets — never invent activity — and viewer reports remain
the fast path that clears a stalled projection immediately.
_Avoid_: Terminal reconciliation, heartbeat, keepalive, polling the viewer

**Stalled terminal projection**:
The effective status of a still-live run whose terminal output identity has not
changed for sixty seconds. It is a read-time projection, never a persisted
provider lifecycle state, and it says only that output stopped changing — not
that the hosted command is dead, failed, or finished. Explicit termination and
a confirmed hosted-command exit outrank it. So does a run waiting on the user:
`needs_input` and `permission_required` already say why the terminal is quiet,
and a waiting terminal produces no output to clear the overlay with, so the
heuristic is never applied to them.
_Avoid_: Exited run, crashed agent, quiet lifecycle state, turn complete

**Terminal outcome**:
A recorded fact about how a run actually ended: explicit termination, a
confirmed hosted-command exit, or the authoritative missing-session outcome. It
outranks the stalled terminal projection permanently — it disposes any pending
inactivity deadline, and no later output observation, provider hook, or elapsed
time may return the run to a live presentation.
_Avoid_: Stalled run, quiet run, viewer detachment, transport loss

**Terminal control failure**:
The failure of a viewer control operation — resize or scroll — on an attached
terminal. It is reported as a terminal runtime error correlated only by AgentRun
ID; the tmux session target and other implementation detail stay inside the
runtime and are recorded in its logs, never in the error that transports render.
_Avoid_: tmux session error, copy-mode failure, `pt-` session name

**Terminal reconciliation**:
An outside process that compares recorded application state with terminal
runtime observations. It interprets hosted-command exit and missing-session
facts, updates persistence or run lifecycle, and requests terminal cleanup when
policy requires it. It is not part of the terminal module.
_Avoid_: Terminal inspection, viewer detachment, tmux cleanup

**Run completion seam**:
The post-commit announcement that one agent run and/or its terminal session has
durably been recorded as ended. Every durable termination write — explicit
termination and terminal reconciliation alike — publishes it exactly once per
write that actually ended something. It carries only the AgentRun ID and no
judgement: subscribers such as subtree execution decide what the ending means
for the work scheduled on it, and a failing subscriber never fails the
termination write.
_Avoid_: Completion callback, scheduler hook, advancing a campaign here

**Shell run**:
A run with no agent, whose durable terminal session hosts a plain interactive
shell in one module's folder. It shares its record and its terminal mechanics
with an agent run and is distinguished by its scope; it has no provider, no
prompt, no hooks, and therefore no lifecycle state of its own. Nothing schedules
work on it and no campaign advances when it ends.
_Avoid_: Agent run, scratch run, shell agent, terminal session

**Shell launch refusal**:
The refusal to start a shell run because the module has no usable folder — none
configured, one that has since disappeared, or a path that is not a directory.
It is a complete refusal, not a degraded launch: no record and no terminal
runtime are created, and unlike agent launch there is no home-directory
fallback, because a bare shell cannot tell you where it ended up.
_Avoid_: Launch failure, missing worktree, unavailable runtime

**Shell restart**:
Starting a fresh shell run after a previous one's hosted command exited,
presented in the place the previous one occupied. Like an agent resume it
creates a new run and a new terminal runtime rather than reattaching to the old
one, but it carries nothing forward from its predecessor — not even a
conversation identity, since a shell has none.
_Avoid_: Reviving a shell, reconnecting the terminal, restarting the session

**Agent resume**:
An application/provider operation that creates a new agent run and a new
terminal runtime, using the previous run's recorded provider conversation
identity to continue the conversation. It may be offered after a command exit
or a missing terminal session, but it is not reattachment to the old terminal
runtime and is not implemented by the terminal module. The provider conversation
identity is the only continuity between the old and new runs.
_Avoid_: Terminal reconnect, viewer reattachment, reviving a dead pane
