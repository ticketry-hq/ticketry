# Background discovery and recovery

Find Story suggestions for sprint goals through the typed Rust execution host, then review results or recover cancellation, failure and status reads.

Surfaces: browser, desktop

## Sub-features

- `agent-host`: Find stories, Starting/running, Cancel and reopen use the typed Rust host without adding a Conversation or terminal; case `discovery-publication` (`@case-discovery-publication`).
- `agent-publication`: Ready counts, existing/proposed/ungrouped suggestions and Review in Plan open the correct sprint; cases `discovery-publication` (`@case-discovery-publication`), `discovery-empty-publication` (`@case-discovery-empty-publication`).
- `agent-recovery`: Cancel, provider failure, Retry and Retry status preserve goals, execution state and cleanup without a duplicate status-retry launch; case `agent-recovery` (`@case-agent-recovery`).

## How to get to it

Select the Plan workspace tab (`workspace-tab-plan`), then Back to sprints if
already in a sprint. Add goals to a sprint card and choose Find stories for
these goals. While running, Cancel stops the execution. After completion,
Review in Plan → opens that sprint; Find stories again reruns discovery.
Failure/cancellation offers Retry, while a failed status read offers Retry
status. These buttons support normal Tab focus and Enter activation; there is
no discovery-specific configurable keymap action.

Enter or Space selects the focused Plan tab. Escape closes an open Plan detail
first; with no detail it leaves Plan and focuses the Plan tab. The mapped
journey uses Escape then Enter to reopen the workspace during execution.

## Prerequisites

Use a selected project and non-completed sprint with at least one goal and an
unarchived project module. The Rust host requires an activated Codex default
model in Settings and an available Codex executable; it runs in its temporary
execution directory. Automated journeys use a disposable provider rather than
a paid account. Follow the [planner service](../planner-service.md) for transport,
startup, credentials and service verification.

Roadmap availability is compiled from `TICKETRY_ROADMAP_ENABLED` into
`__TICKETRY_ROADMAP_ENABLED__`. A Roadmap-off build omits the Plan tab, Sprints
workspace, goals, suggestion review and Find stories controls, and direct Plan
mounts render nothing. Runtime settings or URL parameters cannot enable them.
`bun run --cwd studio test:roadmap-off` selects
`studio/vitest.roadmap-off.config.ts` for this compiled-off coverage.

## Expected behavior

- With no goals, Find stories is disabled and the card says Add goals, then an
  agent can look for stories that fit them. Completed sprints have no discovery
  box. Starting… disables the launch button while its response is pending;
  queued/running execution shows An agent is looking for stories…, a Finding
  stories progressbar and Cancel. Reopening Plan does not launch another run.
- Discovery creates a typed `sprint_suggestions_v1` execution without a new
  Conversation or terminal session. Plan shows Agent still working… while it
  runs. Success publishes existing Story, proposal and No epic suggestions,
  shows an authoritative waiting count and opens the correct sprint from
  Review in Plan →. Publication alone does not assign sprint membership.
- Cancel preserves goals and shows Agent cancelled. Your goals are kept.
  Provider failure persists the failed execution/error and offers Retry with
  provider-configuration guidance. Cancelled, failed and succeeded executions
  have their temporary execution directories cleaned up in the mapped cases.
- Retry starts a new execution. Retry status refetches the current sprint/run,
  suggestions and planning graph without creating an execution; its button
  becomes Retrying status… during the read. Reload/reopen retains goals and
  completed/error/cancelled outcomes.
- Goal changes after a finished run mark results stale. Find stories again
  removes old waiting suggestions while preserving accepted/dismissed decisions.
  Newly published waiting results are reviewed through
  [suggestion review](suggestion-review.md).

These paths are grounded in the browser cases below and SuggestionAgentBox,
useSprintSuggestionExecution and the Rust execution modules. Application
restart converts unfinished queued/running jobs to a failed state with Retry
guidance in `worker.rs`; that restart path is source-only in this map.

## Verifying it

Use `sprint-card-<id>`, `workspace-tab-plan`, `plan-sprint`, role status/alert,
Finding stories progressbar and the named launch/recovery buttons. Read public
GraphQL execution state, outputType, cancelRequested, error, sprint
suggestionRunId, goals and waiting suggestions; compare Conversation and
terminal records before/after, and reopen/reload for persistence. The support
helper also checks removal of the disposable execution directory.

Feature runner: `bun run --cwd studio test:e2e:feature background-discovery-and-recovery`.
Use `--case <id>` for partial evidence. The migrated `agent-recovery` retains
its exact title and assertions in
`studio/e2e/features/background-discovery-and-recovery.spec.ts`; the legacy
`studio/e2e/sprint-planning.spec.ts` remains until the final migration gate.
Independent publication cases prove typed host execution, empty goals,
existing/proposed/ungrouped results, real zero-result output, keyboard launch
and review, transport retries and persistence within this feature's suite.

Supplementary state derivation coverage is
`studio/src/features/sprints/suggestions/agentState.test.ts`. Off-state absence
is asserted in `studio/src/test/overhaulRoadmapOffAcceptance.test.tsx` under
`bun run --cwd studio test:roadmap-off`; neither fills browser cells.

## End-to-end suite

Suite: studio/e2e/features/background-discovery-and-recovery.spec.ts

| Sub-feature | Success | Cancel | Error | Empty | Entry points | Persistence |
| --- | --- | --- | --- | --- | --- | --- |
| agent-host | @case-discovery-publication | @case-agent-recovery @case-discovery-network-retry | @case-agent-recovery @case-discovery-network-retry | @case-discovery-publication | @case-discovery-publication @case-agent-recovery | @case-discovery-publication @case-agent-recovery |
| agent-publication | @case-discovery-publication | n/a: publication is the terminal result of discovery; cancel belongs to agent-host | @case-agent-recovery | @case-discovery-empty-publication | @case-discovery-publication @case-discovery-empty-publication | @case-discovery-publication @case-discovery-empty-publication |
| agent-recovery | @case-agent-recovery @case-discovery-network-retry | @case-agent-recovery @case-discovery-network-retry | @case-agent-recovery @case-discovery-network-retry | n/a: recovery requires a previous execution or failed launch | @case-agent-recovery @case-discovery-network-retry | @case-agent-recovery @case-discovery-network-retry |

## Relevant code

- `studio/src/features/sprints/suggestions/SuggestionAgentBox.tsx`
- `studio/src/features/sprints/suggestions/SuggestionStatusRecovery.tsx`
- `studio/src/features/sprints/suggestions/useSprintSuggestionExecution.ts`
- `studio/src/features/sprints/suggestions/launchSuggestionRun.ts`
- `studio/src/features/sprints/suggestions/agentState.ts`
- `studio/src/features/sprints/SprintCard.tsx`
- `studio/src/features/sprints/planning/PlanSprintView.tsx`
- `studio/src/features/sprints/planning/planKeyboardNavigation.ts`
- `studio/src/features/sprints/operations/sprints.graphql`
- `studio/src/features/agents/status/stream/sprintInvalidation.ts`
- `studio/src-tauri/crates/execution/ticketry-agent-execution/src/sprint_suggestions/`
- `studio/src/app/shell/ticket-workspace/WorkspaceTabs.tsx`
- `studio/src/shared/config/roadmapAvailability.ts`
- `studio/vite.config.ts`

## Gotchas

The feature runner invokes the Chromium project with case isolation and the onboarding setup dependency. The historical baseline was blocked by the retired Modules-pane setup path; authored cases require current run evidence before they establish a passing claim.

The stable IDs were reconstructed from executable cases; the historical map
was unavailable. Await authoritative states and counts rather than timing a
provider. A status-read failure differs from an execution failure: Retry status
reads, Retry launches. Goal edits can replace the finished-result display with
the stale message until rerun. Entering Plan can choose another older planned
sprint, so use the intended sprint card rather than assuming the active one.

Inspect browser screenshots at desktop and narrow widths for controls, focus
and overflow. Browser fixtures exercise the real Rust host with a disposable
provider; they do not prove paid-provider behavior, native Tauri/libghostty
rendering or native terminal retention. No live walkthrough or runner execution
is implied here. Native restart recovery has no mapped browser journey; restart behavior is source-grounded. Zero-result publication is covered by the disposable typed provider with an empty output.
