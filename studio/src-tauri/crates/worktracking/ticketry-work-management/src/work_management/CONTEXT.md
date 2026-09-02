# Work Management

Owns workspaces, projects, work items, types, workflows, launch bindings, and
the durable planning database.

## Language

**Launch binding**:
The per-(issue type, workflow state) policy that governs how an agent is
launched when a work item of that type sits in or enters that state: prompt,
required skills, entry skill, model, reasoning, auto-start.

**Entry skill**:
The one required skill a launched agent must begin with, delivered by typing
its invocation command (`/skill` or `$skill`) into the agent's terminal as if
a user entered it. Exists because user-invoke-only skills cannot be invoked by
the model from prompt text. Always one of the binding's required skills.
_Avoid_: launch skill, initial skill

**Handoff**:
A per-workflow-edge flag. When a transition takes a handoff edge, the
destination state's prompt and entry skill are delivered as typed input into
the work item's still-live agent session instead of spawning a fresh agent.
Configured beside the edge's origin permission in the workflow editor. A
handoff edge decides *how* the destination is delivered, never *whether*: a
destination that would not have launched still does not launch.
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
