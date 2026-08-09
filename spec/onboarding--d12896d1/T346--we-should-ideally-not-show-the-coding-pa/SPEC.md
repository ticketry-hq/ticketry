# T-346 — Display ticket identifiers as `T-<number>`

Status: Spec complete
Story: WorkTracker #346 (`bdabb57a-55e1-4656-9ed5-c02a00f6e592`)
Date: 2026-08-09

## Problem Statement

Ticketry currently exposes canonical project-qualified work-item keys such as
`CODING-346` throughout Studio. The project prefix makes common ticket labels
longer and noisier than necessary when users are already working inside a
selected project and module. It also makes the same kind of identifier vary in
width from project to project.

Users want compact, consistent ticket identifiers such as `T-346` everywhere
Studio presents a work item as a ticket. This visual change must not alter the
canonical key that WorkTracker uses to address the work item. Existing API
lookups, routes and deep links, canonical-key search, integrations, branch or
worktree naming, and other machine-facing contracts must continue to use values
such as `CODING-346`.

## Solution

Studio presents a work item's display identifier as `T-` followed by its
sequence number. The same UI-only formatter is used everywhere a ticket
identifier is visible, including Story-tree rows, the Task workspace's related
work-item labels and confirmation copy, and task-bound terminal tab and close
labels. Modules use the same display form when shown as work-item parents,
because a Module is also a work item in the Ticketry domain.

The display identifier is derived directly from `sequence_id`; it is never made
by trimming or parsing the canonical key. WorkTracker continues to own and
return the canonical `key`, and Studio continues to retain that field for every
machine-facing behavior and for backwards-compatible search. Scratch workspaces
and unresolved references that do not have a sequence number do not invent a
ticket identifier.

## User Stories

1. As a Ticketry user, I want Story rows to show identifiers such as `T-346`, so that I can scan the Stories pane without a repeated project prefix.
2. As a Ticketry user, I want every Story identifier to use the same `T-<number>` shape, so that identifiers remain visually consistent across projects.
3. As a Ticketry user, I want Implementation and other child work-item rows to use the same display identifier, so that hierarchy does not change the identification convention.
4. As a Ticketry user, I want the trailing identifier on a work-item row to remain visible and non-shrinking, so that compact identifiers do not regress the established row layout.
5. As a Ticketry user, I want a work-item row's identifier to retain its workflow-state color, so that the existing state cue is preserved.
6. As a Ticketry user, I want child-issue lists to show `T-<number>`, so that related work uses the same identifier as the Stories pane.
7. As a reviewer, I want finding rows to show `T-<number>`, so that review findings follow the same ticket convention as their parent Story.
8. As a keyboard or assistive-technology user, I want finding actions to name the same displayed identifier, so that visible and accessible labels do not disagree.
9. As a Ticketry user, I want blocked-by and blocks chips to show `T-<number>`, so that dependency relationships are compact and consistent.
10. As a Ticketry user adding a blocker, I want blocker-picker options to show `T-<number>`, so that candidate labels match the chips created from them.
11. As a Ticketry user viewing a parent, I want the selected parent label to show `T-<number>`, so that the closed picker matches its options.
12. As a Ticketry user choosing a parent, I want both Module and task candidates to show `T-<number>`, so that every work-item parent uses one convention.
13. As a Ticketry user viewing a Story's Module field, I want the Module link to show `T-<number>`, so that the same Module is named consistently across the Task workspace.
14. As a Ticketry user deleting a work item, I want the confirmation message to name it as `T-<number>`, so that destructive copy agrees with the identifier I selected.
15. As a Ticketry user with several task-bound terminals, I want each tab label to include `T-<number>`, so that I can associate the terminal with its ticket quickly.
16. As a Ticketry user closing a terminal, I want its close affordance to name the same `T-<number>` identifier, so that I can confirm the correct tab through its accessible label.
17. As a Ticketry user returning after Studio restores a task workspace, I want restored task-bound terminal tabs to retain the compact identifier, so that restoration does not change how the ticket is named.
18. As a Ticketry user using a scratch workspace, I want scratch and taskless terminal labels to remain free of invented ticket identifiers, so that `T-<number>` always refers to a real work item.
19. As a Ticketry user searching by a canonical key such as `CODING-346`, I want the existing search to keep finding the work item, so that copied links, commit messages, and historical references remain useful.
20. As a Ticketry user searching by a bare sequence number or title, I want those existing searches to keep working, so that the display-only change removes no search behavior.
21. As an API or MCP consumer, I want `key` to remain `CODING-346`, so that lookups and automation contracts do not change.
22. As a user following a route or deep link, I want the canonical project-qualified key to remain in the addressable contract, so that existing links do not break.
23. As a developer using branch, worktree, or other generated machine identifiers, I want those identifiers to retain the canonical key, so that presentation does not rename durable resources.
24. As a maintainer, I want one display formatter owned by the work-items feature, so that new Studio surfaces do not implement project-prefix stripping independently.
25. As a maintainer, I want the display formatter to derive from `sequence_id`, so that it does not depend on the spelling or length of a project key.
26. As a maintainer, I want all affected user-visible and accessible labels covered by acceptance tests, so that canonical keys cannot gradually leak back into Studio presentation.

## Implementation Decisions

* Introduce one pure, UI-only work-item display-identifier formatter in the
  work-items feature. Given a present sequence identifier, its exact output is
  `T-${sequence_id}`.
* Derive the display identifier from `sequence_id`, never by splitting,
  replacing, or otherwise parsing `key`. Project keys can vary in spelling and
  length, while the display contract is intentionally project-independent.
* Keep `key` in the WorkTracker and Studio work-item models unchanged. Do not
  overwrite it with the display identifier and do not change API payloads,
  persistence, generated SDKs, MCP arguments, route construction, or deep-link
  construction.
* Keep canonical-key, bare-sequence, and title search behavior unchanged. A
  canonical key remains a supported search input even though results render
  their compact display identifiers. Expanding search syntax to accept the
  `T-<number>` form is not required by this presentation-only Story.
* Reuse the formatter in the shared work-item planning row, so Story and
  Implementation rows receive the same identifier without per-row logic.
  Preserve the current trailing-edge placement, non-shrinking behavior,
  workflow-state color, indentation, selection, expansion, and drag behavior.
* Reuse the formatter across Task workspace related-work presentation: child
  issues, review findings, blocker and dependent chips, blocker-picker options,
  the parent-picker trigger and its Module/task options, and the Module link.
* A blocker/dependent presentation projection must carry the referenced work
  item's sequence identifier in addition to its existing fields. It must not
  recover the number by parsing the canonical key.
* Use the display identifier in user-visible and accessibility copy derived
  from those surfaces, including finding cancellation labels and the permanent
  deletion confirmation.
* Task-bound terminal tab labels use `T-<number> · <agent>`. Their close labels
  use that same composed label. The display number comes from task/session
  sequence context, while terminal persistence and run ownership continue to
  use opaque canonical IDs.
* Preserve the existing labels for module scratch workspaces, taskless runs,
  and any terminal without a work-item sequence identifier.
* Never render malformed values such as `T-null` or `T-undefined`. A synthetic
  or unresolved presentation with no sequence identifier keeps its existing
  neutral fallback or remains identifier-free, as appropriate to that surface.
* Treat Modules as work items for this display contract. A Module's canonical
  key remains unchanged, but Module labels shown in work-item parent/details
  contexts use its `sequence_id` and therefore the same `T-<number>` form.
* Do not repurpose the Studio deep-link sequence formatter as the display
  formatter. Deep links and human-facing identifiers have different contracts
  and remain separate single-purpose modules.
* No backend, database, schema, migration, generated-client, or Tauri/webview
  boundary change is required.
* No new ADR is required. This is a reversible presentation convention and does
  not change domain ownership, persistence, or a cross-boundary contract. The
  existing glossary terms **Work item**, **Stories pane**, **Task workspace**,
  and **Module task tree** remain authoritative.

## Testing Decisions

A good test observes the words and accessible names a user receives while
interacting with Studio. It does not assert that a particular helper was called,
inspect component-local state, or test prefix-stripping implementation details.
The highest existing seam is the mounted Studio acceptance harness, backed by
real feature components and controllable WorkTracker fixtures.

* Update the numbered work-item-row acceptance case to expect `T-<number>` for
  both a Story and its Implementation child while preserving title-first order,
  trailing placement, state color, truncation, indentation, selection, and the
  identifier-free scratch row.
* Add the next numbered Studio acceptance case for the cross-surface display
  contract. From one mounted Task workspace, exercise representative child,
  finding, blocker, parent, Module, deletion-confirmation, and task-terminal
  surfaces and assert that visible and accessible labels use `T-<number>` and
  do not expose the fixture's project-qualified canonical key.
* At that same acceptance seam, search using the canonical key and assert that
  the matching row is still found but rendered with its display identifier.
  Retain the existing bare-number and title-search assertions as regression
  coverage.
* Extend existing terminal-tab acceptance coverage to assert
  `T-<number> · <agent>` for task-bound live and restored sessions, the matching
  close accessible name, and unchanged labels for scratch/taskless sessions.
* Preserve existing deep-link tests with canonical project-qualified keys.
  Their unchanged expectations prove that the presentation formatter did not
  leak into routing.
* Do not add a formatter-only unit test merely to assert delegation. Exact
  output and missing-sequence behavior are observable through the acceptance
  cases above; test the contract from those higher seams.
* Extend the numbered overhaul matrix and its gate count for the new acceptance
  case, then run `npm run test:overhaul --workspace @worktracker/studio` before
  implementation handoff. Run the affected Studio tests and typecheck as
  proportional regression checks.

## Out of Scope

* Creating implementation tickets, child work items, or a dependency graph in
  the Spec stage.
* Changing WorkTracker's canonical `key`, project key, or sequence allocation.
* Migrating stored data or rewriting existing work-item references.
* Changing API, MCP, generated SDK, route, deep-link, branch, worktree, commit,
  or other machine-facing identifier contracts.
* Removing canonical-key, bare-number, or title search compatibility.
* Adding `T-<number>` as a new search syntax in this presentation-only Story.
* Renaming project keys or changing project-creation validation.
* Redesigning the Stories pane, Task workspace, picker layout, terminal tabs,
  workflow-state colors, or destructive confirmation flow beyond replacing the
  displayed identifier.
* Giving scratch workspaces or taskless runs synthetic ticket numbers.
* Adding a new ADR or changing backend/work-management glossary semantics.

## Further Notes

* This Story intentionally supersedes the earlier presentation choice to show
  full project-qualified keys in Studio. The canonical key remains valuable and
  continues to exist; only its use as the default human-facing ticket label is
  replaced.
* The distinction to preserve during implementation is **display identifier**
  versus canonical `key`: the former is `T-<sequence_id>` and belongs to Studio
  presentation, while the latter remains WorkTracker's stable addressable
  identifier.
