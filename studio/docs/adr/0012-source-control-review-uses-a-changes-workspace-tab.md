---
status: accepted
---

# Source-control review uses a Changes workspace tab

CODING-961 needs enough room for a selectable changed-file list, a legible
diff, and the stacked Git action while keeping the selected task and its agent
sessions visible. The user selected a pinned Changes tab in the task workspace
because it treats review as first-class task work and fits Studio's existing
Details, document, and terminal tab model. The selected Superdesign draft is
[CODING-961 Changes Review](https://p.superdesign.dev/draft/1001ac9a-4932-4407-8fdb-95e14dfa0ef6).

## Considered options

A module-scoped bottom Git panel made task worktrees and the module base
checkout equally visible, but it competed with the terminal panel for the same
space and added another persistent panel model. A compact Worktree section in
Details with a review drawer kept the entry close to task metadata, but the
drawer obscured the task workspace and depended on a `WorktreeBlock` that
production Studio does not currently mount. Both remain on the comparison
[canvas](https://superdesign.dev/teams/2715311f-8716-4635-a303-2b7d962e203d/projects/8aaf3a2a-b426-4ed0-afc8-9a72058760ed)
as rejected alternatives, not later screens in the chosen flow.

## Consequences

The Changes tab owns the review state and the entry into `Commit only`,
`Commit & push`, and `Commit, push & create PR`. The implementation must also
add confirmation, ordered progress, success, and focused failure states; the
selected mockup does not cover them. The module base checkout must reuse this
review experience; [ADR 0013](0013-the-module-base-checkout-opens-in-the-modules-own-workspace.md)
records how a module-scoped checkout opens it.

CODING-961 also includes the selected draft's Modules pane treatment. It
replaces the package emoji with a monochrome Studio icon, strengthens the
active-row highlight, and separates `+ Add Module` from the list with a
divider. This is presentation only. Existing selection, focus, reorder,
lifecycle-count, and onboarding behavior stays intact.
