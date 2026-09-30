# Implementation of review tasks 018–021

All four fixes are implemented.

| Task | Result |
| --- | --- |
| [018](018-reconciliation-snapshot-order.md) | Recorded sessions are read before the runtime snapshot. Sessions published during the snapshot wait for the next sweep. |
| [019](019-retain-failed-description-drafts.md) | Apollo retains description drafts by Story identity. Failed navigation saves reopen with the original text; save boundaries serialize requests, and older responses cannot clear a newer draft. Existing external-change controls remain supported. |
| [020](020-reparent-destination-convergence.md) | Reparenting refreshes the source modules plus the authoritative destination before recording local convergence. |
| [021](021-work-item-picker-placement.md) | Work-item search UI and its tests live in features/work-items. Shared popover primitives live in shared/ui, with existing callers updated. |

## Validation

- All 9 Rust terminal reconciliation tests pass.
- All 19 focused frontend tests pass, including failed navigation saves,
  queued edits, external-description changes, sidebar reparenting, and picker behavior.
- TypeScript typecheck, architecture lint, and `git diff --check` pass.
- New acceptance cases 284 and 285 are registered; the numbered gate passes.
- The full overhaul suite was run twice: 432 tests pass, 2 fail.

The remaining failures are outside tasks 018–021:

- `overhaulCutoverReadinessAcceptance.test.tsx`, case 156, expects the old
  startup wording that blocks on runtime reconciliation. The current screen
  says terminal recovery finishes after the window opens.
- `overhaulLaunchkeyAcceptance.test.tsx`, case 255, expects MIDI
  `[0x92, 96, 5]` after acknowledging a failed run. The current pad projection
  removes acknowledged failures instead. This also fails in isolation.

The first full run additionally reported an unhandled fixture rejection in
`overhaulAgentRunVisibilityAcceptance.test.tsx`: its transport does not handle
`WorkItemEndedRuns` and falls through to a handler requiring `rootId`.

No packaged desktop validation was performed. Other sessions changed and
committed files during this work; unrelated changes were preserved.
