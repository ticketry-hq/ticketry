# Debugging and observability in Tauri applications

Research snapshot: 2026-09-01. This compares six public Tauri applications
using only their repositories and repository documentation. It is a sample of
working practice, not a claim that every Tauri app follows the same pattern.

## Bottom line

The strongest examples treat desktop diagnostics as a support artifact, not
terminal output: persist bounded logs, make detailed Rust logging opt-in,
provide a repeatable database inspection recipe, and collect crashes only with
explicit consent and redaction. Screenpipe is the clearest support workflow.
GitButler shows a practical split between quiet release logging and opt-in
debug/performance detail. Tolaria has the best explicit privacy guard. The
remaining examples are useful counterweights: console or stdout-only logging is
fine in development, but poor for a report from an installed application.

## Evidence by application

| Application | Evidence | What to take from it |
| --- | --- | --- |
| [Spacedrive](https://github.com/spacedriveapp/spacedrive) | Its Tauri client talks to a daemon over JSON-RPC. Project guidance requires `tracing` rather than `println!`, uses `RUST_LOG` filters, and directs jobs through `ctx.log()` so job logs carry `job_id`. | Put operation names and durable job/run identifiers in structured Rust events. A transport boundary alone is not correlation: the reviewed material does not show a request ID propagated through every RPC hop. |
| [GitButler](https://github.com/gitbutlerapp/gitbutler) | The Tauri entry point installs a panic hook, creates a log directory, writes Tauri logs to `ui-logs`, defaults them to `error`, and exposes environment switches for Tauri debug and performance logs. Debug builds open Web Inspector. It also exposes a logs-archive command. | Keep release noise low, but make support data discoverable and exportable. Gate inspector access to debug/test builds. |
| [Screenpipe](https://github.com/screenpipe/screenpipe) | It keeps date-named engine and Tauri-app logs under `~/.screenpipe`, documents their timestamp/level/target format, supplies grep recipes, and tests failures with read-only `sqlite3` queries. Its contributor guide documents `RUST_LOG`, Tokio Console, sanitizers, and an isolated temporary data directory for migration work. | Pair persisted logs with concrete investigation commands and read-only database checks. Keep destructive migration experiments away from a user's real data. |
| [Tolaria](https://github.com/refactoringhq/tolaria) | Rust Sentry startup requires a user setting, sets `send_default_pii: false`, and scrubs absolute paths before submission. The React root forwards caught, uncaught, and recoverable render errors with component-stack context, while showing a local fatal-error overlay. | Crash reporting needs consent, a local failure path, and tests for redaction. Scrub more than the message: exceptions, breadcrumbs, tags, request metadata, and attachments can also contain secrets or paths. |
| [Flow Desktop](https://github.com/FlowNeuro/Flow-Desktop) | Its project instructions use `tracing` plus `EnvFilter`, with `RUST_LOG` module filters. They explicitly forbid logging authentication, pairing, and encryption material. Frontend code should surface known errors through a typed `ErrorResponse` rather than leave ad hoc console output. Logs are stdout-only. | The secret policy and typed error boundary are sound. The lack of persisted installed-app logs is the gap Ticketry should avoid. |
| [Pake](https://github.com/tw93/Pake) | Its contributor documentation directs developers to Web Inspector during development. The Tauri shell reports a fatal application-construction error to stderr, but the reviewed runtime has no structured file-log or crash-reporting path. | DevTools are indispensable for renderer diagnosis, but they do not replace captured frontend errors or a support bundle after shipping. |

## Patterns, and the missing link

### Request and response tracing

The sample has durable identifiers, especially Spacedrive job IDs, but no
complete end-to-end trace contract across webview invocation, Rust work,
database work, and sidecars. Ticketry should define one at its narrow boundary:
generate or accept a `correlation_id` per GraphQL operation, terminal action,
MCP request, and agent run; attach it to the response/error and to every Rust
span and event downstream. Keep `work_item_id`, `run_id`, `terminal_id`,
operation name, and elapsed milliseconds as separate fields. Do not put prompt
text, GraphQL variables, tokens, command bodies, or raw terminal bytes in those
fields.

### Structured Rust logs and frontend capture

Use `tracing` events and spans for the Rust process, with a conservative
release filter and a per-module `RUST_LOG` override for local reproduction.
Write a bounded, rotated text or JSONL file under Ticketry's existing
`.ticketry-dev/logs/` in development and the platform app-log directory in
packaged builds. Keep the documented `npm run logs` workflow, but add a
diagnostic export that includes the selected time range and build metadata.

Do not send every `console.log` to disk or telemetry. Instead install a small
frontend reporter for `error`, `unhandledrejection`, React root errors, and
explicit unexpected-error reports. It should emit the same correlation ID and
an error code into the native log. Known GraphQL/domain errors should remain
typed UI states, following Flow Desktop's distinction.

### DevTools, panics, and crashes

Open DevTools automatically only in debug/test builds, as GitButler does, and
retain a developer shortcut for local work. For packaged support builds, use a
deliberate, user-visible diagnostic mode rather than leaving inspector access
on by default.

Install a Rust panic hook early. It should synchronously write a minimal local
crash record with timestamp, build version, correlation ID if available, panic
message, and a backtrace only when enabled. If Ticketry later adds Sentry or
another collector, require opt-in, disable default PII, preserve the local
record when upload fails, and redact before both destinations.

### Database inspection and redaction

Screenpipe's test recipes are worth copying in spirit: document exact,
read-only inspection commands and expected invariants. For Ticketry, ship an
internal diagnostic command that reports database path/engine, migration
version, connection health, and narrow aggregate counts. It must not return
work-item descriptions, credentials, prompts, terminal output, or a database
copy. Make full database export a separate, confirmed, clearly labelled support
action.

Centralize redaction before file output, support-bundle creation, and crash
upload. Use allowlisted fields where possible. Redact bearer tokens, API keys,
cookies, authorization headers, DSNs, home paths, environment values, and
terminal/prompt bodies by default. Add unit tests with representative secrets
and a test that scans the produced support archive for them.

## Recommended Ticketry delivery order

1. Add correlation-aware `tracing` spans around GraphQL execution, MCP
   dispatch, agent-run lifecycle, terminal lifecycle, and database operations.
   Include stable IDs and duration only.
2. Make the existing dev log sink structured and bounded. Add an explicit
   packaged-app log directory and a one-click redacted support-bundle export.
3. Capture renderer exceptions and unhandled promise rejections into that sink;
   keep DevTools debug-only and preserve typed expected-error UI.
4. Add a local panic record, then an opt-in crash collector with comprehensive
   scrubbers and redaction tests.
5. Document read-only database health and invariant checks for support and
   acceptance-test the diagnostic path.

## Exact primary sources

- Spacedrive: [project development and logging guidance](https://github.com/spacedriveapp/spacedrive/blob/main/AGENTS.md), [repository and Tauri client architecture](https://github.com/spacedriveapp/spacedrive).
- GitButler: [Tauri startup, file-log target, debug switches, panic hook, DevTools, and log-archive command](https://github.com/gitbutlerapp/gitbutler/blob/master/crates/gitbutler-tauri/src/main.rs).
- Screenpipe: [log locations, format, and diagnostic queries](https://github.com/screenpipe/screenpipe/blob/main/.claude/skills/screenpipe-logs/SKILL.md), [isolated data directory, Tokio Console, and sanitizer recipes](https://github.com/screenpipe/screenpipe/blob/main/CONTRIBUTING.md), [log and SQLite acceptance checks](https://github.com/screenpipe/screenpipe/blob/main/TESTING.md).
- Tolaria: [consent-gated Sentry setup and path scrubber](https://github.com/refactoringhq/tolaria/blob/main/src-tauri/src/telemetry.rs), [React root error capture and local fatal overlay](https://github.com/refactoringhq/tolaria/blob/main/src/main.tsx).
- Flow Desktop: [logging level, secret policy, typed frontend error guidance, and stdout-only limitation](https://github.com/FlowNeuro/Flow-Desktop/blob/main/AGENTS.md).
- Pake: [Web Inspector development workflow](https://github.com/tw93/Pake/blob/main/docs/advanced-usage_CN.md), [fatal Tauri application-construction error to stderr](https://github.com/tw93/Pake/blob/main/src-tauri/src/lib.rs).
