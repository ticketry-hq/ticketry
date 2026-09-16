# Move work-item search UI into its feature

Priority: P2. Status: Implemented.

Move WorkItemSearchList into features/work-items. Move its shared popover
primitives into shared/ui and update existing callers without wrappers or
duplicate implementations.

Acceptance: parent and blocker pickers retain search and selection behavior.
Run typecheck, architecture lint, and the overhaul acceptance gate.

Validation: moved the component and its tests into features/work-items, and
the popover primitives into shared/ui. Picker tests, acceptance case 34,
typecheck, and architecture lint pass. See [validation](REVIEW-IMPLEMENTATION.md).
