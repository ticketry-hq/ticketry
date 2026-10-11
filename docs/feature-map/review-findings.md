# Review findings

A Story in Review shows its direct Implementation children as findings, including queued counts, parsed source locations, states and cancellation.

Surfaces: browser, desktop

## Sub-features

- `review-findings-panel`: Review-scoped Story panel selects direct Implementation children.
- `review-findings-queued-count`: Count Implementation children still in the Implement state.
- `review-findings-location`: Read a compact path and line range from the finding's canonical description.
- `review-findings-state`: Display each finding's workflow state and open its ticket details.
- `review-findings-cancel`: Move unresolved findings to the project's cancelled-group state.

## How to get to it

Select a module, select a Story in **Review**, then open its [Details tab](ticket-details.md). Scroll to **Review findings** (`findings-panel`); each `finding-row` has an open button containing its `T-<number>` and name. Click it to select the child ticket. Read `finding-state`, `finding-location` and `findings-queued-count`; click **Cancel T-<number>** (`finding-cancel`) to cancel. For a finding without a display identifier, its accessible cancel name is **Cancel finding**. There is no dedicated findings keymap action or chord: reach the parent through Stories (`tasks.next` / `tasks.previous`: ArrowDown / ArrowUp; `tasks.activate`: Enter), then use the panel's buttons. Findings creation enters through agent review tooling, not an add button on this panel.

## Prerequisites

Use a project with catalog types named **Story** and **Implementation**, states named **Review** and **Implement**, and a state in the `cancelled` group. The selected parent must be a Story in Review with direct Implementation children; use an unresolved child for Cancel. Configure a permitted cancellation transition, because the server's workflow guards still apply. A location needs a description containing separate `Path: <repository-relative path>` and `Lines: <start>-<end>` lines. Use disposable profiles; do not create review findings against live work just to populate the panel.

## Expected behavior

- The panel is hidden for other parent types/states and for zero matching children. It lists all direct Implementation children in API order, including resolved ones. Its children come from the parent-scoped `WorkTrackerReviewFindings` read (`useReviewFindingChildren`), not the Stories tree: the server archives a work item entering a cancelled-group state, and module membership omits archived rows, so a cancelled finding stays listed only through that read. The status-feed invalidator and reset refresh re-read displayed finding lists whenever task membership converges; there is no additional marker proving a child was filed by a review agent. Queued means matching type and state identity resolved from **Implement**; it is not a live agent-run count. Text pluralizes **1 fix queued** / **0 fixes queued**. Source: `studio/src/app/shell/ticket-workspace/selected-ticket/details/internal/findings.ts` and `studio/src/app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx`.
- Rows use the shared `T-<number>` identifier, name and catalog state label/color; a missing state renders **No state**. Clicking the open button selects that child through normal ticket selection. Its location is fetched from the child's description and formats `path:start-end`; absent/malformed blocks omit the label. Canonical description refresh repaints the location. Source: `studio/src/features/work-items/FindingLocationLabel.tsx`, `studio/src/features/work-items/findingLocation.ts` and the panel.
- Cancel appears only while the child's state is outside the completed/cancelled groups. It immediately requests a state update to the first configured cancelled-group state; there is no confirmation dialog. The child remains a finding, its state changes and the queued count decreases if it was queued; the Cancel control disappears once resolved. Missing configuration reports **No Cancelled state is configured for this project.** Server refusal reports the mutation error and reconciles state through the existing WorkItem update seam. Source: `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx`, `studio/src/features/work-items/mutations.ts` and `studio/src/shared/utilities/display.ts`.
- To verify persistence, read back the child by identity through authoritative GraphQL, checking parent/type/state and description, then reload, reselect the parent and compare panel/count/location. After cancellation, read the cancelled state back and reload again; selection of the child must show the same description without changing another Story. Existing browser code tests finding creation surviving reload and visible cancellation, but does not establish the post-cancel readback/reload round trip.

## Verifying it

No live walkthrough was performed for this map. Stable selectors are `findings-panel`, `findings-list`, `finding-row`, `findings-queued-count`, `finding-location`, `finding-state` and `finding-cancel`; scope buttons to a finding row to avoid unrelated Cancel controls. Existing coverage:

| Coverage | Existing cases | Narrow command |
| --- | --- | --- |
| Cancelled finding stays visible; streamed finding appears | `studio/src/test/overhaulReviewFindingCancelAcceptance.test.tsx`: cancels a queued finding (the fake server archives it) and, after authoritative module refresh, still shows **Cancelled**, **0 fixes queued** and no Cancel control; a membership fact for a newly filed child brings the panel in. | `bun run --cwd studio test src/test/overhaulReviewFindingCancelAcceptance.test.tsx` |
| Identifier, accessible cancel label and location refresh | `studio/src/test/overhaulTaskWorkspaceIdentifierAcceptance.test.tsx`: `overhaul-34` checks **T-402**, **Cancel T-402** and a network-only mocked WorkItem description refresh changing the location. It does not click Cancel. | `bun run --cwd studio test src/test/overhaulTaskWorkspaceIdentifierAcceptance.test.tsx` |
| Historical browser create/subscription, queued count, location, reload, child open and cancel | `studio/e2e/web-app.spec.ts`: **streams an MCP review finding into the visible Story**. It creates through socket MCP, checks **1 fix queued**, reloads to **Implement**, opens the child and cancels to **0 fixes queued** with no Cancel control. | `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'streams an MCP review finding into the visible Story'` |
| Historical browser malformed/out-of-phase creation refusal | `studio/e2e/web-app.spec.ts`: **rejects malformed and out-of-phase MCP review findings without creating children**, including no panel and no children after reload. | `bun run --cwd studio test:e2e e2e/web-app.spec.ts --grep 'rejects malformed and out-of-phase MCP review findings'` |

The browser cases' shared module-entry setup is stale; they describe existing assertions, not passing current verification. Dedicated current end-to-end coverage for cancellation refusal/missing cancelled state, a malformed location on an otherwise valid child, post-cancel server-readback/reload and installed-desktop findings is not identified. Those paths are grounded in source where stated, with runtime behavior unverified. The creation-refusal case covers the MCP boundary rather than the panel's Cancel error path.

## End-to-end suite

Suite: studio/e2e/features/review-findings.spec.ts

Browser cases live in `studio/e2e/features/review-findings.spec.ts`. Browser results are not complete while a cited case fails; the coverage table records executable proof obligations, not a passing-run claim.

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| review-findings-panel | @case-review-findings-stream | n/a: panel selection is immediate | @case-review-findings-refusal | @case-review-findings-refusal | @case-review-findings-stream @case-review-findings-location-empty | @case-review-findings-stream |
| review-findings-queued-count | @case-review-findings-stream | n/a: read-only count | @case-review-findings-stream | @case-review-findings-refusal | @case-review-findings-stream | @case-review-findings-stream |
| review-findings-location | @case-review-findings-stream | n/a: read-only label | n/a: parsing a read-only label has no failure operation | @case-review-findings-location-empty | @case-review-findings-stream @case-review-findings-location-empty | @case-review-findings-stream @case-review-findings-location-empty |
| review-findings-state | @case-review-findings-stream @case-review-findings-location-empty | n/a: opening a finding selects it immediately | @case-review-findings-stream | @case-review-findings-refusal | @case-review-findings-stream @case-review-findings-location-empty | @case-review-findings-stream @case-review-findings-location-empty |
| review-findings-cancel | @case-review-findings-stream | n/a: cancellation has no confirmation step | @case-review-findings-stream | @case-review-findings-stream | @case-review-findings-stream | @case-review-findings-stream |

## Relevant code

- `studio/src/app/shell/ticket-workspace/selected-ticket/details/FindingsPanel.tsx` and `studio/src/app/shell/ticket-workspace/selected-ticket/details/internal/findings.ts`: panel selectors, type/state gating, count and resolved predicates.
- `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx`: panel placement and cancellation state write/error handling.
- `studio/src/features/work-items/queries/useReviewFindingChildren.ts`: parent-scoped direct task children, archived included; refreshed by `studio/src/features/agents/status/stream/workItemInvalidation.ts` and `studio/src/features/agents/status/stream/canonicalRefresh.ts`.
- `studio/src/features/work-items/FindingLocationLabel.tsx` and `studio/src/features/work-items/findingLocation.ts`: canonical description subscription and text location parser.
- `studio/src/features/work-items/displayIdentifier.ts`, `studio/src/features/work-items/mutations.ts`, `studio/src/features/work-items/operations/workItems.graphql` and `studio/src/shared/utilities/display.ts`: shared identifiers, restricted model updates and state labels/resolution groups.
- `studio/src/app/navigation/keymapBindings.ts`: ordinary Stories navigation defaults; no findings-specific chord.

## Gotchas

- Naming is catalog-dependent: the gate/count locate literal **Story**, **Implementation**, **Review** and **Implement** names. Cancellation and resolved status use state groups instead. Do not infer that every Implementation child has review provenance or that queued implies an agent is running.
- Location is description text, not a structured field or clickable source jump. The parser is not the MCP path/range validator; it accepts numeric range lines without checking ordering. The label is hidden below the `sm` breakpoint, though the description remains available in child details. Native narrow-layout behavior is unverified.
- `studio/e2e/web-app.spec.ts` reaches modules through `openModule` in `studio/e2e/support.ts`, which still waits for removed `modules-pane-toggle`; its other cases target retired `pane-modules`. Treat the findings scenarios as historical pointers until setup is repaired in the follow-on coverage work.
- The [historical e2e skill](../../.claude/skills/e2e/SKILL.md) mentions Django; the current Playwright stack runs the Rust GraphQL adapter. Browser results and mocked acceptance do not establish an installed-desktop findings journey.
