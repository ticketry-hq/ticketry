# Startup and service health

Startup resolves the installation's project and remembered workspace, gates unsafe service states, and keeps Settings reachable during recovery.

Surfaces: browser, desktop
Editions: pocock, core

## Sub-features

- `startup-bootstrap-gate`: Resolve startup data before mounting onboarding or the shell, with connecting, provisioning, unavailable and retry states.
- `startup-service-health-gate`: Block starting, recovering and failed services; allow ready and degraded services to show Studio.
- `startup-settings-access`: Open Settings from every gate screen even when the footer and shell shortcuts are unavailable.
- `startup-workspace-restoration`: Restore a valid remembered linked module and its Story or scratch workspace without opening a folder prompt.
- `startup-reload-evidence`: Refresh after observed service recovery and preserve the reason for the next document's log.

## How to get to it

Open or reload Ticketry using an isolated runtime from the [index](README.md). Service health wraps the bootstrap gate, which wraps onboarding and the shell. Startup screens appear automatically; they are not a separate navigation destination.

Use the visible Retry button when bootstrap reports provisioning or an unavailable local server. On service failure, Retry appears only when the runtime supports service retry; the browser runtime instead instructs you to restart its development server and reload. Open Settings is the accessible button on connecting, preparing, recovering and failed screens; it opens the Studio settings dialog over the gate. Shell keymap actions are unavailable until the shell mounts.

## Prerequisites

Use disposable data when deliberately interrupting startup. For restoration checks, first select a module with a saved folder link and a Story or scratch workspace. A remembered module must still exist and have a visible tab presentation and folder link.

Service-health recovery requires a runtime that publishes recovering and ready health events. The stock browser runtime has no native supervision and reports restart recovery; it cannot prove desktop service supervision.

## Expected behavior

- Bootstrap initially shows Connecting to local work tracker… and One moment…. It reads projects and module links before anything can prompt, then selects the installation project. A transport failure becomes The local server is not running.; unresolved provisioning stays on a retry screen. Unavailable and provisioning states retry automatically after two seconds and also offer Retry; an in-flight bootstrap is shared across Strict Mode effect replay.
- A valid remembered linked module is restored. A hidden remembered module falls back to the first visible linked module; no eligible fallback leaves no module selected. A removed or unlinked remembered module is not opened and does not trigger a folder prompt; the empty workspace shows the module recovery region (**Sprint module recovery** in core, **Module selection** in Pocock). Restored document intent waits for document discovery rather than stealing focus during hydration.
- Starting shows Preparing Ticketry data; recovering shows Reconnecting to the local server. Failed health replaces Studio with a diagnostic heading, message and any log pointer. Retry disables itself while busy, prevents concurrent attempts and shows a recovery error on failure. Restart-only runtimes explain the required restart. Ready and degraded health release the gate.
- Ready after an observed recovering state requests one full reload with source service-health-recovered. An ordinary ready event without recovery does not reload. Reload evidence records time, URL and cause in session storage before refresh; the next document logs and clears that evidence. Storage or serialization failure must not prevent the refresh.
- Open Settings remains available while the gate replaces the shell. Closing that dialog returns to the current gate; opening Settings itself does not recover the service. There is no cancel action that bypasses a startup gate.

## Verifying it

Browser suite: `studio/e2e/features/startup-and-service-health.spec.ts`.

Drive the real launch/reload path. Observe the gate text, headings, Retry enabled state, role status or alert, and Open Settings; verify the resulting dialog by accessible name Studio settings. These gates have no dedicated test IDs: use their accessible names and text. After recovery, wait for Project module tabs rather than a fixed delay. Confirm selected module/Story and document tab after another reload; inspect the saved selection and reload cause rather than claiming success from a disappearing spinner.

### Planner and sprint discovery by edition

Startup composes the planner listener and sprint discovery only in the core edition. In Pocock (CODING-2863) desktop composition and the browser development adapter open no planner listener (the adapter logs `Ticketry planner not started`), `desktop_runtime_configuration` omits `plannerEndpoint`, no sprint-discovery executor is attached, and startup never fails interrupted `agent_executions` rows: they stay exactly as persisted. A sprint-discovery `agent_execution_create` or `agent_execution_update` reaches the same registered GraphQL field in both editions and is refused in Pocock with `edition_capability_unavailable`. Core startup, planner readiness and recovery are unchanged; see the [planner service](../planner-service.md).

### Reading the compiled edition in e2e

CODING-2857 gives e2e a read-only way to fail when a stale binary or frontend of the wrong edition is under test. Both values are informational: they are not a user-visible indicator or a Settings surface, and the frontend never gates on the host's edition (`editionHas()` alone gates rendering).

- Frontend: once the shell mounts, the document root carries `data-ticketry-edition="pocock|core"`, written from `EDITION` in `studio/src/shared/config/edition.ts`. Playwright: `await expect(page.locator("html")).toHaveAttribute("data-ticketry-edition", "core")`. WebDriver: `document.documentElement.dataset.ticketryEdition`.
- Desktop host: the `desktop_runtime_configuration` startup payload carries `edition`, ready and failed-startup alike. The frontend keeps it as `runtimeConfiguration().edition` without reading it.
- Development adapter: `GET /runtime-configuration` returns `{"edition": "pocock|core"}` for the edition the adapter binary was built with. Vite proxies the route, so a browser test can call `page.request.get("/runtime-configuration")` on the app origin.

Existing automated coverage (listed cases are evidence in source, not a live walkthrough performed by this map):

| Coverage | What it proves | Narrow command from the repository root |
| --- | --- | --- |
| `studio/e2e/web-app.spec.ts`, recovers bootstrap after the local Rust adapter is initially unavailable | Aborted GraphQL reaches unavailable; removing the abort and clicking Retry restores visible module tabs. | `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'recovers bootstrap'` |
| `studio/src/test/overhaulStartupAcceptance.test.tsx` | Project/link ordering, remembered-module eligibility and empty fallbacks; overhaul-288 restores Story/scratch intent; overhaul-736 renders the remembered document without focus takeover. | `bun run --cwd studio test src/test/overhaulStartupAcceptance.test.tsx` |
| `studio/src/test/ServiceHealthGate.test.tsx` | Recovery blocks Studio and reloads once, ready alone does not reload, duplicate retries are refused and retry failure stays gated. | `bun run --cwd studio test src/test/ServiceHealthGate.test.tsx` |
| `studio/src/test/overhaulWebSettingsReachabilityAcceptance.test.tsx` | overhaul-217, overhaul-218 and overhaul-219 open Settings from bootstrap, failed health and starting health; Strict Mode shares bootstrap. | `bun run --cwd studio test src/test/overhaulWebSettingsReachabilityAcceptance.test.tsx` |
| `studio/src/app/startup/reloadStudio.test.ts` | Cause is stored before refresh, reported once next document, and refresh survives unserializable evidence. | `bun run --cwd studio test src/app/startup/reloadStudio.test.ts` |
| `studio/src/test/overhaulProductionStartupAcceptance.test.tsx` | overhaul-365 checks production-bundle workspace initialization before rendering. | `bun run --cwd studio test src/test/overhaulProductionStartupAcceptance.test.tsx` |
| `studio/src/test/overhaulCoreEditionAcceptance.test.tsx`, `studio/src/test/overhaulPocockEditionSurfacesAcceptance.test.tsx` | The mounted shell marks the document root with the compiled edition, under the core and Pocock Vitest configurations. | `bun run --cwd studio test src/test/overhaulCoreEditionAcceptance.test.tsx` and `bun run --cwd studio test:pocock` |
| `studio/src/test/editionSeamContract.test.ts`, `studio/src/test/runtime/desktopRuntime.test.ts` | Only the runtime contract validator touches the host-reported edition; it is kept when valid and rejected outside the manifest's editions. | `bun run --cwd studio test src/test/editionSeamContract.test.ts src/test/runtime/desktopRuntime.test.ts` |
| `ticketry-desktop` `runtime_configuration` tests | The published ready and failed-startup configuration carries `edition: "pocock"` by default and `"core"` with the Core feature. | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-desktop runtime_configuration` (add `--features ticketry-edition/edition-core` for core) |
| `ticketry_graphql_adapter` `runtime_configuration` tests | `GET /runtime-configuration` reports the edition the adapter was built with. | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-dev-tools --bin ticketry_graphql_adapter runtime_configuration` (add `--features edition-core` for core) |
| `ticketry-desktop` `planner_runtime` test | Pocock opens no planner listener and publishes no `plannerEndpoint`; core opens the listener and publishes a loopback endpoint once ready. | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-desktop planner_runtime` (add `--features ticketry-edition/edition-core` for core) |
| `ticketry_graphql_adapter` `planner` tests | The development adapter starts no planner under Pocock and its absent planner never ends the server; core serves and joins the listener. | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-dev-tools --bin ticketry_graphql_adapter planner` (add `--features edition-core` for core) |
| `studio/src-tauri/tests/sprint_discovery_edition.rs` | Through real adoption and public GraphQL: Pocock leaves an interrupted execution untouched across restart and refuses `agent_execution_create`/`_update` with `edition_capability_unavailable`; core recovers it as failed and cancels through the same field. | `cargo test --manifest-path studio/src-tauri/Cargo.toml --test sprint_discovery_edition` (add `--features edition-core` for core) |
| `studio/scripts/desktop-planner-acceptance.mjs` | Authored WKWebView/native GraphQL and planner-listener scenario checks ready metadata, clean shutdown/restart, occupied-port failure guidance, absent ineffective Retry and reachable Settings. It invokes transport directly rather than Plan UI. | `TICKETRY_EDITION=core bun run --cwd studio test:planner:desktop` (requires core; refuses under Pocock) |

Degraded passthrough, exact failure-heading classification and the two-second automatic retry policy are source-grounded in the gates; the listed tests do not independently prove every branch. Native recovery and real file-log delivery require desktop evidence; the component tests use runtime/reload substitutes.

## End-to-end suite

Suite: studio/e2e/features/startup-and-service-health.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| startup-bootstrap-gate | @case-startup-bootstrap-retry | n/a: startup cannot be bypassed | @case-startup-bootstrap-retry, @case-startup-automatic-retry, @case-startup-error-settings | n/a: installation provisioning supplies a project; read failure stays gated | @case-startup-bootstrap-retry, @case-startup-automatic-retry | @case-startup-bootstrap-retry |
| startup-service-health-gate | @case-startup-workspace-reload | n/a: service readiness cannot be cancelled | desktop-only: browser reports fixed ready health and does not supervise services | n/a: health is always supplied by the runtime | @case-startup-workspace-reload | desktop-only: service restart/recovery requires desktop supervision |
| startup-settings-access | @case-startup-connecting-settings, @case-startup-error-settings | @case-startup-connecting-settings, @case-startup-error-settings | @case-startup-error-settings | n/a: Settings access has no empty collection | @case-startup-connecting-settings, @case-startup-error-settings | n/a: opening a gate dialog does not persist a preference |
| startup-workspace-restoration | @case-startup-workspace-reload, @case-startup-scratch-reload | n/a: restoration has no cancel action | @case-startup-missing-module, @case-startup-hidden-module | @case-startup-missing-module, @case-startup-hidden-module | @case-startup-workspace-reload, @case-startup-scratch-reload, @case-startup-missing-module, @case-startup-hidden-module | @case-startup-workspace-reload, @case-startup-scratch-reload, @case-startup-missing-module, @case-startup-hidden-module |
| startup-reload-evidence | desktop-only: emitted by supervised recovering-to-ready health | n/a: requested recovery reload has no cancel action | desktop-only: storage failures during supervised reload require native health events | n/a: reload evidence is an event not a collection | desktop-only: browser runtime never emits recovering health | desktop-only: recovery-cause round-trip requires supervised service recovery |

Network aborts and error envelopes exercise unavailable/provisioning recovery;
successful responses always come from the real Rust adapter. Scratch restoration starts from an existing client navigation preference: the
current New conversation row launches a run, so it is not a scratch-selection
control. A removed remembered module correctly leaves no module selected; the
first-visible fallback applies to a remembered module that exists but is hidden.
With no module selected, the workspace shows the project-level recovery region
from `studio/src/features/work-items/filter/SprintModuleRecovery.tsx`, named
**Sprint module recovery** in the core edition and **Module selection** in the
Pocock edition; both say Select a module to view its stories. and offer Manage
modules. `@case-startup-missing-module` runs in both editions: it reads the
edition from `GET /runtime-configuration`, requires the document root's
`data-ticketry-edition` to match, and expects that edition's exact label.
The legacy bootstrap
case title and assertions remain in `studio/e2e/web-app.spec.ts`. Baseline CODING-2708 was
blocked by retired setup selectors; CODING-2711 updates that shared prerequisite
for the CODING-2643 Module Manager.

## Relevant code

- `studio/src/app/startup`: Bootstrap and service-health gates, bootstrap orchestration, Settings fallback, reload evidence and startup traces.
- `studio/src/app/StudioApp.tsx`: Gate order and handoff to the shell.
- `studio/src/app/startup/useCompiledEditionMarker.ts`: Writes `data-ticketry-edition` on the document root from the shell.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/runtime_configuration.rs`: The desktop startup configuration, including the host's compiled `edition`.
- `studio/src-tauri/crates/app/ticketry-dev-tools/src/bin/ticketry_graphql_adapter/runtime_configuration.rs`: The development adapter's `GET /runtime-configuration`.
- `studio/src/runtime/browserRuntime.ts`: Browser service health, restart-only recovery and capability limits.
- `studio/src/state/persistence.ts`: Remembered module and Story selection.

## Gotchas

- A served frontend is not evidence that the Rust adapter is available. Bootstrap unavailable and service-health failed are distinct states with different recovery actions.
- CODING-2708 recorded the legacy browser baseline as setup-blocked by removed-sidebar selectors. CODING-2711 migrated the shared setup to Module Manager; the feature suite retains the exact bootstrap case title and verifies the current path.
- The desktop planner harness builds the supported xterm fallback without default native features and uses direct GraphQL calls rather than Plan UI. Its startup/bind-failure and same-profile restart assertions are authored coverage, not execution evidence from this map task; they make no native libghostty rendering claim.
- Settings loads through the modal host outside the gates. A missing footer or unavailable global chord on a gate is expected; use Open Settings.
- Bootstrap may repeat while provisioning. Wait for observable readiness; do not label the initial connecting state a permanent failure.
- A full reload replaces the document. Read the pending reload evidence in the next document/log; absence of a same-tick log line is not proof that no reload occurred.
- Snapshot/recovery messaging is grounded in the gate source; this entry does not prove native snapshot creation, backend repair or installed-app recovery. No live walkthrough was performed.
- The document-root edition marker appears only after the shell mounts. A bootstrap or service-health gate screen has no marker yet; for those states, read the host's edition from the runtime configuration instead.
