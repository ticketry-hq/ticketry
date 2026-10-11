# Voice transcription

Launchkey Record toggles the external Handy application through a fixed desktop command.

Surfaces: desktop, manual

## Sub-features

- voice-handy-toggle: route the physical Record button to Handy's transcription toggle.
- voice-record-feedback: toggle the Record LED and restore its state after MIDI reconnect.
- voice-handy-failure: keep Studio usable when Handy cannot be started.

## How to get to it

With [Launchkey MIDI control](launchkey-midi-control.md) connected, press its physical **Record** button. It dispatches action `toggle-voice-transcription`; there is no registered default keyboard chord or Studio transcription button. Press Record again to send another toggle. The desktop invokes `/Applications/Handy.app/Contents/MacOS/handy --toggle-transcription`; this is an external tool integration, not an in-app recorder/editor. Sources: `studio/src/features/launchkey/launchkeyController.ts`, `studio/src/features/agents/actions/agentRunActions.ts` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/handy.rs`.

## Prerequisites

- macOS desktop with supported Launchkey hardware connected; browser runtime does not supply this native action.
- Handy installed at `/Applications/Handy.app`, configured and able to use the microphone. Follow the [hardware-check prerequisites](../../studio/docs/launchkey-hardware-check.md).
- Desktop startup requests macOS microphone permission for terminal voice tools, except automated startup-exit profiles. This does not prove Handy's own permissions are satisfied. Source: `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/run.rs` and `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/microphone_permission.rs`.

## Expected behavior

- **Toggle/feedback:** each Record press flips the controller's local Record light and dispatches the voice action. Reconnection restores the lit LED without sending an extra toggle. A second press sends another toggle rather than a separate cancel operation. Source: `studio/src/features/launchkey/launchkeyController.ts` and `studio/src/features/launchkey/launchkeyController.inputRouting.test.ts`.
- **Desktop success:** the main-window command starts the fixed Handy executable with its fixed toggle argument, discards process stdio and returns without waiting. The agent action reports handled after the runtime call. Source: `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/handy.rs` and `studio/src/features/agents/actions/agentRunActions.ts`.
- **Missing Handy/error:** command-start failure is recorded as `handy-toggle-transcription-failed` at debug level; the desktop adapter swallows invocation rejection. No toast, transcript result or retry UI is provided. Source: `studio/src/runtime/desktopRuntime.ts` and the Handy command.
- **Persistence:** Record state belongs to the current controller and is replayed on reconnect; it is not persisted as a server setting. Ticketry receives no transcript or authoritative Handy recording status. Transcript insertion, empty audio, accuracy and microphone failure behavior belong to Handy and remain unverified here.

## Verifying it

There is no production transcript DOM selector or GraphQL row. Observe the physical Record light, Handy's visible recording state and the destination receiving text during the [Launchkey hardware check](../../studio/docs/launchkey-hardware-check.md). Its Record-driven Handy step is the existing manual path; the script prompts an operator because it cannot establish acoustic input or Handy's result.

| Existing coverage | Narrow command | What it establishes |
| --- | --- | --- |
| `studio/src/test/desktopHandyContract.test.ts` | `bun run --cwd studio test -- src/test/desktopHandyContract.test.ts` | Source assertions for command registration, permissions, fixed executable/argument and nonblocking spawn. |
| `studio/src/test/overhaulMicrophonePermissionAcceptance.test.tsx`, `overhaul-500` | `bun run --cwd studio test -- src/test/overhaulMicrophonePermissionAcceptance.test.tsx` | Source assertions for macOS usage description, entitlement and permission request on ordinary startup; no microphone capture. |
| `studio/src/test/runtime/desktopRuntime.test.ts` | `bun run --cwd studio test -- src/test/runtime/desktopRuntime.test.ts -t 'Handy\|MIDI transport'` | Mocked fixed native invocation and swallowed failures. |
| `studio/src/test/overhaulAgentRunActionsAcceptance.test.tsx` | `bun run --cwd studio test -- src/test/overhaulAgentRunActionsAcceptance.test.tsx -t 'voice toggle'` | Agent action routes through the runtime contract. |
| `studio/src/features/launchkey/launchkeyController.inputRouting.test.ts` | `bun run --cwd studio test -- src/features/launchkey/launchkeyController.inputRouting.test.ts` | Fake MIDI Record/light and reconnect behavior. |
| `studio/src/test/overhaulLaunchkeyAcceptance.test.tsx`, `overhaul-256` | `bun run --cwd studio test -- src/test/overhaulLaunchkeyAcceptance.test.tsx -t 'overhaul-256'` | Controller to runtime mock, Record light and reconnect; no microphone or Handy process. |

The native shell registration is also covered by `studio/src/test/desktopShellContract.test.ts` (`bun run --cwd studio test -- src/test/desktopShellContract.test.ts`). No real speech/transcript acceptance harness was identified. Actual transcription and its destination require the external app, microphone and MIDI hardware; source tests cannot substitute for that proof.

## End-to-end suite

Suite: excluded (desktop-only): the only dispatcher of `toggle-voice-transcription` is the Launchkey controller's Record button, and `studio/src/runtime/browserRuntime.ts` installs `inertLaunchkeyRuntime`, whose `midi()` returns `null` and whose `toggleHandyTranscription()` performs no work. The browser has no Handy launch API, microphone path or MIDI controller, so no part of this entry is reachable there; physical proof stays with the [Launchkey hardware check](../../studio/docs/launchkey-hardware-check.md).

## Relevant code

- `studio/src/features/launchkey/launchkeyController.ts`: physical Record and LED routing.
- `studio/src/features/agents/actions/agentRunActions.ts` and `studio/src/app/navigation/actionIds.ts`: voice action dispatch and identity.
- `studio/src/runtime/desktopRuntime.ts` and `studio/src/runtime/launchkey.ts`: native call and inert unsupported runtime.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/handy.rs`: fixed external command and silent failure logging.
- `studio/src-tauri/crates/app/ticketry-desktop/src/desktop/microphone_permission.rs`: macOS authorization request.
- `studio/src-tauri/crates/app/ticketry-desktop/native/microphone_permission.m`: request only when authorization is not yet determined.
- [Desktop Runtime](../../studio/src-tauri/crates/app/ticketry-desktop/src/desktop/CONTEXT.md): desktop boundary ownership.

## Gotchas

- The Record light is local feedback, not acknowledgement from Handy. A missing executable or failed recording can leave the light inconsistent with Handy.
- The fixed macOS application path does not discover another install location. OS permission denial and Handy's model/download configuration are external prerequisites.
- Ticketry's startup helper does not reprompt after a remembered microphone denial and does not consume the authorization result. Handy's access must be verified separately.
- Browser action adapters are inert. A fake controller test passing on a browser-capable host is not speech or native command proof.
- Actual microphone capture, transcript accuracy/insertion, Handy cancellation and recording-state recovery after a full restart are unverified by the identified tests. No live hardware walkthrough was performed for this map.
