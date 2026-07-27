# LLD - T700: Update Coding Agent State Prompts for the New Planning Pipeline

**Module:** `worktracker--81c3aa9b`
**Work item:** #700
**Phase:** Todo -> LLD review only
**Scope:** prompt text and prompt-contract tests; no engine behavior changes

## Objective

Update the Coding app's built-in per-state agent prompts so agents launched from WorkTracker states follow the refined #700 workflow:

Backlog idea -> locked PRD -> HLD with proposed split tree -> approved split registration -> leaf LLD generation -> implementation -> Done.

The current prompts still treat `Todo` as the state where an agent writes the low-level implementation plan. That is now wrong for root planning work. In the refined workflow, `Todo` means the requirements/PRD are locked and the next agent should produce the code-context-aware HLD and proposed split tree. `LLD` on the root means that HLD/split proposal has been approved and can be registered. Leaf implementation work still uses LLDs before implementation.

## Decisions

| Decision | Plan |
| --- | --- |
| Source of truth | Backend launch prompt defaults remain the runtime source of truth in `../server/apps/terminals/agents/prompts.py`. |
| UI mirror | `studio/src/coding/lib/defaultPrompts.ts` stays in sync so the Prompt editor displays the same defaults a fresh backend uses. |
| Workflow wording | The default prompt names the current interim workflow: Backlog -> Todo -> LLD -> Split -> In Progress -> Done, with `Todo` representing PRD locked/HLD proposal next and `LLD` representing approved split registration next. |
| Backlog prompt | Backlog agents refine a raw idea into a locked PRD, not an HLD or implementation plan. They update the task with requirements and move Backlog -> Todo only when the PRD is ready. |
| Todo prompt | Todo agents act as HLD/splitter agents. They inspect code context, write the visual HLD with proposed split tree and intended `blocked_by` edges, do not create tasks, do not wire edges, do not write leaf LLDs, and move Todo -> LLD only after user approval. |
| LLD prompt | LLD agents register the approved split tree from the HLD: create leaf tasks and wire dependencies. They do not generate leaf LLDs or implement code unless the ticket is explicitly a leaf with an approved LLD. |
| Split prompt | Add a built-in `Split` prompt. Split agents generate one LLD per registered leaf task and do not implement code. When leaf LLDs are accepted, they may move the relevant leaf work to `In Progress` only with approval. |
| In Progress prompt | In Progress agents implement only the agreed leaf LLD scope and validate touched behavior. |
| Existing profile overrides | Existing user-defined prompt overrides remain untouched; only built-in defaults change. |

## Current Files

| File | Status | Responsibility |
| --- | --- | --- |
| `../server/apps/terminals/agents/prompts.py` | Modify later | Runtime `DEFAULT_AGENT_PROMPTS`; applied when launching task-context agent runs. |
| `studio/src/coding/lib/defaultPrompts.ts` | Modify later | Prompt editor fallback copy; must mirror backend defaults. |
| `../server/apps/execution/recipes.py` | Read-only for this slice | Engine recipe prompts for autonomous refine/split phases already exist and are narrower than the generic state prompts. Do not change unless tests prove they conflict. |
| `../server/apps/terminals/tests/test_launcher.py` | Modify later | Add prompt-contract coverage for backend defaults. |
| `studio/src/test/coding/lib/defaultPrompts.test.ts` | Add later | Add frontend coverage for prompt lookup and required workflow terms. |

## Implementation Harness

1. Confirm backend prompt defaults and Studio prompt defaults expose the same state keys after the change: `default`, `Backlog`, `Todo`, `LLD`, `Split`, and `In Progress`.
2. Add backend prompt-contract tests that assert the new workflow semantics at the level of required phrases and forbidden old behavior.
3. Add frontend prompt-contract tests that assert `defaultPromptFor` resolves `Todo`, `LLD`, and `Split` and that the displayed defaults include the same phase duties as the backend.
4. Update backend defaults in `../server/apps/terminals/agents/prompts.py`.
5. Update Studio defaults in `studio/src/coding/lib/defaultPrompts.ts` with matching content and correct comments pointing to the backend file's actual location.
6. Run targeted backend prompt tests.
7. Run targeted Studio prompt tests.
8. If broader test commands are cheap and already configured, run the relevant backend and frontend unit suites that cover prompt launch and prompt-editor behavior.

## Prompt Contract

### Default

The default prompt must:

- Tell agents to follow `AGENTS.md`.
- Name the refined Coding workflow.
- Require repo exploration before edits.
- Require the agent to update WorkTracker state when the workflow advances in-session.
- Preserve the existing guard that implementation moves to `In Progress` before code changes and moves to `Done` only after implementation, validation, and user confirmation.

### Backlog

The Backlog prompt must:

- Treat the task as an unrefined idea.
- Run a requirements-refinement conversation, not implementation planning.
- Produce or update a locked PRD in the task context.
- Keep implementation, HLD split design, task creation, edge wiring, and LLD generation out of scope.
- Move to `Todo` only when requirements are clear and the user agrees the PRD is ready.

### Todo

The Todo prompt must:

- Treat the task as a locked PRD ready for HLD/split proposal.
- Require code-context inspection before writing the design.
- Create or update the visual HLD in the current design directory.
- Include proposed leaf tasks, boundaries, non-goals, and intended dependency edges.
- Forbid creating tasks, wiring `blocked_by`, writing leaf LLDs, or implementing code.
- Move to `LLD` only after the user approves the HLD/split proposal.

### LLD

The LLD prompt must:

- Treat the root task's move into `LLD` as approval of the proposed HLD/split tree.
- Register the approved split tree by creating child/leaf tasks and wiring `blocked_by` dependencies.
- Keep leaf LLD generation and implementation out of scope for root split registration.
- Leave the root in the correct next state once registration is complete, expected to be `Split` until the hidden state model replaces this interim signal.
- Preserve a clear leaf-task escape hatch: if a task is already an implementation leaf with an approved LLD and no split tree to register, the agent may proceed only according to the implementation approval rules.

### Split

The Split prompt must:

- Treat registered leaf tasks as ready for leaf-level LLD generation.
- Generate one LLD per leaf task in each leaf task's design directory.
- Keep code implementation out of scope.
- Require user acceptance before any leaf implementation starts.

### In Progress

The In Progress prompt must:

- Implement only the agreed leaf LLD scope.
- Avoid unrelated edits and validate touched behavior.
- Update task descriptions only when implementation reveals material scope or sequencing changes.
- Move to `Done` only after the agreed scope is implemented, validated, and the user confirms completion.

## Tests

### Backend

Add tests that verify:

- `DEFAULT_AGENT_PROMPTS` includes `LLD` and `Split`.
- The default prompt names the refined workflow.
- The Backlog prompt says PRD and does not say LLD is the next deliverable.
- The Todo prompt says HLD/split proposal and forbids task creation, edge wiring, leaf LLD generation, and implementation.
- The LLD prompt says approved split registration and mentions creating leaf tasks plus `blocked_by`.
- The Split prompt says leaf LLD generation and forbids implementation.
- `build_context_prompt` still places the matching state prompt before the WorkTracker task context.

### Frontend

Add tests that verify:

- `defaultPromptFor` is case-insensitive for `Todo`, `LLD`, and `Split`.
- The Studio defaults expose the same state keys as the backend contract.
- The visible Todo default no longer instructs the agent to write `LLD.md` as the next deliverable.
- The visible Split default exists and describes leaf LLD generation.

## Out of Scope

- No implementation of engine orchestration, topo execution, idempotency, run-state tracking, trigger UI, or MCP trigger.
- No changes to `spawn_run`.
- No changes to `issue_state_changed`.
- No changes to task state definitions or hidden lifecycle state modeling.
- No mutation of existing profile-level prompt overrides stored in user config.
- No migration of existing tasks, descriptions, or generated design documents.

## Risks and Guards

| Risk | Guard |
| --- | --- |
| Backend and Studio prompt defaults drift again | Add tests on both sides and update comments to point to the actual backend path. |
| Root `LLD` prompt conflicts with leaf implementation behavior | State the root split-registration behavior first, then include a narrow leaf escape hatch. |
| Agents create tasks too early from Todo | Todo prompt explicitly forbids task creation and edge wiring. |
| Agents implement during planning states | Backlog, Todo, LLD root registration, and Split all explicitly forbid implementation. |
| User prompt overrides hide new defaults | Leave overrides untouched; this slice only updates built-in defaults for new/fallback profiles. |

## Acceptance Signal

This LLD is accepted when it is clear that the implementation will update both runtime and UI prompt defaults to match the refined #700 workflow, with tests proving `Todo` now means HLD/split proposal, `LLD` means approved split registration, and `Split` means leaf LLD generation.
