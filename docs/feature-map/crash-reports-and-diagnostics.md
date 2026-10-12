# Crash reports and diagnostics

Desktop startup collects local evidence after a Dirty Shutdown and preserves runtime diagnostics for inspection.

Surfaces: desktop, manual
Editions: pocock, core

## Sub-features

- crash-diagnostics-session-marker: identify a previous Dirty Shutdown on the next launch.
- crash-diagnostics-native-report: collect matching macOS crash evidence with a metadata sidecar.
- crash-diagnostics-local-retention: retain local reports for manual inspection and export.
- crash-diagnostics-runtime-log: persist frontend and Rust diagnostics in the fixed application log.
- crash-diagnostics-silent-startup: keep Studio usable without a Crash Notice.

## How to get to it

Collection is automatic when restarting the desktop after a Dirty Shutdown; there is no user action or default chord to start it. Inspect the active isolated data directory's `crash-reports` folder manually. The runtime exposes fixed outcome and folder-reveal commands, but current Studio has no caller for either: do not look for an **Open Crash Reports** button or a Settings section. `studio/src/test/overhaulCrashNoticeAcceptance.test.tsx` explicitly expects no **Ticketry closed unexpectedly last time** notice and no outcome request.

For development diagnostics use `bun run logs` and `bun run logs:follow` from the root. Startup failures and their log pointers are mapped in [Startup and service health](startup-and-service-health.md). See the [Desktop Runtime vocabulary](../../studio/src-tauri/crates/app/ticketry-desktop/src/desktop/CONTEXT.md) and [OS-native crash-report decision](../decisions/2026-08-31-os-native-crash-reports.md).

## Prerequisites

- Use a disposable desktop data directory for any forced exit or panic test. A previous Session Marker must survive the exit; a clean quit removes it.
- Real native report proof needs macOS reporting enabled and a hard desktop-process crash that produces an `.ips` file. A forced kill can only establish marker collection.
- The process needs write access to its data directory and read access to the OS DiagnosticReports folder. Actual folder reveal additionally needs a graphical file manager.

## Expected behavior

- **First launch/clean exit:** collection finds no stale marker and writes the new session's marker. Clean application exit removes it. Collection runs on a startup thread; an outcome request joins that thread. Source: `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs`, `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/lifecycle.rs` and `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/crash_report.rs`.
- **Dirty Shutdown:** the next launch creates a local report directory with `crash-report.json`, version/commit, OS/architecture, session interval, available panic attribution and up to 200 previous log lines. It copies the newest matching Ticketry `.ips` captured during that session; missing native evidence is explicitly **no native report found**. Corrupt or unreadable inputs report collection errors to stderr rather than aborting startup. Source: `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/crash_report.rs` and `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/native_crash_report.rs`.
- **Late reports/persistence:** pending marker-only reports are retried at startup and, if still pending, after 45 seconds. Collection prunes local report directories to ten; Unix report directories/files are protected with 0700/0600 permissions. Reports stay local for manual export; there is no upload or cancel flow. Source: `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/native_report_retry.rs` and the linked decision.
- **Runtime logs:** desktop logging is requested even without a CLI flag, including Finder launches. Production uses `ticketry.log` in the active data directory; development supplies `.ticketry-dev/logs/ticketry.log`. Console messages, window errors and unhandled rejections are mirrored through the fixed frontend log bridge when enabled. Logging failures do not become UI failures. Source: `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/file_log.rs`, `studio/src/shared/logging/frontendLogBridge.ts` and `studio/src/shared/logging/desktopFileLogging.ts`.
- **Silent Studio:** collected evidence does not produce a crash modal or notice. Outcome and reveal commands are restricted to the local main window; they expose no arbitrary path or command. This is source/contract coverage, not a reachable GUI export flow.

## Verifying it

Read the disposable profile's Session Marker, crash-report.json, copied `.ips` and log contents before and after restart. The sidecar's `native_report` field distinguishes OS evidence from marker-only evidence; a report directory alone does not prove an OS crash. These are filesystem observations, not GraphQL records or DOM selectors.

| Evidence | Existing coverage and narrow command | Limit |
| --- | --- | --- |
| No Crash Notice | `studio/src/test/overhaulCrashNoticeAcceptance.test.tsx`, `overhaul-207`: `bun run --cwd studio test -- src/test/overhaulCrashNoticeAcceptance.test.tsx` | Mocked collection outcome and shell; proves current UI omission. |
| Fixed native report operations | `studio/src/test/desktopShellContract.test.ts`: `bun run --cwd studio test -- src/test/desktopShellContract.test.ts -t 'exposes only fixed Crash Report'` | Source registration/permission assertions; no real file-manager launch. |
| Marker, retention, metadata, native matching and delayed retry | `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/crash_report_tests.rs`, `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/native_report_collection_tests.rs`, `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/native_report_retry_tests.rs`: `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-diagnostics crash_report` | Temporary filesystem/native-report fixtures; does not make the OS generate an `.ips`. |
| Panic attribution and log records | `studio/src-tauri/crates/foundation/ticketry-diagnostics/src/panic_attribution_tests.rs` and file-log unit tests: `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-diagnostics panic_attribution`; `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-diagnostics file_log` | Unit evidence, not an installed-app crash. |
| Frontend logging and failure tolerance | `studio/src/shared/logging/desktopFileLogging.test.ts`, `studio/src/shared/logging/frontendLogBridge.test.ts`: `bun run --cwd studio test -- src/shared/logging/desktopFileLogging.test.ts src/shared/logging/frontendLogBridge.test.ts` | Mocked native logging bridge. |
| Shipped binary marker/restart metadata | `studio/src-tauri/tests/crash_report_metadata.rs`: `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry --test crash_report_metadata` | Launches and kills a real desktop binary in temporary data/home directories; requires desktop build dependencies and a GUI-capable host. Checks version/commit, not an OS crash backtrace. |

For real OS report/symbolication evidence follow [native IPS evidence](../plans/CODING-1368-native-ips-symbolication-evidence.md) in an isolated profile. It records historical experiments, not current execution. Actual OS crash generation, symbolication and file-manager reveal have no complete current UI acceptance journey; they require manual desktop observation because synthetic report fixtures cannot establish OS behavior.

## End-to-end suite

Suite: excluded (desktop-only): no browser-reachable behavior. `studio/src/runtime/browserRuntime.ts` starts with `initialNotices` empty, `nativeLifecycle: false` and `subscribeUserNotices` as a no-op, and has no Session Marker, crash-report collection or file-log bridge; collection, retention and `ticketry.log` live only in the desktop runtime (`studio/src/runtime/desktopCrashReports.ts`, `studio/src-tauri/crates/foundation/ticketry-diagnostics`), and current Studio has no crash UI in either runtime.

## Relevant code

- `studio/src-tauri/crates/foundation/ticketry-diagnostics`: report collection, panic attribution, logs and trace diagnostics.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/crash_reports.rs`, `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/lifecycle.rs`: fixed operations, startup collection and clean exit.
- `studio/src/runtime/desktopCrashReports.ts`: outcome validation and fixed reveal adapter.
- `studio/src/shared/logging/desktopFileLogging.ts` and `studio/src/shared/logging/frontendLogBridge.ts`: persistent frontend diagnostics.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/frontend_log.rs` and `scripts/dev-logs.mjs`: log formatting and development inspection commands.

## Gotchas

- A Dirty Shutdown may be a forced kill; it does not identify a crash cause. Recoverable frontend errors and hangs are not desktop Crashes.
- Native collection currently targets macOS `.ips` reports. File-manager reveal has other OS branches; that does not establish Windows/Linux native report support.
- Missing OS evidence can be filled on a later retry; collection outcome reports only whether this launch collected a bundle, not whether a native report has arrived.
- Historical native IPS instructions contain pre-crate-split test paths. Use the crate commands above; do not copy old `diagnostics::crash_report::tests` filters blindly.
- A Settings export UI, Crash Notice, current installed symbolication and live folder-reveal walkthrough are not verified here. There is no current Studio export entry point to map.
