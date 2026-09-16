# CODING-1368 native `.ips` verification evidence

Initial investigation: 2026-08-31

Host: macOS 26.2 (25C56), arm64
Initial source HEAD: `f58a3cbece07487c9253c2c84e5c90142d6aa417`

## Result

The clean reproducible verification on 2026-09-05 passes the native `.ips`
collection and function-name symbolication criteria. Earlier failed and
uncommitted-snapshot attempts remain below as historical investigation.

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

## Historical investigation: why no `.ips` existed, and the crash it hid

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

A temporary `diagnostics/native_minidump_report.rs` fallback copied a matching
Breakpad envelope into the Crash Report and recorded `"libghostty native crash"`
as the dirty exit reason. It was removed on 2026-09-05 because the envelope
contains a minidump with raw process memory, which the OS-native crash-report
ADR rejects for privacy reasons.

At that point, the manual `kill -SEGV` acceptance item remained open because
Breakpad's exception-port ownership prevented an external fatal signal from
producing a macOS `.ips` in the release build.

## Current-HEAD verification, 2026-09-05

Source HEAD: `445adcf84faf3a7a814bb7b29f6b60ed937094a6`

The post-crate-split collector command is:

```bash
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml \
  -p ticketry-diagnostics crash_report::tests
```

Result on the integrated working tree after CODING-1365 returned to Review:
15 passed, 0 failed. The collector copied a matching report, rejected foreign
and out-of-window reports, and produced the marker-only sidecar when no report
matched.

A disposable clean-HEAD checkout built the unsigned arm64 application bundle.
DMG creation still failed after the app and optimized binary were complete.
The binary had UUID `C58BA758-99AE-3FA0-8529-138C66FF3DBD` and SHA-256
`fb68f6aeb24b13d86202a7dc1df9bfed0d9639cb96663ba57ebd1dabdbec5b79`.

The isolated release process, PID `43686`, wrote its Session Marker and reached
runnable state. `kill -SEGV 43686` did not terminate it after more than two
minutes. After rechecking the exact PID and binary path, the process was ended
with `kill -KILL` so the marker-only relaunch path could be checked. Relaunch
produced:

```text
/private/tmp/ticketry-coding-1368.UXw1V4/runtime.92HOBn/data/crash-reports/
  crash-report-20260904T194530.302Z-22eb0e63ae764dc7aea02e809c237b90/
```

Its sidecar recorded `"native_report": "no native report found"`; it contained
no copied `.ips` and no Breakpad envelope. Three `.ips` files created during the
window belonged to `ticketry_diagnostics` test binaries with a different PID
and image UUID, and the collector correctly ignored them. `nm`/`atos` confirmed
the release binary retains function names, but there is still no collected
release `.ips` in which to verify Ticketry frames.

At this checkpoint, the manual `.ips` item remained open and the Breakpad
fallback still conflicted with the ADR. The clean verification at the end of
this record resolves both findings.

## Historical uncommitted-snapshot verification, 2026-09-05

This run proved the runtime behavior, but not clean source provenance. Its
checkout was at `445adcf84faf3a7a814bb7b29f6b60ed937094a6` while the reviewed
release-manifest and no-libghostty changes were uncommitted. The sidecar
therefore stamped a commit that did not contain the built source changes. The
details below remain as a historical observation and are not the acceptance
proof.

The shipping release no longer enables `native-libghostty`. The optimized
arm64 application build completed with binary UUID
`94E4F955-774B-3F41-A7A2-8BD86029BF07` and SHA-256
`9b3635915a52542c83b273d913a2541c97cebc4475c3d6983b4b2d75c63d8a6b`.
The binary contains no libghostty, Sentry, or Breakpad symbols, leaving native
crash reporting to macOS as required by the ADR.

A fresh isolated run used PID `18522` and data directory
`/private/tmp/ticketry-coding-1368-fresh.UOXI9v/data`. Rust 1.95 installs a
one-shot SIGSEGV/SIGBUS handler for stack-overflow diagnosis. A synthetic
`kill -SEGV` has no fault address, so the first signal makes that handler
restore the default disposition and return. The second `kill -SEGV` then
terminated the process without a debugger. A real invalid-memory fault retries
the faulting instruction after the handler returns and therefore reaches the
default disposition without needing a second fault.

macOS wrote:

```text
/Users/karthik/Library/Logs/DiagnosticReports/
  ticketry-2026-09-05-015509.ips
```

Relaunch copied it into:

```text
/private/tmp/ticketry-coding-1368-fresh.UOXI9v/data/crash-reports/
  crash-report-20260904T202543.729Z-8ffb56ddc9fb49dda8a303790cd320ce/
```

The source and copied `.ips` both have SHA-256
`b186deb05ee4b192aea480227118ad2a44aab9bd9bd5e5bd96fa5c4474dabea4`.
The sidecar references the copied filename and records app version `0.2.0`,
commit `445adcf84faf3a7a814bb7b29f6b60ed937094a6`, and the matching image UUID.
The collected report contains function-named Ticketry frames, including:

```text
tao::platform_impl::platform::event_loop::EventLoop<T>::run
ticketry_desktop::desktop::run::run
muxed_studio_lib::run_with_file_logging
ticketry::main
```

This run does not complete the manual acceptance item because its source stamp
was not truthful. The two-signal sequence is specific to synthetic SIGSEGV
under Rust's stack-overflow handler; it is not additional product crash
machinery.

## Review finding resolution, 2026-09-05

An immediate relaunch now leaves a marker-only Crash Report eligible for a
detached retry after macOS publishes its delayed `.ips`. The retry updates the
sidecar atomically and removes a copied report if that update fails.

Canonical development, release, smoke, desktop-agent, and packaged-update
builds no longer prepare, enable, or bundle native libghostty. The retained
feature and preparation command are explicit non-shipping migration tools.

Release builds now reject dirty source trees, malformed explicit commit IDs,
and explicit commit IDs that differ from `HEAD`. Provenance logic and its tests
live in the focused `release-provenance.mjs` module.

Integrated checks passed: `ticketry-diagnostics` 67/67, release and packaged
update scripts 45/45, desktop development scripts 21/21, desktop shell contract
20/20, and the Rust public API boundary contract 1/1.

## Delayed-report retry follow-up, 2026-09-05

Desktop startup now only schedules native-report retry work. The worker owns
the initial pending-report scan, the delayed second scan, and atomic sidecar
repair. Those concerns live in the private `native_report_retry.rs` module;
the crate root still exports only the existing collector entry point.

A FIFO-backed seam test proves that `collect_dirty_shutdown` returns while a
pending sidecar read is blocked. Delayed and native-report collection cases now
live outside the general collector test file. The integrated
`ticketry-diagnostics` suite passed 70/70; crash-report metadata and the Rust
public API boundary contracts each passed 1/1.

## Clean compiler-provenance and `.ips` verification, 2026-09-05

The final proof was repeated from local branch `coding-1368-clean-proof` at
commit `c13698f3dae8252e1cc87920c302c98e5281acb4`. The branch contains the
reviewed CODING-1368 changes on `d3f16cf4110343cfbcacdf1804086eb17fc3aa18`
and one test-only TypeScript inference fix required to build that clean base;
it does not contain the unrelated dirty-worktree changes. `git status
--porcelain --untracked-files=normal` was empty before the build.

Toolchain: Rust 1.95.0 (`59807616e`, 2026-04-14), Node 26.7.0. Command:

```bash
npm run release:build --workspace @worktracker/studio -- \
  --target macos-aarch64 --allow-unsigned
```

The optimized app and DMG completed. The staged binary was
`studio/release-output/0.2.0/macos-aarch64/Ticketry.app/Contents/MacOS/ticketry`:

```text
UUID: 0B335134-A926-30A0-981A-B8F2D272BC3A (arm64)
SHA-256: ca7f753525884bf01a0bb102c092f418480221d51b2ef67eb30539a7853de8d2
```

`nm` found no Breakpad, Sentry backend, or `ghostty_init` symbol. The clean
snapshot passed the release scripts 136/136, `ticketry-diagnostics` 60/60, the
crash-report metadata contract 1/1, and the public API boundary contract 1/1.

An isolated launch used PID `90754`, data directory
`/private/tmp/ticketry-coding-1368-clean.0wEgGe/runtime/data`, and Session
Marker commit `c13698f3dae8252e1cc87920c302c98e5281acb4`. Rust's one-shot
stack-overflow handler consumed the first synthetic SIGSEGV; the second
terminated the process. macOS recorded `EXC_CRASH` / `SIGSEGV`, termination
signal 11, for PID `90754` and bundle `com.ticketry.desktop` in:

```text
~/Library/Logs/DiagnosticReports/ticketry-2026-09-05-034241.ips
```

Immediate relaunch copied that report into:

```text
/private/tmp/ticketry-coding-1368-clean.0wEgGe/runtime/data/crash-reports/
  crash-report-20260904T221249.858Z-743dc514e67b488eafb8a7b77424529e/
```

The sidecar references `ticketry-2026-09-05-034241.ips` and records commit
`c13698f3dae8252e1cc87920c302c98e5281acb4`. Source and copy compared equal;
both have SHA-256
`02e00de0ce19a159675ba3dc4f2140ee440b5c173226c44ff1926624c997a3e2`.
The report's Ticketry image UUID is
`0b335134-a926-30a0-981a-b8f2d272bc3a`, matching the release binary, and its
Ticketry-image frames include:

```text
tao::platform_impl::platform::event_loop::EventLoop<T>::run
ticketry_desktop::desktop::run::run
muxed_studio_lib::run_with_file_logging
ticketry::main
```

The relaunch then exited normally and removed its Session Marker. This replaces
the earlier dirty-build proof and completes the literal collected-`.ips` and
function-name symbolication acceptance criterion.

## Supplemental clean direct-binary retry verification, 2026-09-05

Before the final bundled-app proof above, a disposable clone of base HEAD
`d3f16cf4110343cfbcacdf1804086eb17fc3aa18` received only the reviewed
CODING-1368 collector, delayed-retry, OS-native-only release, and provenance
changes. Those changes were committed as:

```text
292a35f8041c0b2961ffbcdb16cefca0535721f3
```

`git status --porcelain --untracked-files=normal` was empty before the build.
The source clone remains at
`/private/tmp/ticketry-coding-1368-clean.EbhgAd/source`. A Git bundle that
preserves the exact source commit is at:

```text
/private/tmp/ticketry-coding-1368-clean-proof.qFmECT/
  source-292a35f8041c0b2961ffbcdb16cefca0535721f3.bundle
```

The ordinary release wrapper prepared the pinned ghostty-vt WASM, then stopped
before Cargo on an unrelated pre-existing TypeScript fixture error. CODING-1487
has since removed that prepare step, so a rerun today does not build ghostty-vt.
No fixture change was added to the clean source. The native verification instead used the
direct Rust/Tauri release boundary. The first command supplies Tauri's declared
external hook binary; the second builds the optimized shipping binary and runs
the release-only provenance check in `build.rs`:

```bash
rustc studio/src-tauri/native/ticketry_hook.rs \
  --edition 2021 --target aarch64-apple-darwin -O \
  -o studio/src-tauri/binaries/ticketry-hook-aarch64-apple-darwin
cargo build --locked --manifest-path studio/src-tauri/Cargo.toml \
  --release --bin ticketry
```

The build completed successfully. Its `build.rs` output set
`TICKETRY_COMMIT=292a35f8041c0b2961ffbcdb16cefca0535721f3`. The arm64 Mach-O has
UUID `7F8EBE45-47BE-30E4-A0E3-9E999A9E3C82` and SHA-256
`71c86ab901cf373169307b849095dec38810843017ee5734414faa16fb0e6010`.
`nm` found no Breakpad, Sentry, libghostty, `ghostty_init`, or native Ghostty
surface symbols. The preserved binary is:

```text
/private/tmp/ticketry-coding-1368-clean-proof.qFmECT/
  ticketry-292a35f8041c0b2961ffbcdb16cefca0535721f3
```

The first isolated run used PID `76400` and data directory
`/private/tmp/ticketry-coding-1368-clean-proof.qFmECT/data`. Its Session Marker
recorded app version `0.2.0`, the clean commit above, and session start
`2026-09-04T22:06:16.212313Z`. The first synthetic `kill -SEGV 76400` was
consumed by Rust's one-shot stack-overflow handler. The second exited with
status 139.

An immediate relaunch used PID `76828`. It first created this marker-only Crash
Report with `"native_report": "no native report found"`:

```text
/private/tmp/ticketry-coding-1368-clean-proof.qFmECT/data/crash-reports/
  crash-report-20260904T220708.776Z-fc8364b04ac64154b1f9dd86c1beda61/
```

macOS published the delayed source report at:

```text
/Users/karthik/Library/Logs/DiagnosticReports/
  ticketry-2026-09-05-033721.ips
```

The detached retry copied it into the Crash Report above and atomically changed
the sidecar reference to `ticketry-2026-09-05-033721.ips`. The source and copy
are byte-identical and both have SHA-256
`0c526efb4d83b59277522c2d70e7d291746b262a7c3b3fd87df06e614157f3c4`.
The `.ips` records PID `76400`, process `ticketry`, capture time
`2026-09-05 03:36:54.3676 +0530`, and image UUID
`7F8EBE45-47BE-30E4-A0E3-9E999A9E3C82`, matching the built binary. The direct
binary run has no bundle identifier, so the collector correctly matched its
process identity. Its Ticketry image contains function-named frames including:

```text
tao::platform_impl::platform::event_loop::EventLoop<T>::run
ticketry_desktop::desktop::run::run
muxed_studio_lib::run_with_file_logging
ticketry::main
```

The clean snapshot also passed `ticketry-diagnostics` 63/63 and the focused
release/provenance script tests 29/29. This direct-binary run independently
confirms delayed retry; the later bundled-app proof above is the authoritative
release provenance and bundle-identity verification.
