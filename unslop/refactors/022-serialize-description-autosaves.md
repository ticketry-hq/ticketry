# Serialize description autosaves

Priority: P2. Status: Done (CODING-1549). Covered by `[overhaul-286]` and the CODING-1549 cases in `overhaulDescriptionAutosaveAcceptance.test.tsx`; the per-Story request queue in `descriptionDrafts.ts` is shared with 019.

## Finding

In `studio/src/features/documents/DescriptionEditor.tsx`, `write()` advances
`initial.current` before awaiting `onSave`, but does not serialize requests.
Blur draft A, resume editing, then blur draft B while A is pending. Both
requests can run concurrently, allowing A to persist after B. If A fails after
B succeeds, its catch resets the shared baseline to the value before A.

## Implementation

Serialize description writes per Story and retain the newest pending draft.
Route Save, blur, and unmount through the same ordering mechanism. An older
completion or failure must not replace the baseline, clear newer edits, or
report a newer successful draft as failed. Preserve retry and explicit Cancel
behavior. Keep retained application state in Apollo.

Coordinate with [019: Retain failed description drafts](019-retain-failed-description-drafts.md)
so both tasks use the same save path and draft ownership.

## Acceptance

- Hold save A, edit and blur B, then resolve A. Verify B persists last and
  requests for the same Story never overlap.
- Reject A while B is pending. Verify B remains available and can be saved;
  the older failure cannot reset its baseline or discard it.
- Switch Stories while A is pending and B is dirty. Verify writes retain the
  original Story identity and the newest draft survives until saved or canceled.
- Preserve duplicate-boundary suppression and retry after a failed write.

Add cases to `studio/src/test/overhaulDescriptionAutosaveAcceptance.test.tsx`
and keep the numbered overhaul gate current. Run the description acceptance
cases, TypeScript checking, and
`npm run test:overhaul --workspace @worktracker/studio`.
