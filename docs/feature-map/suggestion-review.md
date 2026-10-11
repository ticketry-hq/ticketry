# Suggestion review

Review agent suggestions in Plan, approve sprint membership or create a Story, and recover decisions with Retry and Undo.

Surfaces: browser, desktop

## Sub-features

- `review-decisions`: Add existing suggestions, Create story from proposals and Dismiss; case `agent-review` (`@case-agent-review`).
- `review-details`: Read reasons and goals, validate/edit proposal titles, retry decisions and open the real Story; case `bulk-review` (`@case-bulk-review`).
- `review-undo-regression`: Undo existing/proposed acceptance or ungrouped dismissal while retaining a created Story in Backlog; case `suggestion-undo` (`@case-suggestion-undo`).
- `review-rerun`: Mark results stale after goal edits and replace waiting suggestions on rerun while retaining decisions; case `agent-review` (`@case-agent-review`).

## How to get to it

Select the Plan workspace tab (`workspace-tab-plan`), then a sprint card's
Review in Plan → after discovery finishes. Open the relevant epic (or No epic)
to reveal its suggested stories. Select a ✦ suggestion row for the Selected
ticket detail, or use its Accept <title> / Dismiss <title> buttons and Add all.
The detail offers Add to sprint for an existing Story, Create story for a
proposal, and Dismiss. The latest decision exposes Undo <title> suggestion.

Enter or Space activates a focused suggestion row; Enter activates the focused
decision button. Escape closes the detail and restores suggestion focus.
Alt+[ / Alt+] steps epic tabs. These are local Plan keyboard handlers, with
no separate configurable keymap action for suggestion review.

## Prerequisites

Use a selected project, a non-completed sprint with goals, and published waiting
suggestions; [background discovery and recovery](background-discovery-and-recovery.md)
describes how to obtain them. Open their epic tabs, including No epic for
ungrouped suggestions. The [planner service](../planner-service.md) owns the
transport and service-lifecycle reference.

Roadmap availability is compiled from `TICKETRY_ROADMAP_ENABLED` into
`__TICKETRY_ROADMAP_ENABLED__`. In a Roadmap-off build the Plan tab, Sprints
workspace, goals, suggestion review and discovery controls are absent; direct
Plan mounts render nothing. Runtime settings or URL parameters cannot enable
them. Verify this with `bun run --cwd studio test:roadmap-off`, which uses
`studio/vitest.roadmap-off.config.ts`.

## Expected behavior

- Waiting suggestions do not assign Stories to the sprint. Add assigns an
  existing Story; Create story trims a valid proposal title and creates the
  Story with its epic and sprint. Accepting from detail replaces the proposal
  editor/banner with the real Story detail. Dismiss removes the waiting row.
- Detail shows the suggestion's reason and goal attribution. Proposal Epic and
  Sprint fields are read-only. Blank or over-512-character trimmed titles
  disable creation; an edit survives closing and reopening the detail during
  the visit. Escape closes without approving or dismissing the suggestion.
- A rejected decision shows Couldn't accept/dismiss/undo and a per-suggestion
  Retry. Add all accepts the current epic's waiting suggestions sequentially,
  stopping at a failure. An unrelated graph refetch with complete cached records
  does not stop subsequent steps after the batch has saved and fully refreshed
  an earlier decision; an Undone edited proposal uses its retained Story
  identity. Ordinary decisions and new batches remain blocked during raw graph
  loading. Incomplete graph or suggestion reads still block all decisions. An empty suggestion list has no review rows or Add all.
- Undo returns the latest decision to waiting and reverses sprint membership.
  A Story created from a proposal remains in Backlog as an existing suggestion,
  including after reload; accepting it again uses Add rather than creating it
  again. Accepted Stories retain goal badges; remaining counts reflect waiting
  suggestions after reopening Sprints.
- Goal edits show Goals changed since the agent ran. Find stories again clears
  old waiting suggestions while retaining accepted/dismissed records, then
  publishes new waiting results. Existing membership and decisions persist.

These paths are asserted by the browser cases below. Inspect suggestion status,
issueId/proposedName, Story parentId/sprintId and sprint suggestionRunId through
the public GraphQL contract, then reopen or reload to check persisted state.

## Verifying it

Use `plan-sprint`, `plan-sprint-items`, `plan-feedback`, `plan-undo` and
`data-plan-suggestion`; locate the Selected ticket complementary region, Title
textbox, goal note, Accept <title>, Dismiss <title>, Create story and Add all by
accessible name. Check `aria-pressed`, focus after Enter/Escape, goal badges,
waiting counts and authoritative GraphQL readback rather than only row removal.

Feature runner: `bun run --cwd studio test:e2e:feature suggestion-review`.
Use `--case <id>` for partial evidence. The migrated `agent-review`,
`bulk-review` and `suggestion-undo` retain their original titles and assertions
in `studio/e2e/features/suggestion-review.spec.ts`; the legacy
`studio/e2e/sprint-planning.spec.ts` and
`studio/e2e/planning-module-review.spec.ts` remain until the final migration gate.
New cases cover keyboard/detail cancellation, empty review, committed-response
inspection, failed refresh, dismissal/Undo retries and stale rerun recovery.
Only browser cases in this feature's suite fill its coverage cells.

Supplementary regression `studio/src/test/overhaulPlanRestoredProposalBulkAcceptance.test.tsx`
(`[overhaul-813]`) proves Add all retains an edited proposal Story identity and
G1 attribution after Undo when a cached graph refetch starts mid-batch.
Ordinary command loading and remembered-tab normalization remain guarded by
`studio/src/test/overhaulPlanMovePolicyAcceptance.test.tsx` (749 and 760). The existing
`@case-bulk-review` browser journey remains the end-to-end proof.

Supplementary off-state coverage is
`studio/src/test/overhaulRoadmapOffAcceptance.test.tsx` under
`bun run --cwd studio test:roadmap-off`. It does not fill browser cells.

## End-to-end suite

Suite: studio/e2e/features/suggestion-review.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| review-decisions | @case-agent-review @case-bulk-review | @case-review-detail-empty | @case-bulk-review @case-review-dismiss-undo-retry @case-review-inspect-recovery @case-review-refresh-recovery | @case-review-detail-empty @case-review-empty-rerun | @case-agent-review @case-bulk-review @case-review-detail-empty | @case-agent-review @case-bulk-review @case-review-detail-empty |
| review-details | @case-agent-review @case-bulk-review | @case-agent-review @case-review-detail-empty | @case-bulk-review @case-review-inspect-recovery @case-review-refresh-recovery | @case-review-empty-rerun | @case-agent-review @case-bulk-review @case-review-detail-empty | @case-bulk-review |
| review-undo-regression | @case-suggestion-undo | n/a: Undo is an immediate decision with no cancel step | @case-review-dismiss-undo-retry | @case-review-detail-empty @case-review-empty-rerun | @case-suggestion-undo @case-review-dismiss-undo-retry | @case-suggestion-undo |
| review-rerun | @case-agent-review | @case-review-rerun-recovery | @case-review-rerun-recovery | @case-review-empty-rerun | @case-agent-review @case-review-rerun-recovery | @case-agent-review @case-review-rerun-recovery @case-review-empty-rerun |

## Relevant code

- `studio/src/features/sprints/planning/SuggestionRows.tsx`
- `studio/src/features/sprints/planning/SuggestionBanner.tsx`
- `studio/src/features/sprints/planning/ProposedStoryDraft.tsx`
- `studio/src/features/sprints/planning/PlanDetailPane.tsx`
- `studio/src/features/sprints/planning/PlanFeedback.tsx`
- `studio/src/features/sprints/planning/usePlanSuggestionDecisions.ts`
- `studio/src/features/sprints/planning/planKeyboardNavigation.ts`
- `studio/src/features/sprints/useUpdateSprintSuggestion.ts`
- `studio/src/features/sprints/operations/sprints.graphql`
- `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/sprint_suggestions.rs`
- `studio/src-tauri/crates/execution/ticketry-agent-execution/src/sprint_suggestions/create.rs`
- `studio/src/app/shell/ticket-workspace/WorkspaceTabs.tsx`
- `studio/src/shared/config/roadmapAvailability.ts`
- `studio/vite.config.ts`

## Gotchas

The feature runner invokes the Chromium project with case isolation and the onboarding setup dependency. The historical baseline was blocked by the retired Modules-pane setup path; authored cases require current run evidence before they establish a passing claim.

The stable IDs were reconstructed from executable cases, not recovered from
the unavailable historical map. Goal labels use stored positions (G2 may
remain after G1 is removed). Add all acts on the active epic, and Undo records
the latest individual decision, including the final item of a batch.
Distinguish Retry accepting a suggestion from read-only Inspect suggestion /
Retry refresh recovery; do not replay an unconfirmed write blindly.

Inspect browser screenshots at desktop and narrow widths for controls, focus
and overflow. Those screenshots are browser viewports, not native desktop
proof. Existing cases use a disposable provider and public GraphQL fixtures;
they do not verify paid providers or native Tauri/libghostty rendering. No live
walkthrough or runner execution is implied by this map. Proposal draft survival
across an application restart is unverified; the mapped test checks close/reopen
within a visit, not durable draft persistence.
