# Retain description drafts across failed navigation saves

Priority: P1. Status: Implemented.

Keep pending and failed description drafts by Story identity in Apollo. A
failed save after switching Stories must leave the text available for retry
when returning. Successful saves and explicit Cancel clear the retained draft;
an older save must not clear newer edits.

Acceptance: reject a save while switching Stories, return, and retry the
original draft. Cover a pending save that fails after returning, and run the
description acceptance cases and full overhaul gate.

Validation: acceptance case 284 covers both rejection timings. The autosave,
external-change, and pending-save tests pass. See [validation](REVIEW-IMPLEMENTATION.md)
for the full gate's remaining failures.
