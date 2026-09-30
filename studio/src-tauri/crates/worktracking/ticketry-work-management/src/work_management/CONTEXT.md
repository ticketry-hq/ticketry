# Work Management

Owns workspaces, projects, work items, types, workflows, launch bindings, and
the durable planning database.

## Language

**Launch binding**:
The per-(issue type, workflow state) policy that governs how an agent is
launched when a work item of that type sits in or enters that state: prompt,
required skills, Stage skills, model, reasoning, auto-start.

**Required skills**:
Skills the runtime must have available before it may launch the stage. They are
an availability guard. They do not populate or restrict Stage skills.

**Stage skills**:
The ordered, free-form skill names a user selects for a workflow stage.
Ticketry adds them to the composed task prompt for fresh launches and handoffs.
It does not submit a separate skill command. An empty list adds no Stage skills
section.

**Handoff**:
A per-workflow-edge flag. When a transition takes a handoff edge, the
destination state's composed prompt, including its Stage skills, is submitted
once to the work item's still-live agent session instead of spawning a fresh
agent.
Configured beside the edge's origin permission in the workflow editor. A
handoff edge requests destination delivery even when ordinary auto-start is
off; without a live, input-capable session, it falls back to a fresh launch.
_Avoid_: resume-on-transition, carry-over, handoff mode

**Delivery mode**:
How a destination reached its agent: `continued` (typed into the work item's
live session across a handoff edge) or `started_fresh` (a new run spawned).
Recorded on the Automation Attempt and published on the status feed. A handoff
edge with no live, input-capable session falls back to `started_fresh`.
_Avoid_: handoff result, resumed

**Transition origin**:
Who moved the work item between states: `human` or `agent`. Enforced against
the workflow edge only; launch behavior after a committed transition is
origin-blind.
