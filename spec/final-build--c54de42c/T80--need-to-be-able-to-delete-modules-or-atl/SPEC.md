# T80 — Archive a module and its work-item subtree

Status: Ready for agent
Story: WorkTracker #80 (`3cb6071c-83b8-4b63-8463-e4c846deef46`)
Date: 2026-08-01
ADR: [`backend/worktracker/docs/adr/0004-archiving-is-a-flag-not-a-workflow-state.md`](../../../backend/worktracker/docs/adr/0004-archiving-is-a-flag-not-a-workflow-state.md)
Dependency: WorkTracker #96, Right-click context menu primitive for Studio

## Problem Statement

Modules can be created and selected in Studio, but they cannot be removed from
the active planning surface. A module that is obsolete, created by mistake, or
no longer relevant therefore remains in both module selectors indefinitely.
Permanently deleting it would be unsafe because the module owns a complete
parent-child subtree of work items, attachments, dependency relationships, and
agent history.

Users need one deliberate action that removes a module and all of its work from
active planning and execution without destroying that history. The action must
not silently interrupt live agent work, must behave consistently from either
module selector, and must preserve the distinction between a work-item archive
and workflow cancellation.

## Solution

Studio adds an **Archive** item to the custom right-click menu for every module
row in both the Modules pane and the Module tab strip. Choosing it opens a
destructive confirmation that names the module and explains that every work item
under it will also be archived. Cancelling makes no change.

After confirmation, Studio calls one explicit module-archive operation. The
backend resolves the module's complete descendant tree through the existing
parent relationship and, in one transaction, sets the existing one-way
`is_archived` flag on the module and every descendant. It does not delete rows,
move tasks between workflow states, or rewrite relationships. Archived records
remain available to explicit archived-item reads, while the existing default
module, planning, and execution queries omit them.

The operation is refused before any archive write when the module or any work
item in its subtree has live agent work, including module-scoped Scratch work.
Studio reports that conflict and leaves its current module and workspace intact.
On success it refreshes the shared module view; if the archived module was
selected, Studio moves to the next available module in the current ordering,
falling back to the previous module and then the existing no-module empty state.

## User Stories

1. As a Studio user, I want to archive an obsolete module, so that it no longer clutters active planning.
2. As a Studio user, I want archiving instead of permanent deletion, so that historical work is not destroyed.
3. As a Studio user, I want Archive in a module row's right-click menu, so that the action is available where I manage modules.
4. As a Studio user, I want the same Archive action in the Modules pane and Module tab strip, so that the two selectors behave consistently.
5. As a keyboard user, I want the Archive item available through the custom menu's keyboard invocation, so that a pointer is not required.
6. As an assistive-technology user, I want the menu item and confirmation to name Archive and the affected module clearly, so that the action and target are unambiguous.
7. As a Studio user, I want opening a module's context menu not to select or activate that module, so that I can archive a non-selected module without changing workspace context.
8. As a Studio user, I want a confirmation before archival, so that an accidental context-menu activation makes no change.
9. As a Studio user, I want the confirmation to name the module, so that I can verify the target before proceeding.
10. As a Studio user, I want the confirmation to warn that every descendant work item is included, so that the scope is explicit.
11. As a Studio user, I want cancelling the confirmation to issue no archive request, so that cancellation is side-effect free.
12. As a Studio user, I want one confirmation to archive the complete subtree, so that I do not have to archive every Story and subtask manually.
13. As a Studio user, I want deeply nested descendants archived as well as direct children, so that no hidden part of the module remains active.
14. As a Studio user, I want archived tasks to keep their existing workflow states, so that archival does not misrepresent them as cancelled, done, or abandoned.
15. As a Studio user, I want an archived module to disappear from the Modules pane, so that only active modules are listed there.
16. As a Studio user, I want an archived module to disappear from the Module tab strip, so that both selectors continue to show the same active set.
17. As a Studio user, I want every archived descendant to disappear from Stories, backlog, board, and execution selection, so that archived work cannot be planned or launched accidentally.
18. As a Studio user, I want an archived module's records and attachments retained, so that archive is not data loss.
19. As a Studio user, I want dependency relationships and agent-run history retained, so that the historical subtree remains faithful.
20. As a Studio user, I want archival refused while any descendant has live agent work, so that active work is never hidden out from under an agent.
21. As a Studio user, I want archival refused while the module has a live Scratch run, so that module-scoped work receives the same protection as task-scoped work.
22. As a Studio user, I want the conflict to explain that live agent work must end first, so that I know how to make the action safe.
23. As a Studio user, I want a rejected archive to leave the module, selection, and workspace unchanged, so that a safety check cannot partially alter the UI.
24. As a Studio user, I want completed or otherwise ended agent runs not to block archival, so that retained history is not mistaken for live work.
25. As a Studio user archiving a non-selected module, I want my selected module and workspace to remain unchanged, so that cleanup does not interrupt unrelated work.
26. As a Studio user archiving the selected module, I want Studio to select the nearest remaining module in the visible order, so that I remain in a useful planning context.
27. As a Studio user archiving the only module, I want Studio to show its existing no-module state, so that stale Stories or workspace content cannot remain visible.
28. As a Studio user, I want an archive retry to be safe, so that a repeated request cannot corrupt or duplicate the operation.
29. As a user with another Studio client open, I want archived work to disappear when authoritative archive changes are reconciled, so that active views converge on backend state.
30. As an API consumer, I want archived modules and work items excluded by default but available through explicit archived-item reads, so that active and historical queries remain distinct.
31. As a maintainer, I want module archival to use the established Work-item archive vocabulary and flag, so that a new deletion or workflow-state concept is not introduced.
32. As a maintainer, I want one backend transaction to own validation and the subtree write, so that every client receives the same all-or-nothing behavior.
33. As a maintainer, I want the generated SDK to expose the archive operation, so that Studio does not add a hand-written HTTP path around the owned contract.

## Implementation Decisions

### Archive semantics

- This feature is a **Work-item archive**, not delete, cancel, done, soft delete,
  or an archived workflow state. The existing `is_archived` boolean is the sole
  persistence representation, as recorded by the archive ADR and glossary.
- Archival is one-way in this release. It archives the target module and every
  task descendant, including grandchildren and deeper descendants reached
  through the existing parent relationship.
- Archiving does not change workflow state, lifecycle state, type, parent,
  rank, dependencies, labels, assignees, descriptions, attachments, worktrees,
  design documents, terminal records, or agent-run history.
- Repeating the operation against an already archived module succeeds without
  additional side effects. This makes client retries safe.
- Permanent module deletion is not added. The existing empty-work-item delete
  rule remains unchanged and is not reused for this subtree operation.

### Backend operation and safety gate

- The owned WorkTracker API gains one explicit module archive operation under
  the Modules contract. It accepts a module identity and returns the
  authoritative archived module representation after success.
- The route delegates to one framework-neutral service. The service validates
  that the target exists and is a module, discovers the complete descendant
  subtree, performs the live-work check, and writes the archive flags inside one
  database transaction.
- The service locks or otherwise stabilizes the target subtree for the duration
  of the validation and write so a concurrent child creation cannot escape the
  cascade. The operation either archives the complete resolved subtree or
  archives nothing.
- The authoritative safety check uses durable agent-run state, not the Studio
  status cache. A run is live until it has an authoritative end marker. For a
  module archive, both task-bound runs anywhere in the descendant subtree and
  module-scoped Scratch runs count.
- If live work exists, the API returns a conflict with an actionable message
  telling the caller that live agent work must end before archival. It does not
  terminate runs and does not write any archive flag.
- Every affected record receives the normal work-item change revision and
  change notification required for other clients to reconcile the archive.
  Revision allocation and notification happen as part of the committed archive
  operation; bulk updates that bypass that contract are not used.
- Existing list and execution queries continue to exclude archived records by
  default. Explicit `include_archived` reads continue to expose the preserved
  records for diagnostics and the future archived-items surface.
- The OpenAPI description and generated TypeScript and Python SDKs are updated
  from the owned contract. Studio consumes the generated archive method.

### Studio interaction

- WorkTracker #96 supplies the shared custom context-menu component, registry,
  keyboard behavior, focus management, dismissal, and native-webview menu
  suppression. This Story registers one module-specific Archive item; it does
  not build a second menu primitive.
- Both the Modules pane row and the Module tab use the same registered action and
  archive handler. Right-clicking or keyboard-opening the menu preserves the
  current module selection until an explicit menu item is activated.
- Archive is visually presented as a destructive menu item. Selecting it opens
  the existing application confirmation surface rather than a browser-native
  confirm dialog.
- The confirmation heading and body include the module name and state plainly
  that all work items under it will be archived. The confirm action is labelled
  **Archive**; dismissal performs no request.
- Studio keeps the confirmation open or marks the action busy while the request
  is in flight so repeated activation cannot submit concurrent archives.
- On conflict, Studio shows the backend's actionable live-work message and does
  not remove the module or change selection. Other request failures are also
  reported without optimistic removal.
- On success, the shared module store removes or reloads the archived module so
  the Modules pane and Module tab strip update together. Any project-level
  module view that is already loaded is reconciled from the same result.
- Archiving a non-selected module preserves the current module, selected work
  item, and workspace. Archiving the selected module selects the next remaining
  module in the current visible order; if none follows, it selects the previous
  one. If no modules remain, it clears module/task/workspace selection and shows
  the existing empty state.
- Selection persistence is updated to the resulting active module, so a restart
  does not attempt to restore the archived module. Module-folder configuration,
  terminal history, and other retained archive data are not deleted.

### Domain and architecture alignment

- The Work-item archive glossary entry is normative for naming and semantics.
- The archive ADR is normative for the direct boolean write, stateless modules,
  one-way behavior, and the rejection of a module workflow.
- No new schema field or workflow state is introduced. The existing flag and
  issue tree remain the source of truth.
- The Tauri/webview boundary stays narrow: native code participates only through
  the context-menu behavior owned by dependency #96. Archive policy, tree
  traversal, and live-work validation remain in the owned backend.

## Testing Decisions

A good test asserts externally observable archive behavior at the highest
existing seam: the API result and subsequent reads for backend policy, and the
rendered menus, confirmation, selection, and error feedback for Studio. Tests do
not assert private traversal helpers, store fields, SQL call counts, CSS class
names, or the context-menu primitive's internal focus algorithm.

No new test seam is required. Two existing seams cover the feature without
duplicating lower-level implementation tests.

### Owned WorkTracker HTTP seam

- Extend the existing mutation and archived-filtering integration coverage by
  creating a module with direct children, nested descendants, relationships,
  attachments, and ended run history; archive it through the public operation;
  then assert the module and every descendant are omitted from default reads and
  present in explicit archived reads.
- Assert the module and every descendant have `is_archived=true` while workflow
  states and retained records remain unchanged.
- Assert a live task-bound run at any descendant depth rejects the operation
  with a conflict and leaves every archive flag false.
- Assert a live module-scoped Scratch run produces the same all-or-nothing
  rejection, while ended task and Scratch runs do not block archival.
- Assert concurrent or repeated requests cannot produce a partial subtree and
  that retrying an already completed archive is successful and inert.
- Assert a missing target and a task passed to the module operation receive the
  existing not-found or validation contract.
- Assert each changed record receives a newer work-item change revision and is
  available to change-feed replay only after the transaction commits.
- Prior art is the existing WorkTracker mutation, archive-filtering,
  work-item-revision, status-stream, and generated-SDK integration coverage.

### Rendered Studio seam

- Extend the existing module-pane and module-tab integration tests using the
  real shared store with the WorkTracker SDK boundary stubbed.
- Assert each module presentation exposes one Archive item through the shared
  context menu, and that opening the menu for a non-selected module does not
  select it. Generic pointer, Shift+F10/Menu-key, focus, and dismissal behavior
  remains dependency #96's responsibility.
- Assert choosing Archive opens a confirmation naming the correct module and
  descendant scope; cancelling makes no request; confirming submits exactly one
  generated-SDK archive operation.
- Assert a successful archive removes the module from both selectors. A
  non-selected archive preserves current workspace state; a selected archive
  chooses next, then previous, then the no-module state according to the
  remaining list.
- Assert a live-work conflict and a generic server failure leave both selectors,
  selection, and workspace unchanged while presenting the returned error.
- Assert the confirmed action cannot be submitted twice while its request is in
  flight.
- Prior art is the existing module-tab, task-tree hydration, shared dialog,
  module-store, and API error-feedback coverage, plus the context-menu tests
  introduced by dependency #96.

### Contract verification

- Regenerate both owned SDKs and run the existing contract-drift checks so the
  archive operation, response, and conflict behavior stay aligned across the
  backend, Studio, and MCP-supporting surfaces.

## Out of Scope

- Permanently deleting a module or any non-empty work-item subtree.
- Restoring or unarchiving a module or descendant.
- An archived-items browser, archive history, retention policy, purge flow, or
  record of whether cancellation or direct archival set the flag.
- Archiving an individual Story or subtask from its own context menu.
- Moving archived work to Cancelled, Done, or any other workflow state.
- Terminating, cancelling, or waiting for live agent runs on the user's behalf.
- Deleting module folders, worktrees, attachments, design documents, terminal
  records, dependency relationships, or agent-run history.
- Adding another context-menu implementation or changing the generic behavior
  delivered by WorkTracker #96.
- Adding an Archive button outside the two module-row context menus.
- Creating implementation tickets during this specification stage.

## Further Notes

- WorkTracker #96 is a functional dependency because the agreed UI has only the
  custom right-click menu as its entry point. The backend archive contract may
  be implemented independently, but the complete user-facing Story cannot ship
  before that dependency.
- The current default module and work-item list operations already hide archived
  rows, and explicit archived reads already exist. Implementation should reuse
  those semantics rather than introduce another visibility mechanism.
- The current cancellation path already demonstrates descendant archival, but
  direct module archival additionally owns the root flag, the live-agent safety
  gate, transaction-wide change revisions, and module-selection reconciliation.
