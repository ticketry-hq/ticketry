# Desktop Shell

The Rust shell that packages Studio as a desktop application. It owns the
local data directory, starts and supervises the local services Studio depends
on, and publishes a single health signal to the webview.

## Language

**Sidecar**:
A local service process the desktop shell spawns and reaps through an owned
handle that also contains its descendants. There are exactly two: the backend
and the MCP service, both modes of one packaged multi-call executable.
_Avoid_: Server, subprocess, daemon, child

**Supervised pair**:
The backend and MCP sidecars taken as one unit. They start together, stop
together, and recover together; neither is meaningful to the desktop shell
alone.
_Avoid_: Services, the stack, backend and friends

**Owned backend**:
A sidecar the desktop shell spawned itself, holding the data-directory lock
for the application's lifetime. Only an owned backend may be supervised.
_Avoid_: Local backend, our backend

**Development stack**:
An already-running `pnpm dev` backend that the desktop shell deliberately
attaches to instead of spawning its own. The shell holds no lock, owns no
process, and performs no supervision against it.
_Avoid_: Attached backend, dev mode, connect backend

**Owned group**:
The direct sidecar process the shell spawned plus every descendant still inside
the process group that sidecar leads. It is the entire reach of teardown: the
shell never finds a process to stop by identifier, loopback port, executable
name, `tmux` command, or durable terminal session, so anything it did not spawn
is left alone. A descendant that deliberately leaves the group — with `setsid`,
or by joining a group this shell never created — has left the boundary, and no
cleanup is promised for it.
_Avoid_: Process tree, children, the sidecar's processes

**Best-effort cleanup**:
The teardown that runs as an owning value goes away rather than through an
explicit stop. It covers ordinary unwinding — a supervisor leaving scope, a
failed startup, a panic in a build that unwinds — and nothing more. It cannot
run after an abrupt death of the desktop process itself: a macOS `SIGKILL`
(Force Quit, the out-of-memory killer), a power loss, a build configured to
abort on panic, or an operating-system crash all skip destructors entirely, and
POSIX gives a process group no parent-death guarantee. A group stranded that way
outlives the shell: the next launch reclaims the data-directory lock the kernel
released and starts its own sidecars, but it never hunts the stranded processes
down, because they are no longer processes it owns.
_Avoid_: Guaranteed cleanup, automatic teardown, cleanup on exit

**Pinned port**:
The loopback port a sidecar was first assigned, remembered and rebound on
every subsequent spawn so that URLs already handed out stay valid.
_Avoid_: Fixed port, static port, reserved port

**Recovery**:
The shell's unattended replacement of the supervised pair after one of them is
found dead, ending either in a healthy pair on its pinned ports or in a
give-up. Distinct from a launch, which happens once at startup.
_Avoid_: Restart, respawn, auto-heal, repair

**Wedged**:
A sidecar whose process is alive but no longer serving — the condition that
process-exit detection cannot see and only a liveness probe reveals.
_Avoid_: Hung, stuck, unresponsive, zombie

**Restart budget**:
The bounded number of recovery attempts available before the shell gives up,
and the healthy interval after which that allowance is restored.
_Avoid_: Retry limit, restart count

**Give-up**:
The terminal outcome of an exhausted restart budget: the pair is left stopped
and the failure is published to the webview with a log pointer. Only an
explicit user action rearms the shell.
_Avoid_: Fatal error, crash, dead state

**Readiness line**:
The structured line a sidecar writes to stdout to declare itself serving on a
port. It is the sole readiness signal; a running process is not a ready one.
_Avoid_: Startup log, ready signal, health line

**Packaged posture**:
The configuration a sidecar runs under when launched from a bundled
application: debug off, a persisted per-install secret, loopback-only allowed
hosts, and no administrative surface. Deliberately not the development
posture, and asserted by the packaged entry point rather than inherited from
settings.
_Avoid_: Production mode, release config, prod settings

**Migration failure**:
A terminal startup outcome in which the sidecar could not bring the state
database to the schema it needs. It is distinct from a crash because it is
deterministic, so it consumes no restart budget and goes straight to a
give-up.
_Avoid_: Migration error, schema crash, bad database

**Pre-migration snapshot**:
The checkpointed copy of the state database taken before a schema-changing
migration runs, retained for a bounded number of generations. It is the only
artefact a forward migration can be recovered from.
_Avoid_: Backup, dump, database copy

**Sidecar log**:
The size-capped, rotating, secret-redacted file under the data directory that
captured sidecar output is written to. It is what a give-up's log pointer
names, and it outlives the process that produced it.
_Avoid_: Log buffer, output capture, stderr file

**Service health**:
The small, stable state the shell publishes to the webview — starting,
migrating, ready, recovering, degraded, or failed. It deliberately carries no
process names, ports, exit codes, or credentials.
_Avoid_: Supervisor state, status event, process status
