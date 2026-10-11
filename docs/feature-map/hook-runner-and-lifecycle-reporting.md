# Hook runner and lifecycle reporting

The packaged hook helper publishes provider events atomically for Ticketry's Runs service to ingest and expose as durable lifecycle status.

Surfaces: browser, desktop, manual

## Sub-features

- `hook-map-packaged-runner`: Resolve the shipped helper and pass provider-specific hook commands at launch.
- `hook-map-atomic-spool`: Publish raw stdin payloads as complete private hook files.
- `hook-map-provider-event-mapping`: Translate supported provider events into Runs lifecycle facts.
- `hook-map-durable-ingestion`: Acknowledge valid deliveries transactionally and retry transient failures.
- `hook-map-invalid-deliveries`: Quarantine malformed input and ignore intentional no-op events.
- `hook-map-periodic-drain`: Drain complete deliveries periodically while the runtime runs.
- `hook-map-startup-and-shutdown`: Drain retained deliveries when the runtime starts and before it shuts down.
- `hook-map-status-observation`: Observe durable run lifecycle and module aggregates through normal status consumers.

## How to get to it

The provider's configured lifecycle hook invokes the absolute packaged
`ticketry-hook` executable with `hook <agy|claude|codex|gemini> --agent-run-id <id>
--spool-dir <absolute-spool-directory>` and pipes its event JSON to stdin. The
launch runtime supplies the helper and spool path; an agent does not click a
UI control to report a hook. Hook mode can also obtain its run ID from
`MUXED_AGENT_RUN_ID`. MCP mode of the same binary is described in
[MCP server and tools](mcp-server-and-tools.md).

For manual verification, use a disposable configured provider/run and its actual
hook command, then observe Ticketry's lifecycle indicators. The desktop harness
exercises this path through **Run item**; that launch UI is mapped in
[Agent launch](agent-launch.md), and indicator behavior is mapped in
[Agent lifecycle and status](agent-lifecycle-and-status.md).

## Prerequisites

A running Ticketry desktop instance needs the packaged helper, a validated real
spool directory and an existing Agent Run for lifecycle acceptance. Startup
resolves the helper beside the executable or in packaged resource locations.
The spool lives in the system temporary directory as
`ticketry-hook-spool-<data-directory-digest>`: it is distinct per data directory
and outside that directory. Test only with the index's isolated installation;
the manually supplied spool path must be absolute and must not be a symlink.
Paid-provider execution is unnecessary for the disposable desktop scenario.

## Expected behavior

- Hook mode writes raw stdin, up to 1 MiB, into a newly created private temporary
  file, syncs it and atomically renames it to a versioned `.hook` filename
  carrying provider and run identity. Partial `.tmp` files are never consumed.
  Hook invocation/spool failures stay silent and exit successfully so that
  reporting failure does not break the provider. A successful exit alone
  therefore proves no delivery. Source: helper CLI, main and spool modules.
- Ticketry validates the spool root before exposing it to providers, rejects
  symlink/non-directory roots and performs bounded serialized scans of complete
  files. The hook consumer maps JSON and filename identity into a lifecycle
  fact and sends it to `LifecycleService::apply_lifecycle_fact`. Valid files
  remain until durable acceptance; transient read/acceptance/removal failures
  retain delivery for retry. Permanent malformed/unsupported input goes to a
  quarantine directory. Recognized payloads with unmapped events are no-ops
  and removed. Source: Runs hook-spool modules and tests below.
- Session, prompt, tool, attention and turn events have provider-specific
  mapping. In particular, Codex `Stop` means awaiting input and
  `PermissionRequest` means permission required; Claude `Stop` means turn
  complete. Event names alone must not be interpreted as process exits.
  Provider session identity is recorded when present.
- Desktop startup wires the Runs lifecycle sink, terminal lifecycle and periodic
  spool worker. Startup, periodic and final drains support deliveries retained
  across a runtime restart. A removed/invalid root is diagnostic, not an empty
  successful scan. Lifecycle facts reach the authoritative Runs reducer and
  status consumers; terminal reconciliation separately determines process/run
  outcomes. No hook-specific cancel UI exists; stopping a run uses the ordinary
  run controls, not deletion of spool files.

## Verifying it

Inspect complete `.hook` publication in an isolated spool and its acceptance or
quarantine outcome, then read the authoritative Agent Run lifecycle state and
observe `agent-state-badge`, module lifecycle indicators and settled terminal
status. Readback and eventual disappearance after acceptance matter more than
the helper's exit code. Reload/restart the same isolated profile to distinguish
durable status from a surviving frontend snapshot.

| Existing coverage | Narrow command | Proof limit |
| --- | --- | --- |
| `studio/src-tauri/crates/app/ticketry-hook/tests/cli.rs`: `hook_spools_the_raw_payload_and_keeps_failures_silent` | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-hook --test cli hook_spools_the_raw_payload_and_keeps_failures_silent` | Real helper subprocess; no Runs ingestion. |
| `studio/src-tauri/crates/worktracking/ticketry-runs/src/hook_spool/tests.rs`: provider mappings, 1 MiB limit, partial/no-op events, retry across restart, quarantine, symlinks, bounded scans and all drain phases | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-runs --lib hook_spool` | Consumer with fake lifecycle sink, plus directory validation tests; no installed provider. |
| `studio/scripts/desktop-acceptance-provider.test.mjs`: disposable provider/bridge contract | `node --test studio/scripts/desktop-acceptance-provider.test.mjs` | Fixture construction/contract only. |
| `studio/scripts/desktop-agent-acceptance.mjs` and `studio/scripts/desktop-acceptance-provider.mjs` | `bun run --cwd studio test:e2e:desktop` | Authored macOS WKWebView scenario with packaged helper, actual spool/lifecycle services, child process/private tmux, reload and desktop application restart with disposable Codex-compatible provider; stale setup is described below. |

The [desktop harness](../../studio/e2e-desktop/README.md) requires provider hook
evidence in `provider-hooks.log`, observes the active and completed task/run and
module aggregate, and verifies Done plus the completed terminal after reload
and restart. Its Story moves Implement → Review → Done use MCP separately from
hooks; both channels are exercised, but a hook alone does not move the Story.
This is authored coverage, not current passing desktop proof: the harness
still clicks **+ Add Module**, while current setup uses the footer Module
Manager's **New module** form. It inherits the source-confirmed module-creation
setup drift described in [Onboarding gotchas](onboarding.md#gotchas), which must
be migrated before this scenario can establish current desktop hook delivery.
Frontend status consumer acceptance coverage is listed in
[Agent lifecycle and status](agent-lifecycle-and-status.md); mocked status
frames do not establish hook delivery. These entries were grounded in source
and existing tests without a live walkthrough. No current full installed
desktop hook journey for each of Claude, Gemini and Agy, or paid-provider hook
execution, was identified; the mapping tests cover their event contract only.

## End-to-end suite

Suite: studio/e2e/features/hook-runner-and-lifecycle-reporting.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `hook-map-packaged-runner` | @case-hook-launch-lifecycle | n/a: a hook invocation has no cancel step; runs stop through ordinary run controls | @case-hook-silent-failures @case-hook-invalid-deliveries | @case-hook-invalid-deliveries | @case-hook-launch-lifecycle @case-hook-provider-event-mapping | @case-hook-launch-lifecycle |
| `hook-map-atomic-spool` | @case-hook-invalid-deliveries @case-hook-provider-event-mapping | n/a: publication is one atomic rename with no cancel step | @case-hook-silent-failures | @case-hook-invalid-deliveries | @case-hook-provider-event-mapping | @case-hook-invalid-deliveries |
| `hook-map-provider-event-mapping` | @case-hook-provider-event-mapping @case-hook-launch-lifecycle | n/a: mapping is automatic and has no cancel step | @case-hook-invalid-deliveries | @case-hook-invalid-deliveries | @case-hook-provider-event-mapping | @case-hook-provider-event-mapping |
| `hook-map-durable-ingestion` | @case-hook-launch-lifecycle | n/a: acceptance is automatic and has no cancel step | @case-hook-silent-failures | @case-hook-invalid-deliveries | @case-hook-launch-lifecycle | @case-hook-launch-lifecycle @case-hook-provider-event-mapping |
| `hook-map-invalid-deliveries` | @case-hook-invalid-deliveries | n/a: quarantine is automatic and has no cancel step | @case-hook-invalid-deliveries | @case-hook-invalid-deliveries | @case-hook-invalid-deliveries | @case-hook-invalid-deliveries |
| `hook-map-periodic-drain` | @case-hook-provider-event-mapping | n/a: the drain worker has no cancel control | @case-hook-invalid-deliveries | @case-hook-invalid-deliveries | @case-hook-provider-event-mapping | @case-hook-provider-event-mapping |
| `hook-map-startup-and-shutdown` | desktop-only: startup and final drains run only when the owning runtime starts or stops; the browser suite cannot restart the shared adapter, and the desktop harness restart covers it | n/a: shutdown draining has no cancel step | desktop-only: rejecting a removed or symlinked spool root happens at runtime startup, proven by `ticketry-runs` directory-layout tests and desktop startup | desktop-only: a startup drain over an empty spool needs a runtime restart | desktop-only: drains on runtime start and stop, which only the desktop restart drives | desktop-only: deliveries retained across a restart need the runtime to restart |
| `hook-map-status-observation` | @case-hook-launch-lifecycle @case-hook-provider-event-mapping | n/a: lifecycle chips are read-only | @case-hook-silent-failures | @case-hook-launch-lifecycle | @case-hook-provider-event-mapping | @case-hook-launch-lifecycle @case-hook-provider-event-mapping |

Cases launch the disposable Codex-compatible provider through **Run item** and
read the production hook command from the launch arguments. They publish
payloads by piping them to that exact command, as a provider does, then observe
the spool, its quarantine, authoritative holdings and the row and module-tab
lifecycle chips, before and after reload. The GraphQL adapter runs the same Runs
hook spool and periodic drain as desktop. Gemini and Agy mappings are
exercised by publishing their payload shapes through the packaged runner.
No real Gemini, Agy or Claude process runs. Transient acceptance failures need
an injected database or filesystem fault, which the browser suite must not
inject; their retry stays proven by the `ticketry-runs` hook-spool tests above.

## Relevant code

- `studio/src-tauri/crates/app/ticketry-hook/src`: hook CLI, silent failure policy and atomic spool publication.
- `studio/src-tauri/crates/worktracking/ticketry-runs/src/hook_spool`: directory identity, event mapping, ingestion/retry/quarantine and worker drains.
- `studio/src-tauri/crates/worktracking/ticketry-runs/src/persistence`: authoritative lifecycle fact acceptance and Runs persistence.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/packaged_binaries.rs`, `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/rust_runtime_launch.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/lifecycle.rs`: packaged helper lookup, lifecycle startup and shutdown.
- `studio/src-tauri/crates/execution/ticketry-launch/src/planning`: provider hook/MCP command construction.
- `studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/lifecycle`: terminal lifecycle orchestration and reconciliation.

## Gotchas

- The spool is a transport mailbox, not a second authoritative run store. Do
  not edit live spool files to force status; lifecycle acceptance and process
  reconciliation have separate responsibilities. A retained file may mean
  retry, and an empty spool alone proves neither completion nor successful
  delivery. Silent producer failures require independent evidence.
- Provider mappings differ. A turn ending, awaiting user input, workflow state
  changing and the process exiting are separate facts. Browser status fixtures
  cannot prove native desktop delivery, terminal rendering or paid execution.
- Hook files are bounded and versioned; unknown payload versions and invalid
  identities are quarantined by the consumer. A temporary-directory cleanup
  can remove the spool between runs; startup creates and validates it again.
- To verify work state, follow [MCP state readback](mcp-server-and-tools.md) and
  the [Work Management context](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/CONTEXT.md).
  [CLAUDE.md](../../CLAUDE.md) requires identity-scoped restricted model writes,
  exclusive state-transition patches and agent workflow permissions; lifecycle
  reporting supplies no permission to bypass those gates. The
  [route/operation registry](../../studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/operation_registry.rs)
  remains the authority for GraphQL exceptions.
