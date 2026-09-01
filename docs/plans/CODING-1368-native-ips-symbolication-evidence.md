# CODING-1368 native `.ips` verification evidence

Date: 2026-08-31  
Host: macOS 26.2 (25C56), arm64  
Source HEAD: `f58a3cbece07487c9253c2c84e5c90142d6aa417`

## Result

The automated collector seam passes. The required release-build `kill -SEGV`
check does not pass yet, so this record must not be used to mark the manual
acceptance item complete.

## Automated collector seam

Command:

```bash
cargo test --manifest-path studio/src-tauri/Cargo.toml --lib diagnostics::crash_report::tests
```

Result: 14 passed, 0 failed. The cases cover a matching report, macOS reports
that omit `bundleID`, the payload `captureTime`, foreign process and bundle
identities, reports outside the session window, no report, lookup failure,
private file permissions, and the existing Dirty Shutdown behavior.

`cargo fmt --manifest-path studio/src-tauri/Cargo.toml --check` also passed.

## Release build

Command:

```bash
npm run release:build --workspace @worktracker/studio -- \
  --target macos-aarch64 --allow-unsigned
```

The frontend production build and optimized arm64 Ticketry binary completed.
Tauri created a fresh `Ticketry.app`, then `bundle_dmg.sh` failed while creating
the DMG. The fresh app was sufficient for runtime checking. A concurrent build
cache cleanup removed `studio/src-tauri/target` after the checks, so the fresh
binary is not retained as evidence.

## `kill -SEGV` attempts

Each run used a new `/private/tmp/ticketry-ips-check.*` data directory. The last
run also used dedicated MCP port `38123` to avoid the live Ticketry instance.
The release process wrote its Session Marker and reached runnable process state
`RN`. The check then sent `kill -SEGV` to that exact child PID.

Observed on the final run:

- PID: `15804`
- Isolated data: `/private/tmp/ticketry-ips-check.Rj8SW0/data`
- Pre-crash marker: `/private/tmp/ticketry-ips-check.Rj8SW0/pre-crash-session-marker.json`
- Process state before signal: `RN`
- Wait status: `0`, not signal status `139`
- New macOS `.ips`: none
- Crash Report: none
- Session Marker after exit: removed

The same clean-exit result occurred in the earlier isolated run at
`/private/tmp/ticketry-ips-check.6X14YI`. A stopped-process experiment was
discarded because zsh observed the stop status rather than a crash status. Its
test PID was force-terminated and confirmed gone.

This is an integration blocker. The release process is treating external
SIGSEGV as a clean exit in this launch environment, so the Dirty Shutdown
collector has no stale marker and macOS has no native report to collect.

## Independent symbol evidence

An earlier release-build report exists at
`~/Library/Logs/DiagnosticReports/ticketry-2026-08-31-131127.ips`. It has image
UUID `19beb15e-db95-3106-b6f1-cb3feed128b3` and contains function-named frames,
including:

```text
muxed_studio_lib::diagnostics::panic_attribution::force_development_panic_abort
muxed_studio_lib::desktop::run::run
muxed_studio_lib::run_with_file_logging
ticketry::main
```

This confirms that the default release symbol table can produce function names.
It was not collected by the CODING-1368 build, so it does not satisfy the
manual acceptance item by itself.

## Follow-up needed

Reproduce the external SIGSEGV behavior from an interactive installed-app
session and determine why the process exits cleanly. Check dependency-installed
signal handlers and the Tauri exit path before changing Session Marker cleanup.
Then rerun the release check and add the source `.ips`, copied `.ips`, sidecar,
binary UUID and hash, and named-frame excerpt to this record. Do not commit the
full `.ips` because it can contain host details and local paths.

## Resolution: why no `.ips` exists, and the crash it was hiding

Date: 2026-08-31 (later the same day)

The follow-up above asked why the release process exits cleanly under a fatal
signal and told the reader to check dependency-installed signal handlers. That
is the answer.

**libghostty owns the process's crash reporting.** The release build links
`vendor/libghostty/lib/libghostty.a`, which statically links sentry-native
0.7.8 with its **Google Breakpad** backend (`sentry_backend_breakpad.o`,
`google_breakpad::ExceptionHandler`). Breakpad claims the process's Mach
exception ports at `ghostty_init`. A native fault anywhere in the process is
therefore delivered to Breakpad, not to macOS: Breakpad writes a minidump and
terminates the process itself. macOS's crash reporter never sees an exception,
so **no `.ips` is ever written for a release build**, and `launchd` records an
ordinary exit rather than a signal. The `.ips` file that does exist in this
record predates that path (an explicit `abort()` from the panic hook).

Breakpad's database is not in Ticketry's data directory. libghostty compiles
Ghostty's own bundle identifier into it:

```text
~/Library/Caches/com.mitchellh.ghostty/sentry/
  last_crash                       # RFC 3339 timestamp of the last crash
  <run-id>.run/<event-id>.envelope # event JSON + `event.minidump` attachment
```

**The crash it was hiding.** Three deaths on 2026-08-31 that Ticketry recorded
as dirty shutdowns with `"native_report": "no native report found"` were all
Breakpad exits:

```text
14:49:24 pid  6716  exited due to exit(1), ran for  534477ms
14:52:17 pid 46759  exited due to exit(1), ran for  170157ms
15:20:11 pid 75353  exited due to exit(1), ran for 1314492ms
```

The envelope for the last of these (`level: "fatal"`, `09:50:11.573Z`) decodes
to `EXC_BAD_ACCESS` / `KERN_INVALID_ADDRESS` at `0x3d8e6a72` on the main
thread, with this stack — the system frames symbolize exactly, the `ticketry`
frames do not because that binary had already been replaced by a later install:

```text
-[NSApplication run]
__CFRunLoopRun → __CFRunLoopDoSource0
WTF::RunLoop::performWork                                  (JavaScriptCore)
IPC::Connection::dispatchIncomingMessages                  (WebKit)
WebKit::WebPageProxy::didCommitLoadForFrame                (WebKit)
WebKit::NavigationState::NavigationClient::didCommitNavigation
[5 frames in ticketry]
<EXC_BAD_ACCESS>
```

`didCommitNavigation` is wry's navigation delegate, which raises Tauri's
`PageLoadEvent::Started`. Ticketry answered that event by tearing down every
native viewer synchronously, so a page reload freed Ghostty surfaces and the
shared Ghostty app underneath WebKit's own navigation commit. The reloads came
from `nativeRenderRecovery.ts`, whose campaign refreshes the window after a
native-viewer render failure and never gives up, so one render failure became a
repeating process death.

Two defects were fixed:

- `libghostty_runtime.m` — `runtime_wakeup` captures the runtime record in a
  block it hands to the main queue, and `muxed_ghostty_runtime_free` used to
  `free()` that record. Dispatch cannot cancel an already-queued block, so a
  wakeup queued just before teardown read `runtime->app` out of released memory
  and ticked a wild app pointer. The record is now cleared and kept.
- `native_terminal/macos/teardown.rs` (new) — page reload teardown drains the
  registry and stops accepting events synchronously, then hands every native
  free to a later main-thread turn. Application exit keeps freeing inline,
  because the process leaves through that event. This also restores the
  `disable_resize_callback` step the old teardown omitted.

`diagnostics/native_minidump_report.rs` (new) now copies a matching Breakpad
envelope into the Crash Report and records `"libghostty native crash"` as the
dirty exit reason, so this class of death is attributable without hand-decoding
a minidump.

The manual `kill -SEGV` acceptance item remains open, and Breakpad's ownership
of the exception ports is why: an external fatal signal on a release build
cannot produce a macOS `.ips`. That item needs restating against Breakpad's
envelope rather than against `~/Library/Logs/DiagnosticReports`.
