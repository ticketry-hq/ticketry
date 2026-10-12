# CODING-2727: Generated GraphQL contracts in frontend features

Story: Use generated GraphQL contracts directly in frontend features.
Work item: `e93075a1-a4fc-4e31-86a6-ad813511dcfe`. Specification date: 2026-10-11.

This page condenses the Story's approved Spec so the
[capability guide](../feature-map/how-to-add-a-capability.md) can link the
decisions and the current fallback. The WorkTracker Story holds the full user
stories and the implementation evidence. Until that Story's changes land on
your branch, this path is **Proposed**: follow the
[current pattern](#current-pattern-until-delivery).

## Problem Statement

Changing a server field on a project, module, state, issue type, launch binding
or work item takes three edits: the caller's GraphQL selection (then
regeneration), a handwritten interface in
[`shared/api/types.ts`](../../studio/src/shared/api/types.ts) that mirrors the
generated type, and a mechanical adapter such as
[`issueAdapter.ts`](../../studio/src/features/work-items/issueAdapter.ts) that
copies, renames and converts the field. Missing either extra edit fails
silently: the work-item adapter already drops `module_id`, `sprint_id`,
`state_revision` and `workspace_tab_order`. Write transports repeat a per-field
compact-ID conversion, so one forgotten call sends a hyphenated ID to the
server.

## Solution

Generated GraphQL types become the only type authority for adopted server
records and caller-write inputs.

- Feature code receives generated fragment and result types directly.
- One shared conversion seam makes identifiers hyphenated and timestamps
  normalized, once per operation result on reads and once per operation's
  variables on writes. It replaces per-field conversion in transports.
- Genuinely computed values (ticket keys, open-child counts, has-children,
  blocker lists, rank ordering) come from named selectors in the owning
  feature. A record that needs them is a small documented domain view: the
  generated row spread together with the computed fields, so a newly selected
  field reaches consumers without another edit.
- Rendered behavior, GraphQL selections, nullability, Apollo cache identity,
  persisted identities and writable-field restrictions stay the same.

## Decisions

- **Identifier form (user decision, 2026-10-10).** Feature interfaces keep
  hyphenated IDs. Conversion to and from the server's compact 32-hex form
  happens only at the shared seam. Routes and persisted workspace/tab state are
  unchanged, and Apollo `keyFields` canonicalization in
  [`cacheKeys.ts`](../../studio/src/shared/apollo/cacheKeys.ts) does not change.
- **Seam shape.** Read conversion walks the typed document's AST, so it follows
  schema field names (`id`, `*Id`, `createdAt`, `updatedAt`) regardless of
  aliases. Write conversion compacts `id`, `*Id` and `*Ids` variables of
  WorkTracker documents only; it is not a global Apollo link. Conversion is
  idempotent and leaves non-UUID values such as `optimistic:` IDs alone.
- **Rejected: Apollo field `read` policies.** Mutation results and `update`
  callback data bypass them, so callers would see mixed ID forms.
- **The cache keeps compact server rows.** Optimistic builders keep emitting
  server-form rows; the seam applies only where data leaves a transport or
  query hook.
- **Write inputs** come from generated operation variables, never entity input
  types, so writable-field restrictions stay as they are.
- **Lint guard.** The frontend architecture lint forbids feature imports of the
  per-field ID helpers outside a shrink-only allowlist.

## Current pattern until delivery

- Write the caller's operation in the feature's `operations/*.graphql`, for
  example [`settings/operations/`](../../studio/src/features/settings/operations),
  and run `npm run graphql:generate --workspace @worktracker/studio`; typed
  documents land in the feature's `generated/` folder, for example
  [`settings/generated/`](../../studio/src/features/settings/generated).
- Where a feature already reads through a mirror, extend the mirror in
  [`shared/api/types.ts`](../../studio/src/shared/api/types.ts) and its adapter,
  such as [`issueAdapter.ts`](../../studio/src/features/work-items/issueAdapter.ts),
  converting identifiers with the helpers in
  [`generatedWorktracker.ts`](../../studio/src/shared/api/generatedWorktracker.ts).
  Do not add a new mirror for a record that has none.
- Cite this Story in the change's reuse record.

## Out of Scope

- Rust, Seaography, SeaORM or GraphQL schema/SDL changes, and any new or
  widened mutation or input.
- Changing selections, aliases or operation names, Apollo cache identity,
  persisted state or route ID formats.
- Migrating mirrors outside projects, work items and workflows; the Story only
  inventories them.
- Any visible UI or behavior change.

## Further Notes

- Prior art: [frontend state and API contract ADR](../decisions/2026-08-04-frontend-state-and-api-contract.md);
  its "one representation per record" rule still applies.
- Codegen lives in
  [`typed-document-generation.mjs`](../../studio/scripts/typed-document-generation.mjs).
