# Sprint planning in Studio

Status: ready-for-agent
Type: Story
Scope: Ticketry Studio (frontend `studio/src` and the Rust work-management, GraphQL and MCP surfaces). Brings the roadmap planner's Sprints and Plan screens into Studio. Story Map and the roadmap's sprint-length timeframe are out of scope.
Approved design: [`approved-design.html`](approved-design.html), an interactive mockup. Its interactions are approved. Its pixels are not: build it from Studio's own tokens and components.
LLD: [`LLD.html`](LLD.html)

## Problem Statement

Ticketry plans work one module at a time. A person picks a module tab, reads its stories, and launches agents. There is no way to:

- say what the next sprint is for;
- pull stories from several epics into that sprint;
- step through the backlog epic by epic and decide what goes in.

The roadmap project already has a working planner (Sprints, Plan, moves with Undo and Retry, inline story and epic creation). It runs as a separate staging app against a copy of Ticketry's database, so planning lives outside the app where the work is done.

Choosing what fits a sprint goal is also slow, manual reading. The person knows the goal ("Unify the tab strip"). Finding every related story across the backlog is the kind of search an agent could do. Today the only way is for the person to search by hand.

## Solution

Studio gets one top-level tab strip above the work area:

- **Plan** (the whole project);
- **Changes** (moved out of the footer into this strip, for consistency);
- then the module tabs, unchanged.

The flow follows the order a person plans in: goals, then the agent, then planning.

1. **Sprints.** Plan opens on the sprint list. Each sprint card holds its goals. The person adds goals in plain language ("Unify the tab strip across Plan, Changes and modules").
2. **Agent.** From the card, the person asks an agent to find stories for those goals. The agent searches the backlog and returns *suggestions*: existing stories, or new stories it proposes. Nothing joins the sprint without the person's approval. The card shows the agent's state: idle, running, done, stale after goals change, or error.
3. **Plan.** Opening a sprint goes straight to the Plan view. There is no "pick an epic" screen. Plan works like the module tabs: a strip of *epic tabs* holds the epics being planned. The person adds epics, steps through them one at a time, and closes each tab when done. Only one epic is active. For the active epic:
   - the left pane is its backlog, with the agent's suggestions pinned at the top and marked ✦;
   - the right pane is the sprint, with the active epic's stories first.
4. **Suggestions open like any ticket.** Clicking a suggestion opens it in the same right-hand Selected ticket panel used everywhere else in Studio. An agent banner shows the goal it serves, the agent's reason, and **Add to Sprint** or **Dismiss**. A suggested new story opens as a draft with an editable title. After it is accepted, the panel shows the real story.

The left modules sidebar is not part of this layout.

## User Stories

### Navigation and layout

1. As a planner, I want Plan as a tab beside my module tabs, so that planning is one keystroke away from the work.
2. As a planner, I want Changes in the same tab strip as Plan, so that every workspace-level surface is reached the same way.
3. As a planner, I want the Plan tab to cover the whole project, so that I can plan across modules without switching module tabs.
4. As a developer, I want the Changes tab to keep its module scope and its own module picker, so that reviewing a checkout works as it does today.
5. As a developer, I want my module tabs to keep their current order, hide, drag and jump-badge behaviour, so that adding Plan and Changes breaks nothing I rely on.
6. As a planner, I want the Plan tab to open the next planned sprint when one exists, so that I land on the work I'm most likely to do.
7. As a planner, I want Escape to leave Plan the way it leaves Changes, so that both surfaces behave the same way.
8. As a keyboard user, I want the top tab strip to support arrow keys, Home and End, so that I can reach Plan and Changes without a mouse.
9. As a planner, I want the layout to work without the modules sidebar, so that Plan uses the full width.

### Sprints

10. As a planner, I want to see every sprint in the project (active, planned, completed), so that I know where the work stands.
11. As a planner, I want to create a sprint, so that I can plan the next block of work.
12. As a planner, I want to start a planned sprint, so that it becomes the active sprint.
13. As a planner, I want to complete the active sprint and carry unfinished stories into a planned sprint, so that nothing falls through the cracks.
14. As a planner, I want only one active sprint per project, so that "current work" is unambiguous.
15. As a planner, I want each sprint card to show its story count, so that I can judge its size at a glance.

### Goals

16. As a planner, I want to add one or more goals to a sprint in plain language, so that the sprint has a stated purpose.
17. As a planner, I want to remove a goal, so that I can correct a goal that no longer applies.
18. As a planner, I want goals numbered (G1, G2…) within a sprint, so that suggestions and stories can say which goal they serve.
19. As a planner, I want Enter in the goal input to add the goal, so that writing several goals is fast.
20. As a planner, I want goals to belong to one sprint, so that each sprint's purpose is self-contained.

### Agent suggestions

21. As a planner, I want to ask an agent to find stories for a sprint's goals, so that I don't search the backlog by hand.
22. As a planner, I want to see that the agent is working and be able to cancel it, so that I stay in control of a long run.
23. As a planner, I want the agent to propose existing backlog stories with a one-line reason, so that I can judge each fit quickly.
24. As a planner, I want the agent to propose new stories when the backlog has a gap, so that every goal can be covered.
25. As a planner, I want every suggestion to name the goal it serves, so that I know why it is there.
26. As a planner, I want suggestions to wait for my approval, so that the agent never changes the sprint on its own.
27. As a planner, I want the sprint card to say how many suggestions are waiting, with a link to review them in Plan, so that I know when to come back.
28. As a planner, I want the card to tell me when I have changed the goals since the agent ran, so that I know its suggestions may be stale.
29. As a planner, I want to ask the agent again, so that I can refresh suggestions after changing goals.
30. As a planner, I want a failed run to say so and offer Retry, so that a failure is never silent.
31. As a planner, I want a re-run to replace suggestions I haven't reviewed and keep my earlier decisions, so that dismissed items don't return and accepted ones stay accepted.
32. As a planner, I want the agent to propose only stories from this project that are not already in the sprint, so that suggestions are always actionable.

### Plan view and epic tabs

33. As a planner, I want opening a sprint to go straight to Plan, so that I don't pass through an intermediate picker.
34. As a planner, I want a sprint’s first Plan visit to start with no epic tabs, so that I choose the epics to plan through + Add epic.
35. As a planner, I want to add an epic tab from a menu showing each epic's backlog count, so that I choose what to plan next.
36. As a planner, I want to create a new epic from that menu, so that new work has a home.
37. As a planner, I want only one epic active at a time, so that I focus on one area.
38. As a planner, I want each epic tab to show its backlog count and its waiting-suggestion count, so that I know which epics still need attention.
39. As a planner, I want to close an epic tab when I'm done with it, so that the strip shows only what's left.
40. As a planner, I want "Next epic →" and ⌥] / ⌥[ to step between epic tabs, so that I can work through them in order.
41. As a planner, I want a "Done with this epic → next" action at the end of the backlog, so that finishing one epic leads into the next.
42. As a planner, I want a clear empty state with "+ Add epic" when no epic tab is open, so that I'm never stuck.
43. As a planner, I want the Plan header to show the sprint, its story count, its goals (listed on hover) and the waiting-suggestion count in one row, so that context costs little vertical space.
44. As a planner, I want "← Plan" to return to the sprint list, so that I can switch sprints.
45. As a planner, I want the epic tabs I opened to survive leaving and returning to the same sprint, so that a break doesn't lose my place.

### Moving stories

46. As a planner, I want to move a backlog story into the sprint with +, so that adding is one click.
47. As a planner, I want to move a sprint story back to the backlog with −, so that removing is one click.
48. As a planner, I want to drag stories between backlog and sprint, with valid drop targets highlighted, so that direct manipulation works.
49. As a keyboard user, I want Alt+↑/↓ (or the move shortcut) to move the focused story, so that I can plan without a mouse.
50. As a planner, I want a move to show immediately and roll back if the save fails, so that the screen never lies about the data.
51. As a planner, I want Undo for my last move and Retry for a failed one, so that mistakes and failures are cheap to recover.
52. As a planner, I want stories from other epics in the sprint pane to stay visible but dimmed, so that I see the whole sprint while focusing on one epic.
53. As a planner, I want to create a story inline in the active epic's backlog or the sprint, so that new work is captured where I decide on it.

### Reviewing suggestions

54. As a planner, I want suggestions pinned at the top of the epic's backlog and marked ✦, so that agent proposals are distinct from my backlog.
55. As a planner, I want to accept a suggestion with ✓ in the list, so that approving a good fit is one click.
56. As a planner, I want to dismiss a suggestion with ×, so that a bad fit disappears.
57. As a planner, I want "Add all" for the active epic's suggestions, so that I can approve a batch I trust.
58. As a planner, I want clicking a suggestion to open it in the right-hand Selected ticket panel, so that I review it exactly as I review any ticket.
59. As a planner, I want that panel to show an agent banner with the goal, the reason, Add and Dismiss, so that I can decide without leaving the panel.
60. As a planner, I want a suggested existing story to show its full ticket details under the banner, so that I judge the real story.
61. As a planner, I want a suggested new story to open as a draft whose title I can edit before creating it, so that the agent's wording isn't final.
62. As a planner, I want the panel to switch to the real story after I accept, so that I can keep editing it.
63. As a planner, I want the panel to close when I dismiss the open suggestion, so that I don't see a dead item.
64. As a keyboard user, I want Enter on a focused suggestion to open it and Escape to close the panel, so that review is keyboard-friendly.
65. As a planner, I want an accepted suggestion to join the sprint the same way a manual move does (immediate, Undo-able, Retry on failure), so that one rule applies to everything.
66. As a planner, I want the open suggestion highlighted in the list, so that I know which one the panel shows.

### Agent and system

67. As an agent, I want to read a sprint's goals and the project backlog through Worktracker MCP, so that I can find related stories.
68. As an agent, I want to record suggestions (an existing story or a proposed new one, plus a goal and a reason) through Worktracker MCP, so that a person can review them.
69. As an agent, I want my writes limited to suggestions, so that I can't change the sprint or stories directly.
70. As a maintainer, I want sprints, goals and suggestions to be Seaography models with restricted writes, so that they follow the repository's CRUD-first rules.
71. As a maintainer, I want accepting a suggestion to be one write that also assigns or creates the story, so that suggestion state and sprint membership can't diverge.
72. As a maintainer, I want Apollo to remain the only frontend state owner for sprints, goals, suggestions and epic tabs, so that there's no second snapshot.

## Implementation Decisions

- **Code merge follows `TRANSPLANT.md` (roadmap repository).**
  - Its *New* files are ported to the same Ticketry paths.
  - Its *Diff* rows are applied to Ticketry's existing files.
  - Its *Stand-ins* are not copied.
  - Story Map, `sprintLength`, plan-voice and the evaluation tooling are excluded.
- **Sprint model**: transplanted (`worktracker_sprint`, `worktracker_issue.sprint_id`, at most one active sprint per project via a partial unique index). It keeps:
  - the generated create-one and the restricted `update_sprint` (status lifecycle, completion carry-over);
  - the `sprint_id` path on the WorkItem update contract (`PlanWorkItem`).

  The sprint's single `goal` text column and its start and end dates are dropped. Goals are their own rows, and the timeframe is deferred. It gains `suggestion_run_id`, the latest suggestion agent run.
- **Sprint goal model** (new): `worktracker_sprint_goal`.
  - Columns: `id`, `sprint_id`, `position`, `text`, `created_at`, `updated_at`.
  - Writes: generated create-one and delete, scoped by sprint, plus a restricted update that allowlists `text` only.
  - Display numbers (G1, G2…) are positions within the sprint.
- **Sprint suggestion model** (new): `worktracker_sprint_suggestion`.
  - Columns: `id`, `sprint_id`, `goal_id`, `issue_id?`, `proposed_name?`, `proposed_epic_id?`, `reason`, `status`, `run_id`, `created_at`.
  - `status` is `waiting | accepted | dismissed`.
  - Exactly one of `issue_id` and `proposed_name` is set.
- **Accepting is one model-shaped write**: a restricted `update_sprint_suggestion(id, status, proposed_name?)`.
  - Setting `accepted` runs, in one transaction:
    1. for an existing story, the same internal sprint-assignment operation as `PlanWorkItem`;
    2. for a proposal, Ticketry's existing work-item creation under the proposed epic, followed by the same assignment;
    3. the status update.
  - It returns the suggestion together with the resulting work item.
  - Setting `dismissed` changes only the status.
  - There is no separate "accept" RPC, and the operation registry is unchanged.
- **Agent run**:
  - Started from the sprint card as an Instant agent conversation. This is the same launch path that "Resolve conflicts" in Changes uses: a built prompt, the default provider, and the selected module, or the first visible module when none is selected, because every launch needs a module folder.
  - It does not take the person to the terminal; the sprint card shows progress.
  - The launch returns the agent run id, and the card stores it on the sprint (`suggestion_run_id`, a caller-writable field on `update_sprint`).
  - The prompt tells the agent the sprint id. The agent reads goals and the backlog, and writes suggestions, only through two new Worktracker MCP tools: `get_sprint_goals` and `suggest_sprint_story`. It searches the backlog with the existing read tools.
  - The first suggestion from a new run deletes the sprint's `waiting` suggestions from earlier runs. Accepted and dismissed rows are kept.
  - The run never assigns stories. No new skill is added; the pinned skills catalog is unchanged.
- **Agent state on the card** is derived from the run recorded in `suggestion_run_id` and the existing run status feed. Nothing new is stored:
  - **running**: the run's state is starting, working, quiet, reconnecting, or waiting for input or permission;
  - **error**: the run's state is error or lost, or it exited with a non-zero code;
  - **done**: the turn completed or the run exited cleanly, and waiting suggestions are counted;
  - **stale**: a goal was created, edited or deleted after the run started;
  - **idle**: no run is recorded.
  - Cancel uses the existing run terminate action.
- **Shell**:
  - The Plan surface lives in the transplanted sprints feature and is mounted the way Changes is: a full-region branch in the ticket workspace, with its own Apollo local store `plan-workspace` and a keymap guard.
  - The footer Changes toggle is replaced by a *workspace tab strip* at the head of the module tab strip, holding Plan, then Changes, then the module tabs.
  - Changes keeps its current open, leave and Escape behaviour.
- **Plan's right-hand panel reuses Studio's ticket detail.**
  - The shell passes Studio's issue-detail component into Plan as a render prop, so features never import from `app/`.
  - A suggestion adds only a banner above it. A proposed new story renders a draft form instead.
- **Epic tabs** are client-only Apollo state, keyed by project and sprint: open epic ids in order, plus the active epic.
  - A sprint's first Plan visit starts with no epic tabs and no active epic, even when sprint stories or waiting suggestions exist. + Add epic opens and activates a chosen epic. Leaving and returning restores the saved tabs, including an empty visit.
  - Closing the active tab activates its right-hand neighbour, or the left one when there is no right-hand neighbour.
- **Moves and Undo/Retry**: the roadmap's `usePlanMoves`, `planWriteGuard`, `moveFeedback` and `PlanFeedback` are reused unchanged. Accepting a suggestion uses the same feedback entry. Its Undo moves the story back out and returns the suggestion to `waiting`, using the same restricted update in reverse.
- **Prototype state shapes** (from the approved mockup; they encode the decisions):

  ```ts
  type AgentState = "idle" | "running" | "done" | "stale" | "error";
  type SuggestionStatus = "waiting" | "accepted" | "dismissed";
  interface PlanVisit { sprintId: string; epicTabs: string[]; activeEpicId: string | null; openItem: string | null } // openItem: workItemId | `suggestion:${id}`
  ```

## Testing Decisions

- A good test drives behaviour a person or an agent can observe: GraphQL results, MCP tool results, rendered UI and keyboard. It does not assert hooks, internal selectors or call counts.
- **Seam 1, GraphQL schema tests** (`studio/src-tauri/tests`).
  - Prior art: the roadmap's `sprint_planning_graphql.rs` and `graphql_mutation_surface.rs`, ported onto Ticketry's `tests/common`.
  - Covers:
    - sprint lifecycle and one-active;
    - goal CRUD scoping;
    - suggestion accept and dismiss, including the transactional assign or create, and rejection when the sprint is completed or the story belongs to another project;
    - the mutation surface equalling the registry.
- **Seam 2, MCP tool tests**, beside the existing Worktracker MCP tool tests.
  - Covers: `get_sprint_goals` and `suggest_sprint_story` are scoped and validated, the agent cannot assign, and re-runs replace only `waiting` rows.
- **Seam 3, Studio acceptance tests** (`studio/src/test/overhaul*Acceptance.test.tsx`).
  - Prior art: `overhaulChangesEscapeLeavesWorkspace.test.tsx` and the Changes workspace acceptance tests.
  - Covers:
    - the Plan and Changes tabs;
    - Escape;
    - epic tabs (open, step, close);
    - moves with rollback, Undo and Retry;
    - a suggestion opening the right-hand panel, then accept and dismiss;
    - agent states on the sprint card.
  - The roadmap Playwright scenarios (`planMoves`, `planMoveFeedback`, `planCreate*`) are ported as acceptance cases on this harness, not copied.
- Pure modules keep their unit tests: `planGroups`, `moveFeedback`, and the new `epicTabs` seeding and closing rules.
- These three seams were chosen to match the existing test boundaries. Raise any disagreement before implementation starts.

## Out of Scope

- Story Map.
- Sprint length and timeframe (start and end dates, the planned-length control); possible future work.
- Plan voice and the roadmap evaluation tooling.
- The roadmap's stand-in server, data refresh and local provenance.
- Removing the modules sidebar from the rest of Studio. This layout simply doesn't show it; a sidebar decision is separate.
- Pixel matching the mockup. The implementation uses Studio's tokens and components (including the shared TabStrip once the shared-UI work lands).
- Agents adding stories to a sprint without approval.

## Further Notes

- No feature flag. Plan ships directly. `TRANSPLANT.md`'s `feature_flags` proposal was for Story Map, which is dropped.
- Changes is module-scoped and Plan is project-scoped. The tab strip makes this visible: the Changes tab shows its module name.
- Before the epic-tabs work, read the roadmap's spec T2361 (Plan epic focus as a horizontal tab strip) as prior art.
