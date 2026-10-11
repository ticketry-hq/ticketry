# Launchkey MIDI control

Desktop Launchkey Mini MK3 controls project run focus, status pads, external voice toggling and selected-terminal submission through native MIDI.

Surfaces: desktop, manual

## Sub-features

- launchkey-desktop-startup: Start one controller after the agent status service starts; browser MIDI stays inert.
- launchkey-discovery-recovery: Discover Mini MK3 DAW ports, hot-plug, silently retry failures and reconnect after removal.
- launchkey-run-pad-projection: Project eligible runs onto sixteen pads with status lights, Stories ordering and selected-run dimming.
- launchkey-pad-focus-acknowledgement: Focus an assigned agent terminal and acknowledge newly failed runs by pressing their pads.
- launchkey-record-play-controls: Route Record to external Handy transcription and Play to the selected ready agent terminal.
- launchkey-standalone-restoration: Return the controller to standalone mode and disconnect on normal desktop shutdown.

## How to get to it

Connect a Launchkey Mini MK3 to desktop Ticketry and select a project containing
agent runs. There is no MIDI settings page or enable button: desktop agent-status
startup starts the controller. Press a lit Session pad for keymap action
`focus-agent-run`; press Record for `toggle-voice-transcription` and Play for
`submit-selected-run-terminal`. These are registered action IDs without default
keyboard chords; their physical controls are the entry points.

Use the selected Story's terminal tab before Play. Panel shells are excluded.
Record delegates to the reachable external Handy command; see the
[hardware check](../../studio/docs/launchkey-hardware-check.md), rather than
assuming Ticketry contains a microphone or transcription editor.

## Prerequisites

The physical check requires an Apple silicon Mac, a connected Mini MK3 and
available native MIDI/DAW ports; another DAW must not claim those ports. The
controller matches Mini MK3 names and requires both DAW input and output.
Agent status must have started for a selected project. Play requires the active
workspace terminal to belong to an agent run with both status and transport
`ready`; it does not submit a panel shell.

Record additionally requires Handy installed at `/Applications/Handy.app` with
working microphone access. Follow the hardware document's disposable projects,
distinct run sets and unique submission markers. Native ownership belongs to
the [Desktop Runtime context](../../studio/src-tauri/crates/app/ticketry-desktop/src/desktop/CONTEXT.md).

## Expected behavior

Startup discovers immediately, then polls every two seconds. Missing hardware
and discovery/connection errors are silent and retried. Disappearance removes
old subscriptions and disconnects before reconnecting; stale transports must
not route input. Browser startup requests no MIDI runtime or Web MIDI access.

The sixteen pads show eligible `task`, `plan` and `docchat` runs in the selected
project; `shell` and `instant` scopes are excluded. Taskless runs precede Stories
tree order, followed by tasks outside the open module; ties use start time and
run ID. Overflow waits off-pad. Working is steady white; starting, reconnecting
and unknown pulse white; input needed pulses yellow; permission needed flashes
white; turn complete is steady green; quiet is blue; stalled is steady yellow;
error/lost are red. Unused or exited slots are off. If the selected run occupies
a pad, other occupied pads dim.

Only failures observed live during the current connection occupy red pads;
historical failures in the first snapshot do not. Newly failed runs remain even
when dropped from the snapshot, until a press acknowledges them, frees the pad
and shifts overflow forward. The press also routes focus to that run when it is
still available. Empty pads and releases do nothing. A project change clears
assignments and connection-local failure bookkeeping before rebuilding.

Record toggles its local light and dispatches Handy's toggle command; reconnect
restores that light without another toggle. Play sends one carriage return to
the selected ready agent viewer. Musical keys, knobs and unsupported transport
controls do not trigger these actions. The Record light is not confirmation
that Handy succeeded: command failures are silent in the UI and logged at debug
level. There is no cancel dialog or persisted MIDI preference. Pad assignments,
acknowledgements and Record-light state are connection/controller memory, rebuilt
from status on startup. Normal desktop quit sends standalone mode before native
disconnect; forced process death has no equivalent restoration guarantee.

## Verifying it

- Projection: `studio/src/features/launchkey/runPadProjection.test.ts` covers
  lights, selection dimming, tree order, overflow, failure acknowledgement,
  dropped failures and project changes. Narrow command:
  `bun run --cwd studio test -- src/features/launchkey/runPadProjection.test.ts`.
- Discovery and input: `studio/src/features/launchkey/launchkeyController.lifecycle.test.ts`,
  `studio/src/features/launchkey/launchkeyController.resilience.test.ts`,
  `studio/src/features/launchkey/launchkeyController.inputRouting.test.ts` and
  `studio/src/features/launchkey/launchkeyStartup.test.ts` cover matched ports,
  reconnect, stop races, silent retry, release filtering and startup gating.
  Run `bun run --cwd studio test -- src/features/launchkey` for this unit slice;
  each cited file can be selected separately for its narrower concern.
  `studio/src/app/startup/startAgentStatusServices.test.ts` checks startup call
  order; run `bun run --cwd studio test -- src/app/startup/startAgentStatusServices.test.ts`.
- Numbered integration cases `overhaul-255`, `overhaul-256`, `overhaul-257` in
  `studio/src/test/overhaulLaunchkeyAcceptance.test.tsx` exercise fake MIDI
  messages through production actions, terminal focus, selected-viewer submission,
  Record toggles, reconnect, project reset and inert browser/no-device behavior.
  Run `bun run --cwd studio test -- src/test/overhaulLaunchkeyAcceptance.test.tsx`;
  select a case with `-t overhaul-255`, `-t overhaul-256` or `-t overhaul-257`.
  The numbered suite is also included in `bun run --cwd studio test:overhaul`.
- Native wiring is a source contract, not hardware execution:
  `studio/src/test/desktopShellContract.test.ts` checks pinned adaptor registration,
  permissions and standalone-before-disconnect shutdown. Narrow command:
  `bun run --cwd studio test -- src/test/desktopShellContract.test.ts -t Launchkey`.
  `studio/src/test/desktopHandyContract.test.ts` checks the registered external
  command; run `bun run --cwd studio test -- src/test/desktopHandyContract.test.ts`.
  `studio/src/test/runtime/desktopRuntime.test.ts` and
  `studio/src/test/runtime/browserRuntime.test.ts` check adapter calls/inert
  browser operations; run `bun run --cwd studio test -- src/test/runtime/desktopRuntime.test.ts src/test/runtime/browserRuntime.test.ts`.
- Physical MIDI, visible pad colors, microphone transcription, exact native
  terminal focus, physical Play submission and post-quit standalone controls
  require hardware and operator observations. Follow the
  [Launchkey hardware check](../../studio/docs/launchkey-hardware-check.md):
  `node studio/scripts/launchkey-hardware-check.mjs --list` previews steps;
  `node studio/scripts/launchkey-hardware-check.mjs --report /tmp/launchkey-hardware-check.md`
  records revision/host and pass/fail evidence on the test Mac. Its nine checks
  include hot-plug within two discovery intervals, project reassignment and
  panel-shell exclusion. The prompt runner does not sense the device or certify
  observations automatically. `studio/scripts/launchkey-hardware-check.test.mjs`
  tests the checklist/report format only; run
  `node --test studio/scripts/launchkey-hardware-check.test.mjs`.

No current browser Playwright or desktop WebDriver journey drives physical
Launchkey hardware. Fake transports and mocked focus/Handy calls cannot prove
native MIDI port ownership, actual lights, microphone output or device usability
after quit. This map authoring performs no hardware walkthrough.

## End-to-end suite

Suite: excluded (manual): every sub-feature needs a physical Launchkey Mini MK3 and an operator; the browser runtime installs `inertLaunchkeyRuntime` (`midi()` returns `null`), so the controller never starts there. Proof is the operator-driven [Launchkey hardware check](../../studio/docs/launchkey-hardware-check.md) (`studio/docs/launchkey-hardware-check.md`).

## Relevant code

- `studio/src/features/launchkey`: controller, startup, pad projection and their unit fixtures/tests.
- `studio/src/app/startup/startAgentStatusServices.ts`: desktop startup call after status stream setup.
- `studio/src/app/navigation/actionIds.ts` and `studio/src/app/navigation/keymapRegistry.ts`: action identities and dispatch registration.
- `studio/src/features/agents/actions/agentRunActions.ts` and `studio/src/features/agents/actions/selectedAgentRun.ts`: run focus and selected-ready-viewer guard.
- `studio/src/runtime/desktopLaunchkeyMidi.ts`, `studio/src/runtime/desktopRuntime.ts` and `studio/src/runtime/browserRuntime.ts`: native transport, Handy/viewer IPC and inert browser adapter.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs`, `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/lifecycle.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/handy.rs`: adaptor registration, normal shutdown and external Handy spawn.
- `studio/scripts/launchkey-hardware-check.mjs` and `studio/docs/launchkey-hardware-check.md`: guided physical verification and evidence format.

## Gotchas

Stories order is reread on status or selection ticks, not on a dedicated tree
subscription; reorder-only changes can leave pads temporarily stale. Red-pad
acknowledgement and controller-local Record state do not survive a new controller;
reconnect reconstructs the pad projection and restores only the controller's
Record light. A failure that is already historical when reconnecting is not
newly observed live.

Record's optimistic light does not track Handy's actual recording state, and
spawn success does not establish transcription or insertion. The hardware doc's
CODING-1473 report destination is historical; use the current task's evidence
destination. Its Apple silicon/macOS requirements describe the supported manual
check, not proof of other hardware/OS support. Physical timing, native focus,
Handy output and standalone recovery beyond the cited tests remain unverified
until the hardware check is run.
