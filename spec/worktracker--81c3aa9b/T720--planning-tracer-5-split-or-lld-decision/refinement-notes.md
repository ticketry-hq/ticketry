# CODIN-720 refinement notes

## Terminology reset

Use this vocabulary as the target model for the planning tracer, even where
older tickets still use the terms loosely:

- **PRD**: requirements only. It records the problem, users, behavior,
  acceptance criteria, constraints, assumptions, and explicit non-goals. It does
  not make implementation-level design decisions.
- **HLD**: pre-split implementation design. It decides enough implementation
  shape to split the work intelligently: database touch or not, backend and
  frontend/component boundaries, service/API seams, data flow, migration needs,
  and risk areas. It is the code-context-aware input to the splitter.
- **LLD**: split-level implementation plan. Each LLD belongs to one small leaf
  task and defines exactly what that slice changes, how it is tested, and what
  remains out of scope.

## Corrected #719 -> #720 handoff

#719 hands off a locked PRD artifact. #720 should not re-refine the idea and
should not treat "split-or-LLD" as a vague branch. Its first job is to invoke a
dedicated HLD/splitter agent that reads the locked PRD, uses `to-issues` style
reasoning, and writes a code-context-aware HLD containing the proposed
implementation split tree.

That implies this ticket is better framed as:

1. consume the locked PRD artifact from #719;
2. launch a dedicated HLD/splitter agent;
3. have the agent write the HLD with proposed leaf tasks plus directed
   `blocked_by` edges;
4. require human approval in-session before creating tasks/edges;
5. after approval, launch a separate split-registration agent that reads the
   approved HLD and creates the actual tasks and edges;
6. emit subtask-create and edge-wire actions as reducer data, with side-effect
   ports mocked in reducer tests;
7. recurse each created leaf through the next planning phase that gives it its
   own split-level LLD before implementation.

Decision settled: #720 stops at approved split-tree creation. Leaf LLD
generation is a separate phase tracked by **CODIN-743 — Planning tracer:
generate leaf LLDs for approved split tree**.

Final boundary after refinement:

- CODIN-719 produces a locked **PRD** from a raw Backlog idea.
- CODIN-720 starts when that root work item reaches **Todo**.
- CODIN-720 launches an HLD/splitter agent over the PRD.
- The agent uses `to-issues` style reasoning to write a visual HLD containing
  the proposed implementation split tree.
- The user reviews that HLD.
- Approval is represented by moving the same root work item to **LLD**.
- Split registration is not another approval step; it is a separate follow-up
  phase tracked by **CODIN-745 — Planning tracer: register approved HLD split
  tree**. For the interactive drawer path clarified by CODIN-746, this follow-up
  is not auto-launched by the Todo -> LLD move; it requires its own explicit
  trigger.
- Leaf LLD generation remains tracked by **CODIN-743**.

Interim trigger and approval signals: the richer hidden lifecycle-state model is
later work tracked by CODIN-744. For now:

- #720 starts when the root work item reaches the existing **Todo** state.
- #720 launches the HLD/splitter work and produces the HLD with the proposed
  split tree.
- The user reviews the HLD. If they approve it, either the agent or the user
  moves the same root work item to the existing **LLD** state.
- The **Todo -> LLD** status change is the approval/completion signal for the
  in-flight split phase. In the later autonomous pipeline, that approval can
  feed split registration and leaf-level LLD generation through CODIN-745 and
  CODIN-743. In the CODIN-746 interactive drawer path, the move completes the
  in-flight split run only and launches nothing.
