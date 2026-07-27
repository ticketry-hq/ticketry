# CODIN-746 refinement notes

Refined 2026-07-01. Task is a **narrow carve-out of #721's trigger surface**: the
drawer trigger bridge from an explicit operator action to an existing planning
tracer phase. Blocked on #703 (tabbed drawer / #751 terminal tab + agent picker)
and the #716/#719/#720 tracer primitives; the bridge contract is defined now.

## Context established during refinement
- The execution/planning tracer (#716→#721) is **entirely unimplemented** — no
  `apps/execution` exists on any branch. All tracer LLDs are design-only.
- `apps.execution.driver.execute(task_id, agent, phase)` is an **internal
  callable**; #716/#719/#720 each explicitly ship **no HTTP route, no Studio
  action, no trigger surface**, deferring the trigger to #721.
- The real working seam that already exists: `issue_state_changed`
  (`worktracker/signals.py`, #704/#706) — completion signals ride this.
- Today's untracked path: pick agent + launch a terminal run → prompt-driven,
  registers no tracer state. #746 does **not** change this path.

## Locked decisions
1. Explicit **Refine** (Backlog) / **Split** (Todo) buttons in the drawer.
   Tracked runs are never inferred from prompt text or the generic launch.
2. Buttons state-gated to the phase's required group.
3. **Completion-only** transitions: Backlog→Todo completes refine; Todo→LLD
   completes split. No transition auto-launches the next phase (revisit later).
4. #746 owns a **new HTTP endpoint** `POST /work-items/{id}/planning-run {phase}`
   → creates process-local tracer state → launches via the primitive.
5. Agent = the drawer's currently-selected agent.
6. **Fire-and-forget** UX: run shows as a normal agent run in the Terminal tab.
   Server-side guard: 409 on a duplicate live run for task+phase; 409/422 on
   wrong group. No status-reflection GET.
7. No durable tracking; restart limitation documented (durable lifecycle → #744).

## Ownership boundaries
- Auto-launch / phase chaining → #721. Split registration → #745. Leaf LLDs →
  #743. Hidden lifecycle states / durable tracking → #744. #746 is the
  interactive, explicit-button, completion-only bridge only.
