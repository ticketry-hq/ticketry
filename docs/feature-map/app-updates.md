# App updates

The desktop checks the stable release feed, shares availability with Settings and installs an update only after the user requests it.

Surfaces: browser, desktop, manual

## Sub-features

- `app-updates-launch-check`: Check once after frontend startup without downloading or interrupting the user.
- `app-updates-availability-indicator`: Show update availability on the footer Settings button and App updates tab.
- `app-updates-settings-section`: Display the installed version, release notes, manual checks and contextual retries.
- `app-updates-download-progress`: Report received bytes or percentage while the requested update downloads and installs.
- `app-updates-install-and-restart`: Verify the archive signature, install, then restart through ordinary desktop teardown.

## How to get to it

Launch desktop Ticketry for the automatic check. Open the footer **Open Settings** button, then the **App updates** tab in **Studio settings**. Global keymap action `settings` defaults to E outside editable input; an engaged native terminal routes Cmd+E to the same dialog. Settings is also reachable during startup recovery; see [Settings](settings.md) and [Startup and service health](startup-and-service-health.md).

Use **Check for updates**, then **Update and restart** when a version is available. Failures expose **Retry update check** or **Retry update** according to the failed operation. Opening the tab itself does not trigger another check.

## Prerequisites

Beyond the [index baseline](README.md), updating requires the desktop runtime, a reachable configured stable feed, and an applicable archive signed with the key trusted by the packaged application. No project, selected ticket or paid provider is required. An installed packaged app is required for meaningful replacement/relaunch evidence; a development or mocked runtime proves only its own boundary.

For the packaged acceptance command, use a macOS arm64 host with the normal desktop build prerequisites. The harness owns temporary apps, data, home directory, updater keys and a loopback HTTPS feed; it does not need the production updater private key. See [release operations](../../studio/release/OPERATIONS.md#packaged-in-app-update-acceptance) and the [Desktop Runtime context](../../studio/src-tauri/crates/app/ticketry-desktop/src/desktop/CONTEXT.md).

## Expected behavior

- Frontend startup checks once per process, including React Strict Mode/remounts. A successful available result adds the **Update available** accessible description and visual marker to Settings and its App updates tab. The section reads the same Apollo-owned result. A failed launch check remains quiet outside that section; opening it exposes the failure.
- While checking, **Checking for updates** is disabled. A current result shows **Ticketry is up to date** and the installed version; an available result shows the version, optional notes and **Update and restart**. Neither result downloads automatically. With the browser capability disabled, the section says **Updates are managed by the desktop app.**, exposes no update actions and never performs the launch check.
- User confirmation starts download/install and removes check actions while applying. Known totals show a clamped percentage; absent or zero totals show received megabytes without `aria-valuenow`. At 100%, the text says **Installing update**; restart waits for the combined download/install operation to resolve.
- An unreachable/invalid feed produces an alert and **Retry update check**. A transient install failure retains the displayed release and exposes **Retry update**. Invalid signatures produce **Update rejected: invalid signature. Ticketry was not changed.**, suppress install retry and require a new check; no restart is requested on install failure.
- Successful installation unsubscribes progress, shows **Restarting into version …** and requests restart once. The native restart performs the normal teardown before relaunch, including data-directory ownership release. There is no separate cancel/download-only action. Closing Settings does not cancel an in-flight operation: the update state owner lives outside the section. Availability/progress is process-local rather than a persisted WorkTracker record; the next process checks again. Actual data preservation across replacement is verified separately by the packaged harness.

## Verifying it

Observe button **Open Settings** and tab **App updates**, each with description **Update available** only when available. Use the section heading **App updates**, installed/current/version text, `role=alert`, and progressbar **Update download progress** with `aria-valuetext` and optional `aria-valuenow`. Wait for the terminal status rather than treating 100% downloaded as installation or relaunch proof.

| Existing coverage | What it establishes | Narrow command |
| --- | --- | --- |
| `studio/src/test/overhaulAppUpdatesAcceptance.test.tsx` | overhaul-209/210 current and available results; 211 progress; 212 feed retry; 213 signature refusal; 214 install retry; 215 restart ordering; 216 shared launch availability; 208 quiet launch failure; 206 browser gating. Real components with a substituted runtime, including Settings tab navigation. | `bun run --cwd studio test src/test/overhaulAppUpdatesAcceptance.test.tsx` |
| `studio/src/features/app-updates/internal/updateMachine.test.ts` | Pure state transitions, applying guards, progress and failure handling; no native updater. | `bun run --cwd studio test src/features/app-updates/internal/updateMachine.test.ts` |
| `studio/src/test/runtime/appUpdatesRuntime.test.ts` | Desktop command/result/error mapping and browser no-op/error boundary. | `bun run --cwd studio test src/test/runtime/appUpdatesRuntime.test.ts` |
| `studio/src/test/desktopShellContract.test.ts` | Static update plugin/permission/configuration, shared install/restart teardown and packaged-harness wiring contracts. | `bun run --cwd studio test src/test/desktopShellContract.test.ts -t 'update'` |
| `studio/src-tauri/crates/app/ticketry-desktop/src/app_updates` | Rust unit checks for native response/errors, chunk accounting and acceptance evidence; not real installation. | `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-desktop app_updates` |
| `studio/scripts/packaged-update-acceptance.mjs`, `studio/scripts/packaged-update-acceptance-runner.mjs` and `studio/scripts/packaged-update-webdriver.mjs` | Authored macOS arm64 packaged A→B install/reconnect, wrong-key refusal and unreachable-feed health. Records retained WorkTracker content, workspace, preferences, approved executables, compatible login state, ownership and old-process cleanup. Drives real native update commands through WebDriver invocation, not Settings DOM clicks. | `bun run --cwd studio release:acceptance:update` |

The packaged harness automates replacement/relaunch, but deliberately disables Apple signing/hardened runtime and skips notarization/Gatekeeper in its private temporary installation. Signed public-release launch, Gatekeeper and manual DMG fallback require release/operator checks described in [release operations](../../studio/release/OPERATIONS.md); this entry does not claim their automation. The generic [desktop agent harness](../../studio/e2e-desktop/README.md) is not an updater scenario. Real Settings click-through during replacement, modal-close continuation and relaunch failures have no dedicated end-to-end coverage here; close continuation is source-grounded. This map campaign performs no live updater run.

## End-to-end suite

Suite: studio/e2e/features/app-updates.spec.ts

The browser reaches only the capability boundary: `studio/src/runtime/browserRuntime.ts`
declares `appUpdates: false`, so Settings shows **Updates are managed by the desktop app.**
and no launch check, availability marker, progress or install path runs. Every
updater result, download and restart cell is therefore desktop-only.

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| `app-updates-launch-check` | desktop-only: the check calls the native updater feed, which the browser runtime refuses with `appUpdates: false` | n/a: the automatic check has no cancel step | desktop-only: a quiet launch-check failure needs the native feed | @case-app-updates-browser-boundary | desktop-only: the check starts only from desktop frontend startup | n/a: results are process-local and never persisted |
| `app-updates-availability-indicator` | desktop-only: an available result comes only from the native feed | n/a: the indicator is read-only | desktop-only: a failed check is produced only by the native feed | @case-app-updates-browser-boundary | @case-app-updates-browser-boundary | n/a: availability is process-local and never persisted |
| `app-updates-settings-section` | @case-app-updates-browser-boundary | n/a: closing Settings is not a cancellation and the browser section has no operation | desktop-only: feed and install retries need the native updater | @case-app-updates-browser-boundary | @case-app-updates-browser-boundary | n/a: the section renders process-local state only |
| `app-updates-download-progress` | desktop-only: progress events come only from the native download | n/a: there is no cancel or download-only action | desktop-only: install failures and signature refusal need the native updater | desktop-only: absent totals arrive only in native progress events | desktop-only: a download starts only from **Update and restart** in desktop Studio | n/a: progress is process-local |
| `app-updates-install-and-restart` | desktop-only: installation and relaunch require the packaged desktop app | n/a: there is no cancel after confirmation | desktop-only: install failure and restart dispatch are native | n/a: installation always has a selected release | desktop-only: restart follows only a native install | desktop-only: data preservation across replacement is proven by the packaged harness |

## Relevant code

- `studio/src/features/app-updates`: section, badges, launch effect, progress, state machine and Apollo-backed state owner.
- `studio/src/main.tsx`: production launch-check mount.
- `studio/src/app/shell/StudioFooterActions.tsx` and `studio/src/features/studio/modals/SettingsModal.tsx`: production opener, rail and availability descriptions.
- `studio/src/app/navigation/keymapBindings.ts` and `studio/src/app/navigation/nativeTerminalChords.ts`: Settings action and native entry.
- `studio/src/runtime/desktopAppUpdates.ts`, `studio/src/runtime/desktopRuntime.ts` and `studio/src/runtime/browserRuntime.ts`: command/event adapter and surface capabilities.
- `studio/src-tauri/crates/app/ticketry-desktop/src/app_updates`: stable updater, response/error contract, installation, progress, restart and acceptance-only TLS/evidence.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/lifecycle.rs`: updater registration and shutdown lifecycle.
- `studio/src-tauri/tauri.conf.json`, `studio/src-tauri/capabilities/studio-main.json` and `studio/src-tauri/build.rs`: packaged endpoint/key and narrow command permissions.
- `studio/release/manifest.v1.json` and `studio/release/OPERATIONS.md`: release artifact policy and operator procedures.

## Gotchas

- `desktop` is the updating surface; the browser fallback message is covered only to establish the capability boundary. Browser or mocked UI evidence cannot prove an installed binary changed.
- The frontend retry preserves its displayed release, but native download/install checks the feed again and installs the then-current applicable update. Do not assume that a mutable feed pins the originally displayed version.
- Closing Settings is not a cancellation flow. A percentage measures bytes, not completed installation. An unavailable total is not a frozen download.
- Restart dispatch failures only log natively, and the frontend restart rejection has no recovery UI in the current source. Successful relaunch or recovery from those failures remains unverified until observed.
- Packaged acceptance uses throwaway keys and acceptance-only CA trust without modifying system trust. Retain failed-run evidence with `TICKETRY_KEEP_PACKAGED_UPDATE_ACCEPTANCE=1`; otherwise the sandbox is removed. Public feed availability, real release credentials and other host architectures remain outside that harness's proof.
