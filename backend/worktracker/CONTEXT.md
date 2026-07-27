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

**Scoped apply**:
The workflow-settings edit model in which each edit validates only the configuration scope it changes and, on success, immediately becomes active project policy. There is no intermediate saved-but-inactive configuration.
_Avoid_: Draft save, publish, auto-publish, validate action

**Standing warning**:
A persistent diagnostic reporting that active workflow configuration violates a whole-workflow expectation (an unreachable state, a state with no path to the stop state). It informs without blocking edits to other scopes. Only an edit that would arm automation lacking a valid launch configuration is rejected outright.
_Avoid_: Publish error, blocking validation failure, legacy defect

**Work-item order**:
The user-controlled relative position of a work item within its planning context. It is the product's scheduling signal, not a categorical urgency classification.
_Avoid_: Priority, urgency badge

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
parent Story is in Review and is intended to be resolved in a later campaign.
It is not a separate issue type and follows the normal Implementation workflow.
_Avoid_: AddressReview, comment, dependency

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

**Fix campaign**:
The direct Implementation children bulk-moved from Ready to Implement when a
person moves a parent Story from Review to Implement. Only children in
Implement (or their subsequent review/terminal path) belong to that round;
findings created later remain Ready for the next campaign. It is a scheduling
boundary, not a snapshot of repository code.
_Avoid_: code snapshot, review batch, persisted member list

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
type are deleted, after a human confirms a preview of exactly what goes. The
project state catalog is never touched — pruning removes per-type
configuration, not states.
_Avoid_: cascade delete, orphan cleanup, state deletion

**Transition origin**:
The declared source of a state-change write: `human` or `agent`. The
worktracker-agent surface always stamps `agent` and callers cannot override
it; Studio writes are `human`, as are unlabelled REST writes. Enforcement
happens in the backend transition service, not in any client.
_Avoid_: actor, user identity, auth principal

**Human-only transition**:
A transition whose edge disallows agents: agent-origin writes are rejected at
enforcement, and `force` never rescues them — force is a human-only recovery
hatch. It is a brake on chained automation, not an approval flow.
_Avoid_: approval gate, protected state, locked edge

**State-entry auto-start**:
The launch-binding flag that starts the binding's configured agent whenever a
work item enters that state for that type, regardless of which edge was taken
or whether a human or an agent moved it. It exists only where a launch
binding exists, so automation can never be armed without launch configuration.
_Avoid_: per-edge auto_launch, launch trigger edge

**Subtree-run capability**:
The per-issue-type, per-state launch-binding flag that permits a dependency
subtree run to start from a work item in that cell. Unlike state-entry
auto-start, it is not gated on launch configuration, survives clearing the
cell's launch binding, and arms no agent or other automation on its own.
_Avoid_: state-entry auto-start, Story-only run rule, subtree auto-start
