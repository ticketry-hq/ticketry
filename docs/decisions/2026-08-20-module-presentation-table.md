# Module presentation table holds module order and tab visibility

Date: 2026-08-20
Status: accepted
Ticket: CODING-914

## Context

CODING-914 introduces hidden module tabs: a module's tab can be removed from
the module tab strip without deleting or archiving the module. That requires
persisting, per installation, which module tabs are visible.

Three storage candidates were weighed:

1. **Per-profile records**, modeled on the old profile-to-module folder
   links. Invalid: the 2026-08-19 decision (#803) removed profiles entirely.
2. **An open-ended JSON key in the scoped settings store** (the keybindings
   pattern). Rejected: the #803 decision deliberately reserves that store's
   open-ended JSON for keybindings, and a growing untyped blob of module ids
   is invisible to the schema and the generated SDK.
3. **A dedicated typed table** for module presentation state.

Separately, canonical module order data was stored on the project record and
written through the generic work-item reorder path — presentation state
living inside planning data.

## Decision

Create a dedicated module presentation table, one row per module of the
installation project, holding that module's rank in the canonical module
order and its tab-visibility flag. It is the single home of module
presentation state for every module surface.

Module order **data** moves into this table; the shared ranking **code**
(frontend drag/plan logic and backend rank computation) is reused unchanged.
A migration seeds rows from the previously stored manual order; recency-mode
installations have no rank rows until their first manual drag, preserving
the recency-until-first-drag semantics exactly.

## Consequences

- Module presentation state is typed, schema-visible, and covered by the
  generated SDK, instead of being spread across the project record, a
  generic reorder path, and (hypothetically) a JSON settings blob.
- The #803 stance that "the backend never carries navigation state again" is
  narrowed, not reversed: tab visibility and module order are treated as
  installation-wide presentation configuration, not per-client navigation
  state. Per-client state (selection, expansion, sidebar visibility) stays
  in frontend persistence.
- Observable ordering behavior is unchanged; the existing canonical-order
  acceptance suite must keep passing with only its write path retargeted.
- Any future per-surface or per-user ordering would require revisiting this
  table's shape; that is deliberate friction.
