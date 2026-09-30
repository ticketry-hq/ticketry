# Launchkey Mini MK3 hardware check

Run this check on an Apple silicon Mac with a Launchkey Mini MK3. It verifies the physical MIDI path that automated acceptance tests cannot cover.

## Before starting

- Install Handy at `/Applications/Handy.app` and confirm its microphone input works.
- Connect the Launchkey directly to the Mac. Do not run a DAW or another program that may claim its MIDI or DAW ports.
- Create two disposable Ticketry projects. Give each project a different set of agent runs so stale pad assignments are easy to spot.
- Keep one panel shell and one ready agent terminal available. Use unique text markers when checking Play so an accidental submission is obvious.
- Run the automated Launchkey tests first:

  ```bash
  npm run test --workspace @worktracker/studio -- \
    src/features/launchkey \
    src/test/overhaulLaunchkeyAcceptance.test.tsx \
    src/test/desktopShellContract.test.ts \
    src/test/desktopHandyContract.test.ts
  ```

## Run the check

Review the steps without hardware:

```bash
node studio/scripts/launchkey-hardware-check.mjs --list
```

On the test Mac, start the guided check from the repository root. Store its evidence outside the worktree unless the report belongs in a deliberate review artifact.

```bash
node studio/scripts/launchkey-hardware-check.mjs \
  --report /tmp/launchkey-hardware-check.md
```

For each step, type `pass` followed by an optional observation, or `fail` followed by the reason. A failed check does not stop later checks. This matters because standalone restoration is last and must run even after an earlier failure.

The check covers:

1. Connected startup and a stable DAW session claim after the agent status stream loads.
2. Startup without hardware, hot-plug, removal, and reconnect within two discovery intervals.
3. Pad assignment and colors for working, attention, completed, failed, and unused slots.
4. Exact agent-terminal focus from a lit pad and no action from an unused pad.
5. Record-driven Handy transcription, including the Record light on both toggles.
6. One Play submission to the selected ready agent terminal.
7. Full pad reassignment after changing projects.
8. Exclusion of panel shells from pad assignment and Play submission.
9. Standalone-mode restoration after a normal Ticketry quit.

For the last step, quit Ticketry normally. Open a MIDI monitor, software instrument, or DAW only after Ticketry has exited. Confirm that the Launchkey's pads, keys, knobs, and transport controls work without unplugging USB or restarting the device.

## Reading the result

Exit code `0` means the operator passed every step. Exit code `1` means at least one hardware behavior failed. Exit code `2` means the command was invalid or the host was not macOS.

The Markdown report records the Git revision, macOS version, CPU architecture, timestamp, result, and operator note for every step. Attach the report to CODING-1473. Do not commit reports that contain local project, task, or run names.
