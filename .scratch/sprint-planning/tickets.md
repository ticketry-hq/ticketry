# Sprint planning ticket breakdown

Recreated through Worktracker MCP in Ticketry under CODING → Roadmap, module CODING-2214. All stories and Implementation children are in Implement.

8 stories, 27 Implementation tasks. Dependencies, parent links, issue types, nonempty descriptions and workflow state were read back and verified through MCP.

Sources: [spec.md](spec.md), [LLD.html](LLD.html), [approved-design.html](approved-design.html).

Descriptions preserve the current LLD decisions D-1…D-15, acceptance AC-1…AC-12 and exclusions EX-1…EX-8, including the newer AC-11, AC-12 and EX-8. Story → spec/AC coverage below is unchanged from the ticket plan. Each Story includes the full text of its covered spec user stories, including those covered in part. Every Implementation description includes the complete assigned LLD file records and their trace. Approved interactions come from approved-design.html; visuals use Studio tokens.

## Stories and implementation tasks

### CODING-2496 · Manage sprint lifecycle in Studio

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2497 | Add sprint planning entities and migration to the installation chain | None |
| CODING-2498 | Expose restricted sprint lifecycle and WorkItem membership writes | CODING-2497 |
| CODING-2499 | Generate sprint and project planning read contracts | CODING-2498 |
| CODING-2500 | Build sprint cards and lifecycle dialogs with acceptance coverage | CODING-2499 |

### CODING-2501 · Set numbered goals on each sprint

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2502 | Add scoped goal CRUD with protected ordering | CODING-2497, CODING-2498 |
| CODING-2503 | Generate goal operations and cache updates | CODING-2499, CODING-2502 |
| CODING-2504 | Render numbered goals and keyboard entry on sprint cards | CODING-2500, CODING-2503 |

### CODING-2505 · Record sprint suggestions through scoped MCP tools

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2506 | Implement transactional suggestion accept, dismiss and Undo | CODING-2498, CODING-2502 |
| CODING-2507 | Publish run-scoped sprint goal and suggestion MCP tools | CODING-2506 |
| CODING-2508 | Generate suggestion operations and authoritative cache reconciliation | CODING-2499, CODING-2506 |

### CODING-2509 · Find stories for sprint goals with a background agent

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2510 | Add an Instant launch option that preserves the current workspace | None |
| CODING-2511 | Launch a goal-scoped suggestion run and save its identity | CODING-2498, CODING-2503, CODING-2507, CODING-2510 |
| CODING-2512 | Show agent progress, staleness, cancellation and retry on cards | CODING-2500, CODING-2504, CODING-2508, CODING-2511 |

### CODING-2513 · Reach Plan and Changes from the workspace tab strip

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2514 | Add Apollo-owned Plan workspace state and feature entry points | CODING-2499 |
| CODING-2515 | Mount Plan and Changes ahead of module tabs | CODING-2500, CODING-2514, CODING-2519, CODING-2520 |
| CODING-2516 | Guard Plan keyboard navigation and verify shell regressions | CODING-2515, CODING-2527, CODING-2529 |

### CODING-2517 · Plan a sprint through one epic tab at a time

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2518 | Implement epic tab rules and per-sprint persistence | CODING-2514 |
| CODING-2519 | Build epic tabs with counts, add menu and accessible focus | CODING-2508, CODING-2518 |
| CODING-2520 | Compose the Plan header, focused panes and empty state | CODING-2499, CODING-2503, CODING-2508, CODING-2519 |
| CODING-2521 | Create epics from the tab menu and cover the planning visit | CODING-2519, CODING-2520 |

### CODING-2522 · Move and create stories during sprint planning

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2523 | Add generated PlanWorkItem operations and a shared write guard | CODING-2498, CODING-2499 |
| CODING-2524 | Port optimistic moves, drag targets and Undo/Retry feedback | CODING-2520, CODING-2523 |
| CODING-2525 | Create stories inline with recoverable assignment failures | CODING-2521, CODING-2523, CODING-2524 |

### CODING-2526 · Review and approve suggestions in the selected-ticket panel

| Implementation task | Title | Blocked by |
| --- | --- | --- |
| CODING-2527 | Render pinned suggestion rows with scoped batch actions | CODING-2508, CODING-2520 |
| CODING-2528 | Reuse ticket detail for suggestion banners and editable proposals | CODING-2508, CODING-2514, CODING-2520 |
| CODING-2529 | Integrate suggestion decisions with Plan rollback, Retry and Undo | CODING-2506, CODING-2524, CODING-2527, CODING-2528 |
| CODING-2530 | Cover suggestion review and run the integrated overhaul gate | CODING-2504, CODING-2507, CODING-2512, CODING-2516, CODING-2521, CODING-2525, CODING-2529 |

## Scope coverage

| Story | Spec user stories | LLD acceptance |
| --- | --- | --- |
| CODING-2496 | 10–15, 70 in part | AC-4 |
| CODING-2501 | 16–20, 70 in part | AC-5 |
| CODING-2505 | 31–32, 67–71 | AC-8 backend, AC-9 |
| CODING-2509 | 21–30 | AC-10 |
| CODING-2513 | 1–9, 72 in part | AC-1, AC-2 Escape |
| CODING-2517 | 33–45, 72 in part | AC-2 entry, AC-3 |
| CODING-2522 | 46–53 | AC-6 |
| CODING-2526 | 54–66, 72 in part | AC-7, AC-8 |

Every changed file in the LLD is assigned to a task. The sidebar is explicitly unchanged in the LLD. Dependency graph is acyclic.

## MCP verification

Verified through MCP at 2026-10-02T23:16:20.062Z: 8 Stories, 27 Implementation tasks, all in Implement; exact titles and plan order; Story parents in Roadmap; Implementation parents match the Story groups; all 62 blocker edges match the plan; descriptions contain the complete source-derived requirements; dependency graph is acyclic, with no external blockers. All 35 tickets were created before the blocker pass. Ticketry requires Stories to be born in Ideas, so they were moved through its permitted Ideas → Implement transition.

The readback found other active runs appending coordination notes. Source-derived descriptions were preserved, and an extra blocker added during that activity was restored to the exact plan before the verification snapshot.

## LLD file record allocation

Every one of the 63 LLD file records, including untouched boundaries, is assigned to exactly one Implementation task. Tasks without a complete file record implement the described contribution slice while the listed task owns that file record.

| LLD record | Path | Action | Implementation task |
| --- | --- | --- | --- |
| `ent-sprint` | `studio/src-tauri/crates/foundation/ticketry-entities/src/work_management/sprint.rs` | create | CODING-2497 |
| `ent-goal` | `studio/src-tauri/crates/foundation/ticketry-entities/src/work_management/sprint_goal.rs` | create | CODING-2497 |
| `ent-sugg` | `studio/src-tauri/crates/foundation/ticketry-entities/src/work_management/sprint_suggestion.rs` | create | CODING-2497 |
| `ent-issue` | `studio/src-tauri/crates/foundation/ticketry-entities/src/work_management/issue.rs` | modify | CODING-2497 |
| `ent-project` | `studio/src-tauri/crates/foundation/ticketry-entities/src/work_management/project.rs` | modify | CODING-2497 |
| `ent-mod` | `studio/src-tauri/crates/foundation/ticketry-entities/src/work_management/mod.rs` | modify | CODING-2497 |
| `ent-lib` | `studio/src-tauri/crates/foundation/ticketry-entities/src/lib.rs` | modify | CODING-2497 |
| `mig` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/sprint_migration.rs` | create | CODING-2497 |
| `install` | `studio/src-tauri/crates/execution/ticketry-installation/src/final_schema_migrations.rs` | modify | CODING-2497 |
| `ledger` | `studio/src-tauri/crates/execution/ticketry-installation/src/classification/rust_ledger.rs` | modify | CODING-2497 |
| `adoption` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/adoption.rs` | modify | CODING-2497 |
| `literals` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/work_items.rs` | modify | CODING-2498 |
| `sprint-views` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/sprint/mod.rs` | create | CODING-2498 |
| `cmd-sprints` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/sprints.rs` | create | CODING-2498 |
| `goal-views` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/sprint_goal/mod.rs` | create | CODING-2502 |
| `sugg-views` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/sprint_suggestion/mod.rs` | create | CODING-2506 |
| `cmd-sugg` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/sprint_suggestions.rs` | create | CODING-2506 |
| `wi-sprint` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/work_item/views/update/sprint.rs` | create | CODING-2498 |
| `wi-update` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/work_item/views/update/mod.rs` | modify | CODING-2498 |
| `gql-mod` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/mod.rs` | modify | CODING-2506 |
| `wm-mod` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/mod.rs` | modify | CODING-2498 |
| `codecs` | `studio/src-tauri/crates/surfaces/ticketry-graphql-schema/src/query_root/context.rs` | modify | CODING-2499 |
| `op-registry` | `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/graphql/operation_registry.rs` | untouched | CODING-2506 |
| `public-api` | `studio/src-tauri/tests/fixtures/public-api.txt` | modify | CODING-2498 |
| `gql-test` | `studio/src-tauri/tests/sprint_planning_graphql.rs` | create | CODING-2506 |
| `surface` | `studio/src-tauri/tests/work_management_commands.rs` | modify | CODING-2506 |
| `mcp-registry` | `studio/src-tauri/crates/surfaces/ticketry-mcp/src/registry.rs` | modify | CODING-2507 |
| `mcp-tools` | `studio/src-tauri/crates/surfaces/ticketry-mcp/src/sprint_tools.rs` | create | CODING-2507 |
| `mcp-dispatch` | `studio/src-tauri/crates/surfaces/ticketry-mcp/src/dispatch.rs` | modify | CODING-2507 |
| `mcp-test` | `studio/src-tauri/tests/mcp_acceptance/sprint_suggestions.rs` | create | CODING-2507 |
| `fe-wi-gql` | `studio/src/features/work-items/operations/workItems.graphql` | modify | CODING-2523 |
| `fe-wi-guard` | `studio/src/features/work-items/planWriteGuard.ts` | create | CODING-2523 |
| `fe-wi-create` | `studio/src/features/work-items/storyCreation.ts` | create | CODING-2525 |
| `fe-drag` | `studio/src/shared/dragDrop/storyDrag.ts` | create | CODING-2524 |
| `fe-graph` | `studio/src/features/planning-graph/` | create | CODING-2499 |
| `fe-sp-gql` | `studio/src/features/sprints/operations/sprints.graphql` | create | CODING-2503 |
| `fe-sp-view` | `studio/src/features/sprints/SprintsView.tsx` | create | CODING-2500 |
| `fe-goals` | `studio/src/features/sprints/goals/SprintGoals.tsx` | create | CODING-2504 |
| `fe-agentstate` | `studio/src/features/sprints/suggestions/agentState.ts` | create | CODING-2512 |
| `fe-agentbox` | `studio/src/features/sprints/suggestions/SuggestionAgentBox.tsx` | create | CODING-2512 |
| `fe-launch` | `studio/src/features/sprints/suggestions/launchSuggestionRun.ts` | create | CODING-2511 |
| `fe-instant` | `studio/src/features/agents/terminal/instantConversationLaunch.ts` | modify | CODING-2510 |
| `fe-ws-state` | `studio/src/features/sprints/planWorkspaceState.ts` | create | CODING-2514 |
| `fe-epictabs` | `studio/src/features/sprints/planning/epicTabs.ts` | create | CODING-2518 |
| `fe-epicstrip` | `studio/src/features/sprints/planning/EpicTabStrip.tsx` | create | CODING-2519 |
| `fe-plan-view` | `studio/src/features/sprints/planning/PlanSprintView.tsx` | create | CODING-2520 |
| `fe-header` | `studio/src/features/sprints/planning/PlanHeader.tsx` | create | CODING-2520 |
| `fe-panes` | `studio/src/features/sprints/planning/PlanStoryPanes.tsx` | create | CODING-2524 |
| `fe-moves` | `studio/src/features/sprints/planning/usePlanMoves.ts` | create | CODING-2529 |
| `fe-sugg-rows` | `studio/src/features/sprints/planning/SuggestionRows.tsx` | create | CODING-2527 |
| `fe-detail` | `studio/src/features/sprints/planning/PlanDetailPane.tsx` | create | CODING-2528 |
| `fe-sp-index` | `studio/src/features/sprints/index.ts` | create | CODING-2514 |
| `sh-tabs` | `studio/src/app/shell/ticket-workspace/WorkspaceTabs.tsx` | create | CODING-2515 |
| `sh-strip` | `studio/src/app/shell/ticket-workspace/ModuleTabStrip.tsx` | modify | CODING-2515 |
| `sh-ws` | `studio/src/app/shell/ticket-workspace/TicketWorkspace.tsx` | modify | CODING-2515 |
| `sh-footer` | `studio/src/app/shell/FooterChangesToggle.tsx` | delete | CODING-2515 |
| `sh-keymap` | `studio/src/app/navigation/useGlobalKeymap.ts` | modify | CODING-2516 |
| `sh-bounds` | `studio/src/app/__tests__/moduleBoundaries.test.ts` | modify | CODING-2514 |
| `sidebar` | `studio/src/app/shell/sidebar/StudioSidebar.tsx` | untouched | CODING-2515 |
| `t-ws` | `studio/src/test/overhaulPlanWorkspaceAcceptance.test.tsx` | create | CODING-2516 |
| `t-sugg` | `studio/src/test/overhaulPlanSuggestionsAcceptance.test.tsx` | create | CODING-2530 |
| `t-goals` | `studio/src/test/overhaulSprintGoalsAgentAcceptance.test.tsx` | create | CODING-2530 |
| `issue-detail` | `studio/src/app/shell/ticket-workspace/selected-ticket/details/IssueDetail.tsx` | untouched | CODING-2528 |
