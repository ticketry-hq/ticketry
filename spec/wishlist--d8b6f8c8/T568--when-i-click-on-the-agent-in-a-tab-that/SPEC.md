# T568 — Launch a task-context agent from a workspace tab

Status: Ready for agent
Story: WorkTracker #568 (`906c5520-3e31-4ae9-a900-2a7e45062baf`)
Date: 2026-08-12

## Problem Statement

When a person is working in a Story's task workspace, there is no sufficiently
direct, workspace-local way to start another coding agent for that same work
item. A generic create flow can ask for a prompt or lose the selected task as
the launch scope, even though the open workspace already establishes which
work item the new run should understand.

The task workspace should make the common intent explicit: start a fresh agent
run for this work item, without asking the person to author an additional
prompt. The run must still receive Ticketry's canonical task context, including
the current work item's factual tracker data and applicable workflow guidance.

## Solution

Expose a `＋ Agent` launcher in every real task workspace's tab strip. Activating
it offers the host's currently activated coding providers. Choosing one starts
a fresh task-scoped run bound to the work item whose workspace owns the tab
strip, passes no user-authored initial prompt, opens a terminal tab for the new
run, and makes that tab active.

The launch reuses the existing task-terminal path. The frontend supplies the
selected work item's durable identity and its project/module launch scope; the
backend fetches authoritative work-item details and composes the canonical
context prompt. “Without a prompt” means that this interaction does not open a
prompt-entry step and does not add optional user text. It does not suppress the
system-generated task context, workflow-stage guidance, or required-skill
envelope that make a task-scoped agent useful and policy-compliant.

The task launcher is distinct from the scratch workspace launcher. Scratch
continues to ask whether the person wants a Plan or Instant run and continues
through its existing module-folder, prompt, and provider flow.

## User Stories

1. As a person viewing a Story, I want a `＋ Agent` control in its workspace tab strip, so that I can start another agent without leaving the Story.
2. As a person launching an agent, I want to choose from the coding providers activated in my Studio profile, so that the run uses an available provider I intended.
3. As a person launching from a task workspace, I want the new run bound to that workspace's work item, so that the agent receives the correct ticket context.
4. As a person launching from a task workspace, I want the launch to retain the current project and module scope, so that backend lookup and working-directory resolution use the correct module.
5. As a person launching from a task workspace, I want the run to use the selected work item's durable identifier rather than its visible label, so that renames and duplicate titles cannot redirect the launch.
6. As a person launching from a task workspace, I want no prompt-entry modal, so that a context-only launch is quick.
7. As a person launching from a task workspace, I want no optional initial-prompt text sent on my behalf, so that the agent begins from canonical ticket context rather than invented instructions.
8. As a person launching from a task workspace, I want the agent to receive the work item's authoritative name, description, workflow state, type, relationships, and module context, so that it understands the ticket it was launched for.
9. As a person launching from a task workspace, I want applicable workflow-stage guidance and required skills preserved, so that skipping user prompt entry does not bypass project launch policy.
10. As a person launching an agent, I want a new terminal tab to appear in the same task workspace, so that I can immediately see and interact with the run.
11. As a person launching an agent, I want the new terminal tab to become active, so that I do not have to locate it after launch.
12. As a person who already has agent tabs open, I want every launch to create a fresh run and tab, so that starting another agent never silently reuses an existing conversation.
13. As a person switching between task workspaces, I want the launcher to use the workspace that owns the clicked control, so that selection changes cannot launch against a stale ticket.
14. As a person using more than one coding provider, I want each activated provider listed once, so that the menu is predictable and does not expose disabled providers.
15. As a person using the keyboard, I want the launcher menu to support focus, arrow navigation, confirmation, Escape, and focus restoration, so that the task launch is fully operable without a pointer.
16. As a person who dismisses the launcher, I want an outside click or Escape to close it without launching, so that inspection is not commitment.
17. As a person who clicks or confirms a provider more than once during UI event delivery, I want only one run committed, so that one selection cannot accidentally create duplicates.
18. As a person without a ready Studio profile, I want the launcher disabled with a useful explanation, so that an impossible launch does not fail mysteriously.
19. As a person whose activated-provider list is loading or failed, I want the launcher to present the existing provider-state explanation, so that an empty menu is understandable.
20. As a person using a module scratch workspace, I want its `＋ Agent` control to keep offering Plan and Instant modes, so that task-context launch behavior does not replace scratch workflows.
21. As a person launching from a task with an available worktree, I want the existing task launch path to choose that worktree, so that the new convenience control preserves workspace isolation.
22. As a maintainer, I want this behavior to reuse the existing terminal-session launch boundary, so that Studio does not gain a second agent-execution contract.
23. As a maintainer, I want the task-workspace acceptance suite to prove the behavior through the rendered launcher and observable run request, so that tests cover the user interaction instead of private component state.

## Implementation Decisions

### Workspace-local launch intent

- Treat the launcher as part of the task workspace tab strip, alongside
  Details, document, and terminal tabs. Render it only when a launch context is
  available.
- The task workspace owns an immutable launch context for the rendered control:
  project identity, module identity, work-item identity, displayed ticket
  sequence, and profile readiness. Launch from that context rather than reading
  mutable global selection again when the provider is chosen.
- Preserve the existing discriminated task-versus-scratch launcher contract.
  Task launch lists providers and creates a task run; scratch launch lists Plan
  and Instant and delegates to the established scratch flows.

### Provider choice and availability

- Populate the task launch menu from the application's supported provider
  catalog intersected with the host's activated-provider capabilities. Do not
  show or attempt to launch a provider disabled by the current host profile.
- Keep the existing provider loading, failure, and empty-state presentation as
  the authority for why no provider can be selected.
- A ready Studio profile is required. When no profile is ready, keep the control
  visible but disabled and explain the prerequisite through its accessible
  title.

### Prompt and context contract

- Start the task run with the chosen provider, project id, module id, work-item
  id, and ticket sequence. The optional initial prompt is absent/null;
  planning and instant flags are false.
- Do not open the prompt-entry modal, synthesize user prose, or copy text from
  an unrelated scratch flow.
- Keep task context composition on the backend. It fetches the authoritative
  work-item details, resolves module-folder/worktree and design-directory
  context, applies the current workflow launch configuration, and prepares the
  provider command.
- “Promptless” is strictly a UI/user-input property. Canonical task context,
  state-specific workflow guidance, and the resolved required-skills envelope
  remain in the provider prompt.
- Do not introduce a new REST route, MCP operation, execution mode, or persisted
  run shape for this feature. Use the canonical task-terminal creation
  contract.

### Terminal and interaction behavior

- Opening a task run immediately registers a connecting terminal session in
  the owning task bucket, selects the terminal surface, and records a pending
  terminal target for workspace restoration. Normal backend acknowledgement
  rekeys that temporary session to the durable terminal/run identity.
- Each committed provider selection starts one fresh run. Guard the open menu
  against repeated activation before it closes.
- Preserve accessible menu behavior: focus the first available item on open;
  support Arrow Up/Down, Home, End, and Escape; return focus to the launcher on
  Escape; and dismiss on an outside pointer press without consuming that press.
- Switching workspace bucket or switching between task and scratch launcher
  kinds closes any open launcher and clears its one-launch guard.

### Failure boundaries

- Keep existing launch errors and terminal lifecycle presentation. Profile,
  task lookup, module lookup, working-directory, provider, and runtime failures
  remain owned by the existing terminal launch path rather than receiving
  launcher-specific persistence or retry rules.
- A failed launch must not change the work item's workflow state and must not
  start a dependency graph or subtree run.

## Testing Decisions

A good test observes the rendered task workspace and the public terminal launch
contract. It clicks the real `＋ Agent` control, chooses a visible provider, and
asserts the resulting session/request and active terminal tab. It does not
assert component-local state, private helper calls, or reproduce backend prompt
composition in frontend test code.

**Primary seam.** Extend the existing mounted
`SelectedTicketContent` acceptance seam used by the Studio overhaul tests. This
is the highest single seam that renders the real workspace tab strip, launcher,
workspace-tab store, and terminal-session store while allowing provider
capabilities and the terminal API boundary to be controlled. Add or update the
numbered acceptance gate in the same change, as required for every
user-visible Studio behavior change. No new production test seam is needed.

**Acceptance coverage.** Through that seam, prove:

1. A real task workspace with a ready profile renders `＋ Agent` in its tab strip.
2. Activating it lists activated providers and excludes disabled providers.
3. Choosing a provider creates one task-scoped terminal session carrying the owning work-item, project, module, provider, and ticket sequence.
4. The optional initial prompt is null/absent and the launch is neither planning nor instant.
5. No prompt-entry modal appears.
6. The resulting terminal tab appears in the same task workspace and becomes active.
7. Repeated activation of one menu choice commits only one launch.
8. Switching the workspace while the menu is open prevents a stale-context launch.
9. A missing profile disables the launcher, while loading, failed, and empty provider states use the established explanations.
10. Keyboard navigation, Escape focus restoration, and outside-click dismissal remain operable.
11. The existing scratch-workspace acceptance case continues to offer Plan and Instant rather than task providers.

**Backend contract coverage.** Retain or extend terminal-launch tests at the
existing prompt-builder/control-plane seam to prove that a task launch with no
initial prompt still fetches the requested work item and builds canonical task
context, including workflow guidance and required skills where configured.
Verify that optional user text is not prefixed when absent.

**Regression checks.** Run the focused task-workspace acceptance case, focused
terminal backend tests, `npm run test:overhaul --workspace
@worktracker/studio`, and the Studio typecheck. Existing terminal lifecycle,
restoration, scratch-launch, provider-capability, and worktree-launch tests
remain part of the regression signal.

## Out of Scope

- Creating Implementation work items or decomposing this Story into tickets
  during the Spec stage.
- Automatically choosing a provider or changing the host's provider activation
  settings.
- Asking for, remembering, templating, or generating a user-authored initial
  prompt.
- Removing workflow-stage guidance, required skills, factual task context, or
  other backend-composed launch instructions.
- Changing scratch Plan, scratch Instant, document-chat, state-entry
  auto-start, dependency-subtree, or MCP launch flows.
- Moving the work item to another workflow state as a side effect of launch.
- Reusing, resuming, or terminating an existing run when `＋ Agent` is used.
- Changing terminal persistence, tmux durability, native rendering, worktree
  selection, or the browser fallback.
- Adding a new backend execution API or changing the durable AgentRun schema.

## Further Notes

- This specification uses **work item**, **workflow state**, **workflow stage**,
  and **launch binding** as defined by the WorkTracker domain glossary. A new
  glossary term or ADR is not required.
- The selected task is the launch target, but no workflow transition occurs.
  This is an interactive task run, not state-entry auto-start or an
  implementation kickoff.
- The existing architecture already has a narrow task-terminal launch path and
  backend-owned context builder. The implementation should keep this feature at
  that seam rather than duplicate prompt composition in Studio.
