# Worktracker

The vocabulary of durable work items, their workflow states, the relationships
between them, and project-owned launch policy bound to those durable identities.
It persists opaque prompt/configuration values; it does not compose prompts or
execute agents.

## Language

**Workflow state**:
The project-scoped, ordered category that records a work item's current position in its workflow. A state may participate in different workflows for different work-item types.
_Avoid_: Agent state, lifecycle state, status prompt

**Workflow state color**:
The persistent project-scoped visual identity of a workflow state, reused wherever work items in that state are presented.
_Avoid_: Agent color, lifecycle color, row color, transient fallback

**Transition gate**:
The workflow rule that decides whether a requested move between two workflow states is legal. It governs movement, not whether entering the destination launches an agent.
_Avoid_: Human gate, automation gate, prompt restriction

**Work-item workflow**:
The directed graph a work-item type defines over a subset of the project's shared workflow states. Different types may reuse the same states while allowing different destinations from each state.
_Avoid_: Project state list, linear state order, duplicated type state, agent lifecycle

**Issue type**:
The required, explicit project-scoped classification of one work item. Every
module and task has exactly one issue type whose level matches the work item's
structural level. Selecting the type is a prerequisite to creation; the type's
start state then determines where the work item is born.
_Avoid_: Default type, inferred type, optional type, module/task discriminator

**Scoped apply**:
The workflow-settings edit model in which each edit validates only the configuration scope it changes and, on success, immediately becomes active project policy. There is no intermediate saved-but-inactive configuration.
_Avoid_: Draft save, publish, auto-publish, validate action

**Standing warning**:
A persistent diagnostic reporting that active workflow configuration violates a whole-workflow expectation (an unreachable state, a state with no path to the stop state). It informs without blocking edits to other scopes. Only an edit that would arm automation lacking a valid launch configuration is rejected outright.
_Avoid_: Publish error, blocking validation failure, legacy defect

**Work-item order**:
The user-controlled relative position of a work item within its planning context. It is the product's scheduling signal, not a categorical urgency classification.
_Avoid_: Priority, urgency badge

**Transition landing position**:
Where a work item appears in its destination state's grouping after a
non-positional state change: appended after that state's current last item.
An explicit drop position from a cross-column drag overrides it, and items
already in a state are never rearranged by someone else's arrival.
_Avoid_: chronological column order, state-entry timestamp, auto-sort

**Onboarding-required project**:
A freshly provisioned default project whose installation-wide onboarding has
not been completed, dismissed, or superseded by user-created planning data. It
is durable shared state, not an inference from empty project contents.
_Avoid_: fresh user, empty project, browser onboarding

**Supported consumer**:
A product surface whose compatibility constrains the current release. For the
first-release worktracker this means the stripped Studio frontend and MCP/agent
paths; frozen preservation branches are recovery references, not supported
consumers.
_Avoid_: every historical caller, generated client

**Retirement boundary**:
The release point after the last supported consumer is removed, beyond which a
capability and its public contract may be deleted together. It is a sequencing
constraint, not a deprecation period.
_Avoid_: soft delete, hidden feature

**Review finding**:
A newly created Implementation work item that records a defect found while its
parent Story is in Review. It is created in the Implementation start stage and
is not a separate issue type; nothing distinguishes it from any other
Implementation child once created. It carries no dependency edge and starts no
agent — it is inert until a person kicks off implementation.
_Avoid_: AddressReview, comment, dependency, queued state

**Finding source location**:
The repository-relative file path and inclusive start/end line range identifying
the code area a review finding addresses; it may also carry an explanatory note.
It is evidence attached to a finding, not a scheduling dependency.
_Avoid_: blocker, failing area link

**Dependency-subtree status read**:
The read-only, rooted view of a work item's full descendant tree carrying, per
node, only its workflow state and its `blocked_by` edges. It is a factual
projection of the tracker model — it never launches execution, exists before
any graph run, and carries no execution-run or lifecycle data and no derived
flags (such as a computed frontier).
_Avoid_: graph run, execution status, ready/frontier flag, graph-status skill

**Implementation kickoff**:
The human act of moving a parent Story into the implementation stage and starting
a dependency subtree run. It is the only thing that makes Implementation children
runnable: children — including review findings — accumulate in the Implementation
start stage and sit inert until a person kicks off. There is no bulk state move,
no persisted round membership, and no snapshot of repository code.
_Avoid_: fix campaign, bulk move, review batch, persisted member list, queue drain

**Workflow stage**:
A named workflow state as a person reads it in the task tree: an ordered position
with its own launch prompt and at most one pinned upstream skill. The task tree
may choose a decorative icon from the state's name, but the stage owns no icon
data. Stage is the presentation-and-launch reading of a workflow state; it adds
no second identity and no separate storage.
_Avoid_: phase, step, lifecycle stage, column

**Refinement chain**:
The three consecutive Story stages — Grill, Spec, Tickets — that turn an idea
into dependency-ordered Implementation children, one stage per skill and one
stage per deliverable. Entering Spec or Tickets starts its agent automatically,
so the chain advances without a relaunch; it halts at Tickets because leaving it
is an Implementation kickoff and therefore a human-only move.
_Avoid_: refinement state, planning phase, grooming, auto-pipeline

**Per-type transition map**:
The complete set of allowed state transitions owned by one issue type — one
edge row per allowed move, each carrying its agent permission. There is no
project-wide shared graph and no inheritance or override between types; two
types behave alike only because their maps say the same thing.
_Avoid_: shared graph, transition override, effective graph

**Workflow member state**:
A project state that belongs to one issue type's workflow because it is
reachable from that type's start state by following its transition map. There
is no persisted membership list — membership is recomputed from the graph.
States outside the membership are invisible to that type: the workflow editor
does not show them, standing warnings do not evaluate them, and transition
dropdowns do not offer them.
_Avoid_: enabled state, per-type state list, hidden state

**Workflow prune**:
The cleanup that accompanies any edit which disconnects states from an issue
type's start state (removing a state, deleting an edge, changing the start
state): the disconnected states' transitions and launch bindings for that
type are deleted. The client derives the impact from the canonical rows before
a human confirms the edit. The project state catalog is never touched —
pruning removes per-type configuration, not states.
_Avoid_: cascade delete, orphan cleanup, state deletion

**Transition origin**:
The declared source of a state-change write: `human` or `agent`. The
worktracker-agent surface always stamps `agent` and callers cannot override
it; Studio writes are `human`, as are unlabelled REST writes. Enforcement
happens in the backend transition service, not in any client.
_Avoid_: actor, user identity, auth principal

**Human-only transition**:
A transition whose edge disallows agents: agent-origin writes are rejected at
enforcement. It is a brake on chained automation, not an approval flow.
_Avoid_: approval gate, protected state, locked edge

**State-entry auto-start**:
The launch-binding flag that starts the binding's configured agent whenever a
work item enters that state for that type, regardless of which edge was taken
or whether a human or an agent moved it. It exists only where a launch
binding exists, so automation can never be armed without launch configuration.
_Avoid_: per-edge auto_launch, launch trigger edge

**Resolved project**:
The single project that owns every module and work item while the Projects
surface is gated off. It is identified by a fixed key rather than chosen by a
person, and it is created — fully configured with the standard states, issue
types, workflows and launch bindings — the first time it is asked for. Other
project rows continue to exist and remain reachable over the API; they are
simply not what the surface resolves to.
_Avoid_: current selection, implicit workspace, hidden project, fallback project

**Module ordering mode**:
The durable, project-owned fact that decides how a module collection read is
ordered. Every project begins and migrates into *automatic*, where the read is
newest-created-first and clients may layer agent-activity recency on top. A
project acquires *Manual module order* on its first module drag, after which
the read is the module work items' ascending fractional rank and no activity
may rearrange it. It is a one-way decision in this version, and it belongs to
the project rather than to a user, device, or module surface.
_Avoid_: sort preference, per-user order, recency toggle, pinned modules

**Work-item change revision**:
The project-monotonic counter stamped on a work item whenever a committed change
to it must reach live clients — a field edit, a relationship change, a reorder,
a creation, or a deletion, not only a workflow-state transition. It keeps the
name `state_revision`, which records where the counter began rather than what it
now covers: a work item's revision advances for any published change. It is the
sole ordering authority for replay and for rejecting a stale read; it is never a
timestamp, an arrival order, or a global sequence.
_Avoid_: state-only revision, transition counter, updated_at, arrival order, global sequence

**Work-item change frame**:
The notification that one work item changed, carrying only its identity and the
revision at which it changed. It never carries the changed values — a client
learns *that* an item changed and reads the authoritative item to learn *what*
changed. A deletion is announced the same way; only the subsequent read
distinguishes it.
_Avoid_: field delta, patch frame, change payload, state frame

**Subtree-run capability**:
The per-issue-type, per-state launch-binding flag that permits a dependency
subtree run to start from a work item in that cell. Unlike state-entry
auto-start, it is not gated on launch configuration, survives clearing the
cell's launch binding, and arms no agent or other automation on its own.
_Avoid_: state-entry auto-start, Story-only run rule, subtree auto-start

**Work-item archive**:
The one-way visibility flag that hides a work item and every one of its
descendants from the planning surfaces and from execution selection. It is
independent of workflow state — a module carries no state at all and an
archived task keeps whatever state it was in — and it is refused outright
while any item in the subtree has live agent work. Cancellation also archives,
but as a side effect of entering a cancelled state; archiving is the direct
act, and it says nothing about whether the work was finished or abandoned.
_Avoid_: delete, cancel, done, soft delete, hidden state, archived state

**Route registry**:
The single declaration of which reads and which writes exist for each model,
against which the live route table is checked. It answers "how many ways can
this model be read or written?" — a question the surface could not previously
answer — and it forbids the undeclared route rather than merely discouraging it.
It is asserted against the route table, not against any web framework, so it
outlives both.
_Avoid_: URL conf, API docs, OpenAPI document, endpoint list

**Canonical collection read**:
The one read that returns a model's rows for a given scope. Narrower views are
requested by declared filter parameters on that same route — for work items,
project, module, state, archived visibility, and PathFind visibility — rather
than by adding another overlapping collection endpoint. Every filtered response
merges rows into the same normalized client store by id; filters describe
membership, never a second record location.
_Avoid_: list variant, nested work-item list, request-keyed record cache

**Domain operation**:
A write that is not model CRUD — work-item, state, or issue-type reorder;
remove-state-from-workflow (because no row records graph membership); or
onboarding acknowledgement. Each is deliberately exceptional and lives in a
named place apart from the CRUD surface, so exceptions stay countable instead
of hiding among equally-bespoke handlers. Transition rows themselves are CRUD.
There are exactly five, and the route registry records why each cannot be CRUD.
_Avoid_: custom action, unreasoned RPC endpoint, ad-hoc view
