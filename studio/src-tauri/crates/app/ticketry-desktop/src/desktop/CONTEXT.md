# Desktop Runtime

Owns the Tauri/webview boundary, in-process Rust tasks, the native terminal
renderer, and application lifecycle — including what happens when the
application dies and is launched again.

## Language

### Crash diagnostics

**Crash**:
A hard death of the desktop process — abort, segfault, native renderer crash,
or panic-abort. Recoverable frontend errors and hangs are not Crashes.
_Avoid_: error, exception, freeze

**Dirty Shutdown**:
A session that ended without removing its Session Marker; evidence that a
Crash (or forced kill) occurred.
_Avoid_: unclean exit, abnormal termination

**Session Marker**:
The file written at startup and removed on clean exit whose presence at the
next launch proves a Dirty Shutdown.
_Avoid_: lock file, pid file

**Crash Report**:
The bundle Ticketry assembles on the launch after a Dirty Shutdown: a metadata
sidecar plus, when found, a copy of the operating system's native crash
report. Stored locally, capped to the most recent ten, exported manually.
_Avoid_: dump, minidump, telemetry

**Crash Notice**:
The dismissible, non-blocking message shown on the launch after a Dirty
Shutdown, offering to reveal the Crash Report folder.
_Avoid_: crash dialog, error popup
